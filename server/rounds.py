# rounds.py
#
# Party-game round generation for Search History Court.
# - make_rounds(): deterministic-ish local generator (fallback)
# - make_rounds_ai(): LLM-backed generator with JSON-Schema structured outputs + strict validation
#
# Assumes your project provides:
#   tagging.py: TAG_DEFS, TAG_LOOKUP, detect_tag(host,title), canonical_host(host)
#   utils.py:   utc_now_iso()
#
# Notes:
# - Tries Structured Outputs (response_format: json_schema) first; falls back to json_object if the provider/model
#   doesn't support json_schema.
# - Normalization/validation is intentionally strict: truths must come from the provided REAL_ITEMS pool.

from __future__ import annotations

import json
import random
import re
from dataclasses import dataclass
from os import getenv
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from openai import OpenAI

from tagging import TAG_DEFS, TAG_LOOKUP, detect_tag, canonical_host
from utils import utc_now_iso


# -----------------------------
# AI Generation data (fallback lie ideas)
# -----------------------------
FAKE_TITLES: List[Tuple[str, str]] = [
    ("how to get away with murder", "wikihow.com"),
    ("is it illegal to keep a squirrel", "reddit.com"),
    ("download more ram free", "softonic.com"),
    ("why do my feet smell like cheese", "webmd.com"),
    ("nickelback fan club", "geocities.com"),
    ("flat earth society membership", "flatearth.org"),
    ("how to bribe a judge", "legalzoom.com"),
    ("am I a robot test", "captcha.net"),
    ("DIY surgery kits", "amazon.com"),
    ("hot singles in your area", "dating.com"),
    ("how to delete browser history permanently", "google.com"),
    ("pretend to work screen", "github.com"),
]

GENERIC_TITLE_PATTERNS: List[str] = [
    r"^new tab$",
    r"^home$",
    r"^homepage$",
    r"sign in",
    r"log in",
    r"login",
    r"account",
    r"verify",
    r"security",
    r"welcome",
    r"index of",
]

KEEP_HOST_ALLOWLIST = {
    "google.com",
    "www.google.com",
    "youtube.com",
    "www.youtube.com",
    "github.com",
    "www.github.com",
    "reddit.com",
    "www.reddit.com",
    "wikipedia.org",
    "en.wikipedia.org",
}


# -----------------------------
# Helpers: titles / scoring
# -----------------------------
def is_generic_title(title: str) -> bool:
    if not title:
        return True
    t = title.strip().lower()
    if len(t) <= 3:
        return True
    for pat in GENERIC_TITLE_PATTERNS:
        if re.search(pat, t):
            return True
    return False


def clean_title_v2(title: str) -> str:
    """Stronger cleaner used for candidate selection + canonicalization."""
    if not title:
        return "Untitled"
    title = title.strip()

    # Remove trailing site decorations like " - YouTube" or " • Something"
    title = re.sub(r"\s[-|\u2022]\s.*$", "", title).strip()

    # Collapse whitespace
    title = re.sub(r"\s+", " ", title).strip()

    if len(title) > 90:
        title = title[:87] + "..."
    return title or "Untitled"


def clean_title(title: str) -> str:
    """Legacy short cleaner used by the fallback generator."""
    if not title:
        return "Untitled Page"
    title = re.sub(r"\s-.*", "", title).strip()
    title = re.sub(r"\s+", " ", title).strip()
    return title[:65] + "..." if len(title) > 65 else (title or "Untitled Page")


def build_host_stats(items: Sequence[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    stats: Dict[str, Dict[str, Any]] = {}
    for it in items:
        host = it.get("host")
        title = (it.get("title") or "").strip()
        if not host:
            continue
        s = stats.setdefault(host, {"n": 0, "titles": set()})
        s["n"] += 1
        if title:
            s["titles"].add(title.lower())

    for host, s in stats.items():
        uniq = len(s["titles"])
        s["uniq_titles"] = uniq
        s["variety"] = uniq / max(1, s["n"])
        del s["titles"]
    return stats


def score_item(it: Dict[str, Any], host_stats: Dict[str, Dict[str, Any]]) -> float:
    host = it.get("host")
    title = it.get("title") or ""
    if not host or not title:
        return -999.0

    if is_generic_title(title):
        return -50.0

    hs = host_stats.get(host, {"n": 1, "variety": 1.0})
    freq = float(hs.get("n", 1))
    variety = float(hs.get("variety", 1.0))

    words = re.findall(r"[a-zA-Z0-9]{3,}", title.lower())
    specificity = min(len(words), 12)

    score = 0.0
    score += specificity * 2.0
    score += min(int(it.get("visitCount") or 1), 20) * 0.2

    if host not in KEEP_HOST_ALLOWLIST:
        score += variety * 6.0
        score -= min(freq, 500.0) * 0.02
    else:
        score += variety * 2.0

    return float(score)


def select_candidates(
    history: Sequence[Dict[str, Any]],
    max_history: int = 2000,
    max_candidates: int = 700,
    allowed_tags: Optional[Sequence[str]] = None,
) -> List[Dict[str, Any]]:
    allowed_set = set(allowed_tags or [])
    items: List[Dict[str, Any]] = []

    for h in (history or [])[:max_history]:
        if not isinstance(h, dict):
            continue
        host = canonical_host(h.get("host"))
        title = clean_title_v2(h.get("title") or "")
        if not host or not title:
            continue

        tag = detect_tag(host, title)
        if allowed_set and tag not in allowed_set:
            continue

        items.append(
            {
                "host": host,
                "title": title,
                "lastVisitTime": h.get("lastVisitTime"),
                "visitCount": int(h.get("visitCount") or 1),
                "tag": tag,
            }
        )

    if not items:
        return []

    host_stats = build_host_stats(items)

    scored: List[Tuple[float, Dict[str, Any]]] = []
    for it in items:
        s = score_item(it, host_stats)
        if s > 0:
            scored.append((s, it))

    scored.sort(key=lambda x: x[0], reverse=True)

    per_host_cap = 3
    per_host_cap_allow = 8

    out: List[Dict[str, Any]] = []
    per_host: Dict[str, int] = {}
    seen: set[Tuple[str, str]] = set()

    for _, it in scored:
        key = (it["host"], it["title"].lower())
        if key in seen:
            continue
        seen.add(key)

        cap = per_host_cap_allow if it["host"] in KEEP_HOST_ALLOWLIST else per_host_cap
        if per_host.get(it["host"], 0) >= cap:
            continue

        hs = host_stats.get(it["host"], {"variety": 0.0})
        if it["host"] not in KEEP_HOST_ALLOWLIST and float(hs.get("variety", 0.0)) < 0.15:
            continue

        out.append(it)
        per_host[it["host"]] = per_host.get(it["host"], 0) + 1
        if len(out) >= max_candidates:
            break

    return out


# -----------------------------
# Structured Outputs (JSON Schema) builder
# -----------------------------
def build_rounds_json_schema(n_rounds: int, allowed_tags: Sequence[str], max_real_idx: int) -> Dict[str, Any]:
    """
    Build a JSON schema for:
      { "rounds": [ { topic, tag, lie_index, cards: [card,card,card] }, ... ] }

    Card must be ONE OF:
      - Truth reference: { "real_idx": int }
      - Explicit card (used for the lie): { "host": str, "title": str }

    We still validate correctness in normalize_ai_rounds() (e.g., which one is lie, tag consistency, etc.).
    """
    # Truth ref
    truth_ref = {
        "type": "object",
        "additionalProperties": False,
        "required": ["real_idx"],
        "properties": {
            "real_idx": {"type": "integer", "minimum": 0, "maximum": max_real_idx},
        },
    }

    # Explicit card (lie)
    explicit_card = {
        "type": "object",
        "additionalProperties": False,
        "required": ["host", "title"],
        "properties": {
            "host": {"type": "string", "minLength": 1},
            "title": {"type": "string", "minLength": 1},
            # allow optional tag/topic hints but we'll re-check; keep schema permissive but still structured
            "tag": {"type": "string"},
            "topic": {"type": "string"},
        },
    }

    one_card = {"oneOf": [truth_ref, explicit_card]}

    one_round = {
        "type": "object",
        "additionalProperties": False,
        "required": ["cards", "lie_index", "topic", "tag"],
        "properties": {
            "topic": {"type": "string"},
            "tag": {"type": "string", "enum": list(allowed_tags)},
            "cards": {
                "type": "array",
                "minItems": 3,
                "maxItems": 3,
                "items": one_card,
            },
            "lie_index": {"type": "integer", "minimum": 0, "maximum": 2},
        },
    }

    schema = {
        "type": "object",
        "additionalProperties": False,
        "required": ["rounds"],
        "properties": {
            "rounds": {
                "type": "array",
                "minItems": n_rounds,
                "maxItems": n_rounds,
                "items": one_round,
            }
        },
    }
    return schema


# -----------------------------
# Normalization + strict validation
# -----------------------------
def normalize_ai_rounds(data, compact_real_set, real_lookup, allowed_tags=None, real_items_by_idx=None):
    rounds = None
    if isinstance(data, dict) and isinstance(data.get("rounds"), list):
        rounds = data["rounds"]
    elif isinstance(data, list):
        rounds = data
    else:
        raise ValueError("AI output must be dict with rounds[] or a list of rounds")

    allowed_set = set(allowed_tags or [t["id"] for t in TAG_DEFS])
    real_items_by_idx = real_items_by_idx or {}

    def _infer_lie_index(cards, idx):
        # 1) explicit lie flags
        flags = []
        for c in cards:
            if not isinstance(c, dict):
                flags.append(False)
            else:
                flags.append(bool(c.get("lie", c.get("is_lie", False))))
        if flags.count(True) == 1:
            return flags.index(True)

        # 2) exactly one card missing real_idx/idx
        real_idx_flags = []
        for c in cards:
            if not isinstance(c, dict):
                real_idx_flags.append(None)
            else:
                real_idx_flags.append(c.get("real_idx", c.get("idx")))
        missing_real_idx = [i for i, val in enumerate(real_idx_flags) if val in (None, "", [])]
        provided_real_idx = [i for i, val in enumerate(real_idx_flags) if val not in (None, "", [])]
        if len(missing_real_idx) == 1 and len(provided_real_idx) >= 2:
            return missing_real_idx[0]

        # 3) membership test: exactly one not in real pool
        in_real = []
        for c in cards:
            if not isinstance(c, dict):
                in_real.append(True)  # don't accidentally select non-dict as lie
                continue
            host = canonical_host(c.get("host")) if c.get("host") else ""
            title = clean_title_v2(c.get("title") or "")
            if host and title:
                in_real.append((host, title) in compact_real_set)
            else:
                # if it has no host/title, we can't use membership; treat as "in real" to avoid guessing wrong
                in_real.append(True)
        if in_real.count(False) == 1:
            return in_real.index(False)

        raise ValueError(f"Round {idx}: could not infer lie_index (missing/ambiguous)")

    def norm_one_round(r, idx):
        round_tag = None
        cards = None
        lie_index = None

        if isinstance(r, dict):
            round_tag = r.get("tag") or r.get("topic")
            cards = r.get("cards")
            lie_index = r.get("lie_index", None)
        elif isinstance(r, list):
            cards = r
        else:
            raise ValueError(f"Round {idx}: invalid type {type(r)}")

        if not isinstance(cards, list) or len(cards) != 3:
            raise ValueError(f"Round {idx}: cards must be a list of length 3")

        # Infer lie_index if missing/None
        if lie_index is None:
            lie_index = _infer_lie_index(cards, idx)

        if not isinstance(lie_index, int) or not (0 <= lie_index <= 2):
            raise ValueError(f"Round {idx}: invalid lie_index {lie_index}")

        norm_cards = []
        for i, c in enumerate(cards):
            if not isinstance(c, dict):
                raise ValueError(f"Round {idx}: card {i} must be object")

            real_idx = c.get("real_idx", c.get("idx"))
            host = canonical_host(c.get("host")) if c.get("host") else ""
            title = clean_title_v2(c.get("title") or "")
            tag_hint = c.get("tag") or c.get("topic")

            # If real_idx provided, treat as truth reference
            if real_idx is not None:
                try:
                    real_idx = int(real_idx)
                except Exception:
                    raise ValueError(f"Round {idx}: card {i} real_idx not int")
                real_item = real_items_by_idx.get(real_idx)
                if not real_item:
                    raise ValueError(f"Round {idx}: card {i} real_idx {real_idx} invalid")
                if i == lie_index:
                    raise ValueError(f"Round {idx}: lie card {i} must not reference real_idx")
                host = real_item["host"]
                title = real_item["title"]
                tag_hint = real_item.get("tag")

            else:
                # No real_idx: must include host/title (lie OR explicit truth)
                if not host or not title:
                    raise ValueError(f"Round {idx}: card {i} missing host/title")

            pair = (host, title)
            expected_tag = real_lookup.get(pair)
            card_tag = tag_hint or expected_tag or detect_tag(host, title)

            norm_cards.append({
                "host": host,
                "title": title,
                "is_lie": (i == lie_index),
                "tag": card_tag,
                "real_idx": real_idx if (real_idx is not None and i != lie_index) else None,
            })
            if round_tag is None:
                round_tag = card_tag

        # Validate lie vs truth membership
        for i, c in enumerate(norm_cards):
            pair = (c["host"], c["title"])
            if i == lie_index:
                if pair in compact_real_set:
                    raise ValueError(f"Round {idx}: lie matches real item")
                if c.get("real_idx") is not None:
                    raise ValueError(f"Round {idx}: lie card has real_idx")
            else:
                # truth must be in pool OR be a real_idx reference (already resolved above)
                if pair not in compact_real_set and c.get("real_idx") is None:
                    raise ValueError(f"Round {idx}: truth not in real pool: {pair}")
                expected_tag = real_lookup.get(pair)
                if expected_tag and c["tag"] != expected_tag:
                    raise ValueError(f"Round {idx}: truth tag mismatch {c['tag']} vs expected {expected_tag}")

        # Round/tag coherence
        if not round_tag:
            raise ValueError(f"Round {idx}: missing tag")
        if allowed_set and round_tag not in allowed_set:
            raise ValueError(f"Round {idx}: tag {round_tag} not in allowed set")
        if round_tag not in TAG_LOOKUP:
            raise ValueError(f"Round {idx}: unknown tag {round_tag}")

        for c in norm_cards:
            if c["tag"] != round_tag:
                raise ValueError(f"Round {idx}: card tag {c['tag']} != round tag {round_tag}")

        return {"topic": round_tag, "tag": round_tag, "cards": norm_cards, "lie_index": lie_index}

    normalized = []
    for idx, r in enumerate(rounds):
        normalized.append(norm_one_round(r, idx))

    return normalized


# -----------------------------
# Logging
# -----------------------------
def log_ai_run(
    meta: Optional[Dict[str, Any]],
    request_payload: Any,
    raw_response: Any,
    normalized: Optional[Any],
    error: Optional[Exception] = None,
) -> None:
    entry = {
        "ts": utc_now_iso(),
        "meta": meta or {},
        "request": request_payload,
        "response_raw": raw_response,
        "normalized": normalized,
        "error": str(error) if error else None,
    }
    try:
        with open("ai_rounds_log.jsonl", "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception:
        pass


# -----------------------------
# LLM-backed round generation
# -----------------------------
def make_rounds_ai(
    history: Sequence[Dict[str, Any]],
    n_rounds: int = 10,
    seed: Optional[str] = None,
    allowed_tags: Optional[Sequence[str]] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    """
    LLM-backed round generation with Structured Outputs (json_schema + strict=true).

    Key robustness changes vs earlier versions:
    - Schema uses oneOf per card: truth is ONLY {"real_idx": int}, lie is ONLY {"host","title"}.
      This prevents empty cards and prevents lie cards from including real_idx at all.
    - Server forcibly sets / validates tag coherency, and when allowed_tags has a single tag
      we hard-fix the round tag to that tag (no more "shopping_misc != social" failures).
    - If a provider silently ignores json_schema, normalization still catches issues and we
      do a one-shot "repair" retry before falling back.
    """
    allowed_tags = list(allowed_tags or [t["id"] for t in TAG_DEFS])

    # Candidate selection
    candidates = select_candidates(
        history,
        max_history=500,
        max_candidates=150,
        allowed_tags=allowed_tags,
    )

    print(f"AI round generation: {len(candidates)} candidates from {len(history)} history items")
    try:
        with open("candidates_debug.json", "w", encoding="utf-8") as f:
            json.dump(candidates, f, indent=2, ensure_ascii=False)
    except Exception:
        pass

    if len(candidates) < max(10, n_rounds * 2):
        return make_rounds(history, n_rounds=n_rounds, seed=seed, allowed_tags=allowed_tags)

    # Compact pool
    compact: List[Dict[str, Any]] = []
    real_lookup: Dict[Tuple[str, str], str] = {}
    real_items_by_idx: Dict[int, Dict[str, Any]] = {}

    for idx, c in enumerate(candidates):
        host = canonical_host(c["host"])
        title = clean_title_v2(c["title"])
        tag = c.get("tag") or detect_tag(host, title)
        item = {"id": idx, "host": host, "title": title, "tag": tag}
        compact.append(item)
        real_lookup[(host, title)] = tag
        real_items_by_idx[idx] = item

    real_set = {(x["host"], x["title"]) for x in compact}

    # Structured schema: oneOf cards (truth ref OR explicit lie)
    schema = build_rounds_json_schema(
        n_rounds=n_rounds,
        allowed_tags=allowed_tags,
        max_real_idx=max(0, len(compact) - 1),
    )

    client = OpenAI(
        base_url=getenv("OPENAI_BASE_URL", "https://openrouter.ai/api/v1"),
        api_key=getenv("OPENROUTER_API_KEY") or getenv("OPENAI_API_KEY"),
    )

    # If only one tag is allowed (very common), force it as the only valid topic.
    forced_tag: Optional[str] = allowed_tags[0] if len(allowed_tags) == 1 else None

    system = (
        "You generate party-game rounds for 'Search History Court'. "
        "Each round has 3 cards. Exactly 1 is the lie.\n\n"
        "HARD RULES:\n"
        "1) Two truth cards MUST be chosen from REAL_ITEMS using ONLY {\"real_idx\": <int>}.\n"
        "2) The lie card MUST be provided as ONLY {\"host\": <string>, \"title\": <string>} and MUST NOT include real_idx.\n"
        # "3) The lie MUST NOT match any (host,title) pair in REAL_ITEMS.\n"
        "4) Avoid generic titles (login/home/new tab) and avoid repeating the same host too much.\n"
        "5) Every round MUST declare a tag from selected_tags, and all 3 cards must belong to that same tag.\n"
        "6) Both truth cards must come from REAL_ITEMS with that same tag.\n"
        "7) Use canonical hosts (no leading www).\n"
        "8) Output ONLY JSON matching the schema.\n"
        "9) Make it spicy and tease-able: quirky/absurd/specific/embarrassing/incriminating.\n"
    )

    user = {
        "n_rounds": n_rounds,
        "seed": seed or "",
        "REAL_ITEMS": compact,
        "selected_tags": allowed_tags,
        "tag_definitions": TAG_DEFS,
        "forced_tag": forced_tag or "",
        "note": (
            "If forced_tag is non-empty, every round MUST use that tag for both topic and tag fields."
        ),
    }

    request_payload = {
        "allowed_tags": allowed_tags,
        "n_rounds": n_rounds,
        "seed": seed,
        "REAL_ITEMS_len": len(compact),
    }

    def _call_structured(prompt_user: Dict[str, Any]) -> Tuple[Dict[str, Any], str]:
        resp = client.chat.completions.create(
            model=getenv("ROUND_MODEL", "gpt-5"),
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": json.dumps(prompt_user, ensure_ascii=False)},
                {"role": "user", "content": "Return ONLY valid JSON."},
            ],
            temperature=0.35,
            response_format={
                "type": "json_schema",
                "json_schema": {
                    "name": "historycourt_rounds",
                    "strict": True,
                    "schema": schema,
                },
            },
        )
        raw = resp.choices[0].message.content or ""
        return json.loads(raw or "{}"), raw

    def _call_json_mode(prompt_user: Dict[str, Any]) -> Tuple[Dict[str, Any], str]:
        resp = client.chat.completions.create(
            model=getenv("ROUND_MODEL", "gpt-5"),
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": json.dumps(prompt_user, ensure_ascii=False)},
                {"role": "user", "content": "Return ONLY valid JSON of the form {\"rounds\": [...]}."},
            ],
            temperature=0.35,
            response_format={"type": "json_object"},
        )
        raw = resp.choices[0].message.content or ""
        return json.loads(raw or "{}"), raw

    def _force_single_tag(parsed_obj: Dict[str, Any]) -> Dict[str, Any]:
        """
        If only one tag was allowed, hard-force tag/topic for every round.
        This prevents provider/model tag drift from killing normalization.
        """
        if not forced_tag:
            return parsed_obj
        if not isinstance(parsed_obj, dict) or "rounds" not in parsed_obj:
            return parsed_obj
        if not isinstance(parsed_obj.get("rounds"), list):
            return parsed_obj
        for r in parsed_obj["rounds"]:
            if isinstance(r, dict):
                r["tag"] = forced_tag
                r["topic"] = forced_tag
                # Don't touch cards here; normalize_ai_rounds will compute tags per card.
        return parsed_obj

    used_schema = True
    parsed: Dict[str, Any] = {}
    raw_content: str = ""

    # 1) Try structured outputs
    try:
        parsed, raw_content = _call_structured(user)
        parsed = _force_single_tag(parsed)
    except Exception as e:
        used_schema = False
        # 2) Fallback: JSON mode only (still often ok)
        try:
            parsed, raw_content = _call_json_mode(user)
            parsed = _force_single_tag(parsed)
        except Exception as e2:
            log_ai_run(meta or {}, {**request_payload, "structured_outputs": used_schema}, raw_content, None, e2)
            raise

    # 3) Normalize + strict validate (+ one-shot repair retry)
    try:
        normalized_rounds = normalize_ai_rounds(
            parsed,
            real_set,
            real_lookup,
            allowed_tags=allowed_tags,
            real_items_by_idx=real_items_by_idx,
        )
        log_ai_run(
            meta or {},
            {**request_payload, "structured_outputs": used_schema},
            parsed,
            normalized_rounds,
            None,
        )
        return normalized_rounds

    except Exception as e:
        # One-shot "repair" attempt: feed error + last output
        try:
            repair_user = dict(user)
            repair_user["previous_output"] = parsed
            repair_user["validation_error"] = str(e)
            repair_user["instructions"] = (
                "Fix the JSON so it passes validation.\n"
                "- Keep the same schema.\n"
                "- Exactly TWO cards per round must be {\"real_idx\": int}.\n"
                "- Exactly ONE card per round must be {\"host\":..., \"title\":...} and that is the lie.\n"
                "- Ensure lie_index points to the explicit host/title card.\n"
                "- Ensure the round tag/topic is in selected_tags.\n"
                "- Do not invent real_idx that aren't in range.\n"
                "Return ONLY corrected JSON."
            )

            if used_schema:
                repaired, _ = _call_structured(repair_user)
            else:
                repaired, _ = _call_json_mode(repair_user)

            repaired = _force_single_tag(repaired)

            normalized_rounds = normalize_ai_rounds(
                repaired,
                real_set,
                real_lookup,
                allowed_tags=allowed_tags,
                real_items_by_idx=real_items_by_idx,
            )
            log_ai_run(
                meta or {},
                {**request_payload, "structured_outputs": used_schema, "repair": True},
                repaired,
                normalized_rounds,
                None,
            )
            return normalized_rounds

        except Exception as e2:
            log_ai_run(
                meta or {},
                {**request_payload, "structured_outputs": used_schema, "repair": True},
                parsed,
                None,
                e,
            )
            # If AI path fails, fall back to deterministic generator
            return make_rounds(history, n_rounds=n_rounds, seed=seed, allowed_tags=allowed_tags)


# -----------------------------
# Local fallback generator
# -----------------------------
def make_rounds(
    history: Sequence[Dict[str, Any]],
    n_rounds: int = 10,
    seed: Optional[str] = None,
    allowed_tags: Optional[Sequence[str]] = None,
) -> List[Dict[str, Any]]:
    rng = random.Random(seed) if seed else random.Random()

    allowed_tags = list(allowed_tags or [t["id"] for t in TAG_DEFS])

    valid_items: List[Dict[str, Any]] = []
    for h in history or []:
        if not isinstance(h, dict):
            continue
        if not h.get("host") or not h.get("title"):
            continue
        host = canonical_host(h.get("host"))
        title = clean_title_v2(h.get("title") or "")
        tag = detect_tag(host, title)
        if tag not in allowed_tags:
            continue
        if is_generic_title(title):
            continue
        valid_items.append({"host": host, "title": title, "tag": tag})

    if len(valid_items) < (n_rounds * 2):
        # Minimal fallback when no usable history exists
        filler_tag = allowed_tags[0] if allowed_tags else "shopping_misc"
        valid_items = [{"host": "example.com", "title": "User has no history", "tag": filler_tag}] * max(
            30, n_rounds * 3
        )

    tag_buckets: Dict[str, List[Dict[str, Any]]] = {}
    for item in valid_items:
        tag_buckets.setdefault(item["tag"], []).append(item)
    for bucket in tag_buckets.values():
        rng.shuffle(bucket)

    rounds: List[Dict[str, Any]] = []
    tag_keys = [t for t, items in tag_buckets.items() if len(items) >= 2]
    if not tag_keys:
        tag_keys = list(tag_buckets.keys()) or (allowed_tags or ["shopping_misc"])

    for _ in range(n_rounds):
        tag = rng.choice(tag_keys)
        bucket = tag_buckets.get(tag, [])
        if len(bucket) < 2:
            pool = [it for it in valid_items if it["tag"] == tag] or valid_items
            while len(bucket) < 2:
                bucket.append(rng.choice(pool))

        truth1 = bucket.pop() if bucket else {"host": "?", "title": "?", "tag": tag}
        truth2 = bucket.pop() if bucket else {"host": "?", "title": "?", "tag": tag}

        fake_text, fake_host = rng.choice(FAKE_TITLES)

        # Sometimes make the lie mimic a real host (but not a real title)
        if rng.random() > 0.5 and bucket:
            random_real_host = rng.choice(bucket)["host"]
            fake_host = random_real_host
            fake_text = "How to erase " + random_real_host + " logs"

        lie = {"host": canonical_host(fake_host), "title": clean_title_v2(fake_text), "is_lie": True, "tag": tag}

        cards = [
            {"host": truth1["host"], "title": truth1["title"], "is_lie": False, "tag": tag},
            {"host": truth2["host"], "title": truth2["title"], "is_lie": False, "tag": tag},
            lie,
        ]
        rng.shuffle(cards)

        lie_index = next(i for i, card in enumerate(cards) if card["is_lie"])

        rounds.append({"cards": cards, "lie_index": lie_index, "topic": tag, "tag": tag})

    return rounds


# -----------------------------
# Curator schema + normalization
# -----------------------------
def build_curator_json_schema(max_pick: int) -> Dict[str, Any]:
    """
    Output:
      { "picks": [ { "idx": int, "reason": str }, ... ] }

    idx refers to RAW_HISTORY_ITEMS list index (0..len(raw)-1).
    """
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["picks"],
        "properties": {
            "picks": {
                "type": "array",
                "minItems": min(50, max_pick),  # allow fewer if history is small/boring
                "maxItems": max_pick,
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["idx"],
                    "properties": {
                        "idx": {"type": "integer", "minimum": 0},
                        "reason": {"type": "string"},
                    },
                },
            }
        },
    }


def normalize_curator_picks(
    data: Any,
    raw_items: Sequence[Dict[str, Any]],
    allowed_tags: Optional[Sequence[str]] = None,
    max_pick: int = 300,
) -> List[Dict[str, Any]]:
    """
    Returns curated REAL_ITEMS list: [{id, host, title, tag}, ...]
    """
    if not isinstance(data, dict) or not isinstance(data.get("picks"), list):
        raise ValueError("Curator output must be object with picks[]")

    allowed_set = set(allowed_tags or [t["id"] for t in TAG_DEFS])

    seen_pairs: set[Tuple[str, str]] = set()
    curated: List[Dict[str, Any]] = []

    for entry in data["picks"]:
        if not isinstance(entry, dict) or "idx" not in entry:
            continue
        try:
            idx = int(entry["idx"])
        except Exception:
            continue
        if idx < 0 or idx >= len(raw_items):
            continue

        h = raw_items[idx]
        if not isinstance(h, dict):
            continue

        host = canonical_host(h.get("host"))
        title = clean_title_v2(h.get("title") or "")
        if not host or not title:
            continue

        if is_generic_title(title):
            continue

        tag = detect_tag(host, title)
        if allowed_set and tag not in allowed_set:
            continue

        pair = (host, title)
        if pair in seen_pairs:
            continue
        seen_pairs.add(pair)

        curated.append({"id": len(curated), "host": host, "title": title, "tag": tag})
        if len(curated) >= max_pick:
            break

    if len(curated) < 20:
        raise ValueError(f"Curator produced too few usable items: {len(curated)}")

    return curated


# -----------------------------
# Stage 1: Curator AI
# -----------------------------
def curate_history_ai(
    history: Sequence[Dict[str, Any]],
    pick_n: int = 300,
    seed: Optional[str] = None,
    allowed_tags: Optional[Sequence[str]] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    """
    Feed up to ~1000 raw history items, return curated REAL_ITEMS (~pick_n),
    deduped + interesting.
    """
    allowed_tags = list(allowed_tags or [t["id"] for t in TAG_DEFS])
    forced_tag: Optional[str] = allowed_tags[0] if len(allowed_tags) == 1 else None

    # Take a big window (stage 1’s job is to pick)
    raw: List[Dict[str, Any]] = []
    for h in (history or [])[:1000]:
        if not isinstance(h, dict):
            continue
        host = canonical_host(h.get("host"))
        title = clean_title_v2(h.get("title") or "")
        if not host or not title:
            continue
        raw.append(
            {
                "host": host,
                "title": title,
                "visitCount": int(h.get("visitCount") or 1),
                "lastVisitTime": h.get("lastVisitTime"),
            }
        )

    if len(raw) < 50:
        # too little data, fall back to heuristic candidates
        cands = select_candidates(history, max_history=1000, max_candidates=pick_n, allowed_tags=allowed_tags)
        # convert to REAL_ITEMS format
        out = []
        seen = set()
        for it in cands:
            host = canonical_host(it["host"])
            title = clean_title_v2(it["title"])
            tag = it.get("tag") or detect_tag(host, title)
            pair = (host, title)
            if pair in seen:
                continue
            seen.add(pair)
            out.append({"id": len(out), "host": host, "title": title, "tag": tag})
            if len(out) >= pick_n:
                break
        return out

    schema = build_curator_json_schema(max_pick=pick_n)

    client = OpenAI(
        base_url=getenv("OPENAI_BASE_URL", "https://openrouter.ai/api/v1"),
        api_key=getenv("OPENROUTER_API_KEY") or getenv("OPENAI_API_KEY"),
    )

    system = (
        "You are a curator for a party game called 'Search History Court'.\n"
        "You will be given RAW_HISTORY_ITEMS (host/title/visitCount/etc.).\n"
        "Your job: pick the MOST interesting, specific, tease-able entries.\n\n"
        "RULES:\n"
        "- Return ONLY JSON matching the schema.\n"
        "- Select up to pick_n items by their index in RAW_HISTORY_ITEMS.\n"
        "- Prioritize weird/specific/quirky/embarrassing/incriminating titles over generic pages.\n"
        "- Prefer diversity across hosts (don’t pick 100 twitter pages).\n"
        "- Avoid generic titles: login, home, index, new tab, security checks.\n"
        "- If selected_tags is provided, prefer items that fit those tags.\n"
        "- Do NOT invent new hosts/titles; ONLY pick indices.\n"
        "- If forced_tag is set, only pick items that fit that tag.\n"
    )

    user = {
        "pick_n": pick_n,
        "seed": seed or "",
        "selected_tags": allowed_tags,
        "forced_tag": forced_tag or "",
        "tag_definitions": TAG_DEFS,
        "RAW_HISTORY_ITEMS": raw,
    }

    request_payload = {
        "stage": "curator",
        "pick_n": pick_n,
        "seed": seed,
        "RAW_len": len(raw),
        "allowed_tags": allowed_tags,
    }

    used_schema = True
    raw_content: str = ""
    parsed: Any = None

    try:
        resp = client.chat.completions.create(
            model=getenv("CURATOR_MODEL", getenv("ROUND_MODEL", "gpt-5")),
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": json.dumps(user, ensure_ascii=False)},
                {"role": "user", "content": "Return ONLY valid JSON."},
            ],
            temperature=0.2,
            response_format={
                "type": "json_schema",
                "json_schema": {"name": "historycourt_curator", "strict": True, "schema": schema},
            },
        )
        raw_content = resp.choices[0].message.content or ""
        parsed = json.loads(raw_content or "{}")
    except Exception:
        used_schema = False
        # fallback JSON mode
        resp = client.chat.completions.create(
            model=getenv("CURATOR_MODEL", getenv("ROUND_MODEL", "gpt-5")),
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": json.dumps(user, ensure_ascii=False)},
                {"role": "user", "content": "Return ONLY valid JSON of the form {\"picks\": [...]}."},
            ],
            temperature=0.2,
            response_format={"type": "json_object"},
        )
        raw_content = resp.choices[0].message.content or ""
        parsed = json.loads(raw_content or "{}")

    try:
        curated = normalize_curator_picks(parsed, raw, allowed_tags=allowed_tags, max_pick=pick_n)

        log_ai_run(
            meta or {},
            {**request_payload, "structured_outputs": used_schema},
            parsed,
            {"curated_len": len(curated)},
            None,
        )
        return curated
    except Exception as e:
        log_ai_run(
            meta or {},
            {**request_payload, "structured_outputs": used_schema},
            parsed,
            None,
            e,
        )
        # fallback to heuristic selection
        cands = select_candidates(history, max_history=1000, max_candidates=pick_n, allowed_tags=allowed_tags)
        out = []
        seen = set()
        for it in cands:
            host = canonical_host(it["host"])
            title = clean_title_v2(it["title"])
            tag = it.get("tag") or detect_tag(host, title)
            pair = (host, title)
            if pair in seen:
                continue
            seen.add(pair)
            out.append({"id": len(out), "host": host, "title": title, "tag": tag})
            if len(out) >= pick_n:
                break
        return out


# -----------------------------
# Stage 2: rounds-from-curated
# -----------------------------
def make_rounds_ai_from_real_items(
    real_items: Sequence[Dict[str, Any]],
    n_rounds: int = 10,
    seed: Optional[str] = None,
    allowed_tags: Optional[Sequence[str]] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    """
    Same as make_rounds_ai(), but skips candidate selection.
    Expects real_items already in format: {id,host,title,tag}
    """
    allowed_tags = list(allowed_tags or [t["id"] for t in TAG_DEFS])

    compact: List[Dict[str, Any]] = []
    real_lookup: Dict[Tuple[str, str], str] = {}
    real_items_by_idx: Dict[int, Dict[str, Any]] = {}

    for idx, it in enumerate(real_items):
        host = canonical_host(it.get("host"))
        title = clean_title_v2(it.get("title") or "")
        if not host or not title:
            continue
        tag = it.get("tag") or detect_tag(host, title)
        item = {"id": idx, "host": host, "title": title, "tag": tag}
        compact.append(item)
        real_lookup[(host, title)] = tag
        real_items_by_idx[idx] = item

    if len(compact) < max(10, n_rounds * 2):
        # fallback local generator uses history; but we don't have history here
        # so synthesize rounds locally from this pool:
        rng = random.Random(seed) if seed else random.Random()
        tag_buckets: Dict[str, List[Dict[str, Any]]] = {}
        for item in compact:
            if item["tag"] in allowed_tags:
                tag_buckets.setdefault(item["tag"], []).append(item)
        for bucket in tag_buckets.values():
            rng.shuffle(bucket)

        rounds: List[Dict[str, Any]] = []
        tag_keys = [t for t, items in tag_buckets.items() if len(items) >= 2]
        if not tag_keys:
            tag_keys = list(tag_buckets.keys()) or (allowed_tags or ["shopping_misc"])

        for _ in range(n_rounds):
            tag = rng.choice(tag_keys)
            bucket = tag_buckets.get(tag, [])
            if len(bucket) < 2:
                bucket = (tag_buckets.get(tag, []) or compact[:]).copy()
                rng.shuffle(bucket)

            truth1 = bucket.pop()
            truth2 = bucket.pop() if bucket else truth1

            fake_text, fake_host = rng.choice(FAKE_TITLES)
            lie = {"host": canonical_host(fake_host), "title": clean_title_v2(fake_text), "is_lie": True, "tag": tag}
            cards = [
                {"host": truth1["host"], "title": truth1["title"], "is_lie": False, "tag": tag},
                {"host": truth2["host"], "title": truth2["title"], "is_lie": False, "tag": tag},
                lie,
            ]
            rng.shuffle(cards)
            lie_index = next(i for i, card in enumerate(cards) if card["is_lie"])
            rounds.append({"cards": cards, "lie_index": lie_index, "topic": tag, "tag": tag})
        return rounds

    real_set = {(x["host"], x["title"]) for x in compact}
    schema = build_rounds_json_schema(
        n_rounds=n_rounds,
        allowed_tags=allowed_tags,
        max_real_idx=max(0, len(compact) - 1),
    )

    client = OpenAI(
        base_url=getenv("OPENAI_BASE_URL", "https://openrouter.ai/api/v1"),
        api_key=getenv("OPENROUTER_API_KEY") or getenv("OPENAI_API_KEY"),
    )

    forced_tag: Optional[str] = allowed_tags[0] if len(allowed_tags) == 1 else None

    system = (
        "You generate party-game rounds for 'Search History Court'. "
        "Each round has 3 cards. Exactly 1 is the lie.\n\n"
        "HARD RULES:\n"
        "1) Two truth cards MUST be chosen from REAL_ITEMS using ONLY {\"real_idx\": <int>}.\n"
        "2) The lie card MUST be ONLY {\"host\":..., \"title\":...} and MUST NOT include real_idx.\n"
        "3) The lie MUST NOT match any (host,title) pair in REAL_ITEMS.\n"
        "4) Avoid generic titles (login/home/new tab).\n"
        "5) Each round MUST declare a tag from selected_tags and all 3 cards must share that tag.\n"
        "6) Both truth cards must come from REAL_ITEMS with that same tag.\n"
        "7) Output ONLY JSON matching the schema.\n"
        "8) Make it spicy and tease-able: quirky/absurd/specific/embarrassing/incriminating.\n"
    )

    user = {
        "n_rounds": n_rounds,
        "seed": seed or "",
        "REAL_ITEMS": compact,
        "selected_tags": allowed_tags,
        "tag_definitions": TAG_DEFS,
        "forced_tag": forced_tag or "",
    }

    request_payload = {
        "stage": "rounds",
        "allowed_tags": allowed_tags,
        "n_rounds": n_rounds,
        "seed": seed,
        "REAL_ITEMS_len": len(compact),
    }

    used_schema = True
    raw_content: str = ""
    parsed: Any = None

    def _force_single_tag(obj: Any) -> Any:
        if not forced_tag:
            return obj
        if not isinstance(obj, dict) or not isinstance(obj.get("rounds"), list):
            return obj
        for r in obj["rounds"]:
            if isinstance(r, dict):
                r["tag"] = forced_tag
                r["topic"] = forced_tag
        return obj

    try:
        resp = client.chat.completions.create(
            model=getenv("ROUND_MODEL", "gpt-5"),
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": json.dumps(user, ensure_ascii=False)},
                {"role": "user", "content": "Return ONLY valid JSON."},
            ],
            temperature=0.35,
            response_format={
                "type": "json_schema",
                "json_schema": {"name": "historycourt_rounds", "strict": True, "schema": schema},
            },
        )
        raw_content = resp.choices[0].message.content or ""
        parsed = json.loads(raw_content or "{}")
        parsed = _force_single_tag(parsed)
    except Exception:
        used_schema = False
        resp = client.chat.completions.create(
            model=getenv("ROUND_MODEL", "gpt-5"),
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": json.dumps(user, ensure_ascii=False)},
                {"role": "user", "content": "Return ONLY valid JSON of the form {\"rounds\": [...]}."},
            ],
            temperature=0.35,
            response_format={"type": "json_object"},
        )
        raw_content = resp.choices[0].message.content or ""
        parsed = json.loads(raw_content or "{}")
        parsed = _force_single_tag(parsed)

    try:
        normalized = normalize_ai_rounds(
            parsed,
            real_set,
            real_lookup,
            allowed_tags=allowed_tags,
            real_items_by_idx=real_items_by_idx,
        )
        log_ai_run(meta or {}, {**request_payload, "structured_outputs": used_schema}, parsed, normalized, None)
        return normalized
    except Exception as e:
        log_ai_run(meta or {}, {**request_payload, "structured_outputs": used_schema}, parsed, None, e)
        raise


# -----------------------------
# One-call convenience wrapper: curator -> rounds
# -----------------------------
def make_rounds_ai_two_stage(
    history: Sequence[Dict[str, Any]],
    n_rounds: int = 10,
    seed: Optional[str] = None,
    allowed_tags: Optional[Sequence[str]] = None,
    pick_n: int = 300,
    meta: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    curated = curate_history_ai(
        history,
        pick_n=pick_n,
        seed=seed,
        allowed_tags=allowed_tags,
        meta={**(meta or {}), "stage": "curator"},
    )
    return make_rounds_ai_from_real_items(
        curated,
        n_rounds=n_rounds,
        seed=seed,
        allowed_tags=allowed_tags,
        meta={**(meta or {}), "stage": "rounds"},
    )
