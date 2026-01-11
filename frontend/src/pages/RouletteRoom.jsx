import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { createRouletteRoom, fetchRouletteRoom, startRouletteRoom } from "../api/client";
import PageFrame from "../components/PageFrame";

export default function RouletteRoomPage() {
  const { roomId: routeRoomId } = useParams();
  const navigate = useNavigate();

  const [roomId, setRoomId] = useState(routeRoomId || "");
  const [room, setRoom] = useState(null);
  const [creating, setCreating] = useState(false);
  const [picks, setPicks] = useState(3);
  const [status, setStatus] = useState({ msg: "", tone: "muted" });

  const [joinMsg, setJoinMsg] = useState({ msg: "", tone: "muted" });
  const [startStatus, setStartStatus] = useState({ msg: "", tone: "muted" });

  // Sync route param changes
  useEffect(() => {
    if (routeRoomId && routeRoomId !== roomId) {
      setRoomId(routeRoomId);
      setRoom(null);
      setJoinMsg({ msg: "", tone: "muted" });
    }
  }, [routeRoomId]);

  // Force one refresh on first load so the extension banner can initialize
  useEffect(() => {
    if (!routeRoomId) return;
    const key = `rr-refresh-${routeRoomId}`;
    const already = sessionStorage.getItem(key);
    if (!already) {
      sessionStorage.setItem(key, "1");
      window.location.reload();
    }
  }, [routeRoomId]);

  // Poll room status
  useEffect(() => {
    if (!roomId) return;
    let active = true;
    const run = async () => {
      try {
        const data = await fetchRouletteRoom(roomId);
        if (!active) return;
        setRoom(data);
      } catch (err) {
        if (!active) return;
        setStatus({ msg: err.message, tone: "bad" });
      }
    };
    run();
    const t = setInterval(run, 2000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [roomId]);

  async function handleCreate() {
    setCreating(true);
    setStatus({ msg: "Creating room...", tone: "muted" });
    try {
      const res = await createRouletteRoom(picks);
      setRoomId(res.room_id);
      setStatus({ msg: "Room created. Share the join link below.", tone: "good" });
      navigate(`/roulette-room/${res.room_id}`, { replace: true });
    } catch (err) {
      setStatus({ msg: err.message, tone: "bad" });
    } finally {
      setCreating(false);
    }
  }

  async function handleStart() {
    setStartStatus({ msg: "Generating game...", tone: "muted" });
    try {
      const res = await startRouletteRoom(roomId);
      setStartStatus({ msg: "Game ready! Opening...", tone: "good" });
      if (res.play_url) {
        window.location.href = res.play_url;
      }
    } catch (err) {
      setStartStatus({ msg: err.message, tone: "bad" });
    }
  }

  const statusColor = {
    muted: "text-slate-500",
    good: "text-emerald-600",
    bad: "text-rose-600",
  };

  const joinUrl = roomId ? `${window.location.origin}/roulette-room/${roomId}` : "";

  return (
    <PageFrame badge="Room Mode" tag="Roulette Lobby">
      <main className="space-y-8">
        <header className="space-y-3">
          <p className="text-xs uppercase tracking-[0.28em] font-mono text-slate-600">Room mode</p>
          <h1 className="text-4xl font-display font-black tracking-tight">Create or join a history room</h1>
          <p className="text-slate-700 max-w-3xl">
            Host creates a room, then each friend opens the link and uploads their own browsing history snapshot.
            When at least two people join, start the game and guess whose tabs are whose.
          </p>
          <div className="flex gap-3">
            <Link to="/" className="text-sm text-ink underline decoration-2 decoration-ink/40 hover:decoration-ink">
              ← Back home
            </Link>
            <Link to="/roulette" className="text-sm text-slate-700 underline decoration-dotted decoration-ink/40">
              Classic multi-upload
            </Link>
          </div>
        </header>

        {!roomId && (
          <section className="shell-card bg-white p-6 space-y-4 rounded-none">
            <div className="flex items-center gap-3 flex-wrap">
              <label className="text-sm font-semibold text-ink">Cards per player</label>
              <input
                type="number"
                min="3"
                max="6"
                value={picks}
                onChange={(e) => setPicks(Math.max(3, Math.min(6, Number(e.target.value) || 3)))}
                className="w-20 text-center border-2 border-ink px-2 py-2 font-semibold text-lg bg-white focus:outline-none rounded-none"
              />
            </div>
            <button
              onClick={handleCreate}
              disabled={creating}
              className="btn-ink inline-flex items-center gap-2 px-5 py-3 rounded-none disabled:opacity-60"
            >
              {creating ? "Creating..." : "Create room"}
            </button>
            <div className={`text-sm ${statusColor[status.tone] || statusColor.muted}`}>{status.msg}</div>
          </section>
        )}

        {roomId && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <section className="shell-card bg-white p-6 space-y-4 rounded-none">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-600 font-mono">Room</p>
                  <p className="text-lg font-display font-bold text-ink">ID: {roomId}</p>
                  <p className="text-xs text-slate-600">Cards per player: {room?.picks || picks}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => navigator.clipboard.writeText(joinUrl)}
                    className="btn-outline text-xs px-3 py-2 bg-white rounded-none"
                  >
                    Copy link
                  </button>
                  <span className="text-xs font-mono bg-white border-2 border-ink px-2 py-1 shadow-hard-sm rounded-none">{joinUrl}</span>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-semibold text-ink">Players</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {(room?.players || []).map((p) => (
                    <div key={p.id} className="border-2 border-ink bg-white px-3 py-2 text-sm flex items-center justify-between shadow-hard-sm rounded-none">
                      <span className="font-semibold text-ink">{p.name}</span>
                      <span className="text-xs text-slate-600">{p.count} items</span>
                    </div>
                  ))}
                  {!room?.players?.length && <div className="text-sm text-slate-500">Waiting for players...</div>}
                </div>
              </div>

              {room?.play_url ? (
                <div className="bg-neon-green/20 border-2 border-ink p-4 space-y-2 shadow-hard-sm rounded-none">
                  <p className="text-sm font-semibold text-ink">Game ready</p>
                  <div className="font-mono text-sm text-ink break-all bg-white border-2 border-ink px-3 py-2 rounded-none">
                    {room.play_url}
                  </div>
                  <div className="flex gap-2">
                    <Link
                      to={room.play_url.replace(window.location.origin, "")}
                      className="btn-ink text-xs px-3 py-2 rounded-none"
                    >
                      Open game
                    </Link>
                    <button
                      onClick={() => navigator.clipboard.writeText(room.play_url)}
                      className="btn-outline text-xs px-3 py-2 bg-white rounded-none"
                    >
                      Copy
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <button
                    onClick={handleStart}
                    disabled={!room?.can_start || room?.status !== "open"}
                    className="btn-ink inline-flex items-center gap-2 px-5 py-3 rounded-none disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Start game
                  </button>
                  <div className={`text-sm ${statusColor[startStatus.tone] || statusColor.muted}`}>
                    {room?.can_start ? startStatus.msg : "Need at least 2 players to start."}
                  </div>
                </div>
              )}
            </section>

            <section className="shell-card bg-white p-6 space-y-4 rounded-none relative">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 border-2 border-ink bg-neon-blue/30 font-mono text-[11px] uppercase shadow-hard-sm">
                Extension
              </div>
              <div>
                <p className="text-sm font-semibold text-ink">Join this room</p>
                <p className="text-xs text-slate-600">
                  Click the History Court extension banner. It will upload your browsing snapshot automatically and you'll appear in the list above.
                </p>
              </div>
              <div className="bg-white border-2 border-ink px-4 py-3 text-sm text-slate-700 shadow-hard-sm rounded-none">
                <p className="font-semibold text-ink mb-1">Extension steps</p>
                <ol className="list-decimal list-inside space-y-1">
                  <li>Click the extension icon while on this page.</li>
                  <li>Confirm upload when prompted.</li>
                  <li>Wait a moment; your name will appear in the Players list.</li>
                </ol>
              </div>
              <div className={`text-sm ${statusColor[joinMsg.tone] || statusColor.muted}`}>
                {room?.status === "started" ? "Game already started." : joinMsg.msg || "Waiting for extension upload..."}
              </div>
            </section>
          </div>
        )}
      </main>
    </PageFrame>
  );
}
