const socket = io();
let currentUser = null;
let currentRoom = null;

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
          '<span class="sala-players">👤 ' + sala.players + ' jogadores</span>' +
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
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
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
  socket.emit('join-room', { code: room.code });
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
    const initials = p.name.charAt(0).toUpperCase();
    div.innerHTML = p.photo
      ? '<img src="' + p.photo + '" class="player-avatar-img"><span class="player-name">' + p.name + (p.isHost ? ' <span class="host-badge">HOST</span>' : '') + '</span>'
      : '<div class="player-avatar-placeholder">' + initials + '</div><span class="player-name">' + p.name + (p.isHost ? ' <span class="host-badge">HOST</span>' : '') + '</span>';
    list.appendChild(div);
  });

  const startBtn = document.getElementById('btn-start');
  if (currentUser && room.host === currentUser.id) {
    startBtn.style.display = 'block';
    const canStart = room.players.length >= room.minPlayers;
    startBtn.disabled = !canStart;
    startBtn.title = canStart ? '' : 'Precisa de pelo menos ' + room.minPlayers + ' jogadores';
  } else {
    startBtn.style.display = 'none';
  }
}

// EVENTOS
document.getElementById('card-criar').addEventListener('click', async () => {
  const res = await fetch('/api/rooms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  const data = await res.json();
  if (data.error) { alert(data.error); return; }
  showRoom(data.room);
});

document.getElementById('card-entrar').addEventListener('click', () => {
  showJoin();
});

document.getElementById('btn-voltar-join').addEventListener('click', () => {
  showHome(currentUser);
});

document.getElementById('btn-atualizar').addEventListener('click', () => {
  carregarSalas();
});

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
  await fetch('/api/rooms/' + currentRoom.code + '/leave', { method: 'DELETE' });
  currentRoom = null;
  showHome(currentUser);
});

socket.on('room-update', (room) => {
  if (currentRoom && room.code === currentRoom.code) {
    currentRoom = room;
    renderRoom(room);
  }
});

checkAuth();
