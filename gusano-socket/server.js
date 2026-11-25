require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  transports: ["websocket", "polling"]
});

app.get('/', (req, res) => {
  res.send('Servidor Gusanos Royale activo');
});

const MAX_PLAYERS_PER_ROOM = 20;

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
      foods
    };
  }
  return rooms[roomId];
}

INITIAL_ROOMS.forEach((r) => getRoom(r.id, r.entryFee, r.name));

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
  } catch (_) {}

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
}

setInterval(syncAdminConfig, 8000);
syncAdminConfig();

function compactBody(body) {
  if (!Array.isArray(body)) return [];
  const sampled = [];
  for (let i = 0; i < body.length; i += 2) {
    sampled.push([Math.round(body[i].x), Math.round(body[i].y)]);
  }
  return sampled;
}

async function adjustBalance({ userId, amount, txType, matchId }) {
  const { data, error } = await supabase.rpc('adjust_player_balance', {
    p_user_id: userId,
    p_amount: amount,
    p_tx_type: txType,
    p_match_id: matchId
  });

  if (error) {
    if (error.code === '23505') {
      return { ok: true, message: 'Movimiento ya procesado' };
    }
    throw error;
  }

  return Array.isArray(data) ? data[0] : data;
}

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

      const activeCount = Object.values(room.players).filter(p => !p.spectator && p.alive).length;
      if (!isSpectator && activeCount >= MAX_PLAYERS_PER_ROOM) {
        socket.emit('join_error', { reason: `La sala está llena (máx. ${MAX_PLAYERS_PER_ROOM} jugadores)` });
        return;
      }

      const entryFee = room.entryFee;
      const matchId = String(data.matchId || `${room.id}_${Date.now()}_${socket.id}`);

      let confirmedBalance = null;
      if (!isSpectator && entryFee > 0) {
        if (!socket.data.userId) {
          socket.emit('join_error', { reason: 'Debes iniciar sesión antes de entrar' });
          return;
        }

        const charge = await adjustBalance({
          userId: socket.data.userId,
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
        userId: socket.data.userId || null,
        matchId,
        entryFee,
        name: (data.name || 'Jugador').toString().slice(0, 16),
        x: startX,
        y: startY,
        angle: 0,
        speed: 2.6,
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
    p.speed = input.boosting ? 4.4 : 2.6;
  });

  socket.on('claim_win', async () => {
    try {
      const roomId = socket.data.roomId;
      const room = roomId && rooms[roomId];
      const p = room && room.players[socket.id];

      if (!p || !p.userId || !p.matchId || p.spectator || p.claimedWin) {
        return;
      }

      p.claimedWin = true;
      p.alive = false;

      const payout = Number((p.ves > p.entryFee ? p.ves : p.entryFee * 1.8).toFixed(2));

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
      if (rooms[roomId].players[socket.id]) {
        delete rooms[roomId].players[socket.id];
      }
      if (Object.keys(rooms[roomId].players).length === 0) {
        delete rooms[roomId];
      }
    }
  });
});

setInterval(() => {
  const dims = getMapDims(adminConfig.mapSize);

  Object.keys(rooms).forEach((roomId) => {
    const room = rooms[roomId];
    if (!room) return;

    room.width = dims.width;
    room.height = dims.height;

    const allInRoom = Object.keys(room.players);
    if (allInRoom.length === 0) {
      delete rooms[roomId];
      return;
    }

    const activePlayers = Object.values(room.players).filter(p => !p.spectator && p.alive);
    if (activePlayers.length === 0) return;

    activePlayers.forEach((p) => {
      p.x = clampInside(p.x + Math.cos(p.angle) * p.speed, p.radius, room.width);
      p.y = clampInside(p.y + Math.sin(p.angle) * p.speed, p.radius, room.height);

      const targetLen = Math.max(15, Math.min(100, Math.floor(15 + p.ves / 15)));
      p.body.unshift({ x: p.x, y: p.y });
      while (p.body.length > targetLen) {
        p.body.pop();
      }
    });

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

    for (const p of activePlayers) {
      for (const other of activePlayers) {
        if (p.id === other.id) continue;

        for (let idx = 3; idx < other.body.length; idx++) {
          const seg = other.body[idx];
          const dx = p.x - seg.x;
          const dy = p.y - seg.y;
          const minDist = p.radius + 8;
          if (dx * dx + dy * dy < minDist * minDist) {
            p.alive = false;
            other.ves = Number((other.ves + p.ves * 0.5).toFixed(2));
            io.to(p.id).emit('player_eliminated', { by: other.name });
            break;
          }
        }
        if (!p.alive) break;
      }
    }

    const stillAlive = Object.values(room.players).filter(p => !p.spectator && p.alive);
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
        body: compactBody(p.body)
      };
    });

    io.to(room.id).emit('world_state', {
      roomId: room.id,
      width: room.width,
      height: room.height,
      worldSize: room.width,
      foodEnabled: adminConfig.foodEnabled,
      foods: room.foods.map(f => [f.x, f.y, f.value]),
      players: playersPayload
    });
  });
}, 50);

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});