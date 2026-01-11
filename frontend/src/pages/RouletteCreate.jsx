import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { createRouletteGame } from "../api/client";
import PageFrame from "../components/PageFrame";

function emptyPlayer(idx) {
  return { id: `p-${idx}-${Date.now()}`, name: `Player ${idx + 1}`, historyText: "" };
}

function parseHistory(text) {
  if (!text || !text.trim()) return null;
  try {
    const data = JSON.parse(text);
    if (!Array.isArray(data)) return null;
    return data;
  } catch (e) {
    return null;
  }
}

export default function RouletteCreatePage() {
  const [players, setPlayers] = useState([emptyPlayer(0), emptyPlayer(1)]);
  const [status, setStatus] = useState({ msg: "", tone: "muted" });
  const [creating, setCreating] = useState(false);
  const [gameLink, setGameLink] = useState("");
  const [picks, setPicks] = useState(3);

  const validPlayers = useMemo(() => {
    return players
      .map((p) => ({ ...p, parsed: parseHistory(p.historyText) }))
      .filter((p) => Array.isArray(p.parsed) && p.parsed.length > 0);
  }, [players]);

  function updatePlayer(idx, patch) {
    setPlayers((prev) => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  }

  function addPlayer() {
    setPlayers((prev) => [...prev, emptyPlayer(prev.length)]);
  }

  function removePlayer(idx) {
    if (players.length <= 2) return;
    setPlayers((prev) => prev.filter((_, i) => i !== idx));
  }

  function handleFile(idx, file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => updatePlayer(idx, { historyText: e.target.result });
    reader.readAsText(file);
  }

  async function handleCreate() {
    if (validPlayers.length < 2) {
      setStatus({ msg: "Add at least two players with valid history JSON.", tone: "bad" });
      return;
    }
    setCreating(true);
    setStatus({ msg: "Summoning the weirdest tabs...", tone: "muted" });
    try {
      const payload = {
        players: validPlayers.map((p) => ({
          name: p.name || "Player",
          history: p.parsed,
        })),
        picks,
      };
      const res = await createRouletteGame(payload);
      setGameLink(res.play_url);
      setStatus({ msg: "Game ready! Share the link below.", tone: "good" });
    } catch (err) {
      setStatus({ msg: err.message, tone: "bad" });
    } finally {
      setCreating(false);
    }
  }

  const statusColor = {
    muted: "text-slate-500",
    good: "text-emerald-600",
    bad: "text-rose-600",
  };

  return (
    <PageFrame badge="Roulette Mode" tag="Multiplayer">
      <main className="space-y-8">
        <header className="space-y-3">
          <p className="text-xs uppercase tracking-[0.28em] font-mono text-slate-600">Multiplayer</p>
          <h1 className="text-4xl font-display font-black tracking-tight">
            Browsing History Court: Roulette
          </h1>
          <p className="text-slate-700 max-w-3xl">
            Invite friends to upload their browsing history snapshots. We&apos;ll auto-pick three bizarre pages per
            person. Show the trio and guess whose history it belongs to — like Photo Roulette, but for tabs.
          </p>
          <div className="flex gap-3">
            <Link to="/" className="text-sm text-ink underline decoration-2 decoration-ink/40 hover:decoration-ink">
              ← Back home
            </Link>
            <a
              className="text-sm text-slate-700 hover:text-ink"
              href="https://github.com"
              target="_blank"
              rel="noreferrer"
            >
              Get the extension
            </a>
          </div>
        </header>

        <section className="shell-card rounded-3xl bg-white p-6 space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-ink">Players &amp; uploads</p>
              <p className="text-xs text-slate-600">Paste JSON from the extension export or drop a file per player.</p>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500 bg-slate-100 border border-slate-200 px-3 py-1.5 rounded-full">
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
              {validPlayers.length} ready / {players.length} total
            </div>
          </div>

          <div className="space-y-4">
            {players.map((p, idx) => (
              <div
                key={p.id}
                className="rounded-xl border-2 border-ink bg-white p-4 space-y-3 shadow-hard-sm relative"
              >
                {players.length > 2 && (
                  <button
                    onClick={() => removePlayer(idx)}
                    className="absolute top-3 right-3 text-xs text-slate-500 hover:text-alert-red"
                    aria-label="Remove player"
                  >
                    ✕
                  </button>
                )}
                <div className="flex flex-wrap items-center gap-3">
                  <label className="text-sm font-semibold text-slate-800">Name</label>
                  <input
                    value={p.name}
                    onChange={(e) => updatePlayer(idx, { name: e.target.value })}
                    className="flex-1 min-w-[160px] rounded-lg border-2 border-ink px-3 py-2 text-sm bg-white focus:outline-none"
                    placeholder={`Player ${idx + 1}`}
                  />
                  <input
                    type="file"
                    accept="application/json"
                    onChange={(e) => handleFile(idx, e.target.files?.[0])}
                    className="text-xs text-slate-500"
                  />
                </div>
                <textarea
                  value={p.historyText}
                  onChange={(e) => updatePlayer(idx, { historyText: e.target.value })}
                  className="w-full min-h-[140px] rounded-lg border-2 border-ink px-3 py-2 text-sm font-mono bg-white focus:outline-none"
                  placeholder='Paste an array of history items: [{"host":"example.com","title":"..."}]'
                />
                <div className="text-xs text-slate-500">
                  {parseHistory(p.historyText)?.length
                    ? `${parseHistory(p.historyText)?.length} items detected`
                    : "Waiting for valid JSON array"}
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={addPlayer}
              className="btn-outline text-sm px-4 py-2 rounded-lg bg-white"
            >
              + Add player
            </button>
            <div className="flex items-center gap-2 text-sm">
              <label className="font-semibold text-ink">Cards per player</label>
              <input
                type="number"
                min="3"
                max="6"
                value={picks}
                onChange={(e) => setPicks(Math.max(3, Math.min(6, Number(e.target.value) || 3)))}
                className="w-16 text-center rounded-lg border-2 border-ink px-2 py-1 font-semibold bg-white focus:outline-none"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={handleCreate}
              disabled={creating}
              className="btn-ink inline-flex items-center gap-2 px-5 py-3 rounded-xl disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {creating ? "Building game..." : "Create roulette game"}
            </button>
            <div className={`text-sm ${statusColor[status.tone] || statusColor.muted}`}>{status.msg}</div>
          </div>

          {gameLink && (
            <div className="border-2 border-ink rounded-xl p-4 space-y-2 bg-neon-green/20 shadow-hard-sm">
              <p className="text-sm font-semibold text-ink">Game link</p>
              <div className="font-mono text-sm text-ink break-all bg-white border-2 border-ink rounded-lg px-3 py-2">
                {gameLink}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => navigator.clipboard.writeText(gameLink)}
                  className="btn-outline text-xs px-3 py-2 rounded-lg bg-white"
                >
                  Copy
                </button>
                <Link
                  to={gameLink.replace(window.location.origin, "") || "/roulette"}
                  className="btn-ink text-xs px-3 py-2 rounded-lg"
                >
                  Open game
                </Link>
              </div>
            </div>
          )}
        </section>

        <section className="shell-card rounded-3xl bg-white p-6 space-y-3">
          <p className="text-sm font-semibold text-ink">How to get your history JSON</p>
          <ol className="list-decimal list-inside text-sm text-slate-700 space-y-1">
            <li>Install the extension, click the banner on this site, and save the snapshot.</li>
            <li>Copy the JSON array (host + title only) and paste it into your player box above.</li>
            <li>Repeat for each friend, then create the game and share the link.</li>
          </ol>
        </section>
      </main>
    </PageFrame>
  );
}
