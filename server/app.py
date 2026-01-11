import json
import os
import sqlite3

from flask import Flask, jsonify, render_template, request
from flask_cors import CORS

from rounds import make_rounds, make_rounds_ai_two_stage
from tagging import (
    TAG_DEFS,
    TAG_LOOKUP,
    TAG_MIN_COUNT,
    TYPE_MAP,
    TYPE_TO_TAG,
    filter_history_by_tags,
    summarize_items_by_tag,
    tag_history_items,
)
from utils import gen_id, utc_now_iso

# ============================================================
# App setup
# ============================================================
app = Flask(__name__, template_folder="templates", static_folder="static")
CORS(app, resources={r"/api/*": {"origins": "*"}})
app.config["JSON_SORT_KEYS"] = False

DB_PATH = os.environ.get("HISTORYCOURT_DB", "historycourt.db")

# ============================================================
# DB helpers
# ============================================================
def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = db()
    cur = conn.cursor()
    cur.execute("""
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        history_json TEXT NOT NULL
      )
    """)
    cur.execute("""
      CREATE TABLE IF NOT EXISTS cases (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        rounds_json TEXT NOT NULL,
        FOREIGN KEY(session_id) REFERENCES sessions(id)
      )
    """)
    conn.commit()
    conn.close()


def get_case_with_history(case_id):
    """
    Returns (conn, case_row, history_list). Caller must close conn.
    """
    conn = db()
    case_row = conn.execute(
        "SELECT session_id, rounds_json FROM cases WHERE id = ?",
        (case_id,),
    ).fetchone()
    if not case_row:
        conn.close()
        return None, None, None
    session_row = conn.execute(
        "SELECT history_json FROM sessions WHERE id = ?",
        (case_row["session_id"],),
    ).fetchone()
    history = json.loads(session_row["history_json"] or "[]") if session_row else []
    return conn, case_row, history


# ============================================================
# Routes
# ============================================================
@app.get("/")
def index():
    return render_template("landing.html")


@app.get("/review")
def review():
    return render_template(
        "review.html",
        tag_defs=TAG_DEFS,
        type_to_tag=TYPE_TO_TAG,
    )


@app.get("/me/<session_id>")
def me(session_id):
    return render_template("me.html", session_id=session_id, min_tag_count=TAG_MIN_COUNT)

@app.get("/loading-game")
def loading_game():
    return render_template("loading_game.html")


@app.get("/play/<case_id>")
def play(case_id):
    return render_template("play.html", case_id=case_id)


@app.post("/api/upload-history")
def upload_history():
    data = request.get_json(silent=True) or {}
    history = data.get("history") if isinstance(data, dict) else None

    if not history or not isinstance(history, list):
        return jsonify({"ok": False}), 400

    # Basic sanitize + tag inference before persisting
    cleaned = tag_history_items(history, max_history=5000)
    if not cleaned:
        cleaned = []

    session_id = gen_id(14)
    conn = db()
    conn.execute(
        "INSERT INTO sessions (id, created_at, history_json) VALUES (?, ?, ?)",
        (session_id, utc_now_iso(), json.dumps(cleaned)),
    )
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "session_id": session_id, "total_in": len(history), "total_saved": len(cleaned)})


@app.post("/api/review-summary")
def review_summary():
    data = request.get_json(silent=True) or {}
    history = data.get("history") if isinstance(data, dict) else None
    if not history or not isinstance(history, list):
        return jsonify({"ok": False, "error": "Invalid history"}), 400
    items = tag_history_items(history, max_history=5000)
    summary = summarize_items_by_tag(items)
    return jsonify({
        "ok": True,
        "items": items,
        "tags": summary,
        "total": len(items),
    })


@app.get("/api/type-map")
def type_map():
    """
    Expose host->type mapping so clients can classify locally.
    """
    return jsonify({"ok": True, "type_map": TYPE_MAP, "type_to_tag": TYPE_TO_TAG})


@app.get("/api/session/<session_id>/tags")
def session_tags(session_id):
    conn = db()
    row = conn.execute("SELECT history_json FROM sessions WHERE id = ?", (session_id,)).fetchone()
    conn.close()
    if not row:
        return jsonify({"ok": False, "error": "Session not found"}), 404

    history = json.loads(row["history_json"] or "[]")
    tags_summary = summarize_items_by_tag(history)
    return jsonify({
        "ok": True,
        "tags": tags_summary,
        "total": len(history),
        "min_per_tag": TAG_MIN_COUNT,
    })

@app.post("/api/create-case")
def create_case():
    data = request.get_json(silent=True) or {}
    session_id = data.get("session_id")
    rounds_n = int(data.get("rounds") or 5)
    selected_tags = data.get("tags") or data.get("selected_tags") or []
    selected_tags = [t for t in selected_tags if t in TAG_LOOKUP]
    rounds_n = max(3, min(rounds_n, 15))

    # Two-stage knob (optional)
    pick_n = int(data.get("pick_n") or 300)
    pick_n = max(50, min(pick_n, 400))

    conn = db()
    row = conn.execute("SELECT history_json FROM sessions WHERE id = ?", (session_id,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"ok": False, "error": "Session not found"}), 404

    history = json.loads(row["history_json"] or "[]")
    filtered_history = filter_history_by_tags(history, selected_tags) if selected_tags else history
    if not filtered_history:
        filtered_history = history

    try:
        # ✅ NEW: two-stage AI (curator -> rounds)
        rounds_data = make_rounds_ai_two_stage(
            filtered_history,
            n_rounds=rounds_n,
            seed=session_id,
            allowed_tags=selected_tags,
            pick_n=pick_n,
            meta={"session_id": session_id, "request": "create_case"},
        )
    except Exception as e:
        app.logger.warning("AI generation failed, falling back: %s", e)
        rounds_data = make_rounds(
            filtered_history,
            n_rounds=rounds_n,
            seed=session_id,
            allowed_tags=selected_tags,
        )

    case_id = gen_id(12)
    conn.execute(
        "INSERT INTO cases (id, session_id, created_at, rounds_json) VALUES (?, ?, ?, ?)",
        (case_id, session_id, utc_now_iso(), json.dumps(rounds_data)),
    )
    conn.commit()
    conn.close()

    play_url = f"{request.host_url.rstrip('/')}/play/{case_id}"
    return jsonify({
        "ok": True,
        "play_url": play_url,
        "case_id": case_id,
        "rounds": rounds_data,
        "selected_tags": selected_tags,
        "pick_n": pick_n,
    })



@app.get("/api/case/<case_id>/rounds")
def case_rounds(case_id):
    conn, case_row, _history = get_case_with_history(case_id)
    if not case_row:
        return jsonify({"ok": False, "error": "Case not found"}), 404
    rounds = json.loads(case_row["rounds_json"] or "[]")
    conn.close()
    return jsonify({"ok": True, "rounds": rounds, "total": len(rounds)})


@app.post("/api/case/<case_id>/edit")
def edit_case(case_id):
    data = request.get_json(silent=True) or {}
    action = data.get("action")
    target_round = data.get("round")
    selected_tags = data.get("tags") or data.get("selected_tags") or []
    selected_tags = [t for t in selected_tags if t in TAG_LOOKUP]

    # Two-stage knob (optional)
    pick_n = int(data.get("pick_n") or 300)
    pick_n = max(50, min(pick_n, 400))

    conn, case_row, history = get_case_with_history(case_id)
    if not case_row:
        return jsonify({"ok": False, "error": "Case not found"}), 404

    rounds = json.loads(case_row["rounds_json"] or "[]")
    filtered_history = filter_history_by_tags(history, selected_tags) if selected_tags else history
    if not filtered_history:
        filtered_history = history

    def generate(count=1):
        # Important: use a fresh seed per regen so it doesn't repeat
        regen_seed = f"{case_id}-{utc_now_iso()}"
        try:
            # ✅ NEW: two-stage AI
            return make_rounds_ai_two_stage(
                filtered_history,
                n_rounds=count,
                seed=regen_seed,
                allowed_tags=selected_tags,
                pick_n=pick_n,
                meta={"case_id": case_id, "action": action},
            )
        except Exception as e:
            app.logger.warning("AI regen failed, falling back: %s", e)
            return make_rounds(
                filtered_history,
                n_rounds=count,
                seed=regen_seed,
                allowed_tags=selected_tags,
            )

    if action == "delete_round":
        idx = int(target_round) if target_round is not None else -1
        if idx < 0 or idx >= len(rounds):
            conn.close()
            return jsonify({"ok": False, "error": "Round not found"}), 400
        rounds.pop(idx)

    elif action == "regenerate_round":
        idx = int(target_round) if target_round is not None else -1
        if idx < 0 or idx >= len(rounds):
            conn.close()
            return jsonify({"ok": False, "error": "Round not found"}), 400
        new_round = generate(1)[0]
        rounds[idx] = new_round

    elif action == "append_round":
        count = max(1, min(int(data.get("count") or 1), 5))
        rounds.extend(generate(count))

    else:
        conn.close()
        return jsonify({"ok": False, "error": "Unknown action"}), 400

    conn.execute(
        "UPDATE cases SET rounds_json = ? WHERE id = ?",
        (json.dumps(rounds), case_id),
    )
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "rounds": rounds, "total": len(rounds), "pick_n": pick_n})

@app.get("/api/case/<case_id>/round/<int:r_idx>")
def get_round(case_id, r_idx):
    conn = db()
    row = conn.execute("SELECT rounds_json FROM cases WHERE id = ?", (case_id,)).fetchone()
    conn.close()

    if not row:
        return jsonify({"ok": False}), 404

    rounds = json.loads(row["rounds_json"])
    if r_idx >= len(rounds):
        return jsonify({"ok": False, "msg": "Game over"}), 404

    r = rounds[r_idx]
    public_cards = [{"host": c["host"], "title": c["title"]} for c in r["cards"]]

    return jsonify({
        "ok": True,
        "total": len(rounds),
        "cards": public_cards
    })


@app.post("/api/case/<case_id>/guess")
def guess(case_id):
    data = request.get_json(silent=True) or {}
    r_idx = int(data.get("round") or 0)
    selection = int(data.get("selection") or 0)

    conn = db()
    row = conn.execute("SELECT rounds_json FROM cases WHERE id = ?", (case_id,)).fetchone()
    conn.close()

    if not row:
        return jsonify({"ok": False, "error": "Case not found"}), 404

    rounds = json.loads(row["rounds_json"])
    if r_idx >= len(rounds):
        return jsonify({"ok": False, "error": "Round out of range"}), 400
    current_round = rounds[r_idx]

    lie_index = current_round["lie_index"]
    is_correct = (selection == lie_index)

    return jsonify({
        "ok": True,
        "correct": is_correct,
        "lie_index": lie_index
    })


if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=5000, debug=True)
