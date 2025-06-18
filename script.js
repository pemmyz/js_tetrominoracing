document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');

    // --- Constants & Settings ---
    const SCREEN_WIDTH = 400;
    const SCREEN_HEIGHT = 800;
    const BLOCK_SIZE = 40;
    const GRID_WIDTH = SCREEN_WIDTH / BLOCK_SIZE;
    const GRID_HEIGHT = SCREEN_HEIGHT / BLOCK_SIZE;
    const INITIAL_MOVE_INTERVAL = 600; // Milliseconds
    const SPAWN_INTERVAL = 500;
    const SPAWN_ATTEMPTS_PER_WAVE = 2;
    
    // Speed control
    const SPEED_INCREMENT = 0.2;
    const MIN_SPEED_MULTIPLIER = 0.2;
    const MAX_SPEED_MULTIPLIER = 5.0;

    // Colors (using hex codes for JS)
    const COLORS = {
        BLACK: "#000000", WHITE: "#FFFFFF", RED: "#FF0000", GREEN: "#00FF00", BLUE: "#0000FF",
        YELLOW: "#FFFF00", MAGENTA: "#FF00FF", CYAN: "#00FFFF", ORANGE: "#FFA500",
        PLAYER_COLOR: "#EE82EE", GRID_COLOR: "#323232", // Violet for player, dark grey for grid
        PAUSE_OVERLAY_COLOR: "rgba(0, 0, 0, 0.7)"
    };

    // Tetrominos (Shape Matrix, Color)
    const ALL_TETROMINOS = [
        { shape: [[1]], color: "#C8C8C8" },         // 1x1 Grey [Index 0]
        { shape: [[1, 1]], color: "#969696" },     // 1x2 Grey [Index 1]
        { shape: [[1], [1]], color: "#646464" },    // 2x1 Grey [Index 2]
        { shape: [[1, 1, 1, 1]], color: COLORS.CYAN }, // I-shape [Index 3]
        { shape: [[1, 1], [1, 1]], color: COLORS.YELLOW }, // O-shape [Index 4]
        { shape: [[0, 1, 0], [1, 1, 1]], color: COLORS.MAGENTA }, // T-shape [Index 5]
        { shape: [[0, 1, 1], [1, 1, 0]], color: COLORS.GREEN },   // S-shape [Index 6]
        { shape: [[1, 1, 0], [0, 1, 1]], color: COLORS.RED },     // Z-shape [Index 7]
        { shape: [[0, 0, 1], [1, 1, 1]], color: COLORS.BLUE },    // L-shape [Index 8]
        { shape: [[1, 0, 0], [1, 1, 1]], color: COLORS.ORANGE },  // J-shape [Index 9]
        { shape: [[1, 1, 1]], color: "#FF69B4" }, // 1x3 Pink [Index 10]
        { shape: [[1], [1], [1]], color: "#40E0D0" }, // 3x1 Turquoise [Index 11]
    ];
    
    const SMALL_TETROMINOS = ALL_TETROMINOS.slice(0, 3);
    const CLASSIC_TETROMINOS = ALL_TETROMINOS.slice(3, 10);

    // Lanes Definition
    const lanes = {
        left: { start: 0, width: 3 },
        middle: { start: 3, width: 4 },
        right: { start: 7, width: 3 }
    };
    const laneNames = Object.keys(lanes); // ["left", "middle", "right"]

    // Game State
    let state = {};

    function resetGameState() {
        state = {
            playerX: (GRID_WIDTH / 2) * BLOCK_SIZE,
            playerY: SCREEN_HEIGHT - 3 * BLOCK_SIZE,
            tetrominos: [],
            score: 0,
            gameStartTime: performance.now(),
            timePausedTotal: 0,
            lastMoveTime: performance.now(),
            lastSpawnTime: performance.now() - (SPAWN_INTERVAL / 2),
            speedMultiplier: 1.0,
            gameOver: false,
            gamePaused: false,
            spawnMode: 1,
            nextSpawnLaneIndex: 0,
        };
        console.log("Game Reset! Spawn Mode set to 1.");
    }

    // --- Helper Functions ---
    
    // Fisher-Yates shuffle for arrays
    function shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }

    function getOccupiedCells(tetromino) {
        const cells = new Set();
        const { shape, x, y } = tetromino;
        const startCol = x / BLOCK_SIZE;
        const startRow = y / BLOCK_SIZE;
        for (let r_idx = 0; r_idx < shape.length; r_idx++) {
            for (let c_idx = 0; c_idx < shape[r_idx].length; c_idx++) {
                if (shape[r_idx][c_idx]) {
                    const col = startCol + c_idx;
                    const row = startRow + r_idx;
                    if (col >= 0 && col < GRID_WIDTH) {
                        cells.add(`${col},${row}`);
                    }
                }
            }
        }
        return cells;
    }

    function canSpawnWithBuffer(candidate, existingTetrominos) {
        const candidateBuffer = new Set();
        const candidateCells = new Set();
        const { shape, x, y } = candidate;
        const startCol = x / BLOCK_SIZE;
        const startRow = y / BLOCK_SIZE;
        
        // Populate candidate sets
        for (let r_idx = 0; r_idx < shape.length; r_idx++) {
            for (let c_idx = 0; c_idx < shape[r_idx].length; c_idx++) {
                if (shape[r_idx][c_idx]) {
                    const baseCol = startCol + c_idx;
                    const baseRow = startRow + r_idx;
                    candidateCells.add(`${baseCol},${baseRow}`);
                    for (let dr = -1; dr <= 1; dr++) {
                        for (let dc = -1; dc <= 1; dc++) {
                             const neighborCol = baseCol + dc;
                             const neighborRow = baseRow + dr;
                             if(neighborCol >= 0 && neighborCol < GRID_WIDTH) {
                                 candidateBuffer.add(`${neighborCol},${neighborRow}`);
                             }
                        }
                    }
                }
            }
        }
        
        const spawnCheckDepthRows = 4;
        for (const existing of existingTetrominos) {
            const existingCells = getOccupiedCells(existing);
            // Buffer check for nearby tetrominos
            if (existing.y < spawnCheckDepthRows * BLOCK_SIZE) {
                for (const cell of existingCells) {
                    if (candidateBuffer.has(cell)) return false;
                }
            }
             // Direct collision check for very close tetrominos
            if (existing.y < BLOCK_SIZE) {
                for (const cell of existingCells) {
                    if (candidateCells.has(cell)) return false;
                }
            }
        }
        return true;
    }

    function allowedTetrominosForLane(laneName, sourceTetrominos = ALL_TETROMINOS) {
        const laneWidthCols = lanes[laneName].width;
        return sourceTetrominos.filter(t => {
            const shapeWidth = t.shape[0] ? t.shape[0].length : 0;
            return shapeWidth > 0 && shapeWidth <= laneWidthCols;
        });
    }
    
    function attemptSpawnInLane(laneName, existingTetrominos, sourceTetrominos = ALL_TETROMINOS) {
        const allowed = allowedTetrominosForLane(laneName, sourceTetrominos);
        if (allowed.length === 0) return null;

        for (let i = 0; i < 3; i++) { // 3 attempts per lane call
            const choice = allowed[Math.floor(Math.random() * allowed.length)];
            const { shape, color } = choice;
            
            const laneStartCol = lanes[laneName].start;
            const laneWidthCol = lanes[laneName].width;
            const shapeWidthCol = shape[0].length;
            const shapeHeightRows = shape.length;

            const maxOffsetCol = Math.max(0, laneWidthCol - shapeWidthCol);
            const offsetCol = Math.floor(Math.random() * (maxOffsetCol + 1));
            
            const y = -shapeHeightRows * BLOCK_SIZE;
            const x = (laneStartCol + offsetCol) * BLOCK_SIZE;
            
            const candidate = { shape, color, x, y, lane: laneName };

            if (canSpawnWithBuffer(candidate, existingTetrominos)) {
                return candidate;
            }
        }
        return null;
    }

    function checkCollision(tetromino, playerX, playerY) {
        const playerCol = playerX / BLOCK_SIZE;
        const playerRow = playerY / BLOCK_SIZE;
        const { shape, x, y } = tetromino;
        const startCol = x / BLOCK_SIZE;
        const startRow = y / BLOCK_SIZE;
        
        for (let r_idx = 0; r_idx < shape.length; r_idx++) {
            for (let c_idx = 0; c_idx < shape[r_idx].length; c_idx++) {
                if (shape[r_idx][c_idx]) {
                    const cellCol = startCol + c_idx;
                    const cellRow = startRow + r_idx;
                    if (cellRow >= 0 && cellCol === playerCol && cellRow === playerRow) {
                        return true;
                    }
                }
            }
        }
        return false;
    }


    // --- Drawing Functions ---
    function drawGrid() {
        ctx.strokeStyle = COLORS.GRID_COLOR;
        ctx.lineWidth = 1;
        for (let x = 0; x < SCREEN_WIDTH; x += BLOCK_SIZE) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, SCREEN_HEIGHT);
            ctx.stroke();
        }
        for (let y = 0; y < SCREEN_HEIGHT; y += BLOCK_SIZE) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(SCREEN_WIDTH, y);
            ctx.stroke();
        }
    }

    function drawTetromino(tetromino) {
        const { shape, x, y, color } = tetromino;
        ctx.fillStyle = color;
        ctx.strokeStyle = COLORS.WHITE;
        ctx.lineWidth = 1;

        for (let i = 0; i < shape.length; i++) {
            for (let j = 0; j < shape[i].length; j++) {
                if (shape[i][j]) {
                    const blockY = y + i * BLOCK_SIZE;
                    if (blockY >= -BLOCK_SIZE) {
                        ctx.fillRect(x + j * BLOCK_SIZE, blockY, BLOCK_SIZE, BLOCK_SIZE);
                        ctx.strokeRect(x + j * BLOCK_SIZE, blockY, BLOCK_SIZE, BLOCK_SIZE);
                    }
                }
            }
        }
    }

    function drawUI() {
        ctx.fillStyle = COLORS.WHITE;
        // Score
        ctx.font = "30px sans-serif";
        ctx.textAlign = "left";
        ctx.fillText(`Score: ${state.score}`, 10, 35);
        // Speed
        ctx.textAlign = "right";
        ctx.fillText(`Speed: ${state.speedMultiplier.toFixed(1)}x`, SCREEN_WIDTH - 10, 35);
        // Spawn Mode
        const modeDisplay = state.spawnMode === 10 ? 0 : state.spawnMode;
        ctx.font = "24px sans-serif";
        ctx.textAlign = "left";
        ctx.fillText(`Mode: ${modeDisplay}`, 10, SCREEN_HEIGHT - 10);
    }
    
    function drawOverlays() {
        if (state.gameOver) {
            ctx.fillStyle = COLORS.PAUSE_OVERLAY_COLOR;
            ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);

            ctx.fillStyle = COLORS.RED;
            ctx.font = "60px sans-serif";
            ctx.textAlign = "center";
            ctx.fillText("Game Over", SCREEN_WIDTH / 2, SCREEN_HEIGHT / 2 - 60);

            ctx.fillStyle = COLORS.WHITE;
            ctx.font = "30px sans-serif";
            ctx.fillText(`Final Score: ${state.score}`, SCREEN_WIDTH / 2, SCREEN_HEIGHT / 2);

            ctx.font = "24px sans-serif";
            ctx.fillText("Any key to restart", SCREEN_WIDTH / 2, SCREEN_HEIGHT / 2 + 50);
        } else if (state.gamePaused) {
            ctx.fillStyle = COLORS.PAUSE_OVERLAY_COLOR;
            ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
            
            ctx.fillStyle = COLORS.WHITE;
            ctx.font = "50px sans-serif";
            ctx.textAlign = "center";
            ctx.fillText("Paused", SCREEN_WIDTH / 2, SCREEN_HEIGHT / 2);
        }
    }


    // --- Game Logic & Loop ---
    function update(timestamp) {
        if (state.gamePaused || state.gameOver) return;
        
        const currentPlayTime = (timestamp - state.gameStartTime - state.timePausedTotal) / 1000;
        state.score = Math.floor(currentPlayTime * 10 * state.speedMultiplier);

        // --- Spawn Tetromino Wave ---
        const currentSpawnInterval = SPAWN_INTERVAL; // Could be dynamic later
        if (timestamp - state.lastSpawnTime > currentSpawnInterval) {
            const spawnedThisWave = [];
            let currentTetrominoSet = ALL_TETROMINOS;
            if (state.spawnMode === 7) currentTetrominoSet = SMALL_TETROMINOS;
            else if (state.spawnMode === 8) currentTetrominoSet = CLASSIC_TETROMINOS;

            let lanesToTry = [];
            switch (state.spawnMode) {
                case 1: case 7: case 8: // Safe Lane
                    const safeLane = laneNames[Math.floor(Math.random() * (laneNames.length + 1))]; // +1 for "None"
                    lanesToTry = shuffleArray(laneNames.filter(name => name !== safeLane));
                    for(let i = 0; i < Math.min(lanesToTry.length, SPAWN_ATTEMPTS_PER_WAVE); i++) {
                        const newTetromino = attemptSpawnInLane(lanesToTry[i], state.tetrominos, currentTetrominoSet);
                        if (newTetromino) spawnedThisWave.push(newTetromino);
                    }
                    break;
                case 2: // Outer Lanes
                    const outerLane = Math.random() < 0.5 ? "left" : "right";
                    const newTetromino2 = attemptSpawnInLane(outerLane, state.tetrominos, currentTetrominoSet);
                    if (newTetromino2) spawnedThisWave.push(newTetromino2);
                    break;
                case 3: // Middle Lane
                    const newTetromino3 = attemptSpawnInLane("middle", state.tetrominos, currentTetrominoSet);
                    if (newTetromino3) spawnedThisWave.push(newTetromino3);
                    break;
                case 4: // Full Random Wave
                case 10: // Chaos Attack (same logic as 4 but can be expanded)
                    lanesToTry = shuffleArray([...laneNames]);
                    const spawnLimit = state.spawnMode === 10 ? 3 : 3;
                    for (let i = 0; i < spawnLimit; i++) {
                        if (lanesToTry[i]) {
                             const newTetromino = attemptSpawnInLane(lanesToTry[i], state.tetrominos, currentTetrominoSet);
                             if (newTetromino) spawnedThisWave.push(newTetromino);
                        }
                    }
                    break;
                case 5: // Single Random Lane
                    const randomLane = laneNames[Math.floor(Math.random() * laneNames.length)];
                    const newTetromino5 = attemptSpawnInLane(randomLane, state.tetrominos, currentTetrominoSet);
                    if (newTetromino5) spawnedThisWave.push(newTetromino5);
                    break;
                case 6: // Double Random Lanes
                    if (laneNames.length >= 2) {
                        lanesToTry = shuffleArray([...laneNames]).slice(0, 2);
                        lanesToTry.forEach(lane => {
                            const newTetromino = attemptSpawnInLane(lane, state.tetrominos, currentTetrominoSet);
                            if (newTetromino) spawnedThisWave.push(newTetromino);
                        });
                    }
                    break;
                case 9: // Alternating Lanes
                    const laneToTry = laneNames[state.nextSpawnLaneIndex];
                    const newTetromino9 = attemptSpawnInLane(laneToTry, state.tetrominos, currentTetrominoSet);
                    if (newTetromino9) spawnedThisWave.push(newTetromino9);
                    state.nextSpawnLaneIndex = (state.nextSpawnLaneIndex + 1) % laneNames.length;
                    break;
            }
            
            state.tetrominos.push(...spawnedThisWave);
            state.lastSpawnTime = timestamp;
        }

        // --- Move Tetrominos Down ---
        const currentMoveInterval = INITIAL_MOVE_INTERVAL / Math.max(0.01, state.speedMultiplier);
        if (timestamp - state.lastMoveTime > currentMoveInterval) {
            state.tetrominos.forEach(t => t.y += BLOCK_SIZE);
            state.lastMoveTime = timestamp;
        }

        // --- Remove Off-Screen Tetrominos & Check Collision ---
        state.tetrominos = state.tetrominos.filter(t => t.y < SCREEN_HEIGHT);
        for (const t of state.tetrominos) {
            if (checkCollision(t, state.playerX, state.playerY)) {
                console.log(`Collision Detected! Final Score: ${state.score}`);
                state.gameOver = true;
                break;
            }
        }
    }

    function gameLoop(timestamp) {
        update(timestamp);
        
        // Drawing
        ctx.fillStyle = COLORS.BLACK;
        ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
        
        drawGrid();
        state.tetrominos.forEach(drawTetromino);
        
        // Draw Player
        ctx.fillStyle = COLORS.PLAYER_COLOR;
        ctx.strokeStyle = COLORS.WHITE;
        ctx.lineWidth = 1;
        ctx.fillRect(state.playerX, state.playerY, BLOCK_SIZE, BLOCK_SIZE);
        ctx.strokeRect(state.playerX, state.playerY, BLOCK_SIZE, BLOCK_SIZE);
        
        drawUI();
        drawOverlays(); // Draw pause/game over screens last

        requestAnimationFrame(gameLoop);
    }

    // --- Event Handling ---
    let pauseStartTime = 0;
    window.addEventListener('keydown', (e) => {
        // Prevent browser default actions for arrow keys, etc.
        if(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "p", "P"].includes(e.key)) {
            e.preventDefault();
        }

        if (e.key === 'p' || e.key === 'P') {
            state.gamePaused = !state.gamePaused;
            if (state.gamePaused) {
                pauseStartTime = performance.now();
                console.log("Game Paused");
            } else {
                const pauseDuration = performance.now() - pauseStartTime;
                state.timePausedTotal += pauseDuration;
                console.log(`Game Resumed (Paused for ${(pauseDuration/1000).toFixed(2)}s)`);
            }
        }

        if (state.gameOver) {
            if (e.key !== 'Escape') {
                resetGameState();
            }
            return;
        }

        if (state.gamePaused) return;

        // Player movement and speed
        if (e.key === 'ArrowLeft') state.playerX = Math.max(0, state.playerX - BLOCK_SIZE);
        if (e.key === 'ArrowRight') state.playerX = Math.min(SCREEN_WIDTH - BLOCK_SIZE, state.playerX + BLOCK_SIZE);
        if (e.key === 'ArrowUp') state.speedMultiplier = Math.min(MAX_SPEED_MULTIPLIER, state.speedMultiplier + SPEED_INCREMENT);
        if (e.key === 'ArrowDown') state.speedMultiplier = Math.max(MIN_SPEED_MULTIPLIER, state.speedMultiplier - SPEED_INCREMENT);
        
        // Mode switching
        const keyNum = parseInt(e.key, 10);
        if (!isNaN(keyNum)) {
            let newMode = keyNum;
            if(newMode === 0) newMode = 10; // K_0 maps to mode 10
            
            if(newMode >= 1 && newMode <= 10) {
                state.spawnMode = newMode;
                if (newMode === 9) state.nextSpawnLaneIndex = 0; // Reset for alternating mode
                 console.log(`Spawn Mode set to: ${newMode}`);
            }
        }
    });

    // --- Initial Setup ---
    canvas.width = SCREEN_WIDTH;
    canvas.height = SCREEN_HEIGHT;
    
    resetGameState();
    requestAnimationFrame(gameLoop);
});
