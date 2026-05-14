const socket = io();
let currentUser = null;
let currentRoom = null;
let countdownInterval = null;

// ---- AUDIO / WebRTC ----
let localStream = null;
let micMuted = true;
let peers = {};
const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

async function ativarMicrofone() {
  if (localStream) return;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    localStream.getAudioTracks().forEach(t => { t.enabled = false; });
    micMuted = true;
    atualizarBotaoMic();
  } catch (e) {
    alert('Nao foi possivel acessar o microfone. Verifique as permissoes do navegador.');
  }
}

function forceMute() {
  if (!localStream) return;
  micMuted = true;
  localStream.getAudioTracks().forEach(t => { t.enabled = false; });
  atualizarBotaoMic();
  if (currentRoom) socket.emit('mic-status', { code: currentRoom.code, userId: currentUser.id, muted: true });
}

function toggleMic() {
  if (!localStream) {
    ativarMicrofone().then(() => {
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

function criarPeer(socketId, isInitiator) {
  if (peers[socketId]) peers[socketId].close();
  const pc = new RTCPeerConnection(RTC_CONFIG);
  peers[socketId] = pc;
  if (localStream) localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
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
    if (e.candidate) socket.emit('webrtc-ice', { to: socketId, candidate: e.candidate });
  };
  pc.onconnectionstatechange = () => {
    if (['disconnected','failed','closed'].includes(pc.connectionState)) removerPeer(socketId);
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
  if (peers[socketId]) { peers[socketId].close(); delete peers[socketId]; }
  const el = document.getElementById('audio-' + socketId);
  if (el) el.remove();
}

function pararAudio() {
  Object.keys(peers).forEach(id => removerPeer(id));
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  micMuted = true;
  atualizarBotaoMic();
}

// ---- SOCKET WebRTC ----
socket.on('peer-joined', ({ socketId }) => {
  if (localStream) criarPeer(socketId, true);
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
  if (pc && candidate) { try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch(e) {} }
});
socket.on('peer-left', ({ socketId }) => removerPeer(socketId));
socket.on('mic-status', ({ userId, muted }) => {
  const indicator = document.querySelector('[data-userid="' + userId + '"] .mic-indicator');
  if (indicator) {
    indicator.textContent = muted ? '🔇' : '🎙️';
    indicator.classList.toggle('falando', !muted);
  }
});

// ---- TELAS ----
function hideAll() {
  ['login-screen','home-screen','join-screen','room-screen','game-screen'].forEach(id => {
    document.getElementById(id).classList.remove('active');
  });
}

async function checkAuth() {
  const res = await fetch('/api/me');
  const data = await res.json();
  if (data.user) { currentUser = data.user; showHome(data.user); }
  else showLogin();
}

function showLogin()  { hideAll(); document.getElementById('login-screen').classList.add('active'); }

function showHome(user) {
  hideAll(); document.getElementById('home-screen').classList.add('active');
  const name = user.displayName || user.name || 'Jogador';
  const photo = (user.photos && user.photos[0]) ? user.photos[0].value : '';
  document.getElementById('welcome-name').textContent = name.split(' ')[0];
  document.getElementById('user-name').textContent = name.split(' ')[0];
  const avatar = document.getElementById('user-avatar');
  if (photo) { avatar.src = photo; avatar.style.display = 'block'; }
}

function showJoin() {
  hideAll(); document.getElementById('join-screen').classList.add('active');
  document.getElementById('input-codigo').value = '';
  carregarSalas();
}

function showRoom(room) {
  hideAll(); document.getElementById('room-screen').classList.add('active');
  currentRoom = room;
  renderRoom(room);
  socket.emit('join-room', { code: room.code, userId: currentUser ? currentUser.id : null });
}

// ---- TELA DE JOGO (noite) ----
function showGame(data) {
  hideAll();
  document.getElementById('game-screen').classList.add('active');

  const isAssassino = currentUser && data.assassinoId === currentUser.id;

  // Papel do jogador
  const roleEl = document.getElementById('game-role');
  const roleDescEl = document.getElementById('game-role-desc');
  if (isAssassino) {
    roleEl.textContent = '🔪 Você é o ASSASSINO';
    roleEl.className = 'game-role assassino';
    roleDescEl.textContent = 'Escolha sua vítima. Você tem 60 segundos.';
  } else {
    roleEl.textContent = '😴 Você é um CIDADÃO';
    roleEl.className = 'game-role cidadao';
    roleDescEl.textContent = 'A cidade dorme... O assassino está agindo.';
  }

  // Lista de vítimas (só para o assassino)
  const vitimasSection = document.getElementById('vitimas-section');
  const vitimasList = document.getElementById('vitimas-list');
  if (isAssassino) {
    vitimasSection.style.display = 'block';
    vitimasList.innerHTML = '';
    data.vitimas.forEach(v => {
      const btn = document.createElement('button');
      btn.className = 'btn-vitima';
      btn.setAttribute('data-id', v.id);
      btn.innerHTML = (v.photo ? '<img src="' + v.photo + '" class="vitima-avatar">' : '<div class="vitima-avatar-placeholder">' + v.name.charAt(0) + '</div>') +
        '<span>' + v.name + '</span>';
      btn.addEventListener('click', () => escolherVitima(v.id));
      vitimasList.appendChild(btn);
    });
  } else {
    vitimasSection.style.display = 'none';
  }

  // Mensagem de resultado (escondida)
  document.getElementById('kill-result-box').style.display = 'none';
  document.getElementById('game-overlay-text').textContent = '';

  // Inicia countdown
  iniciarCountdown(data.segundos || 60);

  // Fecha microfone de todos
  forceMute();
  const btnMic = document.getElementById('btn-mic');
  if (btnMic) { btnMic.disabled = true; btnMic.title = 'Microfone bloqueado durante a noite'; }
}

function iniciarCountdown(segundos) {
  if (countdownInterval) clearInterval(countdownInterval);
  let restante = segundos;
  const el = document.getElementById('game-countdown');
  const bar = document.getElementById('countdown-bar');

  function tick() {
    if (restante < 0) { clearInterval(countdownInterval); return; }
    el.textContent = restante + 's';
    const pct = (restante / segundos) * 100;
    bar.style.width = pct + '%';
    bar.style.background = restante > 20 ? '#6060ff' : restante > 10 ? '#ffaa00' : '#ff4444';
    restante--;
  }
  tick();
  countdownInterval = setInterval(tick, 1000);
}

async function escolherVitima(vitimaId) {
  if (!currentRoom) return;
  // Desabilita todos os botoes para evitar duplo clique
  document.querySelectorAll('.btn-vitima').forEach(b => { b.disabled = true; b.classList.add('escolhida'); });
  const res = await fetch('/api/rooms/' + currentRoom.code + '/kill', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vitimaId })
  });
  const data = await res.json();
  if (data.error) { alert(data.error); document.querySelectorAll('.btn-vitima').forEach(b => { b.disabled = false; b.classList.remove('escolhida'); }); }
}

// ---- RESULTADO DO ASSASSINATO ----
socket.on('kill-result', (data) => {
  if (countdownInterval) clearInterval(countdownInterval);

  const isAssassino = currentUser && data.assassinoId === currentUser.id;
  const isVitima = currentUser && data.vitima.id === currentUser.id;

  // Para todos: mostra overlay na tela de jogo
  const box = document.getElementById('kill-result-box');
  const countdown = document.getElementById('game-countdown');
  const bar = document.getElementById('countdown-bar');

  countdown.textContent = '0s';
  bar.style.width = '0%';

  box.style.display = 'flex';

  const icon = document.getElementById('kill-icon');
  const msg = document.getElementById('kill-msg');
  const sub = document.getElementById('kill-sub');

  if (data.forcado) {
    icon.textContent = '☠️';
    msg.textContent = data.vitima.name + ' foi assassinado!';
    sub.textContent = 'O assassino agiu no último segundo...';
  } else {
    icon.textContent = '🔪';
    msg.textContent = data.vitima.name + ' foi assassinado!';
    sub.textContent = isAssassino ? 'Você escolheu sua vítima.' : isVitima ? 'Você foi eliminado!' : 'O assassino fez sua escolha.';
  }

  // Destaca vítima escolhida (se for assassino)
  if (isAssassino) {
    document.querySelectorAll('.btn-vitima').forEach(b => {
      if (b.getAttribute('data-id') === data.vitima.id) b.classList.add('morta');
    });
  }

  // Reabilita microfone após 3s
  setTimeout(() => {
    const btnMic = document.getElementById('btn-mic');
    if (btnMic) { btnMic.disabled = false; btnMic.title = ''; }
  }, 3000);
});

// ---- SALA ----
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
        '<div class="sala-info"><span class="sala-codigo">' + sala.code + '</span><span class="sala-host">Host: ' + sala.host + '</span></div>' +
        '<div class="sala-right"><span class="sala-players">👥 ' + sala.players + ' jogadores</span>' +
        '<button class="btn-entrar-sala" data-code="' + sala.code + '">Entrar</button></div>';
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
  const res = await fetch('/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
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

document.getElementById('btn-mic').addEventListener('click', () => toggleMic());

document.getElementById('btn-add-fake').addEventListener('click', async () => {
  if (!currentRoom) return;
  const res = await fetch('/api/rooms/' + currentRoom.code + '/add-fake-players', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
  const data = await res.json();
  if (data.error) { alert(data.error); return; }
  currentRoom = data.room;
  renderRoom(data.room);
});

document.getElementById('btn-start').addEventListener('click', async () => {
  if (!currentRoom) return;
  const res = await fetch('/api/rooms/' + currentRoom.code + '/start', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
  const data = await res.json();
  if (data.error) { alert(data.error); }
});

socket.on('room-update', (room) => {
  if (currentRoom && room.code === currentRoom.code) {
    currentRoom = room;
    renderRoom(room);
  }
});

// Servidor emite game-night para todos na sala
socket.on('game-night', (data) => {
  showGame(data);
});

checkAuth();
