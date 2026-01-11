import csv
import json
import os
from os import getenv
import random
import re
import sqlite3
import string
from datetime import datetime, timezone
from urllib.parse import urlparse

from flask import Flask, jsonify, render_template, request
from flask_cors import CORS
from openai import OpenAI

# ============================================================
# App setup
# ============================================================
app = Flask(__name__, template_folder="templates", static_folder="static")
CORS(app, resources={r"/api/*": {"origins": "*"}})
app.config["JSON_SORT_KEYS"] = False

DB_PATH = os.environ.get("HISTORYCOURT_DB", "historycourt.db")
TYPE_MAP_PATH = getenv("TYPE_MAP_PATH", os.path.join(os.path.dirname(__file__), "types.csv"))

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

def gen_id(n=10):
    alphabet = string.ascii_lowercase + string.digits
    return "".join(random.choice(alphabet) for _ in range(n))

def utc_now_iso():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

def canonical_host(host: str) -> str:
    h = (host or "").strip().lower()
    if h.startswith("www."):
        h = h[4:]
    return h

def host_from_url(url: str) -> str:
    try:
        u = urlparse(url)
        return canonical_host(u.netloc or "")
    except Exception:
        return ""

# ============================================================
# Type map (host -> category type)
# ============================================================
def load_type_map(path=TYPE_MAP_PATH):
    mapping = {}
    if not path or not os.path.exists(path):
        return mapping
    try:
        with open(path, newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                host = canonical_host(row.get("url"))
                if not host:
                    continue
                mapping[host] = (row.get("type") or "").strip()
    except Exception as e:
        print(f"Failed to load type map from {path}: {e}")
        return {}
    print(f"Loaded {len(mapping)} host type entries from {path}")
    return mapping

TYPE_MAP = load_type_map()

def lookup_host_type(host: str):
    h = canonical_host(host)
    if not h:
        return None
    parts = h.split(".")
    candidates = [h]
    if len(parts) >= 3:
        root = ".".join(parts[-2:])
        candidates.append(root)
    for cand in candidates:
        if cand in TYPE_MAP:
            return TYPE_MAP[cand]
    return None

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
# 2 Truths 1 Lie Generation
# ============================================================
STOPWORDS = {
    "the", "and", "for", "with", "from", "that", "this", "you", "your", "are",
    "was", "how", "what", "why", "when", "where", "a", "an", "to", "of", "in",
    "on", "at", "as", "is", "it", "by", "or", "be", "vs", "login", "sign", "page"
}

FAKE_TITLES = [
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

# ============================================================
# Tagging (6 perspectives)
# ============================================================
TAG_MIN_COUNT = 30
TAG_DEFS = [
    {
        "id": "social",
        "label": "Social Media",
        "hosts": [
            "facebook.com", "instagram.com", "tiktok.com", "twitter.com", "x.com",
            "snapchat.com", "linkedin.com", "pinterest.com", "discord.com"
        ],
        "keywords": ["social", "profile", "followers", "feed"]
    },
    {
        "id": "search",
        "label": "Search / Research",
        "hosts": [
            "google.com", "bing.com", "duckduckgo.com", "brave.com", "wolframalpha.com"
        ],
        "keywords": ["search", "stackexchange", "how to", "why ", "what is"]
    },
    {
        "id": "school_work",
        "label": "School & Work",
        "hosts": [
            "docs.google.com", "drive.google.com", "notion.so", "office.com", "sharepoint.com",
            "zoom.us", "slack.com", "asana.com", "trello.com", "figma.com", "coursera.org",
            "udemy.com", "khanacademy.org", "canvas", "classroom.google.com"
        ],
        "keywords": ["assignment", "lecture", "slides", "syllabus", "project brief", "jira"]
    },
    {
        "id": "news",
        "label": "News & Current Events",
        "hosts": [
            "nytimes.com", "theguardian.com", "bbc.com", "cnn.com", "reuters.com",
            "washingtonpost.com", "bloomberg.com", "apnews.com", "aljazeera.com",
            "foxnews.com"
        ],
        "keywords": ["news", "election", "breaking", "headline", "politics"]
    },
    {
        "id": "entertainment",
        "label": "Entertainment / Streaming",
        "hosts": [
            "youtube.com", "netflix.com", "spotify.com", "twitch.tv", "disneyplus.com",
            "hulu.com", "hbomax.com", "soundcloud.com", "imdb.com", "letterboxd.com"
        ],
        "keywords": ["trailer", "episode", "playlist", "lyrics", "soundtrack", "movie", "series"]
    },
    {
        "id": "shopping_misc",
        "label": "Shopping & Wildcards",
        "hosts": [
            "amazon.com", "ebay.com", "etsy.com", "aliexpress.com", "bestbuy.com",
            "target.com", "walmart.com", "costco.com", "ikea.com", "craigslist.org"
        ],
        "keywords": ["deal", "coupon", "review", "price", "wishlist", "haul"]
    },
]
TAG_LOOKUP = {t["id"]: t for t in TAG_DEFS}

TYPE_TO_TAG = {
    "Social_Network": "social",
    "People_and_Society": "social",
    "Arts_and_Entertainment": "entertainment",
    "Games": "entertainment",
    "Sports": "entertainment",
    "Books_and_Literature": "entertainment",
    "News_and_Media": "news",
    "Career_and_Education": "school_work",
    "Business_and_Industry": "school_work",
    "Reference": "search",
    "Science": "search",
    "Internet_and_Telecom": "search",
    "Computer_and_Electronics": "search",
    "Law_and_Government": "news",
    "Finance": "shopping_misc",
    "Shopping": "shopping_misc",
    "Autos_and_Vehicles": "shopping_misc",
    "Beauty_and_Fitness": "shopping_misc",
    "Food_and_Drink": "shopping_misc",
    "Home_and_Garden": "shopping_misc",
    "Recreation_and_Hobbies": "shopping_misc",
    "Travel": "shopping_misc",
    "Pets_and_Animals": "shopping_misc",
    "Gambling": "shopping_misc",
    "Adult": "shopping_misc",
    "Health": "shopping_misc",
    "Not_working": "shopping_misc",
    "type": "shopping_misc",  # header guard
}

def detect_tag(host: str, title: str) -> str:
    """
    Assign an item to one of the defined perspectives using the CSV type map first,
    then host/keyword heuristics. Falls back to shopping_misc so nothing is lost.
    """
    h = canonical_host(host)
    t = (title or "").lower()

    host_type = lookup_host_type(h)
    if host_type:
        tag = TYPE_TO_TAG.get(host_type)
        if tag:
            return tag

    for tag in TAG_DEFS:
        if any(p in h for p in tag["hosts"]):
            return tag["id"]
        if any(kw in t for kw in tag["keywords"]):
            return tag["id"]
    return "shopping_misc"

# ============================================================
# Title cleanup and "noise" filters (new)
# ============================================================
GENERIC_TITLE_PATTERNS = [
    r"^new tab$",
    r"^home$",
    r"^homepage$",
    r"^untitled$",
    r"sign in",
    r"log in",
    r"login",
    r"account",
    r"verify",
    r"security",
    r"welcome",
    r"index of",
]

def clean_title_v2(title: str) -> str:
    if not title:
        return "Untitled"
    # remove suffixes like " - Google Search", " - YouTube", etc.
    title = re.sub(r"\s[-|\u2022]\s.*$", "", title).strip()
    if len(title) > 90:
        title = title[:87] + "..."
    return title

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

# Excludes you probably don't want in the pool
EXCLUDE_HOST_EXACT = {
    "localhost",
    "127.0.0.1",
}
EXCLUDE_HOST_SUBSTRINGS = (
    "chrome.google.com",
    "accounts.google.com",
    "login.",
    "auth.",
)

def _is_noise_title(title: str) -> bool:
    return is_generic_title(title)

# ============================================================
# Candidate selection scoring (existing)
# ============================================================
KEEP_HOST_ALLOWLIST = {
    "google.com", "www.google.com",
    "youtube.com", "www.youtube.com",
    "github.com", "www.github.com",
    "reddit.com", "www.reddit.com",
    "wikipedia.org", "en.wikipedia.org",
}

def build_host_stats(items):
    """
    Per-host stats: total count, unique title count, title variety ratio.
    """
    stats = {}
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

def score_item(it, host_stats):
    """
    Higher score = more interesting candidate.
    - penalize generic titles
    - penalize hosts with low title variety (unless allowlisted)
    - penalize extremely frequent hosts (but not allowlisted)
    """
    host = it.get("host")
    title = it.get("title") or ""
    if not host or not title:
        return -999

    if is_generic_title(title):
        return -50

    hs = host_stats.get(host, {"n": 1, "variety": 1.0})
    freq = hs["n"]
    variety = hs["variety"]

    # title specificity proxy
    words = re.findall(r"[a-zA-Z0-9]{3,}", title.lower())
    specificity = min(len(words), 12)

    score = 0.0
    score += specificity * 2.0
    score += min((it.get("visitCount") or 1), 20) * 0.2

    if host not in KEEP_HOST_ALLOWLIST:
        score += variety * 6.0
        score -= min(freq, 500) * 0.02  # penalize very frequent hosts
    else:
        # keep big hosts, but still prefer varied/specific titles
        score += variety * 2.0

    return score

def select_candidates(history, max_history=2000, max_candidates=700, allowed_tags=None):
    """
    history: list of {host,title,lastVisitTime,visitCount}
    Returns a curated pool for AI.
    """
    allowed_set = set(allowed_tags or [t["id"] for t in TAG_DEFS])

    items = []
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
        items.append({
            "host": host,
            "title": title,
            "lastVisitTime": h.get("lastVisitTime"),
            "visitCount": int(h.get("visitCount") or 1),
            "tag": tag,
        })

    if not items:
        return []

    host_stats = build_host_stats(items)

    scored = []
    for it in items:
        s = score_item(it, host_stats)
        if s > 0:
            scored.append((s, it))

    scored.sort(key=lambda x: x[0], reverse=True)

    per_host_cap = 3
    per_host_cap_allow = 8

    out = []
    per_host = {}
    seen = set()

    for _, it in scored:
        key = (it["host"], it["title"].lower())
        if key in seen:
            continue
        seen.add(key)

        cap = per_host_cap_allow if it["host"] in KEEP_HOST_ALLOWLIST else per_host_cap
        if per_host.get(it["host"], 0) >= cap:
            continue

        hs = host_stats.get(it["host"], {"variety": 0.0})
        if it["host"] not in KEEP_HOST_ALLOWLIST and hs["variety"] < 0.15:
            continue

        out.append(it)
        per_host[it["host"]] = per_host.get(it["host"], 0) + 1
        if len(out) >= max_candidates:
            break

    return out

# ============================================================
# NEW: staged shrink (early stop) + route integration
# ============================================================
def _stage0_basic(history, max_history=200000):
    """
    Stage 0: normalize basic shape into canonical items.
    Expects extension may send host/title already. If it sends url too, handle it.
    """
    out = []
    for h in (history or [])[:max_history]:
        if not isinstance(h, dict):
            continue

        host = h.get("host")
        if not host and h.get("url"):
            host = host_from_url(h.get("url"))

        host = canonical_host(host)
        title = clean_title_v2(h.get("title") or "")

        if not host or not title:
            continue

        out.append({
            "host": host,
            "title": title,
            "visitCount": int(h.get("visitCount") or 1),
            "lastVisitTime": h.get("lastVisitTime"),
        })
    return out

def _stage1_filter_noise(items):
    """
    Remove obvious junk (logins, empty, generic titles, unwanted hosts).
    """
    filtered = []
    for it in items:
        host = it["host"]
        title = it["title"]

        if host in EXCLUDE_HOST_EXACT:
            continue
        if any(s in host for s in EXCLUDE_HOST_SUBSTRINGS):
            continue
        if _is_noise_title(title):
            continue

        filtered.append(it)
    return filtered

def _stage2_dedupe(items):
    seen = set()
    out = []
    for it in items:
        key = (it["host"], it["title"].lower())
        if key in seen:
            continue
        seen.add(key)
        out.append(it)
    return out

def _stage3_loose_host_cap(items, cap=30):
    """
    Cheap cap before heavier stuff. Keeps first N per host (order doesn't matter much).
    """
    per_host = {}
    out = []
    for it in items:
        h = it["host"]
        if per_host.get(h, 0) >= cap:
            continue
        per_host[h] = per_host.get(h, 0) + 1
        out.append(it)
    return out

def shrink_history_staged(history, stop_threshold=1000):
    """
    Do something like before running check on each stage:
    if under threshold, stop sanitizing and return current list.

    Returns items shaped like:
      [{"host": "...", "title": "...", "visitCount": int, "lastVisitTime": ...}, ...]
    """
    # Stage 0
    items = _stage0_basic(history)
    if len(items) <= stop_threshold:
        return items

    # Stage 1
    items = _stage1_filter_noise(items)
    if len(items) <= stop_threshold:
        return items

    # Stage 2
    items = _stage2_dedupe(items)
    if len(items) <= stop_threshold:
        return items

    # Stage 3 (cheap pre-cap)
    items = _stage3_loose_host_cap(items, cap=30)
    if len(items) <= stop_threshold:
        return items

    # Final: if still large, use your existing "select_candidates" to shrink
    # down to a manageable pool for downstream AI/game.
    # (This is your "smart" shrink, but only after all early-stop checks.)
    candidates = select_candidates(
        items,
        max_history=5000,
        max_candidates=700,
        allowed_tags=[t["id"] for t in TAG_DEFS],
    )

    # Keep the candidates if we got enough; otherwise return the staged items
    return candidates if candidates else items

# ============================================================
# Tag summaries and review helpers (yours)
# ============================================================
def summarize_tags(history, min_count=TAG_MIN_COUNT, max_per_tag=60, max_history=2000):
    buckets = {t["id"]: [] for t in TAG_DEFS}
    seen = set()

    cleaned = []
    for h in (history or [])[:max_history]:
        if not isinstance(h, dict):
            continue
        host = canonical_host(h.get("host"))
        title = clean_title_v2(h.get("title") or "")
        if not host or not title:
            continue
        key = (host, title)
        if key in seen:
            continue
        seen.add(key)
        tag = detect_tag(host, title)
        cleaned.append({"host": host, "title": title, "visitCount": int(h.get("visitCount") or 1), "tag": tag})

    if not cleaned:
        return []

    host_stats = build_host_stats(cleaned)
    scored = []
    for it in cleaned:
        scored.append((score_item(it, host_stats), it))
    scored.sort(key=lambda x: x[0], reverse=True)

    for score, it in scored:
        buckets[it["tag"]].append({
            "host": it["host"],
            "title": it["title"],
            "score": round(score, 2)
        })

    summary = []
    for tag in TAG_DEFS:
        items = buckets.get(tag["id"], [])
        summary.append({
            "id": tag["id"],
            "label": tag["label"],
            "count": len(items),
            "needs": max(0, min_count - len(items)),
            "items": items[:max_per_tag]
        })
    return summary

def filter_history_by_tags(history, selected_tags):
    if not selected_tags:
        return history
    allowed = set(selected_tags)
    filtered = []
    for h in history or []:
        if not isinstance(h, dict):
            continue
        host = canonical_host(h.get("host"))
        title = clean_title_v2(h.get("title") or "")
        if not host or not title:
            continue
        if detect_tag(host, title) not in allowed:
            continue
        filtered.append({
            "host": host,
            "title": title,
            "lastVisitTime": h.get("lastVisitTime"),
            "visitCount": int(h.get("visitCount") or 1),
        })
    return filtered

def tag_history_items(history, max_history=5000):
    out = []
    for h in (history or [])[:max_history]:
        if not isinstance(h, dict):
            continue
        host = canonical_host(h.get("host"))
        title = clean_title_v2(h.get("title") or "")
        if not host or not title:
            continue
        tag = detect_tag(host, title)
        out.append({
            "host": host,
            "title": title,
            "tag": tag,
            "lastVisitTime": h.get("lastVisitTime"),
            "visitCount": int(h.get("visitCount") or 1),
        })
    return out

def summarize_items_by_tag(items, max_hosts=None):
    tag_counts = {t["id"]: 0 for t in TAG_DEFS}
    host_counts = {t["id"]: {} for t in TAG_DEFS}
    for it in items:
        tag = it.get("tag") or "shopping_misc"
        host = it.get("host") or "unknown"
        tag_counts[tag] = tag_counts.get(tag, 0) + 1
        hc = host_counts.setdefault(tag, {})
        hc[host] = hc.get(host, 0) + 1

    summary = []
    for tag in TAG_DEFS:
        hosts = host_counts.get(tag["id"], {})
        sorted_hosts = sorted(hosts.items(), key=lambda x: x[1], reverse=True)
        if max_hosts:
            sorted_hosts = sorted_hosts[:max_hosts]
        summary.append({
            "id": tag["id"],
            "label": tag["label"],
            "count": tag_counts.get(tag["id"], 0),
            "hosts": [{"host": h, "count": c} for h, c in sorted_hosts],
        })
    return summary

# ============================================================
# AI round normalization + generation (your existing)
# NOTE: kept as-is, except we ensure select_candidates exists above.
# ============================================================
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

        if lie_index is None:
            flags = []
            for c in cards:
                if not isinstance(c, dict):
                    flags.append(False)
                else:
                    flags.append(bool(c.get("lie", c.get("is_lie", False))))
            if flags.count(True) == 1:
                lie_index = flags.index(True)
            else:
                # Try using real_idx presence to infer truths
                real_idx_flags = []
                for c in cards:
                    if not isinstance(c, dict):
                        real_idx_flags.append(None)
                    else:
                        real_idx_flags.append(c.get("real_idx", c.get("idx")))
                missing_real_idx = [i for i, val in enumerate(real_idx_flags) if val in (None, "", [])]
                provided_real_idx = [i for i, val in enumerate(real_idx_flags) if val not in (None, "", [])]
                if len(missing_real_idx) == 1 and len(provided_real_idx) >= 2:
                    lie_index = missing_real_idx[0]
                else:
                    in_real = []
                    for c in cards:
                        host = canonical_host(c.get("host")) if isinstance(c, dict) else ""
                        title = clean_title_v2(c.get("title") or "") if isinstance(c, dict) else ""
                        in_real.append((host, title) in compact_real_set)
                    if in_real.count(False) == 1:
                        lie_index = in_real.index(False)
                    else:
                        raise ValueError(f"Round {idx}: could not infer lie_index (no lie flags)")

        if not isinstance(lie_index, int) or not (0 <= lie_index <= 2):
            raise ValueError(f"Round {idx}: invalid lie_index {lie_index}")

        norm_cards = []
        for i, c in enumerate(cards):
            if not isinstance(c, dict):
                raise ValueError(f"Round {idx}: card {i} must be object")

            real_idx = c.get("real_idx", c.get("idx"))
            host = canonical_host(c.get("host"))
            title = clean_title_v2(c.get("title") or "")
            tag_hint = c.get("tag") or c.get("topic")

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
                "real_idx": real_idx if i != lie_index else None,
            })
            if round_tag is None:
                round_tag = card_tag

        for i, c in enumerate(norm_cards):
            pair = (c["host"], c["title"])
            if i == lie_index:
                if pair in compact_real_set:
                    raise ValueError(f"Round {idx}: lie matches real item")
                if c.get("real_idx") is not None:
                    raise ValueError(f"Round {idx}: lie card has real_idx")
            else:
                if pair not in compact_real_set and c.get("real_idx") is None:
                    raise ValueError(f"Round {idx}: truth not in real pool: {pair}")
                expected_tag = real_lookup.get(pair)
                card_tag = c.get("tag") or expected_tag or detect_tag(c["host"], c["title"])
                if expected_tag and card_tag != expected_tag:
                    raise ValueError(f"Round {idx}: truth tag mismatch {card_tag} vs expected {expected_tag}")
                if card_tag != round_tag:
                    raise ValueError(f"Round {idx}: card tag {card_tag} != round tag {round_tag}")

        for c in norm_cards:
            if c["tag"] != round_tag:
                raise ValueError(f"Round {idx}: card tag {c['tag']} != round tag {round_tag}")

        if round_tag and allowed_set and round_tag not in allowed_set:
            raise ValueError(f"Round {idx}: tag {round_tag} not in allowed set")
        if not round_tag:
            raise ValueError(f"Round {idx}: missing tag")
        if round_tag not in TAG_LOOKUP:
            raise ValueError(f"Round {idx}: unknown tag {round_tag}")

        return {"topic": round_tag, "tag": round_tag, "cards": norm_cards, "lie_index": lie_index}

    normalized = []
    for idx, r in enumerate(rounds):
        normalized.append(norm_one_round(r, idx))
    return normalized

def log_ai_run(meta, request_payload, raw_response, normalized, error=None):
    entry = {
        "ts": utc_now_iso(),
        "meta": meta or {},
        "request": request_payload,
        "response_raw": raw_response,
        "normalized": normalized,
        "error": str(error) if error else None,
    }
    try:
        with open("ai_rounds_log.jsonl", "a") as f:
            f.write(json.dumps(entry) + "\n")
    except Exception:
        pass

def make_rounds_ai(history, n_rounds=10, seed=None, allowed_tags=None, meta=None):
    allowed_tags = allowed_tags or [t["id"] for t in TAG_DEFS]
    candidates = select_candidates(
        history,
        max_history=500,
        max_candidates=150,
        allowed_tags=allowed_tags,
    )
    print(f"AI round generation: {len(candidates)} candidates from {len(history)} history items")
    with open("candidates_debug.json", "w") as f:
        json.dump(candidates, f, indent=2)

    if len(candidates) < max(10, n_rounds * 2):
        return make_rounds(history, n_rounds=n_rounds, seed=seed, allowed_tags=allowed_tags)

    compact = []
    real_lookup = {}
    real_items_by_idx = {}
    for idx, c in enumerate(candidates):
        host = canonical_host(c["host"])
        title = clean_title_v2(c["title"])
        tag = c.get("tag") or detect_tag(host, title)
        item = {"id": idx, "host": host, "title": title, "tag": tag}
        compact.append(item)
        real_lookup[(host, title)] = tag
        real_items_by_idx[idx] = item

    schema = {
        "name": "historycourt_rounds",
        "schema": {
            "type": "object",
            "additionalProperties": False,
            "required": ["rounds"],
            "properties": {
                "rounds": {
                    "type": "array",
                    "minItems": n_rounds,
                    "maxItems": n_rounds,
                    "items": {
                        "type": "object",
                        "additionalProperties": False,
                        "required": ["cards", "lie_index", "topic", "tag"],
                        "properties": {
                            "topic": {"type": "string"},
                            "tag": {"type": "string", "enum": allowed_tags},
                            "cards": {
                                "type": "array",
                                "minItems": 3,
                                "maxItems": 3,
                                "items": {
                                    "type": "object",
                                    "additionalProperties": False,
                                    "required": ["host", "title"],
                                    "properties": {
                                        "host": {"type": "string"},
                                        "title": {"type": "string"},
                                        "real_idx": {"type": "integer", "minimum": 0, "maximum": len(compact)},
                                    }
                                }
                            },
                            "lie_index": {"type": "integer", "minimum": 0, "maximum": 2}
                        }
                    }
                }
            }
        },
        "strict": True,
    }

    client = OpenAI(
        base_url="https://openrouter.ai/api/v1",
        api_key=getenv("OPENROUTER_API_KEY"),
    )

    system = (
        "You generate party-game rounds for 'Search History Court'. "
        "Each round has 3 cards. Exactly 1 is the lie.\n\n"
        "HARD RULES:\n"
        "1) Two truth cards MUST be chosen from the provided REAL_ITEMS list.\n"
        "2) The lie card MUST NOT match any (host,title) pair in REAL_ITEMS.\n"
        "3) Prefer diversity: avoid repeating the same host across rounds and vary topics.\n"
        "4) Avoid boring/generic titles (login/home/new tab).\n"
        "5) It's okay to use big hosts (google/youtube/github), but prefer titles that look specific.\n"
        "6) The lie should be plausible *given the user's interests* based on REAL_ITEMS, "
        "but still not present in REAL_ITEMS.\n"
        "7) Avoid repetitive lie patterns (not always 'how to delete history').\n"
        "8) Spread rounds across the tag set provided by the user; look for the weirdest or most specific truths within those tags.\n"
        "9) Each round MUST declare a tag from the allowed list, and all 3 cards (including the lie) must belong to that same tag.\n"
        "10) Both truth cards must come from REAL_ITEMS with that same tag.\n"
        "11) Use canonical hosts without leading www.\n"
        "12) Whenever possible, reference truths by setting real_idx to the REAL_ITEMS index so the backend can validate. Lies must NOT include real_idx.\n"
        "13) Do not rewrite or encode titles/hosts; copy them exactly from REAL_ITEMS when using real_idx.\n"
    )

    user = {
        "n_rounds": n_rounds,
        "seed": seed or "",
        "REAL_ITEMS": compact,
        "selected_tags": allowed_tags or [],
        "tag_definitions": TAG_DEFS,
    }

    resp = client.chat.completions.create(
        model="gpt-5",
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": json.dumps(user)},
            {"role": "user", "content": "Return ONLY valid JSON of the form {\"rounds\": [...]}."}
        ],
        temperature=0.35,
        response_format={"type": "json_object"},
    )

    raw_content = resp.choices[0].message.content
    print(raw_content)

    try:
        data = json.loads(raw_content)
    except Exception as e:
        log_ai_run(meta or {}, {"REAL_ITEMS": compact, "allowed_tags": allowed_tags, "n_rounds": n_rounds, "seed": seed}, raw_content, None, e)
        raise

    real_set = {(x["host"], x["title"]) for x in compact}
    try:
        normalized_rounds = normalize_ai_rounds(
            data,
            real_set,
            real_lookup,
            allowed_tags=allowed_tags,
            real_items_by_idx=real_items_by_idx,
        )
        log_ai_run(meta or {}, {"REAL_ITEMS": compact, "allowed_tags": allowed_tags, "n_rounds": n_rounds, "seed": seed}, data, normalized_rounds, None)
        return normalized_rounds
    except Exception as e:
        log_ai_run(meta or {}, {"REAL_ITEMS": compact, "allowed_tags": allowed_tags, "n_rounds": n_rounds, "seed": seed}, data, None, e)
        raise

def clean_title(title):
    if not title:
        return "Untitled Page"
    title = re.sub(r"\s-.*", "", title)
    return title[:65] + "..." if len(title) > 65 else title

def make_rounds(history, n_rounds=10, seed=None, allowed_tags=None):
    if seed:
        random.seed(seed)

    allowed_tags = allowed_tags or [t["id"] for t in TAG_DEFS]
    source_history = filter_history_by_tags(history, allowed_tags) if allowed_tags else history
    valid_items = []
    for h in source_history:
        if not h.get("host") or not h.get("title"):
            continue
        host = canonical_host(h.get("host"))
        title = clean_title(h.get("title"))
        tag = detect_tag(host, title)
        if tag not in allowed_tags:
            continue
        valid_items.append({"host": host, "title": title, "tag": tag})

    if len(valid_items) < (n_rounds * 2):
        valid_items = [{"host": "example.com", "title": "User has no history", "tag": "shopping_misc"}] * max(30, n_rounds * 3)

    tag_buckets = {}
    for item in valid_items:
        tag_buckets.setdefault(item["tag"], []).append(item)
    for bucket in tag_buckets.values():
        random.shuffle(bucket)

    rounds = []
    tag_keys = [t for t, items in tag_buckets.items() if len(items) >= 2]
    if not tag_keys:
        tag_keys = list(tag_buckets.keys()) or ["shopping_misc"]

    for _ in range(n_rounds):
        tag = random.choice(tag_keys)
        bucket = tag_buckets.get(tag, [])
        if len(bucket) < 2:
            pool = [it for it in valid_items if it["tag"] == tag] or valid_items
            while len(bucket) < 2:
                bucket.append(random.choice(pool))
        truth1 = bucket.pop() if bucket else {"host": "?", "title": "?", "tag": tag}
        truth2 = bucket.pop() if bucket else {"host": "?", "title": "?", "tag": tag}

        fake_text, fake_host = random.choice(FAKE_TITLES)
        if random.random() > 0.5 and bucket:
            random_real_host = random.choice(bucket)["host"]
            fake_host = random_real_host
            fake_text = "How to erase " + random_real_host + " logs"

        lie = {"host": fake_host, "title": fake_text, "is_lie": True, "tag": tag}

        cards = [
            {"host": truth1["host"], "title": truth1["title"], "is_lie": False, "tag": tag},
            {"host": truth2["host"], "title": truth2["title"], "is_lie": False, "tag": tag},
            lie
        ]
        random.shuffle(cards)
        lie_index = next(i for i, card in enumerate(cards) if card["is_lie"])

        rounds.append({"cards": cards, "lie_index": lie_index, "topic": tag})
    return rounds

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

@app.get("/play/<case_id>")
def play(case_id):
    return render_template("play.html", case_id=case_id)

@app.post("/api/upload-history")
def upload_history():
    data = request.get_json(silent=True) or {}
    history = data.get("history") if isinstance(data, dict) else None

    if not history or not isinstance(history, list):
        return jsonify({"ok": False}), 400

    # >>> NEW: staged shrink with early-stop checks <<<
    stop_threshold = int(data.get("stop_threshold") or 1000)
    try:
        shrunk = shrink_history_staged(history, stop_threshold=stop_threshold)
    except Exception as e:
        # If shrink fails for any reason, fall back to basic sanitize
        app.logger.warning("History shrink failed; storing basic sanitized history: %s", e)
        shrunk = _stage0_basic(history)

    session_id = gen_id(14)
    conn = db()
    conn.execute(
        "INSERT INTO sessions (id, created_at, history_json) VALUES (?, ?, ?)",
        (session_id, utc_now_iso(), json.dumps(shrunk)),
    )
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "session_id": session_id, "total_in": len(history), "total_saved": len(shrunk)})

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
    tags_summary = summarize_tags(history)
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
        rounds_data = make_rounds_ai(
            filtered_history,
            n_rounds=rounds_n,
            seed=session_id,
            allowed_tags=selected_tags,
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

    conn, case_row, history = get_case_with_history(case_id)
    if not case_row:
        return jsonify({"ok": False, "error": "Case not found"}), 404

    rounds = json.loads(case_row["rounds_json"] or "[]")
    filtered_history = filter_history_by_tags(history, selected_tags) if selected_tags else history
    if not filtered_history:
        filtered_history = history

    def generate(count=1):
        try:
            return make_rounds_ai(
                filtered_history,
                n_rounds=count,
                seed=f"{case_id}-{utc_now_iso()}",
                allowed_tags=selected_tags,
                meta={"case_id": case_id, "action": action},
            )
        except Exception as e:
            app.logger.warning("AI regen failed, falling back: %s", e)
            return make_rounds(
                filtered_history,
                n_rounds=count,
                seed=f"{case_id}-{utc_now_iso()}",
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
    return jsonify({"ok": True, "rounds": rounds, "total": len(rounds)})

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
