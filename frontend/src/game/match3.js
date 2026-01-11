// Port of the existing vanilla JS mini-game into a reusable module for React.
export function mountMatch3({ boardEl, scoreEl, resetBtn, bombBarEl, bombTextEl, wrapEl }) {
  if (!boardEl || !scoreEl || !resetBtn || !wrapEl || !bombBarEl) {
    return () => {};
  }

  const SIZE = 8;
  const CELL_SIZE = 62; // 56px + 6px gap
  const COLORS = ["c1", "c2", "c3", "c4", "c5"];
  const BOMB_TYPE = "bomb";
  const PURPLE_TYPE = "c4";

  let popLayer = document.createElement("div");
  popLayer.id = "pop-layer";
  wrapEl.appendChild(popLayer);

  const bombText = bombTextEl || document.createElement("span");
  if (!bombText.parentElement) {
    const label = wrapEl.querySelector(".progress-label");
    label?.appendChild(bombText);
  }

  let grid = [];
  let tilesById = {};
  let nextId = 1;
  let score = 0;
  let isBusy = false;
  let purpleCount = 0;
  let pendingBombs = 0;
  let dragStart = null;
  let selectedTile = null;

  function getGradient(type) {
    const map = {
      c1: "linear-gradient(135deg, #ef4444, #b91c1c)",
      c2: "linear-gradient(135deg, #f59e0b, #d97706)",
      c3: "linear-gradient(135deg, #10b981, #047857)",
      c4: "linear-gradient(135deg, #8b5cf6, #6d28d9)",
      c5: "linear-gradient(135deg, #3b82f6, #1d4ed8)",
      [BOMB_TYPE]: "transparent",
    };
    return map[type] || "transparent";
  }

  function setVisualPos(el, r, c, scale = 1) {
    el.style.transform = `translate(${c * CELL_SIZE}px, ${r * CELL_SIZE}px) scale(${scale})`;
  }

  function createTile(r, c, type) {
    const id = nextId++;
    const el = document.createElement("div");
    el.className = "cell";
    if (type === BOMB_TYPE) el.classList.add("bomb");
    el.style.background = getGradient(type);
    setVisualPos(el, r, c);
    el.addEventListener("pointerdown", handlePointerDown);
    boardEl.appendChild(el);
    const tile = { id, r, c, type, el };
    tilesById[id] = tile;
    el.dataset.tid = id;
    return tile;
  }

  function causesMatch(r, c, type, currentRow, currentGrid) {
    if (c >= 2) {
      if (currentRow[c - 1].type === type && currentRow[c - 2].type === type) return true;
    }
    if (r >= 2) {
      if (currentGrid[r - 1][c].type === type && currentGrid[r - 2][c].type === type) return true;
    }
    return false;
  }

  function initGame() {
    isBusy = false;
    score = 0;
    purpleCount = 0;
    pendingBombs = 0;
    selectedTile = null;
    updateUI();
    boardEl.innerHTML = "";
    grid = [];
    tilesById = {};
    for (let r = 0; r < SIZE; r++) {
      const row = [];
      for (let c = 0; c < SIZE; c++) {
        let type;
        do {
          type = COLORS[Math.floor(Math.random() * COLORS.length)];
        } while (causesMatch(r, c, type, row, grid));
        const tile = createTile(r, c, type);
        row.push(tile);
      }
      grid.push(row);
    }
  }

  function handlePointerDown(e) {
    if (isBusy) return;
    const tId = e.target.dataset.tid;
    const tile = tilesById[tId];
    if (!tile) return;
    dragStart = {
      x: e.clientX,
      y: e.clientY,
      tile,
      origX: tile.c * CELL_SIZE,
      origY: tile.r * CELL_SIZE,
    };
    tile.el.classList.add("dragging");
    tile.el.setPointerCapture(e.pointerId);
    tile.el.addEventListener("pointermove", handlePointerMove);
    tile.el.addEventListener("pointerup", handlePointerUp);
    tile.el.style.transform = `translate(${dragStart.origX}px, ${dragStart.origY}px) scale(1.1)`;
  }

  function handlePointerMove(e) {
    if (!dragStart) return;
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    const newX = dragStart.origX + dx;
    const newY = dragStart.origY + dy;
    dragStart.tile.el.style.transform = `translate(${newX}px, ${newY}px) scale(1.1)`;
  }

  function handlePointerUp(e) {
    if (!dragStart) return;
    const tile = dragStart.tile;
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    tile.el.removeEventListener("pointermove", handlePointerMove);
    tile.el.removeEventListener("pointerup", handlePointerUp);
    tile.el.releasePointerCapture(e.pointerId);
    tile.el.classList.remove("dragging");
    dragStart = null;
    if (Math.abs(dx) > 30 || Math.abs(dy) > 30) {
      let r2 = tile.r;
      let c2 = tile.c;
      if (Math.abs(dx) > Math.abs(dy)) {
        c2 += dx > 0 ? 1 : -1;
      } else {
        r2 += dy > 0 ? 1 : -1;
      }
      attemptSwap(tile, r2, c2);
    } else {
      handleClick(tile);
    }
  }

  function handleClick(tile) {
    if (selectedTile === tile) {
      tile.el.classList.remove("selected");
      setVisualPos(tile.el, tile.r, tile.c, 1.0);
      selectedTile = null;
      return;
    }
    if (selectedTile) {
      const dist = Math.abs(tile.r - selectedTile.r) + Math.abs(tile.c - selectedTile.c);
      if (dist === 1) {
        const prev = selectedTile;
        prev.el.classList.remove("selected");
        setVisualPos(prev.el, prev.r, prev.c, 1.0);
        selectedTile = null;
        attemptSwap(prev, tile.r, tile.c);
      } else {
        selectedTile.el.classList.remove("selected");
        setVisualPos(selectedTile.el, selectedTile.r, selectedTile.c, 1.0);
        selectedTile = tile;
        tile.el.classList.add("selected");
        setVisualPos(tile.el, tile.r, tile.c, 0.9);
      }
    } else {
      selectedTile = tile;
      tile.el.classList.add("selected");
      setVisualPos(tile.el, tile.r, tile.c, 0.9);
    }
  }

  async function attemptSwap(t1, r2, c2) {
    setVisualPos(t1.el, t1.r, t1.c, 1.0);
    if (r2 < 0 || r2 >= SIZE || c2 < 0 || c2 >= SIZE) return;
    const t2 = grid[r2][c2];
    if (!t2) return;
    if (t1.type === BOMB_TYPE || t2.type === BOMB_TYPE) {
      if (t1.type === BOMB_TYPE && t2.type === BOMB_TYPE) return;
      const color = t1.type === BOMB_TYPE ? t2.type : t1.type;
      await triggerBomb(t1, t2, color);
      return;
    }
    isBusy = true;
    swapTilesData(t1, t2);
    setVisualPos(t1.el, t1.r, t1.c);
    setVisualPos(t2.el, t2.r, t2.c);
    await sleep(250);
    const matches = findMatches();
    if (matches.length > 0) {
      await processMatches(matches, 1);
    } else {
      swapTilesData(t1, t2);
      setVisualPos(t1.el, t1.r, t1.c);
      setVisualPos(t2.el, t2.r, t2.c);
      await sleep(250);
    }
    isBusy = false;
  }

  function swapTilesData(t1, t2) {
    grid[t1.r][t1.c] = t2;
    grid[t2.r][t2.c] = t1;
    const tr = t1.r;
    const tc = t1.c;
    t1.r = t2.r;
    t1.c = t2.c;
    t2.r = tr;
    t2.c = tc;
  }

  async function triggerBomb(t1, t2, targetColor) {
    isBusy = true;
    setVisualPos(t1.el, t2.r, t2.c);
    setVisualPos(t2.el, t1.r, t1.c);
    await sleep(300);
    const hits = [];
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (grid[r][c].type === targetColor) hits.push(grid[r][c]);
      }
    }
    if (!hits.includes(t1)) hits.push(t1);
    if (!hits.includes(t2)) hits.push(t2);
    showFloat("BOMB!", "txt-bomb");
    await removeTiles(hits);
    await fillBoard(2);
    isBusy = false;
  }

  async function processMatches(matches, combo) {
    score += matches.length * 10 * combo;
    if (combo > 1) showFloat(`COMBO x${combo}`, "txt-nice");
    else if (matches.length >= 4) showFloat("SPLENDID!", "txt-huge");
    else showFloat(["Good!", "Pop!", "Nice!"][Math.floor(Math.random() * 3)], "txt-std");

    let pDelta = 0;
    matches.forEach((t) => {
      if (t.type === PURPLE_TYPE) pDelta++;
    });
    if (pDelta > 0) {
      purpleCount += pDelta;
      if (purpleCount >= 7) {
        pendingBombs += Math.floor(purpleCount / 7);
        purpleCount %= 7;
        showFloat("BOMB READY!", "txt-bomb");
      }
    }
    updateUI();
    await removeTiles(matches);
    await fillBoard(combo);
  }

  async function removeTiles(tiles) {
    tiles.forEach((t) => {
      t.el.style.transform = `translate(${t.c * CELL_SIZE}px, ${t.r * CELL_SIZE}px) scale(0)`;
      t.el.classList.add("pop-anim");
    });
    await sleep(280);
    tiles.forEach((t) => {
      t.el.remove();
      delete tilesById[t.id];
      grid[t.r][t.c] = null;
    });
  }

  async function fillBoard(comboMultiplier) {
    for (let c = 0; c < SIZE; c++) {
      for (let r = SIZE - 1; r >= 0; r--) {
        if (grid[r][c] === null) {
          for (let k = r - 1; k >= 0; k--) {
            if (grid[k][c] !== null) {
              const t = grid[k][c];
              grid[r][c] = t;
              grid[k][c] = null;
              t.r = r;
              setVisualPos(t.el, t.r, t.c);
              break;
            }
          }
        }
      }
    }
    await sleep(200);
    for (let c = 0; c < SIZE; c++) {
      for (let r = 0; r < SIZE; r++) {
        if (grid[r][c] === null) {
          let type = COLORS[Math.floor(Math.random() * COLORS.length)];
          if (pendingBombs > 0) {
            type = BOMB_TYPE;
            pendingBombs--;
          }
          const t = createTile(r, c, type);
          grid[r][c] = t;
          t.el.style.transition = "none";
          t.el.style.transform = `translate(${c * CELL_SIZE}px, -${SIZE * CELL_SIZE}px)`;
          t.el.offsetHeight;
          t.el.style.transition = "transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.2s";
          setVisualPos(t.el, r, c);
        }
      }
    }
    await sleep(250);
    const nextMatches = findMatches();
    if (nextMatches.length > 0) {
      await processMatches(nextMatches, comboMultiplier + 1);
    }
  }

  function findMatches() {
    const matched = new Set();
    for (let r = 0; r < SIZE; r++) {
      let matchLen = 1;
      for (let c = 0; c < SIZE; c++) {
        const curr = grid[r][c];
        const next = c < SIZE - 1 ? grid[r][c + 1] : null;
        if (curr && next && curr.type === next.type && curr.type !== BOMB_TYPE) {
          matchLen++;
        } else {
          if (matchLen >= 3) {
            for (let k = 0; k < matchLen; k++) matched.add(grid[r][c - k]);
          }
          matchLen = 1;
        }
      }
    }
    for (let c = 0; c < SIZE; c++) {
      let matchLen = 1;
      for (let r = 0; r < SIZE; r++) {
        const curr = grid[r][c];
        const next = r < SIZE - 1 ? grid[r + 1][c] : null;
        if (curr && next && curr.type === next.type && curr.type !== BOMB_TYPE) {
          matchLen++;
        } else {
          if (matchLen >= 3) {
            for (let k = 0; k < matchLen; k++) matched.add(grid[r - k][c]);
          }
          matchLen = 1;
        }
      }
    }
    return Array.from(matched);
  }

  function updateUI() {
    scoreEl.innerText = score;
    if (bombText) bombText.innerText = `${purpleCount}/7`;
    const pct = Math.min(100, (purpleCount / 7) * 100);
    bombBarEl.style.width = `${pct}%`;
  }

  function showFloat(text, cls) {
    const el = document.createElement("div");
    el.className = `float-msg float-anim ${cls}`;
    el.innerText = text;
    popLayer.appendChild(el);
    el.addEventListener("animationend", () => el.remove());
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  resetBtn.addEventListener("click", initGame);
  initGame();

  return () => {
    resetBtn.removeEventListener("click", initGame);
    popLayer.remove();
    boardEl.innerHTML = "";
  };
}
