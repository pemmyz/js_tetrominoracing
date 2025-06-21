document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');

    // --- Constants & Settings ---
    const NUM_PLAYERS = 2;
    const PLAYER_WIDTH = 400;
    const SCREEN_WIDTH = PLAYER_WIDTH * NUM_PLAYERS; // 800
    const SCREEN_HEIGHT = 800;
    const BLOCK_SIZE = 40;
    const GRID_WIDTH_PER_PLAYER = PLAYER_WIDTH / BLOCK_SIZE; // 10
    const GRID_HEIGHT = SCREEN_HEIGHT / BLOCK_SIZE;
    
    const INITIAL_MOVE_INTERVAL = 600;
    const SPAWN_INTERVAL = 500;
    
    const SPEED_INCREMENT = 0.2;
    const MIN_SPEED_MULTIPLIER = 0.2;
    const MAX_SPEED_MULTIPLIER = 5.0;

    const BOT_THINK_INTERVAL = 100; // Bot thinks more frequently
    const BOT_SIMULATION_DEPTH = GRID_HEIGHT + 5;

    const COLORS = {
        BLACK: "#000000", WHITE: "#FFFFFF", RED: "#FF0000", GREEN: "#00FF00", BLUE: "#0000FF",
        YELLOW: "#FFFF00", MAGENTA: "#FF00FF", CYAN: "#00FFFF", ORANGE: "#FFA500",
        P1_COLOR: "#EE82EE", // Violet
        P2_COLOR: "#F4A460", // Sandy Brown
        GRID_COLOR: "#323232",
        PAUSE_OVERLAY_COLOR: "rgba(0, 0, 0, 0.7)",
        BOT_PATH_COLOR: "rgba(255, 255, 0, 0.35)"
    };

    const ALL_TETROMINOS = [
        { shape: [[1]], color: "#C8C8C8" }, { shape: [[1, 1]], color: "#969696" }, { shape: [[1], [1]], color: "#646464" },
        { shape: [[1, 1, 1, 1]], color: COLORS.CYAN }, { shape: [[1, 1], [1, 1]], color: COLORS.YELLOW }, { shape: [[0, 1, 0], [1, 1, 1]], color: COLORS.MAGENTA },
        { shape: [[0, 1, 1], [1, 1, 0]], color: COLORS.GREEN }, { shape: [[1, 1, 0], [0, 1, 1]], color: COLORS.RED },
        { shape: [[0, 0, 1], [1, 1, 1]], color: COLORS.BLUE }, { shape: [[1, 0, 0], [1, 1, 1]], color: COLORS.ORANGE },
        { shape: [[1, 1, 1]], color: "#FF69B4" }, { shape: [[1], [1], [1]], color: "#40E0D0" },
    ];
    
    const lanes = {
        left: { start: 0, width: 3 }, middle: { start: 3, width: 4 }, right: { start: 7, width: 3 }
    };
    const laneNames = Object.keys(lanes);

    // Game State
    let state = {};

    function createPlayer(id) {
        return {
            id: id,
            x: (GRID_WIDTH_PER_PLAYER / 2) * BLOCK_SIZE,
            y: SCREEN_HEIGHT - 3 * BLOCK_SIZE,
            color: id === 0 ? COLORS.P1_COLOR : COLORS.P2_COLOR,
            tetrominos: [],
            score: 0,
            gameOver: false,
            lastSpawnTime: performance.now() - (SPAWN_INTERVAL / 2) * (id + 1), // Stagger spawns
            bot: {
                isActive: false,
                algorithm: 1,
                targetX: null,
                path: [],
                lastThinkTime: 0,
            }
        };
    }

    function resetGameState() {
        const bots = state.players ? state.players.map(p => ({ isActive: p.bot.isActive, algorithm: p.bot.algorithm })) : [null, null];

        state = {
            players: [],
            gameStartTime: performance.now(),
            timePausedTotal: 0,
            lastMoveTime: performance.now(),
            speedMultiplier: 1.0,
            gamePaused: false,
            overallGameOver: false
        };

        for (let i = 0; i < NUM_PLAYERS; i++) {
            const player = createPlayer(i);
            if (bots[i]) {
                player.bot.isActive = bots[i].isActive;
                player.bot.algorithm = bots[i].algorithm;
            }
            state.players.push(player);
        }
        console.log("Game Reset!");
    }

    // --- Helper Functions ---

    function getOccupiedCells(tetromino) {
        const cells = new Set();
        const { shape, x, y } = tetromino;
        const startCol = x / BLOCK_SIZE;
        const startRow = y / BLOCK_SIZE;
        for (let r_idx = 0; r_idx < shape.length; r_idx++) {
            for (let c_idx = 0; c_idx < shape[r_idx].length; c_idx++) {
                if (shape[r_idx][c_idx]) {
                    cells.add(`${startCol + c_idx},${startRow + r_idx}`);
                }
            }
        }
        return cells;
    }

    function canSpawnWithBuffer(candidate, existingTetrominos) {
        const candidateBuffer = new Set();
        const { shape, x, y } = candidate;
        const startCol = x / BLOCK_SIZE;
        const startRow = y / BLOCK_SIZE;
        for (let r_idx = 0; r_idx < shape.length; r_idx++) {
            for (let c_idx = 0; c_idx < shape[r_idx].length; c_idx++) {
                if (shape[r_idx][c_idx]) {
                    const baseCol = startCol + c_idx;
                    const baseRow = startRow + r_idx;
                    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
                        candidateBuffer.add(`${baseCol + dc},${baseRow + dr}`);
                    }
                }
            }
        }
        for (const existing of existingTetrominos) {
            if (existing.y < 4 * BLOCK_SIZE) { 
                const existingCells = getOccupiedCells(existing);
                for (const cell of existingCells) if (candidateBuffer.has(cell)) return false;
            }
        }
        return true;
    }

    function attemptSpawnInLane(player) {
        const laneToTry = laneNames[Math.floor(Math.random() * laneNames.length)];
        const allowed = ALL_TETROMINOS.filter(t => t.shape[0].length <= lanes[laneToTry].width);
        if (allowed.length === 0) return null;

        const choice = allowed[Math.floor(Math.random() * allowed.length)];
        const { shape, color } = choice;
        const offset = Math.floor(Math.random() * (lanes[laneToTry].width - shape[0].length + 1));
        const x = (lanes[laneToTry].start + offset) * BLOCK_SIZE;
        const y = -shape.length * BLOCK_SIZE;

        const candidate = { shape, color, x, y, lane: laneToTry };
        if (canSpawnWithBuffer(candidate, player.tetrominos)) {
            return candidate;
        }
        return null;
    }

    function checkCollision(player) {
        const playerCol = player.x / BLOCK_SIZE;
        const playerRow = player.y / BLOCK_SIZE;
        for (const t of player.tetrominos) {
            const startCol = Math.round(t.x / BLOCK_SIZE);
            const startRow = Math.round(t.y / BLOCK_SIZE);
            for (let r = 0; r < t.shape.length; r++) {
                for (let c = 0; c < t.shape[r].length; c++) {
                    if (t.shape[r][c]) {
                        if (startCol + c === playerCol && (startRow + r === playerRow || startRow + r === playerRow - 1)) {
                            return true;
                        }
                    }
                }
            }
        }
        return false;
    }

    // --- AI Bot Algorithms ---
    function findBestPath(player) {
        switch (player.bot.algorithm) {
            case 1: return findBestPath_BFS(player);
            case 2: return findBestPath_Greedy(player);
            case 3: return findBestPath_CenterHugger(player);
            case 4: return findBestPath_Opportunist(player);
            default: return findBestPath_BFS(player);
        }
    }

    function buildDangerGrid(player) {
        const dangerGrid = Array(GRID_HEIGHT).fill(null).map(() => Array(GRID_WIDTH_PER_PLAYER).fill(0));
        player.tetrominos.forEach(t => {
            const startCol = Math.round(t.x / BLOCK_SIZE);
            const startRow = Math.round(t.y / BLOCK_SIZE);
            for (let r = 0; r < t.shape.length; r++) {
                for (let c = 0; c < t.shape[r].length; c++) {
                    if (t.shape[r][c]) {
                        const tetCol = startCol + c;
                        if (tetCol >= 0 && tetCol < GRID_WIDTH_PER_PLAYER) {
                            for (let step = 0; step < BOT_SIMULATION_DEPTH; step++) {
                                const tetRow = startRow + r + step;
                                if (tetRow >= 0 && tetRow < GRID_HEIGHT) {
                                    dangerGrid[tetRow][tetCol] += 1; // Accumulate danger for overlapping threats
                                }
                            }
                        }
                    }
                }
            }
        });
        return dangerGrid;
    }

    // AI 1: BFS (Closest Safe Spot)
    function findBestPath_BFS(player) {
        const dangerGrid = buildDangerGrid(player);
        const playerCol = player.x / BLOCK_SIZE;
        const playerRow = player.y / BLOCK_SIZE;
        const queue = [[playerCol, [playerCol]]];
        const visited = new Set([playerCol]);
        
        while (queue.length > 0) {
            const [currentCol, path] = queue.shift();
            const isSafe = dangerGrid[playerRow][currentCol] === 0 && (playerRow > 0 ? dangerGrid[playerRow - 1][currentCol] === 0 : true);
            if (isSafe) {
                const fullPath = path.map(col => ({ x: col * BLOCK_SIZE, y: playerRow * BLOCK_SIZE }));
                return { targetX: currentCol * BLOCK_SIZE, path: fullPath };
            }
            [-1, 1].forEach(dir => {
                const nextCol = currentCol + dir;
                if (nextCol >= 0 && nextCol < GRID_WIDTH_PER_PLAYER && !visited.has(nextCol)) {
                    visited.add(nextCol);
                    queue.push([nextCol, [...path, nextCol]]);
                }
            });
        }
        return { targetX: player.x, path: [{ x: player.x, y: player.y }] }; // No safe path found
    }

    // AI 2: Greedy (Safest Immediate Neighbor)
    function findBestPath_Greedy(player) {
        const dangerGrid = buildDangerGrid(player);
        const playerCol = player.x / BLOCK_SIZE;
        const playerRow = player.y / BLOCK_SIZE;
        
        const options = [0, -1, 1].map(dir => playerCol + dir).filter(col => col >= 0 && col < GRID_WIDTH_PER_PLAYER);

        let bestCol = playerCol;
        let minDanger = Infinity;

        for(const col of options) {
            const danger = dangerGrid[playerRow][col] + (playerRow > 0 ? dangerGrid[playerRow - 1][col] : 0);
            if (danger < minDanger) {
                minDanger = danger;
                bestCol = col;
            }
        }
        const path = (bestCol === playerCol) ? [{x: player.x, y: player.y}] : [{x: player.x, y: player.y}, {x: bestCol * BLOCK_SIZE, y: player.y}];
        return { targetX: bestCol * BLOCK_SIZE, path };
    }
    
    // AI 3: Center-Hugger (Weighted Best Path)
    function findBestPath_CenterHugger(player) {
        const dangerGrid = buildDangerGrid(player);
        const playerCol = player.x / BLOCK_SIZE;
        const playerRow = player.y / BLOCK_SIZE;
        const center = Math.floor(GRID_WIDTH_PER_PLAYER / 2);
        
        const costs = Array(GRID_WIDTH_PER_PLAYER).fill(Infinity);
        const paths = {};
        costs[playerCol] = 0;
        paths[playerCol] = [playerCol];
        const queue = [{col: playerCol, cost: 0}]; // Priority queue
        
        while(queue.length > 0) {
            queue.sort((a, b) => a.cost - b.cost); // Simulate priority queue
            const {col: u} = queue.shift();
            
            [-1, 1].forEach(dir => {
                const v = u + dir;
                if (v >= 0 && v < GRID_WIDTH_PER_PLAYER) {
                    const danger = dangerGrid[playerRow][v] + (playerRow > 0 ? dangerGrid[playerRow - 1][v] : 0);
                    const costToMove = 1 + (danger * 10) + (Math.abs(v - center) * 0.2); // Danger is high cost
                    if (costs[u] + costToMove < costs[v]) {
                        costs[v] = costs[u] + costToMove;
                        paths[v] = [...paths[u], v];
                        queue.push({col: v, cost: costs[v]});
                    }
                }
            });
        }
        
        let bestTarget = -1;
        let lowestCost = Infinity;
        for (let i = 0; i < GRID_WIDTH_PER_PLAYER; i++) {
            const isSafe = dangerGrid[playerRow][i] === 0 && (playerRow > 0 ? dangerGrid[playerRow - 1][i] === 0 : true);
            if (isSafe && costs[i] < lowestCost) {
                lowestCost = costs[i];
                bestTarget = i;
            }
        }

        if (bestTarget !== -1) {
             const fullPath = paths[bestTarget].map(col => ({ x: col * BLOCK_SIZE, y: playerRow * BLOCK_SIZE }));
             return { targetX: bestTarget * BLOCK_SIZE, path: fullPath };
        }
        return findBestPath_Greedy(player); // Fallback if no perfectly safe path
    }

    // AI 4: Opportunist (Finds Widest Safe Gap)
    function findBestPath_Opportunist(player) {
        const dangerGrid = buildDangerGrid(player);
        const playerRow = player.y / BLOCK_SIZE;
        let bestStart = -1, maxLength = 0, currentStart = -1, currentLength = 0;

        for (let col = 0; col < GRID_WIDTH_PER_PLAYER; col++) {
            const isSafe = dangerGrid[playerRow][col] === 0 && (playerRow > 0 ? dangerGrid[playerRow - 1][col] === 0 : true);
            if (isSafe) {
                if (currentStart === -1) currentStart = col;
                currentLength++;
            } else {
                if (currentLength > maxLength) { maxLength = currentLength; bestStart = currentStart; }
                currentStart = -1; currentLength = 0;
            }
        }
        if (currentLength > maxLength) { maxLength = currentLength; bestStart = currentStart; }

        if (bestStart !== -1) {
            const targetCol = Math.floor(bestStart + maxLength / 2);
            return findBestPath_BFS_to_Target(player, targetCol, dangerGrid);
        }
        return findBestPath_Greedy(player); // Fallback to survival
    }
    
    // Helper for AI 4 to find a path to a specific target
    function findBestPath_BFS_to_Target(player, targetCol) {
        const playerCol = player.x / BLOCK_SIZE;
        const playerRow = player.y / BLOCK_SIZE;
        const queue = [[playerCol, [playerCol]]];
        const visited = new Set([playerCol]);
        while(queue.length > 0) {
            const [currentCol, path] = queue.shift();
            if (currentCol === targetCol) {
                const fullPath = path.map(c => ({ x: c * BLOCK_SIZE, y: playerRow * BLOCK_SIZE }));
                return { targetX: targetCol * BLOCK_SIZE, path: fullPath };
            }
            [-1, 1].forEach(dir => {
                const nextCol = currentCol + dir;
                if(nextCol >= 0 && nextCol < GRID_WIDTH_PER_PLAYER && !visited.has(nextCol)) {
                    visited.add(nextCol);
                    queue.push([nextCol, [...path, nextCol]]);
                }
            });
        }
        return { targetX: player.x, path: [{ x: player.x, y: player.y }] }; // Should not fail
    }


    // --- Drawing Functions ---
    function drawPlayerArea(player) {
        const offsetX = player.id * PLAYER_WIDTH;
        ctx.save();
        ctx.translate(offsetX, 0);

        ctx.fillStyle = COLORS.BLACK;
        ctx.fillRect(0, 0, PLAYER_WIDTH, SCREEN_HEIGHT);
        
        ctx.strokeStyle = COLORS.GRID_COLOR;
        ctx.lineWidth = 1;
        for (let x = 0; x < PLAYER_WIDTH; x += BLOCK_SIZE) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, SCREEN_HEIGHT); ctx.stroke(); }
        for (let y = 0; y < SCREEN_HEIGHT; y += BLOCK_SIZE) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(PLAYER_WIDTH, y); ctx.stroke(); }

        if (player.bot.isActive && player.bot.path) {
            ctx.fillStyle = COLORS.BOT_PATH_COLOR;
            player.bot.path.forEach(pos => ctx.fillRect(pos.x, pos.y, BLOCK_SIZE, BLOCK_SIZE));
        }

        player.tetrominos.forEach(t => {
            ctx.fillStyle = t.color;
            ctx.strokeStyle = COLORS.BLACK;
            ctx.lineWidth = 2;
            for (let i = 0; i < t.shape.length; i++) {
                for (let j = 0; j < t.shape[i].length; j++) {
                    if (t.shape[i][j]) {
                        ctx.fillRect(t.x + j * BLOCK_SIZE, t.y + i * BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE);
                        ctx.strokeRect(t.x + j * BLOCK_SIZE, t.y + i * BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE);
                    }
                }
            }
        });

        if (!player.gameOver) {
            ctx.fillStyle = player.color;
            ctx.strokeStyle = COLORS.WHITE;
            ctx.lineWidth = 2;
            ctx.fillRect(player.x, player.y, BLOCK_SIZE, BLOCK_SIZE);
            ctx.strokeRect(player.x, player.y, BLOCK_SIZE, BLOCK_SIZE);
        }

        ctx.fillStyle = COLORS.WHITE;
        ctx.font = "24px sans-serif";
        ctx.textAlign = "left";
        ctx.fillText(`P${player.id + 1}: ${player.score}`, 10, 30);
        
        if (player.bot.isActive) {
            ctx.fillStyle = COLORS.YELLOW;
            ctx.font = "18px sans-serif";
            ctx.textAlign = "left";
            ctx.fillText(`BOT AI: ${player.bot.algorithm}`, 10, 55);
        }

        if(player.gameOver){
            ctx.fillStyle = COLORS.RED;
            ctx.font = "40px sans-serif";
            ctx.textAlign = "center";
            ctx.fillText("GAME OVER", PLAYER_WIDTH / 2, SCREEN_HEIGHT / 2);
        }

        ctx.restore();
    }

    function drawGlobalUI() {
        ctx.strokeStyle = COLORS.WHITE;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(PLAYER_WIDTH, 0);
        ctx.lineTo(PLAYER_WIDTH, SCREEN_HEIGHT);
        ctx.stroke();

        ctx.fillStyle = COLORS.WHITE;
        ctx.font = "24px sans-serif";
        ctx.textAlign = "center";
        // Lowered speed indicator position
        ctx.fillText(`Speed: ${state.speedMultiplier.toFixed(1)}x`, SCREEN_WIDTH / 2, 60);
        
        if (state.gamePaused || state.overallGameOver) {
            ctx.fillStyle = COLORS.PAUSE_OVERLAY_COLOR;
            ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
            
            ctx.fillStyle = COLORS.WHITE;
            ctx.font = "50px sans-serif";
            ctx.textAlign = "center";
            const message = state.overallGameOver ? "RACE OVER!" : "Paused";
            ctx.fillText(message, SCREEN_WIDTH / 2, SCREEN_HEIGHT / 2);

            if(state.overallGameOver) {
                 ctx.font = "24px sans-serif";
                 ctx.fillText("Any key to restart", SCREEN_WIDTH / 2, SCREEN_HEIGHT / 2 + 50);
            }
        }
    }


    // --- Game Logic & Loop ---
    function updatePlayer(player, timestamp) {
        if (player.gameOver || state.gamePaused) return;

        const currentPlayTime = (timestamp - state.gameStartTime - state.timePausedTotal) / 1000;
        player.score = Math.floor(currentPlayTime * 10 * state.speedMultiplier);

        if (player.bot.isActive && timestamp > player.bot.lastThinkTime + BOT_THINK_INTERVAL) {
            const result = findBestPath(player);
            player.bot.targetX = result.targetX;
            player.bot.path = result.path;
            player.bot.lastThinkTime = timestamp;
        }

        if (player.bot.isActive && player.bot.targetX !== null) {
            if (player.x < player.bot.targetX) player.x += BLOCK_SIZE;
            else if (player.x > player.bot.targetX) player.x -= BLOCK_SIZE;
            player.x = Math.max(0, Math.min(PLAYER_WIDTH - BLOCK_SIZE, player.x));
        }

        if (timestamp - player.lastSpawnTime > SPAWN_INTERVAL / state.speedMultiplier) {
            const newTetromino = attemptSpawnInLane(player);
            if (newTetromino) player.tetrominos.push(newTetromino);
            player.lastSpawnTime = timestamp;
        }
        
        if (checkCollision(player)) {
            player.gameOver = true;
            console.log(`Player ${player.id + 1} has lost!`);
        }
    }

    function update(timestamp) {
        if (state.overallGameOver) return; // Completely freeze if game is over

        const currentMoveInterval = INITIAL_MOVE_INTERVAL / Math.max(0.01, state.speedMultiplier);
        
        if (!state.gamePaused) {
            if (timestamp - state.lastMoveTime > currentMoveInterval) {
                state.players.forEach(p => {
                    if(!p.gameOver) p.tetrominos.forEach(t => t.y += BLOCK_SIZE);
                });
                state.lastMoveTime = timestamp;
            }
            
            state.players.forEach(player => {
                updatePlayer(player, timestamp);
                player.tetrominos = player.tetrominos.filter(t => t.y < SCREEN_HEIGHT + BLOCK_SIZE);
            });
    
            if (!state.overallGameOver && state.players.every(p => p.gameOver)) {
                state.overallGameOver = true;
            }
        }
    }

    function gameLoop(timestamp) {
        update(timestamp);
        
        ctx.clearRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
        state.players.forEach(drawPlayerArea);
        drawGlobalUI();

        requestAnimationFrame(gameLoop);
    }

    // --- Event Handling ---
    let pauseStartTime = 0;
    window.addEventListener('keydown', (e) => {
        const key = e.key.toLowerCase();
        
        // Prevent default browser action for game keys
        if (["arrowup", "arrowdown", "arrowleft", "arrowright", "p", "b", "n", "a", "d", " "].includes(key) || (key >= '0' && key <= '9')) {
            e.preventDefault();
        }

        if (state.overallGameOver) {
            resetGameState();
            return;
        }
        
        if (key === 'p') {
            state.gamePaused = !state.gamePaused;
            if (state.gamePaused) pauseStartTime = performance.now();
            else state.timePausedTotal += performance.now() - pauseStartTime;
        }
        
        if (state.gamePaused) return;

        // Player 1 controls
        const p1 = state.players[0];
        if (!p1.bot.isActive && !p1.gameOver) {
            if (key === 'arrowleft') p1.x = Math.max(0, p1.x - BLOCK_SIZE);
            if (key === 'arrowright') p1.x = Math.min(PLAYER_WIDTH - BLOCK_SIZE, p1.x + BLOCK_SIZE);
        }
        if (key === 'b') p1.bot.isActive = !p1.bot.isActive;
        const p1_ai_key = parseInt(key);
        if (p1_ai_key >= 1 && p1_ai_key <= 4) p1.bot.algorithm = p1_ai_key;
        
        // Player 2 controls
        const p2 = state.players[1];
        if (!p2.bot.isActive && !p2.gameOver) {
            if (key === 'a') p2.x = Math.max(0, p2.x - BLOCK_SIZE);
            if (key === 'd') p2.x = Math.min(PLAYER_WIDTH - BLOCK_SIZE, p2.x + BLOCK_SIZE);
        }
        if (key === 'n') p2.bot.isActive = !p2.bot.isActive;
        const p2_ai_key = parseInt(key);
        if (p2_ai_key >= 7 && p2_ai_key <= 9) {
            p2.bot.algorithm = p2_ai_key - 6; // Map 7,8,9 to 1,2,3
        } else if (key === '0') {
            p2.bot.algorithm = 4; // Map 0 to 4
        }

        // Global controls
        if (key === 'arrowup') state.speedMultiplier = Math.min(MAX_SPEED_MULTIPLIER, state.speedMultiplier + SPEED_INCREMENT);
        if (key === 'arrowdown') state.speedMultiplier = Math.max(MIN_SPEED_MULTIPLIER, state.speedMultiplier - SPEED_INCREMENT);
    });

    // --- Initial Setup ---
    canvas.width = SCREEN_WIDTH;
    canvas.height = SCREEN_HEIGHT;
    
    resetGameState();
    requestAnimationFrame(gameLoop);
});
