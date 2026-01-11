import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { fetchRound, submitGuess } from "../api/client";

export default function PlayPage() {
  const { caseId } = useParams();
  const [currentRound, setCurrentRound] = useState(0);
  const [totalRounds, setTotalRounds] = useState(0);
  const [cards, setCards] = useState([]);
  const [verdict, setVerdict] = useState("");
  const [locked, setLocked] = useState(false);
  const [score, setScore] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(null);
  const [lieIndex, setLieIndex] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadRound();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRound]);

  async function loadRound() {
    setLoading(true);
    setLocked(false);
    setSelectedIndex(null);
    setLieIndex(null);
    setVerdict("");
    try {
      const data = await fetchRound(caseId, currentRound);
      if (!data.ok || !data.cards) throw new Error("Game over");
      setCards(data.cards);
      setTotalRounds(data.total || 0);
      setGameOver(false);
    } catch (err) {
      setGameOver(true);
    } finally {
      setLoading(false);
    }
  }

  async function handleGuess(idx) {
    if (locked || gameOver) return;
    setLocked(true);
    setSelectedIndex(idx);
    try {
      const res = await submitGuess(caseId, currentRound, idx);
      setLieIndex(res.lie_index);
      if (res.correct) {
        setScore((s) => s + 1);
        setVerdict("Correct! That was a dirty lie.");
      } else {
        setVerdict("Objection! That was actually in their history.");
      }
    } catch (err) {
      setVerdict("Could not submit guess.");
    }
  }

  const isFinal = gameOver || currentRound >= totalRounds;

  return (
    <div className="bg-slate-50 text-slate-800 min-h-screen flex flex-col items-center justify-center p-4">
      <main className="w-full max-w-4xl">
        <div className="text-center mb-8">
          <p className="text-xs uppercase tracking-[0.28em] text-indigo-500 font-semibold">Jury Mode</p>
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">
            Spot the <span className="text-indigo-600">Lie</span>
          </h1>
          <p className="text-slate-400 font-medium uppercase text-sm tracking-widest mt-2">
            {isFinal ? "Final Verdict" : `Round ${Math.min(currentRound + 1, totalRounds || 1)} / ${totalRounds || "?"}`}
          </p>
        </div>

        {isFinal ? (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 text-center">
            <h2 className="text-2xl font-bold mb-2">Game Over</h2>
            <p className="text-xl text-indigo-600 font-bold">
              Score: {score} / {currentRound}
            </p>
            <button
              onClick={() => {
                setCurrentRound(0);
                setScore(0);
                setGameOver(false);
              }}
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800"
            >
              Play again
            </button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6" id="cards-container">
              {loading && <div className="col-span-3 text-center text-slate-400">Summoning evidence...</div>}
              {!loading &&
                cards.map((card, index) => {
                  const favUrl = `https://www.google.com/s2/favicons?domain=${card.host}&sz=64`;
                  const isSelected = selectedIndex === index;
                  const isCorrectReveal = lieIndex !== null && lieIndex === index && !isSelected;
                  const wrongPick = isSelected && lieIndex !== null && lieIndex !== index;
                  const base =
                    "bg-white rounded-xl p-6 shadow-sm border transition-all duration-300 flex flex-col items-center text-center h-64 justify-between";
                  const stateClass = isSelected
                    ? "border-2 border-emerald-500 bg-emerald-50"
                    : wrongPick
                      ? "border-2 border-rose-500 bg-rose-50"
                      : isCorrectReveal
                        ? "border-2 border-emerald-500 bg-emerald-50"
                        : "border-slate-200 hover:-translate-y-1";
                  return (
                    <button
                      key={index}
                      className={`${base} ${stateClass}`}
                      disabled={locked}
                      onClick={() => handleGuess(index)}
                    >
                      <div className="w-12 h-12 rounded-full bg-slate-50 border border-slate-100 flex items-center justify-center mb-4 overflow-hidden">
                        <img src={favUrl} alt="icon" className="w-8 h-8 opacity-80" />
                      </div>
                      <h3 className="font-bold text-slate-800 text-lg leading-snug mb-2 line-clamp-3">"{card.title}"</h3>
                      <div className="text-xs font-mono text-slate-400 bg-slate-100 px-2 py-1 rounded mt-auto">{card.host}</div>
                    </button>
                  );
                })}
            </div>

            <div className="text-center mt-10 h-20 space-y-3">
              <p className="text-lg font-bold" id="verdict-text">
                {verdict}
              </p>
              {lieIndex !== null && (
                <button
                  onClick={() => setCurrentRound((r) => r + 1)}
                  className="px-8 py-3 bg-slate-900 text-white rounded-full font-bold shadow-lg hover:bg-slate-800"
                  id="next-btn"
                >
                  Next Round →
                </button>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
