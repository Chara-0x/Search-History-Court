import csv
import os
from os import getenv

# Tagging (6 perspectives)
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
        "id": "entertainment",
        "label": "Entertainment / Streaming",
        "hosts": [
            "youtube.com", "netflix.com", "spotify.com", "twitch.tv", "disneyplus.com",
            "hulu.com", "hbomax.com", "soundcloud.com", "imdb.com", "letterboxd.com"
        ],
        "keywords": ["trailer", "episode", "playlist", "lyrics", "soundtrack", "movie", "series"]
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
TYPE_MAP_PATH = getenv("TYPE_MAP_PATH", os.path.join(os.path.dirname(__file__), "types.csv"))


def canonical_host(host: str) -> str:
    h = (host or "").strip().lower()
    if h.startswith("www."):
        h = h[4:]
    return h


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
    except Exception:
        return {}
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


def filter_history_by_tags(history, selected_tags):
    """
    Keep only history items that match the chosen tag ids.
    """
    if not selected_tags:
        return history
    allowed = set(selected_tags)
    filtered = []
    for h in history or []:
        if not isinstance(h, dict):
            continue
        host = canonical_host(h.get("host"))
        title = (h.get("title") or "").strip()
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
    """
    Returns a list of items with inferred tag and canonical host.
    """
    out = []
    for h in (history or [])[:max_history]:
        if not isinstance(h, dict):
            continue
        host = canonical_host(h.get("host"))
        title = (h.get("title") or "").strip()
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
    """
    Summaries for review UI: counts per tag + top hosts per tag.
    """
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
