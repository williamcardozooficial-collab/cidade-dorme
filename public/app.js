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
  document.getElementById('room-screen').classList.remove('active');
}

function showHome(user) {
  document.getElementById('login-screen').classList.remove('active');
  document.getElementById('home-screen').classList.add('active');
  document.getElementById('room-screen').classList.remove('active');

  const name = user.displayName || user.name || 'Jogador';
  const photo = (user.photos && user.photos[0]) ? user.photos[0].value : '';

  document.getElementById('welcome-name').textContent = name.split(' ')[0];
  document.getElementById('user-name').textContent = name.split(' ')[0];

  const avatar = document.getElementById('user-avatar');
  if (photo) { avatar.src = photo; avatar.style.display = 'block'; }
}

function showRoom(room) {
  document.getElementById('login-screen').classList.remove('active');
  document.getElementById('home-screen').classList.remove('active');
  document.getElementById('room-screen').classList.add('active');
  currentRoom = room;
  renderRoom(room);
  socket.emit('join-room', { code: room.code });
}

function renderRoom(room) {
  document.getElementById('room-code').textContent = room.code;
  document.getElementById('room-players-count').textContent = room.players.length + ' / ' + room.maxPlayers;
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

// Modal criar sala
document.getElementById('card-criar').addEventListener('click', () => {
  document.getElementById('modal-criar').classList.add('active');
});

document.getElementById('btn-fechar-modal').addEventListener('click', () => {
  document.getElementById('modal-criar').classList.remove('active');
});

document.getElementById('modal-criar').addEventListener('click', (e) => {
  if (e.target === document.getElementById('modal-criar')) {
    document.getElementById('modal-criar').classList.remove('active');
  }
});

document.getElementById('btn-confirmar-criar').addEventListener('click', async () => {
  const max = parseInt(document.getElementById('input-max-players').value);
  if (isNaN(max) || max < 5 || max > 50) {
    alert('Numero de jogadores deve ser entre 5 e 50');
    return;
  }

  const res = await fetch('/api/rooms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ maxPlayers: max })
  });

  const data = await res.json();
  if (data.error) { alert(data.error); return; }

  document.getElementById('modal-criar').classList.remove('active');
  showRoom(data.room);
});

document.getElementById('card-entrar').addEventListener('click', () => {
  alert('Em breve: Entrar em Sala!');
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