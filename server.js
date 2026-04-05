const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

// Expose local LAN IP so clients can build working share links
app.get('/api/local-ip', (req, res) => {
  const nets = os.networkInterfaces();
  let localIp = null;
  for (const ifaces of Object.values(nets)) {
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) { localIp = iface.address; break; }
    }
    if (localIp) break;
  }
  res.json({ ip: localIp });
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ─── Word Bank ───────────────────────────────────────────────────────────────
const WORDS = [
  // Animals
  'elephant','penguin','kangaroo','dolphin','butterfly','giraffe','octopus',
  'jellyfish','flamingo','cheetah','hamster','lobster','peacock','narwhal','axolotl',
  // Objects
  'umbrella','telescope','compass','lantern','submarine','parachute','helicopter',
  'bicycle','accordion','microscope','boomerang','magnifying glass','typewriter','hourglass',
  // Nature
  'volcano','waterfall','rainbow','tornado','lightning','glacier','cactus',
  'mushroom','sunflower','seashell','snowflake','coral reef','quicksand','avalanche',
  // Food
  'pizza','spaghetti','sushi','burrito','croissant','waffle','cupcake',
  'pineapple','watermelon','pretzel','donut','tacos','dumpling','milkshake',
  // Places
  'lighthouse','castle','pyramid','igloo','windmill','treehouse','skyscraper',
  'cave','island','bridge','cathedral','village','hot springs','labyrinth',
  // Actions
  'swimming','dancing','climbing','sleeping','cooking','painting','fishing',
  'surfing','reading','juggling','skydiving','snorkeling',
  // Fun
  'spaceship','robot','dragon','unicorn','ghost','wizard','treasure','meteor',
  'fireworks','balloon','kite','rocket','time machine','black hole','wormhole'
];

const TURN_TIME = 80;
const HINT_INTERVAL = 25;
const WORD_CHOICE_TIME = 15;

// ─── Rooms ───────────────────────────────────────────────────────────────────
const rooms = {};

function generateRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

function getRandomWords(n = 3) {
  return [...WORDS].sort(() => Math.random() - 0.5).slice(0, n);
}

function buildHint(word, revealed) {
  return word.split('').map((c, i) =>
    c === ' ' ? '/' : (revealed.includes(i) ? c.toUpperCase() : '_')
  ).join(' ');
}

function revealOneLetter(word, revealed) {
  const eligible = [...word].map((c, i) => i).filter(i => word[i] !== ' ' && !revealed.includes(i));
  if (!eligible.length) return revealed;
  const pick = eligible[Math.floor(Math.random() * eligible.length)];
  return [...revealed, pick];
}

// ─── Socket Logic ────────────────────────────────────────────────────────────
io.on('connection', (socket) => {

  socket.on('createRoom', ({ name }) => {
    name = (name || 'Player').trim().slice(0, 20);
    let roomId;
    do { roomId = generateRoomId(); } while (rooms[roomId]);

    const player = { id: socket.id, name, score: 0, isHost: true };
    rooms[roomId] = {
      id: roomId, players: [player], state: 'lobby',
      turnCount: 0, currentDrawerIndex: 0, currentRound: 1,
      totalRounds: 3, currentWord: null, timeLeft: TURN_TIME,
      revealedIndices: [], guessedPlayers: [],
      timer: null, wordChoiceTimer: null
    };

    socket.join(roomId);
    socket.data = { roomId, name };
    socket.emit('roomJoined', { roomId, playerId: socket.id, players: rooms[roomId].players, isHost: true });
  });

  socket.on('joinRoom', ({ roomId, name }) => {
    name = (name || 'Player').trim().slice(0, 20);
    roomId = (roomId || '').toUpperCase().trim();
    const room = rooms[roomId];

    if (!room)                      return socket.emit('joinError', { message: 'Room not found. Double-check the code.' });
    if (room.state !== 'lobby')     return socket.emit('joinError', { message: 'This game has already started.' });
    if (room.players.length >= 8)   return socket.emit('joinError', { message: 'Room is full (max 8 players).' });

    const player = { id: socket.id, name, score: 0, isHost: false };
    room.players.push(player);
    socket.join(roomId);
    socket.data = { roomId, name };

    socket.emit('roomJoined', { roomId, playerId: socket.id, players: room.players, isHost: false });
    socket.to(roomId).emit('playerJoined', { player, players: room.players });
  });

  socket.on('startGame', ({ totalRounds }) => {
    const room = rooms[socket.data?.roomId];
    if (!room) return;
    const me = room.players.find(p => p.id === socket.id);
    if (!me?.isHost) return;
    if (room.players.length < 2) return socket.emit('gameError', { message: 'Need at least 2 players!' });

    room.totalRounds = Math.max(1, Math.min(5, parseInt(totalRounds) || 3));
    room.state = 'playing';
    room.turnCount = 0;
    room.players.forEach(p => p.score = 0);

    io.to(room.id).emit('gameStarted', { totalRounds: room.totalRounds });
    startNextTurn(room.id);
  });

  socket.on('selectWord', ({ word }) => {
    const room = rooms[socket.data?.roomId];
    if (!room || room.state !== 'choosing') return;
    const drawer = room.players[room.currentDrawerIndex];
    if (!drawer || drawer.id !== socket.id) return;

    if (room.wordChoiceTimer) { clearTimeout(room.wordChoiceTimer); room.wordChoiceTimer = null; }
    beginDrawingPhase(room.id, word);
  });

  socket.on('drawEvent', (data) => {
    const room = rooms[socket.data?.roomId];
    if (!room || room.state !== 'drawing') return;
    const drawer = room.players[room.currentDrawerIndex];
    if (!drawer || drawer.id !== socket.id) return;
    socket.to(room.id).emit('drawEvent', data);
  });

  socket.on('clearCanvas', () => {
    const room = rooms[socket.data?.roomId];
    if (!room) return;
    const drawer = room.players[room.currentDrawerIndex];
    if (!drawer || drawer.id !== socket.id) return;
    socket.to(room.id).emit('canvasCleared');
  });

  socket.on('guess', ({ text }) => {
    const room = rooms[socket.data?.roomId];
    if (!room || room.state !== 'drawing') return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;
    const drawer = room.players[room.currentDrawerIndex];
    if (drawer.id === socket.id) return;
    if (room.guessedPlayers.includes(socket.id)) return;

    const correct = text.trim().toLowerCase() === room.currentWord.toLowerCase();
    if (correct) {
      room.guessedPlayers.push(socket.id);
      const timeRatio = room.timeLeft / TURN_TIME;
      const points = Math.max(10, Math.floor(timeRatio * 200) + 50 - (room.guessedPlayers.length - 1) * 20);
      player.score += points;

      io.to(room.id).emit('correctGuess', {
        playerId: socket.id, playerName: player.name, points, players: room.players
      });

      const nonDrawers = room.players.filter(p => p.id !== drawer.id);
      if (room.guessedPlayers.length >= nonDrawers.length) endTurn(room.id, 'allGuessed');
    } else {
      io.to(room.id).emit('wrongGuess', {
        playerId: socket.id, playerName: player.name, text: text.trim()
      });
    }
  });

  // ── Voice chat signaling ──────────────────────────────────────────────────
  socket.on('voiceJoin',    ()                   => { const r = socket.data?.roomId; if (r) socket.to(r).emit('voiceNewPeer',  { peerId: socket.id }); });
  socket.on('voiceOffer',   ({ to, offer })      => io.to(to).emit('voiceOffer',   { from: socket.id, offer }));
  socket.on('voiceAnswer',  ({ to, answer })     => io.to(to).emit('voiceAnswer',  { from: socket.id, answer }));
  socket.on('voiceIce',     ({ to, candidate })  => io.to(to).emit('voiceIce',     { from: socket.id, candidate }));
  socket.on('voiceLeave',   ()                   => { const r = socket.data?.roomId; if (r) socket.to(r).emit('voicePeerLeft',  { peerId: socket.id }); });
  socket.on('voiceSpeaking',({ speaking })       => { const r = socket.data?.roomId; if (r) socket.to(r).emit('voiceSpeaking',  { peerId: socket.id, speaking }); });

  socket.on('disconnect', () => {
    const roomId = socket.data?.roomId;
    const room = rooms[roomId];
    if (!room) return;

    const idx = room.players.findIndex(p => p.id === socket.id);
    if (idx === -1) return;
    const [leaving] = room.players.splice(idx, 1);

    if (!room.players.length) {
      if (room.timer) clearInterval(room.timer);
      if (room.wordChoiceTimer) clearTimeout(room.wordChoiceTimer);
      delete rooms[roomId];
      return;
    }

    if (leaving.isHost) {
      room.players[0].isHost = true;
      io.to(roomId).emit('hostChanged', { newHostId: room.players[0].id });
    }

    io.to(roomId).emit('playerLeft', {
      playerId: socket.id, playerName: leaving.name, players: room.players
    });

    if ((room.state === 'drawing' || room.state === 'choosing')) {
      const drawer = room.players[room.currentDrawerIndex];
      if (!drawer || drawer.id === socket.id) endTurn(roomId, 'drawerLeft');
      else if (room.players.length < 2) endTurn(roomId, 'notEnoughPlayers');
    }
  });
});

// ─── Game Flow ───────────────────────────────────────────────────────────────
function startNextTurn(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  if (room.turnCount >= room.totalRounds * room.players.length) {
    endGame(roomId);
    return;
  }

  room.currentDrawerIndex = room.turnCount % room.players.length;
  room.currentRound = Math.floor(room.turnCount / room.players.length) + 1;
  room.turnCount++;
  room.guessedPlayers = [];
  room.state = 'choosing';

  const drawer = room.players[room.currentDrawerIndex];
  const words = getRandomWords(3);

  io.to(roomId).emit('newTurn', {
    drawerId: drawer.id, drawerName: drawer.name,
    round: room.currentRound, totalRounds: room.totalRounds, players: room.players
  });

  io.sockets.sockets.get(drawer.id)?.emit('wordChoices', { words });

  room.wordChoiceTimer = setTimeout(() => {
    if (room.state === 'choosing') beginDrawingPhase(roomId, words[0]);
  }, WORD_CHOICE_TIME * 1000);
}

function beginDrawingPhase(roomId, word) {
  const room = rooms[roomId];
  if (!room) return;

  room.currentWord = word;
  room.state = 'drawing';
  room.revealedIndices = [];
  room.guessedPlayers = [];
  room.timeLeft = TURN_TIME;

  const drawer = room.players[room.currentDrawerIndex];
  io.to(roomId).emit('drawingStarted', { hint: buildHint(word, []), drawerId: drawer.id });
  io.sockets.sockets.get(drawer.id)?.emit('yourWordIs', { word });

  if (room.timer) clearInterval(room.timer);
  let hintCd = HINT_INTERVAL;

  room.timer = setInterval(() => {
    room.timeLeft--;
    hintCd--;
    io.to(roomId).emit('tick', { timeLeft: room.timeLeft });

    if (hintCd <= 0 && room.revealedIndices.length < word.replace(/ /g, '').length - 1) {
      hintCd = HINT_INTERVAL;
      room.revealedIndices = revealOneLetter(word, room.revealedIndices);
      io.to(roomId).emit('hintUpdate', { hint: buildHint(word, room.revealedIndices) });
    }

    if (room.timeLeft <= 0) endTurn(roomId, 'timeout');
  }, 1000);
}

function endTurn(roomId, reason) {
  const room = rooms[roomId];
  if (!room || room.state === 'roundEnd') return;

  if (room.timer) { clearInterval(room.timer); room.timer = null; }
  if (room.wordChoiceTimer) { clearTimeout(room.wordChoiceTimer); room.wordChoiceTimer = null; }
  room.state = 'roundEnd';

  const drawer = room.players[room.currentDrawerIndex];
  if (drawer && room.guessedPlayers.length > 0 && reason !== 'drawerLeft') {
    const nonDrawers = room.players.filter(p => p.id !== drawer.id);
    drawer.score += Math.floor((room.guessedPlayers.length / Math.max(nonDrawers.length, 1)) * 80);
  }

  io.to(roomId).emit('turnEnded', { word: room.currentWord || '?', reason, players: room.players });

  setTimeout(() => {
    if (!rooms[roomId]) return;
    if (rooms[roomId].players.length < 2) { endGame(roomId); return; }
    startNextTurn(roomId);
  }, 5000);
}

function endGame(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  if (room.timer) clearInterval(room.timer);
  room.state = 'gameEnd';
  const sorted = [...room.players].sort((a, b) => b.score - a.score);
  io.to(roomId).emit('gameEnded', { players: sorted });
  // Reset for play again
  room.state = 'lobby';
  room.players.forEach(p => p.score = 0);
  room.turnCount = 0;
  setTimeout(() => { delete rooms[roomId]; }, 30 * 60 * 1000);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`SketchParty running → http://localhost:${PORT}`));
