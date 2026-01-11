const SIZE = 8;
const CELL_SIZE = 62; // 56px + 6px gap
const COLORS = ["c1", "c2", "c3", "c4", "c5"];
const BOMB_TYPE = "bomb";
const PURPLE_TYPE = "c4";

const boardEl = document.getElementById("board");
const scoreEl = document.getElementById("score");
const resetBtn = document.getElementById("reset");
const bombBar = document.getElementById("bomb-bar");
const bombText = document.querySelector(".progress-label span:last-child") || 
                 document.createElement("span");

// Append score text to label if missing
if (!bombText.parentElement) {
  document.querySelector(".progress-label").appendChild(bombText);
}

// Global State
let grid = []; // 2D array of Tile Objects
let tilesById = {}; // Map for quick lookup
let nextId = 1;
let score = 0;
let isBusy = false;
let purpleCount = 0;
let pendingBombs = 0;

// Drag State
let dragStart = null; // { x, y, tile, startX, startY }

// --- INITIALIZATION ---

function initGame() {
  isBusy = false;
  score = 0;
  purpleCount = 0;
  pendingBombs = 0;
  updateUI();
  
  boardEl.innerHTML = "";
  grid = [];
  tilesById = {};
  
  // Smart Generation: Ensure no matches created initially
  for (let r = 0; r < SIZE; r++) {
    const row = [];
    for (let c = 0; c < SIZE; c++) {
      let type;
      do {
        type = COLORS[Math.floor(Math.random() * COLORS.length)];
      } while (causesMatch(r, c, type, row));
      
      const tile = createTile(r, c, type);
      row.push(tile);
    }
    grid.push(row);
  }
}

function causesMatch(r, c, type, currentRow) {
  // Check Horizontal (left 2)
  if (c >= 2) {
    if (currentRow[c-1].type === type && currentRow[c-2].type === type) return true;
  }
  // Check Vertical (up 2)
  if (r >= 2) {
    if (grid[r-1][c].type === type && grid[r-2][c].type === type) return true;
  }
  return false;
}

function createTile(r, c, type) {
  const id = nextId++;
  const el = document.createElement("div");
  
  el.className = "cell";
  if (type === BOMB_TYPE) el.classList.add("bomb");
  el.style.background = getGradient(type);
  
  // Position
  setVisualPos(el, r, c);
  
  // Events
  el.addEventListener("pointerdown", handlePointerDown);
  
  boardEl.appendChild(el);
  
  const tile = { id, r, c, type, el };
  tilesById[id] = tile;
  // Link element to tile for events
  el.dataset.tid = id;
  
  return tile;
}

function getGradient(type) {
  const map = {
    c1: "linear-gradient(135deg, #ef4444, #b91c1c)", // Red
    c2: "linear-gradient(135deg, #f59e0b, #d97706)", // Orange
    c3: "linear-gradient(135deg, #10b981, #047857)", // Green
    c4: "linear-gradient(135deg, #8b5cf6, #6d28d9)", // Purple
    c5: "linear-gradient(135deg, #3b82f6, #1d4ed8)", // Blue
    [BOMB_TYPE]: "transparent"
  };
  return map[type] || "transparent";
}

function setVisualPos(el, r, c) {
  el.style.transform = `translate(${c * CELL_SIZE}px, ${r * CELL_SIZE}px)`;
}

// --- INPUT HANDLING ---

let selectedTile = null;

function handlePointerDown(e) {
  if (isBusy) return;
  const tId = e.target.dataset.tid;
  const tile = tilesById[tId];
  if (!tile) return;

  dragStart = {
    x: e.clientX,
    y: e.clientY,
    tile: tile,
    initialTransform: tile.el.style.transform
  };
  
  tile.el.classList.add("dragging");
  tile.el.setPointerCapture(e.pointerId);
  tile.el.addEventListener("pointermove", handlePointerMove);
  tile.el.addEventListener("pointerup", handlePointerUp);
}

function handlePointerMove(e) {
  if (!dragStart) return;
  
  const dx = e.clientX - dragStart.x;
  const dy = e.clientY - dragStart.y;
  
  // Visual Follow
  // We need to calculate current base pos + delta
  const baseX = dragStart.tile.c * CELL_SIZE;
  const baseY = dragStart.tile.r * CELL_SIZE;
  dragStart.tile.el.style.transform = `translate(${baseX + dx}px, ${baseY + dy}px)`;
}

function handlePointerUp(e) {
  if (!dragStart) return;
  
  const tile = dragStart.tile;
  const dx = e.clientX - dragStart.x;
  const dy = e.clientY - dragStart.y;
  
  // Cleanup events
  tile.el.removeEventListener("pointermove", handlePointerMove);
  tile.el.removeEventListener("pointerup", handlePointerUp);
  tile.el.releasePointerCapture(e.pointerId);
  tile.el.classList.remove("dragging");
  
  dragStart = null;
  
  // Determine if Drag or Click
  if (Math.abs(dx) > 30 || Math.abs(dy) > 30) {
    // It's a Drag
    let r2 = tile.r;
    let c2 = tile.c;
    
    if (Math.abs(dx) > Math.abs(dy)) {
      if (dx > 0) c2++; else c2--;
    } else {
      if (dy > 0) r2++; else r2--;
    }
    
    attemptSwap(tile, r2, c2);
  } else {
    // It's a Click
    // Snap back to original position visually (CSS transition will handle it)
    setVisualPos(tile.el, tile.r, tile.c);
    handleClick(tile);
  }
}

function handleClick(tile) {
  if (selectedTile === tile) {
    // Deselect
    tile.el.classList.remove("selected");
    selectedTile = null;
    return;
  }
  
  if (selectedTile) {
    // Check adjacency
    const dist = Math.abs(tile.r - selectedTile.r) + Math.abs(tile.c - selectedTile.c);
    if (dist === 1) {
      selectedTile.el.classList.remove("selected");
      attemptSwap(selectedTile, tile.r, tile.c);
      selectedTile = null;
    } else {
      selectedTile.el.classList.remove("selected");
      selectedTile = tile;
      tile.el.classList.add("selected");
    }
  } else {
    selectedTile = tile;
    tile.el.classList.add("selected");
  }
}

async function attemptSwap(t1, r2, c2) {
  // Boundary Check
  if (r2 < 0 || r2 >= SIZE || c2 < 0 || c2 >= SIZE) {
    setVisualPos(t1.el, t1.r, t1.c); // Reset
    return;
  }
  
  const t2 = grid[r2][c2];
  
  // Bomb Check
  if (t1.type === BOMB_TYPE || t2.type === BOMB_TYPE) {
    // If double bomb
    if(t1.type === BOMB_TYPE && t2.type === BOMB_TYPE) {
        // Just reset for now (or implement super explosion)
        setVisualPos(t1.el, t1.r, t1.c);
        return; 
    }
    const color = (t1.type === BOMB_TYPE) ? t2.type : t1.type;
    await triggerBomb(t1, t2, color);
    return;
  }

  isBusy = true;
  
  // 1. Swap Data
  swapTilesData(t1, t2);
  
  // 2. Animate Swap
  setVisualPos(t1.el, t1.r, t1.c);
  setVisualPos(t2.el, t2.r, t2.c);
  
  await sleep(250);
  
  // 3. Check Matches
  const matches = findMatches();
  
  if (matches.length > 0) {
    await processMatches(matches, 1);
  } else {
    // Invalid: Swap Back
    swapTilesData(t1, t2);
    setVisualPos(t1.el, t1.r, t1.c);
    setVisualPos(t2.el, t2.r, t2.c);
    await sleep(250);
  }
  
  isBusy = false;
}

function swapTilesData(t1, t2) {
  // Swap grid pointers
  grid[t1.r][t1.c] = t2;
  grid[t2.r][t2.c] = t1;
  
  // Swap internal coordinates
  const tr = t1.r, tc = t1.c;
  t1.r = t2.r; t1.c = t2.c;
  t2.r = tr; t2.c = tc;
}

// --- GAME LOGIC ---

async function triggerBomb(t1, t2, targetColor) {
  isBusy = true;
  
  // Visual Swap First
  setVisualPos(t1.el, t2.r, t2.c); 
  setVisualPos(t2.el, t1.r, t1.c);
  await sleep(300);

  // Find all matching color tiles
  const hits = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (grid[r][c].type === targetColor) {
        hits.push(grid[r][c]);
      }
    }
  }
  
  // Include the bomb itself (and the other tile if it's the color)
  if(!hits.includes(t1)) hits.push(t1);
  if(!hits.includes(t2)) hits.push(t2);

  showFloat("BOMB!", "txt-bomb");
  await removeTiles(hits);
  await fillBoard(2);
  
  isBusy = false;
}

async function processMatches(matches, combo) {
  // Score & Text
  score += matches.length * 10 * combo;
  updateUI();
  
  if (combo > 1) showFloat(`COMBO x${combo}`, "txt-nice");
  else if (matches.length >= 4) showFloat("SPLENDID!", "txt-huge");
  else showFloat(["Good!", "Pop!", "Nice!"][Math.floor(Math.random()*3)], "txt-std");
  
  // Purple Logic
  let pDelta = 0;
  matches.forEach(t => {
    if (t.type === PURPLE_TYPE) pDelta++;
  });
  
  if (pDelta > 0) {
    purpleCount += pDelta;
    if (purpleCount >= 7) {
      pendingBombs += Math.floor(purpleCount / 7);
      purpleCount %= 7;
      showFloat("BOMB READY!", "txt-bomb");
    }
    updateUI();
  }

  // Remove
  await removeTiles(matches);
  
  // Refill
  await fillBoard(combo);
}

async function removeTiles(tiles) {
  // Add animation class
  tiles.forEach(t => t.el.classList.add("pop-anim"));
  await sleep(280);
  
  // Remove from grid
  tiles.forEach(t => {
    t.el.remove();
    delete tilesById[t.id];
    grid[t.r][t.c] = null; // Mark empty
  });
}

async function fillBoard(comboMultiplier) {
  // 1. Drop Down
  for (let c = 0; c < SIZE; c++) {
    for (let r = SIZE - 1; r >= 0; r--) {
      if (grid[r][c] === null) {
        // Find nearest tile above
        for (let k = r - 1; k >= 0; k--) {
          if (grid[k][c] !== null) {
            // Move it down
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

  // 2. Spawn New
  const newTiles = [];
  for (let c = 0; c < SIZE; c++) {
    for (let r = 0; r < SIZE; r++) {
      if (grid[r][c] === null) {
        let type = COLORS[Math.floor(Math.random() * COLORS.length)];
        
        // Check Bomb Queue
        if (pendingBombs > 0) {
          type = BOMB_TYPE;
          pendingBombs--;
        }
        
        const t = createTile(r, c, type);
        grid[r][c] = t;
        
        // Animation: Start from above
        t.el.style.transition = 'none';
        t.el.style.transform = `translate(${c * CELL_SIZE}px, -${(SIZE*CELL_SIZE)}px)`;
        t.el.offsetHeight; // force reflow
        t.el.style.transition = 'transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1)';
        setVisualPos(t.el, r, c);
      }
    }
  }
  
  await sleep(250);
  
  // 3. Check for new matches
  const nextMatches = findMatches();
  if (nextMatches.length > 0) {
    await processMatches(nextMatches, comboMultiplier + 1);
  }
}

function findMatches() {
  const matchedTiles = new Set();
  
  // Horizontal
  for (let r = 0; r < SIZE; r++) {
    let matchLen = 1;
    for (let c = 0; c < SIZE; c++) {
      const isLast = (c === SIZE - 1);
      const curr = grid[r][c];
      const next = !isLast ? grid[r][c+1] : null;
      
      if (!isLast && curr && next && curr.type === next.type && curr.type !== BOMB_TYPE) {
        matchLen++;
      } else {
        if (matchLen >= 3) {
          for (let k = 0; k < matchLen; k++) matchedTiles.add(grid[r][c - k]);
        }
        matchLen = 1;
      }
    }
  }
  
  // Vertical
  for (let c = 0; c < SIZE; c++) {
    let matchLen = 1;
    for (let r = 0; r < SIZE; r++) {
      const isLast = (r === SIZE - 1);
      const curr = grid[r][c];
      const next = !isLast ? grid[r+1][c] : null;
      
      if (!isLast && curr && next && curr.type === next.type && curr.type !== BOMB_TYPE) {
        matchLen++;
      } else {
        if (matchLen >= 3) {
          for (let k = 0; k < matchLen; k++) matchedTiles.add(grid[r - k][c]);
        }
        matchLen = 1;
      }
    }
  }
  
  return Array.from(matchedTiles);
}

// --- UTILS ---

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
  
  // Add to pop layer
  const layer = document.getElementById("pop-layer") || boardEl.parentElement;
  layer.appendChild(el);
  
  el.addEventListener("animationend", () => el.remove());
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

resetBtn.addEventListener("click", initGame);

// Start
initGame();