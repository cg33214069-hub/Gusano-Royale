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

let jugadoresConectados = {};

io.on('connection', (socket) => {
  console.log(`🔌 Jugador conectado: ${socket.id}`);

  socket.on('join_game', (datos) => {
    jugadoresConectados[socket.id] = {
      id: socket.id,
      nombre: datos.nombre || 'Gusano',
      x: datos.x || 100,
      y: datos.y || 100
    };
    io.emit('actualizar_jugadores', jugadoresConectados);
  });

  socket.on('mover', (pos) => {
    if (jugadoresConectados[socket.id]) {
      jugadoresConectados[socket.id].x = pos.x;
      jugadoresConectados[socket.id].y = pos.y;
    }
  });

  socket.on('disconnect', () => {
    console.log(`❌ Jugador desconectado: ${socket.id}`);
    delete jugadoresConectados[socket.id];
    io.emit('actualizar_jugadores', jugadoresConectados);
  });
});

// Enviar posiciones fluidas a 30 cuadros por segundo
setInterval(() => {
  io.emit('actualizar_jugadores', jugadoresConectados);
}, 33);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Servidor activo y listo en el puerto ${PORT}`);
});