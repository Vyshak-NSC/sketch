const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

// Local IP
app.get('/api/local-ip', (req, res) => {
  const nets = os.networkInterfaces();
  let localIp = null;
  for (const ifaces of Object.values(nets)) {
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) {
        localIp = iface.address;
        break;
      }
    }
    if (localIp) break;
  }
  res.json({ ip: localIp });
});

app.get('*', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
);

// ─── Constants ───
const TURN_TIME = 80;
const HINT_INTERVAL = 25;
const WORD_CHOICE_TIME = 15;

const WORDS = ['elephant','penguin','kangaroo','dolphin','pizza','rocket','dragon'];

const rooms = {};

// ─── Helpers ───
function generateRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 6; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

function getRandomWords(n = 3) {
  return [...WORDS].sort(() => Math.random() - 0.5).slice(0, n);
}

// ─── SOCKET ─────────────────────────────────────────────
io.on('connection', (socket) => {

  // ── CREATE ROOM ──
  socket.on('createRoom', ({ name }) => {
    let roomId;
    do { roomId = generateRoomId(); } while (rooms[roomId]);

    const player = { id: socket.id, name, score: 0, isHost: true };

    rooms[roomId] = {
      id: roomId,
      players: [player],
      state: 'lobby',
      currentDrawerIndex: 0,
      turnCount: 0,
      totalRounds: 3,
      currentWord: null,
      guessedPlayers: [],
      timer: null
    };

    socket.join(roomId);
    socket.data = { roomId, name };

    socket.emit('roomJoined', {
      roomId,
      playerId: socket.id,
      players: rooms[roomId].players,
      isHost: true
    });
  });

  // ── JOIN ROOM ──
  socket.on('joinRoom', ({ roomId, name }) => {
    const room = rooms[roomId];
    if (!room) return socket.emit('joinError', { message: 'Room not found' });

    const player = { id: socket.id, name, score: 0, isHost: false };
    room.players.push(player);

    socket.join(roomId);
    socket.data = { roomId, name };

    socket.emit('roomJoined', {
      roomId,
      playerId: socket.id,
      players: room.players,
      isHost: false
    });

    socket.to(roomId).emit('playerJoined', { player, players: room.players });
  });

  // ── START GAME ──
  socket.on('startGame', () => {
    const room = rooms[socket.data?.roomId];
    if (!room) return;

    room.state = 'playing';
    io.to(room.id).emit('gameStarted', { totalRounds: room.totalRounds });
  });

  // ── QUIT ROOM (FIXED) ──
  socket.on('quitRoom', () => {
    const roomId = socket.data?.roomId;
    const room = rooms[roomId];
    if (!room) return;

    const idx = room.players.findIndex(p => p.id === socket.id);
    if (idx === -1) return;

    const [leaving] = room.players.splice(idx, 1);

    if (leaving.isHost && room.players.length > 0) {
      room.players[0].isHost = true;
      io.to(roomId).emit('hostChanged', { newHostId: room.players[0].id });
    }

    io.to(roomId).emit('playerLeft', {
      playerId: socket.id,
      playerName: leaving.name,
      players: room.players
    });

    socket.leave(roomId);
    socket.data = {};

    if (!room.players.length) {
      delete rooms[roomId];
    }
  });

  // ── REJOIN ROOM (FIXED) ──
  socket.on('rejoinRoom', ({ roomId, name }) => {
    const room = rooms[roomId];
    if (!room) return;

    const player = { id: socket.id, name, score: 0, isHost: false };
    room.players.push(player);

    socket.join(roomId);
    socket.data = { roomId, name };

    socket.emit('roomJoined', {
      roomId,
      playerId: socket.id,
      players: room.players,
      isHost: false
    });

    socket.to(roomId).emit('playerJoined', { player, players: room.players });
  });

  // ── DISCONNECT ──
  socket.on('disconnect', () => {
    const roomId = socket.data?.roomId;
    const room = rooms[roomId];
    if (!room) return;

    const idx = room.players.findIndex(p => p.id === socket.id);
    if (idx === -1) return;

    const [leaving] = room.players.splice(idx, 1);

    io.to(roomId).emit('playerLeft', {
      playerId: socket.id,
      playerName: leaving.name,
      players: room.players
    });

    if (!room.players.length) delete rooms[roomId];
  });

});

// ─── SERVER START ───
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Running → http://localhost:${PORT}`);
});