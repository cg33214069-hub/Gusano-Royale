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
    const defaultVal = 0;
    localStorage.setItem('secure_user_balance', btoa(defaultVal.toString()));
    return defaultVal;
  }
  try {
    const decoded = parseInt(atob(encoded), 10);
    return isNaN(decoded) ? 0 : decoded;
  } catch (e) {
    return 0;
  }
}

function saveSecureBalance(amount) {
  if (isSpectator) return;
  const cleanAmount = Math.max(0, Math.floor(Number(amount) || 0));
  localStorage.setItem('secure_user_balance', btoa(cleanAmount.toString()));
  localStorage.setItem('user_balance', cleanAmount.toString());
}

// ==========================================
// CONTROL ANTI-DUPLICADOS POR PARTIDA (DINERO REAL)
// ==========================================
const currentMatchId = 'match_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
let entradaDescontadaConfirmada = false;
let premioAcreditadoConfirmado = false;

function yaSeCobroPartida(matchId) {
  return sessionStorage.getItem(`claimed_${matchId}`) === 'true';
}

function marcarPartidaCobrada(matchId) {
  sessionStorage.setItem(`claimed_${matchId}`, 'true');
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
    const segCount = Math.max(5, Math.round(player.visualLength || player.length || 14));
    for (let i = 0; i < segCount; i++) {
      player.body.push({ x: player.x, y: player.y });
    }
  }
}

async function cargarTamanoMapaGlobal() {
  if (typeof supabaseClient === 'undefined' || !supabaseClient) return;

  const { data } = await supabaseClient
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
  : (parseInt(localStorage.getItem('selected_entry'), 10) || 100);

let selectedSkin = localStorage.getItem('selected_skin') || 've';
let selectedColor = localStorage.getItem('worm_color') || '#22c55e';
let playerName = localStorage.getItem('player_name') || 'Jugador';
let gameActive = false;
// Fases: 'PREPARATION' (10s) -> 'COMBAT' (60s) -> 'EXTRACTION_FREE' (raya verde, cronómetro hacia arriba)
let currentPhase = 'PREPARATION';
let timeLeft = PREPARATION_TIME;
let elapsedAfterCombat = 0;
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
// DESCUENTO ATÓMICO DE LA ENTRADA EN SUPABASE (RPC)
// ==========================================
let yaDescontoEntrada = false;

async function descontarEntradaEnSupabase() {
  if (isSpectator || yaDescontoEntrada || entradaDescontadaConfirmada) return entradaDescontadaConfirmada;
  if (typeof supabaseClient === 'undefined' || !supabaseClient) return false;

  const userId = localStorage.getItem('user_id');
  if (!userId) {
    console.warn('⚠️ Falta user_id para descontar entrada de forma segura.');
    return false;
  }

  yaDescontoEntrada = true;
  const montoEntrada = Math.abs(Math.floor(Number(selectedEntryFee) || 0));

  const { data, error } = await supabaseClient.rpc('ajustar_saldo_seguro', {
    p_user_id: userId,
    p_delta: -montoEntrada
  });

  const row = Array.isArray(data) ? data[0] : data;

  if (error || !row || !row.ok) {
    console.warn('⚠️ No se pudo descontar la entrada:', error?.message || row?.mensaje || 'Saldo insuficiente');
    yaDescontoEntrada = false;
    return false;
  }

  const nuevoSaldo = Math.max(0, Math.floor(Number(row.nuevo_saldo) || 0));
  entradaDescontadaConfirmada = true;
  saveSecureBalance(nuevoSaldo);
  console.log(`✅ Entrada de ${montoEntrada} VES descontada con RPC. Nuevo saldo: ${nuevoSaldo}`);
  return true;
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
      const t = e.touches[i];
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
// 2. CONEXIÓN DIRECTA AL SERVIDOR EN LA PC (SOCKET.IO)
// ==========================================
const PC_SERVER_URL = 'https://albums-identified-wool-virtual.trycloudflare.com';
const roomChannelName = `arena_ves_${selectedEntryFee}`;
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

function buildSampledBody(bodySegments, maxSamples = 30) {
  if (!Array.isArray(bodySegments) || bodySegments.length === 0) return [];
  if (bodySegments.length <= maxSamples) {
    return bodySegments.map(seg => ({
      x: Number(seg.x.toFixed(1)),
      y: Number(seg.y.toFixed(1))
    }));
  }

  const sampled = [];
  const step = (bodySegments.length - 1) / (maxSamples - 1);
  for (let i = 0; i < maxSamples; i++) {
    const idx = Math.min(bodySegments.length - 1, Math.round(i * step));
    const seg = bodySegments[idx];
    sampled.push({
      x: Number(seg.x.toFixed(1)),
      y: Number(seg.y.toFixed(1))
    });
  }
  return sampled;
}

function emitirEventoSala(eventName, payload) {
  if (!socket || !socket.connected) return;
  socket.emit(eventName, {
    room: roomChannelName,
    ...payload
  });
}

let socket = null;
if (typeof io !== 'undefined') {
  socket = io(PC_SERVER_URL, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000
  });
  window.gameSocket = socket;

  socket.on('connect', () => {
    console.log('✅ Conectado al servidor en tu PC:', PC_SERVER_URL);
    socket.emit('join_room', {
      room: roomChannelName,
      playerId: myPlayerId,
      name: playerName,
      entryFee: selectedEntryFee,
      isSpectator
    });
  });

  socket.on('player_move', (payload) => {
    if (payload && payload.id !== myPlayerId) {
      if (!remotePlayers[payload.id]) {
        remotePlayers[payload.id] = {
          ...payload,
          targetX: payload.x,
          targetY: payload.y,
          targetAngle: payload.angle,
          renderAngle: payload.angle,
          currentSpeed: payload.speed || 1.9,
          targetBody: payload.body
        };
      } else {
        const p = remotePlayers[payload.id];
        p.targetX = payload.x;
        p.targetY = payload.y;
        p.targetAngle = payload.angle;
        p.currentSpeed = payload.speed || 1.9;
        p.ves = payload.ves;
        p.skinId = payload.skinId;
        p.color = payload.color;
        p.targetBody = payload.body;
      }
      remotePlayers[payload.id].lastUpdate = Date.now();
    }
  });

  socket.on('player_died', (payload) => {
    if (payload && remotePlayers[payload.id]) {
      delete remotePlayers[payload.id];
    }
  });

  socket.on('spawn_loot_batch', (payload) => {
    if (payload && Array.isArray(payload.orbs)) {
      appendLootOrbsWithLimit(payload.orbs);
    }
  });

  socket.on('spawn_loot', (payload) => {
    if (payload) {
      appendLootOrbsWithLimit([payload]);
    }
  });

  socket.on('collect_loot', (payload) => {
    if (payload && payload.lootId) {
      const idx = sharedLootOrbs.findIndex(o => o.id === payload.lootId);
      if (idx !== -1) sharedLootOrbs.splice(idx, 1);
    } else if (payload && typeof payload.index === 'number' && sharedLootOrbs[payload.index]) {
      sharedLootOrbs.splice(payload.index, 1);
    }
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
        cantidadComidaConfig = parseInt(item.valor, 10) || 150;
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
  speed: 1.9,
  radius: 8,
  body: [],
  length: 14,
  visualLength: 14,
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

  emitirEventoSala('spawn_loot_batch', { orbs: batchOrbs });
}

let lastSendTime = 0;

function updateLocalPlayer(dtFactor = 1) {
  if (isSpectator || !player.alive) return;

  const entrySafe = Math.max(1, selectedEntryFee || 100);
  const targetRadius = 7 + Math.min(12, Math.sqrt(Math.max(0, player.ves)) * 0.16);
  player.radius += (targetRadius - player.radius) * Math.min(1, 0.16 * dtFactor);

  const targetLength = Math.max(10, Math.floor(10 + player.ves / (entrySafe / 14)));
  player.visualLength += (targetLength - player.visualLength) * Math.min(1, 0.14 * dtFactor);
  player.length = Math.round(player.visualLength);

  let currentSpeed = player.speed;

  if (isBoosting && player.ves > (entrySafe * 0.1)) {
    currentSpeed = 3.1;
    player.ves = Math.max(0, player.ves - (entrySafe * 0.0005) * dtFactor);
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
  const turnSmooth = Math.min(1, 0.18 * dtFactor);
  player.angle += diff * turnSmooth;

  player.x += Math.cos(player.angle) * currentSpeed * dtFactor;
  player.y += Math.sin(player.angle) * currentSpeed * dtFactor;

  const mapSizeSafe = typeof WORLD_SIZE === 'number' && WORLD_SIZE > 0 ? WORLD_SIZE : 2500;
  if (currentPhase === 'PREPARATION') {
    const margin = player.radius + 10;
    player.x = Math.max(margin, Math.min(mapSizeSafe - margin, player.x));
    player.y = Math.max(margin, Math.min(mapSizeSafe - margin, player.y));
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

        if (collectedId) {
          emitirEventoSala('collect_loot', { lootId: collectedId });
        }
      }
    }
  }

  if (gameActive) {
    const now = Date.now();
    if (now - lastSendTime > 65) {
      lastSendTime = now;
      emitirEventoSala('player_move', {
        id: player.id,
        name: player.name,
        x: Number(player.x.toFixed(1)),
        y: Number(player.y.toFixed(1)),
        angle: Number(player.angle.toFixed(3)),
        speed: Number(currentSpeed.toFixed(2)),
        length: player.length,
        ves: Math.floor(player.ves),
        skinId: player.skinId,
        color: player.color
      });
    }
  }
}

function drawPlayer(p, camera, isLocal, dtFactor = 1) {
  const wormRadius = Math.max(4, 6.5 * Math.min(1.25, 1 + Math.sqrt(p.ves || 0) * 0.025));

  if (!isLocal) {
    const spd = p.currentSpeed || 1.9;
    const desiredLen = Math.max(10, Math.min(60, Math.round(p.length || (p.targetBody && p.targetBody.length) || 14)));

    if (p.x === undefined || p.y === undefined) {
      p.x = p.targetX ?? 0;
      p.y = p.targetY ?? 0;
      p.renderAngle = p.targetAngle ?? 0;
    }

    if (p.renderAngle === undefined) {
      p.renderAngle = p.targetAngle ?? 0;
    }

    if (p.targetAngle !== undefined) {
      let aDiff = p.targetAngle - p.renderAngle;
      while (aDiff < -Math.PI) aDiff += Math.PI * 2;
      while (aDiff > Math.PI) aDiff -= Math.PI * 2;
      p.renderAngle += aDiff * Math.min(1, 0.24 * dtFactor);
    }

    // Avance predicho en la dirección actual
    p.x += Math.cos(p.renderAngle) * spd * dtFactor;
    p.y += Math.sin(p.renderAngle) * spd * dtFactor;

    // Corrección suave hacia la última posición recibida del servidor
    if (p.targetX !== undefined && p.targetY !== undefined) {
      const dx = p.targetX - p.x;
      const dy = p.targetY - p.y;
      const dist = Math.hypot(dx, dy);

      let correctionFactor = 0.12 * dtFactor;
      if (dist > 250) {
        correctionFactor = 0.45 * dtFactor;
      } else if (dist > 70) {
        correctionFactor = 0.22 * dtFactor;
      }

      p.x += dx * Math.min(1, correctionFactor);
      p.y += dy * Math.min(1, correctionFactor);
    }

    // Reconstrucción fluida del cuerpo siguiendo la cabeza con separación constante
    if (!p.body || p.body.length === 0) {
      p.body = [];
      for (let i = 0; i < desiredLen; i++) {
        p.body.push({ x: p.x, y: p.y });
      }
    } else {
      p.body[0].x = p.x;
      p.body[0].y = p.y;

      while (p.body.length < desiredLen) {
        const tail = p.body[p.body.length - 1];
        p.body.push({ x: tail.x, y: tail.y });
      }
      while (p.body.length > desiredLen && p.body.length > 2) {
        p.body.pop();
      }

      const segmentSpacing = Math.max(2.2, wormRadius * 0.42);
      for (let i = 1; i < p.body.length; i++) {
        const prev = p.body[i - 1];
        const curr = p.body[i];
        const dx = prev.x - curr.x;
        const dy = prev.y - curr.y;
        const dist = Math.hypot(dx, dy);

        if (dist > 0.001) {
          const targetX = prev.x - (dx / dist) * segmentSpacing;
          const targetY = prev.y - (dy / dist) * segmentSpacing;
          const followLerp = Math.min(1, 0.55 * dtFactor);
          curr.x += (targetX - curr.x) * followLerp;
          curr.y += (targetY - curr.y) * followLerp;
        }
      }
    }
  }

  if (!p.body || p.body.length < 2) return;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
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
  const allPlayers = [];
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
    if (now - remotePlayers[id].lastUpdate > 12000) {
      delete remotePlayers[id];
    }
  });
}

function checkRealPlayerCollisions() {
  cleanupInactiveRemotePlayers();
  if (isSpectator || !player.alive) return;
  if (currentPhase !== 'COMBAT' && currentPhase !== 'EXTRACTION_FREE') return;

  const hitThreshold = player.radius + 7;

  Object.values(remotePlayers).forEach(friend => {
    if (!friend.body || friend.body.length === 0) return;

    for (let i = 0; i < friend.body.length; i += 2) {
      const seg = friend.body[i];
      if (Math.abs(player.x - seg.x) < 40 && Math.abs(player.y - seg.y) < 40) {
        if (Math.hypot(player.x - seg.x, player.y - seg.y) < hitThreshold) {
          player.alive = false;
          dropLootOnDeath(player.x, player.y, player.ves, player.body);

          emitirEventoSala('player_died', { id: player.id });
          endGame(false, `Chocaste contra el cuerpo de ${friend.name}. ¡Has quedado eliminado!`);
          return;
        }
      }
    }
  });
}

function checkWallCollisions() {
  if (isSpectator || !player.alive) return;
  if (currentPhase !== 'COMBAT' && currentPhase !== 'EXTRACTION_FREE') return;

  const mapSizeSafe = typeof WORLD_SIZE === 'number' && WORLD_SIZE > 0 ? WORLD_SIZE : 2500;
  const hitLeft = player.x - player.radius <= 0;
  const hitRight = player.x + player.radius >= mapSizeSafe;
  const hitTop = player.y - player.radius <= 0;
  const hitBottom = player.y + player.radius >= mapSizeSafe;

  if (hitLeft || hitRight || hitTop || hitBottom) {
    if (currentPhase === 'EXTRACTION_FREE') {
      player.alive = false;
      emitirEventoSala('player_died', { id: player.id });
      endGame(true, '¡Saliste por la raya verde! Te llevas todo tu botín recolectado.');
      return;
    }

    player.alive = false;
    dropLootOnDeath(player.x, player.y, player.ves, player.body);

    emitirEventoSala('player_died', { id: player.id });
    endGame(false, '¡Chocaste contra la línea roja del límite del mapa! Has quedado eliminado.');
  }
}

function updateHUD(observedPlayer) {
  const vesDisplay = document.getElementById('ves-display');
  const aliveDisplay = document.getElementById('alive-display');
  const timerDisplay = document.getElementById('timer-display');
  const timerLabel = document.getElementById('timer-label');
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

  if (timerLabel) {
    timerLabel.innerText = currentPhase === 'EXTRACTION_FREE' ? 'Salida Verde' : 'Tiempo';
  }

  const secondsToShow = currentPhase === 'EXTRACTION_FREE'
    ? elapsedAfterCombat
    : Math.max(0, timeLeft);
  const m = Math.floor(secondsToShow / 60).toString().padStart(2, '0');
  const s = (secondsToShow % 60).toString().padStart(2, '0');
  if (timerDisplay) timerDisplay.innerText = `${m}:${s}`;
}

function startTimer() {
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    if (!gameActive) return;

    if (currentPhase === 'EXTRACTION_FREE') {
      elapsedAfterCombat++;
      return;
    }

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
      } else if (currentPhase === 'COMBAT') {
        if (isSpectator) {
          currentPhase = 'PREPARATION';
          timeLeft = PREPARATION_TIME;
        } else {
          currentPhase = 'EXTRACTION_FREE';
          timeLeft = 0;
          elapsedAfterCombat = 0;
        }
      }
    }
  }, 1000);
}

let lastTime = 0;

function renderArenaFrame(dtFactor = 1) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!player.alive && !isSpectator) return;

  if (gameActive) {
    if (!isSpectator) {
      updateLocalPlayer(dtFactor);
    }
    checkRealPlayerCollisions();
    checkWallCollisions();
  }

  const mapSizeSafe = typeof WORLD_SIZE === 'number' && WORLD_SIZE > 0 ? WORLD_SIZE : 2500;
  const camera = { x: 0, y: 0 };
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
        freeCamPos.x = Math.max(0, Math.min(mapSizeSafe, freeCamPos.x + Math.cos(angle) * 5 * dtFactor));
        freeCamPos.y = Math.max(0, Math.min(mapSizeSafe, freeCamPos.y + Math.sin(angle) * 5 * dtFactor));
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

  // Línea delimitadora del mapa (azul en preparación, roja en combate, verde al habilitar salida)
  const mapScreenX = 0 - camera.x;
  const mapScreenY = 0 - camera.y;

  ctx.strokeStyle = currentPhase === 'EXTRACTION_FREE'
    ? '#22c55e'
    : (currentPhase === 'COMBAT' ? '#ef4444' : '#38bdf8');
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

  Object.values(remotePlayers).forEach(friend => drawPlayer(friend, camera, false, dtFactor));

  if (!isSpectator) {
    drawPlayer(player, camera, true, dtFactor);
  }

  drawLeaderboard();
  updateHUD(observedPlayer);
}

function gameLoop(timestamp) {
  requestAnimationFrame(gameLoop);

  if (!lastTime) lastTime = timestamp;
  const rawElapsed = timestamp - lastTime;
  lastTime = timestamp;

  const dtFactor = Math.min(1.8, Math.max(0.3, rawElapsed / (1000 / 60)));

  if (gameActive) {
    renderArenaFrame(dtFactor);
  }
}

// ==========================================
// PANTALLA DE CARGA REUTILIZABLE (ENTRADA Y SALIDA AL MENÚ)
// ==========================================
function mostrarPantallaCargaSala(titulo = 'Preparando Arena', subtitulo = 'Verificando saldo y conectando con la sala...') {
  const existing = document.getElementById('arena-loading-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'arena-loading-overlay';
  overlay.style.cssText = `
    position: fixed;
    inset: 0;
    background: radial-gradient(circle at center, #0f172a 0%, #020617 100%);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    z-index: 99999;
    font-family: sans-serif;
    color: #f8fafc;
    padding: 20px;
    text-align: center;
  `;

  overlay.innerHTML = `
    <h2 id="loading-title-text" style="margin: 0 0 8px; color: #38bdf8; font-size: 22px; letter-spacing: 0.5px;">
      ${titulo}
    </h2>
    <p id="loading-status-text" style="margin: 0 0 18px; color: #94a3b8; font-size: 14px;">
      ${subtitulo}
    </p>
    <div style="width: 100%; max-width: 340px; height: 14px; background: #1e293b; border-radius: 999px; overflow: hidden; border: 1px solid #334155;">
      <div id="loading-progress-bar" style="width: 0%; height: 100%; background: linear-gradient(90deg, #22c55e, #38bdf8); transition: width 0.2s ease;"></div>
    </div>
    <span id="loading-percent-text" style="margin-top: 10px; font-size: 13px; font-weight: bold; color: #4ade80;">0%</span>
  `;

  document.body.appendChild(overlay);
  return overlay;
}

function actualizarProgresoCarga(porcentaje, mensaje) {
  const bar = document.getElementById('loading-progress-bar');
  const statusText = document.getElementById('loading-status-text');
  const percentText = document.getElementById('loading-percent-text');
  if (bar) bar.style.width = `${porcentaje}%`;
  if (percentText) percentText.innerText = `${porcentaje}%`;
  if (statusText && mensaje) statusText.innerText = mensaje;
}

let promesaGuardadoFinal = Promise.resolve();

async function salirAlMenuConCarga(urlDestino = 'dashboard.html') {
  mostrarPantallaCargaSala(
    'Guardando Progreso',
    'Sincronizando tu saldo con el dashboard...'
  );

  actualizarProgresoCarga(25, 'Confirmando actualización de saldo...');
  try {
    await promesaGuardadoFinal;
  } catch (e) {
    console.warn('Aviso al esperar guardado:', e);
  }

  actualizarProgresoCarga(65, 'Cerrando conexión con la sala...');
  if (socket) {
    try {
      socket.disconnect();
    } catch (e) {}
  }

  actualizarProgresoCarga(100, '¡Listo! Volviendo al dashboard...');
  await new Promise(resolve => setTimeout(resolve, 150));
  window.location.href = urlDestino;
}
window.salirAlMenuConCarga = salirAlMenuConCarga;

function activarBarraSalidaEnModalFin() {
  const endModal = document.getElementById('end-modal');
  if (!endModal) return;

  const botonesSalida = endModal.querySelectorAll('a, button');
  botonesSalida.forEach(btn => {
    if (btn.dataset.cargaSalidaActiva) return;
    btn.dataset.cargaSalidaActiva = 'true';

    btn.addEventListener('click', (e) => {
      const href = btn.getAttribute('href');
      const destino = (href && href !== '#' && href !== 'index.html' && !href.startsWith('javascript:'))
        ? href
        : 'dashboard.html';
      e.preventDefault();
      e.stopImmediatePropagation();
      salirAlMenuConCarga(destino);
    }, true);
  });
}

async function iniciarSalaConCarga() {
  gameActive = false;

  const overlay = mostrarPantallaCargaSala(
    `Preparando Arena (${selectedEntryFee} VES)`,
    'Verificando saldo y conectando con la sala...'
  );

  actualizarProgresoCarga(20, 'Descontando entrada y verificando saldo...');
  const cobroOk = await descontarEntradaEnSupabase();
  if (!isSpectator && !cobroOk) {
    actualizarProgresoCarga(100, 'No se pudo confirmar la entrada. Volviendo al menú...');
    await new Promise(resolve => setTimeout(resolve, 900));
    window.location.href = 'dashboard.html';
    return;
  }

  actualizarProgresoCarga(55, 'Cargando mapa y configuración global...');
  await cargarTamanoMapaGlobal();

  actualizarProgresoCarga(85, 'Sincronizando comida y sala...');
  await verificarYCargarComida();

  actualizarProgresoCarga(100, '¡A jugar!');
  await new Promise(resolve => setTimeout(resolve, 180));
  overlay.remove();

  gameActive = true;
  lastTime = performance.now();
  const skinBtnInit = document.getElementById('skin-btn');
  if (skinBtnInit && !isSpectator) skinBtnInit.style.display = 'block';

  activarBarraSalidaEnModalFin();
  startTimer();
  requestAnimationFrame(gameLoop);
}

iniciarSalaConCarga();

// ==========================================
// FUNCIÓN ENDGAME ATÓMICA PARA GUARDAR EL PREMIO (RPC)
// ==========================================
let partidaFinalizada = false;

function endGame(survived, reason) {
  if (isSpectator || partidaFinalizada) return;
  partidaFinalizada = true;

  renderArenaFrame(1);
  gameActive = false;
  clearInterval(timerInterval);

  const endModal = document.getElementById('end-modal');
  const endTitle = document.getElementById('end-title');
  const endDesc = document.getElementById('end-desc');
  const endVes = document.getElementById('end-ves-amount');

  const finalAmount = (survived && entradaDescontadaConfirmada && !yaSeCobroPartida(currentMatchId))
    ? Math.max(0, Math.floor(Number(player.ves) || 0))
    : 0;

  if (survived) {
    if (endTitle) {
      endTitle.innerText = '¡VICTORIA REAL!';
      endTitle.style.color = '#4ade80';
    }
    if (endDesc) endDesc.innerText = reason;
    if (endVes) endVes.innerText = `${finalAmount.toLocaleString('es-VE')} VES`;
  } else {
    if (endTitle) {
      endTitle.innerText = 'ELIMINADO';
      endTitle.style.color = '#ef4444';
    }
    if (endDesc) endDesc.innerText = reason;
    if (endVes) endVes.innerText = '0 VES';
  }

  if (endModal) endModal.style.display = 'flex';
  activarBarraSalidaEnModalFin();

  if (survived && finalAmount > 0 && !premioAcreditadoConfirmado) {
    marcarPartidaCobrada(currentMatchId);

    promesaGuardadoFinal = (async () => {
      if (typeof supabaseClient === 'undefined' || !supabaseClient) {
        console.warn('⚠️ Sin cliente Supabase para acreditar premio de forma segura.');
        return;
      }

      const userId = localStorage.getItem('user_id');
      if (!userId) {
        console.warn('⚠️ Falta user_id para acreditar premio de forma segura.');
        return;
      }

      const { data, error } = await supabaseClient.rpc('ajustar_saldo_seguro', {
        p_user_id: userId,
        p_delta: finalAmount
      });

      const row = Array.isArray(data) ? data[0] : data;

      if (error || !row || !row.ok) {
        console.error('❌ Error al acreditar ganancia con RPC:', error?.message || row?.mensaje);
        return;
      }

      premioAcreditadoConfirmado = true;
      const nuevoSaldo = Math.max(0, Math.floor(Number(row.nuevo_saldo) || 0));
      saveSecureBalance(nuevoSaldo);
      console.log('✅ ¡Ganancia de', finalAmount, 'VES sumada con RPC! Nuevo saldo:', nuevoSaldo);
    })();
  }
}
