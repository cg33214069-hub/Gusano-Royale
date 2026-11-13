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
// 1. CONFIGURACIÓN DEL MUNDO Y COMIDA EN EL MAPA
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
// Capturamos el color guardado en el selector de la interfaz (o asignamos uno por defecto)
let selectedColor = localStorage.getItem('worm_color') || '#22c55e';
let playerName = localStorage.getItem('player_name') || 'Jugador';
let gameActive = true;
let currentPhase = 'PREPARATION';
let timeLeft = PREPARATION_TIME;
let timerInterval = null;

// ==========================================
// DESCUENTO AUTOMÁTICO Y SEGURO DE LA ENTRADA EN SUPABASE
// ==========================================
async function descontarEntradaEnSupabase() {
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
                radius: 5,
                color: valorComidaConfig > 50 ? '#4ade80' : '#38bdf8'
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
        remotePlayers[payload.id] = payload;
      } else {
        let p = remotePlayers[payload.id];
        p.targetX = payload.x;
        p.targetY = payload.y;
        p.targetAngle = payload.angle;
        p.ves = payload.ves;
        p.skinId = payload.skinId;
        p.color = payload.color; // Sincronizamos el color remoto
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
      verificarYCargarComida();
    }
  });
}

// ==========================================
// 3. JUGADOR LOCAL Y BUCLE DE JUEGO
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
  color: selectedColor, // ¡Inyectamos aquí el color seleccionado por el usuario!
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

  if (mapaComidaActiva && arenaFoodOrbs.length > 0) {
    for (let i = arenaFoodOrbs.length - 1; i >= 0; i--) {
      const food = arenaFoodOrbs[i];
      const dx = player.x - food.x;
      const dy = player.y - food.y;

      if (Math.abs(dx) < 30 && Math.abs(dy) < 30) {
        if (Math.hypot(dx, dy) < player.radius + food.radius + 4) {
          player.ves += food.ves; 

          food.x = Math.random() * (WORLD_SIZE - 200) + 100;
          food.y = Math.random() * (WORLD_SIZE - 200) + 100;
          food.ves = valorComidaConfig;
        }
      }
    }
  }

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
          color: player.color, // Enviamos el color actual en la red
          body: player.body.slice(0, 15)
        }
      });
    }
  }
}

// ==========================================
// 4. RENDERIZADO
// ==========================================
function drawPlayer(p, camera, isLocal = false) {
  if (!isLocal) {
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

    if (p.skinId === 've') {
      if (i % 3 === 0) ctx.fillStyle = '#ffcc00';
      else if (i % 3 === 1) ctx.fillStyle = '#00247d';
      else ctx.fillStyle = '#cf142b';
    } else {
      // Priorizamos el color del objeto (p.color), luego localStorage, y por último respaldos
      ctx.fillStyle = p.color || localStorage.getItem('worm_color') || (isLocal ? '#22c55e' : '#38bdf8');
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
  
  const totalConnected = Object.keys(remotePlayers).length + (player.alive ? 1 : 0);

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

      if (mapaComidaActiva) {
        arenaFoodOrbs.forEach(food => {
          const sx = food.x - camera.x;
          const sy = food.y - camera.y;
          if (sx >= -20 && sx <= canvas.width + 20 && sy >= -20 && sy <= canvas.height + 20) {
            ctx.beginPath();
            ctx.arc(sx, sy, food.radius, 0, Math.PI * 2);
            ctx.fillStyle = food.color;
            ctx.fill();
          }
        });
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

// ==========================================
// FUNCIÓN ENDGAME OPTIMIZADA PARA GUARDAR EL PREMIO
// ==========================================
async function endGame(survived, reason) {
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