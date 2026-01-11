import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fetchRouletteRound, submitRouletteGuess } from "../api/client";
import PageFrame from "../components/PageFrame";

export default function RoulettePlayPage() {
  const { gameId } = useParams();
  const [roundIdx, setRoundIdx] = useState(0);
  const [total, setTotal] = useState(0);
  const [cards, setCards] = useState([]);
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState(false);
  const [verdict, setVerdict] = useState("");
  const [correctId, setCorrectId] = useState(null);
  const [score, setScore] = useState(0);

  useEffect(() => {
    loadRound(roundIdx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundIdx]);

  async function loadRound(idx) {
    setLoading(true);
    setLocked(false);
    setVerdict("");
    setCorrectId(null);
    try {
      const data = await fetchRouletteRound(gameId, idx);
      setCards(data.cards || []);
      setPlayers(data.player_choices || []);
      setTotal(data.total || 0);
    } catch (err) {
      setCards([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleGuess(playerId) {
    if (locked || loading) return;
    setLocked(true);
    try {
      const res = await submitRouletteGuess(gameId, roundIdx, playerId);
      setCorrectId(res.correct_player_id);
      if (res.correct) {
        setScore((s) => s + 1);
        setVerdict(`Correct! That trio belongs to ${res.correct_player_name || "them"}.`);
      } else {
        setVerdict(`Nope — that was ${res.correct_player_name || "someone else"}.`);
      }
    } catch (err) {
      setVerdict("Could not submit guess.");
    }
  }

  const gameOver = total > 0 && roundIdx >= total;

  return (
    <PageFrame badge="Roulette Jury" tag={`Game ${gameId || "?"}`}>
      <main className="space-y-6">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] font-mono text-slate-600">Roulette Jury</p>
            <h1 className="text-3xl font-display font-black tracking-tight">Guess the Owner</h1>
            <p className="text-slate-600 text-sm">Game ID: {gameId}</p>
          </div>
          <div className="flex gap-2 items-center">
            <Link to="/roulette" className="text-sm text-ink underline decoration-2 decoration-ink/40 hover:decoration-ink">
              New game
            </Link>
            <Link to="/" className="text-sm text-slate-700 underline decoration-dotted decoration-ink/40">
              Home
            </Link>
          </div>
        </div>

        {gameOver ? (
          <div className="shell-card bg-white rounded-3xl p-8 text-center space-y-3">
            <h2 className="text-2xl font-display font-bold">All rounds complete</h2>
            <p className="text-3xl font-black text-neon-blue">
              Score: {score} / {total}
            </p>
            <button
              onClick={() => {
                setRoundIdx(0);
                setScore(0);
              }}
              className="btn-ink px-5 py-2 rounded-xl"
            >
              Replay
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <div className="text-sm font-mono text-slate-700">
                Round {Math.min(roundIdx + 1, total || 1)} / {total || "?"}
              </div>
              <div className="text-sm font-semibold text-ink">
                Score: <span className="text-neon-pink">{score}</span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              {loading && <div className="col-span-3 text-center text-slate-500 font-mono">Picking weird tabs...</div>}
              {!loading &&
                cards.map((c, idx) => (
                  <div
                    key={idx}
                    className="shell-card rounded-2xl p-4 space-y-2 h-44 flex flex-col justify-between bg-white"
                  >
                    <div className="text-xs font-mono text-slate-600">{c.host}</div>
                    <p className="text-base font-display font-semibold text-ink leading-snug">"{c.title}"</p>
                  </div>
                ))}
            </div>

            <div className="shell-card rounded-3xl bg-white p-4 space-y-3">
              <p className="text-sm font-display font-bold">Whose history is this?</p>
              <div className="flex flex-wrap gap-2">
                {players.map((p) => {
                  const isCorrect = correctId && p.id === correctId;
                  return (
                    <button
                      key={p.id}
                      onClick={() => handleGuess(p.id)}
                      disabled={locked}
                      className={[
                        "px-4 py-2 rounded-lg border-2 text-sm font-semibold transition",
                        isCorrect
                          ? "border-emerald-500 bg-neon-green/40"
                          : "border-ink bg-white hover:-translate-y-0.5",
                      ].join(" ")}
                    >
                      {p.name || p.id}
                    </button>
                  );
                })}
              </div>
              <div className="text-sm font-semibold text-ink min-h-[24px]">{verdict}</div>
              {correctId && (
                <div className="flex justify-end">
                  <button
                    onClick={() => setRoundIdx((r) => r + 1)}
                    className="btn-ink px-4 py-2 rounded-full"
                  >
                    Next round →
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </main>
    </PageFrame>
  );
}
