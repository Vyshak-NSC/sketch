const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
);

// ─── CONSTANTS ───
const WORDS = ['elephant','pizza','rocket','dragon','car','tree','house'];

const rooms = {};

// ─── SOCKET ─────────────────────────
io.on('connection', (socket) => {

  // CREATE
  socket.on('createRoom', ({ name }) => {
    const roomId = Math.random().toString(36).substring(2, 7).toUpperCase();

    const player = { id: socket.id, name, score: 0, isHost: true };

    rooms[roomId] = {
      id: roomId,
      players: [player],
      state: 'lobby',
      currentDrawerIndex: 0,
      currentWord: null
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

  // JOIN / REJOIN
  socket.on('rejoinRoom', ({ roomId, name }) => {
    roomId = (roomId || '').toUpperCase();
    const room = rooms[roomId];

    if (!room) return socket.emit('joinError', { message: 'Room not found' });

    let player = room.players.find(p => p.name === name);

    if (player) {
      player.id = socket.id;
    } else {
      player = { id: socket.id, name, score: 0, isHost: false };
      room.players.push(player);
    }

    socket.join(roomId);
    socket.data = { roomId, name };

    socket.emit('roomJoined', {
      roomId,
      playerId: socket.id,
      players: room.players,
      isHost: player.isHost
    });

    io.to(roomId).emit('playerJoined', { player, players: room.players });

    // restore game state
    if (room.state === 'drawing') {
      socket.emit('drawingStarted', {
        hint: '_ '.repeat(room.currentWord.length),
        drawerId: room.players[room.currentDrawerIndex].id
      });

      if (player.id === room.players[room.currentDrawerIndex].id) {
        socket.emit('yourWordIs', { word: room.currentWord });
      }
    }
  });

  // START GAME
  socket.on('startGame', () => {
    const room = rooms[socket.data?.roomId];
    if (!room) return;

    if (room.players.length < 2) return;

    room.state = 'playing';
    room.currentDrawerIndex = 0;

    io.to(room.id).emit('gameStarted', {
      totalRounds: 1
    });

    startTurn(room.id); // ✅ FIXED
  });

  // DRAW
  socket.on('drawEvent', (data) => {
    const roomId = socket.data?.roomId;
    if (!roomId) return;
    socket.to(roomId).emit('drawEvent', data);
  });

  // CLEAR
  socket.on('clearCanvas', () => {
    const roomId = socket.data?.roomId;
    if (!roomId) return;
    socket.to(roomId).emit('canvasCleared');
  });

  // GUESS
  socket.on('guess', ({ text }) => {
    const room = rooms[socket.data?.roomId];
    if (!room) return;

    if (!room.currentWord) return;

    if (text.toLowerCase() === room.currentWord.toLowerCase()) {
      io.to(room.id).emit('correctGuess', {
        playerId: socket.id,
        playerName: socket.data.name,
        points: 100,
        players: room.players
      });

      endTurn(room.id);
    } else {
      io.to(room.id).emit('wrongGuess', {
        playerName: socket.data.name,
        text
      });
    }
  });

  // DISCONNECT
  socket.on('disconnect', () => {
    const roomId = socket.data?.roomId;
    const room = rooms[roomId];
    if (!room) return;

    room.players = room.players.filter(p => p.id !== socket.id);

    io.to(roomId).emit('playerLeft', {
      playerName: socket.data?.name,
      players: room.players
    });
  });

});

// ─── GAME FLOW ───

function startTurn(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  const drawer = room.players[room.currentDrawerIndex];
  const word = WORDS[Math.floor(Math.random() * WORDS.length)];

  room.currentWord = word;
  room.state = 'drawing';

  io.to(roomId).emit('newTurn', {
    drawerId: drawer.id,
    drawerName: drawer.name,
    round: 1,
    totalRounds: 1,
    players: room.players
  });

  io.to(drawer.id).emit('yourWordIs', { word });

  io.to(roomId).emit('drawingStarted', {
    hint: '_ '.repeat(word.length),
    drawerId: drawer.id
  });
}

function endTurn(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  io.to(roomId).emit('turnEnded', {
    word: room.currentWord,
    players: room.players
  });

  setTimeout(() => {
    room.currentDrawerIndex =
      (room.currentDrawerIndex + 1) % room.players.length;

    startTurn(roomId);
  }, 3000);
}

// ─── START SERVER ───
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Running on http://localhost:${PORT}`);
});