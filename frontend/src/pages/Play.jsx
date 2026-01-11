import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import PageFrame from "../components/PageFrame";
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
    <PageFrame badge="Jury Mode" tag={`Case ${caseId || "?"}`}>
      <main className="space-y-10">
        <div className="flex flex-col items-center text-center gap-3">
          <p className="text-xs uppercase tracking-[0.3em] font-mono">Jury Mode</p>
          <h1 className="text-5xl md:text-6xl font-display font-black tracking-tight uppercase">
            Spot the <span className="text-neon-pink underline decoration-4 decoration-ink">Lie</span>
          </h1>
          <p className="font-mono text-slate-600 bg-white border-2 border-ink shadow-hard-sm px-3 py-1 text-xs uppercase tracking-[0.2em]">
            {isFinal ? "Final Verdict" : `Round ${Math.min(currentRound + 1, totalRounds || 1)} / ${totalRounds || "?"}`}
          </p>
        </div>

        {isFinal ? (
          <div className="shell-card p-10 text-center space-y-4 bg-white rounded-none">
            <h2 className="text-3xl font-display font-bold">Game Over</h2>
            <p className="text-4xl font-black text-neon-blue">{score} / {currentRound}</p>
            <button
              onClick={() => {
                setCurrentRound(0);
                setScore(0);
                setGameOver(false);
              }}
              className="btn-ink px-6 py-3"
            >
              Play again
            </button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6" id="cards-container">
              {loading && <div className="col-span-3 text-center text-slate-500 font-mono">Summoning evidence...</div>}
              {!loading &&
                cards.map((card, index) => {
                  const favUrl = `https://www.google.com/s2/favicons?domain=${card.host}&sz=64`;
                  const isSelected = selectedIndex === index;
                  const isLieCard = lieIndex !== null && lieIndex === index;
                  const wrongPick = isSelected && lieIndex !== null && !isLieCard;
                  const correctPick = isSelected && isLieCard;
                  const revealedLie = !isSelected && isLieCard && lieIndex !== null;

                  const base =
                    "relative shell-card rounded-none p-6 transition-all duration-300 flex flex-col items-center text-center h-72 justify-between bg-white";

                  const stateClass = (() => {
                    // Softer, badge-like colors similar to /me ready/need chips
                    if (correctPick) return "border-2 border-emerald-400 bg-neon-green/20 shadow-hard-sm";
                    if (wrongPick) return "border-2 border-alert-red/70 bg-neon-pink/10 shadow-hard-sm";
                    if (revealedLie) return "border-2 border-emerald-300 bg-neon-green/12 shadow-hard-sm";
                    if (isSelected) return "border-4 border-ink bg-neon-blue/12";
                    if (lieIndex !== null) return "opacity-80 border border-ink/30";
                    return "hover:-translate-y-1";
                  })();
                  return (
                    <button
                      key={index}
                      className={`${base} ${stateClass}`}
                      disabled={locked}
                      onClick={() => handleGuess(index)}
                    >
                      <div className="shell-tape absolute -top-3 left-1/2 -translate-x-1/2 w-24 h-8 rotate-1 opacity-70" />
                      <div className="w-14 h-14 rounded-full bg-slate-100 border-2 border-ink flex items-center justify-center mb-4 overflow-hidden">
                        <img src={favUrl} alt="icon" className="w-8 h-8 opacity-80" />
                      </div>
                      <h3 className="font-display font-bold text-xl leading-snug mb-2 line-clamp-3">"{card.title}"</h3>
                      <div className="text-xs font-mono text-slate-600 bg-slate-100 border border-ink px-2 py-1 mt-auto shadow-hard-sm rounded-none">{card.host}</div>

                      {lieIndex !== null && (
                        <div
                          className={[
                            "absolute top-3 right-3 text-[11px] font-mono uppercase px-2 py-1 border shadow-hard-sm",
                            correctPick || revealedLie
                              ? "bg-neon-green/30 text-emerald-800 border-emerald-400"
                              : wrongPick
                                ? "bg-neon-pink/20 text-alert-red border-alert-red/70"
                                : "bg-white text-ink border-ink/50"
                          ].join(" ")}
                        >
                          {correctPick ? "Correct" : wrongPick ? "Wrong" : isLieCard ? "The lie" : "Truth"}
                        </div>
                      )}
                    </button>
                  );
                })}
            </div>

            <div className="text-center mt-10 h-24 space-y-3">
              <p className="text-lg font-display font-bold" id="verdict-text">
                {verdict}
              </p>
              {lieIndex !== null && (
                <button
                  onClick={() => setCurrentRound((r) => r + 1)}
                  className="btn-ink px-8 py-3" id="next-btn"
                >
                  Next Round →
                </button>
              )}
            </div>
          </>
        )}
      </main>
    </PageFrame>
  );
}
