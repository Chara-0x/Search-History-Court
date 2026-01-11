const SIZE = 8;
const CELL_SIZE = 62; 
const COLORS = ["c1", "c2", "c3", "c4", "c5"];
const BOMB_TYPE = "bomb";
const PURPLE_TYPE = "c4";

const boardEl = document.getElementById("board");
const scoreEl = document.getElementById("score");
const resetBtn = document.getElementById("reset");
const bombBar = document.getElementById("bomb-bar");

// Setup Floating Layer
let popLayer = document.getElementById("pop-layer");
if (!popLayer) {
  popLayer = document.createElement("div");
  popLayer.id = "pop-layer";
  document.querySelector(".board-wrap").appendChild(popLayer);
}

const bombText = document.querySelector(".progress-label span:last-child") || 
                 document.createElement("span");
if (!bombText.parentElement) {
  document.querySelector(".progress-label").appendChild(bombText);
}

// Global State
let grid = [];
let tilesById = {}; 
let nextId = 1;
let score = 0;
let isBusy = false;
let purpleCount = 0;
let pendingBombs = 0;

let dragStart = null; 
let selectedTile = null;

// --- INITIALIZATION ---

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
  
  // Smart Generation
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

function causesMatch(r, c, type, currentRow, currentGrid) {
  if (c >= 2 && currentRow[c-1].type === type && currentRow[c-2].type === type) return true;
  if (r >= 2 && currentGrid[r-1][c].type === type && currentGrid[r-2][c].type === type) return true;
  return false;
}

function createTile(r, c, type) {
  const id = nextId++;
  const el = document.createElement("div");
  
  el.className = "cell";
  if (type === BOMB_TYPE) el.classList.add("bomb");
  el.style.background = getGradient(type);
  
  // Initial Position (Instant)
  el.style.transform = `translate(${c * CELL_SIZE}px, ${r * CELL_SIZE}px)`;
  
  // Events
  el.addEventListener("pointerdown", handlePointerDown);
  
  boardEl.appendChild(el);
  
  const tile = { id, r, c, type, el };
  tilesById[id] = tile;
  el.dataset.tid = id;
  
  return tile;
}

function getGradient(type) {
  const map = {
    c1: "linear-gradient(135deg, #ef4444, #b91c1c)",
    c2: "linear-gradient(135deg, #f59e0b, #d97706)",
    c3: "linear-gradient(135deg, #10b981, #047857)",
    c4: "linear-gradient(135deg, #8b5cf6, #6d28d9)",
    c5: "linear-gradient(135deg, #3b82f6, #1d4ed8)",
    [BOMB_TYPE]: "transparent"
  };
  return map[type] || "transparent";
}

// --- ANIMATION HELPERS (Anime.js) ---

function animateTile(tile, r, c, scale = 1, duration = 250) {
  // Stop dragging interactions if any
  anime.remove(tile.el);
  
  return anime({
    targets: tile.el,
    translateX: c * CELL_SIZE,
    translateY: r * CELL_SIZE,
    scale: scale,
    opacity: 1,
    easing: 'easeOutQuad',
    duration: duration
  }).finished;
}

function setVisualScale(tile, scale) {
  anime({
    targets: tile.el,
    scale: scale,
    duration: 150,
    easing: 'easeOutQuad'
  });
}

// --- INPUT HANDLING ---

function handlePointerDown(e) {
  if (isBusy) return;
  const tId = e.target.dataset.tid;
  const tile = tilesById[tId];
  if (!tile) return;

  // Stop any ongoing animations on this tile
  anime.remove(tile.el);

  dragStart = {
    x: e.clientX,
    y: e.clientY,
    tile: tile,
    origX: tile.c * CELL_SIZE,
    origY: tile.r * CELL_SIZE
  };
  
  tile.el.classList.add("dragging");
  tile.el.setPointerCapture(e.pointerId);
  tile.el.addEventListener("pointermove", handlePointerMove);
  tile.el.addEventListener("pointerup", handlePointerUp);
  
  // Slight instant scale for feedback
  tile.el.style.transform = `translate(${dragStart.origX}px, ${dragStart.origY}px) scale(1.1)`;
}

function handlePointerMove(e) {
  if (!dragStart) return;
  const dx = e.clientX - dragStart.x;
  const dy = e.clientY - dragStart.y;
  const newX = dragStart.origX + dx;
  const newY = dragStart.origY + dy;
  
  // Direct DOM manipulation for lag-free drag
  dragStart.tile.el.style.transform = `translate(${newX}px, ${newY}px) scale(1.1)`;
}

function handlePointerUp(e) {
  if (!dragStart) return;
  const tile = dragStart.tile;
  const dx = e.clientX - dragStart.x;
  const dy = e.clientY - dragStart.y;
  
  // Cleanup
  tile.el.removeEventListener("pointermove", handlePointerMove);
  tile.el.removeEventListener("pointerup", handlePointerUp);
  tile.el.releasePointerCapture(e.pointerId);
  tile.el.classList.remove("dragging");
  dragStart = null;
  
  // Drag Threshold
  if (Math.abs(dx) > 30 || Math.abs(dy) > 30) {
    let r2 = tile.r;
    let c2 = tile.c;
    if (Math.abs(dx) > Math.abs(dy)) {
      if (dx > 0) c2++; else c2--;
    } else {
      if (dy > 0) r2++; else r2--;
    }
    attemptSwap(tile, r2, c2);
  } else {
    // Snap back and select
    handleClick(tile);
  }
}

function handleClick(tile) {
  if (selectedTile === tile) {
    // Deselect
    tile.el.classList.remove("selected");
    animateTile(tile, tile.r, tile.c, 1.0, 150);
    selectedTile = null;
    return;
  }
  
  if (selectedTile) {
    const dist = Math.abs(tile.r - selectedTile.r) + Math.abs(tile.c - selectedTile.c);
    if (dist === 1) {
      const prev = selectedTile;
      prev.el.classList.remove("selected");
      // Scale back to 1 before swap
      setVisualScale(prev, 1.0);
      selectedTile = null;
      attemptSwap(prev, tile.r, tile.c);
    } else {
      // Change Selection
      selectedTile.el.classList.remove("selected");
      setVisualScale(selectedTile, 1.0);
      
      selectedTile = tile;
      tile.el.classList.add("selected");
      setVisualScale(tile, 0.9);
    }
  } else {
    // Select
    selectedTile = tile;
    tile.el.classList.add("selected");
    setVisualScale(tile, 0.9);
  }
}

async function attemptSwap(t1, r2, c2) {
  // Bounds
  if (r2 < 0 || r2 >= SIZE || c2 < 0 || c2 >= SIZE) {
    animateTile(t1, t1.r, t1.c); // Snap back
    return;
  }
  
  const t2 = grid[r2][c2];
  if (!t2) { animateTile(t1, t1.r, t1.c); return; }

  // Bomb Interaction
  if (t1.type === BOMB_TYPE || t2.type === BOMB_TYPE) {
    if(t1.type === BOMB_TYPE && t2.type === BOMB_TYPE) {
        animateTile(t1, t1.r, t1.c); return; // Double bomb not impl
    }
    const color = (t1.type === BOMB_TYPE) ? t2.type : t1.type;
    await triggerBomb(t1, t2, color);
    return;
  }

  isBusy = true;
  
  // Logic Swap
  swapTilesData(t1, t2);
  
  // Animate Swap
  const p1 = animateTile(t1, t1.r, t1.c);
  const p2 = animateTile(t2, t2.r, t2.c);
  await Promise.all([p1, p2]);
  
  // Check Matches
  const matches = findMatches(); // This detects 5-matches now
  
  if (matches.length > 0) {
    await processMatches(matches, 1);
  } else {
    // Invalid -> Undo
    swapTilesData(t1, t2);
    const u1 = animateTile(t1, t1.r, t1.c);
    const u2 = animateTile(t2, t2.r, t2.c);
    await Promise.all([u1, u2]);
  }
  
  isBusy = false;
}

function swapTilesData(t1, t2) {
  grid[t1.r][t1.c] = t2;
  grid[t2.r][t2.c] = t1;
  const tr = t1.r, tc = t1.c;
  t1.r = t2.r; t1.c = t2.c;
  t2.r = tr; t2.c = tc;
}

// --- GAME LOGIC ---

async function triggerBomb(t1, t2, targetColor) {
  isBusy = true;
  // Animate Swap First
  await Promise.all([
    animateTile(t1, t2.r, t2.c),
    animateTile(t2, t1.r, t1.c)
  ]);

  const hits = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (grid[r][c].type === targetColor) hits.push(grid[r][c]);
    }
  }
  // Include involved tiles
  if(!hits.includes(t1)) hits.push(t1);
  if(!hits.includes(t2)) hits.push(t2);

  showFloat("BOMB!", "txt-bomb");
  await removeTiles(hits);
  await fillBoard(2);
  isBusy = false;
}

async function processMatches(matches, combo) {
  score += matches.length * 10 * combo;
  
  // Feedback
  if (combo > 1) showFloat(`COMBO x${combo}`, "txt-nice");
  else if (matches.length >= 5) showFloat("5 MATCH!", "txt-huge"); // Special text
  else if (matches.length === 4) showFloat("SPLENDID!", "txt-huge");
  else showFloat(["Good!", "Pop!", "Nice!"][Math.floor(Math.random()*3)], "txt-std");
  
  // Purple Logic
  let pDelta = 0;
  matches.forEach(t => { if (t.type === PURPLE_TYPE) pDelta++; });
  if (pDelta > 0) {
    purpleCount += pDelta;
    if (purpleCount >= 7) {
      pendingBombs += Math.floor(purpleCount / 7);
      purpleCount %= 7;
      showFloat("BOMB CHARGED!", "txt-bomb");
    }
  }
  updateUI();

  await removeTiles(matches);
  await fillBoard(combo);
}

async function removeTiles(tiles) {
  // Use Anime.js to scale out
  const els = tiles.map(t => t.el);
  await anime({
    targets: els,
    scale: 0,
    opacity: 0,
    duration: 300,
    easing: 'easeInBack'
  }).finished;
  
  // Clean Data
  tiles.forEach(t => {
    t.el.remove();
    delete tilesById[t.id];
    grid[t.r][t.c] = null;
  });
}

async function fillBoard(comboMultiplier) {
  // 1. Drop existing
  const moves = [];
  for (let c = 0; c < SIZE; c++) {
    for (let r = SIZE - 1; r >= 0; r--) {
      if (grid[r][c] === null) {
        for (let k = r - 1; k >= 0; k--) {
          if (grid[k][c] !== null) {
            const t = grid[k][c];
            grid[r][c] = t;
            grid[k][c] = null;
            t.r = r;
            // Queue animation
            moves.push(animateTile(t, t.r, t.c));
            break;
          }
        }
      }
    }
  }
  if(moves.length) await Promise.all(moves);

  // 2. Spawn New
  const spawns = [];
  for (let c = 0; c < SIZE; c++) {
    for (let r = 0; r < SIZE; r++) {
      if (grid[r][c] === null) {
        let type = COLORS[Math.floor(Math.random() * COLORS.length)];
        if (pendingBombs > 0) { type = BOMB_TYPE; pendingBombs--; }
        
        const t = createTile(r, c, type);
        grid[r][c] = t;
        
        // Prepare for entry animation
        // Start above the board
        const startY = -((SIZE - r) * CELL_SIZE); 
        t.el.style.transform = `translate(${c * CELL_SIZE}px, ${startY}px)`;
        t.el.style.opacity = '0';
        
        // Animate in
        spawns.push(anime({
          targets: t.el,
          translateY: r * CELL_SIZE,
          opacity: 1,
          duration: 400,
          easing: 'easeOutBounce',
          delay: r * 50 // Stagger drop
        }).finished);
      }
    }
  }
  if(spawns.length) await Promise.all(spawns);
  
  // 3. Check for new matches
  const nextMatches = findMatches();
  if (nextMatches.length > 0) {
    await processMatches(nextMatches, comboMultiplier + 1);
  }
}

function findMatches() {
  const matched = new Set();
  
  // Horizontal
  for (let r = 0; r < SIZE; r++) {
    let matchLen = 1;
    for (let c = 0; c < SIZE; c++) {
      const curr = grid[r][c];
      const next = (c < SIZE - 1) ? grid[r][c+1] : null;
      if (curr && next && curr.type === next.type && curr.type !== BOMB_TYPE) {
        matchLen++;
      } else {
        if (matchLen >= 3) {
          // --- 5-MATCH BOMB LOGIC ---
          if (matchLen >= 5) {
            pendingBombs++;
            showFloat("5-MATCH! BOMB!", "txt-bomb");
          }
          // --------------------------
          for (let k = 0; k < matchLen; k++) matched.add(grid[r][c-k]);
        }
        matchLen = 1;
      }
    }
  }
  
  // Vertical
  for (let c = 0; c < SIZE; c++) {
    let matchLen = 1;
    for (let r = 0; r < SIZE; r++) {
      const curr = grid[r][c];
      const next = (r < SIZE - 1) ? grid[r+1][c] : null;
      if (curr && next && curr.type === next.type && curr.type !== BOMB_TYPE) {
        matchLen++;
      } else {
        if (matchLen >= 3) {
          // --- 5-MATCH BOMB LOGIC ---
          if (matchLen >= 5) {
            pendingBombs++;
            showFloat("5-MATCH! BOMB!", "txt-bomb");
          }
          // --------------------------
          for (let k = 0; k < matchLen; k++) matched.add(grid[r-k][c]);
        }
        matchLen = 1;
      }
    }
  }
  return Array.from(matched);
}

function updateUI() {
  scoreEl.innerText = score;
  bombText.innerText = `${purpleCount}/7`;
  const pct = Math.min(100, (purpleCount / 7) * 100);
  bombBar.style.width = `${pct}%`;
}

function showFloat(text, cls) {
  const el = document.createElement("div");
  el.className = `float-msg float-anim ${cls}`;
  el.innerText = text;
  popLayer.appendChild(el);
  el.addEventListener("animationend", () => el.remove());
}

resetBtn.addEventListener("click", initGame);
initGame();