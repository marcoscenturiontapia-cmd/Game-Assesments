'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = Number(process.env.PORT || 8080);
const DECISION_SECONDS = 60;
const EVENTS = JSON.parse(fs.readFileSync(path.join(__dirname, 'events.json'), 'utf8'));
const ROLE_NAMES = ['Capitán', 'Navegante', 'Velas', 'Mantenimiento', 'Recursos', 'Vigía'];
const DEMO_EMAIL = 'game@mail.com';
const DEMO_PASSWORD = '123456';
const rooms = new Map();

const freshGame = () => ({ p: 0, h: 100, r: 100, c: 65, coins: 0, assess: [0, 0, 0, 0, 0, 0], counts: [0, 0, 0, 0, 0, 0], log: [] });
const clamp = value => Math.max(0, Math.min(100, value));
const safeText = (value, fallback, max = 32) => {
  const clean = String(value || '').replace(/[<>]/g, '').trim().slice(0, max);
  return clean || fallback;
};
const shuffle = values => values.map(value => ({ value, sort: Math.random() })).sort((a, b) => a.sort - b.sort).map(item => item.value);
const makeRoomCode = () => {
  let id;
  do id = `VELERO${Math.random().toString(36).slice(2, 6).toUpperCase()}`; while (rooms.has(id));
  return id;
};

function send(ws, payload) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}
function error(ws, message) { send(ws, { type: 'error', message }); }
function roomPlayers(room) { return room.players.filter(Boolean); }
function publicPlayer(player) {
  if (!player) return null;
  return { id: player.id, name: player.name, avatar: player.avatar, role: player.role, online: player.ws && player.ws.readyState === WebSocket.OPEN, answered: player.answered, timedOut: player.timedOut };
}
function publicState(room) {
  return {
    type: 'state',
    game: room.game,
    index: room.index,
    ended: room.ended,
    feedback: room.feedback,
    decisionDeadline: room.decisionDeadline,
    decisionSeconds: DECISION_SECONDS,
    connected: roomPlayers(room).filter(player => player.ws && player.ws.readyState === WebSocket.OPEN).length,
    players: room.players.length,
    allJoined: roomPlayers(room).length === room.players.length,
    roster: room.players.filter(Boolean).map(publicPlayer)
  };
}
function announce(room) { for (const player of roomPlayers(room)) if (player.ws) send(player.ws, publicState(room)); }
function clearRoomTimer(room) { if (room.advanceTimer) clearTimeout(room.advanceTimer); room.advanceTimer = null; }
function closeRoom(room) { clearRoomTimer(room); rooms.delete(room.id); }
function validateLogin(ws, message) {
  if (message.email !== DEMO_EMAIL || message.password !== DEMO_PASSWORD) {
    error(ws, 'Usuario o contraseña incorrectos. Usa el acceso demo indicado.');
    return false;
  }
  ws.auth = { email: DEMO_EMAIL };
  send(ws, { type: 'authenticated' });
  return true;
}
function requireAuth(ws) {
  if (!ws.auth) { error(ws, 'Primero debes iniciar sesión.'); return false; }
  return true;
}
function assignRole(room) {
  const used = new Set(room.players.filter(Boolean).map(player => player.role));
  const available = ROLE_NAMES.map((_, index) => index).filter(index => !used.has(index));
  return shuffle(available)[0];
}
function startDecisionTimer(room) {
  clearRoomTimer(room);
  room.decisionDeadline = Date.now() + DECISION_SECONDS * 1000;
  for (const player of room.players) if (player) { player.answered = false; player.timedOut = false; }
  announce(room);
  room.advanceTimer = setTimeout(() => timeoutDecision(room), DECISION_SECONDS * 1000);
}
function applyChoice(room, player, choice, timedOut = false) {
  const event = EVENTS[room.index];
  if (!event || player.answered) return;
  player.answered = true;
  player.timedOut = timedOut;
  if (!timedOut) {
    const option = event.choices[choice];
    const values = option[2];
    for (const key of ['p', 'h', 'r', 'c']) room.game[key] = clamp(room.game[key] + (values[key] || 0));
    room.game.coins += values.coins || 0;
    room.game.assess[event.role] += option[1];
    room.game.counts[event.role]++;
    room.game.log.push({ role: ROLE_NAMES[event.role], player: player.name, choice: option[0], effect: option[3] });
    room.feedback = `${player.name} respondió: ${option[3]}`;
  } else {
    room.game.log.push({ role: ROLE_NAMES[event.role], player: player.name, choice: 'Sin respuesta dentro de 60 segundos', effect: 'La decisión queda como no contestada y la tripulación continúa.' });
    room.feedback = `${player.name} no respondió a tiempo. La partida continúa.`;
  }
}
function finishOrAdvance(room) {
  const event = EVENTS[room.index];
  const decisionMaker = event && room.players.find(player => player && player.role === event.role);
  if (!decisionMaker || !decisionMaker.answered) return announce(room);
  clearRoomTimer(room);
  if (room.game.h <= 0 || room.game.r <= 0) {
    room.ended = true;
    room.index = EVENTS.length;
    room.decisionDeadline = null;
    return announce(room);
  }
  room.advanceTimer = setTimeout(() => {
    room.index++;
    room.feedback = '';
    if (room.index >= EVENTS.length) { room.ended = true; room.decisionDeadline = null; announce(room); return; }
    startDecisionTimer(room);
  }, 2200);
  announce(room);
}
function timeoutDecision(room) {
  if (room.ended || room.index >= EVENTS.length) return;
  const event = EVENTS[room.index];
  const decisionMaker = room.players.find(player => player && player.role === event.role);
  if (decisionMaker && !decisionMaker.answered) applyChoice(room, decisionMaker, 0, true);
  finishOrAdvance(room);
}
function choose(room, ws, choice) {
  if (room.ended) return error(ws, 'La misión ya terminó.');
  if (!room.players.every(Boolean)) return error(ws, 'La sala todavía no tiene a los seis roles.');
  const player = room.players.find(item => item && item.ws === ws);
  const event = EVENTS[room.index];
  if (!player || player.role !== event.role) return error(ws, 'Este evento corresponde a otro rol.');
  if (!Number.isInteger(choice) || choice < 0 || choice >= event.choices.length) return error(ws, 'Decisión inválida.');
  if (Date.now() >= room.decisionDeadline) return error(ws, 'El tiempo de esta decisión terminó.');
  applyChoice(room, player, choice);
  finishOrAdvance(room);
}
function joinRoom(ws, message, create) {
  const requested = safeText(message.room, '', 16).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const id = create ? (requested || makeRoomCode()) : requested;
  const room = create ? null : rooms.get(id);
  if (!create && !room) return error(ws, 'No existe una sala con ese código.');
  if (!create && room.ended) return error(ws, 'La misión ya terminó.');
  if (create && rooms.has(id)) return error(ws, 'Ese código ya existe.');
  const target = create ? { id, players: Array(6).fill(null), game: freshGame(), index: 0, ended: false, feedback: '', decisionDeadline: null, advanceTimer: null } : room;
  if (!create && target.players.filter(Boolean).length >= 6) return error(ws, 'La sala está completa.');
  const role = assignRole(target);
  const player = { id: crypto.randomUUID(), name: safeText(message.name, 'Jugador'), avatar: safeText(message.avatar, '🚤', 200), role, ws, answered: false, timedOut: false };
  const slot = target.players.findIndex(item => !item);
  target.players[slot] = player;
  if (create) rooms.set(id, target);
  ws.room = target;
  ws.player = player;
  send(ws, { type: 'welcome', room: target.id, role, playerId: player.id, roleName: ROLE_NAMES[role] });
  announce(target);
  if (target.players.every(Boolean) && target.index === 0 && !target.decisionDeadline) startDecisionTimer(target);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return fs.createReadStream(path.join(__dirname, 'index.html')).pipe(res);
  }
  if (url.pathname === '/events.json') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify(EVENTS));
  }
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
  }
  res.writeHead(404); res.end('Not found');
});

const wss = new WebSocketServer({ server, maxPayload: 16 * 1024 });
wss.on('connection', ws => {
  ws.on('message', buffer => {
    let message;
    try { message = JSON.parse(buffer.toString()); } catch { return error(ws, 'Mensaje inválido.'); }
    if (!message || typeof message.type !== 'string') return error(ws, 'Solicitud inválida.');
    if (message.type === 'login') return validateLogin(ws, message);
    if (!requireAuth(ws)) return;
    if (message.type === 'create') return joinRoom(ws, message, true);
    if (message.type === 'join') return joinRoom(ws, message, false);
    if (message.type === 'choose') return ws.room ? choose(ws.room, ws, message.choice) : error(ws, 'No estás en una sala.');
    return error(ws, 'Acción no reconocida.');
  });
  ws.on('close', () => {
    const room = ws.room;
    const player = ws.player;
    if (!room || !player) return;
    player.ws = null;
    if (!room.decisionDeadline && !room.ended) {
      const slot = room.players.indexOf(player);
      if (slot >= 0) room.players[slot] = null;
    }
    announce(room);
  });
});

server.listen(PORT, '0.0.0.0', () => console.log(`Misión a Puerto: http://localhost:${PORT}`));
