import { db, auth } from './firebase-config.js';
import { startGoogleSignIn, cancelGoogleSignIn, signOut, onAuthStateChanged } from './auth.js';
import {
  doc, collection, setDoc, updateDoc, getDoc, getDocs,
  onSnapshot, serverTimestamp, query, orderBy
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

// ── Clear any persisted Firebase session (best-effort, non-blocking).
// The signedInThisSession flag is the real guard — it ensures stale sessions
// from a previous launch can never bypass the auth screen.
signOut(auth).catch(() => {});

// ── State ─────────────────────────────────────────────────────────────────────
let currentGameId    = null;
let myPlayerNumber   = null;  // 1 or 2
let localGameData    = null;  // last Firestore snapshot
let unsubscribeGame  = null;
let gameOverHandled  = false;
let isWriting        = false; // prevents double-clicks during Firestore write
let pendingSignIn    = false; // true only while user is actively signing in
let signedInThisSession = false; // true only after user completes sign-in this launch
let gameStarted      = false; // prevents double-calling startOnlineGame
let waitingForDeltas = false; // Player 2 waits for Player 1 to write Elo deltas
let onlinePlayerRatings = { 1: 1200, 2: 1200 };

// ── DOM shortcuts ─────────────────────────────────────────────────────────────
const menu         = document.getElementById('menu');
const authScreen   = document.getElementById('auth-screen');
const onlineLobby  = document.getElementById('online-lobby');
const gameArea     = document.getElementById('game-area');
const gameOverDlg  = document.getElementById('game-over-dialog');
const leaderDlg    = document.getElementById('leaderboard-dialog');

// ── Entry: "Online Igra" button in main menu ──────────────────────────────────
// Only skip auth screen if the user signed in during THIS app session.
// Stale persisted sessions (from a previous launch) always go through auth.
document.getElementById('online-game-btn').addEventListener('click', () => {
  if (signedInThisSession && auth.currentUser) {
    showOnlineLobby(auth.currentUser);
  } else {
    menu.style.display = 'none';
    authScreen.style.display = 'flex';
  }
});

// ── Auth screen ───────────────────────────────────────────────────────────────
document.getElementById('sign-in-btn').addEventListener('click', () => {
  document.getElementById('auth-status').textContent = 'Otvaranje preglednika za prijavu...';
  pendingSignIn = true;
  startGoogleSignIn();
});

document.getElementById('auth-cancel-btn').addEventListener('click', () => {
  cancelGoogleSignIn();
  pendingSignIn = false;
  document.getElementById('auth-status').textContent = 'Prijavite se za online igru.';
  authScreen.style.display = 'none';
  menu.style.display = 'flex';
});

// Listen for successful sign-in (triggered by auth.js after OAuth callback).
// Only navigates to lobby when the user actively initiated sign-in (pendingSignIn flag).
// On cold start, signOut() above clears any stale session, so this won't fire spuriously.
onAuthStateChanged(auth, async (user) => {
  if (user && pendingSignIn) {
    pendingSignIn = false;
    signedInThisSession = true;
    try { await ensurePlayerProfile(user); } catch (e) { console.warn('Profile init failed:', e); }
    showOnlineLobby(user);
  }
});

async function ensurePlayerProfile(user) {
  const ref  = doc(db, 'players', user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      displayName: user.displayName || user.email,
      email:       user.email,
      rating:      1200,
      games: 0, wins: 0, losses: 0, draws: 0,
      updatedAt: serverTimestamp()
    });
  }
}

// ── Online lobby ──────────────────────────────────────────────────────────────
function showOnlineLobby(user) {
  authScreen.style.display  = 'none';
  menu.style.display        = 'none';
  gameArea.style.display    = 'none';
  onlineLobby.style.display = 'flex';

  document.getElementById('user-display-name').textContent = user.displayName || user.email;
  document.getElementById('create-game-options').style.display = 'none';
  document.getElementById('waiting-room').style.display        = 'none';
  document.getElementById('join-room-form').style.display      = 'none';
}

function backToLobby() {
  if (unsubscribeGame) { unsubscribeGame(); unsubscribeGame = null; }
  currentGameId   = null;
  myPlayerNumber  = null;
  localGameData   = null;
  gameOverHandled = false;
  gameStarted     = false;
  isWriting       = false;
  window.onlineMode = false;
  window.onlineHandleCellClick = undefined;
  window.onBackToMenuHook      = undefined;

  gameOverDlg.style.display = 'none';
  gameArea.style.display    = 'none';
  document.getElementById('name-dialog').style.display = 'none';

  const user = auth.currentUser;
  if (user) showOnlineLobby(user);
  else { onlineLobby.style.display = 'none'; menu.style.display = 'flex'; }
}

document.getElementById('sign-out-btn').addEventListener('click', () => {
  backToLobby();
  onlineLobby.style.display = 'none';
  signOut(auth);
  menu.style.display = 'flex';
});

document.getElementById('online-back-btn').addEventListener('click', () => {
  onlineLobby.style.display = 'none';
  menu.style.display = 'flex';
});

// ── Create game ───────────────────────────────────────────────────────────────
document.getElementById('create-game-btn').addEventListener('click', () => {
  document.getElementById('create-game-options').style.display = 'block';
  document.getElementById('waiting-room').style.display        = 'none';
  document.getElementById('join-room-form').style.display      = 'none';
});

document.getElementById('cancel-create-btn').addEventListener('click', () => {
  document.getElementById('create-game-options').style.display = 'none';
});

document.getElementById('confirm-create-btn').addEventListener('click', createGame);

async function createGame() {
  const user     = auth.currentUser;
  const gameCode = generateGameCode();
  const gameId   = 'game_' + gameCode;
  const size     = parseInt(document.getElementById('lobby-grid-size').value);

  try {
    await setDoc(doc(db, 'games', gameId), {
      gameCode,
      status:           'waiting',
      player1uid:       user.uid,
      player1name:      user.displayName || user.email,
      player2uid:       null,
      player2name:      null,
      gridSize:         size,
      currentPlayer:    1,
      phase:            'place',
      lastPlaces:       null,
      gameStateJSON:    null,
      placementHistory: { p1: [], p2: [] },
      result:           null,
      createdAt:        serverTimestamp()
    });
  } catch (err) {
    alert('Greška pri stvaranju igre: ' + err.message);
    return;
  }

  currentGameId  = gameId;
  myPlayerNumber = 1;

  document.getElementById('create-game-options').style.display = 'none';
  document.getElementById('room-code-display').textContent     = gameCode;
  document.getElementById('waiting-room').style.display        = 'block';

  // Wait for player 2 to join
  unsubscribeGame = onSnapshot(doc(db, 'games', gameId), (snap) => {
    if (!snap.exists()) return;
    const data = snap.data();
    if (data.status === 'active') startOnlineGame(data);
    if (data.status === 'cancelled') backToLobby();
  });
}

document.getElementById('cancel-wait-btn').addEventListener('click', async () => {
  if (unsubscribeGame) { unsubscribeGame(); unsubscribeGame = null; }
  if (currentGameId) {
    try { await updateDoc(doc(db, 'games', currentGameId), { status: 'cancelled' }); } catch (_) {}
    currentGameId = null;
  }
  document.getElementById('waiting-room').style.display = 'none';
});

// ── Join game ─────────────────────────────────────────────────────────────────
document.getElementById('join-game-btn').addEventListener('click', () => {
  document.getElementById('join-room-form').style.display      = 'block';
  document.getElementById('create-game-options').style.display = 'none';
  document.getElementById('waiting-room').style.display        = 'none';
  document.getElementById('room-code-input').value = '';
  document.getElementById('room-code-input').focus();
});

document.getElementById('cancel-join-btn').addEventListener('click', () => {
  document.getElementById('join-room-form').style.display = 'none';
});

document.getElementById('confirm-join-btn').addEventListener('click', joinGame);
document.getElementById('room-code-input').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') joinGame();
});

async function joinGame() {
  const code   = document.getElementById('room-code-input').value.toUpperCase().trim();
  if (!code) { alert('Unesite kod sobe!'); return; }

  const gameId = 'game_' + code;
  let snap;
  try {
    snap = await getDoc(doc(db, 'games', gameId));
  } catch (err) {
    alert('Greška pri pretraživanju: ' + err.message);
    return;
  }

  if (!snap.exists() || snap.data().status !== 'waiting') {
    alert('Soba nije pronađena ili je igra već počela.');
    return;
  }

  const user = auth.currentUser;
  try {
    await updateDoc(doc(db, 'games', gameId), {
      player2uid:  user.uid,
      player2name: user.displayName || user.email,
      status:      'active'
    });
  } catch (err) {
    alert('Greška pri pridruživanju: ' + err.message);
    return;
  }

  currentGameId  = gameId;
  myPlayerNumber = 2;
  document.getElementById('join-room-form').style.display = 'none';

  unsubscribeGame = onSnapshot(doc(db, 'games', gameId), (snap) => {
    if (!snap.exists()) return;
    const data = snap.data();
    if (gameArea.style.display !== 'block') {
      startOnlineGame(data);
    } else {
      renderGameState(data);
    }
  });
}

function generateGameCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// ── Start game on both clients ────────────────────────────────────────────────
async function startOnlineGame(data) {
  if (gameStarted) return;
  gameStarted = true;
  if (unsubscribeGame) unsubscribeGame();

  onlineLobby.style.display = 'none';
  gameArea.style.display    = 'block';
  gameOverHandled = false;

  // Set globals that script.js uses for rendering
  window.player1Name = data.player1name;
  window.player2Name = data.player2name;
  window.gridSize    = data.gridSize;

  // Fetch both players' current ratings for header display
  try {
    const [s1, s2] = await Promise.all([
      getDoc(doc(db, 'players', data.player1uid)),
      getDoc(doc(db, 'players', data.player2uid))
    ]);
    onlinePlayerRatings[1] = s1.data()?.rating ?? 1200;
    onlinePlayerRatings[2] = s2.data()?.rating ?? 1200;
  } catch (_) {
    onlinePlayerRatings = { 1: 1200, 2: 1200 };
  }

  // Override updatePlayerDisplays so it shows Firestore ratings, not localStorage ratings
  window.updatePlayerDisplays = () => {
    document.getElementById('player1-display').textContent =
      `${window.player1Name} (${onlinePlayerRatings[1]})`;
    document.getElementById('player2-display').textContent =
      `${window.player2Name} (${onlinePlayerRatings[2]})`;
  };

  // Hook: intercept cell clicks and route them through online logic
  window.onlineMode = true;
  window.onlineHandleCellClick = handleOnlineCellClick;

  // Hook: clean up when user clicks "Glavni Izbornik" in-game
  window.onBackToMenuHook = backToLobby;

  // Initialize empty board DOM (uses script.js globals)
  window.clearGame();
  window.initializeGame();

  // Subscribe to live game updates
  unsubscribeGame = onSnapshot(doc(db, 'games', currentGameId), (snap) => {
    if (!snap.exists()) return;
    renderGameState(snap.data());
  });
}

// ── Handle cell click — validate then write to Firestore ─────────────────────
async function handleOnlineCellClick(cell) {
  if (!localGameData || localGameData.status !== 'active') return;
  if (localGameData.currentPlayer !== myPlayerNumber) return;
  if (isWriting) return;

  const row = parseInt(cell.dataset.row);
  const col = parseInt(cell.dataset.col);

  const gs = window.gameState;
  if (gs[row][col].player !== null || gs[row][col].eliminated) return;

  if (localGameData.phase === 'place') {
    // Reuse adjacentCells from script.js (reads window.gameState)
    if (!window.adjacentCells(row, col)) {
      alert('Nevaljano postavljanje! Morate postaviti pokraj postojeće pločice ili na prazno polje.');
      return;
    }

    const newGs      = deepCopyState(gs);
    const newHistory = deepCopyHistory(window.placementHistory);
    newGs[row][col].player = myPlayerNumber;
    newHistory['p' + myPlayerNumber].push([row, col]);

    isWriting = true;
    try {
      await updateDoc(doc(db, 'games', currentGameId), {
        currentPlayer:    myPlayerNumber,
        phase:            'eliminate',
        lastPlaces:       { row, col },
        gameStateJSON:    JSON.stringify(newGs),
        placementHistory: newHistory
      });
    } finally { isWriting = false; }

  } else if (localGameData.phase === 'eliminate') {
    const lp     = localGameData.lastPlaces;
    const rowDiff = Math.abs(row - lp.row);
    const colDiff = Math.abs(col - lp.col);
    if (rowDiff > 1 || colDiff > 1 || (rowDiff === 0 && colDiff === 0)) {
      alert('Morate osjenčati susjednu ćeliju!');
      return;
    }

    const newGs      = deepCopyState(gs);
    const newHistory = deepCopyHistory(window.placementHistory);
    newGs[row][col].eliminated = true;

    const nextPlayer = myPlayerNumber === 1 ? 2 : 1;
    const result     = computeResult(newGs, window.gridSize);

    const update = {
      currentPlayer:    nextPlayer,
      phase:            'place',
      lastPlaces:       null,
      gameStateJSON:    JSON.stringify(newGs),
      placementHistory: newHistory
    };
    if (result) { update.result = result; update.status = 'finished'; }

    isWriting = true;
    try {
      await updateDoc(doc(db, 'games', currentGameId), update);
    } finally { isWriting = false; }
  }
}

// ── Render game state from Firestore snapshot ─────────────────────────────────
function renderGameState(data) {
  localGameData = data;

  // Player 2: show game-over dialog as soon as Elo deltas arrive from Player 1
  if (waitingForDeltas && data.result && data.result.delta1 != null) {
    waitingForDeltas = false;
    showGameOverDialog(data, data.result);
  }

  if (!data.gameStateJSON) {
    // Board not yet touched — just update status
    window.updateStatus();
    return;
  }

  // Sync local state from Firestore
  window.gameState        = JSON.parse(data.gameStateJSON);
  window.placementHistory = {
    1: (data.placementHistory.p1 || []).map(p => [...p]),
    2: (data.placementHistory.p2 || []).map(p => [...p])
  };
  window.currentPlayer = data.currentPlayer;
  window.phase         = data.phase;
  window.lastPlaces    = data.lastPlaces;

  // Re-render every cell from the synced state
  const gridEl = document.getElementById('grid');
  gridEl.querySelectorAll('[data-row]').forEach(cell => {
    const r = parseInt(cell.dataset.row);
    const c = parseInt(cell.dataset.col);
    const s = window.gameState[r][c];

    // Clear previous content but keep the cell element and its click listener
    cell.className = '';
    cell.innerHTML = '';

    if (s.eliminated) {
      cell.classList.add('eliminated');
    } else if (s.player) {
      const dot = document.createElement('div');
      dot.className = 'dot';
      dot.style.backgroundColor = s.player === 1 ? '#dc3545' : '#007bff';
      cell.appendChild(dot);
    }
  });

  window.drawConnections();
  window.updateStatus();
  window.updateScore();

  if (data.result && !gameOverHandled) {
    gameOverHandled = true;
    handleGameOver(data);
  }
}

// ── Game over — update ELO in Firestore, show dialog ─────────────────────────
async function handleGameOver(data) {
  const result = data.result;

  // Only player 1's client writes ELO (avoids race condition / double update)
  if (myPlayerNumber === 1) {
    const p1ref = doc(db, 'players', data.player1uid);
    const p2ref = doc(db, 'players', data.player2uid);
    try {
      const [snap1, snap2] = await Promise.all([getDoc(p1ref), getDoc(p2ref)]);
      const p1 = snap1.data();
      const p2 = snap2.data();

      // Reuse ELO constants and formula from script.js
      const scoreP1    = result.winner === 1 ? 1 : result.winner === 2 ? 0 : 0.5;
      const expectedP1 = window.getExpectedScore(p1.rating, p2.rating);
      const delta1     = Math.round(window.ELO_K_FACTOR * (scoreP1 - expectedP1));
      const delta2     = -delta1;
      const newR1      = Math.max(100, p1.rating + delta1);
      const newR2      = Math.max(100, p2.rating + delta2);

      await Promise.all([
        updateDoc(p1ref, {
          rating: newR1, games: p1.games + 1,
          wins:   scoreP1 === 1   ? p1.wins   + 1 : p1.wins,
          losses: scoreP1 === 0   ? p1.losses + 1 : p1.losses,
          draws:  scoreP1 === 0.5 ? p1.draws  + 1 : p1.draws,
          updatedAt: serverTimestamp()
        }),
        updateDoc(p2ref, {
          rating: newR2, games: p2.games + 1,
          wins:   scoreP1 === 0   ? p2.wins   + 1 : p2.wins,
          losses: scoreP1 === 1   ? p2.losses + 1 : p2.losses,
          draws:  scoreP1 === 0.5 ? p2.draws  + 1 : p2.draws,
          updatedAt: serverTimestamp()
        })
      ]);

      // Write deltas back to game doc so player 2 can show them too
      await updateDoc(doc(db, 'games', currentGameId), {
        'result.delta1': delta1, 'result.newR1': newR1,
        'result.delta2': delta2, 'result.newR2': newR2
      });

      onlinePlayerRatings[1] = newR1;
      onlinePlayerRatings[2] = newR2;
      showGameOverDialog(data, { ...result, delta1, delta2, newR1, newR2 });
    } catch (err) {
      console.error('ELO update error:', err);
      showGameOverDialog(data, result);
    }
  } else {
    // Player 2: wait for Player 1 to write Elo deltas via onSnapshot.
    // renderGameState will detect waitingForDeltas and show the dialog
    // as soon as the deltas arrive. Fallback timeout after 10s.
    waitingForDeltas = true;
    setTimeout(() => {
      if (waitingForDeltas) {
        waitingForDeltas = false;
        showGameOverDialog(data, localGameData?.result || result);
      }
    }, 10000);
  }
}

function showGameOverDialog(data, result) {
  const p1 = data.player1name;
  const p2 = data.player2name;
  const s1 = result.score1;
  const s2 = result.score2;
  const d1 = result.delta1 != null ? formatDelta(result.delta1) : '';
  const d2 = result.delta2 != null ? formatDelta(result.delta2) : '';
  const r1 = result.newR1  != null ? ` (${result.newR1})` : '';
  const r2 = result.newR2  != null ? ` (${result.newR2})` : '';

  const statusEl = document.getElementById('status');
  let message = '';

  if (result.winner === 0) {
    message = `Neriješeno! Oboje imate ${s1} povezanih pločica.`;
    statusEl.textContent = 'Neriješeno!';
    statusEl.style.color = '#6c757d';
  } else if (result.winner === 1) {
    message = `${p1} pobjeđuje s ${s1} povezanih pločica! (${p2}: ${s2})`;
    statusEl.textContent = `Pobjednik: ${p1}!`;
    statusEl.style.color = '#dc3545';
  } else {
    message = `${p2} pobjeđuje s ${s2} povezanih pločica! (${p1}: ${s1})`;
    statusEl.textContent = `Pobjednik: ${p2}!`;
    statusEl.style.color = '#007bff';
  }

  if (d1 || d2) {
    message += `\nRejting: ${p1} ${d1}${r1}, ${p2} ${d2}${r2}.`;
  }

  setTimeout(() => {
    const msgEl = document.getElementById('game-over-message');
    msgEl.textContent   = message;
    msgEl.style.whiteSpace = 'pre-line';
    gameOverDlg.style.display = 'flex';
  }, 1000);
}

// Override the game-over dialog buttons for online mode
// (In local mode these already go back to menu via script.js; in online mode
//  we need to go back to the online lobby instead.)
document.getElementById('new-game-after-btn').addEventListener('click', () => {
  if (window.onlineMode) { gameOverDlg.style.display = 'none'; backToLobby(); }
});
document.getElementById('menu-btn').addEventListener('click', () => {
  if (window.onlineMode) { gameOverDlg.style.display = 'none'; backToLobby(); }
});

// ── Online leaderboard ────────────────────────────────────────────────────────
document.getElementById('online-leaderboard-btn').addEventListener('click', showOnlineLeaderboard);

async function showOnlineLeaderboard() {
  const listEl = document.getElementById('leaderboard-list');
  listEl.textContent = 'Učitavanje...';
  leaderDlg.style.display = 'flex';

  try {
    const snap = await getDocs(query(collection(db, 'players'), orderBy('rating', 'desc')));
    const players = [];
    snap.forEach(d => players.push(d.data()));

    if (players.length === 0) {
      listEl.textContent = 'Još nema online igrača.';
    } else {
      listEl.innerHTML = players
        .map((p, i) =>
          `<div>${i + 1}. ${escHtml(p.displayName)} — ${p.rating} `+
          `(${p.wins ?? 0}/${p.draws ?? 0}/${p.losses ?? 0})</div>`
        )
        .join('');
    }
  } catch (err) {
    listEl.textContent = 'Greška: ' + err.message;
  }
}

function escHtml(v) {
  return String(v)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

// ── Game-over detection helper ────────────────────────────────────────────────
function computeResult(gs, size) {
  // Check if any valid placement move still exists
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      if (gs[i][j].player === null && !gs[i][j].eliminated) {
        for (let di = -1; di <= 1; di++) {
          for (let dj = -1; dj <= 1; dj++) {
            if (di === 0 && dj === 0) continue;
            const ni = i + di, nj = j + dj;
            if (ni >= 0 && ni < size && nj >= 0 && nj < size &&
                gs[ni][nj].player === null && !gs[ni][nj].eliminated) {
              return null; // game continues
            }
          }
        }
      }
    }
  }

  const s1 = biggestGroup(gs, 1, size);
  const s2 = biggestGroup(gs, 2, size);
  return { winner: s1 === s2 ? 0 : s1 > s2 ? 1 : 2, score1: s1, score2: s2 };
}

function biggestGroup(gs, player, size) {
  const visited = Array.from({ length: size }, () => new Array(size).fill(false));
  let best = 0;
  for (let i = 0; i < size; i++)
    for (let j = 0; j < size; j++)
      if (gs[i][j].player === player && !visited[i][j])
        best = Math.max(best, dfsg(gs, i, j, player, visited, size));
  return best;
}

function dfsg(gs, r, c, player, visited, size) {
  if (r < 0 || r >= size || c < 0 || c >= size) return 0;
  if (visited[r][c] || gs[r][c].player !== player) return 0;
  visited[r][c] = true;
  let n = 1;
  for (const [dr, dc] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]])
    n += dfsg(gs, r + dr, c + dc, player, visited, size);
  return n;
}

// ── Utility ───────────────────────────────────────────────────────────────────
function deepCopyState(gs) {
  return gs.map(row => row.map(cell => ({ ...cell })));
}

function deepCopyHistory(h) {
  return {
    p1: (h.p1 || h[1] || []).map(p => [...p]),
    p2: (h.p2 || h[2] || []).map(p => [...p])
  };
}

function formatDelta(d) { return d >= 0 ? `+${d}` : `${d}`; }