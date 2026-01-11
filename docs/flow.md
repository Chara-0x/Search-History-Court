# User Flow

## Solo / Standard Path
1. **Landing** (`/`): user sees summary + CTA buttons for Review, Room, and Portal.
2. **Review** (`/review`): extension triggers cache of sanitized history (host + title only). User selects tags/hosts to keep. Upload button posts the filtered list to `/api/upload-history`.
3. **Upload** (background action): server stores history under a generated `session_id` (or the provided one) and returns `session_id`. Frontend saves `session_id` to localStorage + cookie and sends it back to the extension.
4. **Case Builder** (`/me/:session_id`): fetches `/api/session/{session_id}/tags`, lets user choose tags, generates or edits rounds via `/api/create-case` and `/api/case/{caseId}/edit`.
5. **Play** (`/play/:case_id`): players open the share link. Rounds are fetched via `/api/case/{caseId}/round/{n}`; guesses post to `/api/case/{caseId}/guess` until all rounds are exhausted.

## Room Mode (multiplayer roulette)
1. **Host** opens `/roulette-room` and hits "Create room" → `/api/roulette/room/create` returns `room_id` and join URL.
2. **Guests** follow `room_url` (content script shows banner). They upload or re-use cached history via `/api/roulette/room/{room_id}/join`.
3. **Host** watches lobby state from `/api/roulette/room/{room_id}`; when ready, clicks "Start" → `/api/roulette/room/{room_id}/start` creates a roulette game.
4. **Everyone** plays at `/roulette/{game_id}`: rounds fetched from `/api/roulette/{game_id}/round/{n}`, guesses sent to `/api/roulette/{game_id}/guess`.

## Data lifecycle
- **Identity:** anonymous `session_id` only. No accounts.
- **Delete:** user triggers delete from Portal or extension → `/api/delete-user` clears session + cases; frontend/extension clear stored `session_id` and cached history.
