// deploy trigger v3
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
const inactivityTimers = {};
const replayTimers = {};
const INACTIVITY_TIMEOUT = 10 * 60 * 1000;
const REPLAY_TIMEOUT = 30 * 1000;
const MAX_PLAYERS = 50;

// Papeis especiais disponiveis
const PAPEIS_ESPECIAIS = ['anjo', 'detetive', 'soldado', 'palhaco'];

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
clearTimeout(inactivityTimers[roomCode]);
clearTimeout(replayTimers[roomCode]);
delete inactivityTimers[roomCode];
delete replayTimers[roomCode];
io.to(roomCode).emit('sala-fechada', { motivo: motivo || 'Sala encerrada.' });
delete rooms[roomCode];
}

function resetInactivityTimer(roomCode) {
clearTimeout(inactivityTimers[roomCode]);
inactivityTimers[roomCode] = setTimeout(() => {
fecharSala(roomCode, 'Sala encerrada por inatividade (10 minutos sem atividade).');
}, INACTIVITY_TIMEOUT);
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
// Sorteia papeis para todos os jogadores
function sortearPapeis(room) {
const players = room.players;
const n = players.length;
// Resetar papeis
players.forEach(p => { p.papel = 'cidadao'; p.usosHabilidade = 0; });
// 1 assassino fixo (ja definido em room.assassino)
const assassinoPlayer = players.find(p => p.id === room.assassino);
if (assassinoPlayer) assassinoPlayer.papel = 'assassino';
// Determinar quantos papeis especiais caber na partida
// Para cada 3 jogadores alem do minimo, adiciona 1 especial (max 4)
const maxEspeciais = Math.min(PAPEIS_ESPECIAIS.length, Math.floor((n - 1) / 2));
// Jogadores que podem receber papel especial (todos exceto assassino)
const candidatos = players.filter(p => p.id !== room.assassino);
// Embaralhar candidatos
for (let i = candidatos.length - 1; i > 0; i--) {
const j = Math.floor(Math.random() * (i + 1));
[candidatos[i], candidatos[j]] = [candidatos[j], candidatos[i]];
}
// Embaralhar papeis especiais
const especiaisEmbaralhados = [...PAPEIS_ESPECIAIS];
for (let i = especiaisEmbaralhados.length - 1; i > 0; i--) {
const j = Math.floor(Math.random() * (i + 1));
[especiaisEmbaralhados[i], especiaisEmbaralhados[j]] = [especiaisEmbaralhados[j], especiaisEmbaralhados[i]];
}
// Atribuir papeis especiais
for (let i = 0; i < maxEspeciais && i < candidatos.length; i++) {
candidatos[i].papel = especiaisEmbaralhados[i];
// Definir usos iniciais
if (especiaisEmbaralhados[i] === 'anjo') candidatos[i].usosHabilidade = 2;
else if (especiaisEmbaralhados[i] === 'detetive') candidatos[i].usosHabilidade = 2;
else if (especiaisEmbaralhados[i] === 'soldado') candidatos[i].usosHabilidade = 1;
else candidatos[i].usosHabilidade = 0;
}
}

function getPapelInfo(papel, usosRestantes) {
const info = {
assassino: { nome: 'Assassino', emoji: '🔪', descricao: 'Elimine todos os cidadaos durante a noite.', podeAgir: true },
anjo: { nome: 'Anjo', emoji: '👼', descricao: 'Proteja 1 pessoa por noite (2 usos).', podeAgir: usosRestantes > 0 },
detetive: { nome: 'Detetive', emoji: '🕵️', descricao: 'Investigue 1 jogador por noite (2 usos).', podeAgir: usosRestantes > 0 },
soldado: { nome: 'Soldado', emoji: '🪖', descricao: 'Voce tem 1 tiro para usar na noite.', podeAgir: usosRestantes > 0 },
palhaco: { nome: 'Palhaco', emoji: '🤡', descricao: 'Se eliminado por votacao, voce vence!', podeAgir: false },
cidadao: { nome: 'Cidadao', emoji: '👤', descricao: 'Descubra e elimine o assassino.', podeAgir: false },
};
return info[papel] || info['cidadao'];
}

// Resolve acoes da noite: Soldado -> Anjo -> Assassino
function resolverNoite(roomCode) {
const room = rooms[roomCode];
if (!room) return;
clearTimeout(gameTimers[roomCode]);
room.status = 'result';
const mortosDaNoite = [];
const anunciosFeed = [];
// Acao do soldado
if (room.acaoSoldado) {
const alvoSoldado = room.players.find(p => p.id === room.acaoSoldado);
if (alvoSoldado && !room.mortos.includes(alvoSoldado.id)) {
room.mortos.push(alvoSoldado.id);
mortosDaNoite.push({ jogador: alvoSoldado, tipo: 'soldado' });
addFeed(room, 'Soldado eliminou ' + alvoSoldado.name + ' durante a noite!', 'kill');
}
}
// Verificar se anjo salvou a vitima do assassino
const vitimaAssassinoId = room.vitima;
const anjoSalvou = room.acaoAnjo && room.acaoAnjo === vitimaAssassinoId;
if (vitimaAssassinoId) {
if (anjoSalvou) {
// Anjo salvou - nao mata, remove da lista de mortos se foi adicionada
room.mortos = room.mortos.filter(id => id !== vitimaAssassinoId);
addFeed(room, '⚠️ O assassino falhou! Alguem foi salvo.', 'sistema');
io.to(roomCode).emit('assassino-falhou', { mensagem: 'O assassino falhou! Alguem foi protegido.' });
} else {
const vitima = room.players.find(p => p.id === vitimaAssassinoId);
if (vitima && !mortosDaNoite.find(m => m.jogador.id === vitima.id)) {
mortosDaNoite.push({ jogador: vitima, tipo: 'assassino' });
}
}
}
// Resetar acoes da noite
room.acaoAnjo = null;
room.acaoSoldado = null;
room.acaoNoitesProntas = {};
// Emitir resultado da noite
const mortosFinal = mortosDaNoite.map(m => ({ vitima: m.jogador, tipo: m.tipo, assassinoId: room.assassino }));
io.to(roomCode).emit('kill-result', { mortos: mortosFinal, forcado: false, assassinoId: room.assassino });
setTimeout(() => iniciarVotacao(roomCode), 5000);
}
// Inicia a fase da noite enviando papeis a cada jogador individualmente
function iniciarNoite(roomCode, rodada) {
const room = rooms[roomCode];
if (!room) return;
room.status = 'night';
room.vitima = null;
room.acaoAnjo = null;
room.acaoSoldado = null;
room.acaoNoitesProntas = {};
const vivos = room.players.filter(p => !room.mortos.includes(p.id));
// Enviar evento personalizado para cada jogador com seu papel
vivos.forEach(player => {
const papel = player.papel || 'cidadao';
const papelInfo = getPapelInfo(papel, player.usosHabilidade || 0);
const vitimas = vivos.filter(p => p.id !== player.id).map(p => ({ id: p.id, name: p.name, photo: p.photo }));
// Para o assassino, enviar lista de alvos
if (papel === 'assassino') {
io.to(roomCode).emit('game-night-player', {
playerId: player.id,
papel,
papelInfo,
assassinoId: room.assassino,
vitimas,
segundos: 30,
rodada,
feed: room.feed || []
});
} else {
io.to(roomCode).emit('game-night-player', {
playerId: player.id,
papel,
papelInfo,
assassinoId: room.assassino,
vitimas: papel !== 'cidadao' && papel !== 'palhaco' ? vitimas : [],
segundos: 30,
rodada,
feed: room.feed || []
});
}
});
// Tambem emitir evento geral para mortos/espectadores
io.to(roomCode).emit('game-night', {
assassinoId: room.assassino,
vitimas: vivos.filter(p => p.id !== room.assassino).map(p => ({ id: p.id, name: p.name, photo: p.photo })),
segundos: 30,
rodada,
feed: room.feed || []
});
// Timer de 30s para resolver a noite automaticamente
clearTimeout(gameTimers[roomCode]);
gameTimers[roomCode] = setTimeout(() => {
const r = rooms[roomCode];
if (!r || r.status !== 'night') return;
// Assassino nao escolheu - escolhe aleatorio
if (!r.vitima) {
const vivosAlt = r.players.filter(p => !r.mortos.includes(p.id));
const possiveis = vivosAlt.filter(p => p.id !== r.assassino);
if (possiveis.length > 0) {
const escolhida = possiveis[Math.floor(Math.random() * possiveis.length)];
r.vitima = escolhida.id;
r.mortos.push(escolhida.id);
addFeed(r, 'Assassino matou ' + escolhida.name, 'kill');
}
}
resolverNoite(roomCode);
}, 30000);
}

// Inicia fase de decisao pos-jogo: 30s para todos decidirem
function iniciarFaseDecisao(roomCode, resultadoPayload) {
const room = rooms[roomCode];
if (!room) return;
room.status = 'ended';
room.replayVotos = {};
room.replaySegundos = 30;
io.to(roomCode).emit('fim-de-jogo', {
...resultadoPayload,
segundosDecisao: 30
});
clearTimeout(replayTimers[roomCode]);
replayTimers[roomCode] = setTimeout(() => {
resolverDecisaoReplay(roomCode);
}, REPLAY_TIMEOUT);
}

function resolverDecisaoReplay(roomCode) {
const room = rooms[roomCode];
if (!room || room.status !== 'ended') return;
clearTimeout(replayTimers[roomCode]);
const reais = room.players.filter(p => !p.id.startsWith('fake_'));
const ficandoIds = reais.filter(p => room.replayVotos[p.id] === true).map(p => p.id);
const saindoIds = reais.filter(p => room.replayVotos[p.id] !== true).map(p => p.id);
saindoIds.forEach(uid => { io.to(roomCode).emit('jogador-saiu-pos-jogo', { userId: uid }); });
room.players = room.players.filter(p => ficandoIds.includes(p.id));
if (room.players.length === 0) { fecharSala(roomCode, 'Todos os jogadores saíram da sala.'); return; }
clearTimeout(gameTimers[roomCode]);
clearTimeout(gameTimers[roomCode + '_vote']);
room.status = 'waiting';
room.mortos = [];
room.votos = {};
room.votanteAtual = null;
room.assassino = null;
room.vitima = null;
room.rodada = 1;
room.feed = [];
room.replayVotos = {};
room.spectators = 0;
room.acaoAnjo = null;
room.acaoSoldado = null;
room.acaoNoitesProntas = {};
if (!room.players.find(p => p.id === room.host)) {
const novoHost = room.players[0];
room.host = novoHost.id;
novoHost.isHost = true;
}
room.players.forEach(p => { p.isHost = p.id === room.host; p.papel = null; p.usosHabilidade = 0; });
resetInactivityTimer(roomCode);
io.to(roomCode).emit('sala-pronta', { room });
}
function iniciarNovaRodada(roomCode) {
const room = rooms[roomCode];
if (!room) return;
if (apenasJogadoresFicticios(room)) { fecharSala(roomCode, 'Todos os jogadores reais saíram.'); return; }
const vivos = room.players.filter(p => !room.mortos.includes(p.id));
const vivosReais = vivos.filter(p => !p.id.startsWith('fake_'));
if (vivosReais.length === 0) { fecharSala(roomCode, 'Todos os jogadores reais foram eliminados.'); return; }
if (vivos.length <= 2) {
const cidadao = vivos.find(p => p.id !== room.assassino);
const assassinoPlayer = vivos.find(p => p.id === room.assassino);
if (cidadao && assassinoPlayer) {
addFeed(room, cidadao.name + ' era um CIDADAO inocente.', 'cidadao');
iniciarFaseDecisao(roomCode, { tipo: 'reveal', cidadao: { id: cidadao.id, name: cidadao.name, photo: cidadao.photo }, assassino: { id: assassinoPlayer.id, name: assassinoPlayer.name, photo: assassinoPlayer.photo }, vencedor: 'assassino', mortos: room.mortos });
} else {
iniciarFaseDecisao(roomCode, { tipo: 'game-over', vencedor: 'assassino', mortos: room.mortos });
}
return;
}
if (room.mortos.includes(room.assassino)) {
const vivosParaAssassino = vivos.filter(p => p.id !== room.assassino);
const novoAssassino = vivosParaAssassino[Math.floor(Math.random() * vivosParaAssassino.length)];
if (novoAssassino) { room.assassino = novoAssassino.id; novoAssassino.papel = 'assassino'; }
}
room.rodada = (room.rodada || 1) + 1;
addFeed(room, 'Rodada ' + room.rodada + ' iniciada', 'sistema');
iniciarNoite(roomCode, room.rodada);
}

function iniciarVotacao(roomCode) {
const room = rooms[roomCode];
if (!room) return;
if (apenasJogadoresFicticios(room)) { fecharSala(roomCode, 'Todos os jogadores reais saíram.'); return; }
const vivos = room.players.filter(p => !room.mortos.includes(p.id));
if (vivos.length === 0) return;
room.status = 'voting'; room.votos = {};
room.votacaoFila = vivos.map(p => p.id); room.votacaoIndex = 0;
iniciarTurnoVotacao(roomCode);
}

function iniciarTurnoVotacao(roomCode) {
const room = rooms[roomCode];
if (!room || room.status !== 'voting') return;
if (apenasJogadoresFicticios(room)) { fecharSala(roomCode, 'Todos os jogadores reais saíram.'); return; }
const idx = room.votacaoIndex;
if (idx >= room.votacaoFila.length) { finalizarVotacao(roomCode); return; }
const votanteId = room.votacaoFila[idx];
const votante = room.players.find(p => p.id === votanteId);
const vivos = room.players.filter(p => !room.mortos.includes(p.id));
const alvos = vivos.filter(p => p.id !== votanteId).map(p => ({ id: p.id, name: p.name, photo: p.photo }));
room.votanteAtual = votanteId;
io.to(roomCode).emit('vote-turn', { votante: { id: votante.id, name: votante.name, photo: votante.photo }, alvos, segundos: 60, totalVotantes: room.votacaoFila.length, turnoAtual: idx + 1, feed: room.feed || [] });
clearTimeout(gameTimers[roomCode + '_vote']);
const delay = votanteId.startsWith('fake_') ? 10000 : 60000;
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
clearTimeout(gameTimers[roomCode + '_vote']);
if (apenasJogadoresFicticios(room)) { fecharSala(roomCode, 'Todos os jogadores reais saíram.'); return; }
const contagem = {};
Object.values(room.votos).forEach(alvoId => { contagem[alvoId] = (contagem[alvoId] || 0) + 1; });
if (Object.keys(contagem).length === 0) {
addFeed(room, 'Votacao sem votos — empate!', 'empate');
io.to(roomCode).emit('vote-result', { empate: true, eliminado: null, era_assassino: false, votos: {}, feed: room.feed || [] });
setTimeout(() => iniciarNovaRodada(roomCode), 5000); return;
}
const maxVotos = Math.max(...Object.values(contagem));
const maisVotados = Object.keys(contagem).filter(id => contagem[id] === maxVotos);
if (maisVotados.length > 1) {
addFeed(room, 'Empate na votacao — ninguem eliminado', 'empate');
io.to(roomCode).emit('vote-result', { empate: true, eliminado: null, era_assassino: false, votos: contagem, feed: room.feed || [] });
setTimeout(() => iniciarNovaRodada(roomCode), 5000); return;
}
const eliminadoId = maisVotados[0];
const eliminado = room.players.find(p => p.id === eliminadoId);
const eraAssassino = eliminadoId === room.assassino;
// Verificar se eliminado e Palhaco
const eraPalhaco = eliminado && eliminado.papel === 'palhaco';
room.mortos.push(eliminadoId);
if (eraPalhaco) {
addFeed(room, '🤡 ' + eliminado.name + ' era o PALHACO e venceu sozinho!', 'palhaco');
io.to(roomCode).emit('vote-result', { empate: false, eliminado: { id: eliminado.id, name: eliminado.name, photo: eliminado.photo }, era_assassino: false, era_palhaco: true, votos: contagem, feed: room.feed || [] });
setTimeout(() => {
iniciarFaseDecisao(roomCode, { tipo: 'game-over', vencedor: 'palhaco', vencedorInfo: { id: eliminado.id, name: eliminado.name, photo: eliminado.photo }, mortos: room.mortos });
}, 5000);
return;
}
addFeed(room, eraAssassino ? eliminado.name + ' eliminado — ERA O ASSASSINO!' : eliminado.name + ' eliminado — era cidadao', eraAssassino ? 'assassino-eliminado' : 'cidadao-eliminado');
io.to(roomCode).emit('vote-result', { empate: false, eliminado: { id: eliminado.id, name: eliminado.name, photo: eliminado.photo }, era_assassino: eraAssassino, votos: contagem, feed: room.feed || [] });
if (eraAssassino) {
setTimeout(() => { iniciarFaseDecisao(roomCode, { tipo: 'game-over', vencedor: 'cidade', mortos: room.mortos }); }, 5000);
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
app.post('/api/rooms', (req, res) => {
if (!req.isAuthenticated()) return res.status(401).json({ error: 'Nao autenticado' });
let code; do { code = generateCode(); } while (rooms[code]);
const userId = req.user.id; const userName = req.user.displayName || 'Jogador';
const userPhoto = (req.user.photos && req.user.photos[0]) ? req.user.photos[0].value : '';
rooms[code] = { code, host: userId, minPlayers: 5, players: [{ id: userId, name: userName, photo: userPhoto, isHost: true, papel: null, usosHabilidade: 0 }], spectators: 0, status: 'waiting', createdAt: Date.now(), assassino: null, vitima: null, mortos: [], votos: {}, votanteAtual: null, rodada: 1, feed: [], replayVotos: {}, acaoAnjo: null, acaoSoldado: null, acaoNoitesProntas: {} };
resetInactivityTimer(code);
res.json({ room: rooms[code] });
});
app.post('/api/rooms/:code/add-fake-players', (req, res) => {
if (!req.isAuthenticated()) return res.status(401).json({ error: 'Nao autenticado' });
const room = rooms[req.params.code.toUpperCase()];
if (!room) return res.status(404).json({ error: 'Sala nao encontrada' });
if (room.status !== 'waiting') return res.status(400).json({ error: 'Sala ja iniciada' });
for (const fp of FAKE_PLAYERS) { if (!room.players.find(p => p.id === fp.id)) room.players.push({ ...fp, papel: null, usosHabilidade: 0 }); }
resetInactivityTimer(req.params.code.toUpperCase());
io.to(req.params.code.toUpperCase()).emit('room-update', room); res.json({ room });
});
app.get('/api/rooms/:code', (req, res) => { const room = rooms[req.params.code.toUpperCase()]; if (!room) return res.status(404).json({ error: 'Sala nao encontrada' }); res.json({ room }); });
app.post('/api/rooms/:code/join', (req, res) => {
if (!req.isAuthenticated()) return res.status(401).json({ error: 'Nao autenticado' });
const room = rooms[req.params.code.toUpperCase()];
if (!room) return res.status(404).json({ error: 'Sala nao encontrada' });
const userId = req.user.id;
if (room.status !== 'waiting' || room.players.length >= MAX_PLAYERS) return res.json({ room, asSpectator: true });
if (!room.players.find(p => p.id === userId)) room.players.push({ id: userId, name: req.user.displayName || 'Jogador', photo: (req.user.photos && req.user.photos[0]) ? req.user.photos[0].value : '', isHost: false, papel: null, usosHabilidade: 0 });
resetInactivityTimer(req.params.code.toUpperCase());
io.to(req.params.code.toUpperCase()).emit('room-update', room);
res.json({ room, asSpectator: false });
});
app.delete('/api/rooms/:code/leave', (req, res) => {
if (!req.isAuthenticated()) return res.status(401).json({ error: 'Nao autenticado' });
const room = rooms[req.params.code.toUpperCase()];
if (!room) return res.status(404).json({ error: 'Sala nao encontrada' });
const userId = req.user.id;
room.players = room.players.filter(p => p.id !== userId);
if (apenasJogadoresFicticios(room)) { fecharSala(req.params.code.toUpperCase(), 'Todos os jogadores reais saíram.'); return res.json({ ok: true }); }
if (room.players.length === 0 && room.status === 'waiting') { clearTimeout(gameTimers[req.params.code.toUpperCase()]); clearTimeout(inactivityTimers[req.params.code.toUpperCase()]); delete inactivityTimers[req.params.code.toUpperCase()]; delete rooms[req.params.code.toUpperCase()]; }
else { if (room.host === userId && room.players.length > 0) { const nh = room.players.find(p => !p.id.startsWith('fake_')) || room.players[0]; room.host = nh.id; nh.isHost = true; } resetInactivityTimer(req.params.code.toUpperCase()); io.to(req.params.code.toUpperCase()).emit('room-update', room); }
res.json({ ok: true });
});
app.post('/api/rooms/:code/jogar-novamente', (req, res) => {
if (!req.isAuthenticated()) return res.status(401).json({ error: 'Nao autenticado' });
const room = rooms[req.params.code.toUpperCase()];
if (!room) return res.status(404).json({ error: 'Sala nao encontrada' });
if (room.status !== 'ended') return res.status(400).json({ error: 'Jogo nao encerrado' });
const userId = req.user.id;
if (!room.replayVotos) room.replayVotos = {};
room.replayVotos[userId] = true;
const reais = room.players.filter(p => !p.id.startsWith('fake_'));
const votosCount = reais.filter(p => room.replayVotos[p.id] === true).length;
io.to(req.params.code.toUpperCase()).emit('replay-voto', { votosCount, total: reais.length, userId });
if (votosCount === reais.length) { clearTimeout(replayTimers[req.params.code.toUpperCase()]); resolverDecisaoReplay(req.params.code.toUpperCase()); }
res.json({ ok: true });
});
app.post('/api/rooms/:code/sair-pos-jogo', (req, res) => {
if (!req.isAuthenticated()) return res.status(401).json({ error: 'Nao autenticado' });
const room = rooms[req.params.code.toUpperCase()];
if (!room) return res.status(404).json({ error: 'Sala nao encontrada' });
const userId = req.user.id;
if (!room.replayVotos) room.replayVotos = {};
room.replayVotos[userId] = false;
res.json({ ok: true });
});
app.post('/api/rooms/:code/start', (req, res) => {
if (!req.isAuthenticated()) return res.status(401).json({ error: 'Nao autenticado' });
const room = rooms[req.params.code.toUpperCase()];
if (!room) return res.status(404).json({ error: 'Sala nao encontrada' });
if (room.host !== req.user.id) return res.status(403).json({ error: 'Apenas o host pode iniciar' });
if (room.players.length < room.minPlayers) return res.status(400).json({ error: 'Jogadores insuficientes' });
if (room.status !== 'waiting') return res.status(400).json({ error: 'Jogo ja iniciado' });
room.status = 'night'; room.mortos = []; room.votos = {}; room.votanteAtual = null; room.rodada = 1; room.feed = []; room.replayVotos = {};
room.acaoAnjo = null; room.acaoSoldado = null; room.acaoNoitesProntas = {};
// Escolher assassino aleatorio
const idx = Math.floor(Math.random() * room.players.length);
const assassino = room.players[idx]; room.assassino = assassino.id; room.vitima = null;
// Sortear papeis especiais
sortearPapeis(room);
addFeed(room, 'Jogo iniciado! Rodada 1', 'sistema');
resetInactivityTimer(req.params.code.toUpperCase());
// Iniciar noite com papeis
iniciarNoite(req.params.code.toUpperCase(), 1);
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
room.vitima = vitimaId;
room.mortos.push(vitimaId);
room.acaoNoitesProntas = room.acaoNoitesProntas || {};
room.acaoNoitesProntas['assassino'] = true;
resetInactivityTimer(req.params.code.toUpperCase());
addFeed(room, 'Assassino escolheu sua vitima...', 'sistema');
io.to(req.params.code.toUpperCase()).emit('assassino-escolheu', { ok: true });
// Checar se pode resolver ja
const todosDecidiram = verificarSeResolvNoite(room);
if (todosDecidiram) resolverNoite(req.params.code.toUpperCase());
res.json({ ok: true });
});
// Verifica se todos os personagens especiais ja decidiram (ou nao tem mais tempo)
function verificarSeResolvNoite(room) {
const vivos = room.players.filter(p => !room.mortos.includes(p.id));
// Assassino deve ter agido
if (!room.acaoNoitesProntas['assassino']) return false;
return true;
}
app.post('/api/rooms/:code/anjo-salvar', (req, res) => {
if (!req.isAuthenticated()) return res.status(401).json({ error: 'Nao autenticado' });
const room = rooms[req.params.code.toUpperCase()];
if (!room) return res.status(404).json({ error: 'Sala nao encontrada' });
if (room.status !== 'night') return res.status(400).json({ error: 'Nao e noite' });
const userId = req.user.id;
const anjoPlayer = room.players.find(p => p.id === userId && p.papel === 'anjo');
if (!anjoPlayer) return res.status(403).json({ error: 'Voce nao e o Anjo' });
if (anjoPlayer.usosHabilidade <= 0) return res.status(400).json({ error: 'Sem usos restantes' });
const { alvoId } = req.body;
room.acaoAnjo = alvoId;
anjoPlayer.usosHabilidade--;
io.to(req.params.code.toUpperCase()).emit('anjo-agiu', { ok: true });
res.json({ ok: true });
});
app.post('/api/rooms/:code/detetive-investigar', (req, res) => {
if (!req.isAuthenticated()) return res.status(401).json({ error: 'Nao autenticado' });
const room = rooms[req.params.code.toUpperCase()];
if (!room) return res.status(404).json({ error: 'Sala nao encontrada' });
if (room.status !== 'night') return res.status(400).json({ error: 'Nao e noite' });
const userId = req.user.id;
const detetivePlayer = room.players.find(p => p.id === userId && p.papel === 'detetive');
if (!detetivePlayer) return res.status(403).json({ error: 'Voce nao e o Detetive' });
if (detetivePlayer.usosHabilidade <= 0) return res.status(400).json({ error: 'Sem usos restantes' });
const { alvoId } = req.body;
const alvo = room.players.find(p => p.id === alvoId);
if (!alvo) return res.status(404).json({ error: 'Jogador nao encontrado' });
detetivePlayer.usosHabilidade--;
const eBom = alvo.papel !== 'assassino';
// Enviar resultado apenas para o detetive
io.to(req.params.code.toUpperCase()).emit('resultado-detetive', { investigadorId: userId, alvoId, alvoName: alvo.name, eBom });
res.json({ ok: true, eBom });
});
app.post('/api/rooms/:code/soldado-atirar', (req, res) => {
if (!req.isAuthenticated()) return res.status(401).json({ error: 'Nao autenticado' });
const room = rooms[req.params.code.toUpperCase()];
if (!room) return res.status(404).json({ error: 'Sala nao encontrada' });
if (room.status !== 'night') return res.status(400).json({ error: 'Nao e noite' });
const userId = req.user.id;
const soldadoPlayer = room.players.find(p => p.id === userId && p.papel === 'soldado');
if (!soldadoPlayer) return res.status(403).json({ error: 'Voce nao e o Soldado' });
if (soldadoPlayer.usosHabilidade <= 0) return res.status(400).json({ error: 'Sem tiros restantes' });
const { alvoId } = req.body;
const alvo = room.players.find(p => p.id === alvoId);
if (!alvo) return res.status(404).json({ error: 'Jogador nao encontrado' });
soldadoPlayer.usosHabilidade--;
room.acaoSoldado = alvoId;
io.to(req.params.code.toUpperCase()).emit('soldado-agiu', { ok: true });
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
resetInactivityTimer(req.params.code.toUpperCase());
io.to(req.params.code.toUpperCase()).emit('vote-cast', { votanteId: userId, alvoId, forcado: false });
room.votacaoIndex++; iniciarTurnoVotacao(req.params.code.toUpperCase());
res.json({ ok: true });
});
app.get('*', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });
const socketUsers = {};
io.on('connection', (socket) => {
socket.on('join-room', ({ code, userId, asSpectator }) => {
socket.join(code); socketUsers[socket.id] = { userId, roomCode: code, asSpectator: !!asSpectator };
const room = rooms[code];
if (room) {
if (asSpectator) { room.spectators = (room.spectators || 0) + 1; emitSpectatorCount(code); }
resetInactivityTimer(code);
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
socket.on('chat-mensagem', ({ code, texto, nomeUsuario, isEspectador }) => {
const room = rooms[code];
if (!room) return;
const textoLimitado = (texto || '').slice(0, 50);
if (!textoLimitado.trim()) return;
const msg = { nomeUsuario: nomeUsuario || 'Jogador', texto: textoLimitado, isEspectador: !!isEspectador, ts: Date.now() };
io.to(code).emit('chat-mensagem', msg);
});
socket.on('disconnect', () => {
const info = socketUsers[socket.id];
if (info) {
if (info.asSpectator) { const room = rooms[info.roomCode]; if (room) { room.spectators = Math.max(0, (room.spectators || 1) - 1); emitSpectatorCount(info.roomCode); } }
socket.to(info.roomCode).emit('peer-left', { socketId: socket.id, userId: info.userId });
delete socketUsers[socket.id];
}
});
});
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log('Cidade Dorme na porta ' + PORT));

// deploy trigger
