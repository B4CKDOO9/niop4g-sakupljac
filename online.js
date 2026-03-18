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
let gameMode            = null;   // 'casual' or 'ranked'
let onlineTimerEnabled  = false;  // whether this game has a turn timer
const ELO_K_FACTOR = 32;  // mirror of script.js (const doesn't go on window)
let turnTimer = null;
let turnTimerSeconds = 30;
const TURN_TIME_LIMIT = 30;
const MAX_CONSECUTIVE_TIMEOUTS = 3;

// ── DOM shortcuts ─────────────────────────────────────────────────────────────
const menu         = document.getElementById('menu');
const authScreen   = document.getElementById('auth-screen');
const onlineLobby  = document.getElementById('online-lobby');
const gameArea     = document.getElementById('game-area');
const gameOverDlg  = document.getElementById('game-over-dialog');
const leaderDlg    = document.getElementById('leaderboard-dialog');
const timerEl      = document.getElementById('turn-timer');

// ── Capture-phase click listener on #grid — intercepts clicks in online mode
// before script.js's per-cell listeners can fire (event delegation pattern).
document.getElementById('grid').addEventListener('click', (e) => {
  if (!window.onlineMode) return;
  const cell = e.target.closest('[data-row]');
  if (!cell) return;
  e.stopPropagation();
  handleOnlineCellClick(cell);
}, true);

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

async function backToLobby() {
  clearTurnTimer();
  // Notify the other player by marking the game as 'left' and recording who left
  if (currentGameId && localGameData && (localGameData.status === 'active' || localGameData.status === 'finished')) {
    const update = { status: 'left' };
    if (localGameData.status === 'active' && auth.currentUser) {
      update.leftBy = auth.currentUser.uid;
      // Penalize own ELO before notifying the other player
      await selfPenalizeLeaver(localGameData);
    }
    updateDoc(doc(db, 'games', currentGameId), update).catch(() => {});
  }
  if (unsubscribeGame) { unsubscribeGame(); unsubscribeGame = null; }
  currentGameId   = null;
  myPlayerNumber  = null;
  localGameData   = null;
  gameOverHandled = false;
  gameStarted     = false;
  isWriting          = false;
  gameMode           = null;
  onlineTimerEnabled = false;
  window.onlineMode = false;
  window.onlineHandleCellClick = undefined;
  window.onBackToMenuHook      = undefined;

  gameOverDlg.style.display = 'none';
  gameArea.style.display    = 'none';
  document.getElementById('name-dialog').style.display = 'none';
  document.getElementById('reset-btn').style.display = '';

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
function showCreateOptions(mode) {
  gameMode = mode;
  document.getElementById('create-game-options').style.display = 'block';
  document.getElementById('waiting-room').style.display        = 'none';
  document.getElementById('join-room-form').style.display      = 'none';

  const isCasual = mode === 'casual';
  document.getElementById('create-mode-label').textContent = isCasual ? 'Casual Igra' : 'Ranked Igra';
  document.getElementById('casual-options').style.display  = isCasual ? 'block' : 'none';
  document.getElementById('ranked-info').style.display     = isCasual ? 'none'  : 'block';
}

document.getElementById('create-casual-btn').addEventListener('click', () => showCreateOptions('casual'));
document.getElementById('create-ranked-btn').addEventListener('click', () => showCreateOptions('ranked'));

document.getElementById('cancel-create-btn').addEventListener('click', () => {
  document.getElementById('create-game-options').style.display = 'none';
});

document.getElementById('confirm-create-btn').addEventListener('click', createGame);

async function createGame() {
  const user     = auth.currentUser;
  const gameCode = generateGameCode();
  const gameId   = 'game_' + gameCode;
  const isRanked = gameMode === 'ranked';
  const size     = isRanked ? 8 : parseInt(document.getElementById('lobby-grid-size').value);
  const timer    = isRanked ? true : document.getElementById('online-timer-checkbox').checked;

  try {
    await setDoc(doc(db, 'games', gameId), {
      gameCode,
      mode:             gameMode,
      status:           'waiting',
      player1uid:       user.uid,
      player1name:      user.displayName || user.email,
      player2uid:       null,
      player2name:      null,
      gridSize:         size,
      timerEnabled:     timer,
      currentPlayer:    1,
      phase:            'place',
      lastPlaces:       null,
      gameStateJSON:    null,
      placementHistory: { p1: [], p2: [] },
      timeouts:         { p1: 0, p2: 0 },
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
  gameMode           = data.mode || 'ranked';
  onlineTimerEnabled = data.timerEnabled !== false;

  // Set globals that script.js uses for rendering
  window.player1Name = data.player1name;
  window.player2Name = data.player2name;
  window.gridSize    = data.gridSize;

  // Override updatePlayerDisplays — show ratings only for ranked
  window.updatePlayerDisplays = () => {
    const suffix1 = gameMode === 'ranked' ? ` (${onlinePlayerRatings[1]})` : '';
    const suffix2 = gameMode === 'ranked' ? ` (${onlinePlayerRatings[2]})` : '';
    document.getElementById('player1-display').textContent = window.player1Name + suffix1;
    document.getElementById('player2-display').textContent = window.player2Name + suffix2;
  };

  // Hide reset button in online mode
  document.getElementById('reset-btn').style.display = 'none';

  // ESSENTIAL: Set online mode hooks BEFORE initializing the game
  window.onlineMode = true;
  window.onlineHandleCellClick = handleOnlineCellClick;
  window.onBackToMenuHook = backToLobby;

  // Initialize empty board DOM (uses script.js globals)
  window.clearGame();
  window.initializeGame();

  // Subscribe to live game updates
  unsubscribeGame = onSnapshot(doc(db, 'games', currentGameId), (snap) => {
    if (!snap.exists()) return;
    renderGameState(snap.data());
  });

  // Fetch ratings in background (non-blocking) — ranked only
  if (gameMode === 'ranked') {
    Promise.all([
      getDoc(doc(db, 'players', data.player1uid)),
      getDoc(doc(db, 'players', data.player2uid))
    ]).then(([s1, s2]) => {
      onlinePlayerRatings[1] = safeNum(s1.data()?.rating, 1200);
      onlinePlayerRatings[2] = safeNum(s2.data()?.rating, 1200);
      window.updatePlayerDisplays();
    }).catch(() => {
      onlinePlayerRatings = { 1: 1200, 2: 1200 };
    });
  }
}

// ── Turn timer ───────────────────────────────────────────────────────────────
function startTurnTimer() {
  clearTurnTimer();
  turnTimerSeconds = TURN_TIME_LIMIT;
  timerEl.textContent = turnTimerSeconds;
  timerEl.style.display = 'block';
  timerEl.style.color = '#333';

  turnTimer = setInterval(() => {
    turnTimerSeconds--;
    timerEl.textContent = turnTimerSeconds;
    if (turnTimerSeconds <= 10) timerEl.style.color = '#dc3545';
    if (turnTimerSeconds <= 0) {
      clearInterval(turnTimer);
      turnTimer = null;
      onTurnTimeout();
    }
  }, 1000);
}

function clearTurnTimer() {
  if (turnTimer) { clearInterval(turnTimer); turnTimer = null; }
  timerEl.style.display = 'none';
}

async function onTurnTimeout() {
  if (!localGameData || localGameData.status !== 'active') return;
  if (localGameData.currentPlayer !== myPlayerNumber) return;
  if (isWriting) return;

  const timeouts = localGameData.timeouts || { p1: 0, p2: 0 };
  const myKey = 'p' + myPlayerNumber;
  // Only count toward auto-loss if the full turn was skipped (timed out during 'place')
  const isFullSkip = localGameData.phase === 'place';
  const newCount = isFullSkip ? (timeouts[myKey] || 0) + 1 : (timeouts[myKey] || 0);

  // 3 consecutive full-turn timeouts → instant loss
  if (newCount >= MAX_CONSECUTIVE_TIMEOUTS) {
    const gs = window.gameState;
    const s1 = gs ? biggestGroup(gs, 1, window.gridSize) : 0;
    const s2 = gs ? biggestGroup(gs, 2, window.gridSize) : 0;
    const winner = myPlayerNumber === 1 ? 2 : 1;

    isWriting = true;
    try {
      await updateDoc(doc(db, 'games', currentGameId), {
        status: 'finished',
        result: { winner, score1: s1, score2: s2, timeout: true },
        [`timeouts.${myKey}`]: newCount
      });
    } finally { isWriting = false; }
    return;
  }

  // Skip turn — pass to next player
  const nextPlayer = myPlayerNumber === 1 ? 2 : 1;
  isWriting = true;
  try {
    await updateDoc(doc(db, 'games', currentGameId), {
      currentPlayer: nextPlayer,
      phase: 'place',
      lastPlaces: null,
      [`timeouts.${myKey}`]: newCount
    });
  } finally { isWriting = false; }
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
    newHistory['p' + myPlayerNumber].push({r: row, c: col});

    isWriting = true;
    try {
      await updateDoc(doc(db, 'games', currentGameId), {
        currentPlayer:    myPlayerNumber,
        phase:            'eliminate',
        lastPlaces:       { row, col },
        gameStateJSON:    JSON.stringify(newGs),
        placementHistory: newHistory,
        [`timeouts.p${myPlayerNumber}`]: 0
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

  // Other player left — penalize leaver's ELO if game was active, then go to lobby
  if (data.status === 'left') {
    clearTurnTimer();
    if (data.leftBy && data.leftBy !== auth.currentUser?.uid) {
      // The OTHER player abandoned — increment our games count, then go to lobby
      handleAbandon().finally(() => backToLobby());
    } else {
      backToLobby();
    }
    return;
  }

  // Player 2: once deltas arrive from Player 1, update own profile and show dialog
  if (waitingForDeltas && data.result && data.result.delta1 != null) {
    waitingForDeltas = false;
    updateOwnProfile(data);
    showGameOverDialog(data, data.result);
  }

  if (!data.gameStateJSON) {
    // Board not yet touched — just update status
    window.updateStatus();
    if (data.status === 'active' && onlineTimerEnabled) startTurnTimer();
    return;
  }

  // Sync local state from Firestore
  window.gameState        = JSON.parse(data.gameStateJSON);
  window.placementHistory = {
    1: (data.placementHistory.p1 || []).map(p => Array.isArray(p) ? [...p] : [p.r, p.c]),
    2: (data.placementHistory.p2 || []).map(p => Array.isArray(p) ? [...p] : [p.r, p.c])
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
    clearTurnTimer();
    handleGameOver(data);
    return;
  }

  if (data.status === 'active' && !gameOverHandled && onlineTimerEnabled) startTurnTimer();
}

// Safely read a numeric field — returns fallback if NaN, undefined, or not a number
function safeNum(val, fallback) {
  return (typeof val === 'number' && !isNaN(val)) ? val : fallback;
}

// ── Game over — update ELO in Firestore, show dialog ─────────────────────────
// Player 1 computes deltas and writes them to the game doc.
// Each player then updates their OWN profile (Firestore rules only allow self-writes).
async function handleGameOver(data) {
  const result = data.result;

  // Casual mode — no ELO changes, just show scores
  if (gameMode === 'casual') {
    showGameOverDialog(data, result);
    return;
  }

  if (myPlayerNumber === 1) {
    // Player 1: compute deltas, write own profile, publish deltas for player 2
    const p1ref = doc(db, 'players', data.player1uid);
    const p2ref = doc(db, 'players', data.player2uid);
    try {
      const [snap1, snap2] = await Promise.all([getDoc(p1ref), getDoc(p2ref)]);
      const p1 = snap1.data();
      const p2 = snap2.data();
      if (!p1 || !p2) return;

      const r1 = safeNum(p1.rating, 1200);
      const r2 = safeNum(p2.rating, 1200);

      const scoreP1    = result.winner === 1 ? 1 : result.winner === 2 ? 0 : 0.5;
      const expectedP1 = window.getExpectedScore(r1, r2);
      const delta1     = Math.round(ELO_K_FACTOR * (scoreP1 - expectedP1));
      const delta2     = -delta1;
      const newR1      = Math.max(100, r1 + delta1);
      const newR2      = Math.max(100, r2 + delta2);

      // Update own profile
      await updateDoc(p1ref, {
        rating: newR1, games: p1.games + 1,
        wins:   scoreP1 === 1   ? p1.wins   + 1 : p1.wins,
        losses: scoreP1 === 0   ? p1.losses + 1 : p1.losses,
        draws:  scoreP1 === 0.5 ? p1.draws  + 1 : p1.draws,
        updatedAt: serverTimestamp()
      });

      // Publish deltas to game doc so player 2 can update their own profile
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
    // Player 2: wait for deltas from player 1, then update own profile
    waitingForDeltas = true;
    setTimeout(() => {
      if (waitingForDeltas) {
        waitingForDeltas = false;
        showGameOverDialog(data, localGameData?.result || result);
      }
    }, 10000);
  }
}

// Called when player 2 receives deltas from player 1 (via onSnapshot in renderGameState)
async function updateOwnProfile(data) {
  const myUid = auth.currentUser?.uid;
  if (!myUid) return;

  const myRef  = doc(db, 'players', myUid);
  const result = data.result;
  const isP1   = myUid === data.player1uid;
  const newRating = isP1 ? result.newR1 : result.newR2;

  const scoreP1 = result.winner === 1 ? 1 : result.winner === 2 ? 0 : 0.5;
  const myScore = isP1 ? scoreP1 : (1 - scoreP1);

  try {
    const snap = await getDoc(myRef);
    const me = snap.data();
    if (!me) return;

    await updateDoc(myRef, {
      rating: newRating,
      games:  me.games + 1,
      wins:   myScore === 1   ? me.wins   + 1 : me.wins,
      losses: myScore === 0   ? me.losses + 1 : me.losses,
      draws:  myScore === 0.5 ? me.draws  + 1 : me.draws,
      updatedAt: serverTimestamp()
    });
  } catch (err) {
    console.error('Own profile update error:', err);
  }
}

// ── Abandon — leaver penalizes themselves, stayer keeps ELO ──────────────────

// Called by the LEAVER (in backToLobby) to deduct their own ELO before leaving.
// Each player can only write to their own /players/{uid} doc (Firestore rules).
async function selfPenalizeLeaver(data) {
  if (gameMode === 'casual') return;
  const myUid = auth.currentUser?.uid;
  if (!myUid) return;

  const opponentUid = myUid === data.player1uid ? data.player2uid : data.player1uid;

  try {
    const [mySnap, oppSnap] = await Promise.all([
      getDoc(doc(db, 'players', myUid)),
      getDoc(doc(db, 'players', opponentUid))
    ]);
    const me  = mySnap.data();
    const opp = oppSnap.data();
    if (!me || !opp) return;

    const myRating  = safeNum(me.rating, 1200);
    const oppRating = safeNum(opp.rating, 1200);

    const expected  = window.getExpectedScore(myRating, oppRating);
    const delta     = Math.round(ELO_K_FACTOR * (0 - expected));
    const newRating = Math.max(100, myRating + delta);

    await updateDoc(doc(db, 'players', myUid), {
      rating: newRating,
      games:  me.games + 1,
      losses: me.losses + 1,
      updatedAt: serverTimestamp()
    });
  } catch (err) {
    console.error('Self-penalize leaver error:', err);
  }
}

// Called by the STAYER when they detect the other player left.
// Only updates the stayer's own doc — no rating change, just increment games.
async function handleAbandon() {
  if (gameMode === 'casual') return;
  const myUid = auth.currentUser?.uid;
  if (!myUid) return;

  try {
    const myRef = doc(db, 'players', myUid);
    const snap  = await getDoc(myRef);
    const me    = snap.data();
    if (!me) return;

    await updateDoc(myRef, {
      games: me.games + 1,
      updatedAt: serverTimestamp()
    });
  } catch (err) {
    console.error('Abandon stayer update error:', err);
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
  const arr1 = h.p1 || h[1] || [];
  const arr2 = h.p2 || h[2] || [];
  return {
    p1: arr1.map(p => Array.isArray(p) ? {r: p[0], c: p[1]} : {r: p.r, c: p.c}),
    p2: arr2.map(p => Array.isArray(p) ? {r: p[0], c: p[1]} : {r: p.r, c: p.c})
  };
}

function formatDelta(d) { return d >= 0 ? `+${d}` : `${d}`; }