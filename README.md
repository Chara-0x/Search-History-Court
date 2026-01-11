# History Court
One flow, one UI: React frontend + Flask API + Chrome extension.

## Prereqs
- Node 18+
- Python 3.10+
- Chrome (for extension testing)

## Setup
1. Copy `.env` (already checked in) and adjust `VITE_API_BASE` / `API_BASE` if your server runs on another host/port. `SESSION_KEY` stays `session_id` for everything.
2. Install frontend deps:
   ```bash
   cd frontend
   npm install
   ```
3. Install server deps:
   ```bash
   cd server
   python -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   ```

## Run locally
- **API**
  ```bash
  cd server
  source .venv/bin/activate
  python app.py
  ```
  Defaults to `http://127.0.0.1:5000` and serves the built React app from `server/static/react`.

- **Frontend (dev mode)**
  ```bash
  cd frontend
  npm run dev -- --host --port 5173
  ```
  Vite uses `VITE_API_BASE` from `.env`.

- **Frontend (build + serve via Flask)**
  ```bash
  cd frontend
  npm run build
  rsync -a dist/ ../server/static/react/
  ```
  Then reload the Flask server.

- **Chrome extension**
  1) Build frontend/serve API so routes work.
  2) In Chrome: `chrome://extensions` → Enable Developer mode → Load unpacked → choose the `extension` folder.
  3) Hosts allowed: `http://127.0.0.1:5000` and `http://historycourt.lol` (update manifest if you change hosts).

## Docs
- Flow: `docs/flow.md`
- API contract: `server/api_spec.md`

## Notes
- Identity is anonymous `session_id` stored in localStorage/cookie/extension storage.
- Templates are no longer used; Flask only serves API + the React build.
- If `server/static/react/index.html` is missing you'll see a plain fallback message; build the frontend to restore the UI.
