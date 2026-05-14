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
const gameTimers = {}; // code -> setTimeout handle

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 6; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return c;
}

const FAKE_PLAYERS = [
  { id: 'fake_1', name: 'Ana Silva',     photo: 'https://i.pravatar.cc/80?img=1',  isHost: false },
  { id: 'fake_2', name: 'Bruno Costa',   photo: 'https://i.pravatar.cc/80?img=3',  isHost: false },
  { id: 'fake_3', name: 'Carla Mendes',  photo: 'https://i.pravatar.cc/80?img=5',  isHost: false },
  { id: 'fake_4', name: 'Diego Lima',    photo: 'https://i.pravatar.cc/80?img=7',  isHost: false },
  { id: 'fake_5', name: 'Eduarda Rocha', photo: 'https://i.pravatar.cc/80?img=9',  isHost: false },
  { id: 'fake_6', name: 'Felipe Nunes',  photo: 'https://i.pravatar.cc/80?img=11', isHost: false },
];

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'cidade-dorme-secret',
  resave: false, saveUninitialized: false
}));
app.use(passport.initialize());
app.use(passport.session());

passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: process.env.CALLBACK_URL || '/auth/google/callback'
}, (at, rt, profile, done) => done(null, profile)));

passport.serializeUser((u, done) => done(null, u));
passport.deserializeUser((u, done) => done(null, u));

app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/' }),
  (req, res) => res.redirect('/'));
app.get('/auth/logout', (req, res) => { req.logout(() => res.redirect('/')); });

app.get('/api/me', (req, res) => {
  if (req.isAuthenticated()) res.json({ user: req.user });
  else res.json({ user: null });
});

app.get('/api/rooms', (req, res) => {
  const list = Object.values(rooms)
    .filter(r => r.status === 'waiting')
    .map(r => ({
      code: r.code, players: r.players.length, minPlayers: r.minPlayers,
      host: (r.players.find(p => p.isHost) || {}).name || 'Host'
    }));
  res.json({ rooms: list });
});

app.post('/api/rooms', (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Nao autenticado' });
  let code;
  do { code = generateCode(); } while (rooms[code]);
  const userId = req.user.id;
  const userName = req.user.displayName || 'Jogador';
  const userPhoto = (req.user.photos && req.user.photos[0]) ? req.user.photos[0].value : '';
  rooms[code] = {
    code, host: userId, minPlayers: 5,
    players: [{ id: userId, name: userName, photo: userPhoto, isHost: true }],
    status: 'waiting', createdAt: Date.now(), assassino: null, vitima: null
  };
  res.json({ room: rooms[code] });
});

app.post('/api/rooms/:code/add-fake-players', (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Nao autenticado' });
  const room = rooms[req.params.code.toUpperCase()];
  if (!room) return res.status(404).json({ error: 'Sala nao encontrada' });
  if (room.status !== 'waiting') return res.status(400).json({ error: 'Sala ja iniciada' });
  for (const fp of FAKE_PLAYERS) {
    if (!room.players.find(p => p.id === fp.id)) room.players.push({ ...fp });
  }
  io.to(req.params.code.toUpperCase()).emit('room-update', room);
  res.json({ room });
});

app.get('/api/rooms/:code', (req, res) => {
  const room = rooms[req.params.code.toUpperCase()];
  if (!room) return res.status(404).json({ error: 'Sala nao encontrada' });
  res.json({ room });
});

app.post('/api/rooms/:code/join', (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Nao autenticado' });
  const room = rooms[req.params.code.toUpperCase()];
  if (!room) return res.status(404).json({ error: 'Sala nao encontrada' });
  if (room.status !== 'waiting') return res.status(400).json({ error: 'Sala ja iniciada' });
  const userId = req.user.id;
  if (!room.players.find(p => p.id === userId)) {
    room.players.push({
      id: userId,
      name: req.user.displayName || 'Jogador',
      photo: (req.user.photos && req.user.photos[0]) ? req.user.photos[0].value : '',
      isHost: false
    });
  }
  io.to(req.params.code.toUpperCase()).emit('room-update', room);
  res.json({ room });
});

app.delete('/api/rooms/:code/leave', (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Nao autenticado' });
  const room = rooms[req.params.code.toUpperCase()];
  if (!room) return res.status(404).json({ error: 'Sala nao encontrada' });
  const userId = req.user.id;
  room.players = room.players.filter(p => p.id !== userId);
  if (room.players.length === 0) {
    clearTimeout(gameTimers[req.params.code.toUpperCase()]);
    delete rooms[req.params.code.toUpperCase()];
  } else {
    if (room.host === userId) {
      room.host = room.players[0].id;
      room.players[0].isHost = true;
    }
    io.to(req.params.code.toUpperCase()).emit('room-update', room);
  }
  res.json({ ok: true });
});

// INICIAR JOGO
app.post('/api/rooms/:code/start', (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Nao autenticado' });
  const room = rooms[req.params.code.toUpperCase()];
  if (!room) return res.status(404).json({ error: 'Sala nao encontrada' });
  if (room.host !== req.user.id) return res.status(403).json({ error: 'Apenas o host pode iniciar' });
  if (room.players.length < room.minPlayers) return res.status(400).json({ error: 'Jogadores insuficientes' });
  if (room.status !== 'waiting') return res.status(400).json({ error: 'Jogo ja iniciado' });

  room.status = 'night';

  // Sorteia assassino (qualquer jogador, incluindo host)
  const idx = Math.floor(Math.random() * room.players.length);
  const assassino = room.players[idx];
  room.assassino = assassino.id;
  room.vitima = null;

  // Notifica cada jogador individualmente com seu papel
  room.players.forEach(p => {
    const isAssassino = p.id === assassino.id;
    // Manda apenas para o socket deste jogador
    io.to(req.params.code.toUpperCase()).emit('game-started', {
      assassinoId: assassino.id,
      assassinoName: assassino.name
    });
  });

  // Envia lista de vitimas possiveis apenas ao assassino (via socket separado)
  // O servidor emite game-night-data para a sala inteira - o cliente filtra por userId
  const vitimas = room.players
    .filter(p => p.id !== assassino.id)
    .map(p => ({ id: p.id, name: p.name, photo: p.photo }));

  io.to(req.params.code.toUpperCase()).emit('game-night', {
    assassinoId: assassino.id,
    vitimas,
    segundos: 60
  });

  // Timer de 60 segundos no servidor
  if (gameTimers[req.params.code.toUpperCase()]) clearTimeout(gameTimers[req.params.code.toUpperCase()]);
  gameTimers[req.params.code.toUpperCase()] = setTimeout(() => {
    const r = rooms[req.params.code.toUpperCase()];
    if (!r || r.status !== 'night') return;
    if (!r.vitima) {
      // Assassino nao escolheu: sorteia vitima aleatoria
      const possiveis = r.players.filter(p => p.id !== r.assassino);
      const escolhida = possiveis[Math.floor(Math.random() * possiveis.length)];
      r.vitima = escolhida.id;
      r.vitoriaAssassino = true;
      io.to(req.params.code.toUpperCase()).emit('kill-result', {
        vitima: escolhida,
        forcado: true,
        assassinoId: r.assassino
      });
    }
    r.status = 'result';
  }, 60000);

  res.json({ ok: true });
});

// ASSASSINO ESCOLHE VITIMA
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
  room.status = 'result';

  // Cancela timer do servidor
  clearTimeout(gameTimers[req.params.code.toUpperCase()]);

  io.to(req.params.code.toUpperCase()).emit('kill-result', {
    vitima,
    forcado: false,
    assassinoId: room.assassino
  });

  res.json({ ok: true });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const socketUsers = {};

io.on('connection', (socket) => {
  socket.on('join-room', ({ code, userId }) => {
    socket.join(code);
    socketUsers[socket.id] = { userId, roomCode: code };
    const room = rooms[code];
    if (room) socket.emit('room-update', room);
    socket.to(code).emit('peer-joined', { socketId: socket.id, userId });
  });

  socket.on('webrtc-offer',   ({ to, offer })     => io.to(to).emit('webrtc-offer',   { from: socket.id, offer }));
  socket.on('webrtc-answer',  ({ to, answer })     => io.to(to).emit('webrtc-answer',  { from: socket.id, answer }));
  socket.on('webrtc-ice',     ({ to, candidate })  => io.to(to).emit('webrtc-ice',     { from: socket.id, candidate }));

  socket.on('mic-status', ({ code, userId, muted }) => {
    socket.to(code).emit('mic-status', { userId, muted });
  });

  socket.on('disconnect', () => {
    const info = socketUsers[socket.id];
    if (info) {
      socket.to(info.roomCode).emit('peer-left', { socketId: socket.id, userId: info.userId });
      delete socketUsers[socket.id];
    }
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log('Cidade Dorme na porta ' + PORT));
