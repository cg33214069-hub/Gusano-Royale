// ==========================================
// SISTEMA DE SALDO SEGURO (ANTI-TRAMPA / ANTI-HACKER)
// ==========================================
function getSecureBalance() {
  const encoded = localStorage.getItem('secure_user_balance');
  if (!encoded) {
    const defaultVal = 5000;
    localStorage.setItem('secure_user_balance', btoa(defaultVal.toString()));
    return defaultVal;
  }
  try {
    const decoded = parseInt(atob(encoded));
    return isNaN(decoded) ? 0 : decoded;
  } catch (e) {
    return 0;
  }
}

function saveSecureBalance(amount) {
  const cleanAmount = Math.max(0, Math.floor(amount));
  localStorage.setItem('secure_user_balance', btoa(cleanAmount.toString()));
  localStorage.setItem('user_balance', cleanAmount.toString());
}

// ==========================================
// 1. CONFIGURACIÓN MULTIJUGADOR REAL CON BOTS Y BOTÍN COMPARTIDO
// ==========================================
const WORLD_SIZE = 3000;
const PREPARATION_TIME = 10; 
const COMBAT_TIME = 60;       

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const minimapCanvas = document.getElementById('minimap');
const mCtx = minimapCanvas ? minimapCanvas.getContext('2d') : null;

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  if (minimapCanvas) {
    minimapCanvas.width = 120;
    minimapCanvas.height = 120;
  }
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

// ==========================================
// CORRECCIÓN DE SALDO SEGURO: Descontar apuesta al entrar
// ==========================================
let currentBalance = getSecureBalance();
if (currentBalance >= selectedEntryFee) {
  currentBalance -= selectedEntryFee;
  saveSecureBalance(currentBalance);
}

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

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') isBoosting = true;
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') isBoosting = false;
});

const boostBtn = document.getElementById('boost-btn');
if (boostBtn) {
  boostBtn.addEventListener('mousedown', () => isBoosting = true);
  boostBtn.addEventListener('mouseup', () => isBoosting = false);
  boostBtn.addEventListener('touchstart', (e) => { e.preventDefault(); isBoosting = true; }, { passive: false });
  boostBtn.addEventListener('touchend', () => isBoosting = false);
}

// ==========================================
// 2. CONEXIÓN A SUPABASE Y GESTIÓN DE BOTS (CONFIGURABLE DESDE PANEL)
// ==========================================
let gameRoom = null;
const myPlayerId = 'player_' + Math.random().toString(36).substring(2, 9);
let remotePlayers = {}; 
let sharedLootOrbs = []; 
let activeBotsInRoom = []; 
let botsEnabledMaster = false; 

const roomChannelName = `arena_ves_${selectedEntryFee}`;

async function verificarYCargarBots() {
    if (typeof supabaseClient === 'undefined' || !supabaseClient) return;

    const { data: configData } = await supabaseClient
        .from('configuracion_juego')
        .select('*');

    let maestroActivo = false;
    let cantidadBotsConfig = 6;
    let montoBotConfig = 20.00;

    if (configData) {
        configData.forEach(item => {
            if (item.clave === 'bots_activos') {
                maestroActivo = (item.valor === 'true' || item.valor === true);
            }
            if (item.clave === 'cantidad_bots') {
                cantidadBotsConfig = parseInt(item.valor) || 6;
            }
            if (item.clave === 'monto_bot_ves') {
                montoBotConfig = parseFloat(item.valor) || 20.00;
            }
        });
    }

    if (maestroActivo) {
        botsEnabledMaster = true;
        activeBotsInRoom = [];
        const nombresBots = ['GusanoFantasma99', 'CazaPremio_Bot', 'CyberWorm', 'TurboGusano', 'ShadowBot', 'ReyDeLaArena', 'ViperPro', 'VenomX', 'MasterWorm', 'ApexGamer'];

        for (let i = 0; i < cantidadBotsConfig; i++) {
            const bX = 500 + Math.random() * (WORLD_SIZE - 1000);
            const bY = 500 + Math.random() * (WORLD_SIZE - 1000);
            const botObj = {
                id: 'bot_' + i,
                name: nombresBots[i % nombresBots.length] + (i > 9 ? i : ''),
                x: bX,
                y: bY,
                angle: Math.random() * Math.PI * 2,
                ves: montoBotConfig,
                radius: 14,
                body: [],
                length: 15,
                skinId: 'bot',
                alive: true
            };
            for (let j = 0; j < botObj.length; j++) {
                botObj.body.push({ x: bX, y: bY });
            }
            activeBotsInRoom.push(botObj);
        }
    } else {
        botsEnabledMaster = false;
        activeBotsInRoom = [];
    }
}

if (typeof supabaseClient !== 'undefined' && supabaseClient) {
  gameRoom = supabaseClient.channel(roomChannelName, {
    config: { broadcast: { self: false } }
  });

  gameRoom.on('broadcast', { event: 'player_move' }, ({ payload }) => {
    if (payload.id !== myPlayerId) {
      if (!remotePlayers[payload.id]) {
        remotePlayers[payload.id] = payload;
      } else {
        let p = remotePlayers[payload.id];
        p.targetX = payload.x;
        p.targetY = payload.y;
        p.targetAngle = payload.angle;
        p.ves = payload.ves;
        p.skinId = payload.skinId;
        p.targetBody = payload.body;
      }
      remotePlayers[payload.id].lastUpdate = Date.now();
    }
  });

  gameRoom.on('broadcast', { event: 'player_died' }, ({ payload }) => {
    if (remotePlayers[payload.id]) {
      delete remotePlayers[payload.id];
    }
  });

  gameRoom.on('broadcast', { event: 'spawn_loot' }, ({ payload }) => {
    sharedLootOrbs.push(payload);
  });

  gameRoom.on('broadcast', { event: 'collect_loot' }, ({ payload }) => {
    if (sharedLootOrbs[payload.index]) {
      sharedLootOrbs.splice(payload.index, 1);
    }
  });

  gameRoom.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      console.log(`¡Conectado a la sala aislada [${roomChannelName}]!`);
      verificarYCargarBots();
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

let lastSendTime = 0;

function updateLocalPlayer() {
  if (!player.alive) return;

  const isPreparing = (currentPhase === 'PREPARATION');

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

  // Actualización, movimiento y colisiones de los BOTS (Solo actúan en fase COMBAT)
  if (botsEnabledMaster && activeBotsInRoom.length > 0) {
    activeBotsInRoom.forEach(bot => {
      if (!bot.alive) return;

      // Movimiento errante suave
      bot.angle += (Math.random() - 0.5) * 0.4;
      bot.x += Math.cos(bot.angle) * 2.5;
      bot.y += Math.sin(bot.angle) * 2.5;

      // Rebote en los bordes del mundo
      if (bot.x < 50 || bot.x > WORLD_SIZE - 50) bot.angle = Math.PI - bot.angle;
      if (bot.y < 50 || bot.y > WORLD_SIZE - 50) bot.angle = -bot.angle;

      bot.body.unshift({ x: bot.x, y: bot.y });
      if (bot.body.length > bot.length) bot.body.pop();

      // Si ya pasó la preparación, aplican las colisiones de muerte
      if (!isPreparing) {
        // 1. SI TÚ CHOCAS CONTRA EL CUERPO DEL BOT, TE MUERES
        for (let seg of bot.body) {
          if (Math.hypot(player.x - seg.x, player.y - seg.y) < player.radius + 6) {
            player.alive = false;
            dropLootOnDeath(player.x, player.y, player.ves);

            if (gameRoom) {
              gameRoom.send({ type: 'broadcast', event: 'player_died', payload: { id: player.id } });
            }
            endGame(false, `Chocaste contra el cuerpo de ${bot.name}. ¡Has quedado eliminado!`);
            return;
          }
        }

        // 2. TÚ ELIMINAS AL BOT: Si la cabeza del bot choca contra el cuerpo de TU gusano
        let botMurio = false;
        for (let seg of player.body) {
          if (Math.hypot(bot.x - seg.x, bot.y - seg.y) < bot.radius + 6) {
            dropLootOnDeath(bot.x, bot.y, bot.ves);
            bot.alive = false;
            botMurio = true;
            break;
          }
        }

        if (botMurio) return;

        // 3. COMBATE ENTRE BOTS
        activeBotsInRoom.forEach(otherBot => {
          if (otherBot.id !== bot.id && otherBot.alive) {
            for (let seg of otherBot.body) {
              if (Math.hypot(bot.x - seg.x, bot.y - seg.y) < 12) {
                dropLootOnDeath(bot.x, bot.y, bot.ves);
                bot.alive = false;
              }
            }
          }
        });
      }
    });

    // Limpiar bots muertos de la memoria activa
    activeBotsInRoom = activeBotsInRoom.filter(b => b.alive);
  }

  // Recolectar botín y sumar VES en tiempo real
  for (let i = sharedLootOrbs.length - 1; i >= 0; i--) {
    const orb = sharedLootOrbs[i];
    const dx = player.x - orb.x;
    const dy = player.y - orb.y;
    if (Math.abs(dx) < 30 && Math.abs(dy) < 30) {
      if (Math.hypot(dx, dy) < player.radius + orb.radius + 8) {
        player.ves += orb.ves; 
        sharedLootOrbs.splice(i, 1);

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

  if (gameRoom && gameActive) {
    const now = Date.now();
    if (now - lastSendTime > 100) {
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
// 4. RENDERIZADO DE JUGADORES Y BOTS
// ==========================================
function drawPlayer(p, camera, isLocal = false) {
  if (!isLocal && p.skinId !== 'bot') {
    if (p.targetAngle !== undefined) {
      if (!p.x) p.x = p.targetX;
      if (!p.y) p.y = p.targetY;

      const remoteSpeed = 3.5;
      p.x += Math.cos(p.targetAngle) * remoteSpeed;
      p.y += Math.sin(p.targetAngle) * remoteSpeed;

      if (p.targetX !== undefined && p.targetY !== undefined) {
        p.x += (p.targetX - p.x) * 0.1;
        p.y += (p.targetY - p.y) * 0.1;
      }
    }

    if (p.targetBody && Array.isArray(p.targetBody)) {
      if (!p.body || p.body.length === 0) {
        p.body = JSON.parse(JSON.stringify(p.targetBody));
      } else {
        for (let i = 0; i < Math.min(p.body.length, p.targetBody.length); i++) {
          p.body[i].x += (p.targetBody[i].x - p.body[i].x) * 0.2;
          p.body[i].y += (p.targetBody[i].y - p.body[i].y) * 0.2;
        }
      }
    }
  }

  if (!p.body || p.body.length === 0) return;

  for (let i = p.body.length - 1; i >= 0; i--) {
    const seg = p.body[i];
    const screenX = seg.x - camera.x;
    const screenY = seg.y - camera.y;

    if (screenX < -40 || screenX > canvas.width + 40 || screenY < -40 || screenY > canvas.height + 40) continue;

    ctx.beginPath();
    const segRadius = Math.max(3, 12 * (1 - (i / p.body.length) * 0.3));
    ctx.arc(screenX, screenY, segRadius, 0, Math.PI * 2);

    if (p.skinId === 'bot') {
      const coloresBot = ['#22c55e', '#a855f7', '#f97316', '#06b6d4', '#ec4899', '#eab308'];
      ctx.fillStyle = coloresBot[i % coloresBot.length];
    } else if (p.skinId === 've') {
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

  // Colisiones con jugadores reales
  Object.values(remotePlayers).forEach(friend => {
    if (!friend.body) return;

    for (let seg of friend.body) {
      if (Math.hypot(player.x - seg.x, player.y - seg.y) < player.radius + 6) {
        player.alive = false;
        dropLootOnDeath(player.x, player.y, player.ves);

        if (gameRoom) {
          gameRoom.send({ type: 'broadcast', event: 'player_died', payload: { id: player.id } });
        }
        endGame(false, `Chocaste contra el cuerpo de ${friend.name}. ¡Has quedado eliminado!`);
        return;
      }
    }
  });
}

function updateHUD() {
  const vesDisplay = document.getElementById('ves-display');
  const aliveDisplay = document.getElementById('alive-display');
  const timerDisplay = document.getElementById('timer-display');
  
  const totalConnected = Object.keys(remotePlayers).length + (player.alive ? 1 : 0) + (botsEnabledMaster ? activeBotsInRoom.length : 0);

  if (vesDisplay) vesDisplay.innerText = `${Math.floor(player.ves).toLocaleString()} VES`;
  if (aliveDisplay) aliveDisplay.innerText = `${totalConnected} Activos en la Sala`;

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
        endGame(true, "¡Sobreviviste a la ronda! Te llevas todo tu botín recolectado.");
      }
    }
  }, 1000);
}

let lastTime = 0;
const fpsInterval = 1000 / 60;

function gameLoop(timestamp) {
  requestAnimationFrame(gameLoop);

  if (!lastTime) lastTime = timestamp;
  let elapsed = timestamp - lastTime;

  if (elapsed >= fpsInterval) {
    lastTime = timestamp - (elapsed % fpsInterval);

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

      // Dibujar bots si están activos
      if (botsEnabledMaster) {
          activeBotsInRoom.forEach(bot => drawPlayer(bot, camera, false));
      }

      Object.values(remotePlayers).forEach(friend => drawPlayer(friend, camera, false));
      drawPlayer(player, camera, true);

      // AVISO VISUAL DE FASE DE PREPARACIÓN EN PANTALLA
      if (currentPhase === 'PREPARATION') {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(canvas.width / 2 - 210, 30, 420, 50);
        ctx.strokeStyle = '#eab308';
        ctx.lineWidth = 2;
        ctx.strokeRect(canvas.width / 2 - 210, 30, 420, 50);

        ctx.fillStyle = '#eab308';
        ctx.font = 'bold 15px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`⏳ PREPARACIÓN: El combate inicia en ${timeLeft}s`, canvas.width / 2, 62);
      }

      updateHUD();
    }
  }
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

  if (survived) {
    let savedBalance = getSecureBalance();
    savedBalance += finalAmount;
    saveSecureBalance(savedBalance);

    if (typeof addPlayerBalance === 'function') {
      addPlayerBalance(finalAmount);
    }
  }

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