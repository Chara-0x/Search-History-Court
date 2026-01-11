import json
import os
import sqlite3

from flask import Flask, jsonify, render_template, request, send_from_directory
from flask_cors import CORS

from rounds import (
    make_rounds,
    make_rounds_ai_two_stage,
    make_roulette_rounds,
)
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
REACT_DIST = os.path.join(os.path.dirname(__file__), "static", "react")
REACT_INDEX = os.path.join(REACT_DIST, "index.html")

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

    # Multiplayer roulette games (whose history is this?)
    cur.execute("""
      CREATE TABLE IF NOT EXISTS roulette_games (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        rounds_json TEXT NOT NULL,
        players_json TEXT NOT NULL
      )
    """)

    # Multiplayer rooms (players join separately with their own history)
    cur.execute("""
      CREATE TABLE IF NOT EXISTS roulette_rooms (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        picks INTEGER NOT NULL DEFAULT 3,
        status TEXT NOT NULL DEFAULT 'open',
        game_id TEXT,
        started_at TEXT
      )
    """)
    cur.execute("""
      CREATE TABLE IF NOT EXISTS roulette_room_players (
        room_id TEXT NOT NULL,
        player_id TEXT NOT NULL,
        name TEXT NOT NULL,
        history_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (room_id, player_id),
        FOREIGN KEY(room_id) REFERENCES roulette_rooms(id)
      )
    """)
    conn.commit()
    conn.close()

# ============================================================
# Helpers
# ============================================================
def set_session_cookie(resp, session_id):
    """
    Attach the session cookie so the client/extension can pick it up
    even if local storage is cleared.
    """
    try:
        resp.set_cookie(
            "hc_session_id",
            session_id,
            max_age=30 * 24 * 60 * 60,  # 30 days
            secure=False,  # allow localhost/http; use env var later if needed
            httponly=False,  # must be readable by frontend JS
            samesite="Lax",
            path="/",
        )
    except Exception:
        pass
    return resp


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
def serve_react():
    if os.path.exists(REACT_INDEX):
        return send_from_directory(REACT_DIST, "index.html")
    return render_template("landing.html")


@app.get("/")
def index():
    return serve_react()


@app.get("/review")
def review():
    return serve_react()


@app.get("/me/<session_id>")
def me(session_id):
    return serve_react()

@app.get("/loading-game")
def loading_game():
    return serve_react()


@app.get("/roulette")
def roulette_home():
    return serve_react()


@app.get("/roulette/<game_id>")
def roulette_play(game_id):
    return serve_react()


@app.get("/roulette-room")
def roulette_room_home():
    return serve_react()


@app.get("/roulette-room/<room_id>")
def roulette_room_join_page(room_id):
    return serve_react()


@app.get("/portal")
def user_portal():
    return serve_react()


@app.get("/play/<case_id>")
def play(case_id):
    return serve_react()


@app.post("/api/upload-history")
def upload_history():
    data = request.get_json(silent=True) or {}
    history = data.get("history") if isinstance(data, dict) else None
    session_id = (data.get("session_id") or "").strip() if isinstance(data, dict) else ""

    if not history or not isinstance(history, list):
        return jsonify({"ok": False}), 400

    # Basic sanitize + tag inference before persisting
    cleaned = tag_history_items(history, max_history=5000)
    if not cleaned:
        cleaned = []

    conn = db()
    if session_id:
        row = conn.execute("SELECT id FROM sessions WHERE id = ?", (session_id,)).fetchone()
        if row:
            conn.execute(
                "UPDATE sessions SET history_json = ?, created_at = ? WHERE id = ?",
                (json.dumps(cleaned), utc_now_iso(), session_id),
            )
        else:
            conn.execute(
                "INSERT INTO sessions (id, created_at, history_json) VALUES (?, ?, ?)",
                (session_id, utc_now_iso(), json.dumps(cleaned)),
            )
    else:
        session_id = gen_id(14)
        conn.execute(
            "INSERT INTO sessions (id, created_at, history_json) VALUES (?, ?, ?)",
            (session_id, utc_now_iso(), json.dumps(cleaned)),
        )
    conn.commit()
    conn.close()
    resp = jsonify({"ok": True, "session_id": session_id, "total_in": len(history), "total_saved": len(cleaned)})
    return set_session_cookie(resp, session_id)


def _get_roulette_game(game_id):
    conn = db()
    row = conn.execute(
        "SELECT rounds_json, players_json FROM roulette_games WHERE id = ?",
        (game_id,),
    ).fetchone()
    if not row:
        conn.close()
        return None, None, None
    rounds = json.loads(row["rounds_json"] or "[]")
    players = json.loads(row["players_json"] or "[]")
    return conn, rounds, players


def _get_room(room_id):
    conn = db()
    room = conn.execute(
        "SELECT id, picks, status, game_id FROM roulette_rooms WHERE id = ?",
        (room_id,),
    ).fetchone()
    if not room:
        conn.close()
        return None, None, None
    players = conn.execute(
        "SELECT player_id, name, history_json FROM roulette_room_players WHERE room_id = ? ORDER BY created_at",
        (room_id,),
    ).fetchall()
    return conn, room, players


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


@app.post("/api/delete-user")
def delete_user():
    data = request.get_json(silent=True) or {}
    session_id = (data.get("session_id") or "").strip()
    if not session_id:
        return jsonify({"ok": False, "error": "session_id required"}), 400

    conn = db()
    conn.execute("DELETE FROM cases WHERE session_id = ?", (session_id,))
    conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
    conn.commit()
    conn.close()
    resp = jsonify({"ok": True})
    try:
        resp.delete_cookie("hc_session_id", path="/")
    except Exception:
        pass
    return resp


# -----------------------------
# Roulette rooms (players join individually)
# -----------------------------
@app.post("/api/roulette/room/create")
def roulette_room_create():
    data = request.get_json(silent=True) or {}
    picks = int(data.get("picks") or 3)
    picks = max(3, min(picks, 6))

    room_id = gen_id(8)
    conn = db()
    conn.execute(
        "INSERT INTO roulette_rooms (id, created_at, picks, status) VALUES (?, ?, ?, ?)",
        (room_id, utc_now_iso(), picks, "open"),
    )
    conn.commit()
    conn.close()

    join_url = f"{request.host_url.rstrip('/')}/roulette-room/{room_id}"
    return jsonify({"ok": True, "room_id": room_id, "picks": picks, "join_url": join_url})


@app.get("/api/roulette/room/<room_id>")
def roulette_room_status(room_id):
    conn, room, players = _get_room(room_id)
    if not room:
        return jsonify({"ok": False, "error": "Room not found"}), 404

    players_out = []
    for p in players or []:
        try:
            hist = json.loads(p["history_json"] or "[]")
        except Exception:
            hist = []
        players_out.append({
            "id": p["player_id"],
            "name": p["name"],
            "count": len(hist),
        })

    payload = {
        "ok": True,
        "room_id": room["id"],
        "picks": room["picks"],
        "status": room["status"],
        "players": players_out,
        "can_start": len(players_out) >= 2,
    }
    if room["game_id"]:
        play_url = f"{request.host_url.rstrip('/')}/roulette/{room['game_id']}"
        payload["game_id"] = room["game_id"]
        payload["play_url"] = play_url
    conn.close()
    return jsonify(payload)


@app.post("/api/roulette/room/<room_id>/join")
def roulette_room_join(room_id):
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "Player").strip()
    history = data.get("history") if isinstance(data, dict) else None

    if not history or not isinstance(history, list):
        return jsonify({"ok": False, "error": "history array required"}), 400

    conn, room, _players = _get_room(room_id)
    if not room:
        return jsonify({"ok": False, "error": "Room not found"}), 404
    if room["status"] != "open":
        conn.close()
        return jsonify({"ok": False, "error": "Room already started"}), 400

    cleaned = tag_history_items(history, max_history=4000)
    if not cleaned:
        conn.close()
        return jsonify({"ok": False, "error": "No usable history items"}), 400

    player_id = gen_id(6)
    conn.execute(
        "INSERT INTO roulette_room_players (room_id, player_id, name, history_json, created_at) VALUES (?, ?, ?, ?, ?)",
        (room_id, player_id, name or "Player", json.dumps(cleaned), utc_now_iso()),
    )
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "player_id": player_id, "name": name or "Player", "count": len(cleaned)})


@app.post("/api/roulette/room/<room_id>/start")
def roulette_room_start(room_id):
    conn, room, players = _get_room(room_id)
    if not room:
        return jsonify({"ok": False, "error": "Room not found"}), 404

    # If already started, return existing link
    if room["game_id"]:
        play_url = f"{request.host_url.rstrip('/')}/roulette/{room['game_id']}"
        conn.close()
        return jsonify({"ok": True, "game_id": room['game_id'], "play_url": play_url, "already_started": True})

    if room["status"] != "open":
        conn.close()
        return jsonify({"ok": False, "error": "Room closed"}), 400

    if not players or len(players) < 2:
        conn.close()
        return jsonify({"ok": False, "error": "Need at least 2 players"}), 400

    players_payload = []
    players_public = []
    for p in players:
        try:
            hist = json.loads(p["history_json"] or "[]")
        except Exception:
            hist = []
        players_payload.append({"id": p["player_id"], "name": p["name"], "history": hist})
        players_public.append({"id": p["player_id"], "name": p["name"]})

    game_id = gen_id(10)
    rounds = make_roulette_rounds(players_payload, picks_per_player=room["picks"], seed=room_id)

    conn.execute(
        "INSERT INTO roulette_games (id, created_at, rounds_json, players_json) VALUES (?, ?, ?, ?)",
        (game_id, utc_now_iso(), json.dumps(rounds), json.dumps(players_public)),
    )
    conn.execute(
        "UPDATE roulette_rooms SET status = 'started', game_id = ?, started_at = ? WHERE id = ?",
        (game_id, utc_now_iso(), room_id),
    )
    conn.commit()
    conn.close()

    play_url = f"{request.host_url.rstrip('/')}/roulette/{game_id}"
    return jsonify({"ok": True, "game_id": game_id, "play_url": play_url})


@app.post("/api/roulette/create")
def roulette_create():
    data = request.get_json(silent=True) or {}
    players_in = data.get("players") if isinstance(data, dict) else None
    picks = int(data.get("picks") or 3)
    picks = max(3, min(picks, 6))

    if not players_in or not isinstance(players_in, list):
        return jsonify({"ok": False, "error": "players list required"}), 400

    cleaned_players = []
    for idx, p in enumerate(players_in):
        if not isinstance(p, dict):
            continue
        history = p.get("history")
        if not history or not isinstance(history, list):
            continue
        cleaned_history = tag_history_items(history, max_history=4000)
        if not cleaned_history:
            continue
        player_id = p.get("id") or gen_id(6)
        name = (p.get("name") or f"Player {idx + 1}").strip() or f"Player {idx + 1}"
        cleaned_players.append({
            "id": player_id,
            "name": name,
            "history": cleaned_history,
        })

    if len(cleaned_players) < 2:
        return jsonify({"ok": False, "error": "Need at least 2 players with history"}), 400

    game_id = gen_id(10)
    rounds = make_roulette_rounds(cleaned_players, picks_per_player=picks, seed=game_id)
    players_public = [{"id": p["id"], "name": p["name"]} for p in cleaned_players]

    conn = db()
    conn.execute(
        "INSERT INTO roulette_games (id, created_at, rounds_json, players_json) VALUES (?, ?, ?, ?)",
        (game_id, utc_now_iso(), json.dumps(rounds), json.dumps(players_public)),
    )
    conn.commit()
    conn.close()

    play_url = f"{request.host_url.rstrip('/')}/roulette/{game_id}"
    return jsonify({
        "ok": True,
        "game_id": game_id,
        "play_url": play_url,
        "total_rounds": len(rounds),
        "players": players_public,
        "picks": picks,
    })


@app.get("/api/roulette/<game_id>/round/<int:r_idx>")
def roulette_round(game_id, r_idx):
    conn, rounds, players = _get_roulette_game(game_id)
    if rounds is None:
        return jsonify({"ok": False, "error": "Game not found"}), 404

    if r_idx < 0 or r_idx >= len(rounds):
        conn.close()
        return jsonify({"ok": False, "error": "Round out of range"}), 404

    r = rounds[r_idx]
    cards = [{"host": c["host"], "title": c["title"]} for c in r.get("cards", [])]
    conn.close()
    return jsonify({
        "ok": True,
        "round": r_idx,
        "total": len(rounds),
        "cards": cards,
        "player_choices": players,
    })


@app.post("/api/roulette/<game_id>/guess")
def roulette_guess(game_id):
    data = request.get_json(silent=True) or {}
    r_idx = int(data.get("round") or 0)
    player_id = data.get("player_id")

    conn, rounds, players = _get_roulette_game(game_id)
    if rounds is None:
        return jsonify({"ok": False, "error": "Game not found"}), 404

    if r_idx < 0 or r_idx >= len(rounds):
        conn.close()
        return jsonify({"ok": False, "error": "Round out of range"}), 400
    r = rounds[r_idx]
    correct_id = r.get("player_id")
    correct_name = r.get("player_name") or correct_id
    is_correct = (player_id == correct_id)
    conn.close()
    return jsonify({
        "ok": True,
        "correct": is_correct,
        "correct_player_id": correct_id,
        "correct_player_name": correct_name,
    })


@app.get("/api/type-map")
def type_map():
    """
    Expose host->type mapping so clients can classify locally.
    """
    return jsonify({
        "ok": True,
        "type_map": TYPE_MAP,
        "type_to_tag": TYPE_TO_TAG,
        "tag_defs": TAG_DEFS,
        "tag_min_count": TAG_MIN_COUNT,
    })


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
    app.run(host="0.0.0.0", port=80, debug=True)
