/* ═══════════════════════════════════════════════════════
   SketchParty — app.js
═══════════════════════════════════════════════════════ */

const socket = io();

// ── State ──────────────────────────────────────────────
const S = {
  roomId: null, playerId: null, isHost: false, players: [],
  selectedRounds: 3, isDrawing: false, hasGuessed: false,
  currentDrawerId: null, tool: 'pen', color: '#1c1917', size: 8,
  totalTime: 80, activePath: null, wcInterval: null, wcTime: 15,
};

// ── Helpers ────────────────────────────────────────────
const $ = id => document.getElementById(id);
const AV_COLORS = ['#4f46e5','#7c3aed','#db2777','#e11d48','#ea580c','#d97706','#16a34a','#0891b2','#0284c7','#6366f1'];
const avColor  = i    => AV_COLORS[i % AV_COLORS.length];
const avLetter = name => (name || '?')[0].toUpperCase();
const escHtml  = s    => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const showErr  = (el, msg) => { el.textContent = msg; el.classList.remove('hidden'); };
const hideErr  = el        => el.classList.add('hidden');

// ── Screens ────────────────────────────────────────────
const Screens = {
  welcome:  $('screen-welcome'),
  lobby:    $('screen-lobby'),
  game:     $('screen-game'),
  gameover: $('screen-gameover'),
};
function showScreen(name) {
  Object.values(Screens).forEach(s => s.classList.remove('active'));
  Screens[name].classList.add('active');
}

// ── DOM refs ───────────────────────────────────────────
const inpName     = $('inp-name');
const inpCode     = $('inp-code');
const wError      = $('welcome-error');
const lobbyCode   = $('lobby-code-display');
const lobbyList   = $('lobby-player-list');
const btnCopy     = $('btn-copy-link');
const btnStart    = $('btn-start');
const startHint   = $('start-hint');
const lobbyError  = $('lobby-error');
const uiRound     = $('ui-round');
const uiTotalR    = $('ui-total-rounds');
const hintDisp    = $('hint-display');
const timerNum    = $('timer-num');
const timerCirc   = $('timer-circle');
const gamePlayers = $('game-player-list');
const canvas      = $('canvas');
const ctx         = canvas.getContext('2d');
const drawTools   = $('draw-tools');
const statusBar   = $('status-bar');
const statusText  = $('status-text');
const btnEraser   = $('btn-eraser');
const btnClear    = $('btn-clear');
const customColor = $('custom-color');
const chatFeed    = $('chat-feed');
const chatInp     = $('chat-inp');
const btnSend     = $('btn-send');
const chatPanel   = $('chat-panel');
const btnChatTog  = $('btn-chat-toggle');
const unreadBadge = $('chat-unread');
const ovWordChoice = $('ov-word-choice');
const ovAnnounce   = $('ov-announce');
const ovTurnEnd    = $('ov-turn-end');
const ovLeave      = $('ov-leave-confirm');
const goList       = $('go-list');
const goPodium     = $('go-podium');
const btnPlayAgain = $('btn-play-again');
const btnLeave     = $('btn-leave');
const btnMic       = $('btn-mic');
const audioContainer = $('audio-container');

const showOverlay = el => el.classList.remove('hidden');
const hideOverlay = el => el.classList.add('hidden');

// ════════════════════════════════════════════════════════
// CHAT
// ════════════════════════════════════════════════════════

let chatOpen = window.innerWidth >= 900;
let unreadCount = 0;
if (!chatOpen) chatPanel.classList.add('chat-hidden');

function addMsg(type, html) {
  const el = document.createElement('div');
  el.className = `chat-msg ${type}`;
  el.innerHTML = html;
  chatFeed.appendChild(el);
  chatFeed.scrollTop = chatFeed.scrollHeight;
  if (!chatOpen && !type.includes('system')) {
    unreadCount++;
    unreadBadge.textContent = unreadCount > 9 ? '9+' : unreadCount;
    unreadBadge.classList.remove('hidden');
    btnChatTog.classList.add('has-unread');
  }
}

btnChatTog.addEventListener('click', () => {
  chatOpen = !chatOpen;
  chatPanel.classList.toggle('chat-hidden', !chatOpen);
  if (chatOpen) {
    unreadCount = 0;
    unreadBadge.classList.add('hidden');
    btnChatTog.classList.remove('has-unread');
    chatFeed.scrollTop = chatFeed.scrollHeight;
  }
});

function sendGuess() {
  const text = chatInp.value.trim();
  if (!text) return;
  chatInp.value = '';
  socket.emit('guess', { text });
}
btnSend.addEventListener('click', sendGuess);
chatInp.addEventListener('keydown', e => { if (e.key === 'Enter') sendGuess(); });

function setChatEnabled(enabled) {
  chatInp.disabled = !enabled;
  btnSend.disabled = !enabled;
  chatInp.placeholder = enabled ? 'Type your guess…' : S.isDrawing ? 'You are drawing!' : 'Waiting…';
}

// ════════════════════════════════════════════════════════
// WELCOME
// ════════════════════════════════════════════════════════

// Invite via URL ?room=CODE
(function checkInvite() {
  const code = new URLSearchParams(window.location.search).get('room');
  if (code) { $('invite-banner').classList.remove('hidden'); inpCode.value = code.toUpperCase(); }
})();

// Session storage for rejoin
const SESSION_KEY = 'sketchparty_last';
const loadSession  = () => { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; } };
const saveSession  = ()  => { try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ roomId: S.roomId, name: S.players.find(p => p.id === S.playerId)?.name || inpName.value.trim() })); } catch {} };
const clearSession = ()  => { try { sessionStorage.removeItem(SESSION_KEY); } catch {} };

(function checkRejoin() {
  const saved = loadSession();
  if (!saved?.roomId || !saved?.name) return;
  $('rejoin-code-label').textContent = saved.roomId;
  $('rejoin-banner').classList.remove('hidden');
  $('btn-rejoin').addEventListener('click', () => {
    inpName.value = saved.name;
    inpCode.value = saved.roomId;
    doJoin();
  });
})();

$('btn-create').addEventListener('click', () => {
  const name = inpName.value.trim();
  if (!name) { showErr(wError, 'Enter your name first!'); return; }
  hideErr(wError);
  socket.emit('createRoom', { name });
});

$('btn-join').addEventListener('click', doJoin);
inpCode.addEventListener('keydown', e => { if (e.key === 'Enter') doJoin(); });
inpName.addEventListener('keydown', e => { if (e.key === 'Enter') $('btn-create').click(); });

function doJoin() {
  const name = inpName.value.trim();
  const code = inpCode.value.trim().toUpperCase();
  if (!name) { showErr(wError, 'Enter your name first!'); return; }
  if (!code) { showErr(wError, 'Enter a room code!'); return; }
  hideErr(wError);
  socket.emit('joinRoom', { name, roomId: code });
}

// ════════════════════════════════════════════════════════
// SHARE LINK — detect LAN IP on localhost
// ════════════════════════════════════════════════════════

let shareBase = location.origin;
(async function resolveShareBase() {
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    try {
      const { ip } = await (await fetch('/api/local-ip')).json();
      if (ip) shareBase = `http://${ip}:${location.port || 3000}`;
    } catch {}
  }
})();

btnCopy.addEventListener('click', async () => {
  const url = `${shareBase}?room=${S.roomId}`;
  try {
    await navigator.clipboard.writeText(url);
    btnCopy.textContent = '✓ Copied!';
  } catch {
    btnCopy.textContent = `Code: ${S.roomId}`;
  }
  setTimeout(() => btnCopy.textContent = '📋 Copy Link', 2500);
});

// ════════════════════════════════════════════════════════
// LOBBY
// ════════════════════════════════════════════════════════

document.querySelectorAll('.rbtn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.rbtn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    S.selectedRounds = parseInt(btn.dataset.r);
  });
});

btnStart.addEventListener('click', () => socket.emit('startGame', { totalRounds: S.selectedRounds }));

function renderLobby() {
  lobbyList.innerHTML = '';
  S.players.forEach((p, i) => {
    const el = document.createElement('div');
    el.className = 'lobby-player';
    el.innerHTML = `<div class="av" style="background:${avColor(i)}">${avLetter(p.name)}</div>
      <span>${escHtml(p.name)}</span>${p.isHost ? '<span class="crown">👑</span>' : ''}`;
    lobbyList.appendChild(el);
  });
  const canStart = S.isHost && S.players.length >= 2;
  btnStart.disabled = !canStart;
  startHint.textContent = S.isHost
    ? (S.players.length < 2 ? 'Need at least 2 players to start.' : 'Ready to go! 🎉')
    : 'Waiting for the host to start…';
}

// ════════════════════════════════════════════════════════
// LEAVE / REJOIN
// ════════════════════════════════════════════════════════

$('btn-leave-game').addEventListener('click', () => showOverlay(ovLeave));
$('btn-leave-cancel').addEventListener('click', () => hideOverlay(ovLeave));
$('btn-leave-confirm').addEventListener('click', () => { hideOverlay(ovLeave); doLeaveGame(); });

function doLeaveGame() {
  leaveVoice();
  saveSession();
  socket.disconnect();
  S.roomId = null; S.playerId = null;
  showScreen('welcome');
  socket.connect();
}

btnLeave.addEventListener('click', () => { leaveVoice(); clearSession(); window.location.href = '/'; });
btnPlayAgain.addEventListener('click', () => { showScreen('lobby'); renderLobby(); });

// ════════════════════════════════════════════════════════
// GAME — PLAYER LIST
// ════════════════════════════════════════════════════════

function renderGamePlayers() {
  gamePlayers.innerHTML = '';
  S.players.forEach((p, i) => {
    const el = document.createElement('div');
    el.className = 'gp-row' + (p.id === S.currentDrawerId ? ' drawing' : '');
    el.innerHTML = `
      <div class="gp-av" style="background:${avColor(i)}">${avLetter(p.name)}</div>
      <div class="gp-info">
        <div class="gp-name">${escHtml(p.name)}</div>
        <div class="gp-score">${p.score} pts</div>
      </div>
      ${p.id === S.currentDrawerId ? '<span class="gp-badge">✏️</span>' : ''}
      ${p.id === S.playerId ? '<span class="gp-badge" style="font-size:10px;color:var(--text-3)">you</span>' : ''}`;
    gamePlayers.appendChild(el);
  });
}

function markPlayerGuessed(playerId) {
  const rows = gamePlayers.querySelectorAll('.gp-row');
  S.players.forEach((p, i) => { if (p.id === playerId) rows[i]?.classList.add('guessed'); });
}

// ════════════════════════════════════════════════════════
// HINT DISPLAY
// ════════════════════════════════════════════════════════

function renderHint(hintStr) {
  hintDisp.innerHTML = '';
  hintStr.split(' ').forEach(ch => {
    const span = document.createElement('span');
    span.className = ch === '/' ? 'hint-char space' : ch === '_' ? 'hint-char' : 'hint-char revealed';
    if (ch !== '/' && ch !== '_') span.textContent = ch;
    hintDisp.appendChild(span);
  });
}

function showActualWord(word) {
  hintDisp.innerHTML = '';
  word.split('').forEach(ch => {
    const span = document.createElement('span');
    span.className = ch === ' ' ? 'hint-char space' : 'hint-char revealed';
    if (ch !== ' ') span.textContent = ch.toUpperCase();
    hintDisp.appendChild(span);
  });
}

// ════════════════════════════════════════════════════════
// TIMER
// ════════════════════════════════════════════════════════

const CIRC = 2 * Math.PI * 18;

function updateTimer(t) {
  timerNum.textContent = t;
  timerCirc.style.strokeDashoffset = CIRC * (1 - t / S.totalTime);
  timerCirc.style.stroke = t <= 10 ? 'var(--danger)' : t <= 25 ? 'var(--accent)' : 'var(--primary)';
  timerNum.style.color   = t <= 10 ? 'var(--danger)' : t <= 25 ? 'var(--accent)' : 'var(--text)';
}

function resetTimer() { updateTimer(S.totalTime); }

// ════════════════════════════════════════════════════════
// CANVAS
// ════════════════════════════════════════════════════════

let isMouseDown = false, lastX = 0, lastY = 0;

function getPos(e) {
  const rect = canvas.getBoundingClientRect();
  const sx = canvas.width / rect.width, sy = canvas.height / rect.height;
  const src = e.touches ? e.touches[0] : e;
  return { x: Math.round((src.clientX - rect.left) * sx), y: Math.round((src.clientY - rect.top) * sy) };
}

canvas.addEventListener('mousedown',  onDrawStart);
canvas.addEventListener('mousemove',  onDrawMove);
canvas.addEventListener('mouseup',    onDrawEnd);
canvas.addEventListener('mouseleave', onDrawEnd);
canvas.addEventListener('touchstart', e => { e.preventDefault(); onDrawStart(e); }, { passive: false });
canvas.addEventListener('touchmove',  e => { e.preventDefault(); onDrawMove(e);  }, { passive: false });
canvas.addEventListener('touchend',   onDrawEnd);

function onDrawStart(e) {
  if (!S.isDrawing) return;
  isMouseDown = true;
  const { x, y } = getPos(e);
  lastX = x; lastY = y;
  const c = S.tool === 'eraser' ? '#ffffff' : S.color;
  const sz = S.tool === 'eraser' ? S.size * 3.5 : S.size;
  ctx.beginPath(); ctx.arc(x, y, sz / 2, 0, Math.PI * 2); ctx.fillStyle = c; ctx.fill();
  socket.emit('drawEvent', { type: 'start', x, y, color: c, size: sz });
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
  if (isMouseDown) socket.emit('drawEvent', { type: 'end' });
  isMouseDown = false;
}

function drawLine(context, x1, y1, x2, y2, color, size) {
  context.beginPath(); context.moveTo(x1, y1); context.lineTo(x2, y2);
  context.strokeStyle = color; context.lineWidth = size;
  context.lineCap = 'round'; context.lineJoin = 'round'; context.stroke();
}

function clearCanvas() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
}
clearCanvas();

function setDrawingMode(enabled) {
  S.isDrawing = enabled;
  canvas.classList.toggle('not-drawing', !enabled);
  drawTools.classList.toggle('hidden', !enabled);
  statusBar.classList.toggle('hidden', enabled);
}

document.querySelectorAll('.clr').forEach(btn => {
  btn.addEventListener('click', () => {
    S.color = btn.dataset.c; S.tool = 'pen';
    document.querySelectorAll('.clr').forEach(b => b.classList.remove('active'));
    btn.classList.add('active'); btnEraser.classList.remove('active');
  });
});
customColor.addEventListener('input', () => {
  S.color = customColor.value; S.tool = 'pen';
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
btnClear.addEventListener('click', () => { clearCanvas(); socket.emit('clearCanvas'); });

// ════════════════════════════════════════════════════════
// OVERLAYS
// ════════════════════════════════════════════════════════

function showWordChoice(words) {
  const cards = $('word-cards');
  cards.innerHTML = '';
  words.forEach(w => {
    const card = document.createElement('button');
    card.className = 'word-card'; card.textContent = w;
    card.addEventListener('click', () => {
      socket.emit('selectWord', { word: w });
      hideOverlay(ovWordChoice); clearWcTimer();
    });
    cards.appendChild(card);
  });
  clearWcTimer();
  S.wcTime = 15; $('wc-timer').textContent = 15;
  S.wcInterval = setInterval(() => {
    S.wcTime--;
    $('wc-timer').textContent = Math.max(0, S.wcTime);
    if (S.wcTime <= 0) { clearWcTimer(); hideOverlay(ovWordChoice); }
  }, 1000);
  showOverlay(ovWordChoice);
}

function clearWcTimer() {
  if (S.wcInterval) { clearInterval(S.wcInterval); S.wcInterval = null; }
}

function showAnnounce(drawerName, drawerId, isMe) {
  const idx = S.players.findIndex(p => p.id === drawerId);
  $('ann-avatar').style.background = avColor(idx >= 0 ? idx : 0);
  $('ann-avatar').textContent = avLetter(drawerName);
  $('ann-avatar').className = 'ann-avatar' + (isMe ? ' me' : '');
  $('ann-name').textContent = isMe ? 'Your turn!' : escHtml(drawerName);
  $('ann-sub').textContent  = isMe ? 'Get ready to draw!' : `${escHtml(drawerName)} is drawing next!`;
  showOverlay(ovAnnounce);
  setTimeout(() => hideOverlay(ovAnnounce), 2500);
}

function showTurnEnd(word, players) {
  $('te-emoji').textContent = '⏰';
  $('te-title').textContent = "Time's up!";
  $('te-word').textContent  = word;
  const scoresEl = $('te-scores');
  scoresEl.innerHTML = '';
  [...players].sort((a, b) => b.score - a.score).forEach(p => {
    const prev   = (S.players.find(sp => sp.id === p.id) || {}).score || 0;
    const gained = p.score - prev;
    const row = document.createElement('div');
    row.className = 'te-row';
    row.innerHTML = `<span>${escHtml(p.name)}</span>
      <span class="te-pts${gained <= 0 ? ' neg' : ''}">${gained > 0 ? '+' + gained + ' ' : ''}${p.score} pts</span>`;
    scoresEl.appendChild(row);
  });
  S.players = players;
  showOverlay(ovTurnEnd);
  setTimeout(() => hideOverlay(ovTurnEnd), 4800);
}

// ════════════════════════════════════════════════════════
// GAME OVER
// ════════════════════════════════════════════════════════

function showGameOver(players) {
  showScreen('gameover');
  goPodium.innerHTML = '';
  const medals = ['🥇','🥈','🥉'];
  [1, 0, 2].forEach(pos => {
    const p = players[pos]; if (!p) return;
    const idx = S.players.findIndex(sp => sp.id === p.id);
    const pod = document.createElement('div');
    pod.className = 'pod-item';
    pod.innerHTML = `<div class="pod-av" style="background:${avColor(idx >= 0 ? idx : pos)}">${avLetter(p.name)}</div>
      <div class="pod-name">${escHtml(p.name)}</div><div class="pod-score">${p.score}</div>
      <div class="pod-block p${pos === 1 ? 1 : pos === 0 ? 2 : 3}">${medals[pos] || ''}</div>`;
    goPodium.appendChild(pod);
  });
  goList.innerHTML = '';
  players.forEach((p, i) => {
    const idx = S.players.findIndex(sp => sp.id === p.id);
    const row = document.createElement('div'); row.className = 'go-row';
    row.innerHTML = `<span class="go-rank">${i + 1}</span>
      <div class="go-av" style="background:${avColor(idx >= 0 ? idx : i)}">${avLetter(p.name)}</div>
      <span class="go-name">${escHtml(p.name)}</span><span class="go-pts">${p.score} pts</span>`;
    goList.appendChild(row);
  });
}

// ════════════════════════════════════════════════════════
// SOCKET EVENTS
// ════════════════════════════════════════════════════════

socket.on('roomJoined', ({ roomId, playerId, players, isHost, isRejoin, gameState }) => {
  S.roomId = roomId; S.playerId = playerId; S.isHost = isHost; S.players = players;
  lobbyCode.textContent = roomId;
  $('tb-room-code').textContent = roomId;
  history.replaceState(null, '', `?room=${roomId}`);
  saveSession();

  if (isRejoin && gameState) {
    S.currentDrawerId = gameState.drawerId;
    uiRound.textContent = gameState.round;
    uiTotalR.textContent = gameState.totalRounds;
    showScreen('game');
    renderGamePlayers();
    if (gameState.hint) renderHint(gameState.hint);
    if (gameState.timeLeft) updateTimer(gameState.timeLeft);
    setDrawingMode(false);
    setChatEnabled(gameState.state === 'drawing');
    addMsg('system alert', '🔄 You rejoined the game!');
  } else {
    showScreen('lobby');
    renderLobby();
  }
});

socket.on('joinError',  ({ message }) => showErr(wError, message));
socket.on('gameError',  ({ message }) => showErr(lobbyError, message));

socket.on('playerJoined', ({ player, players, isRejoin }) => {
  S.players = players;
  if (Screens.lobby.classList.contains('active')) renderLobby();
  if (Screens.game.classList.contains('active'))  renderGamePlayers();
  addMsg('system alert', isRejoin ? `🔄 ${escHtml(player.name)} rejoined!` : `${escHtml(player.name)} joined.`);
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
  if (S.isHost) addMsg('system alert', 'You are now the host.');
});

socket.on('gameStarted', ({ totalRounds }) => {
  uiTotalR.textContent = totalRounds;
  showScreen('game');
  clearCanvas();
  chatFeed.innerHTML = '';
  addMsg('system alert', 'Game started! Get ready…');
});

socket.on('newTurn', ({ drawerId, drawerName, round, totalRounds, players }) => {
  S.players = players; S.currentDrawerId = drawerId;
  S.isDrawing = false; S.hasGuessed = false;
  uiRound.textContent = round; uiTotalR.textContent = totalRounds;
  clearCanvas(); resetTimer(); hintDisp.innerHTML = '';
  setDrawingMode(false); setChatEnabled(false);
  renderGamePlayers();
  showAnnounce(drawerName, drawerId, drawerId === S.playerId);
  statusText.textContent = `${escHtml(drawerName)} is choosing a word…`;
});

socket.on('wordChoices', ({ words }) => { hideOverlay(ovAnnounce); showWordChoice(words); });

socket.on('drawingStarted', ({ hint, drawerId }) => {
  S.currentDrawerId = drawerId;
  renderHint(hint);
  if (drawerId === S.playerId) {
    setDrawingMode(true); setChatEnabled(false);
    hideOverlay(ovWordChoice); clearWcTimer();
  } else {
    setDrawingMode(false); setChatEnabled(true);
    statusText.textContent = 'Watch and guess!';
  }
});

socket.on('yourWordIs', ({ word }) => showActualWord(word));

socket.on('drawEvent', data => {
  if (data.type === 'start') {
    S.activePath = { color: data.color, size: data.size, lastX: data.x, lastY: data.y };
    ctx.beginPath(); ctx.arc(data.x, data.y, data.size / 2, 0, Math.PI * 2);
    ctx.fillStyle = data.color; ctx.fill();
  } else if (data.type === 'move' && S.activePath) {
    drawLine(ctx, S.activePath.lastX, S.activePath.lastY, data.x, data.y, S.activePath.color, S.activePath.size);
    S.activePath.lastX = data.x; S.activePath.lastY = data.y;
  } else if (data.type === 'end') {
    S.activePath = null;
  }
});

socket.on('canvasCleared', clearCanvas);
socket.on('tick',       ({ timeLeft }) => updateTimer(timeLeft));
socket.on('hintUpdate', ({ hint })     => renderHint(hint));

socket.on('correctGuess', ({ playerId, playerName, points, players }) => {
  const isMe = playerId === S.playerId;
  if (isMe) {
    S.hasGuessed = true; setChatEnabled(false);
    chatInp.placeholder = 'You got it! 🎉';
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
  setDrawingMode(false); setChatEnabled(false);
  clearWcTimer(); hideOverlay(ovWordChoice); hideOverlay(ovAnnounce);
  showTurnEnd(word, players);
});

socket.on('gameEnded', ({ players }) => {
  hideOverlay(ovTurnEnd); hideOverlay(ovWordChoice);
  setTimeout(() => showGameOver(players), 400);
});

socket.on('disconnect', () => addMsg('system', '⚠ Connection lost…'));
socket.on('connect',    () => { if (S.roomId) addMsg('system alert', 'Reconnected.'); });

// ════════════════════════════════════════════════════════
// VOICE CHAT  (WebRTC mesh)
// ════════════════════════════════════════════════════════

const Voice = {
  joined: false, muted: false, stream: null,
  peers: {}, audioEls: {}, analyser: null, isSpeaking: false,
};
const ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

btnMic.addEventListener('click', () => {
  if (!Voice.joined) joinVoice();
  else if (Voice.muted) unmuteVoice();
  else muteVoice();
});

async function joinVoice() {
  try {
    Voice.stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  } catch (err) {
    showMicDenied(err.name === 'NotAllowedError'
      ? 'Mic permission denied. Allow it in browser settings.'
      : 'Could not access microphone: ' + err.message);
    return;
  }
  Voice.joined = true; Voice.muted = false;
  setMicUI('connected');
  setupSpeakDetection();
  socket.emit('voiceJoin');
  addMsg('system alert', '🎙️ You joined voice chat.');
}

function muteVoice() {
  Voice.muted = true;
  Voice.stream?.getAudioTracks().forEach(t => t.enabled = false);
  setMicUI('muted');
}

function unmuteVoice() {
  Voice.muted = false;
  Voice.stream?.getAudioTracks().forEach(t => t.enabled = true);
  setMicUI('connected');
}

function leaveVoice() {
  if (!Voice.joined) return;
  Voice.stream?.getTracks().forEach(t => t.stop());
  Voice.stream = null;
  Object.values(Voice.peers).forEach(pc => pc.close());
  Voice.peers = {};
  Object.values(Voice.audioEls).forEach(el => el.remove());
  Voice.audioEls = {};
  Voice.joined = false; Voice.muted = false;
  socket.emit('voiceLeave');
  setMicUI('off');
}

function setMicUI(state) {
  btnMic.classList.remove('connected', 'muted');
  const icon  = btnMic.querySelector('.mic-icon');
  const label = btnMic.querySelector('.mic-label');
  if (state === 'connected') { btnMic.classList.add('connected'); icon.textContent = '🎙️'; label.textContent = 'Mute'; }
  else if (state === 'muted') { btnMic.classList.add('muted');    icon.textContent = '🔇'; label.textContent = 'Unmute'; }
  else                        {                                    icon.textContent = '🎙️'; label.textContent = 'Voice'; }
}

function setupSpeakDetection() {
  try {
    const ac = new AudioContext();
    const src = ac.createMediaStreamSource(Voice.stream);
    Voice.analyser = ac.createAnalyser();
    Voice.analyser.fftSize = 512;
    src.connect(Voice.analyser);
    const data = new Uint8Array(Voice.analyser.frequencyBinCount);
    (function tick() {
      if (!Voice.joined) return;
      Voice.analyser.getByteFrequencyData(data);
      const speaking = (data.reduce((a, b) => a + b, 0) / data.length) > 12 && !Voice.muted;
      if (speaking !== Voice.isSpeaking) {
        Voice.isSpeaking = speaking;
        socket.emit('voiceSpeaking', { speaking });
        markSpeaking(S.playerId, speaking);
      }
      requestAnimationFrame(tick);
    })();
  } catch {}
}

async function createPeer(peerId, isInitiator) {
  Voice.peers[peerId]?.close();
  const pc = new RTCPeerConnection(ICE);
  Voice.peers[peerId] = pc;
  Voice.stream?.getTracks().forEach(t => pc.addTrack(t, Voice.stream));
  pc.ontrack = ({ streams }) => {
    if (!Voice.audioEls[peerId]) {
      const audio = document.createElement('audio');
      audio.autoplay = true;
      audioContainer.appendChild(audio);
      Voice.audioEls[peerId] = audio;
    }
    Voice.audioEls[peerId].srcObject = streams[0];
  };
  pc.onicecandidate = ({ candidate }) => {
    if (candidate) socket.emit('voiceIce', { to: peerId, candidate });
  };
  pc.onconnectionstatechange = () => {
    if (['failed','disconnected','closed'].includes(pc.connectionState)) removePeer(peerId);
  };
  if (isInitiator) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('voiceOffer', { to: peerId, offer });
  }
  return pc;
}

function removePeer(peerId) {
  Voice.peers[peerId]?.close(); delete Voice.peers[peerId];
  Voice.audioEls[peerId]?.remove(); delete Voice.audioEls[peerId];
  markSpeaking(peerId, false);
}

function markSpeaking(playerId, speaking) {
  const idx = S.players.findIndex(p => p.id === playerId);
  if (idx < 0) return;
  gamePlayers.querySelectorAll('.gp-av')[idx]?.classList.toggle('speaking', speaking);
}

socket.on('voiceNewPeer', async ({ peerId }) => {
  if (!Voice.joined) return;
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
  if (pc) try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch {}
});

socket.on('voicePeerLeft',  ({ peerId })           => removePeer(peerId));
socket.on('voiceSpeaking',  ({ peerId, speaking }) => markSpeaking(peerId, speaking));

function showMicDenied(msg) {
  const el = document.createElement('div');
  el.className = 'mic-denied'; el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}
