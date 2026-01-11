# HistoryCourt Flask server

Flask backend for the Search History Liar game (two truths + one lie). Users upload sanitized history via the extension, select website-type tags, preview rounds, then share a play link.

## Setup
1. Create a virtualenv (optional): `python -m venv .venv && source .venv/bin/activate`
2. Install deps: `pip install -r requirements.txt`
3. Run: `python app.py`

The server listens on `http://localhost:5000`.

## Pages
- `/` landing page
- `/review` pre-upload review (choose categories/domains before uploading)
- `/me/<session_id>` case builder (tag selection + preview/edit)
- `/play/<case_id>` jury UI for guessing the lie
- `/roulette` create multiplayer roulette game (upload multiple players' histories)
- `/roulette/<game_id>` guess which player owns the shown trio of tabs
- `/roulette-room` create a joinable room; each browser uploads their own history, then host starts the roulette game
- `/roulette-room/<room_id>` join a specific room and upload your history
- `/portal` user portal to open your session or delete your data

## Key API routes
- `POST /api/upload-history` body `{ history: [...] }` -> `{ ok, session_id }`
- `POST /api/review-summary` body `{ history: [...] }` -> returns tagged items and per-category counts (no persistence)
- `GET /api/session/<session_id>/tags` bucket history into 6 perspectives; each tag reports count, needs (target 30+ items), and sample items.
- `POST /api/create-case` body `{ session_id, rounds, tags }` -> generates rounds using the selected tags. Response includes `{ case_id, play_url, rounds }`.
- `GET /api/case/<case_id>/rounds` full rounds (for preview/edit UI)
- `POST /api/case/<case_id>/edit` body `{ action, round?, count?, tags? }` where action is one of `delete_round`, `regenerate_round`, `append_round`.
- `GET /api/case/<case_id>/round/<r>` round data for play mode (truths only)
- `POST /api/case/<case_id>/guess` body `{ round, selection }` -> `{ correct, lie_index }`
