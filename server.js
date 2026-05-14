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

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

const FAKE_PLAYERS = [
  { id: 'fake_1', name: 'Ana Silva', photo: 'https://i.pravatar.cc/80?img=1', isHost: false },
  { id: 'fake_2', name: 'Bruno Costa', photo: 'https://i.pravatar.cc/80?img=3', isHost: false },
  { id: 'fake_3', name: 'Carla Mendes', photo: 'https://i.pravatar.cc/80?img=5', isHost: false },
  { id: 'fake_4', name: 'Diego Lima', photo: 'https://i.pravatar.cc/80?img=7', isHost: false },
  { id: 'fake_5', name: 'Eduarda Rocha', photo: 'https://i.pravatar.cc/80?img=9', isHost: false },
  { id: 'fake_6', name: 'Felipe Nunes', photo: 'https://i.pravatar.cc/80?img=11', isHost: false },
];

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'cidade-dorme-secret',
  resave: false,
  saveUninitialized: false
}));

app.use(passport.initialize());
app.use(passport.session());

passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: process.env.CALLBACK_URL || '/auth/google/callback'
}, (accessToken, refreshToken, profile, done) => {
  return done(null, profile);
}));

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/' }),
  (req, res) => res.redirect('/')
);
app.get('/auth/logout', (req, res) => { req.logout(() => res.redirect('/')); });

app.get('/api/me', (req, res) => {
  if (req.isAuthenticated()) res.json({ user: req.user });
  else res.json({ user: null });
});

app.get('/api/rooms', (req, res) => {
  const list = Object.values(rooms)
    .filter(r => r.status === 'waiting')
    .map(r => ({
      code: r.code,
      players: r.players.length,
      minPlayers: r.minPlayers,
      host: r.players.find(p => p.isHost) ? r.players.find(p => p.isHost).name : 'Host'
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
    status: 'waiting', createdAt: Date.now()
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

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Mapeia socket.id -> { userId, roomCode }
const socketUsers = {};

io.on('connection', (socket) => {
  console.log('conectado:', socket.id);

  socket.on('join-room', ({ code, userId }) => {
    socket.join(code);
    socketUsers[socket.id] = { userId, roomCode: code };
    const room = rooms[code];
    if (room) socket.emit('room-update', room);
    // Avisa outros da sala que este peer entrou (para iniciar WebRTC)
    socket.to(code).emit('peer-joined', { socketId: socket.id, userId });
  });

  // ---- SINALIZACAO WebRTC ----
  socket.on('webrtc-offer', ({ to, offer }) => {
    io.to(to).emit('webrtc-offer', { from: socket.id, offer });
  });

  socket.on('webrtc-answer', ({ to, answer }) => {
    io.to(to).emit('webrtc-answer', { from: socket.id, answer });
  });

  socket.on('webrtc-ice', ({ to, candidate }) => {
    io.to(to).emit('webrtc-ice', { from: socket.id, candidate });
  });

  // Mute/unmute: avisa sala inteira
  socket.on('mic-status', ({ code, userId, muted }) => {
    socket.to(code).emit('mic-status', { userId, muted });
  });

  socket.on('disconnect', () => {
    const info = socketUsers[socket.id];
    if (info) {
      socket.to(info.roomCode).emit('peer-left', { socketId: socket.id, userId: info.userId });
      delete socketUsers[socket.id];
    }
    console.log('desconectado:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log('Cidade Dorme na porta ' + PORT));
