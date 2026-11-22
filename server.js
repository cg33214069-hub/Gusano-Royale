const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

app.get('/', (req, res) => {
  res.send('Servidor Gusanos Royale activo');
});

const WORLD_SIZE = 2500;
const rooms = {};

function getRoom(roomId, entryFee = 50) {
  if (!rooms[roomId]) {
    rooms[roomId] = {
      id: roomId,
      entryFee,
      worldSize: WORLD_SIZE,
      players: {}
    };
  }
  return rooms[roomId];
}

function clampInside(val, radius, worldSize) {
  const min = radius + 10;
  const max = Math.max(min, worldSize - radius - 10);
  return Math.max(min, Math.min(max, val));
}

io.on('connection', (socket) => {
  console.log(`🔌 Conectado: ${socket.id}`);

  socket.on('join_arena', (data = {}) => {
    const roomId = data.roomId || 'arena_ves_50';
    const entryFee = Number(data.entryFee) || 50;
    const room = getRoom(roomId, entryFee);
    const radius = 12;

    const startX = clampInside(
      room.worldSize / 2 + (Math.random() - 0.5) * 160,
      radius,
      room.worldSize
    );
    const startY = clampInside(
      room.worldSize / 2 + (Math.random() - 0.5) * 160,
      radius,
      room.worldSize
    );

    room.players[socket.id] = {
      id: socket.id,
      name: (data.name || 'Jugador').toString().slice(0, 16),
      x: startX,
      y: startY,
      angle: 0,
      speed: 2.6,
      radius,
      ves: Number(data.ves) || entryFee,
      skinId: data.skinId || 've',
      color: data.color || '#22c55e',
      alive: !data.spectator,
      spectator: Boolean(data.spectator),
      body: Array.from({ length: 20 }, () => ({ x: startX, y: startY }))
    };

    socket.join(roomId);
    socket.data.roomId = roomId;
  });

  socket.on('player_input', (input = {}) => {
    const roomId = socket.data.roomId;
    const p = roomId && rooms[roomId] && rooms[roomId].players[socket.id];
    if (!p || !p.alive || p.spectator) return;

    if (typeof input.angle === 'number' && Number.isFinite(input.angle)) {
      p.angle = input.angle;
    }
    p.speed = input.boosting ? 4.4 : 2.6;
    if (typeof input.ves === 'number' && Number.isFinite(input.ves) && input.ves >= 0) {
      p.ves = Math.floor(input.ves);
    }
  });

  socket.on('disconnect', () => {
    console.log(`❌ Desconectado: ${socket.id}`);
    const roomId = socket.data.roomId;
    if (roomId && rooms[roomId] && rooms[roomId].players[socket.id]) {
      delete rooms[roomId].players[socket.id];
    }
  });
});

setInterval(() => {
  Object.values(rooms).forEach((room) => {
    const activePlayers = Object.values(room.players).filter(p => !p.spectator && p.alive);
    if (activePlayers.length === 0) return;

    activePlayers.forEach((p) => {
      p.x = clampInside(p.x + Math.cos(p.angle) * p.speed, p.radius, room.worldSize);
      p.y = clampInside(p.y + Math.sin(p.angle) * p.speed, p.radius, room.worldSize);

      const targetLen = Math.max(15, Math.min(80, Math.floor(15 + p.ves / 20)));
      p.body.unshift({ x: p.x, y: p.y });
      while (p.body.length > targetLen) {
        p.body.pop();
      }
    });

    const playersPayload = {};
    activePlayers.forEach((p) => {
      playersPayload[p.id] = {
        id: p.id,
        name: p.name,
        x: Number(p.x.toFixed(1)),
        y: Number(p.y.toFixed(1)),
        angle: Number(p.angle.toFixed(3)),
        speed: p.speed,
        ves: p.ves,
        skinId: p.skinId,
        color: p.color,
        alive: p.alive,
        body: p.body
      };
    });

    io.to(room.id).emit('world_state', {
      worldSize: room.worldSize,
      players: playersPayload
    });
  });
}, 50);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Servidor activo y listo en el puerto ${PORT}`);
});