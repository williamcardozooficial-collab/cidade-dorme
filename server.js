require('dotenv').config();
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);
const rooms = {};
const gameTimers = {};
const MAX_PLAYERS = 50;
const DECISAO_SEGUNDOS = 30; // segundos para jogador decidir jogar novamente ou sair

function generateCode() {
const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
let c = '';
for (let i = 0; i < 6; i++) c += chars[Math.floor(Math.random() * chars.length)];
return c;
}

const FAKE_PLAYERS = [
{ id: 'fake_1', name: 'Ana Silva', photo: 'https://i.pravatar.cc/80?img=1', isHost: false },
{ id: 'fake_2', name: 'Bruno Costa', photo: 'https://i.pravatar.cc/80?img=3', isHost: false },
{ id: 'fake_3', name: 'Carla Mendes', photo: 'https://i.pravatar.cc/80?img=5', isHost: false },
{ id: 'fake_4', name: 'Diego Lima', photo: 'https://i.pravatar.cc/80?img=7', isHost: false },
{ id: 'fake_5', name: 'Eduarda Rocha', photo: 'https://i.pravatar.cc/80?img=9', isHost: false },
{ id: 'fake_6', name: 'Felipe Nunes', photo: 'https://i.pravatar.cc/80?img=11', isHost: false },
];

function apenasJogadoresFicticios(room) {
return room.players.filter(p => !p.id.startsWith('fake_')).length === 0;
}

function fecharSala(roomCode, motivo) {
const room = rooms[roomCode];
if (!room) return;
clearTimeout(gameTimers[roomCode]);
clearTimeout(gameTimers[roomCode + '_vote']);
clearTimeout(gameTimers[roomCode + '_decisao']);
io.to(roomCode).emit('sala-fechada', { motivo: motivo || 'Sala encerrada.' });
delete rooms[roomCode];
}

function addFeed(room, msg, tipo) {
if (!room.feed) room.feed = [];
room.feed.unshift({ msg, tipo, ts: Date.now() });
if (room.feed.length > 5) room.feed.length = 5;
io.to(room.code).emit('feed-update', room.feed);
}

function emitSpectatorCount(roomCode) {
const room = rooms[roomCode];
if (!room) return;
io.to(roomCode).emit('spectator-count', { count: room.spectators || 0 });
}

// Apos fim de jogo: inicia fase de decisao (30s para jogar novamente ou sair)
function iniciarFaseDecisao(roomCode, resultadoFinal) {
const room = rooms[roomCode];
if (!room) return;
clearTimeout(gameTimers[roomCode + '_decisao']);

// Marca todos os jogadores reais como "aguardando decisao"
room.aguardandoDecisao = new Set(
room.players.filter(p => !p.id.startsWith('fake_')).map(p => p.id)
);
room.querJogarNovamente = new Set();
room.status = 'ended';

// Emite o evento de fim de jogo com a fase de decisao
io.to(roomCode).emit('fim-de-jogo', {
...resultadoFinal,
segundosDecisao: DECISAO_SEGUNDOS
});

// Apos 30s, remove quem nao decidiu e reseta para waiting
gameTimers[roomCode + '_decisao'] = setTimeout(() => {
const r = rooms[roomCode];
if (!r || r.status !== 'ended') return;

// Remove jogadores que nao clicaram em nada (forcado = sair)
const removidos = [];
r.aguardandoDecisao.forEach(userId => {
if (!r.querJogarNovamente.has(userId)) {
removidos.push(userId);
r.players = r.players.filter(p => p.id !== userId);
}
});

// Emite para quem saiu
removidos.forEach(userId => {
io.to(roomCode).emit('jogador-saiu-pos-jogo', { userId });
});

// Limpa sets de decisao
delete r.aguardandoDecisao;
delete r.querJogarNovamente;

// Verifica se so ficticios sobraram
if (apenasJogadoresFicticios(r)) {
fecharSala(roomCode, 'Todos os jogadores saíram. Sala encerrada.');
return;
}

// Reseta sala para waiting - novo jogo pode comecar
r.status = 'waiting';
r.mortos = [];
r.votos = {};
r.votanteAtual = null;
r.assassino = null;
r.vitima = null;
r.feed = [];
r.rodada = 1;

// Garante que tem um host real
if (!r.players.find(p => p.id === r.host)) {
const novoHost = r.players.find(p => !p.id.startsWith('fake_')) || r.players[0];
if (novoHost) { r.host = novoHost.id; r.players.forEach(p => { p.isHost = p.id === novoHost.id; }); }
}

addFeed(r, '🔄 Nova partida disponível! Aguardando host iniciar.', 'sistema');
io.to(roomCode).emit('sala-pronta', { room: r });
}, DECISAO_SEGUNDOS * 1000);
}

function iniciarNovaRodada(roomCode) {
const room = rooms[roomCode];
if (!room) return;
if (apenasJogadoresFicticios(room)) {
fecharSala(roomCode, 'Todos os jogadores reais saíram. Sala encerrada.');
return;
}
const vivos = room.players.filter(p => !room.mortos.includes(p.id));
const vivosReais = vivos.filter(p => !p.id.startsWith('fake_'));
if (vivosReais.length === 0) {
fecharSala(roomCode, 'Todos os jogadores reais foram eliminados. Sala encerrada.');
return;
}
if (vivos.length <= 2) {
const cidadao = vivos.find(p => p.id !== room.assassino);
const assassinoPlayer = vivos.find(p => p.id === room.assassino);
if (cidadao && assassinoPlayer) {
addFeed(room, cidadao.name + ' era um CIDADAO inocente.', 'cidadao');
iniciarFaseDecisao(roomCode, {
tipo: 'reveal',
cidadao: { id: cidadao.id, name: cidadao.name, photo: cidadao.photo },
assassino: { id: assassinoPlayer.id, name: assassinoPlayer.name, photo: assassinoPlayer.photo },
vencedor: 'assassino', mortos: room.mortos
});
} else {
iniciarFaseDecisao(roomCode, { tipo: 'over', vencedor: 'assassino', mortos: room.mortos });
}
return;
}
if (room.mortos.includes(room.assassino)) {
room.assassino = vivos[Math.floor(Math.random() * vivos.length)].id;
}
room.status = 'night'; room.vitima = null; room.votos = {}; room.votanteAtual = null;
room.rodada = (room.rodada || 1) + 1;
const vitimas = vivos.filter(p => p.id !== room.assassino).map(p => ({ id: p.id, name: p.name, photo: p.photo }));
io.to(roomCode).emit('game-night', { assassinoId: room.assassino, vitimas, segundos: 30, rodada: room.rodada, feed: room.feed || [] });
if (gameTimers[roomCode]) clearTimeout(gameTimers[roomCode]);
gameTimers[roomCode] = setTimeout(() => {
const r = rooms[roomCode];
if (!r || r.status !== 'night') return;
if (!r.vitima) {
const possiveis = vivos.filter(p => p.id !== r.assassino);
const escolhida = possiveis[Math.floor(Math.random() * possiveis.length)];
r.vitima = escolhida.id; r.mortos.push(escolhida.id);
addFeed(r, '🔪 Assassino matou ' + escolhida.name, 'kill');
io.to(roomCode).emit('kill-result', { vitima: escolhida, forcado: true, assassinoId: r.assassino });
}
r.status = 'result';
setTimeout(() => iniciarVotacao(roomCode), 5000);
}, 30000);
}

function iniciarVotacao(roomCode) {
const room = rooms[roomCode];
if (!room) return;
if (apenasJogadoresFicticios(room)) {
fecharSala(roomCode, 'Todos os jogadores reais saíram. Sala encerrada.');
return;
}
const vivos = room.players.filter(p => !room.mortos.includes(p.id));
if (vivos.length === 0) return;
room.status = 'voting'; room.votos = {};
room.votacaoFila = vivos.map(p => p.id); room.votacaoIndex = 0;
iniciarTurnoVotacao(roomCode);
}

function iniciarTurnoVotacao(roomCode) {
const room = rooms[roomCode];
if (!room || room.status !== 'voting') return;
if (apenasJogadoresFicticios(room)) {
fecharSala(roomCode, 'Todos os jogadores reais saíram. Sala encerrada.');
return;
}
const idx = room.votacaoIndex;
if (idx >= room.votacaoFila.length) { finalizarVotacao(roomCode); return; }
const votanteId = room.votacaoFila[idx];
const votante = room.players.find(p => p.id === votanteId);
const vivos = room.players.filter(p => !room.mortos.includes(p.id));
const alvos = vivos.filter(p => p.id !== votanteId).map(p => ({ id: p.id, name: p.name, photo: p.photo }));
room.votanteAtual = votanteId;
io.to(roomCode).emit('vote-turn', {
votante: { id: votante.id, name: votante.name, photo: votante.photo },
alvos, segundos: 60, totalVotantes: room.votacaoFila.length, turnoAtual: idx + 1,
feed: room.feed || []
});
if (gameTimers[roomCode + '_vote']) clearTimeout(gameTimers[roomCode + '_vote']);
const isFake = votanteId.startsWith('fake_');
const delay = isFake ? 10000 : 60000;
gameTimers[roomCode + '_vote'] = setTimeout(() => {
const r = rooms[roomCode];
if (!r || r.status !== 'voting' || r.votanteAtual !== votanteId) return;
if (!r.votos[votanteId] && alvos.length > 0) {
const alvo = alvos[Math.floor(Math.random() * alvos.length)];
r.votos[votanteId] = alvo.id;
io.to(roomCode).emit('vote-cast', { votanteId, alvoId: alvo.id, forcado: true });
}
r.votacaoIndex++; iniciarTurnoVotacao(roomCode);
}, delay);
}

function finalizarVotacao(roomCode) {
const room = rooms[roomCode];
if (!room) return;
if (gameTimers[roomCode + '_vote']) clearTimeout(gameTimers[roomCode + '_vote']);
if (apenasJogadoresFicticios(room)) {
fecharSala(roomCode, 'Todos os jogadores reais saíram. Sala encerrada.');
return;
}
const contagem = {};
Object.values(room.votos).forEach(alvoId => { contagem[alvoId] = (contagem[alvoId] || 0) + 1; });
if (Object.keys(contagem).length === 0) {
addFeed(room, '🤝 Votacao sem votos — empate!', 'empate');
io.to(roomCode).emit('vote-result', { empate: true, eliminado: null, era_assassino: false, votos: {}, feed: room.feed || [] });
setTimeout(() => iniciarNovaRodada(roomCode), 5000); return;
}
const maxVotos = Math.max(...Object.values(contagem));
const maisVotados = Object.keys(contagem).filter(id => contagem[id] === maxVotos);
if (maisVotados.length > 1) {
addFeed(room, '🤝 Empate na votacao — ninguem eliminado', 'empate');
io.to(roomCode).emit('vote-result', { empate: true, eliminado: null, era_assassino: false, votos: contagem, feed: room.feed || [] });
setTimeout(() => iniciarNovaRodada(roomCode), 5000); return;
}
const eliminadoId = maisVotados[0];
const eliminado = room.players.find(p => p.id === eliminadoId);
const eraAssassino = eliminadoId === room.assassino;
room.mortos.push(eliminadoId);
const feedMsg = eraAssassino ? '⚖️ ' + eliminado.name + ' foi eliminado — ERA O ASSASSINO!' : '⚖️ ' + eliminado.name + ' foi eliminado — era cidadao';
addFeed(room, feedMsg, eraAssassino ? 'assassino-eliminado' : 'cidadao-eliminado');
io.to(roomCode).emit('vote-result', { empate: false, eliminado: { id: eliminado.id, name: eliminado.name, photo: eliminado.photo }, era_assassino: eraAssassino, votos: contagem, feed: room.feed || [] });
if (eraAssassino) {
setTimeout(() => {
iniciarFaseDecisao(roomCode, { tipo: 'over', vencedor: 'cidade', mortos: room.mortos });
}, 5000);
} else {
setTimeout(() => iniciarNovaRodada(roomCode), 5000);
}
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({ secret: process.env.SESSION_SECRET || 'cidade-dorme-secret', resave: false, saveUninitialized: false }));
app.use(passport.initialize());
app.use(passport.session());
passport.use(new GoogleStrategy({ clientID: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET, callbackURL: process.env.CALLBACK_URL || '/auth/google/callback' }, (at, rt, profile, done) => done(null, profile)));
passport.serializeUser((u, done) => done(null, u));
passport.deserializeUser((u, done) => done(null, u));
app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
app.get('/auth/google/callback', passport.authenticate('google', { failureRedirect: '/' }), (req, res) => res.redirect('/'));
app.get('/auth/logout', (req, res) => { req.logout(() => res.redirect('/')); });
app.get('/api/me', (req, res) => { if (req.isAuthenticated()) res.json({ user: req.user }); else res.json({ user: null }); });
app.get('/api/rooms', (req, res) => {
const list = Object.values(rooms).map(r => ({ code: r.code, players: r.players.length, spectators: r.spectators || 0, status: r.status, minPlayers: r.minPlayers, host: (r.players.find(p => p.isHost) || {}).name || 'Host' }));
res.json({ rooms: list });
});
// Verificar se usuario ainda esta em alguma sala (para reentrada)
app.get('/api/minha-sala', (req, res) => {
if (!req.isAuthenticated()) return res.json({ room: null });
const userId = req.user.id;
const room = Object.values(rooms).find(r => r.players.some(p => p.id === userId));
res.json({ room: room || null });
});
app.post('/api/rooms', (req, res) => {
if (!req.isAuthenticated()) return res.status(401).json({ error: 'Nao autenticado' });
let code; do { code = generateCode(); } while (rooms[code]);
const userId = req.user.id; const userName = req.user.displayName || 'Jogador';
const userPhoto = (req.user.photos && req.user.photos[0]) ? req.user.photos[0].value : '';
rooms[code] = { code, host: userId, minPlayers: 5, players: [{ id: userId, name: userName, photo: userPhoto, isHost: true }], spectators: 0, status: 'waiting', createdAt: Date.now(), assassino: null, vitima: null, mortos: [], votos: {}, votanteAtual: null, rodada: 1, feed: [] };
res.json({ room: rooms[code] });
});
app.post('/api/rooms/:code/add-fake-players', (req, res) => {
if (!req.isAuthenticated()) return res.status(401).json({ error: 'Nao autenticado' });
const room = rooms[req.params.code.toUpperCase()];
if (!room) return res.status(404).json({ error: 'Sala nao encontrada' });
if (room.status !== 'waiting') return res.status(400).json({ error: 'Sala ja iniciada' });
for (const fp of FAKE_PLAYERS) { if (!room.players.find(p => p.id === fp.id)) room.players.push({ ...fp }); }
io.to(req.params.code.toUpperCase()).emit('room-update', room); res.json({ room });
});
app.get('/api/rooms/:code', (req, res) => { const room = rooms[req.params.code.toUpperCase()]; if (!room) return res.status(404).json({ error: 'Sala nao encontrada' }); res.json({ room }); });
app.post('/api/rooms/:code/join', (req, res) => {
if (!req.isAuthenticated()) return res.status(401).json({ error: 'Nao autenticado' });
const room = rooms[req.params.code.toUpperCase()];
if (!room) return res.status(404).json({ error: 'Sala nao encontrada' });
const userId = req.user.id;
// Reentrada: jogador ja estava na sala
if (room.players.find(p => p.id === userId)) {
return res.json({ room, asSpectator: false, reentrada: true });
}
if (room.status !== 'waiting' || room.players.length >= MAX_PLAYERS) {
return res.json({ room, asSpectator: true });
}
room.players.push({ id: userId, name: req.user.displayName || 'Jogador', photo: (req.user.photos && req.user.photos[0]) ? req.user.photos[0].value : '', isHost: false });
io.to(req.params.code.toUpperCase()).emit('room-update', room);
res.json({ room, asSpectator: false });
});
// Jogador confirma que quer jogar novamente
app.post('/api/rooms/:code/jogar-novamente', (req, res) => {
if (!req.isAuthenticated()) return res.status(401).json({ error: 'Nao autenticado' });
const room = rooms[req.params.code.toUpperCase()];
if (!room || room.status !== 'ended') return res.status(400).json({ error: 'Sala nao esta em fase de decisao' });
const userId = req.user.id;
if (room.aguardandoDecisao && room.aguardandoDecisao.has(userId)) {
room.aguardandoDecisao.delete(userId);
room.querJogarNovamente = room.querJogarNovamente || new Set();
room.querJogarNovamente.add(userId);
}
res.json({ ok: true });
});
// Jogador confirma que quer sair apos jogo
app.post('/api/rooms/:code/sair-pos-jogo', (req, res) => {
if (!req.isAuthenticated()) return res.status(401).json({ error: 'Nao autenticado' });
const room = rooms[req.params.code.toUpperCase()];
if (!room) return res.json({ ok: true });
const userId = req.user.id;
if (room.aguardandoDecisao) room.aguardandoDecisao.delete(userId);
if (room.querJogarNovamente) room.querJogarNovamente.delete(userId);
room.players = room.players.filter(p => p.id !== userId);
if (apenasJogadoresFicticios(room)) {
fecharSala(req.params.code.toUpperCase(), 'Todos os jogadores saíram. Sala encerrada.');
} else {
if (room.host === userId && room.players.length > 0) {
const novoHost = room.players.find(p => !p.id.startsWith('fake_')) || room.players[0];
if (novoHost) { room.host = novoHost.id; novoHost.isHost = true; }
}
io.to(req.params.code.toUpperCase()).emit('room-update', room);
}
res.json({ ok: true });
});
// Espectador vira jogador apos fim de jogo
app.post('/api/rooms/:code/virar-jogador', (req, res) => {
if (!req.isAuthenticated()) return res.status(401).json({ error: 'Nao autenticado' });
const room = rooms[req.params.code.toUpperCase()];
if (!room) return res.status(404).json({ error: 'Sala nao encontrada' });
if (room.status !== 'ended' && room.status !== 'waiting') return res.status(400).json({ error: 'Nao e possivel agora' });
if (room.players.length >= MAX_PLAYERS) return res.status(400).json({ error: 'Sala cheia' });
const userId = req.user.id;
if (!room.players.find(p => p.id === userId)) {
room.players.push({ id: userId, name: req.user.displayName || 'Jogador', photo: (req.user.photos && req.user.photos[0]) ? req.user.photos[0].value : '', isHost: false });
if (room.querJogarNovamente) room.querJogarNovamente.add(userId);
if (room.aguardandoDecisao) room.aguardandoDecisao.delete(userId);
io.to(req.params.code.toUpperCase()).emit('room-update', room);
}
res.json({ ok: true, room });
});
app.delete('/api/rooms/:code/leave', (req, res) => {
if (!req.isAuthenticated()) return res.status(401).json({ error: 'Nao autenticado' });
const room = rooms[req.params.code.toUpperCase()];
if (!room) return res.status(404).json({ error: 'Sala nao encontrada' });
const userId = req.user.id;
room.players = room.players.filter(p => p.id !== userId);
if (apenasJogadoresFicticios(room)) {
fecharSala(req.params.code.toUpperCase(), 'Todos os jogadores reais saíram. Sala encerrada.');
return res.json({ ok: true });
}
if (room.players.length === 0 && room.status === 'waiting') {
clearTimeout(gameTimers[req.params.code.toUpperCase()]);
delete rooms[req.params.code.toUpperCase()];
} else {
if (room.host === userId && room.players.length > 0) {
const novoHost = room.players.find(p => !p.id.startsWith('fake_')) || room.players[0];
room.host = novoHost.id; novoHost.isHost = true;
}
io.to(req.params.code.toUpperCase()).emit('room-update', room);
}
res.json({ ok: true });
});
app.post('/api/rooms/:code/start', (req, res) => {
if (!req.isAuthenticated()) return res.status(401).json({ error: 'Nao autenticado' });
const room = rooms[req.params.code.toUpperCase()];
if (!room) return res.status(404).json({ error: 'Sala nao encontrada' });
if (room.host !== req.user.id) return res.status(403).json({ error: 'Apenas o host pode iniciar' });
if (room.players.length < room.minPlayers) return res.status(400).json({ error: 'Jogadores insuficientes' });
if (room.status !== 'waiting') return res.status(400).json({ error: 'Jogo ja iniciado' });
room.status = 'night'; room.mortos = []; room.votos = {}; room.votanteAtual = null; room.rodada = 1; room.feed = [];
const idx = Math.floor(Math.random() * room.players.length);
const assassino = room.players[idx]; room.assassino = assassino.id; room.vitima = null;
addFeed(room, '🌙 Jogo iniciado! Rodada 1', 'sistema');
const vitimas = room.players.filter(p => p.id !== assassino.id).map(p => ({ id: p.id, name: p.name, photo: p.photo }));
io.to(req.params.code.toUpperCase()).emit('game-night', { assassinoId: assassino.id, vitimas, segundos: 30, rodada: 1, feed: room.feed });
if (gameTimers[req.params.code.toUpperCase()]) clearTimeout(gameTimers[req.params.code.toUpperCase()]);
gameTimers[req.params.code.toUpperCase()] = setTimeout(() => {
const r = rooms[req.params.code.toUpperCase()];
if (!r || r.status !== 'night') return;
if (!r.vitima) {
const possiveis = r.players.filter(p => p.id !== r.assassino);
const escolhida = possiveis[Math.floor(Math.random() * possiveis.length)];
r.vitima = escolhida.id; r.mortos.push(escolhida.id);
addFeed(r, '🔪 Assassino matou ' + escolhida.name, 'kill');
io.to(req.params.code.toUpperCase()).emit('kill-result', { vitima: escolhida, forcado: true, assassinoId: r.assassino });
}
r.status = 'result';
setTimeout(() => iniciarVotacao(req.params.code.toUpperCase()), 5000);
}, 30000);
res.json({ ok: true });
});
app.post('/api/rooms/:code/kill', (req, res) => {
if (!req.isAuthenticated()) return res.status(401).json({ error: 'Nao autenticado' });
const room = rooms[req.params.code.toUpperCase()];
if (!room) return res.status(404).json({ error: 'Sala nao encontrada' });
if (room.status !== 'night') return res.status(400).json({ error: 'Nao e noite' });
if (room.assassino !== req.user.id) return res.status(403).json({ error: 'Voce nao e o assassino' });
if (room.vitima) return res.status(400).json({ error: 'Vitima ja escolhida' });
const { vitimaId } = req.body;
const vitima = room.players.find(p => p.id === vitimaId);
if (!vitima) return res.status(404).json({ error: 'Jogador nao encontrado' });
room.vitima = vitimaId; room.mortos.push(vitimaId); room.status = 'result';
clearTimeout(gameTimers[req.params.code.toUpperCase()]);
addFeed(room, '🔪 Assassino matou ' + vitima.name, 'kill');
io.to(req.params.code.toUpperCase()).emit('kill-result', { vitima, forcado: false, assassinoId: room.assassino });
setTimeout(() => iniciarVotacao(req.params.code.toUpperCase()), 5000);
res.json({ ok: true });
});
app.post('/api/rooms/:code/vote', (req, res) => {
if (!req.isAuthenticated()) return res.status(401).json({ error: 'Nao autenticado' });
const room = rooms[req.params.code.toUpperCase()];
if (!room) return res.status(404).json({ error: 'Sala nao encontrada' });
if (room.status !== 'voting') return res.status(400).json({ error: 'Nao e fase de votacao' });
const userId = req.user.id;
if (room.votanteAtual !== userId) return res.status(403).json({ error: 'Nao e sua vez de votar' });
if (room.votos[userId]) return res.status(400).json({ error: 'Voce ja votou' });
const { alvoId } = req.body;
const alvo = room.players.find(p => p.id === alvoId && !room.mortos.includes(p.id));
if (!alvo) return res.status(404).json({ error: 'Alvo invalido' });
room.votos[userId] = alvoId;
clearTimeout(gameTimers[req.params.code.toUpperCase() + '_vote']);
io.to(req.params.code.toUpperCase()).emit('vote-cast', { votanteId: userId, alvoId, forcado: false });
room.votacaoIndex++; iniciarTurnoVotacao(req.params.code.toUpperCase());
res.json({ ok: true });
});
app.get('*', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });
const socketUsers = {};
io.on('connection', (socket) => {
socket.on('join-room', ({ code, userId, asSpectator }) => {
socket.join(code);
socketUsers[socket.id] = { userId, roomCode: code, asSpectator: !!asSpectator };
const room = rooms[code];
if (room) {
if (asSpectator) { room.spectators = (room.spectators || 0) + 1; emitSpectatorCount(code); }
socket.emit('room-update', room);
socket.emit('spectator-count', { count: room.spectators || 0 });
if (room.status !== 'waiting') socket.emit('spectator-mode', { status: room.status, feed: room.feed || [], spectators: room.spectators || 0 });
}
socket.to(code).emit('peer-joined', { socketId: socket.id, userId });
});
socket.on('webrtc-offer', ({ to, offer }) => io.to(to).emit('webrtc-offer', { from: socket.id, offer }));
socket.on('webrtc-answer', ({ to, answer }) => io.to(to).emit('webrtc-answer', { from: socket.id, answer }));
socket.on('webrtc-ice', ({ to, candidate }) => io.to(to).emit('webrtc-ice', { from: socket.id, candidate }));
socket.on('mic-status', ({ code, userId, muted }) => { socket.to(code).emit('mic-status', { userId, muted }); });
socket.on('disconnect', () => {
const info = socketUsers[socket.id];
if (info) {
if (info.asSpectator) {
const room = rooms[info.roomCode];
if (room) { room.spectators = Math.max(0, (room.spectators || 1) - 1); emitSpectatorCount(info.roomCode); }
}
socket.to(info.roomCode).emit('peer-left', { socketId: socket.id, userId: info.userId });
delete socketUsers[socket.id];
}
});
});
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log('Cidade Dorme na porta ' + PORT));
