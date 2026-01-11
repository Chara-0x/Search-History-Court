# API Spec
All responses follow `{ ok: true, ... }` on success or `{ ok: false, error: "..." }` on error.

## Session + History
- **POST `/api/upload-history`**
  - Body: `{ history: HistoryItem[], session_id?: string }`
  - Success: `{ ok: true, session_id, total_in, total_saved }`
  - Errors: `history_required` (400)

- **GET `/api/session/{session_id}/tags`**
  - Success: `{ ok: true, tags: TagSummary[], total, min_per_tag }` (returns ok even when history is empty)
  - Errors: `session_not_found` (404)

- **POST `/api/delete-user`**
  - Body: `{ session_id }`
  - Success: `{ ok: true }`
  - Errors: `session_id_required` (400)

## Case Builder (solo flow)
- **POST `/api/create-case`**
  - Body: `{ session_id, rounds?: number (3-15), tags?: string[], pick_n?: number }`
  - Success: `{ ok: true, case_id, play_url, rounds, selected_tags, pick_n }`
  - Errors: `session_not_found` (404)

- **POST `/api/case/{case_id}/edit`**
  - Body: `{ action: "delete_round" | "regenerate_round" | "append_round", round?: number, tags?: string[], pick_n?: number, count?: number }`
  - Success: `{ ok: true, rounds, total, pick_n }`
  - Errors: `case_not_found` (404), `round_not_found` (400), `unknown_action` (400)

- **GET `/api/case/{case_id}/rounds`**
  - Success: `{ ok: true, rounds, total }`
  - Errors: `case_not_found` (404)

- **GET `/api/case/{case_id}/round/{n}`**
  - Success: `{ ok: true, total, cards }`
  - Errors: `case_not_found` (404), `round_out_of_range` (404)

- **POST `/api/case/{case_id}/guess`**
  - Body: `{ round: number, selection: number }`
  - Success: `{ ok: true, correct, lie_index }`
  - Errors: `case_not_found` (404), `round_out_of_range` (400)

## Roulette (multiplayer)
- **POST `/api/roulette/create`**
  - Body: `{ players: { id?: string, name?: string, history: HistoryItem[] }[], picks?: number }`
  - Success: `{ ok: true, game_id, play_url, total_rounds, players, picks }`
  - Errors: `players_required` (400), `need_two_players` (400)

- **GET `/api/roulette/{game_id}/round/{n}`**
  - Success: `{ ok: true, round, total, cards, player_choices }`
  - Errors: `game_not_found` (404), `round_out_of_range` (404)

- **POST `/api/roulette/{game_id}/guess`**
  - Body: `{ round: number, player_id: string }`
  - Success: `{ ok: true, correct, correct_player_id, correct_player_name }`
  - Errors: `game_not_found` (404), `round_out_of_range` (400)

### Room-based Roulette
- **POST `/api/roulette/room/create`**
  - Body: `{ picks?: number }`
  - Success: `{ ok: true, room_id, picks, join_url }`

- **GET `/api/roulette/room/{room_id}`**
  - Success: `{ ok: true, room_id, picks, status, players, can_start, game_id?, play_url? }`
  - Errors: `room_not_found` (404)

- **POST `/api/roulette/room/{room_id}/join`**
  - Body: `{ name: string, history: HistoryItem[], session_id?: string }`
  - Success: `{ ok: true, player_id, name, count }`
  - Errors: `room_not_found` (404), `room_closed` (400), `history_required` (400), `no_usable_history` (400)

- **POST `/api/roulette/room/{room_id}/start`**
  - Success: `{ ok: true, game_id, play_url, already_started? }`
  - Errors: `room_not_found` (404), `room_closed` (400), `need_two_players` (400)

## Metadata
- **POST `/api/review-summary`**
  - Body: `{ history: HistoryItem[] }`
  - Success: `{ ok: true, items, tags, total }`
  - Errors: `invalid_history` (400)

- **GET `/api/type-map`**
  - Success: `{ ok: true, type_map, type_to_tag, tag_defs, tag_min_count }`

---
Types:
- `HistoryItem`: `{ host: string, title: string, visitCount?: number, lastVisitTime?: number }`
- `TagSummary`: `{ id, label, count, hosts: { host, count }[] }`
