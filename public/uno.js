// UNO Client
const socket = io();
let currentUser = null;
let currentRoom = null;
let minhasMao = [];
let vezAtualId = null;
let corAtual = null;
let aguardandoCorEscolha = false;
let cartaEspecialPendente = null;

const COR_EMOJI = { vermelho: '🔴', azul: '🔵', verde: '🟢', amarelo: '🟡' };
const COR_CLASS = { vermelho: 'vermelho', azul: 'azul', verde: 'verde', amarelo: 'amarelo' };

const ALL_SCREENS = ['login-screen','home-screen','join-screen','room-screen','game-screen','end-screen'];
function hideAll() { ALL_SCREENS.forEach(id => { const el = document.getElementById(id); if (el) el.classList.remove('active'); }); }
function showScreen(id) { hideAll(); const el = document.getElementById(id); if (el) el.classList.add('active'); }

async function checkAuth() {
  const res = await fetch('/api/me');
  const data = await res.json();
  if (data.user) { currentUser = data.user; showHome(data.user); }
  else showScreen('login-screen');
}

function showHome(user) {
  showScreen('home-screen');
  const name = user.displayName || user.name || 'Jogador';
  const photo = (user.photos && user.photos[0]) ? user.photos[0].value : '';
  document.getElementById('welcome-name').textContent = name.split(' ')[0];
  document.getElementById('user-name').textContent = name.split(' ')[0];
  const avatar = document.getElementById('user-avatar');
  if (photo) { avatar.src = photo; avatar.style.display = 'block'; }
  mostrarChat();
}

function showJoin() {
  showScreen('join-screen');
  document.getElementById('input-codigo').value = '';
  carregarSalas();
}

function showRoom(room) {
  currentRoom = room;
  showScreen('room-screen');
  renderRoom(room);
  socket.emit('uno-join-room', { code: room.code, userId: currentUser ? currentUser.id : null });
  mostrarChat();
}

function showGame(room) {
  currentRoom = room;
  showScreen('game-screen');
  mostrarChat();
}

function showEnd(data) {
  showScreen('end-screen');
  document.getElementById('end-icon').textContent = '🏆';
  document.getElementById('end-title').textContent = 'Fim de Jogo!';
  const sub = data.vencedor ? (data.vencedor.name + ' venceu!') : 'Jogo encerrado!';
  document.getElementById('end-sub').textContent = sub;
  const rankEl = document.getElementById('end-ranking');
  rankEl.innerHTML = '';
  if (data.ranking && data.ranking.length) {
    data.ranking.forEach((p, i) => {
      const div = document.createElement('div');
      div.className = 'end-ranking-item';
      const medals = ['🥇','🥈','🥉'];
      div.innerHTML = '<span class="end-rank-num">' + (medals[i] || (i+1)+'°') + '</span><span class="end-rank-name">' + p.name + '</span><span class="end-rank-cards">' + p.cartas + ' cartas restantes</span>';
      rankEl.appendChild(div);
    });
  }
}

function renderRoom(room) {
  document.getElementById('room-code').textContent = room.code;
  document.getElementById('room-players-count').textContent = room.players.length;
  const list = document.getElementById('players-list');
  list.innerHTML = '';
  room.players.forEach(p => {
    const div = document.createElement('div');
    div.className = 'player-item';
    const initials = p.name.charAt(0).toUpperCase();
    div.innerHTML = p.photo ? '<img src="' + p.photo + '" class="player-avatar-img"><div class="player-info"><span class="player-name">' + p.name + (p.isHost ? ' <span class="host-badge">HOST</span>' : '') + '</span></div>'
      : '<div class="player-avatar-placeholder">' + initials + '</div><div class="player-info"><span class="player-name">' + p.name + (p.isHost ? ' <span class="host-badge">HOST</span>' : '') + '</span></div>';
    list.appendChild(div);
  });
  const startBtn = document.getElementById('btn-start');
  const isHost = currentUser && room.host === currentUser.id;
  if (isHost && room.status === 'waiting') {
    startBtn.style.display = 'block';
    startBtn.disabled = room.players.length < 2;
    startBtn.title = room.players.length < 2 ? 'Precisa de pelo menos 2 jogadores' : '';
  } else { startBtn.style.display = 'none'; }
}

function renderPlayersBar(playersInfo) {
  const bar = document.getElementById('players-info-bar');
  if (!bar) return;
  bar.innerHTML = '';
  playersInfo.forEach(p => {
    const div = document.createElement('div');
    div.className = 'player-bubble' + (p.id === vezAtualId ? ' vez-atual' : '');
    div.id = 'bubble-' + p.id;
    const avatarHtml = p.photo ? '<img src="' + p.photo + '" alt="">' : '<div class="pb-avatar">' + p.name.charAt(0) + '</div>';
    const unoTag = p.cartas === 1 ? '<span class="pb-uno">UNO!</span>' : '';
    div.innerHTML = avatarHtml + '<span class="pb-name">' + p.name.split(' ')[0] + '</span><span class="pb-cards">' + p.cartas + '</span>' + unoTag;
    bar.appendChild(div);
  });
}

function renderMinhaMao(cartas) {
  minhasMao = cartas;
  const maoEl = document.getElementById('minha-mao');
  maoEl.innerHTML = '';
  document.getElementById('minha-contagem').textContent = cartas.length;
  const isMyTurn = currentUser && vezAtualId === currentUser.id;
  cartas.forEach(carta => {
    const el = criarCartaEl(carta, isMyTurn && podeJogar(carta));
    el.addEventListener('click', () => { if (!isMyTurn) { toast('Aguarde sua vez!'); return; } if (!podeJogar(carta)) { toast('Nao pode jogar esta carta agora.'); return; } jogarCarta(carta); });
    maoEl.appendChild(el);
  });
  // Mostrar botao UNO se tiver 2 cartas (antes de jogar ultima)
  const btnUnoWrap = document.getElementById('btn-uno-wrap');
  if (btnUnoWrap) btnUnoWrap.style.display = isMyTurn && cartas.length === 2 ? 'flex' : 'none';
}

function criarCartaEl(carta, jogavel) {
  const el = document.createElement('div');
  const corClass = carta.cor === 'preto' || carta.cor === 'especial' ? 'preto' : (COR_CLASS[carta.cor] || 'preto');
  el.className = 'uno-card ' + corClass + (jogavel ? ' jogavel' : ' disabled');
  const val = getCartaDisplay(carta);
  el.innerHTML = '<span class="card-val">' + val.icon + '</span>' + (val.label ? '<span class="card-label">' + val.label + '</span>' : '');
  el.setAttribute('data-carta-id', carta.id);
  return el;
}

function getCartaDisplay(carta) {
  const v = carta.valor;
  if (v === 'pular') return { icon: '🚫', label: 'Pular' };
  if (v === 'inverter') return { icon: '🔄', label: 'Inv.' };
  if (v === 'mais2') return { icon: '+2', label: '' };
  if (v === 'curinga') return { icon: '⭐', label: 'Cor' };
  if (v === 'mais4') return { icon: '+4', label: '' };
  return { icon: v, label: '' };
}

function renderDescarte(carta, corVigorante) {
  const pile = document.getElementById('discard-pile');
  if (!carta) { pile.innerHTML = '<div class="card-placeholder">Aguardando...</div>'; return; }
  const corDisplay = carta.cor === 'preto' ? corVigorante : carta.cor;
  const corClass = corDisplay ? (COR_CLASS[corDisplay] || 'preto') : 'preto';
  const val = getCartaDisplay(carta);
  pile.innerHTML = '';
  const el = document.createElement('div');
  el.className = 'uno-card ' + corClass;
  el.style.cursor = 'default';
  el.innerHTML = '<span class="card-val">' + val.icon + '</span>' + (val.label ? '<span class="card-label">' + val.label + '</span>' : '');
  pile.appendChild(el);

  const badge = document.getElementById('cor-atual-badge');
  if (badge) {
    if (corVigorante && corVigorante !== 'preto') {
      badge.textContent = COR_EMOJI[corVigorante] + ' ' + corVigorante.charAt(0).toUpperCase() + corVigorante.slice(1);
      badge.className = 'cor-atual-badge ' + (COR_CLASS[corVigorante] || '');
      badge.style.display = 'block';
    } else {
      badge.style.display = 'none';
    }
  }
}

function podeJogar(carta) {
  if (!currentRoom || !currentRoom.jogo) return false;
  const desc = currentRoom.jogo.descarte;
  const cor = corAtual || (desc ? desc.cor : null);
  if (carta.cor === 'preto') return true;
  if (desc && carta.valor === desc.valor) return true;
  if (cor && carta.cor === cor) return true;
  return false;
}

async function jogarCarta(carta) {
  if (!currentRoom) return;
  if (carta.cor === 'preto') {
    // Mostrar color picker
    cartaEspecialPendente = carta;
    aguardandoCorEscolha = true;
    document.getElementById('color-picker').style.display = 'block';
    return;
  }
  enviarJogada(carta.id, null);
}

async function escolherCor(cor) {
  document.getElementById('color-picker').style.display = 'none';
  if (!aguardandoCorEscolha || !cartaEspecialPendente) return;
  aguardandoCorEscolha = false;
  enviarJogada(cartaEspecialPendente.id, cor);
  cartaEspecialPendente = null;
}

async function enviarJogada(cartaId, corEscolhida) {
  if (!currentRoom) return;
  const body = { cartaId };
  if (corEscolhida) body.corEscolhida = corEscolhida;
  const res = await fetch('/api/uno/' + currentRoom.code + '/jogar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (data.error) toast('Erro: ' + data.error);
}

async function comprarCarta() {
  if (!currentRoom) return;
  if (currentUser && vezAtualId !== currentUser.id) { toast('Nao e sua vez!'); return; }
  const res = await fetch('/api/uno/' + currentRoom.code + '/comprar', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
  const data = await res.json();
  if (data.error) toast('Erro: ' + data.error);
}

async function gritarUno() {
  if (!currentRoom) return;
  await fetch('/api/uno/' + currentRoom.code + '/uno', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
}

function atualizarTurno(data) {
  vezAtualId = data.vezId;
  corAtual = data.corAtual;
  document.getElementById('deck-count').textContent = data.deckCount || '?';
  const turnoEl = document.getElementById('turno-info');
  const isMyTurn = currentUser && data.vezId === currentUser.id;
  if (isMyTurn) { turnoEl.textContent = '🃏 SUA VEZ!'; turnoEl.style.color = '#f4d03f'; }
  else { const nome = data.vezNome || 'Jogador'; turnoEl.textContent = 'Vez de ' + nome; turnoEl.style.color = '#fff'; }
  renderDescarte(data.descarte, data.corAtual);
  if (data.playersInfo) renderPlayersBar(data.playersInfo);
  if (data.minhasMao) renderMinhaMao(data.minhasMao);
  else renderMinhaMaoDesatualizada();
}

function renderMinhaMaoDesatualizada() {
  const isMyTurn = currentUser && vezAtualId === currentUser.id;
  const maoEl = document.getElementById('minha-mao');
  maoEl.innerHTML = '';
  minhasMao.forEach(carta => {
    const el = criarCartaEl(carta, isMyTurn && podeJogar(carta));
    el.addEventListener('click', () => { if (!isMyTurn) { toast('Aguarde sua vez!'); return; } if (!podeJogar(carta)) { toast('Nao pode jogar esta carta agora.'); return; } jogarCarta(carta); });
    maoEl.appendChild(el);
  });
  document.getElementById('minha-contagem').textContent = minhasMao.length;
  const btnUnoWrap = document.getElementById('btn-uno-wrap');
  if (btnUnoWrap) btnUnoWrap.style.display = isMyTurn && minhasMao.length === 2 ? 'flex' : 'none';
}

function toast(msg, tipo) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const div = document.createElement('div');
  div.className = 'toast';
  div.textContent = msg;
  if (tipo === 'erro') div.style.borderColor = '#e63946';
  else if (tipo === 'ok') div.style.borderColor = '#2d6a4f';
  container.appendChild(div);
  setTimeout(() => { if (div.parentNode) div.parentNode.removeChild(div); }, 4000);
}

function copiarCodigo() {
  if (!currentRoom) return;
  navigator.clipboard.writeText(currentRoom.code).then(() => toast('Codigo copiado!', 'ok')).catch(() => toast('Erro ao copiar'));
}

async function carregarSalas() {
  const lista = document.getElementById('salas-lista');
  lista.innerHTML = '<div class="salas-loading">Carregando...</div>';
  try {
    const res = await fetch('/api/uno/rooms');
    const data = await res.json();
    const salas = data.rooms || [];
    if (salas.length === 0) { lista.innerHTML = '<div class="salas-vazio">Nenhuma sala aberta. Crie uma!</div>'; return; }
    lista.innerHTML = '';
    salas.forEach(sala => {
      const div = document.createElement('div');
      div.className = 'sala-item';
      const statusLabel = sala.status === 'waiting' ? '<span class="sala-status-aguardando">⏳ Aguardando</span>' : '<span class="sala-status-jogo">🃏 Em jogo</span>';
      div.innerHTML = '<div class="sala-info"><span class="sala-codigo">' + sala.code + '</span><span class="sala-host">Host: ' + sala.host + '</span></div><div class="sala-right">' + statusLabel + '<span class="sala-players">👥 ' + sala.players + '</span><button class="btn-entrar-sala" data-code="' + sala.code + '">' + (sala.status === 'waiting' ? 'Entrar' : 'Observar') + '</button></div>';
      lista.appendChild(div);
    });
    lista.querySelectorAll('.btn-entrar-sala').forEach(btn => { btn.addEventListener('click', () => entrarNaSala(btn.dataset.code)); });
  } catch(e) { lista.innerHTML = '<div class="salas-vazio">Erro ao carregar salas.</div>'; }
}

async function entrarNaSala(code) {
  const res = await fetch('/api/uno/' + code.toUpperCase() + '/join', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
  const data = await res.json();
  if (data.error) { toast(data.error, 'erro'); return; }
  showRoom(data.room);
}

// Socket events
socket.on('uno-room-update', (room) => {
  if (currentRoom && room.code === currentRoom.code) {
    currentRoom = room;
    if (document.getElementById('room-screen').classList.contains('active')) renderRoom(room);
  }
});

socket.on('uno-jogo-iniciado', (data) => {
  currentRoom = data.room;
  showGame(data.room);
  minhasMao = [];
  vezAtualId = null;
  corAtual = null;
  toast('Jogo iniciado! Boa sorte!', 'ok');
});

socket.on('uno-estado', (data) => {
  if (!document.getElementById('game-screen').classList.contains('active')) showGame(currentRoom);
  currentRoom = currentRoom || {};
  currentRoom.jogo = data;
  atualizarTurno(data);
  if (data.minhasMao) { minhasMao = data.minhasMao; renderMinhaMao(data.minhasMao); }
});

socket.on('uno-carta-comprada', (data) => {
  if (currentUser && data.jogadorId === currentUser.id) {
    toast('Você comprou ' + (data.quantidade || 1) + ' carta(s)!');
    if (data.cartas) { minhasMao = data.cartas; renderMinhaMao(data.cartas); }
  } else {
    const nome = data.jogadorNome || 'Jogador';
    toast(nome + ' comprou ' + (data.quantidade || 1) + ' carta(s)');
  }
});

socket.on('uno-efeito', (data) => {
  const msgs = {
    pular: '🚫 ' + (data.alvoNome || 'Jogador') + ' foi pulado!',
    inverter: '🔄 Ordem invertida!',
    mais2: '➕ ' + (data.alvoNome || 'Jogador') + ' comprou 2 cartas!',
    mais4: '➕ ' + (data.alvoNome || 'Jogador') + ' comprou 4 cartas!',
    curinga: '⭐ Cor mudada para ' + (COR_EMOJI[data.corEscolhida] || '') + ' ' + (data.corEscolhida || '')
  };
  if (msgs[data.tipo]) toast(msgs[data.tipo]);
});

socket.on('uno-uno', (data) => {
  toast('🗣️ ' + (data.nome || 'Alguem') + ' gritou UNO!', 'ok');
});

socket.on('uno-penalidade', (data) => {
  toast('⚠️ ' + (data.nome || 'Alguem') + ' nao gritou UNO a tempo! +2 cartas!', 'erro');
});

socket.on('uno-fim', (data) => {
  showEnd(data);
});

socket.on('uno-sala-fechada', (data) => {
  toast(data.motivo || 'Sala encerrada.', 'erro');
  currentRoom = null; showHome(currentUser);
});

socket.on('chat-mensagem', (msg) => { mostrarNotifChat(msg); });

// Chat
let chatAberto = false;
function mostrarChat() {
  const icone = document.getElementById('chat-icone');
  if (icone) icone.style.display = 'flex';
}
function mostrarNotifChat(msg) {
  const notifs = document.getElementById('chat-notifs');
  if (!notifs) return;
  const div = document.createElement('div');
  div.className = 'chat-notif';
  const nome = document.createElement('span');
  nome.className = 'chat-notif-nome';
  nome.textContent = msg.nomeUsuario + ':';
  const texto = document.createElement('span');
  texto.className = 'chat-notif-texto';
  texto.textContent = msg.texto;
  div.appendChild(nome);
  div.appendChild(texto);
  notifs.appendChild(div);
  setTimeout(() => { div.classList.add('saindo'); setTimeout(() => { if (div.parentNode) div.parentNode.removeChild(div); }, 300); }, 5000);
}
function iniciarChat() {
  const icone = document.getElementById('chat-icone');
  const painel = document.getElementById('chat-painel');
  const input = document.getElementById('chat-input');
  const btn = document.getElementById('chat-enviar');
  if (!icone || !painel || !input || !btn) return;
  icone.addEventListener('click', () => { const aberto = painel.style.display !== 'none'; painel.style.display = aberto ? 'none' : 'block'; if (!aberto) input.focus(); });
  btn.addEventListener('click', enviarChat);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') enviarChat(); });
}
function enviarChat() {
  if (!currentRoom || !currentUser) return;
  const input = document.getElementById('chat-input');
  const painel = document.getElementById('chat-painel');
  const texto = (input.value || '').trim().slice(0, 50);
  if (!texto) return;
  socket.emit('chat-mensagem', { code: currentRoom.code, texto, nomeUsuario: currentUser.displayName || currentUser.name });
  input.value = '';
  if (painel) painel.style.display = 'none';
}

// Eventos de UI
document.getElementById('card-criar').addEventListener('click', async () => {
  const res = await fetch('/api/uno/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
  const data = await res.json();
  if (data.error) { toast(data.error, 'erro'); return; }
  showRoom(data.room);
});
document.getElementById('card-entrar').addEventListener('click', () => showJoin());
document.getElementById('btn-voltar-join').addEventListener('click', () => showHome(currentUser));
document.getElementById('btn-atualizar').addEventListener('click', () => carregarSalas());
document.getElementById('btn-buscar-codigo').addEventListener('click', () => {
  const codigo = document.getElementById('input-codigo').value.trim().toUpperCase();
  if (!codigo) { toast('Digite o codigo da sala'); return; }
  entrarNaSala(codigo);
});
document.getElementById('input-codigo').addEventListener('keydown', (e) => { if (e.key === 'Enter') document.getElementById('btn-buscar-codigo').click(); document.getElementById('input-codigo').value = document.getElementById('input-codigo').value.toUpperCase(); });
document.getElementById('btn-sair-sala').addEventListener('click', async () => {
  if (!currentRoom) return;
  await fetch('/api/uno/' + currentRoom.code + '/leave', { method: 'DELETE' });
  currentRoom = null; showHome(currentUser);
});
document.getElementById('btn-sair-jogo').addEventListener('click', async () => {
  if (!currentRoom) return;
  await fetch('/api/uno/' + currentRoom.code + '/leave', { method: 'DELETE' });
  currentRoom = null; showHome(currentUser);
});
document.getElementById('btn-start').addEventListener('click', async () => {
  if (!currentRoom) return;
  const res = await fetch('/api/uno/' + currentRoom.code + '/start', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
  const data = await res.json();
  if (data.error) toast(data.error, 'erro');
});
document.getElementById('btn-comprar').addEventListener('click', () => comprarCarta());
document.getElementById('btn-uno').addEventListener('click', () => gritarUno());
document.getElementById('btn-jogar-novamente').addEventListener('click', async () => {
  if (!currentRoom) return;
  const res = await fetch('/api/uno/' + currentRoom.code + '/restart', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
  const data = await res.json();
  if (data.error) toast(data.error, 'erro');
  else { showRoom(currentRoom); }
});
document.getElementById('btn-sair-fim').addEventListener('click', async () => {
  if (currentRoom) { await fetch('/api/uno/' + currentRoom.code + '/leave', { method: 'DELETE' }); }
  currentRoom = null; showHome(currentUser);
});

iniciarChat();
checkAuth();
