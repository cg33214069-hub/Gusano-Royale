require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el archivo .env');
  process.exit(1);
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingInterval: 10000,
  pingTimeout: 20000
});

// ==========================================
// MANEJO DE ERRORES GLOBALES (ESTABILIDAD RED HAT)
// ==========================================
process.on('uncaughtException', (err) => {
  console.error('🔥 Error no capturado (uncaughtException):', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('🔥 Promesa rechazada no manejada (unhandledRejection):', reason);
});

// ==========================================
// CONFIGURACIÓN DE SALAS Y MAPAS
// ==========================================
const MAX_PLAYERS_PER_ROOM = 100;
const MAX_LOOT_ORBS_PER_ROOM = 140;

const MAP_PRESETS = {
  pequeno: { width: 1400, height: 1000, foodCount: 90 },
  mediano: { width: 1700, height: 1200, foodCount: 130 },
  grande:  { width: 2500, height: 2000, foodCount: 200 }
};

let adminConfig = {
  mapSize: 'mediano',
  foodEnabled: true,
  foodValue: 5
};

const INITIAL_ROOMS = [
  { id: 'sala_1', name: 'Sala 1', entryFee: 50 },
  { id: 'sala_2', name: 'Sala 2', entryFee: 100 },
  { id: 'sala_3', name: 'Sala 3', entryFee: 500 },
  { id: 'sala_4', name: 'Sala 4', entryFee: 1000 }
];

const rooms = {};

// Registro anti-duplicados en memoria con limpieza automática (TTL 2 horas)
const processedTransactions = new Map();
const TX_TTL_MS = 2 * 60 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [key, timestamp] of processedTransactions.entries()) {
    if (now - timestamp > TX_TTL_MS) {
      processedTransactions.delete(key);
    }
  }
}, 10 * 60 * 1000);

function getMapDims(sizeKey) {
  return MAP_PRESETS[sizeKey] || MAP_PRESETS.mediano;
}

function clampInside(val, radius, maxLimit) {
  const min = radius + 10;
  const max = Math.max(min, maxLimit - radius - 10);
  return Math.max(min, Math.min(max, val));
}

function spawnFood(width, height, value) {
  return {
    id: `f_${Math.random().toString(36).slice(2, 9)}`,
    x: Math.round(40 + Math.random() * Math.max(100, width - 80)),
    y: Math.round(40 + Math.random() * Math.max(100, height - 80)),
    value: Number(value) || 5
  };
}

function getRoom(roomId, entryFee = 50, name = null) {
  const dims = getMapDims(adminConfig.mapSize);
  if (!rooms[roomId]) {
    const foods = [];
    if (adminConfig.foodEnabled) {
      for (let i = 0; i < dims.foodCount; i++) {
        foods.push(spawnFood(dims.width, dims.height, adminConfig.foodValue));
      }
    }
    rooms[roomId] = {
      id: roomId,
      name: name || roomId,
      entryFee: Number(entryFee) || 50,
      width: dims.width,
      height: dims.height,
      players: {},
      foods,
      loots: []
    };
  }
  return rooms[roomId];
}

INITIAL_ROOMS.forEach((r) => getRoom(r.id, r.entryFee, r.name));

// ==========================================
// ENDPOINTS DE SALUD Y ESTADO
// ==========================================
app.get('/', (req, res) => {
  res.send('Servidor Gusanos Royale activo');
});

app.get('/health', (req, res) => {
  const activeRooms = Object.values(rooms).map((r) => ({
    id: r.id,
    entryFee: r.entryFee,
    players: Object.keys(r.players).length
  }));
  res.json({
    status: 'ok',
    uptimeSeconds: Math.floor(process.uptime()),
    memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
    rooms: activeRooms
  });
});

// ==========================================
// SINCRONIZACIÓN DE CONFIGURACIÓN DESDE SUPABASE
// ==========================================
async function syncAdminConfig() {
  try {
    const { data, error } = await supabase
      .from('game_settings')
      .select('map_size, food_enabled, food_value')
      .limit(1)
      .maybeSingle();

    if (!error && data) {
      if (MAP_PRESETS[data.map_size]) adminConfig.mapSize = data.map_size;
      if (typeof data.food_enabled === 'boolean') adminConfig.foodEnabled = data.food_enabled;
      if (typeof data.food_value === 'number' && data.food_value > 0) adminConfig.foodValue = data.food_value;
    }

    const dims = getMapDims(adminConfig.mapSize);
    Object.values(rooms).forEach((room) => {
      room.width = dims.width;
      room.height = dims.height;

      if (!adminConfig.foodEnabled) {
        room.foods = [];
      } else {
        while (room.foods.length < dims.foodCount) {
          room.foods.push(spawnFood(room.width, room.height, adminConfig.foodValue));
        }
      }
    });
  } catch (err) {
    console.error('⚠️ Aviso en syncAdminConfig:', err.message);
  }
}

const configInterval = setInterval(syncAdminConfig, 8000);
syncAdminConfig();

// Muestrea hasta 55 puntos uniformes para mostrar el largo real sin saturar red
function compactBody(body, maxSamples = 55) {
  if (!Array.isArray(body) || body.length === 0) return [];
  if (body.length <= maxSamples) {
    return body.map((seg) => [Math.round(seg.x), Math.round(seg.y)]);
  }
  const sampled = [];
  const step = (body.length - 1) / (maxSamples - 1);
  for (let i = 0; i < maxSamples; i++) {
    const idx = Math.min(body.length - 1, Math.round(i * step));
    sampled.push([Math.round(body[idx].x), Math.round(body[idx].y)]);
  }
  return sampled;
}

// ==========================================
// FUNCIÓN FINANCIERA ATÓMICA CON RPC DE SUPABASE
// ==========================================
async function adjustBalance({ userId, amount, txType, matchId }) {
  const cleanAmount = Math.abs(Math.floor(Number(amount) || 0));
  if (!userId || cleanAmount <= 0) {
    return { ok: false, new_balance: 0, message: 'Datos de transacción inválidos' };
  }

  const txKey = `${txType}:${userId}:${matchId}`;
  if (processedTransactions.has(txKey)) {
    return { ok: true, new_balance: null, message: 'Movimiento ya procesado' };
  }

  const delta = txType === 'entry' ? -cleanAmount : cleanAmount;

  const { data, error } = await supabase.rpc('ajustar_saldo_seguro', {
    p_user_id: userId,
    p_delta: delta
  });

  if (error) {
    console.error(`❌ Error RPC ajustar_saldo_seguro (${txType}):`, error.message);
    return { ok: false, new_balance: 0, message: error.message };
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row || !row.ok) {
    return {
      ok: false,
      new_balance: Number(row?.nuevo_saldo || 0),
      message: row?.mensaje || 'No se pudo actualizar el saldo'
    };
  }

  processedTransactions.set(txKey, Date.now());
  return {
    ok: true,
    new_balance: Math.max(0, Math.floor(Number(row.nuevo_saldo) || 0)),
    message: row.mensaje || 'Saldo actualizado'
  };
}

// ==========================================
// SOLTAR BOTÍN AL MORIR UN JUGADOR
// ==========================================
function spawnDeathLoot(room, player) {
  if (!room || !player || player.ves <= 0) return;

  const validBody = Array.isArray(player.body) && player.body.length > 0
    ? player.body
    : [{ x: player.x, y: player.y }];

  const drops = Math.min(40, Math.max(20, validBody.length));
  const valuePerDrop = Math.max(1, Math.floor(player.ves / drops));

  for (let i = 0; i < drops; i++) {
    const progress = drops > 1 ? i / (drops - 1) : 0;
    const idx = Math.min(validBody.length - 1, Math.floor(progress * (validBody.length - 1)));
    const seg = validBody[idx];
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.random() * 10;

    room.loots.push({
      id: `l_${Math.random().toString(36).slice(2, 9)}`,
      x: Math.round(clampInside(seg.x + Math.cos(angle) * dist, 6, room.width)),
      y: Math.round(clampInside(seg.y + Math.sin(angle) * dist, 6, room.height)),
      value: valuePerDrop
    });
  }

  if (room.loots.length > MAX_LOOT_ORBS_PER_ROOM) {
    room.loots.splice(0, room.loots.length - MAX_LOOT_ORBS_PER_ROOM);
  }
}

// ==========================================
// EVENTOS DE SOCKET.IO
// ==========================================
io.on('connection', (socket) => {
  console.log(`🔌 Conectado: ${socket.id}`);

  socket.on('admin_update_config', (cfg = {}) => {
    if (cfg.mapSize && MAP_PRESETS[cfg.mapSize]) adminConfig.mapSize = cfg.mapSize;
    if (typeof cfg.foodEnabled === 'boolean') adminConfig.foodEnabled = cfg.foodEnabled;
    if (typeof cfg.foodValue === 'number' && cfg.foodValue > 0) adminConfig.foodValue = cfg.foodValue;
    syncAdminConfig();
    io.emit('config_updated', adminConfig);
  });

  socket.on('auth_user', async (data = {}) => {
    try {
      if (!data.accessToken) return;
      const { data: authData, error } = await supabase.auth.getUser(data.accessToken);
      if (error || !authData?.user) {
        socket.emit('auth_error', { reason: 'Token inválido' });
        return;
      }
      socket.data.userId = authData.user.id;
      socket.emit('auth_ok', { userId: authData.user.id });
    } catch (err) {
      console.error('Error auth_user:', err);
    }
  });

  socket.on('join_arena', async (data = {}) => {
    try {
      const roomId = data.roomId || 'sala_1';
      const room = getRoom(roomId, data.entryFee || 50);
      const isSpectator = Boolean(data.spectator);

      const activeCount = Object.values(room.players).filter((p) => !p.spectator && p.alive).length;
      if (!isSpectator && activeCount >= MAX_PLAYERS_PER_ROOM) {
        socket.emit('join_error', { reason: `La sala está llena (máx. ${MAX_PLAYERS_PER_ROOM} jugadores)` });
        return;
      }

      const entryFee = room.entryFee;
      const matchId = String(data.matchId || `${room.id}_${Date.now()}_${socket.id}`);
      const effectiveUserId = socket.data.userId || data.userId || null;

      let confirmedBalance = null;
      if (!isSpectator && entryFee > 0) {
        if (!effectiveUserId) {
          socket.emit('join_error', { reason: 'Debes iniciar sesión antes de entrar' });
          return;
        }

        const charge = await adjustBalance({
          userId: effectiveUserId,
          amount: entryFee,
          txType: 'entry',
          matchId
        });

        if (!charge || !charge.ok) {
          socket.emit('join_error', { reason: charge?.message || 'Saldo insuficiente' });
          return;
        }
        confirmedBalance = charge.new_balance;
      }

      const radius = 12;
      const startX = clampInside(room.width / 2 + (Math.random() - 0.5) * 160, radius, room.width);
      const startY = clampInside(room.height / 2 + (Math.random() - 0.5) * 160, radius, room.height);

      room.players[socket.id] = {
        id: socket.id,
        userId: effectiveUserId,
        matchId,
        entryFee,
        name: (data.name || 'Jugador').toString().slice(0, 16),
        x: startX,
        y: startY,
        angle: 0,
        speed: 2.6,
        boosting: false,
        radius,
        ves: entryFee,
        skinId: data.skinId || 've',
        color: data.color || '#22c55e',
        alive: !isSpectator,
        spectator: isSpectator,
        claimedWin: false,
        body: Array.from({ length: 20 }, () => ({ x: startX, y: startY }))
      };

      socket.join(room.id);
      socket.data.roomId = room.id;

      socket.emit('joined_arena', {
        roomId: room.id,
        matchId,
        entryFee,
        balance: confirmedBalance,
        map: { size: adminConfig.mapSize, width: room.width, height: room.height },
        food: { enabled: adminConfig.foodEnabled, value: adminConfig.foodValue }
      });
    } catch (err) {
      console.error('Error join_arena:', err);
      socket.emit('join_error', { reason: 'Error al ingresar a la sala' });
    }
  });

  socket.on('player_input', (input = {}) => {
    const roomId = socket.data.roomId;
    const p = roomId && rooms[roomId] && rooms[roomId].players[socket.id];
    if (!p || !p.alive || p.spectator) return;

    if (typeof input.angle === 'number' && Number.isFinite(input.angle)) {
      p.angle = input.angle;
    }
    p.boosting = Boolean(input.boosting) && p.ves > p.entryFee * 0.1;
    p.speed = p.boosting ? 4.4 : 2.6;
  });

  socket.on('claim_win', async () => {
    try {
      const roomId = socket.data.roomId;
      const room = roomId && rooms[roomId];
      const p = room && room.players[socket.id];

      if (!p || !p.userId || !p.matchId || p.spectator || p.claimedWin || !p.alive) {
        return;
      }

      p.claimedWin = true;
      p.alive = false;

      const payout = Math.max(0, Math.floor(p.ves > p.entryFee ? p.ves : p.entryFee * 1.8));

      const credit = await adjustBalance({
        userId: p.userId,
        amount: payout,
        txType: 'win',
        matchId: p.matchId
      });

      if (!credit || !credit.ok) {
        p.claimedWin = false;
        socket.emit('win_error', { reason: credit?.message || 'No se pudo acreditar ganancia' });
        return;
      }

      socket.emit('win_credited', {
        matchId: p.matchId,
        payout,
        balance: credit.new_balance
      });
    } catch (err) {
      console.error('Error claim_win:', err);
      socket.emit('win_error', { reason: 'Error interno al sumar ganancia' });
    }
  });

  socket.on('disconnect', () => {
    console.log(`❌ Desconectado: ${socket.id}`);
    const roomId = socket.data.roomId;
    if (roomId && rooms[roomId]) {
      const leaving = rooms[roomId].players[socket.id];
      if (leaving && leaving.alive && !leaving.spectator) {
        spawnDeathLoot(rooms[roomId], leaving);
      }
      delete rooms[roomId].players[socket.id];
    }
  });
});

// ==========================================
// BUCLE PRINCIPAL DEL MUNDO (20 TPS)
// ==========================================
const tickInterval = setInterval(() => {
  try {
    const dims = getMapDims(adminConfig.mapSize);

    Object.keys(rooms).forEach((roomId) => {
      const room = rooms[roomId];
      if (!room) return;

      room.width = dims.width;
      room.height = dims.height;

      const activePlayers = Object.values(room.players).filter((p) => !p.spectator && p.alive);
      if (activePlayers.length === 0) return;

      // 1. Movimiento, consumo por turbo y largo real
      activePlayers.forEach((p) => {
        if (p.boosting && p.ves > p.entryFee * 0.1) {
          p.ves = Math.max(0, Number((p.ves - p.entryFee * 0.0015).toFixed(2)));
        } else {
          p.boosting = false;
          p.speed = 2.6;
        }

        p.radius = 10 + Math.min(20, Math.sqrt(p.ves) * 0.25);
        p.x = clampInside(p.x + Math.cos(p.angle) * p.speed, p.radius, room.width);
        p.y = clampInside(p.y + Math.sin(p.angle) * p.speed, p.radius, room.height);

        const targetLen = Math.max(15, Math.min(120, Math.floor(15 + p.ves / Math.max(1, p.entryFee / 20))));
        p.body.unshift({ x: p.x, y: p.y });
        while (p.body.length > targetLen) {
          p.body.pop();
        }
      });

      // 2. Comida del mapa
      if (adminConfig.foodEnabled) {
        while (room.foods.length < dims.foodCount) {
          room.foods.push(spawnFood(room.width, room.height, adminConfig.foodValue));
        }

        for (let i = room.foods.length - 1; i >= 0; i--) {
          const f = room.foods[i];
          let eaten = false;

          for (const p of activePlayers) {
            const dx = p.x - f.x;
            const dy = p.y - f.y;
            const hitDist = p.radius + 10;
            if (dx * dx + dy * dy <= hitDist * hitDist) {
              p.ves = Number((p.ves + (Number(f.value) || adminConfig.foodValue)).toFixed(2));
              eaten = true;
              break;
            }
          }

          if (eaten) {
            room.foods.splice(i, 1);
            room.foods.push(spawnFood(room.width, room.height, adminConfig.foodValue));
          }
        }
      } else if (room.foods.length > 0) {
        room.foods = [];
      }

      // 3. Recolección de botín soltado al morir
      for (let i = room.loots.length - 1; i >= 0; i--) {
        const l = room.loots[i];
        for (const p of activePlayers) {
          const dx = p.x - l.x;
          const dy = p.y - l.y;
          const hitDist = p.radius + 12;
          if (dx * dx + dy * dy <= hitDist * hitDist) {
            p.ves = Number((p.ves + l.value).toFixed(2));
            room.loots.splice(i, 1);
            break;
          }
        }
      }

      // 4. Colisiones entre jugadores
      for (const p of activePlayers) {
        if (!p.alive) continue;
        for (const other of activePlayers) {
          if (p.id === other.id || !other.alive) continue;

          for (let idx = 3; idx < other.body.length; idx += 2) {
            const seg = other.body[idx];
            const dx = p.x - seg.x;
            const dy = p.y - seg.y;
            const minDist = p.radius + 8;
            if (dx * dx + dy * dy < minDist * minDist) {
              p.alive = false;
              spawnDeathLoot(room, p);
              io.to(p.id).emit('player_eliminated', { by: other.name });
              break;
            }
          }
          if (!p.alive) break;
        }
      }

      // 5. Envío de estado actualizado a toda la sala
      const stillAlive = Object.values(room.players).filter((p) => !p.spectator && p.alive);
      const playersPayload = {};
      stillAlive.forEach((p) => {
        playersPayload[p.id] = {
          id: p.id,
          name: p.name,
          x: Math.round(p.x),
          y: Math.round(p.y),
          angle: Number(p.angle.toFixed(2)),
          speed: p.speed,
          ves: p.ves,
          skinId: p.skinId,
          color: p.color,
          alive: p.alive,
          body: compactBody(p.body, 55)
        };
      });

      io.to(room.id).emit('world_state', {
        roomId: room.id,
        width: room.width,
        height: room.height,
        worldSize: room.width,
        foodEnabled: adminConfig.foodEnabled,
        foods: room.foods.map((f) => [f.x, f.y, f.value]),
        loots: room.loots.map((l) => [l.x, l.y, l.value]),
        players: playersPayload
      });
    });
  } catch (err) {
    console.error('⚠️ Error en tickInterval:', err.message);
  }
}, 50);

// ==========================================
// APAGADO LIMPIO EN RED HAT (SYSTEMD / PM2)
// ==========================================
function gracefulShutdown(signal) {
  console.log(`🛑 Recibida señal ${signal}. Cerrando servidor limpiamente...`);
  clearInterval(configInterval);
  clearInterval(tickInterval);
  io.close(() => {
    server.close(() => {
      console.log('✅ Servidor cerrado correctamente.');
      process.exit(0);
    });
  });
  setTimeout(() => process.exit(1), 5000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor Gusanos Royale activo en 0.0.0.0:${PORT}`);
});