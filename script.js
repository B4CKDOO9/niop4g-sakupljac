const gridContainer = document.getElementById("grid");
let currentPlayer = 1;
let player1Name = "";
let player2Name = "";
let phase = "place";
let lastPlaces = null;
let gameState = [];
let placementHistory = { 1: [], 2: [] };
let gridSize = 6;
const STORAGE_KEY_PLAYERS = "sakupljac_players_v1";
const DEFAULT_FIDE_RATING = 1200;
const ELO_K_FACTOR = 32;

// Online multiplayer hook — set to true by online.js when an online game is active
let onlineMode = false;

// Elementi
const menu = document.getElementById("menu");
const nameDialog = document.getElementById("name-dialog");
const gameOverDialog = document.getElementById("game-over-dialog");
const leaderboardDialog = document.getElementById("leaderboard-dialog");
const rulesDialog = document.getElementById("rules-dialog");
const gameArea = document.getElementById("game-area");

// Electron IPC za menu bar akcije
if (typeof require !== "undefined") {
  const { ipcRenderer } = require("electron");

  ipcRenderer.on("menu-action", (event, action) => {
    switch (action) {
      case "new-game":
        if (gameArea.style.display === "block") {
          backToMenu();
        }
        showNameDialog();
        break;
      case "reset-game":
        if (gameArea.style.display === "block") {
          resetGame();
        }
        break;
      case "main-menu":
        backToMenu();
        break;
      case "show-rules":
        showRules();
        break;
    }
  });
}

// Gumbi
document
  .getElementById("new-game-btn")
  .addEventListener("click", showNameDialog);
document
  .getElementById("leaderboard-btn")
  .addEventListener("click", showLeaderboard);
document.getElementById("start-btn").addEventListener("click", startNewGame);
document.getElementById("cancel-btn").addEventListener("click", hideNameDialog);
document.getElementById("reset-btn").addEventListener("click", resetGame);
document
  .getElementById("back-to-menu-btn")
  .addEventListener("click", backToMenu);
document
  .getElementById("close-leaderboard-btn")
  .addEventListener("click", hideLeaderboard);
document.getElementById("close-rules-btn").addEventListener("click", hideRules);
document.getElementById("new-game-after-btn").addEventListener("click", () => {
  hideGameOverDialog();
  showNameDialog();
});
document.getElementById("menu-btn").addEventListener("click", () => {
  hideGameOverDialog();
  backToMenu();
});

// Omogući Enter tipku za pokretanje igre
document.getElementById("player2-name").addEventListener("keypress", (e) => {
  if (e.key === "Enter") {
    startNewGame();
  }
});

function showNameDialog() {
  menu.style.display = "none";
  nameDialog.style.display = "flex";
  document.getElementById("player1-name").value = player1Name || "";
  document.getElementById("player2-name").value = player2Name || "";
  document.getElementById("player1-name").focus();
}

function hideNameDialog() {
  nameDialog.style.display = "none";
  menu.style.display = "flex";
}

function showGameOverDialog(message) {
  const gameOverMessage = document.getElementById("game-over-message");
  gameOverMessage.textContent = message;
  gameOverMessage.style.whiteSpace = "pre-line";
  gameOverDialog.style.display = "flex";
}

function hideGameOverDialog() {
  gameOverDialog.style.display = "none";
}

function showLeaderboard() {
  const leaderboardList = document.getElementById("leaderboard-list");
  const players = Object.values(loadPlayersFromStorage()).sort((a, b) => {
    if (b.rating !== a.rating) return b.rating - a.rating;
    if (b.wins !== a.wins) return b.wins - a.wins;
    return a.name.localeCompare(b.name, "hr");
  });

  if (players.length === 0) {
    leaderboardList.textContent = "Nema spremljenih igrača.";
  } else {
    leaderboardList.innerHTML = players
      .map(
        (player, index) =>
          `<div>${index + 1}. ${escapeHtml(player.name)} - ${player.rating} (${player.wins}/${player.draws}/${player.losses})</div>`,
      )
      .join("");
  }

  leaderboardDialog.style.display = "flex";
}

function hideLeaderboard() {
  leaderboardDialog.style.display = "none";
}

function showRules() {
  rulesDialog.style.display = "flex";
}

function hideRules() {
  rulesDialog.style.display = "none";
}

function backToMenu() {
  if (typeof onBackToMenuHook === "function") { onBackToMenuHook(); return; }
  gameArea.style.display = "none";
  menu.style.display = "flex";
  hideLeaderboard();
  clearGame();
}

function startNewGame() {
  const p1Name = document.getElementById("player1-name").value.trim();
  const p2Name = document.getElementById("player2-name").value.trim();

  if (!p1Name || !p2Name) {
    alert("Molimo unesite oba imena igrača!");
    return;
  }

  player1Name = p1Name;
  player2Name = p2Name;
  gridSize = parseInt(document.getElementById("grid-size-select").value);

  ensurePlayerProfile(player1Name);
  ensurePlayerProfile(player2Name);

  nameDialog.style.display = "none";
  gameArea.style.display = "block";

  clearGame();
  initializeGame();
}

function resetGame() {
  if (confirm("Jeste li sigurni da želite resetirati igru?")) {
    clearGame();
    initializeGame();
  }
}

function clearGame() {
  gridContainer.innerHTML = "";
  gameState = [];
  currentPlayer = 1;
  phase = "place";
  lastPlaces = null;
  placementHistory = { 1: [], 2: [] };
}

function initializeGame() {
  updatePlayerDisplays();

  // Postavi grid CSS
  const cellPx = Math.floor(600 / gridSize);
  gridContainer.style.width = cellPx * gridSize + "px";
  gridContainer.style.height = cellPx * gridSize + "px";
  gridContainer.style.gridTemplateColumns = `repeat(${gridSize}, ${cellPx}px)`;

  // Postavi veličinu točkice
  const dotPx = Math.max(10, Math.floor(cellPx * 0.3));
  document.documentElement.style.setProperty("--dot-size", dotPx + "px");

  // Stvori mrežu
  for (let i = 0; i < gridSize; i++) {
    let row = [];
    for (let j = 0; j < gridSize; j++) {
      let cell = document.createElement("div");
      cell.dataset.row = i;
      cell.dataset.col = j;
      cell.style.width = cellPx + "px";
      cell.style.height = cellPx + "px";
      gridContainer.appendChild(cell);
      row.push({ player: null, eliminated: false });

      cell.addEventListener("click", function () {
        handleCellClick(this);
      });
    }
    gameState.push(row);
  }

  updateStatus();
  updateScore();
}

function handleCellClick(cell) {
  if (onlineMode && typeof onlineHandleCellClick === "function") {
    onlineHandleCellClick(cell);
    return;
  }

  const row = parseInt(cell.dataset.row);
  const col = parseInt(cell.dataset.col);

  if (gameState[row][col].player !== null || gameState[row][col].eliminated) {
    return;
  }

  if (phase === "place") {
    if (adjacentCells(row, col)) {
      gameState[row][col].player = currentPlayer;
      placementHistory[currentPlayer].push([row, col]);

      let dot = document.createElement("div");
      dot.className = "dot";
      dot.style.backgroundColor = currentPlayer === 1 ? "#dc3545" : "#007bff";
      cell.appendChild(dot);

      phase = "eliminate";
      lastPlaces = { row: row, col: col };
      updateStatus();
    } else {
      alert(
        "Nevaljano postavljanje! Morate postaviti pokraj postojeće pločice ili na prazno polje.",
      );
    }
  } else if (phase === "eliminate") {
    let rowDiff = Math.abs(row - lastPlaces.row);
    let colDiff = Math.abs(col - lastPlaces.col);

    if (rowDiff > 1 || colDiff > 1 || (rowDiff === 0 && colDiff === 0)) {
      alert("Morate osjenčati susjednu ćeliju!");
      return;
    }

    gameState[row][col].eliminated = true;
    cell.classList.add("eliminated");

    phase = "place";
    currentPlayer = currentPlayer === 1 ? 2 : 1;
    updateStatus();
    updateScore();
    checkGameOver();
  }
}

function updateStatus() {
  let name = currentPlayer === 1 ? player1Name : player2Name;
  let color = currentPlayer === 1 ? "#dc3545" : "#007bff";

  if (phase === "place") {
    document.getElementById("status").textContent = `${name} - Postavi pločicu`;
  } else {
    document.getElementById("status").textContent = `${name} - Osjenči ćeliju`;
  }

  document.getElementById("status").style.color = color;
}

function updateScore() {
  let p1 = getBiggestGroup(1);
  let p2 = getBiggestGroup(2);
  document.getElementById("player1-score").textContent = p1;
  document.getElementById("player2-score").textContent = p2;
  drawConnections();
}

function drawConnections() {
  const oldSvg = document.getElementById("connections-svg");
  if (oldSvg) oldSvg.remove();
  if (gameState.length === 0) return;

  const grid = document.getElementById("grid");
  const cellSize = Math.floor(600 / gridSize);
  const totalSize = cellSize * gridSize;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.id = "connections-svg";
  svg.setAttribute("width", grid.offsetWidth);
  svg.setAttribute("height", grid.offsetHeight);
  svg.setAttribute("width", totalSize);
  svg.setAttribute("height", totalSize);
  svg.style.position = "absolute";
  svg.style.top = "0";
  svg.style.left = "0";
  svg.style.pointerEvents = "none";
  svg.style.zIndex = "10";

  const playerColors = { 1: "#dc3545", 2: "#007bff" };

  function drawLine(r1, c1, r2, c2, color) {
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", (c1 + 0.5) * cellSize);
    line.setAttribute("y1", (r1 + 0.5) * cellSize);
    line.setAttribute("x2", (c2 + 0.5) * cellSize);
    line.setAttribute("y2", (r2 + 0.5) * cellSize);
    line.setAttribute("stroke", color);
    line.setAttribute("stroke-width", "3");
    line.setAttribute("stroke-linecap", "round");
    line.setAttribute("opacity", "0.6");
    svg.appendChild(line);
  }

  function isOrtho(r1, c1, r2, c2) {
    return (
      (Math.abs(r1 - r2) === 1 && c1 === c2) ||
      (r1 === r2 && Math.abs(c1 - c2) === 1)
    );
  }
  function isDiag(r1, c1, r2, c2) {
    return Math.abs(r1 - r2) === 1 && Math.abs(c1 - c2) === 1;
  }

  for (const player of [1, 2]) {
    const history = placementHistory[player];
    if (history.length < 2) continue;
    const color = playerColors[player];
    const n = history.length;

    // Union-Find
    const uf = Array.from({ length: n }, (_, i) => i);
    function find(x) {
      return uf[x] === x ? x : (uf[x] = find(uf[x]));
    }
    function union(a, b) {
      const pa = find(a),
        pb = find(b);
      if (pa === pb) return false;
      uf[pa] = pb;
      return true;
    }

    // Linije koje ćemo nacrtati: [i, j] parovi
    const lines = [];

    // Prolaz 1 i 2: za svaku točku, nađi najnovijeg susjednog u historiji (ortho prioritet)
    for (let i = 1; i < n; i++) {
      const [ri, ci] = history[i];
      let found = false;
      // ortho
      for (let j = i - 1; j >= 0; j--) {
        const [rj, cj] = history[j];
        if (isOrtho(ri, ci, rj, cj)) {
          union(i, j);
          lines.push([i, j]);
          found = true;
          break;
        }
      }
      if (!found) {
        // diag
        for (let j = i - 1; j >= 0; j--) {
          const [rj, cj] = history[j];
          if (isDiag(ri, ci, rj, cj)) {
            union(i, j);
            lines.push([i, j]);
            found = true;
            break;
          }
        }
      }
    }

    // Prolaz 3: spoji sve odvojene komponente koje imaju susjedne točke
    // Ponavljaj dok ima novih spajanja
    let changed = true;
    while (changed) {
      changed = false;
      // Ortho prvo
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          if (i === j || find(i) === find(j)) continue;
          const [ri, ci] = history[i],
            [rj, cj] = history[j];
          if (isOrtho(ri, ci, rj, cj)) {
            union(i, j);
            lines.push([i, j]);
            changed = true;
          }
        }
      }
      // Diag samo ako još ima odvojenih
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          if (i === j || find(i) === find(j)) continue;
          const [ri, ci] = history[i],
            [rj, cj] = history[j];
          if (isDiag(ri, ci, rj, cj)) {
            union(i, j);
            lines.push([i, j]);
            changed = true;
          }
        }
      }
    }

    // Dedupliraj linije (može biti duplikata) i nacrtaj
    const drawn = new Set();
    for (const [i, j] of lines) {
      const key = Math.min(i, j) + "," + Math.max(i, j);
      if (drawn.has(key)) continue;
      drawn.add(key);
      const [ri, ci] = history[i],
        [rj, cj] = history[j];
      drawLine(ri, ci, rj, cj, color);
    }
  }

  grid.appendChild(svg);
}

function getBiggestGroup(player) {
  let visited = [];
  for (let i = 0; i < gridSize; i++) {
    let row = [];
    for (let j = 0; j < gridSize; j++) {
      row.push(false);
    }
    visited.push(row);
  }

  let biggest = 0;
  for (let i = 0; i < gridSize; i++) {
    for (let j = 0; j < gridSize; j++) {
      if (gameState[i][j].player === player && !visited[i][j]) {
        let groupSize = dfs(i, j, player, visited);
        if (groupSize > biggest) {
          biggest = groupSize;
        }
      }
    }
  }
  return biggest;
}

function dfs(row, col, player, visited) {
  if (row < 0 || row >= gridSize || col < 0 || col >= gridSize) return 0;
  if (visited[row][col]) return 0;
  if (gameState[row][col].player !== player) return 0;

  visited[row][col] = true;
  let count = 1;

  // Provjeri svih 8 smjerova
  count += dfs(row - 1, col, player, visited);
  count += dfs(row + 1, col, player, visited);
  count += dfs(row, col - 1, player, visited);
  count += dfs(row, col + 1, player, visited);
  count += dfs(row - 1, col - 1, player, visited);
  count += dfs(row - 1, col + 1, player, visited);
  count += dfs(row + 1, col - 1, player, visited);
  count += dfs(row + 1, col + 1, player, visited);

  return count;
}

function checkGameOver() {
  // Provjeri ima li još validnih poteza
  for (let i = 0; i < gridSize; i++) {
    for (let j = 0; j < gridSize; j++) {
      if (
        gameState[i][j].player === null &&
        !gameState[i][j].eliminated &&
        adjacentCells(i, j)
      ) {
        return false;
      }
    }
  }

  // Igra je gotova
  let p1 = getBiggestGroup(1);
  let p2 = getBiggestGroup(2);
  const scoreP1 = p1 === p2 ? 0.5 : p1 > p2 ? 1 : 0;
  const ratingUpdate = updateRatingsAfterGame(
    player1Name,
    player2Name,
    scoreP1,
  );
  updatePlayerDisplays();
  let message = "";

  if (p1 === p2) {
    message = `Neriješeno! Oboje imate ${p1} povezanih pločica.\nRejting: ${player1Name} ${formatRatingDelta(ratingUpdate.delta1)} (${ratingUpdate.rating1}), ${player2Name} ${formatRatingDelta(ratingUpdate.delta2)} (${ratingUpdate.rating2}).`;
    document.getElementById("status").textContent = "Neriješeno!";
    document.getElementById("status").style.color = "#6c757d";
  } else if (p1 > p2) {
    message = `${player1Name} pobjeđuje s ${p1} povezanih pločica! (${player2Name}: ${p2})\nRejting: ${player1Name} ${formatRatingDelta(ratingUpdate.delta1)} (${ratingUpdate.rating1}), ${player2Name} ${formatRatingDelta(ratingUpdate.delta2)} (${ratingUpdate.rating2}).`;
    document.getElementById("status").textContent =
      `Pobjednik: ${player1Name}!`;
    document.getElementById("status").style.color = "#dc3545";
  } else {
    message = `${player2Name} pobjeđuje s ${p2} povezanih pločica! (${player1Name}: ${p1})\nRejting: ${player2Name} ${formatRatingDelta(ratingUpdate.delta2)} (${ratingUpdate.rating2}), ${player1Name} ${formatRatingDelta(ratingUpdate.delta1)} (${ratingUpdate.rating1}).`;
    document.getElementById("status").textContent =
      `Pobjednik: ${player2Name}!`;
    document.getElementById("status").style.color = "#007bff";
  }

  setTimeout(() => {
    showGameOverDialog(message);
  }, 1000);
}

function adjacentCells(row, col) {
  // Provjeri sve susjedne ćelije
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      if (i === 0 && j === 0) continue;

      let newRow = parseInt(row) + i;
      let newCol = parseInt(col) + j;

      if (
        newRow >= 0 &&
        newRow < gridSize &&
        newCol >= 0 &&
        newCol < gridSize
      ) {
        if (
          gameState[newRow][newCol].player === null &&
          !gameState[newRow][newCol].eliminated
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

function normalizePlayerKey(name) {
  return name.trim().toLocaleLowerCase("hr");
}

function loadPlayersFromStorage() {
  const raw = localStorage.getItem(STORAGE_KEY_PLAYERS);
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function savePlayersToStorage(players) {
  localStorage.setItem(STORAGE_KEY_PLAYERS, JSON.stringify(players));
}

function ensurePlayerProfile(name) {
  const key = normalizePlayerKey(name);
  const players = loadPlayersFromStorage();

  if (!players[key]) {
    players[key] = {
      id: key,
      name: name.trim(),
      rating: DEFAULT_FIDE_RATING,
      games: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      updatedAt: Date.now(),
    };
  } else {
    players[key].name = name.trim();
  }

  savePlayersToStorage(players);
  return players[key];
}

function getPlayerRating(name) {
  return ensurePlayerProfile(name).rating;
}

function getExpectedScore(ratingA, ratingB) {
  return 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
}

function updateRatingsAfterGame(player1, player2, scoreP1) {
  const players = loadPlayersFromStorage();
  const key1 = normalizePlayerKey(player1);
  const key2 = normalizePlayerKey(player2);

  if (!players[key1]) {
    players[key1] = {
      id: key1,
      name: player1.trim(),
      rating: DEFAULT_FIDE_RATING,
      games: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      updatedAt: Date.now(),
    };
  }

  if (!players[key2]) {
    players[key2] = {
      id: key2,
      name: player2.trim(),
      rating: DEFAULT_FIDE_RATING,
      games: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      updatedAt: Date.now(),
    };
  }

  const p1 = players[key1];
  const p2 = players[key2];

  const expectedP1 = getExpectedScore(p1.rating, p2.rating);
  const deltaP1 = Math.round(ELO_K_FACTOR * (scoreP1 - expectedP1));
  const deltaP2 = -deltaP1;

  p1.rating = Math.max(100, p1.rating + deltaP1);
  p2.rating = Math.max(100, p2.rating + deltaP2);
  p1.games += 1;
  p2.games += 1;

  if (scoreP1 === 1) {
    p1.wins += 1;
    p2.losses += 1;
  } else if (scoreP1 === 0) {
    p1.losses += 1;
    p2.wins += 1;
  } else {
    p1.draws += 1;
    p2.draws += 1;
  }

  p1.updatedAt = Date.now();
  p2.updatedAt = Date.now();
  savePlayersToStorage(players);

  return {
    delta1: deltaP1,
    delta2: deltaP2,
    rating1: p1.rating,
    rating2: p2.rating,
  };
}

function formatRatingDelta(delta) {
  return delta >= 0 ? `+${delta}` : `${delta}`;
}

function updatePlayerDisplays() {
  const player1Rating = getPlayerRating(player1Name);
  const player2Rating = getPlayerRating(player2Name);
  document.getElementById("player1-display").textContent =
    `${player1Name} (${player1Rating})`;
  document.getElementById("player2-display").textContent =
    `${player2Name} (${player2Rating})`;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getRatingsForFirestore() {
  return Object.values(loadPlayersFromStorage()).map((player) => ({
    id: player.id,
    name: player.name,
    rating: player.rating,
    games: player.games,
    wins: player.wins,
    losses: player.losses,
    draws: player.draws,
    updatedAt: player.updatedAt,
  }));
}

window.getRatingsForFirestore = getRatingsForFirestore;