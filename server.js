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

  // Unión a sala usada por el script cliente (arena_ves_50, arena_ves_100, etc.)
  socket.on('join_room', (data = {}) => {
    if (!data || !data.room) return;

    const prevRoom = socket.data.roomId;
    if (prevRoom && prevRoom !== data.room) {
      socket.leave(prevRoom);
    }

    socket.join(data.room);
    socket.data.roomId = data.room;
    socket.data.customPlayerId = data.playerId || socket.id;
    socket.data.playerName = data.name || 'Jugador';
    socket.data.isSpectator = Boolean(data.isSpectator);

    console.log(`🎮 ${socket.data.playerName} (${socket.data.customPlayerId}) entró a ${data.room}`);
  });

  // Reenvío de movimiento entre jugadores de la misma sala
  socket.on('player_move', (payload = {}) => {
    const targetRoom = payload.room || socket.data.roomId;
    if (!targetRoom) return;

    socket.data.lastPlayerId = payload.id || socket.data.customPlayerId || socket.id;
    socket.to(targetRoom).emit('player_move', {
      ...payload,
      room: targetRoom
    });
  });

  // Notificar eliminación de jugador a los demás de la sala
  socket.on('player_died', (payload = {}) => {
    const targetRoom = payload.room || socket.data.roomId;
    const deadId = payload.id || socket.data.customPlayerId || socket.id;
    if (!targetRoom) return;

    socket.to(targetRoom).emit('player_died', {
      ...payload,
      id: deadId,
      room: targetRoom
    });
  });

  // Reenviar lote de botín al morir
  socket.on('spawn_loot_batch', (payload = {}) => {
    const targetRoom = payload.room || socket.data.roomId;
    if (!targetRoom) return;

    socket.to(targetRoom).emit('spawn_loot_batch', {
      ...payload,
      room: targetRoom
    });
  });

  // Reenviar orbe individual de botín
  socket.on('spawn_loot', (payload = {}) => {
    const targetRoom = payload.room || socket.data.roomId;
    if (!targetRoom) return;

    socket.to(targetRoom).emit('spawn_loot', {
      ...payload,
      room: targetRoom
    });
  });

  // Reenviar recolección de botín para quitarlo en los demás clientes
  socket.on('collect_loot', (payload = {}) => {
    const targetRoom = payload.room || socket.data.roomId;
    if (!targetRoom) return;

    socket.to(targetRoom).emit('collect_loot', {
      ...payload,
      room: targetRoom
    });
  });

  socket.on('disconnect', () => {
    console.log(`❌ Desconectado: ${socket.id}`);
    const targetRoom = socket.data.roomId;
    const leavingId = socket.data.lastPlayerId || socket.data.customPlayerId;

    if (targetRoom && leavingId) {
      socket.to(targetRoom).emit('player_died', {
        id: leavingId,
        room: targetRoom
      });
    }

    if (targetRoom && rooms[targetRoom]) {
      delete rooms[targetRoom].players[socket.id];
    }
  });
});

// ==========================================
// APAGADO LIMPIO EN RED HAT (SYSTEMD / PM2)
// ==========================================
function gracefulShutdown(signal) {
  console.log(`🛑 Recibida señal ${signal}. Cerrando servidor limpiamente...`);
  clearInterval(configInterval);
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
