/* ═══════════════════════════════════════════════════════
   SketchParty — app.js
   All client-side logic: socket, canvas, UI state
═══════════════════════════════════════════════════════ */

// ── Socket ──────────────────────────────────────────────
const socket = io();

// ── State ───────────────────────────────────────────────
const S = {
  roomId:       null,
  playerId:     null,
  isHost:       false,
  players:      [],
  selectedRounds: 3,
  isDrawing:    false,   // am I the current drawer?
  hasGuessed:   false,
  currentDrawerId: null,
  // Drawing tool state
  tool:  'pen',
  color: '#1c1917',
  size:  8,
  // Timer
  totalTime: 80,
  // For replaying paths on other clients
  activePath: null, // { color, size, lastX, lastY }
  // Word choice timer
  wcInterval: null,
  wcTime: 15,
};

// ── Avatar colours ──────────────────────────────────────
const AV_COLORS = [
  '#4f46e5','#7c3aed','#db2777','#e11d48','#ea580c',
  '#d97706','#16a34a','#0891b2','#0284c7','#6366f1',
];
function avColor(i) { return AV_COLORS[i % AV_COLORS.length]; }
function avLetter(name) { return (name || '?')[0].toUpperCase(); }

// ── Screens ─────────────────────────────────────────────
const Screens = {
  welcome:  document.getElementById('screen-welcome'),
  lobby:    document.getElementById('screen-lobby'),
  game:     document.getElementById('screen-game'),
  gameover: document.getElementById('screen-gameover'),
};

function showScreen(name) {
  Object.values(Screens).forEach(s => s.classList.remove('active'));
  Screens[name].classList.add('active');

  // Show/hide chat toggle based on screen
  const inGame = name === 'game';
  btnChatToggle.style.display = inGame ? 'flex' : 'none';
  if (!inGame) closeChatPanel();
}

// ── DOM refs ─────────────────────────────────────────────
const $ = id => document.getElementById(id);

// Welcome
const inpName    = $('inp-name');
const inpCode    = $('inp-code');
const btnCreate  = $('btn-create');
const btnJoin    = $('btn-join');
const wError     = $('welcome-error');

// Rejoin
const rejoinBanner = $('rejoin-banner');
const btnRejoin    = $('btn-rejoin');

// Lobby
const lobbyCode  = $('lobby-code-display');
const lobbyList  = $('lobby-player-list');
const btnCopy    = $('btn-copy-link');
const btnStart   = $('btn-start');
const startHint  = $('start-hint');
const lobbyError = $('lobby-error');

// Game topbar
const uiRound    = $('ui-round');
const uiTotalR   = $('ui-total-rounds');
const hintDisp   = $('hint-display');
const timerNum   = $('timer-num');
const timerCirc  = $('timer-circle');
const tbCode     = $('tb-room-code');
const btnQuit    = $('btn-quit');

// Game panels
const gamePlayers = $('game-player-list');

// Canvas
const canvas     = $('canvas');
const ctx        = canvas.getContext('2d');

// Tools
const drawTools  = $('draw-tools');
const statusBar  = $('status-bar');
const statusText = $('status-text');
const btnEraser  = $('btn-eraser');
const btnClear   = $('btn-clear');
const customColor = $('custom-color');

// Chat
const chatPanel      = $('chat-panel');
const chatFeed       = $('chat-feed');
const chatInp        = $('chat-inp');
const btnSend        = $('btn-send');
const btnChatToggle  = $('btn-chat-toggle');
const btnChatClose   = $('btn-chat-close');
const chatUnread     = $('chat-unread');

// Overlays
const ovWordChoice = $('ov-word-choice');
const ovAnnounce   = $('ov-announce');
const ovTurnEnd    = $('ov-turn-end');

// Game over
const goList     = $('go-list');
const goPodium   = $('go-podium');
const btnPlayAgain = $('btn-play-again');
const btnLeave   = $('btn-leave');

// ════════════════════════════════════════════════════════
// CHAT TOGGLE
// ════════════════════════════════════════════════════════

let chatOpen = false;
let unreadCount = 0;

function openChatPanel() {
  chatOpen = true;
  chatPanel.classList.remove('chat-hidden');
  unreadCount = 0;
  chatUnread.textContent = '0';
  chatUnread.classList.add('hidden');
  chatFeed.scrollTop = chatFeed.scrollHeight;
}

function closeChatPanel() {
  chatOpen = false;
  chatPanel.classList.add('chat-hidden');
}

function bumpUnread() {
  if (!chatOpen) {
    unreadCount++;
    chatUnread.textContent = unreadCount;
    chatUnread.classList.remove('hidden');
  }
}

btnChatToggle.addEventListener('click', () => {
  if (chatOpen) closeChatPanel();
  else openChatPanel();
});

btnChatClose.addEventListener('click', closeChatPanel);

// ════════════════════════════════════════════════════════
// QUIT & REJOIN
// ════════════════════════════════════════════════════════

let savedRoom = null; // { roomId, name } — preserved when user quits

btnQuit.addEventListener('click', () => {
  if (!confirm('Leave the game? Your progress will be lost.')) return;

  // Save room info so user can rejoin
  savedRoom = { roomId: S.roomId, name: inpName.value.trim() || 'Player' };

  // Clean up voice if active
  leaveVoice();

  // Disconnect and immediately reconnect (gets a fresh socket.id)
  socket.disconnect();
  socket.connect();

  // Reset local state
  S.roomId = null; S.playerId = null; S.isHost = false; S.players = [];

  // Back to welcome
  showScreen('welcome');

  // Show rejoin banner
  rejoinBanner.classList.remove('hidden');
  inpName.value = savedRoom.name;

  // Clear URL param
  history.replaceState(null, '', '/');
});

btnRejoin.addEventListener('click', () => {
  if (!savedRoom) return;
  inpCode.value = savedRoom.roomId;
  inpName.value = savedRoom.name;
  hideError(wError);
  rejoinBanner.classList.add('hidden');
  // Trigger join
  joinRoom();
});

// ════════════════════════════════════════════════════════
// WELCOME SCREEN
// ════════════════════════════════════════════════════════

// Check for ?room= in URL (invite link)
(function checkInvite() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('room');
  if (code) {
    $('invite-banner').classList.remove('hidden');
    inpCode.value = code.toUpperCase();
  }
})();

btnCreate.addEventListener('click', () => {
  const name = inpName.value.trim();
  if (!name) { showError(wError, 'Enter your name first!'); return; }
  hideError(wError);
  rejoinBanner.classList.add('hidden');
  savedRoom = null;
  socket.emit('createRoom', { name });
});

btnJoin.addEventListener('click', joinRoom);
inpCode.addEventListener('keydown', e => { if (e.key === 'Enter') joinRoom(); });
inpName.addEventListener('keydown', e => { if (e.key === 'Enter') btnCreate.click(); });

function joinRoom() {
  const name = inpName.value.trim();
  const code = inpCode.value.trim().toUpperCase();
  if (!name) { showError(wError, 'Enter your name first!'); return; }
  if (!code) { showError(wError, 'Enter a room code!'); return; }
  hideError(wError);
  socket.emit('joinRoom', { name, roomId: code });
}

// ════════════════════════════════════════════════════════
// LOBBY SCREEN
// ════════════════════════════════════════════════════════

// Round selector
document.querySelectorAll('.rbtn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.rbtn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    S.selectedRounds = parseInt(btn.dataset.r);
  });
});

btnCopy.addEventListener('click', () => {
  const url = `${location.origin}?room=${S.roomId}`;
  navigator.clipboard.writeText(url).then(() => {
    btnCopy.textContent = '✓ Copied!';
    setTimeout(() => btnCopy.textContent = '📋 Copy Link', 2000);
  });
});

btnStart.addEventListener('click', () => {
  socket.emit('startGame', { totalRounds: S.selectedRounds });
});

function renderLobby() {
  lobbyList.innerHTML = '';
  S.players.forEach((p, i) => {
    const el = document.createElement('div');
    el.className = 'lobby-player';
    el.innerHTML = `
      <div class="av" style="background:${avColor(i)}">${avLetter(p.name)}</div>
      <span>${escHtml(p.name)}</span>
      ${p.isHost ? '<span class="crown" title="Host">👑</span>' : ''}
    `;
    lobbyList.appendChild(el);
  });

  const canStart = S.isHost && S.players.length >= 2;
  btnStart.disabled = !canStart;
  if (S.isHost) {
    startHint.textContent = S.players.length < 2
      ? 'Need at least 2 players to start.'
      : 'Ready to go! 🎉';
  } else {
    startHint.textContent = 'Waiting for the host to start…';
  }
}

// ════════════════════════════════════════════════════════
// GAME — PLAYER LIST
// ════════════════════════════════════════════════════════

function renderGamePlayers() {
  gamePlayers.innerHTML = '';
  S.players.forEach((p, i) => {
    const el = document.createElement('div');
    el.className = 'gp-row';
    if (p.id === S.currentDrawerId) el.classList.add('drawing');
    el.innerHTML = `
      <div class="gp-av" style="background:${avColor(i)}">${avLetter(p.name)}</div>
      <div class="gp-info">
        <div class="gp-name">${escHtml(p.name)}</div>
        <div class="gp-score">${p.score} pts</div>
      </div>
      ${p.id === S.currentDrawerId ? '<span class="gp-badge">✏️</span>' : ''}
      ${p.id === S.playerId ? '<span class="gp-badge" style="font-size:10px;color:var(--text-3)">you</span>' : ''}
    `;
    gamePlayers.appendChild(el);
  });
}

function markPlayerGuessed(playerId) {
  const rows = gamePlayers.querySelectorAll('.gp-row');
  S.players.forEach((p, i) => {
    if (p.id === playerId) {
      rows[i]?.classList.add('guessed');
    }
  });
}

// ════════════════════════════════════════════════════════
// GAME — HINT DISPLAY
// ════════════════════════════════════════════════════════

function renderHint(hintStr) {
  // hintStr: "_ p _ _ _ / _ _ _" where / = space between words
  hintDisp.innerHTML = '';
  hintStr.split(' ').forEach(ch => {
    const span = document.createElement('span');
    if (ch === '/') {
      span.className = 'hint-char space';
    } else if (ch === '_') {
      span.className = 'hint-char';
      span.textContent = '';
    } else {
      span.className = 'hint-char revealed';
      span.textContent = ch;
    }
    hintDisp.appendChild(span);
  });
}

function showActualWord(word) {
  hintDisp.innerHTML = '';
  word.split('').forEach(ch => {
    const span = document.createElement('span');
    if (ch === ' ') {
      span.className = 'hint-char space';
    } else {
      span.className = 'hint-char revealed';
      span.textContent = ch.toUpperCase();
    }
    hintDisp.appendChild(span);
  });
}

// ════════════════════════════════════════════════════════
// GAME — TIMER
// ════════════════════════════════════════════════════════

const CIRC = 2 * Math.PI * 18; // r=18

function updateTimer(t) {
  timerNum.textContent = t;
  const offset = CIRC * (1 - t / S.totalTime);
  timerCirc.style.strokeDashoffset = offset;

  if (t <= 10) {
    timerCirc.style.stroke = 'var(--danger)';
    timerNum.style.color = 'var(--danger)';
  } else if (t <= 25) {
    timerCirc.style.stroke = 'var(--accent)';
    timerNum.style.color = 'var(--accent)';
  } else {
    timerCirc.style.stroke = 'var(--primary)';
    timerNum.style.color = 'var(--text)';
  }
}

function resetTimer() {
  updateTimer(S.totalTime);
}

// ════════════════════════════════════════════════════════
// GAME — CHAT
// ════════════════════════════════════════════════════════

function addMsg(type, html) {
  const el = document.createElement('div');
  el.className = `chat-msg ${type}`;
  el.innerHTML = html;
  chatFeed.appendChild(el);
  chatFeed.scrollTop = chatFeed.scrollHeight;
  // Count unread when chat is closed
  if (!chatOpen) bumpUnread();
}

function sendGuess() {
  const text = chatInp.value.trim();
  if (!text) return;
  chatInp.value = '';
  socket.emit('guess', { text });
}

btnSend.addEventListener('click', sendGuess);
chatInp.addEventListener('keydown', e => {
  if (e.key === 'Enter') sendGuess();
});

function setChatEnabled(enabled) {
  chatInp.disabled = !enabled;
  btnSend.disabled = !enabled;
  chatInp.placeholder = enabled ? 'Type your guess…' : (S.isDrawing ? 'You are drawing!' : 'Waiting…');
}

// ════════════════════════════════════════════════════════
// CANVAS DRAWING
// ════════════════════════════════════════════════════════

let isMouseDown = false;
let lastX = 0, lastY = 0;

function getPos(e) {
  const rect = canvas.getBoundingClientRect();
  const sx = canvas.width / rect.width;
  const sy = canvas.height / rect.height;
  const src = e.touches ? e.touches[0] : e;
  return {
    x: Math.round((src.clientX - rect.left) * sx),
    y: Math.round((src.clientY - rect.top) * sy)
  };
}

canvas.addEventListener('mousedown',  onDrawStart);
canvas.addEventListener('mousemove',  onDrawMove);
canvas.addEventListener('mouseup',    onDrawEnd);
canvas.addEventListener('mouseleave', onDrawEnd);
canvas.addEventListener('touchstart', e => { e.preventDefault(); onDrawStart(e); }, { passive: false });
canvas.addEventListener('touchmove',  e => { e.preventDefault(); onDrawMove(e); },  { passive: false });
canvas.addEventListener('touchend',   onDrawEnd);

function onDrawStart(e) {
  if (!S.isDrawing) return;
  isMouseDown = true;
  const { x, y } = getPos(e);
  lastX = x; lastY = y;

  const c = S.tool === 'eraser' ? '#ffffff' : S.color;
  const sz = S.tool === 'eraser' ? S.size * 3.5 : S.size;

  // Draw a dot
  ctx.beginPath();
  ctx.arc(x, y, sz / 2, 0, Math.PI * 2);
  ctx.fillStyle = c;
  ctx.fill();

  const data = { type: 'start', x, y, color: c, size: sz };
  socket.emit('drawEvent', data);
}

function onDrawMove(e) {
  if (!isMouseDown || !S.isDrawing) return;
  const { x, y } = getPos(e);

  const c = S.tool === 'eraser' ? '#ffffff' : S.color;
  const sz = S.tool === 'eraser' ? S.size * 3.5 : S.size;

  drawLine(ctx, lastX, lastY, x, y, c, sz);
  socket.emit('drawEvent', { type: 'move', x, y });

  lastX = x; lastY = y;
}

function onDrawEnd() {
  if (isMouseDown) {
    socket.emit('drawEvent', { type: 'end' });
  }
  isMouseDown = false;
}

function drawLine(context, x1, y1, x2, y2, color, size) {
  context.beginPath();
  context.moveTo(x1, y1);
  context.lineTo(x2, y2);
  context.strokeStyle = color;
  context.lineWidth = size;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.stroke();
}

function clearCanvas() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function setDrawingMode(enabled) {
  S.isDrawing = enabled;
  canvas.classList.toggle('not-drawing', !enabled);
  drawTools.classList.toggle('hidden', !enabled);
  statusBar.classList.toggle('hidden', enabled);
}

// Fill canvas white on init
clearCanvas();

// ── Tool buttons ─────────────────────────────────────────

document.querySelectorAll('.clr').forEach(btn => {
  btn.addEventListener('click', () => {
    S.color = btn.dataset.c;
    S.tool = 'pen';
    document.querySelectorAll('.clr').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    btnEraser.classList.remove('active');
  });
});

customColor.addEventListener('input', () => {
  S.color = customColor.value;
  S.tool = 'pen';
  document.querySelectorAll('.clr').forEach(b => b.classList.remove('active'));
  btnEraser.classList.remove('active');
});

document.querySelectorAll('.szb').forEach(btn => {
  btn.addEventListener('click', () => {
    S.size = parseInt(btn.dataset.s);
    document.querySelectorAll('.szb').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

btnEraser.addEventListener('click', () => {
  S.tool = S.tool === 'eraser' ? 'pen' : 'eraser';
  btnEraser.classList.toggle('active', S.tool === 'eraser');
  document.querySelectorAll('.clr').forEach(b => b.classList.remove('active'));
});

btnClear.addEventListener('click', () => {
  clearCanvas();
  socket.emit('clearCanvas');
});

// ════════════════════════════════════════════════════════
// OVERLAYS
// ════════════════════════════════════════════════════════

function showWordChoice(words) {
  const cards = $('word-cards');
  cards.innerHTML = '';
  words.forEach(w => {
    const card = document.createElement('button');
    card.className = 'word-card';
    card.textContent = w;
    card.addEventListener('click', () => {
      socket.emit('selectWord', { word: w });
      hideOverlay(ovWordChoice);
      clearWcTimer();
    });
    cards.appendChild(card);
  });

  // Word choice countdown
  clearWcTimer();
  S.wcTime = 15;
  $('wc-timer').textContent = S.wcTime;
  S.wcInterval = setInterval(() => {
    S.wcTime--;
    $('wc-timer').textContent = Math.max(0, S.wcTime);
    if (S.wcTime <= 0) {
      clearWcTimer();
      hideOverlay(ovWordChoice);
    }
  }, 1000);

  showOverlay(ovWordChoice);
}

function clearWcTimer() {
  if (S.wcInterval) { clearInterval(S.wcInterval); S.wcInterval = null; }
}

function showAnnounce(drawerName, drawerId, round, total) {
  const idx = S.players.findIndex(p => p.id === drawerId);
  const color = avColor(idx >= 0 ? idx : 0);
  const letter = avLetter(drawerName);
  const isMe = drawerId === S.playerId;

  $('ann-avatar').style.background = color;
  $('ann-avatar').textContent = letter;
  $('ann-avatar').className = 'ann-avatar' + (isMe ? ' me' : '');
  $('ann-name').textContent = isMe ? 'Your turn!' : escHtml(drawerName);
  $('ann-sub').textContent = isMe
    ? 'Get ready to draw!'
    : `${escHtml(drawerName)} is drawing next!`;

  showOverlay(ovAnnounce);

  // Auto-hide after 2.5s (server sends wordChoices right after)
  setTimeout(() => hideOverlay(ovAnnounce), 2500);
}

function showTurnEnd(word, players) {
  const allGuessed = players.every(p =>
    p.id === S.currentDrawerId || S.players.find(sp => sp.id === p.id)
  );

  $('te-emoji').textContent = allGuessed ? '🎉' : '⏰';
  $('te-title').textContent = allGuessed ? 'Everyone got it!' : "Time's up!";
  $('te-word').textContent = word;

  const scoresEl = $('te-scores');
  scoresEl.innerHTML = '';
  const sorted = [...players].sort((a, b) => b.score - a.score);
  sorted.forEach(p => {
    const prev = (S.players.find(sp => sp.id === p.id) || {}).score || 0;
    const gained = p.score - prev;
    const row = document.createElement('div');
    row.className = 'te-row';
    const idx = players.findIndex(pp => pp.id === p.id);
    row.innerHTML = `
      <span>${escHtml(p.name)}</span>
      <span class="te-pts${gained <= 0 ? ' neg' : ''}">
        ${gained > 0 ? '+' + gained : ''} ${p.score} pts
      </span>
    `;
    scoresEl.appendChild(row);
  });

  // Update local player scores for diff
  S.players = players;

  showOverlay(ovTurnEnd);
  setTimeout(() => hideOverlay(ovTurnEnd), 4800);
}

function showOverlay(el) { el.classList.remove('hidden'); }
function hideOverlay(el) { el.classList.add('hidden'); }

// ════════════════════════════════════════════════════════
// GAME OVER
// ════════════════════════════════════════════════════════

function showGameOver(players) {
  showScreen('gameover');

  // Build podium (top 3)
  goPodium.innerHTML = '';
  const medals = ['🥇', '🥈', '🥉'];
  const podOrder = [1, 0, 2]; // display order: 2nd, 1st, 3rd
  podOrder.forEach(pos => {
    const p = players[pos];
    if (!p) return;
    const idx = S.players.findIndex(sp => sp.id === p.id);
    const pod = document.createElement('div');
    pod.className = 'pod-item';
    const blockClass = ['p1', 'p2', 'p3'][pos];
    pod.innerHTML = `
      <div class="pod-av" style="background:${avColor(idx >= 0 ? idx : pos)}">${avLetter(p.name)}</div>
      <div class="pod-name">${escHtml(p.name)}</div>
      <div class="pod-score">${p.score}</div>
      <div class="pod-block ${blockClass}">${medals[pos] || ''}</div>
    `;
    goPodium.appendChild(pod);
  });

  // Full list
  goList.innerHTML = '';
  players.forEach((p, i) => {
    const idx = S.players.findIndex(sp => sp.id === p.id);
    const row = document.createElement('div');
    row.className = 'go-row';
    row.innerHTML = `
      <span class="go-rank">${i + 1}</span>
      <div class="go-av" style="background:${avColor(idx >= 0 ? idx : i)}">${avLetter(p.name)}</div>
      <span class="go-name">${escHtml(p.name)}</span>
      <span class="go-pts">${p.score} pts</span>
    `;
    goList.appendChild(row);
  });
}

btnPlayAgain.addEventListener('click', () => {
  // Go back to lobby
  showScreen('lobby');
  renderLobby();
});

btnLeave.addEventListener('click', () => {
  savedRoom = null;
  window.location.href = '/';
});

// ════════════════════════════════════════════════════════
// SOCKET — INCOMING EVENTS
// ════════════════════════════════════════════════════════

socket.on('roomJoined', ({ roomId, playerId, players, isHost }) => {
  S.roomId    = roomId;
  S.playerId  = playerId;
  S.isHost    = isHost;
  S.players   = players;

  lobbyCode.textContent = roomId;
  tbCode.textContent    = roomId;
  $('tb-room-code').textContent = roomId;

  // Clear rejoin banner on successful join
  rejoinBanner.classList.add('hidden');

  // Update URL without reload (for bookmarking / sharing)
  history.replaceState(null, '', `?room=${roomId}`);

  showScreen('lobby');
  renderLobby();
});

socket.on('joinError', ({ message }) => showError(wError, message));
socket.on('gameError', ({ message }) => showError(lobbyError, message));

socket.on('playerJoined', ({ player, players }) => {
  S.players = players;
  renderLobby();
  addMsg('system alert', `${escHtml(player.name)} joined the room.`);
});

socket.on('playerLeft', ({ playerName, players }) => {
  S.players = players;
  if (Screens.lobby.classList.contains('active')) renderLobby();
  if (Screens.game.classList.contains('active'))  renderGamePlayers();
  addMsg('system', `${escHtml(playerName)} left.`);
});

socket.on('hostChanged', ({ newHostId }) => {
  S.players.forEach(p => p.isHost = p.id === newHostId);
  S.isHost = newHostId === S.playerId;
  if (Screens.lobby.classList.contains('active')) renderLobby();
  if (S.isHost) addMsg('system alert', "You are now the host.");
});

socket.on('gameStarted', ({ totalRounds }) => {
  S.totalTime = 80;
  uiTotalR.textContent = totalRounds;
  savedRoom = null; // game started — no point rejoining the old lobby
  showScreen('game');
  clearCanvas();
  // Reset chat unread on new game
  unreadCount = 0;
  chatUnread.classList.add('hidden');
  addMsg('system alert', 'Game started! Get ready…');
});

socket.on('newTurn', ({ drawerId, drawerName, round, totalRounds, players }) => {
  S.players = players;
  S.currentDrawerId = drawerId;
  S.isDrawing = false;
  S.hasGuessed = false;

  uiRound.textContent = round;
  uiTotalR.textContent = totalRounds;

  clearCanvas();
  resetTimer();
  hintDisp.innerHTML = '';
  setDrawingMode(false);
  setChatEnabled(false);
  renderGamePlayers();

  showAnnounce(drawerName, drawerId, round, totalRounds);
  statusText.textContent = `${escHtml(drawerName)} is choosing a word…`;
});

socket.on('wordChoices', ({ words }) => {
  // I am the drawer
  hideOverlay(ovAnnounce);
  showWordChoice(words);
});

socket.on('drawingStarted', ({ hint, drawerId }) => {
  S.currentDrawerId = drawerId;
  renderHint(hint);

  if (drawerId === S.playerId) {
    // I'm the drawer — tools enabled
    setDrawingMode(true);
    setChatEnabled(false);
    hideOverlay(ovWordChoice);
    clearWcTimer();
  } else {
    setDrawingMode(false);
    setChatEnabled(true);
    statusText.textContent = 'Watch and guess!';
  }
});

socket.on('yourWordIs', ({ word }) => {
  // Only the drawer gets this
  showActualWord(word);
});

socket.on('drawEvent', (data) => {
  if (data.type === 'start') {
    S.activePath = { color: data.color, size: data.size, lastX: data.x, lastY: data.y };
    ctx.beginPath();
    ctx.arc(data.x, data.y, data.size / 2, 0, Math.PI * 2);
    ctx.fillStyle = data.color;
    ctx.fill();
  } else if (data.type === 'move' && S.activePath) {
    drawLine(ctx, S.activePath.lastX, S.activePath.lastY, data.x, data.y, S.activePath.color, S.activePath.size);
    S.activePath.lastX = data.x;
    S.activePath.lastY = data.y;
  } else if (data.type === 'end') {
    S.activePath = null;
  }
});

socket.on('canvasCleared', () => clearCanvas());

socket.on('tick', ({ timeLeft }) => {
  updateTimer(timeLeft);
});

socket.on('hintUpdate', ({ hint }) => {
  renderHint(hint);
});

socket.on('correctGuess', ({ playerId, playerName, points, players }) => {
  const isMe = playerId === S.playerId;

  if (isMe) {
    S.hasGuessed = true;
    setChatEnabled(false);
    chatInp.placeholder = "You got it! 🎉 Watch the others…";
    addMsg('correct', `<span class="sender">You</span> guessed correctly! +${points} pts`);
  } else {
    addMsg('correct', `<span class="sender">${escHtml(playerName)}</span> guessed correctly! +${points} pts`);
  }

  S.players = players;
  markPlayerGuessed(playerId);
  renderGamePlayers();
});

socket.on('wrongGuess', ({ playerName, text }) => {
  addMsg('wrong', `<span class="sender">${escHtml(playerName)}:</span> ${escHtml(text)}`);
});

socket.on('turnEnded', ({ word, reason, players }) => {
  setDrawingMode(false);
  setChatEnabled(false);
  clearWcTimer();
  hideOverlay(ovWordChoice);
  hideOverlay(ovAnnounce);
  showTurnEnd(word, players);
  S.players = players;
});

socket.on('gameEnded', ({ players }) => {
  hideOverlay(ovTurnEnd);
  hideOverlay(ovWordChoice);
  setTimeout(() => showGameOver(players), 400);
});

socket.on('disconnect', () => {
  addMsg('system', '⚠ Connection lost. Trying to reconnect…');
});

socket.on('connect', () => {
  if (S.roomId) addMsg('system alert', 'Reconnected.');
});

// ════════════════════════════════════════════════════════
// UTILS
// ════════════════════════════════════════════════════════

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showError(el, msg) {
  el.textContent = msg;
  el.classList.remove('hidden');
}

function hideError(el) {
  el.classList.add('hidden');
}

// ════════════════════════════════════════════════════════
// SHARE LINK FIX
// ════════════════════════════════════════════════════════

// Detect if on localhost and fetch the LAN IP so the link works across devices
let shareBase = location.origin;

(async function resolveShareBase() {
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    try {
      const res = await fetch('/api/local-ip');
      const { ip } = await res.json();
      if (ip) shareBase = `http://${ip}:${location.port || 3000}`;
    } catch (_) {}
  }
})();

// Replace the copy link handler
btnCopy.addEventListener('click', async () => {
  const url = `${shareBase}?room=${S.roomId}`;
  const code = S.roomId;

  try {
    await navigator.clipboard.writeText(url);
    btnCopy.textContent = '✓ Copied link!';
  } catch (_) {
    // Clipboard API failed — show code prominently instead
    const old = btnCopy.textContent;
    btnCopy.textContent = `Code: ${code}`;
    setTimeout(() => btnCopy.textContent = old, 3000);
  }
  setTimeout(() => btnCopy.textContent = '📋 Copy Link', 3000);
}, true); // use capture to override the old listener

// ════════════════════════════════════════════════════════
// VOICE CHAT  (WebRTC mesh — pure peer-to-peer audio)
// ════════════════════════════════════════════════════════

const Voice = {
  joined:      false,
  muted:       false,
  stream:      null,     // local MediaStream
  peers:       {},       // peerId -> RTCPeerConnection
  audioEls:    {},       // peerId -> <audio>
  analyser:    null,
  speakTimer:  null,
  isSpeaking:  false,
};

const ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
const btnMic = $('btn-mic');
const audioContainer = $('audio-container');

btnMic.addEventListener('click', () => {
  if (!Voice.joined) {
    joinVoice();
  } else if (Voice.muted) {
    unmuteVoice();
  } else {
    muteVoice();
  }
});

async function joinVoice() {
  try {
    Voice.stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  } catch (err) {
    showMicDenied(err.name === 'NotAllowedError'
      ? 'Microphone permission denied. Allow it in browser settings.'
      : 'Could not access microphone: ' + err.message);
    return;
  }

  Voice.joined = true;
  Voice.muted  = false;
  btnMic.classList.add('connected');
  btnMic.querySelector('.mic-label').textContent = 'Mute';
  btnMic.querySelector('.mic-icon').textContent = '🎙️';

  setupSpeakDetection();
  socket.emit('voiceJoin');
  addMsg('system alert', '🎙️ You joined voice chat.');
}

function muteVoice() {
  Voice.muted = true;
  Voice.stream?.getAudioTracks().forEach(t => t.enabled = false);
  btnMic.classList.remove('connected');
  btnMic.classList.add('muted');
  btnMic.querySelector('.mic-label').textContent = 'Unmute';
  btnMic.querySelector('.mic-icon').textContent = '🔇';
}

function unmuteVoice() {
  Voice.muted = false;
  Voice.stream?.getAudioTracks().forEach(t => t.enabled = true);
  btnMic.classList.remove('muted');
  btnMic.classList.add('connected');
  btnMic.querySelector('.mic-label').textContent = 'Mute';
  btnMic.querySelector('.mic-icon').textContent = '🎙️';
}

function leaveVoice() {
  if (!Voice.joined) return;
  Voice.stream?.getTracks().forEach(t => t.stop());
  Voice.stream = null;
  Object.values(Voice.peers).forEach(pc => pc.close());
  Voice.peers = {};
  Object.values(Voice.audioEls).forEach(el => el.remove());
  Voice.audioEls = {};
  Voice.joined = false;
  Voice.muted  = false;
  socket.emit('voiceLeave');
  btnMic.classList.remove('connected', 'muted');
  btnMic.querySelector('.mic-label').textContent = 'Voice';
  btnMic.querySelector('.mic-icon').textContent = '🎙️';
}

// ── Speaking detection via AudioContext analyser ──────────

function setupSpeakDetection() {
  try {
    const ac = new AudioContext();
    const src = ac.createMediaStreamSource(Voice.stream);
    Voice.analyser = ac.createAnalyser();
    Voice.analyser.fftSize = 512;
    src.connect(Voice.analyser);

    const data = new Uint8Array(Voice.analyser.frequencyBinCount);
    function tick() {
      if (!Voice.joined) return;
      Voice.analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      const speaking = avg > 12 && !Voice.muted;

      if (speaking !== Voice.isSpeaking) {
        Voice.isSpeaking = speaking;
        socket.emit('voiceSpeaking', { speaking });
        markSpeaking(S.playerId, speaking);
      }
      requestAnimationFrame(tick);
    }
    tick();
  } catch (_) { /* AudioContext not available */ }
}

// ── Peer connection helpers ───────────────────────────────

async function createPeer(peerId, isInitiator) {
  if (Voice.peers[peerId]) { Voice.peers[peerId].close(); }

  const pc = new RTCPeerConnection(ICE);
  Voice.peers[peerId] = pc;

  // Add local tracks
  Voice.stream?.getTracks().forEach(t => pc.addTrack(t, Voice.stream));

  // Receive remote audio
  pc.ontrack = ({ streams }) => {
    let audio = Voice.audioEls[peerId];
    if (!audio) {
      audio = document.createElement('audio');
      audio.autoplay = true;
      audioContainer.appendChild(audio);
      Voice.audioEls[peerId] = audio;
    }
    audio.srcObject = streams[0];
  };

  // Trickle ICE
  pc.onicecandidate = ({ candidate }) => {
    if (candidate) socket.emit('voiceIce', { to: peerId, candidate });
  };

  pc.onconnectionstatechange = () => {
    if (['failed','disconnected','closed'].includes(pc.connectionState)) {
      removePeer(peerId);
    }
  };

  if (isInitiator) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('voiceOffer', { to: peerId, offer });
  }

  return pc;
}

function removePeer(peerId) {
  Voice.peers[peerId]?.close();
  delete Voice.peers[peerId];
  Voice.audioEls[peerId]?.remove();
  delete Voice.audioEls[peerId];
  markSpeaking(peerId, false);
}

// ── Socket signaling events ───────────────────────────────

socket.on('voiceNewPeer', async ({ peerId }) => {
  // Someone joined — they will send us an offer, we just get ready
  // (the joiner initiates to existing peers, existing peers answer)
  // Nothing to do here — wait for their offer
});

// Actually the joiner needs to know who's already in — server sends 'voiceNewPeer'
// to EXISTING peers, who should then initiate offers TO the new joiner
// Re-design: existing peers initiate to new joiner
socket.on('voiceNewPeer', async ({ peerId }) => {
  if (!Voice.joined) return;
  // I'm an existing peer — initiate offer to new joiner
  await createPeer(peerId, true);
});

socket.on('voiceOffer', async ({ from, offer }) => {
  if (!Voice.joined) return;
  const pc = await createPeer(from, false);
  await pc.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit('voiceAnswer', { to: from, answer });
});

socket.on('voiceAnswer', async ({ from, answer }) => {
  const pc = Voice.peers[from];
  if (pc) await pc.setRemoteDescription(new RTCSessionDescription(answer));
});

socket.on('voiceIce', async ({ from, candidate }) => {
  const pc = Voice.peers[from];
  if (pc) {
    try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch (_) {}
  }
});

socket.on('voicePeerLeft', ({ peerId }) => {
  removePeer(peerId);
  markSpeaking(peerId, false);
});

socket.on('voiceSpeaking', ({ peerId, speaking }) => {
  markSpeaking(peerId, speaking);
});

// ── Speaking visual ──────────────────────────────────────

function markSpeaking(playerId, speaking) {
  const idx = S.players.findIndex(p => p.id === playerId);
  if (idx < 0) return;
  const rows = gamePlayers.querySelectorAll('.gp-av');
  const av = rows[idx];
  if (av) av.classList.toggle('speaking', speaking);
}

// ── Cleanup on leave ─────────────────────────────────────
btnLeave.addEventListener('click', () => leaveVoice(), true);

// ── Error banner ─────────────────────────────────────────
function showMicDenied(msg) {
  const el = document.createElement('div');
  el.className = 'mic-denied';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}