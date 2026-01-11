
const SIZE = 8;
const COLORS = ["c1","c2","c3","c4","c5"];
const boardEl = document.getElementById("board");
const scoreEl = document.getElementById("score");
const resetBtn = document.getElementById("reset");

let grid = [];
let selected = null;
let score = 0;
let busy = false;

function randColor(){
  return COLORS[Math.floor(Math.random() * COLORS.length)];
}

function adjacent(a,b){
  const dr = Math.abs(a.r - b.r);
  const dc = Math.abs(a.c - b.c);
  return (dr + dc) === 1;
}

function initGrid(){
  grid = Array.from({length: SIZE}, () =>
    Array.from({length: SIZE}, () => randColor())
  );
  while (findMatches().length > 0){
    grid = Array.from({length: SIZE}, () =>
      Array.from({length: SIZE}, () => randColor())
    );
  }
}

function colorToGradient(color){
  const map = {
    c1: "linear-gradient(135deg, #ff6b6b, #c81d25)",
    c2: "linear-gradient(135deg, #ffd166, #f77f00)",
    c3: "linear-gradient(135deg, #06d6a0, #118ab2)",
    c4: "linear-gradient(135deg, #9b5de5, #5a189a)",
    c5: "linear-gradient(135deg, #4cc9f0, #4361ee)",
    empty: "transparent"
  };
  return map[color] ?? "transparent";
}

function render(){
  boardEl.innerHTML = "";
  for(let r=0;r<SIZE;r++){
    for(let c=0;c<SIZE;c++){
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.dataset.r = r;
      cell.dataset.c = c;

      const v = grid[r][c];
      cell.style.background = colorToGradient(v || "empty");

      if(selected && selected.r===r && selected.c===c){
        cell.classList.add("selected");
      }

      cell.addEventListener("click", onCellClick);
      boardEl.appendChild(cell);
    }
  }
  scoreEl.textContent = String(score);
}

function onCellClick(e){
  if(busy) return;
  const r = Number(e.currentTarget.dataset.r);
  const c = Number(e.currentTarget.dataset.c);

  if(!selected){
    selected = {r,c};
    render();
    return;
  }

  const second = {r,c};

  if(selected.r === second.r && selected.c === second.c){
    selected = null;
    render();
    return;
  }

  if(!adjacent(selected, second)){
    selected = second;
    render();
    return;
  }

  swap(selected, second);
  const matches = findMatches();
  if(matches.length === 0){
    swap(selected, second);
    selected = null;
    render();
    return;
  }

  selected = null;
  resolveBoard();
}

function swap(a,b){
  const tmp = grid[a.r][a.c];
  grid[a.r][a.c] = grid[b.r][b.c];
  grid[b.r][b.c] = tmp;
}

function findMatches(){
  const toClear = [];

  // horizontal
  for(let r=0;r<SIZE;r++){
    let start = 0;
    while(start < SIZE){
      let end = start + 1;
      while(end < SIZE && grid[r][end] && grid[r][end] === grid[r][start]){
        end++;
      }
      const len = end - start;
      if(grid[r][start] && len >= 3){
        for(let c=start;c<end;c++) toClear.push({r,c});
      }
      start = end;
    }
  }

  // vertical
  for(let c=0;c<SIZE;c++){
    let start = 0;
    while(start < SIZE){
      let end = start + 1;
      while(end < SIZE && grid[end][c] && grid[end][c] === grid[start][c]){
        end++;
      }
      const len = end - start;
      if(grid[start][c] && len >= 3){
        for(let r=start;r<end;r++) toClear.push({r,c});
      }
      start = end;
    }
  }

  // unique
  const seen = new Set();
  const uniq = [];
  for(const p of toClear){
    const k = `${p.r},${p.c}`;
    if(!seen.has(k)){
      seen.add(k);
      uniq.push(p);
    }
  }
  return uniq;
}

async function resolveBoard(){
  busy = true;

  while(true){
    const matches = findMatches();
    if(matches.length === 0) break;

    score += matches.length * 10;

render();

// 播放爆破动画
playPopAnimation(matches);

// 等动画播放完再真正清空
await sleep(190);

for(const p of matches){
  grid[p.r][p.c] = null;
}
render();
await sleep(120);

    

    dropDown();
    render();
    await sleep(150);

    refill();
    render();
    await sleep(150);
  }

  busy = false;
}

function dropDown(){
  for(let c=0;c<SIZE;c++){
    let write = SIZE - 1;
    for(let r=SIZE-1;r>=0;r--){
      if(grid[r][c] != null){
        grid[write][c] = grid[r][c];
        if(write !== r) grid[r][c] = null;
        write--;
      }
    }
    for(let r=write;r>=0;r--){
      grid[r][c] = null;
    }
  }
}

function refill(){
  for(let r=0;r<SIZE;r++){
    for(let c=0;c<SIZE;c++){
      if(grid[r][c] == null) grid[r][c] = randColor();
    }
  }
}

function sleep(ms){
  return new Promise(res => setTimeout(res, ms));
}

function reset(){
  score = 0;
  selected = null;
  busy = false;
  initGrid();
  render();
}

function getCellEl(r, c){
  return boardEl.querySelector(`.cell[data-r="${r}"][data-c="${c}"]`);
}

function playPopAnimation(matches){
  for(const p of matches){
    const el = getCellEl(p.r, p.c);
    if(el) el.classList.add("cell-pop");
  }
}

resetBtn.addEventListener("click", reset);

reset();
function showPop(text, x, y, type = "good") {
  const layer = document.getElementById("pop-layer");
  const el = document.createElement("div");
  el.className = `float-pop ${type}`;
  el.textContent = text;

  el.style.left = `${x}px`;
  el.style.top  = `${y}px`;

  layer.appendChild(el);

  el.addEventListener("animationend", () => el.remove());
}
