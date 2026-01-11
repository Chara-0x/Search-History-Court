import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fetchRouletteRound, submitRouletteGuess } from "../api/client";

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
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col">
      <main className="max-w-5xl mx-auto w-full px-6 py-10 flex-1">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-6">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-indigo-500 font-semibold">Roulette Jury</p>
            <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Guess the Owner</h1>
            <p className="text-slate-500 text-sm">Game ID: {gameId}</p>
          </div>
          <div className="flex gap-2 items-center">
            <Link to="/roulette" className="text-sm text-indigo-600 hover:underline">
              New game
            </Link>
            <Link to="/" className="text-sm text-slate-500 hover:underline">
              Home
            </Link>
          </div>
        </div>

        {gameOver ? (
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-8 text-center">
            <h2 className="text-2xl font-bold mb-2">All rounds complete</h2>
            <p className="text-lg text-indigo-600 font-bold">
              Score: {score} / {total}
            </p>
            <button
              onClick={() => {
                setRoundIdx(0);
                setScore(0);
              }}
              className="mt-4 px-4 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800"
            >
              Replay
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-5">
              <div className="text-sm text-slate-500">
                Round {Math.min(roundIdx + 1, total || 1)} / {total || "?"}
              </div>
              <div className="text-sm font-semibold text-slate-900">
                Score: <span className="text-indigo-600">{score}</span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              {loading && <div className="col-span-3 text-center text-slate-400">Picking weird tabs...</div>}
              {!loading &&
                cards.map((c, idx) => (
                  <div
                    key={idx}
                    className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 space-y-2 h-40 flex flex-col justify-between"
                  >
                    <div className="text-xs font-mono text-slate-500">{c.host}</div>
                    <p className="text-base font-semibold text-slate-900 leading-snug">"{c.title}"</p>
                  </div>
                ))}
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 space-y-3">
              <p className="text-sm font-semibold text-slate-900">Whose history is this?</p>
              <div className="flex flex-wrap gap-2">
                {players.map((p) => {
                  const isCorrect = correctId && p.id === correctId;
                  return (
                    <button
                      key={p.id}
                      onClick={() => handleGuess(p.id)}
                      disabled={locked}
                      className={[
                        "px-4 py-2 rounded-lg border text-sm font-semibold transition",
                        isCorrect
                          ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                          : "border-slate-200 bg-slate-50 hover:bg-slate-100",
                      ].join(" ")}
                    >
                      {p.name || p.id}
                    </button>
                  );
                })}
              </div>
              <div className="text-sm font-semibold text-slate-800 min-h-[24px]">{verdict}</div>
              {correctId && (
                <div className="flex justify-end">
                  <button
                    onClick={() => setRoundIdx((r) => r + 1)}
                    className="px-4 py-2 rounded-full bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800"
                  >
                    Next round →
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
