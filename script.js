const gridContainer = document.getElementById('grid');
let currentPlayer = 1;
let player1Name = '';
let player2Name = '';
let phase = 'place';
let lastPlaces = null;
let gameState = [];
let nameDialogFromMenu = true;

// Elementi
const menu = document.getElementById('menu');
const nameDialog = document.getElementById('name-dialog');
const gameOverDialog = document.getElementById('game-over-dialog');
const rulesDialog = document.getElementById('rules-dialog');
const gameArea = document.getElementById('game-area');

// Electron IPC za menu bar akcije
if (typeof require !== 'undefined') {
    const { ipcRenderer } = require('electron');
    
    ipcRenderer.on('menu-action', (event, action) => {
        switch(action) {
            case 'new-game':
                if (gameArea.style.display === 'block') {
                    showNameDialog(false);
                } else {
                    backToMenu();
                    showNameDialog(true);
                }
                break;
            case 'reset-game':
                if (gameArea.style.display === 'block') {
                    resetGame();
                }
                break;
            case 'main-menu':
                backToMenu();
                break;
            case 'show-rules':
                showRules();
                break;
        }
    });
}

// Gumbi
document.getElementById('new-game-btn').addEventListener('click', showNameDialog);
document.getElementById('leaderboard-btn').addEventListener('click', () => {
    showInfo('Leaderboard će biti implementiran s Google autentifikacijom');
});
document.getElementById('start-btn').addEventListener('click', startNewGame);
document.getElementById('cancel-btn').addEventListener('click', hideNameDialog);
document.getElementById('confirm-reset-btn').addEventListener('click', () => {
    document.getElementById('confirm-reset-dialog').style.display = 'none';
    clearGame();
    initializeGame();
});
document.getElementById('cancel-reset-btn').addEventListener('click', () => {
    document.getElementById('confirm-reset-dialog').style.display = 'none';
});
document.getElementById('reset-btn').addEventListener('click', resetGame);
document.getElementById('back-to-menu-btn').addEventListener('click', backToMenu);
document.getElementById('close-rules-btn').addEventListener('click', hideRules);
document.getElementById('new-game-after-btn').addEventListener('click', () => {
    hideGameOverDialog();
    showNameDialog(false);
});
document.getElementById('menu-btn').addEventListener('click', () => {
    hideGameOverDialog();
    backToMenu();
});

// Omogući Enter tipku za pokretanje igre
document.getElementById('player2-name').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        startNewGame();
    }
});

function showNameDialog(fromMenu = true) {
    nameDialogFromMenu = fromMenu;
    if (fromMenu) {
        menu.style.display = 'none';
    } else {
        gameArea.style.display = 'none';
    }
    nameDialog.style.display = 'flex';
    document.getElementById('player1-name').value = player1Name || '';
    document.getElementById('player2-name').value = player2Name || '';
    setTimeout(() => document.getElementById('player1-name').focus(), 100);
}

function hideNameDialog() {
    nameDialog.style.display = 'none';
    if (nameDialogFromMenu) {
        menu.style.display = 'flex';
    } else {
        gameArea.style.display = 'block';
    }
}

function showGameOverDialog(message) {
    document.getElementById('game-over-message').textContent = message;
    gameOverDialog.style.display = 'flex';
}

function hideGameOverDialog() {
    gameOverDialog.style.display = 'none';
}

function showRules() {
    rulesDialog.style.display = 'flex';
}

function hideRules() {
    rulesDialog.style.display = 'none';
}

document.getElementById('close-info-btn').addEventListener('click', () => {
    document.getElementById('info-dialog').style.display = 'none';
});

function showInfo(message) {
    document.getElementById('info-message').textContent = message;
    document.getElementById('info-dialog').style.display = 'flex';
}


function backToMenu() {
    gameArea.style.display = 'none';
    menu.style.display = 'flex';
    clearGame();
}

function startNewGame() {
    const p1Name = document.getElementById('player1-name').value.trim();
    const p2Name = document.getElementById('player2-name').value.trim();
    
    if (!p1Name || !p2Name) {
        showInfo('Molimo unesite oba imena igrača!');
        return;
    }
    
    player1Name = p1Name;
    player2Name = p2Name;
    
    nameDialog.style.display = 'none';
    gameArea.style.display = 'block';
    
    clearGame();
    initializeGame();
}

function resetGame() {
    document.getElementById('confirm-reset-dialog').style.display = 'flex';
}

function clearGame() {
    gridContainer.innerHTML = '';
    gameState = [];
    currentPlayer = 1;
    phase = 'place';
    lastPlaces = null;
}

function initializeGame() {
    // Postavi prikaz imena
    document.getElementById('player1-display').textContent = player1Name;
    document.getElementById('player2-display').textContent = player2Name;
    
    // Stvori mrežu
    for (let i = 0; i < 6; i++) {
        let row = [];
        for (let j = 0; j < 6; j++) {
            let cell = document.createElement('div');
            cell.dataset.row = i;
            cell.dataset.col = j;
            gridContainer.appendChild(cell);
            row.push({ player: null, eliminated: false });
            
            cell.addEventListener('click', function () {
                handleCellClick(this);
            });
        }
        gameState.push(row);
    }
    
    updateStatus();
    updateScore();
}

function handleCellClick(cell) {
    const row = parseInt(cell.dataset.row);
    const col = parseInt(cell.dataset.col);
    
    if (gameState[row][col].player !== null || gameState[row][col].eliminated) {
        return;
    }
    
    if (phase === 'place') {
        if (adjacentCells(row, col)) {
            gameState[row][col].player = currentPlayer;
            
            let dot = document.createElement('div');
            dot.className = 'dot';
            dot.style.backgroundColor = currentPlayer === 1 ? '#dc3545' : '#007bff';
            cell.appendChild(dot);
            
            phase = 'eliminate';
            lastPlaces = { row: row, col: col };
            updateStatus();
        } else {
            showInfo('Nevaljano postavljanje! Morate postaviti pokraj postojeće pločice ili na prazno polje.');
        }
    } else if (phase === 'eliminate') {
        let rowDiff = Math.abs(row - lastPlaces.row);
        let colDiff = Math.abs(col - lastPlaces.col);
        
        if (rowDiff > 1 || colDiff > 1 || (rowDiff === 0 && colDiff === 0)) {
            showInfo('Morate osjenčati susjednu ćeliju!');
            return;
        }
        
        gameState[row][col].eliminated = true;
        cell.classList.add('eliminated');
        
        phase = 'place';
        currentPlayer = currentPlayer === 1 ? 2 : 1;
        updateStatus();
        updateScore();
        checkGameOver();
    }
}

function updateStatus() {
    let name = currentPlayer === 1 ? player1Name : player2Name;
    let color = currentPlayer === 1 ? '#dc3545' : '#007bff';
    
    if (phase === 'place') {
        document.getElementById('status').textContent = `${name} - Postavi pločicu`;
    } else {
        document.getElementById('status').textContent = `${name} - Osjenči ćeliju`;
    }
    
    document.getElementById('status').style.color = color;
}

function updateScore() {
    let p1 = getBiggestGroup(1);
    let p2 = getBiggestGroup(2);
    document.getElementById('player1-score').textContent = p1;
    document.getElementById('player2-score').textContent = p2;
}

function getBiggestGroup(player) {
    let visited = [];
    for (let i = 0; i < 6; i++) {
        let row = [];
        for (let j = 0; j < 6; j++) {
            row.push(false);
        }
        visited.push(row);
    }
    
    let biggest = 0;
    for (let i = 0; i < 6; i++) {
        for (let j = 0; j < 6; j++) {
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
    if (row < 0 || row >= 6 || col < 0 || col >= 6) return 0;
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
    for (let i = 0; i < 6; i++) {
        for (let j = 0; j < 6; j++) {
            if (gameState[i][j].player === null && !gameState[i][j].eliminated && adjacentCells(i, j)) {
                return false;
            }
        }
    }
    
    // Igra je gotova
    let p1 = getBiggestGroup(1);
    let p2 = getBiggestGroup(2);
    let message = '';
    
    if (p1 === p2) {
        message = `Neriješeno! Oboje imate ${p1} povezanih pločica.`;
        document.getElementById('status').textContent = "Neriješeno!";
        document.getElementById('status').style.color = '#6c757d';
    } else if (p1 > p2) {
        message = `${player1Name} pobjeđuje s ${p1} povezanih pločica! (${player2Name}: ${p2})`;
        document.getElementById('status').textContent = `Pobjednik: ${player1Name}!`;
        document.getElementById('status').style.color = '#dc3545';
    } else {
        message = `${player2Name} pobjeđuje s ${p2} povezanih pločica! (${player1Name}: ${p1})`;
        document.getElementById('status').textContent = `Pobjednik: ${player2Name}!`;
        document.getElementById('status').style.color = '#007bff';
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
            
            if (newRow >= 0 && newRow < 6 && newCol >= 0 && newCol < 6) {
                if (gameState[newRow][newCol].player === null && !gameState[newRow][newCol].eliminated) {
                    return true;
                }
            }
        }
    }
    return false;
}