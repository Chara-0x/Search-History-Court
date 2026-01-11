import { useEffect, useRef } from "react";
import "../game/match3.css";
import { mountMatch3 } from "../game/match3";

export default function LoadingGamePage() {
  const boardRef = useRef(null);
  const scoreRef = useRef(null);
  const resetRef = useRef(null);
  const bombBarRef = useRef(null);
  const bombTextRef = useRef(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    const cleanup = mountMatch3({
      boardEl: boardRef.current,
      scoreEl: scoreRef.current,
      resetBtn: resetRef.current,
      bombBarEl: bombBarRef.current,
      bombTextEl: bombTextRef.current,
      wrapEl: wrapRef.current,
    });
    return cleanup;
  }, []);

  return (
    <div className="match3">
      <div className="wrap">
        <div className="topbar">
          <div className="title">Match-3 Evidence</div>
          <div className="stats">
            <div>
              Score: <span ref={scoreRef}>0</span>
            </div>
            <button ref={resetRef}>Reset</button>
          </div>
        </div>

        <div className="progress-container">
          <div className="progress-label">
            Bomb Charge (Purple) <span ref={bombTextRef}>0/7</span>
          </div>
          <div className="progress-track">
            <div ref={bombBarRef} className="progress-fill" style={{ width: "0%" }}></div>
          </div>
        </div>

        <div className="board-wrap" ref={wrapRef}>
          <div ref={boardRef} className="board" aria-label="game board"></div>
        </div>
        <div className="hint">Match 3 to clear. Match Purple (7x) to spawn a Bomb 💣.</div>
      </div>
    </div>
  );
}
