// ==========================================
// 1. CONFIGURACIÓN MULTIJUGADOR REAL CON BOTÍN COMPARTIDO
// ==========================================
const WORLD_SIZE = 3000;
const PREPARATION_TIME = 10; 
const COMBAT_TIME = 60;      

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const minimapCanvas = document.getElementById('minimap');
const mCtx = minimapCanvas.getContext('2d');

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  minimapCanvas.width = 120;
  minimapCanvas.height = 120;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

let selectedEntryFee = parseInt(localStorage.getItem('selected_entry')) || 100;
let selectedSkin = localStorage.getItem('selected_skin') || 've';
let playerName = localStorage.getItem('player_name') || 'Jugador';
let gameActive = true;
let currentPhase = 'PREPARATION';
let timeLeft = PREPARATION_TIME;
let timerInterval = null;

const mouse = { x: canvas.width / 2, y: canvas.height / 2 };
let isBoosting = false;

window.addEventListener('mousemove', (e) => {
  mouse.x = e.clientX;
  mouse.y = e.clientY;
});

window.addEventListener('touchmove', (e) => {
  if (e.touches.length > 0) {
    mouse.x = e.touches[0].clientX;
    mouse.y = e.touches[0].clientY;
  }
}, { passive: true });

const boostBtn = document.getElementById('boost-btn');
if (boostBtn) {
  boostBtn.addEventListener('mousedown', () => isBoosting = true);
  boostBtn.addEventListener('mouseup', () => isBoosting = false);
  boostBtn.addEventListener('touchstart', (e) => { e.preventDefault(); isBoosting = true; }, { passive: false });
  boostBtn.addEventListener('touchend', () => isBoosting = false);
}

// ==========================================
// 2. CONEXIÓN A SUPABASE REALTIME (AISLADO POR SALA / APUESTA)
// ==========================================
let gameRoom = null;
const myPlayerId = 'player_' + Math.random().toString(36).substring(2, 9);
let remotePlayers = {}; 
let sharedLootOrbs = []; // Esferas de botín compartidas en tiempo real

// Creamos un nombre de canal único basado en la tarifa de entrada elegida (ej: 'arena_ves_50', 'arena_ves_1000')
const roomChannelName = `arena_ves_${selectedEntryFee}`;

if (typeof supabaseClient !== 'undefined' && supabaseClient) {
  gameRoom = supabaseClient.channel(roomChannelName, {
    config: { broadcast: { self: false } }
  });

  gameRoom.on('broadcast', { event: 'player_move' }, ({ payload }) => {
    if (payload.id !== myPlayerId) {
      remotePlayers[payload.id] = payload;
      remotePlayers[payload.id].lastUpdate = Date.now();
    }
  });

  gameRoom.on('broadcast', { event: 'player_died' }, ({ payload }) => {
    if (remotePlayers[payload.id]) {
      delete remotePlayers[payload.id];
    }
  });

  // Sincronizar aparición de botín por red
  gameRoom.on('broadcast', { event: 'spawn_loot' }, ({ payload }) => {
    sharedLootOrbs.push(payload);
  });

  // Sincronizar recolección de botín por red
  gameRoom.on('broadcast', { event: 'collect_loot' }, ({ payload }) => {
    if (sharedLootOrbs[payload.index]) {
      sharedLootOrbs.splice(payload.index, 1);
    }
  });

  gameRoom.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      console.log(`¡Conectado a la sala aislada [${roomChannelName}] con botín sincronizado!`);
    }
  });
}

// ==========================================
// 3. JUGADOR LOCAL Y BUCLE DE TRANSMISIÓN
// ==========================================
let player = {
  id: myPlayerId,
  name: playerName,
  x: WORLD_SIZE / 2 + (Math.random() - 0.5) * 500,
  y: WORLD_SIZE / 2 + (Math.random() - 0.5) * 500,
  angle: 0,
  speed: 3.5,
  radius: 12,
  body: [],
  length: 20,
  ves: selectedEntryFee,
  skinId: selectedSkin,
  alive: true
};

for (let i = 0; i < player.length; i++) {
  player.body.push({ x: player.x, y: player.y });
}

function dropLootOnDeath(x, y, totalVes) {
  const drops = 12;
  const valuePerDrop = Math.floor(totalVes / drops);

  for (let i = 0; i < drops; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.random() * 50;
    const lootItem = {
      x: x + Math.cos(angle) * dist,
      y: y + Math.sin(angle) * dist,
      ves: valuePerDrop,
      radius: Math.max(5, Math.min(12, Math.sqrt(valuePerDrop) * 1.2)),
      color: valuePerDrop > 200 ? '#4ade80' : '#38bdf8'
    };

    sharedLootOrbs.push(lootItem);

    if (gameRoom) {
      gameRoom.send({
        type: 'broadcast',
        event: 'spawn_loot',
        payload: lootItem
      });
    }
  }
}

// Control de tiempo para evitar saturación de red (Error 429)
let lastSendTime = 0;

function updateLocalPlayer() {
  if (!player.alive) return;

  player.radius = 10 + Math.min(20, Math.sqrt(player.ves) * 0.25);
  player.length = Math.floor(15 + player.ves / (selectedEntryFee / 20));

  let currentSpeed = player.speed;
  if (isBoosting && player.ves > (selectedEntryFee * 0.1)) {
    currentSpeed = 6.0;
    player.ves -= (selectedEntryFee * 0.0005);
  }

  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  const targetAngle = Math.atan2(mouse.y - centerY, mouse.x - centerX);
  let diff = targetAngle - player.angle;
  while (diff < -Math.PI) diff += Math.PI * 2;
  while (diff > Math.PI) diff -= Math.PI * 2;
  player.angle += diff * 0.15;

  player.x += Math.cos(player.angle) * currentSpeed;
  player.y += Math.sin(player.angle) * currentSpeed;

  player.x = Math.max(30, Math.min(WORLD_SIZE - 30, player.x));
  player.y = Math.max(30, Math.min(WORLD_SIZE - 30, player.y));

  player.body.unshift({ x: player.x, y: player.y });
  while (player.body.length > player.length) {
    player.body.pop();
  }

  // Recoger esferas de botín en el mapa
  for (let i = sharedLootOrbs.length - 1; i >= 0; i--) {
    const orb = sharedLootOrbs[i];
    const dx = player.x - orb.x;
    const dy = player.y - orb.y;
    if (Math.abs(dx) < 30 && Math.abs(dy) < 30) {
      if (Math.hypot(dx, dy) < player.radius + orb.radius + 8) {
        player.ves += orb.ves;
        sharedLootOrbs.splice(i, 1);

        // Avisar a los demás que esta esfera fue recogida
        if (gameRoom) {
          gameRoom.send({
            type: 'broadcast',
            event: 'collect_loot',
            payload: { index: i }
          });
        }
      }
    }
  }

  // Enviar nuestra posición con límite de tiempo (cada 250ms) para evitar error 429
  if (gameRoom && gameActive) {
    const now = Date.now();
    if (now - lastSendTime > 250) {
      lastSendTime = now;
      gameRoom.send({
        type: 'broadcast',
        event: 'player_move',
        payload: {
          id: player.id,
          name: player.name,
          x: player.x,
          y: player.y,
          angle: player.angle,
          ves: player.ves,
          skinId: player.skinId,
          body: player.body.slice(0, 15)
        }
      });
    }
  }
}

// ==========================================
// 4. RENDERIZADO EN PANTALLA
// ==========================================
function drawPlayer(p, camera, isLocal = false) {
  if (!p.body || p.body.length === 0) return;

  for (let i = p.body.length - 1; i >= 0; i--) {
    const seg = p.body[i];
    const screenX = seg.x - camera.x;
    const screenY = seg.y - camera.y;

    if (screenX < -40 || screenX > canvas.width + 40 || screenY < -40 || screenY > canvas.height + 40) continue;

    ctx.beginPath();
    const segRadius = Math.max(3, 12 * (1 - (i / p.body.length) * 0.3));
    ctx.arc(screenX, screenY, segRadius, 0, Math.PI * 2);

    if (p.skinId === 've') {
      if (i % 3 === 0) ctx.fillStyle = '#ffcc00';
      else if (i % 3 === 1) ctx.fillStyle = '#00247d';
      else ctx.fillStyle = '#cf142b';
    } else {
      ctx.fillStyle = isLocal ? '#22c55e' : '#38bdf8';
    }
    ctx.fill();
  }

  const headX = p.x - camera.x;
  const headY = p.y - camera.y;

  if (headX >= -40 && headX <= canvas.width + 40 && headY >= -40 && headY <= canvas.height + 40) {
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${p.name} (${Math.floor(p.ves)} VES)`, headX, headY - 18);
  }
}

function checkRealPlayerCollisions() {
  if (currentPhase !== 'COMBAT' || !player.alive) return;

  const now = Date.now();
  Object.keys(remotePlayers).forEach(id => {
    if (now - remotePlayers[id].lastUpdate > 3000) {
      delete remotePlayers[id];
    }
  });

  Object.values(remotePlayers).forEach(friend => {
    if (!friend.body) return;
    for (let seg of friend.body) {
      if (Math.abs(player.x - seg.x) < 20 && Math.abs(player.y - seg.y) < 20) {
        if (Math.hypot(player.x - seg.x, player.y - seg.y) < 14) {
          player.alive = false;
          
          dropLootOnDeath(player.x, player.y, player.ves);

          if (gameRoom) {
            gameRoom.send({ type: 'broadcast', event: 'player_died', payload: { id: player.id } });
          }
          endGame(false, `Chocaste contra ${friend.name}. ¡Has quedado eliminado!`);
          break;
        }
      }
    }
  });
}

function updateHUD() {
  const vesDisplay = document.getElementById('ves-display');
  const aliveDisplay = document.getElementById('alive-display');
  const timerDisplay = document.getElementById('timer-display');
  
  const totalConnected = Object.keys(remotePlayers).length + (player.alive ? 1 : 0);

  if (vesDisplay) vesDisplay.innerText = `${Math.floor(player.ves).toLocaleString()} VES`;
  if (aliveDisplay) aliveDisplay.innerText = `${totalConnected} Vivos en la Sala`;

  const m = Math.floor(timeLeft / 60).toString().padStart(2, '0');
  const s = (timeLeft % 60).toString().padStart(2, '0');
  if (timerDisplay) timerDisplay.innerText = `${m}:${s}`;
}

function startTimer() {
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    if (!gameActive) return;
    timeLeft--;

    if (timeLeft <= 0) {
      if (currentPhase === 'PREPARATION') {
        currentPhase = 'COMBAT';
        timeLeft = COMBAT_TIME; 
      } else {
        endGame(true, "¡Sobreviviste a la ronda contra tus amigos! Te llevas tu botín.");
      }
    }
  }, 1000);
}

function gameLoop() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (gameActive && player.alive) {
    updateLocalPlayer();
    checkRealPlayerCollisions();

    const camera = { x: player.x - canvas.width / 2, y: player.y - canvas.height / 2 };

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.02)';
    ctx.lineWidth = 1;
    for (let x = -camera.x % 120; x < canvas.width; x += 120) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
    }
    for (let y = -camera.y % 120; y < canvas.height; y += 120) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
    }

    sharedLootOrbs.forEach(orb => {
      const sx = orb.x - camera.x;
      const sy = orb.y - camera.y;
      if (sx >= -20 && sx <= canvas.width + 20 && sy >= -20 && sy <= canvas.height + 20) {
        ctx.beginPath();
        ctx.arc(sx, sy, orb.radius, 0, Math.PI * 2);
        ctx.fillStyle = orb.color;
        ctx.fill();
      }
    });

    Object.values(remotePlayers).forEach(friend => drawPlayer(friend, camera, false));
    drawPlayer(player, camera, true);

    updateHUD();
  }

  requestAnimationFrame(gameLoop);
}

gameActive = true;
startTimer();
requestAnimationFrame(gameLoop);

function endGame(survived, reason) {
  gameActive = false;
  clearInterval(timerInterval);

  const endModal = document.getElementById('end-modal');
  const endTitle = document.getElementById('end-title');
  const endDesc = document.getElementById('end-desc');
  const endVes = document.getElementById('end-ves-amount');

  if (endModal) endModal.style.display = 'flex';

  const finalAmount = survived ? Math.floor(player.ves) : 0;

  if (survived && typeof finishGameAndReward === 'function') {
    finishGameAndReward(finalAmount);
  }

  if (survived) {
    if (endTitle) { endTitle.innerText = "¡VICTORIA REAL!"; endTitle.style.color = "#4ade80"; }
    if (endDesc) endDesc.innerText = reason;
    if (endVes) endVes.innerText = `${finalAmount.toLocaleString()} VES`;
  } else {
    if (endTitle) { endTitle.innerText = "ELIMINADO"; endTitle.style.color = "#ef4444"; }
    if (endDesc) endDesc.innerText = reason;
    if (endVes) endVes.innerText = "0 VES";
  }
}