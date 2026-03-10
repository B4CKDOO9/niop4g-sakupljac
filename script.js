const gridContainer = document.getElementById('grid');
let currentPlayer = 1;
let player1Name = '';
let player2Name = '';
let phase = 'place';
let lastPlaces = null;
let gameState = [];
let placementHistory = { 1: [], 2: [] };
let gridSize = 6;

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
                    backToMenu();
                }
                showNameDialog();
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
    // TODO: Implementacija leaderboard-a s Google autentifikacijom
    alert('Leaderboard će biti implementiran s Google autentifikacijom');
});
document.getElementById('start-btn').addEventListener('click', startNewGame);
document.getElementById('cancel-btn').addEventListener('click', hideNameDialog);
document.getElementById('reset-btn').addEventListener('click', resetGame);
document.getElementById('back-to-menu-btn').addEventListener('click', backToMenu);
document.getElementById('close-rules-btn').addEventListener('click', hideRules);
document.getElementById('new-game-after-btn').addEventListener('click', () => {
    hideGameOverDialog();
    showNameDialog();
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

function showNameDialog() {
    menu.style.display = 'none';
    nameDialog.style.display = 'flex';
    document.getElementById('player1-name').value = player1Name || '';
    document.getElementById('player2-name').value = player2Name || '';
    document.getElementById('player1-name').focus();
}

function hideNameDialog() {
    nameDialog.style.display = 'none';
    menu.style.display = 'flex';
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

function backToMenu() {
    gameArea.style.display = 'none';
    menu.style.display = 'flex';
    clearGame();
}

function startNewGame() {
    const p1Name = document.getElementById('player1-name').value.trim();
    const p2Name = document.getElementById('player2-name').value.trim();
    
    if (!p1Name || !p2Name) {
        alert('Molimo unesite oba imena igrača!');
        return;
    }
    
    player1Name = p1Name;
    player2Name = p2Name;
    gridSize = parseInt(document.getElementById('grid-size-select').value);
    
    nameDialog.style.display = 'none';
    gameArea.style.display = 'block';
    
    clearGame();
    initializeGame();
}

function resetGame() {
    if (confirm('Jeste li sigurni da želite resetirati igru?')) {
        clearGame();
        initializeGame();
    }
}

function clearGame() {
    gridContainer.innerHTML = '';
    gameState = [];
    currentPlayer = 1;
    phase = 'place';
    lastPlaces = null;
    placementHistory = { 1: [], 2: [] };
}

function initializeGame() {
    // Postavi prikaz imena
    document.getElementById('player1-display').textContent = player1Name;
    document.getElementById('player2-display').textContent = player2Name;
    
    // Postavi grid CSS
    const cellPx = Math.floor(600 / gridSize);
    gridContainer.style.width = (cellPx * gridSize) + 'px';
    gridContainer.style.height = (cellPx * gridSize) + 'px';
    gridContainer.style.gridTemplateColumns = `repeat(${gridSize}, ${cellPx}px)`;

    // Postavi veličinu točkice
    const dotPx = Math.max(10, Math.floor(cellPx * 0.3));
    document.documentElement.style.setProperty('--dot-size', dotPx + 'px');

    // Stvori mrežu
    for (let i = 0; i < gridSize; i++) {
        let row = [];
        for (let j = 0; j < gridSize; j++) {
            let cell = document.createElement('div');
            cell.dataset.row = i;
            cell.dataset.col = j;
            cell.style.width = cellPx + 'px';
            cell.style.height = cellPx + 'px';
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
            placementHistory[currentPlayer].push([row, col]);
            
            let dot = document.createElement('div');
            dot.className = 'dot';
            dot.style.backgroundColor = currentPlayer === 1 ? '#dc3545' : '#007bff';
            cell.appendChild(dot);
            
            phase = 'eliminate';
            lastPlaces = { row: row, col: col };
            updateStatus();
        } else {
            alert('Nevaljano postavljanje! Morate postaviti pokraj postojeće pločice ili na prazno polje.');
        }
    } else if (phase === 'eliminate') {
        let rowDiff = Math.abs(row - lastPlaces.row);
        let colDiff = Math.abs(col - lastPlaces.col);
        
        if (rowDiff > 1 || colDiff > 1 || (rowDiff === 0 && colDiff === 0)) {
            alert('Morate osjenčati susjednu ćeliju!');
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
    drawConnections();
}

function drawConnections() {
    const oldSvg = document.getElementById('connections-svg');
    if (oldSvg) oldSvg.remove();
    if (gameState.length === 0) return;

    const grid = document.getElementById('grid');
    const cellSize = Math.floor(600 / gridSize);
    const totalSize = cellSize * gridSize;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = 'connections-svg';
    svg.setAttribute('width', totalSize);
    svg.setAttribute('height', totalSize);
    svg.style.position = 'absolute';
    svg.style.top = '0';
    svg.style.left = '0';
    svg.style.pointerEvents = 'none';
    svg.style.zIndex = '10';

    const playerColors = { 1: '#dc3545', 2: '#007bff' };

    function drawLine(r1, c1, r2, c2, color) {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', (c1+0.5)*cellSize); line.setAttribute('y1', (r1+0.5)*cellSize);
        line.setAttribute('x2', (c2+0.5)*cellSize); line.setAttribute('y2', (r2+0.5)*cellSize);
        line.setAttribute('stroke', color);
        line.setAttribute('stroke-width', '3');
        line.setAttribute('stroke-linecap', 'round');
        line.setAttribute('opacity', '0.6');
        svg.appendChild(line);
    }

    function isOrtho(r1,c1,r2,c2) { return (Math.abs(r1-r2)===1&&c1===c2)||(r1===r2&&Math.abs(c1-c2)===1); }
    function isDiag(r1,c1,r2,c2)  { return Math.abs(r1-r2)===1&&Math.abs(c1-c2)===1; }

    for (const player of [1, 2]) {
        const history = placementHistory[player];
        if (history.length < 2) continue;
        const color = playerColors[player];
        const n = history.length;

        // Union-Find
        const uf = Array.from({length: n}, (_, i) => i);
        function find(x) { return uf[x]===x ? x : (uf[x]=find(uf[x])); }
        function union(a, b) { const pa=find(a),pb=find(b); if(pa===pb)return false; uf[pa]=pb; return true; }

        // Linije koje ćemo nacrtati: [i, j] parovi
        const lines = [];

        // Prolaz 1 i 2: za svaku točku, nađi najnovijeg susjednog u historiji (ortho prioritet)
        for (let i = 1; i < n; i++) {
            const [ri, ci] = history[i];
            let found = false;
            // ortho
            for (let j = i-1; j >= 0; j--) {
                const [rj,cj] = history[j];
                if (isOrtho(ri,ci,rj,cj)) { union(i,j); lines.push([i,j]); found=true; break; }
            }
            if (!found) {
                // diag
                for (let j = i-1; j >= 0; j--) {
                    const [rj,cj] = history[j];
                    if (isDiag(ri,ci,rj,cj)) { union(i,j); lines.push([i,j]); found=true; break; }
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
                    if (i===j || find(i)===find(j)) continue;
                    const [ri,ci]=history[i], [rj,cj]=history[j];
                    if (isOrtho(ri,ci,rj,cj)) {
                        union(i,j); lines.push([i,j]); changed=true;
                    }
                }
            }
            // Diag samo ako još ima odvojenih
            for (let i = 0; i < n; i++) {
                for (let j = 0; j < n; j++) {
                    if (i===j || find(i)===find(j)) continue;
                    const [ri,ci]=history[i], [rj,cj]=history[j];
                    if (isDiag(ri,ci,rj,cj)) {
                        union(i,j); lines.push([i,j]); changed=true;
                    }
                }
            }
        }

        // Dedupliraj linije (može biti duplikata) i nacrtaj
        const drawn = new Set();
        for (const [i, j] of lines) {
            const key = Math.min(i,j)+','+Math.max(i,j);
            if (drawn.has(key)) continue;
            drawn.add(key);
            const [ri,ci]=history[i], [rj,cj]=history[j];
            drawLine(ri,ci,rj,cj,color);
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
            
            if (newRow >= 0 && newRow < gridSize && newCol >= 0 && newCol < gridSize) {
                if (gameState[newRow][newCol].player === null && !gameState[newRow][newCol].eliminated) {
                    return true;
                }
            }
        }
    }
    return false;
}