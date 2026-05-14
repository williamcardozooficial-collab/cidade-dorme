const socket = io();
let currentUser = null;
let currentRoom = null;

// ---- AUDIO / WebRTC ----
let localStream = null;
let micMuted = true; // começa mutado
let peers = {}; // socketId -> RTCPeerConnection
const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

async function ativarMicrofone() {
  if (localStream) return; // ja tem stream
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    // Começa mutado: desativa todas as tracks de audio
    localStream.getAudioTracks().forEach(t => { t.enabled = false; });
    micMuted = true;
    atualizarBotaoMic();
    console.log('Microfone ativado');
  } catch (e) {
    console.error('Erro ao acessar microfone:', e);
    alert('Nao foi possivel acessar o microfone. Verifique as permissoes do navegador.');
  }
}

function toggleMic() {
  if (!localStream) {
    ativarMicrofone().then(() => {
      // Depois de ativar, liga o mic
      setTimeout(() => {
        micMuted = false;
        localStream.getAudioTracks().forEach(t => { t.enabled = true; });
        atualizarBotaoMic();
        if (currentRoom) socket.emit('mic-status', { code: currentRoom.code, userId: currentUser.id, muted: false });
      }, 300);
    });
    return;
  }
  micMuted = !micMuted;
  localStream.getAudioTracks().forEach(t => { t.enabled = !micMuted; });
  atualizarBotaoMic();
  if (currentRoom) socket.emit('mic-status', { code: currentRoom.code, userId: currentUser.id, muted: micMuted });
}

function atualizarBotaoMic() {
  const btn = document.getElementById('btn-mic');
  if (!btn) return;
  if (micMuted) {
    btn.textContent = '🔇 Microfone';
    btn.classList.remove('mic-on');
    btn.classList.add('mic-off');
  } else {
    btn.textContent = '🎙️ Microfone';
    btn.classList.remove('mic-off');
    btn.classList.add('mic-on');
  }
}

// Cria peer connection com outro socket
function criarPeer(socketId, isInitiator) {
  if (peers[socketId]) peers[socketId].close();
  const pc = new RTCPeerConnection(RTC_CONFIG);
  peers[socketId] = pc;

  // Adiciona stream local se tiver
  if (localStream) {
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  }

  // Quando recebe audio remoto, cria elemento de audio
  pc.ontrack = (e) => {
    let audioEl = document.getElementById('audio-' + socketId);
    if (!audioEl) {
      audioEl = document.createElement('audio');
      audioEl.id = 'audio-' + socketId;
      audioEl.autoplay = true;
      document.body.appendChild(audioEl);
    }
    audioEl.srcObject = e.streams[0];
  };

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      socket.emit('webrtc-ice', { to: socketId, candidate: e.candidate });
    }
  };

  pc.onconnectionstatechange = () => {
    console.log('Peer', socketId, 'estado:', pc.connectionState);
    if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
      removerPeer(socketId);
    }
  };

  if (isInitiator) {
    pc.createOffer().then(offer => {
      pc.setLocalDescription(offer);
      socket.emit('webrtc-offer', { to: socketId, offer });
    });
  }

  return pc;
}

function removerPeer(socketId) {
  if (peers[socketId]) {
    peers[socketId].close();
    delete peers[socketId];
  }
  const audioEl = document.getElementById('audio-' + socketId);
  if (audioEl) audioEl.remove();
}

function pararAudio() {
  // Fecha todos os peers
  Object.keys(peers).forEach(id => removerPeer(id));
  // Para stream local
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }
  micMuted = true;
  atualizarBotaoMic();
}

// ---- SOCKET WebRTC ----
socket.on('peer-joined', async ({ socketId, userId }) => {
  console.log('peer entrou:', socketId, userId);
  // Apenas inicia peer se tiver microfone ativo
  if (localStream) {
    criarPeer(socketId, true);
  }
});

socket.on('webrtc-offer', async ({ from, offer }) => {
  if (!localStream) await ativarMicrofone();
  const pc = criarPeer(from, false);
  await pc.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit('webrtc-answer', { to: from, answer });
});

socket.on('webrtc-answer', async ({ from, answer }) => {
  const pc = peers[from];
  if (pc) await pc.setRemoteDescription(new RTCSessionDescription(answer));
});

socket.on('webrtc-ice', async ({ from, candidate }) => {
  const pc = peers[from];
  if (pc && candidate) {
    try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch(e) {}
  }
});

socket.on('peer-left', ({ socketId }) => {
  removerPeer(socketId);
});

socket.on('mic-status', ({ userId, muted }) => {
  // Atualiza indicador visual no card do jogador
  const indicator = document.querySelector('[data-userid="' + userId + '"] .mic-indicator');
  if (indicator) {
    indicator.textContent = muted ? '🔇' : '🎙️';
    indicator.classList.toggle('falando', !muted);
  }
});

// ---- AUTENTICACAO / TELAS ----
async function checkAuth() {
  const res = await fetch('/api/me');
  const data = await res.json();
  if (data.user) {
    currentUser = data.user;
    showHome(data.user);
  } else {
    showLogin();
  }
}

function showLogin() {
  document.getElementById('login-screen').classList.add('active');
  document.getElementById('home-screen').classList.remove('active');
  document.getElementById('join-screen').classList.remove('active');
  document.getElementById('room-screen').classList.remove('active');
}

function showHome(user) {
  document.getElementById('login-screen').classList.remove('active');
  document.getElementById('home-screen').classList.add('active');
  document.getElementById('join-screen').classList.remove('active');
  document.getElementById('room-screen').classList.remove('active');

  const name = user.displayName || user.name || 'Jogador';
  const photo = (user.photos && user.photos[0]) ? user.photos[0].value : '';
  document.getElementById('welcome-name').textContent = name.split(' ')[0];
  document.getElementById('user-name').textContent = name.split(' ')[0];
  const avatar = document.getElementById('user-avatar');
  if (photo) { avatar.src = photo; avatar.style.display = 'block'; }
}

function showJoin() {
  document.getElementById('login-screen').classList.remove('active');
  document.getElementById('home-screen').classList.remove('active');
  document.getElementById('join-screen').classList.add('active');
  document.getElementById('room-screen').classList.remove('active');
  document.getElementById('input-codigo').value = '';
  carregarSalas();
}

async function carregarSalas() {
  const lista = document.getElementById('salas-lista');
  lista.innerHTML = '<div class="salas-loading">Carregando...</div>';
  try {
    const res = await fetch('/api/rooms');
    const data = await res.json();
    const salas = data.rooms;
    if (!salas || salas.length === 0) {
      lista.innerHTML = '<div class="salas-vazio">Nenhuma sala aberta no momento.<br>Que tal criar uma?</div>';
      return;
    }
    lista.innerHTML = '';
    salas.forEach(sala => {
      const div = document.createElement('div');
      div.className = 'sala-item';
      div.innerHTML =
        '<div class="sala-info">' +
        '<span class="sala-codigo">' + sala.code + '</span>' +
        '<span class="sala-host">Host: ' + sala.host + '</span>' +
        '</div>' +
        '<div class="sala-right">' +
        '<span class="sala-players">\u{1F465} ' + sala.players + ' jogadores</span>' +
        '<button class="btn-entrar-sala" data-code="' + sala.code + '">Entrar</button>' +
        '</div>';
      lista.appendChild(div);
    });
    lista.querySelectorAll('.btn-entrar-sala').forEach(btn => {
      btn.addEventListener('click', () => entrarNaSala(btn.dataset.code));
    });
  } catch (e) {
    lista.innerHTML = '<div class="salas-vazio">Erro ao carregar salas.</div>';
  }
}

async function entrarNaSala(code) {
  const res = await fetch('/api/rooms/' + code.toUpperCase() + '/join', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }
  });
  const data = await res.json();
  if (data.error) { alert(data.error); return; }
  showRoom(data.room);
}

function showRoom(room) {
  document.getElementById('login-screen').classList.remove('active');
  document.getElementById('home-screen').classList.remove('active');
  document.getElementById('join-screen').classList.remove('active');
  document.getElementById('room-screen').classList.add('active');
  currentRoom = room;
  renderRoom(room);
  socket.emit('join-room', { code: room.code, userId: currentUser ? currentUser.id : null });
}

function renderRoom(room) {
  document.getElementById('room-code').textContent = room.code;
  document.getElementById('room-players-count').textContent = room.players.length;
  document.getElementById('room-min').textContent = room.minPlayers;

  const list = document.getElementById('players-list');
  list.innerHTML = '';
  room.players.forEach(p => {
    const div = document.createElement('div');
    div.className = 'player-item';
    div.setAttribute('data-userid', p.id);
    const initials = p.name.charAt(0).toUpperCase();
    const micIcon = '<span class="mic-indicator">🔇</span>';
    div.innerHTML = p.photo
      ? '<img src="' + p.photo + '" class="player-avatar-img"><div class="player-info"><span class="player-name">' + p.name + (p.isHost ? ' <span class="host-badge">HOST</span>' : '') + '</span>' + micIcon + '</div>'
      : '<div class="player-avatar-placeholder">' + initials + '</div><div class="player-info"><span class="player-name">' + p.name + (p.isHost ? ' <span class="host-badge">HOST</span>' : '') + '</span>' + micIcon + '</div>';
    list.appendChild(div);
  });

  const startBtn = document.getElementById('btn-start');
  const fakeBtn = document.getElementById('btn-add-fake');
  const isHost = currentUser && room.host === currentUser.id;

  if (isHost) {
    startBtn.style.display = 'block';
    const canStart = room.players.length >= room.minPlayers;
    startBtn.disabled = !canStart;
    startBtn.title = canStart ? '' : 'Precisa de pelo menos ' + room.minPlayers + ' jogadores';
    if (fakeBtn) fakeBtn.style.display = room.players.length < room.minPlayers ? 'block' : 'none';
  } else {
    startBtn.style.display = 'none';
    if (fakeBtn) fakeBtn.style.display = 'none';
  }
}

// ---- EVENTOS ----
document.getElementById('card-criar').addEventListener('click', async () => {
  const res = await fetch('/api/rooms', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({})
  });
  const data = await res.json();
  if (data.error) { alert(data.error); return; }
  showRoom(data.room);
});

document.getElementById('card-entrar').addEventListener('click', () => showJoin());
document.getElementById('btn-voltar-join').addEventListener('click', () => showHome(currentUser));
document.getElementById('btn-atualizar').addEventListener('click', () => carregarSalas());

document.getElementById('btn-buscar-codigo').addEventListener('click', () => {
  const codigo = document.getElementById('input-codigo').value.trim().toUpperCase();
  if (!codigo) { alert('Digite o codigo da sala'); return; }
  entrarNaSala(codigo);
});

document.getElementById('input-codigo').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-buscar-codigo').click();
  document.getElementById('input-codigo').value = document.getElementById('input-codigo').value.toUpperCase();
});

document.getElementById('btn-sair-sala').addEventListener('click', async () => {
  if (!currentRoom) return;
  pararAudio();
  await fetch('/api/rooms/' + currentRoom.code + '/leave', { method: 'DELETE' });
  currentRoom = null;
  showHome(currentUser);
});

document.getElementById('btn-mic').addEventListener('click', () => {
  toggleMic();
});

document.getElementById('btn-add-fake').addEventListener('click', async () => {
  if (!currentRoom) return;
  const res = await fetch('/api/rooms/' + currentRoom.code + '/add-fake-players', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }
  });
  const data = await res.json();
  if (data.error) { alert(data.error); return; }
  currentRoom = data.room;
  renderRoom(data.room);
});

socket.on('room-update', (room) => {
  if (currentRoom && room.code === currentRoom.code) {
    currentRoom = room;
    renderRoom(room);
  }
});

checkAuth();
