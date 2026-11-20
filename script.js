

// ==========================================
// DETECCIÓN DE MODO ESPECTADOR (ADMIN)
// ==========================================
const isSpectator = Boolean(window.isSpectatorMode);
const ROOM_ENTRY_MAP = {
  'sala-1': 50,
  'sala-2': 100,
  'sala-3': 500,
  'sala-4': 1000
};

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
  if (isSpectator) return;
  const cleanAmount = Math.max(0, Math.floor(amount));
  localStorage.setItem('secure_user_balance', btoa(cleanAmount.toString()));
  localStorage.setItem('user_balance', cleanAmount.toString());
}

// ==========================================
// 1. CONFIGURACIÓN DEL MUNDO Y COMIDA EN EL MAPA
// ==========================================
let WORLD_SIZE = 2500;
const MAX_LOOT_ORBS = 140;

function getCenterSpawnPos(spread = 120) {
  const mapSizeSafe = typeof WORLD_SIZE === 'number' && WORLD_SIZE > 0 ? WORLD_SIZE : 2500;
  const center = mapSizeSafe / 2;
  return {
    x: center + (Math.random() - 0.5) * spread,
    y: center + (Math.random() - 0.5) * spread
  };
}

function resetPlayerToCenter() {
  const mapSizeSafe = typeof WORLD_SIZE === 'number' && WORLD_SIZE > 0 ? WORLD_SIZE : 2500;
  freeCamPos.x = mapSizeSafe / 2;
  freeCamPos.y = mapSizeSafe / 2;

  if (!isSpectator && typeof player !== 'undefined') {
    const spawn = getCenterSpawnPos(120);
    player.x = spawn.x;
    player.y = spawn.y;
    player.body = [];
    const segCount = Math.max(5, player.length || 20);
    for (let i = 0; i < segCount; i++) {
      player.body.push({ x: player.x, y: player.y });
    }
  }
}

async function cargarTamanoMapaGlobal() {
  if (typeof supabaseClient === 'undefined' || !supabaseClient) return;

  const { data, error } = await supabaseClient
    .from('game_config')
    .select('map_size')
    .eq('id', 1)
    .single();

  if (data && data.map_size) {
    WORLD_SIZE = Number(data.map_size) || 2500;
    console.log(`🗺️ Tamaño de mapa global cargado desde Supabase: ${WORLD_SIZE}x${WORLD_SIZE}`);
    resetPlayerToCenter();
  }
}

cargarTamanoMapaGlobal();
const PREPARATION_TIME = 10; 
const COMBAT_TIME = 60;      

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const minimapCanvas = document.getElementById('minimap');
const mCtx = minimapCanvas ? minimapCanvas.getContext('2d') : null;

function resizeCanvas() {
  if (!canvas) return;
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  if (minimapCanvas) {
    minimapCanvas.width = 120;
    minimapCanvas.height = 120;
  }
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

let selectedEntryFee = isSpectator
  ? (ROOM_ENTRY_MAP[window.spectatorRoomId] || 50)
  : (parseInt(localStorage.getItem('selected_entry')) || 100);

let selectedSkin = localStorage.getItem('selected_skin') || 've';
let selectedColor = localStorage.getItem('worm_color') || '#22c55e';
let playerName = localStorage.getItem('player_name') || 'Jugador';
let gameActive = true;
let currentPhase = 'PREPARATION';
let timeLeft = PREPARATION_TIME;
let timerInterval = null;

// Variables exclusivas para cámara de espectador
let spectateIndex = 0;
let freeCamPos = { x: WORLD_SIZE / 2, y: WORLD_SIZE / 2 };

// Cambiar de jugador observado al hacer clic/tap en modo espectador
window.addEventListener('click', (e) => {
  if (!isSpectator) return;
  if (e.target && e.target.tagName === 'BUTTON') return;
  const ids = Object.keys(remotePlayers);
  if (ids.length > 0) {
    spectateIndex = (spectateIndex + 1) % ids.length;
  }
});

// ==========================================
// DESCUENTO AUTOMÁTICO Y SEGURO DE LA ENTRADA EN SUPABASE
// ==========================================
async function descontarEntradaEnSupabase() {
  if (isSpectator) return;
  if (typeof supabaseClient === 'undefined' || !supabaseClient) return;

  const userId = localStorage.getItem('user_id');
  const userEmail = localStorage.getItem('user_email');

  if (!userId && !userEmail) return;

  let query = supabaseClient.from('profiles').select('id, balance');
  if (userId) {
    query = query.eq('id', userId);
  } else {
    query = query.eq('email', userEmail);
  }

  const { data: profile, error } = await query.maybeSingle();
  if (error || !profile) return;

  const saldoActual = Number(profile.balance || 0);
  if (saldoActual >= selectedEntryFee) {
    const nuevoSaldo = saldoActual - selectedEntryFee;
    
    await supabaseClient
      .from('profiles')
      .update({ balance: nuevoSaldo })
      .eq('id', profile.id);

    saveSecureBalance(nuevoSaldo);
  }
}

const mouse = { x: canvas.width / 2, y: canvas.height / 2 };
let isBoosting = false;

// --- CONTROL HÍBRIDO (MOUSE / TACTIL / JOYSTICK) ---
window.addEventListener('mousemove', (e) => {
  if (typeof joystickVector === 'undefined' || (joystickVector.x === 0 && joystickVector.y === 0)) {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
  }
});

window.addEventListener('touchmove', (e) => {
  if (e.touches.length > 0) {
    for (let i = 0; i < e.touches.length; i++) {
      let t = e.touches[i];
      if (isSpectator || t.clientX >= window.innerWidth / 2) {
        mouse.x = t.clientX;
        mouse.y = t.clientY;
      }
    }
  }
}, { passive: true });

window.addEventListener('keydown', (e) => {
  if (isSpectator) return;
  if (e.code === 'Space') isBoosting = true;
});
window.addEventListener('keyup', (e) => {
  if (isSpectator) return;
  if (e.code === 'Space') isBoosting = false;
});

const boostBtn = document.getElementById('boost-btn');
if (boostBtn && !isSpectator) {
  boostBtn.addEventListener('mousedown', () => isBoosting = true);
  boostBtn.addEventListener('mouseup', () => isBoosting = false);
  boostBtn.addEventListener('touchstart', (e) => { e.preventDefault(); isBoosting = true; }, { passive: false });
  boostBtn.addEventListener('touchend', () => isBoosting = false);
}

// ==========================================
// 2. CONEXIÓN A SUPABASE Y SOCKETS DE RENDER
// ==========================================
let gameRoom = null;
const myPlayerId = 'player_' + Math.random().toString(36).substring(2, 9);
let remotePlayers = {}; 
let sharedLootOrbs = []; 

let mapaComidaActiva = true;
let cantidadComidaConfig = 150;
let valorComidaConfig = 10.00;
let arenaFoodOrbs = []; 

const FOOD_COLORS = ['#38bdf8', '#4ade80', '#facc15', '#f97316', '#e879f9', '#f43f5e', '#2dd4bf'];
const FOOD_RADIUS = 3.5;

function getRandomFoodColor() {
  return FOOD_COLORS[Math.floor(Math.random() * FOOD_COLORS.length)];
}

function appendLootOrbsWithLimit(newOrbs) {
  if (!Array.isArray(newOrbs) || newOrbs.length === 0) return;
  sharedLootOrbs.push(...newOrbs);
  if (sharedLootOrbs.length > MAX_LOOT_ORBS) {
    sharedLootOrbs.splice(0, sharedLootOrbs.length - MAX_LOOT_ORBS);
  }
}

const roomChannelName = `arena_ves_${selectedEntryFee}`;

let socket = null;
if (typeof io !== 'undefined') {
  socket = io('https://gusano-royale.onrender.com');
  
  socket.on('connect', () => {
    console.log('¡Conectado al servidor de Render con éxito!');
  });
}

async function verificarYCargarComida() {
  if (typeof supabaseClient === 'undefined' || !supabaseClient) return;

  const { data: configData } = await supabaseClient
    .from('configuracion_juego')
    .select('*');

  if (configData) {
    configData.forEach(item => {
      if (item.clave === 'comida_activa') {
        mapaComidaActiva = (item.valor === 'true' || item.valor === true);
      }
      if (item.clave === 'cantidad_comida') {
        cantidadComidaConfig = parseInt(item.valor) || 150;
      }
      if (item.clave === 'valor_comida_ves') {
        valorComidaConfig = parseFloat(item.valor) || 10.00;
      }
    });
  }

  if (mapaComidaActiva) {
    arenaFoodOrbs = [];
    for (let i = 0; i < cantidadComidaConfig; i++) {
      arenaFoodOrbs.push({
        x: Math.random() * (WORLD_SIZE - 200) + 100,
        y: Math.random() * (WORLD_SIZE - 200) + 100,
        ves: valorComidaConfig,
        radius: FOOD_RADIUS,
        color: getRandomFoodColor()
      });
    }
  } else {
    arenaFoodOrbs = [];
  }
}

if (typeof supabaseClient !== 'undefined' && supabaseClient) {
  gameRoom = supabaseClient.channel(roomChannelName, {
    config: { broadcast: { self: false } }
  });

  gameRoom.on('broadcast', { event: 'player_move' }, ({ payload }) => {
    if (payload.id !== myPlayerId) {
      if (!remotePlayers[payload.id]) {
        remotePlayers[payload.id] = {
          ...payload,
          targetX: payload.x,
          targetY: payload.y,
          targetAngle: payload.angle,
          currentSpeed: payload.speed || 2.6,
          targetBody: payload.body
        };
      } else {
        let p = remotePlayers[payload.id];
        p.targetX = payload.x;
        p.targetY = payload.y;
        p.targetAngle = payload.angle;
        p.currentSpeed = payload.speed || 2.6;
        p.ves = payload.ves;
        p.skinId = payload.skinId;
        p.color = payload.color;
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

  gameRoom.on('broadcast', { event: 'spawn_loot_batch' }, ({ payload }) => {
    if (Array.isArray(payload.orbs)) {
      appendLootOrbsWithLimit(payload.orbs);
    }
  });

  gameRoom.on('broadcast', { event: 'spawn_loot' }, ({ payload }) => {
    appendLootOrbsWithLimit([payload]);
  });

  gameRoom.on('broadcast', { event: 'collect_loot' }, ({ payload }) => {
    if (payload && payload.lootId) {
      const idx = sharedLootOrbs.findIndex(o => o.id === payload.lootId);
      if (idx !== -1) sharedLootOrbs.splice(idx, 1);
    } else if (payload && typeof payload.index === 'number' && sharedLootOrbs[payload.index]) {
      sharedLootOrbs.splice(payload.index, 1);
    }
  });

  gameRoom.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      console.log(`¡Conectado a la sala aislada [${roomChannelName}]${isSpectator ? ' (MODO ESPECTADOR)' : ''}!`);
      verificarYCargarComida();
    }
  });
}

// ==========================================
// 3. JUGADOR LOCAL Y BUCLE DE JUEGO
// ==========================================
const initialSpawn = getCenterSpawnPos(120);

let player = {
  id: myPlayerId,
  name: playerName,
  x: initialSpawn.x,
  y: initialSpawn.y,
  angle: 0,
  speed: 2.6,
  radius: 12,
  body: [],
  length: 20,
  ves: isSpectator ? 0 : selectedEntryFee, 
  skinId: selectedSkin,
  color: selectedColor,
  alive: !isSpectator
};

if (!isSpectator) {
  for (let i = 0; i < player.length; i++) {
    player.body.push({ x: player.x, y: player.y });
  }
}

function dropLootOnDeath(x, y, totalVes, bodySegments = []) {
  if (isSpectator) return;

  const validBody = Array.isArray(bodySegments) && bodySegments.length > 0
    ? bodySegments
    : [{ x, y }];

  const drops = Math.min(45, Math.max(30, validBody.length * 2));
  const valuePerDrop = totalVes > 0 ? Math.max(0.5, Number((totalVes / drops).toFixed(2))) : 1;
  const batchOrbs = [];

  for (let i = 0; i < drops; i++) {
    const progress = drops > 1 ? i / (drops - 1) : 0;
    const exactIndex = progress * (validBody.length - 1);
    const idxA = Math.floor(exactIndex);
    const idxB = Math.min(validBody.length - 1, idxA + 1);
    const t = exactIndex - idxA;

    const segA = validBody[idxA] || { x, y };
    const segB = validBody[idxB] || segA;

    const baseX = segA.x + (segB.x - segA.x) * t;
    const baseY = segA.y + (segB.y - segA.y) * t;

    const jitterAngle = Math.random() * Math.PI * 2;
    const jitterDist = Math.random() * 8;

    batchOrbs.push({
      id: 'loot_' + Math.random().toString(36).substring(2, 9),
      x: Number((baseX + Math.cos(jitterAngle) * jitterDist).toFixed(1)),
      y: Number((baseY + Math.sin(jitterAngle) * jitterDist).toFixed(1)),
      ves: valuePerDrop,
      radius: Math.max(5.5, Math.min(11, 5.5 + Math.sqrt(valuePerDrop) * 0.7)),
      color: getRandomFoodColor()
    });
  }

  appendLootOrbsWithLimit(batchOrbs);

  if (gameRoom) {
    gameRoom.send({
      type: 'broadcast',
      event: 'spawn_loot_batch',
      payload: { orbs: batchOrbs }
    });
  }
}

let lastSendTime = 0;

function updateLocalPlayer() {
  if (isSpectator || !player.alive) return;

  player.radius = 10 + Math.min(20, Math.sqrt(player.ves) * 0.25);
  player.length = Math.floor(15 + player.ves / (selectedEntryFee / 20));

  let currentSpeed = player.speed;

  if (isBoosting && player.ves > (selectedEntryFee * 0.1)) {
    currentSpeed = 4.6;
    player.ves -= (selectedEntryFee * 0.0005);
  }

  let targetAngle = player.angle;
  if (typeof joystickVector !== 'undefined' && (joystickVector.x !== 0 || joystickVector.y !== 0)) {
    targetAngle = Math.atan2(joystickVector.y, joystickVector.x);
  } else {
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    targetAngle = Math.atan2(mouse.y - centerY, mouse.x - centerX);
  }

  let diff = targetAngle - player.angle;
  while (diff < -Math.PI) diff += Math.PI * 2;
  while (diff > Math.PI) diff -= Math.PI * 2;
  player.angle += diff * 0.15;

  player.x += Math.cos(player.angle) * currentSpeed;
  player.y += Math.sin(player.angle) * currentSpeed;

  const mapSizeSafe = typeof WORLD_SIZE === 'number' && WORLD_SIZE > 0 ? WORLD_SIZE : 2500;
  if (currentPhase === 'PREPARATION') {
    const margin = player.radius + 10;
    player.x = Math.max(margin, Math.min(mapSizeSafe - margin, player.x));
    player.y = Math.max(margin, Math.min(mapSizeSafe - margin, player.y));
  } else if (!player.alive) {
    player.x = Math.max(0, Math.min(mapSizeSafe, player.x));
    player.y = Math.max(0, Math.min(mapSizeSafe, player.y));
  }

  player.body.unshift({ x: player.x, y: player.y });
  while (player.body.length > player.length) {
    player.body.pop();
  }

  if (mapaComidaActiva && arenaFoodOrbs.length > 0) {
    for (let i = arenaFoodOrbs.length - 1; i >= 0; i--) {
      const food = arenaFoodOrbs[i];
      const dx = player.x - food.x;
      const dy = player.y - food.y;

      if (Math.abs(dx) < 30 && Math.abs(dy) < 30) {
        if (Math.hypot(dx, dy) < player.radius + food.radius + 4) {
          player.ves += food.ves; 

          food.x = Math.random() * (mapSizeSafe - 200) + 100;
          food.y = Math.random() * (mapSizeSafe - 200) + 100;
          food.ves = valorComidaConfig;
          food.radius = FOOD_RADIUS;
          food.color = getRandomFoodColor();
        }
      }
    }
  }

  for (let i = sharedLootOrbs.length - 1; i >= 0; i--) {
    const orb = sharedLootOrbs[i];
    const orbRadius = orb.radius || 7;
    const dx = player.x - orb.x;
    const dy = player.y - orb.y;
    if (Math.abs(dx) < 35 && Math.abs(dy) < 35) {
      if (Math.hypot(dx, dy) < player.radius + orbRadius + 8) {
        player.ves += orb.ves;
        const collectedId = orb.id;
        sharedLootOrbs.splice(i, 1);

        if (gameRoom && collectedId) {
          gameRoom.send({
            type: 'broadcast',
            event: 'collect_loot',
            payload: { lootId: collectedId }
          });
        }
      }
    }
  }

  if (gameRoom && gameActive) {
    const now = Date.now();
    if (now - lastSendTime > 90) {
      lastSendTime = now;
      gameRoom.send({
        type: 'broadcast',
        event: 'player_move',
        payload: {
          id: player.id,
          name: player.name,
          x: Number(player.x.toFixed(1)),
          y: Number(player.y.toFixed(1)),
          angle: Number(player.angle.toFixed(3)),
          speed: currentSpeed,
          ves: Math.floor(player.ves),
          skinId: player.skinId,
          color: player.color,
          body: player.body.slice(0, 12)
        }
      });
    }
  }
}

// ==========================================
// 4. RENDERIZADO Y LÍNEA CONTINUA (FLUIDO / TIPO SEDA)
// ==========================================
function drawPlayer(p, camera, isLocal) {
  if (!isLocal) {
    if (p.targetX !== undefined && p.targetY !== undefined) {
      if (p.x === undefined || p.y === undefined) {
        p.x = p.targetX;
        p.y = p.targetY;
      } else {
        const dist = Math.hypot(p.targetX - p.x, p.targetY - p.y);
        if (dist > 250) {
          p.x = p.targetX;
          p.y = p.targetY;
        } else {
          const spd = p.currentSpeed || 2.6;
          if (p.targetAngle !== undefined) {
            p.x += Math.cos(p.targetAngle) * spd;
            p.y += Math.sin(p.targetAngle) * spd;
            p.targetX += Math.cos(p.targetAngle) * spd;
            p.targetY += Math.sin(p.targetAngle) * spd;
          }
          p.x += (p.targetX - p.x) * 0.18;
          p.y += (p.targetY - p.y) * 0.18;
        }
      }
    }

    if (p.targetBody && Array.isArray(p.targetBody)) {
      if (!p.body || p.body.length !== p.targetBody.length) {
        p.body = p.targetBody.map(seg => ({ x: seg.x, y: seg.y }));
      } else {
        p.body[0].x = p.x;
        p.body[0].y = p.y;
        for (let i = 1; i < p.body.length; i++) {
          const prev = p.body[i - 1];
          const curr = p.body[i];
          const targetSeg = p.targetBody[i];
          curr.x += ((prev.x + targetSeg.x) * 0.5 - curr.x) * 0.35;
          curr.y += ((prev.y + targetSeg.y) * 0.5 - curr.y) * 0.35;
        }
      }
    }
  }

  if (!p.body || p.body.length < 2) return;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const wormRadius = Math.max(5.5, 9 * Math.min(1.35, 1 + Math.sqrt(p.ves || 0) * 0.04));
  ctx.lineWidth = wormRadius * 2;

  if (p.skinId === 've') {
    ctx.strokeStyle = '#ffcc00';
  } else if (p.skinId === 'fuego') {
    ctx.strokeStyle = '#f97316';
  } else if (p.skinId === 'galaxia') {
    ctx.strokeStyle = '#a855f7';
  } else if (p.skinId === 'oro') {
    ctx.strokeStyle = '#eab308';
  } else {
    ctx.strokeStyle = p.color || localStorage.getItem('worm_color') || (isLocal ? '#22c55e' : '#38bdf8');
  }

  ctx.beginPath();
  let firstValid = false;
  for (let i = 0; i < p.body.length; i++) {
    const seg = p.body[i];
    const screenX = seg.x - camera.x;
    const screenY = seg.y - camera.y;

    if (i === 0) {
      ctx.moveTo(screenX, screenY);
      firstValid = true;
    } else {
      ctx.lineTo(screenX, screenY);
    }
  }

  if (firstValid) {
    ctx.stroke();
  }
  ctx.restore();

  const headX = p.x - camera.x;
  const headY = p.y - camera.y;

  if (headX >= -60 && headX <= canvas.width + 60 && headY >= -60 && headY <= canvas.height + 60) {
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${p.name} (${Math.floor(p.ves)} VES)`, headX, headY - (wormRadius + 8));
  }
}

// ==========================================
// FUNCIÓN: TABLA DE POSICIONES (LEADERBOARD)
// ==========================================
function drawLeaderboard() {
  let allPlayers = [];
  if (!isSpectator && player.alive) {
    allPlayers.push({ name: player.name, ves: player.ves, isLocal: true });
  }
  Object.values(remotePlayers).forEach(rp => {
    allPlayers.push({ name: rp.name || 'Jugador', ves: rp.ves || 0, isLocal: false });
  });

  allPlayers.sort((a, b) => b.ves - a.ves);

  const startX = canvas.width - 210;
  const startY = 80;
  const width = 190;
  const height = Math.max(54, 30 + (Math.min(5, allPlayers.length) * 24));

  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.fillRect(startX, startY, width, height);
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(startX, startY, width, height);

  ctx.fillStyle = '#38bdf8';
  ctx.font = 'bold 12px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('🏆 TOP RECOLECTORES', startX + 12, startY + 20);

  ctx.font = '11px sans-serif';
  if (allPlayers.length === 0) {
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('Esperando jugadores...', startX + 12, startY + 42);
    return;
  }

  for (let i = 0; i < Math.min(5, allPlayers.length); i++) {
    const p = allPlayers[i];
    const yPos = startY + 42 + (i * 22);

    ctx.fillStyle = p.isLocal ? '#4ade80' : '#ffffff';
    ctx.fillText(`${i + 1}. ${p.name.substring(0, 10)}`, startX + 12, yPos);
    
    ctx.textAlign = 'right';
    ctx.fillStyle = '#eab308';
    ctx.fillText(`${Math.floor(p.ves)} VES`, startX + width - 12, yPos);
    ctx.textAlign = 'left';
  }
}

function cleanupInactiveRemotePlayers() {
  const now = Date.now();
  Object.keys(remotePlayers).forEach(id => {
    if (now - remotePlayers[id].lastUpdate > 3500) {
      delete remotePlayers[id];
    }
  });
}

function checkRealPlayerCollisions() {
  cleanupInactiveRemotePlayers();
  if (isSpectator || currentPhase !== 'COMBAT' || !player.alive) return;

  const hitThreshold = player.radius + 7;

  Object.values(remotePlayers).forEach(friend => {
    if (!friend.body || friend.body.length === 0) return;

    for (let i = 0; i < friend.body.length; i += 2) {
      const seg = friend.body[i];
      if (Math.abs(player.x - seg.x) < 40 && Math.abs(player.y - seg.y) < 40) {
        if (Math.hypot(player.x - seg.x, player.y - seg.y) < hitThreshold) {
          player.alive = false;
          dropLootOnDeath(player.x, player.y, player.ves, player.body);

          if (gameRoom) {
            gameRoom.send({ type: 'broadcast', event: 'player_died', payload: { id: player.id } });
          }
          endGame(false, `Chocaste contra el cuerpo de ${friend.name}. ¡Has quedado eliminado!`);
          return;
        }
      }
    }
  });
}

function checkWallCollisions() {
  if (isSpectator || currentPhase !== 'COMBAT' || !player.alive) return;

  const mapSizeSafe = typeof WORLD_SIZE === 'number' && WORLD_SIZE > 0 ? WORLD_SIZE : 2500;
  const hitLeft = player.x - player.radius <= 0;
  const hitRight = player.x + player.radius >= mapSizeSafe;
  const hitTop = player.y - player.radius <= 0;
  const hitBottom = player.y + player.radius >= mapSizeSafe;

  if (hitLeft || hitRight || hitTop || hitBottom) {
    player.alive = false;
    dropLootOnDeath(player.x, player.y, player.ves, player.body);

    if (gameRoom) {
      gameRoom.send({
        type: 'broadcast',
        event: 'player_died',
        payload: { id: player.id }
      });
    }

    endGame(false, '¡Chocaste contra la línea roja del límite del mapa! Has quedado eliminado.');
  }
}

function updateHUD(observedPlayer) {
  const vesDisplay = document.getElementById('ves-display');
  const aliveDisplay = document.getElementById('alive-display');
  const timerDisplay = document.getElementById('timer-display');
  const badge = document.getElementById('spectator-badge');
  
  const totalConnected = Object.keys(remotePlayers).length + ((!isSpectator && player.alive) ? 1 : 0);

  if (isSpectator) {
    if (vesDisplay) {
      vesDisplay.innerText = observedPlayer ? `${Math.floor(observedPlayer.ves || 0).toLocaleString()} VES` : `Sala ${selectedEntryFee}`;
    }
    if (badge) {
      badge.innerText = observedPlayer
        ? `👁️ VIENDO A: ${observedPlayer.name} (Clic para cambiar)`
        : `👁️ MODO ESPECTADOR - SALA LIBRE (Mueve el cursor para explorar)`;
    }
  } else {
    if (vesDisplay) vesDisplay.innerText = `${Math.floor(player.ves).toLocaleString()} VES`;
  }

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

    const skinBtn = document.getElementById('skin-btn');
    if (skinBtn && !isSpectator) {
      if (currentPhase === 'PREPARATION') {
        skinBtn.style.display = 'block';
      } else {
        skinBtn.style.display = 'none';
        if (typeof cerrarModalDiseños === 'function') cerrarModalDiseños();
      }
    }

    if (timeLeft <= 0) {
      if (currentPhase === 'PREPARATION') {
        currentPhase = 'COMBAT';
        timeLeft = COMBAT_TIME;      
      } else {
        if (isSpectator) {
          currentPhase = 'PREPARATION';
          timeLeft = PREPARATION_TIME;
        } else {
          endGame(true, "¡Sobreviviste a la ronda! Te llevas todo tu botín recolectado.");
        }
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

    if (gameActive && (player.alive || isSpectator)) {
      if (!isSpectator) {
        updateLocalPlayer();
      }
      checkRealPlayerCollisions();
      checkWallCollisions();

      const mapSizeSafe = typeof WORLD_SIZE === 'number' && WORLD_SIZE > 0 ? WORLD_SIZE : 2500;
      let camera = { x: 0, y: 0 };
      let observedPlayer = null;

      if (isSpectator) {
        const remoteList = Object.values(remotePlayers);
        if (remoteList.length > 0) {
          if (spectateIndex >= remoteList.length) spectateIndex = 0;
          observedPlayer = remoteList[spectateIndex];
          freeCamPos.x = observedPlayer.x || mapSizeSafe / 2;
          freeCamPos.y = observedPlayer.y || mapSizeSafe / 2;
        } else {
          const dx = mouse.x - canvas.width / 2;
          const dy = mouse.y - canvas.height / 2;
          if (Math.hypot(dx, dy) > 40) {
            const angle = Math.atan2(dy, dx);
            freeCamPos.x = Math.max(0, Math.min(mapSizeSafe, freeCamPos.x + Math.cos(angle) * 5));
            freeCamPos.y = Math.max(0, Math.min(mapSizeSafe, freeCamPos.y + Math.sin(angle) * 5));
          }
        }
        camera.x = freeCamPos.x - canvas.width / 2;
        camera.y = freeCamPos.y - canvas.height / 2;
      } else {
        camera.x = player.x - canvas.width / 2;
        camera.y = player.y - canvas.height / 2;
      }

      // Cuadrícula de fondo
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.02)';
      ctx.lineWidth = 1;
      for (let x = -camera.x % 120; x < canvas.width; x += 120) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
      }
      for (let y = -camera.y % 120; y < canvas.height; y += 120) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
      }

      // Línea delimitadora del mapa (azul en preparación, roja al iniciar combate)
      const mapScreenX = 0 - camera.x;
      const mapScreenY = 0 - camera.y;

      ctx.strokeStyle = currentPhase === 'COMBAT' ? '#ef4444' : '#38bdf8';
      ctx.lineWidth = 6;
      ctx.strokeRect(mapScreenX, mapScreenY, mapSizeSafe, mapSizeSafe);

      if (mapaComidaActiva) {
        arenaFoodOrbs.forEach(food => {
          const sx = food.x - camera.x;
          const sy = food.y - camera.y;
          if (sx >= -20 && sx <= canvas.width + 20 && sy >= -20 && sy <= canvas.height + 20) {
            ctx.beginPath();
            ctx.arc(sx, sy, food.radius || FOOD_RADIUS, 0, Math.PI * 2);
            ctx.fillStyle = food.color || '#38bdf8';
            ctx.fill();
          }
        });
      }

      // Dibujar botín soltado al morir
      sharedLootOrbs.forEach(orb => {
        const sx = orb.x - camera.x;
        const sy = orb.y - camera.y;
        const r = orb.radius || 7;
        if (sx >= -30 && sx <= canvas.width + 30 && sy >= -30 && sy <= canvas.height + 30) {
          ctx.beginPath();
          ctx.arc(sx, sy, r, 0, Math.PI * 2);
          ctx.fillStyle = orb.color || '#facc15';
          ctx.fill();
        }
      });

      Object.values(remotePlayers).forEach(friend => drawPlayer(friend, camera, false));
      
      if (!isSpectator) {
        drawPlayer(player, camera, true);
      }

      drawLeaderboard();

      updateHUD(observedPlayer);
    }
  }
}

gameActive = true;
const skinBtnInit = document.getElementById('skin-btn');
if (skinBtnInit && !isSpectator) skinBtnInit.style.display = 'block';

startTimer();
requestAnimationFrame(gameLoop);

// ==========================================
// FUNCIÓN ENDGAME OPTIMIZADA PARA GUARDAR EL PREMIO
// ==========================================
async function endGame(survived, reason) {
  if (isSpectator) return;

  gameActive = false;
  clearInterval(timerInterval);

  const endModal = document.getElementById('end-modal');
  const endTitle = document.getElementById('end-title');
  const endDesc = document.getElementById('end-desc');
  const endVes = document.getElementById('end-ves-amount');

  if (endModal) endModal.style.display = 'flex';

  const finalAmount = survived ? Math.floor(player.ves) : 0;

  if (survived && finalAmount > 0) {
    let savedBalance = getSecureBalance();
    savedBalance += finalAmount;
    saveSecureBalance(savedBalance);

    if (typeof supabaseClient !== 'undefined' && supabaseClient) {
      const userId = localStorage.getItem('user_id');
      const userEmail = localStorage.getItem('user_email');

      if (userId || userEmail) {
        let query = supabaseClient.from('profiles').select('id, balance');
        if (userId) {
          query = query.eq('id', userId);
        } else {
          query = query.eq('email', userEmail);
        }

        const { data: profile, error: errFetch } = await query.maybeSingle();

        if (!errFetch && profile) {
          const balanceActualServidor = Number(profile.balance || 0);
          const nuevoBalanceServidor = balanceActualServidor + finalAmount;

          const { error: errUpdate } = await supabaseClient
            .from('profiles')
            .update({ balance: nuevoBalanceServidor })
            .eq('id', profile.id);

          if (errUpdate) {
            console.error("❌ Error de Supabase al sumar la ganancia:", errUpdate.message);
          } else {
            console.log("✅ ¡Ganancia de", finalAmount, "VES sumada con éxito en Supabase!");
          }
        } else {
          console.error("❌ No se pudo encontrar el perfil en Supabase para actualizar el premio.");
        }
      }
    }
  }

  if (survived) {
    if (endTitle) { endTitle.innerText = "¡VICTORIA REAL!"; endTitle.style.color = "#4ade80"; }
    if (endDesc) endDesc.innerText = reason;
    if (endVes) endVes.innerText = `${finalAmount.toLocaleString('es-VE')} VES`;
  } else {
    if (endTitle) { endTitle.innerText = "ELIMINADO"; endTitle.style.color = "#ef4444"; }
    if (endDesc) endDesc.innerText = reason;
    if (endVes) endVes.innerText = "0 VES";
  }
}