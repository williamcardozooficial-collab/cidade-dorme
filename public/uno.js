// UNO Client v2 - com timer 15s e cartas corrigidas
const socket = io();
let currentUser = null;
let currentRoom = null;
let minhasMao = [];
let vezAtualId = null;
let corAtual = null;
let descarteAtual = null;
let aguardandoCorEscolha = false;
let cartaEspecialPendente = null;
let timerInterval = null;
let timerSegundos = 0;

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
  pararTimer();
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
  pararTimer();
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
  pararTimer();
  showScreen('end-screen');
  document.getElementById('end-icon').textContent = data.vencedor ? '🏆' : '🃏';
  document.getElementById('end-title').textContent = 'Fim de Jogo!';
  const sub = data.vencedor ? (data.vencedor.name + ' venceu com 0 cartas!') : 'Jogo encerrado!';
  document.getElementById('end-sub').textContent = sub;
  const rankEl = document.getElementById('end-ranking');
  rankEl.innerHTML = '';
  if (data.ranking && data.ranking.length) {
    data.ranking.forEach((p, i) => {
      const div = document.createElement('div');
      div.className = 'end-ranking-item';
      const medals = ['🥇','🥈','🥉'];
      div.innerHTML = '<span class="end-rank-num">' + (medals[i] || (i+1)+'°') + '</span><span class="end-rank-name">' + p.name + '</span><span class="end-rank-cards">' + p.cartas + ' cartas</span>';
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
    div.innerHTML = p.photo
      ? '<img src="' + p.photo + '" class="player-avatar-img"><div class="player-info"><span class="player-name">' + p.name + (p.isHost ? ' <span class="host-badge">HOST</span>' : '') + '</span></div>'
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

// ===== TIMER =====
function iniciarTimer(segundos) {
  pararTimer();
  timerSegundos = segundos;
  const el = document.getElementById('turno-timer');
  const bar = document.getElementById('turno-timer-bar');
  if (el) { el.style.display = 'block'; el.textContent = timerSegundos + 's'; }
  if (bar) { bar.style.width = '100%'; bar.style.background = '#4cff80'; }
  timerInterval = setInterval(() => {
    timerSegundos--;
    if (el) {
      el.textContent = timerSegundos + 's';
      el.style.color = timerSegundos <= 5 ? '#ff4444' : timerSegundos <= 10 ? '#ffaa00' : '#fff';
    }
    if (bar) {
      const pct = (timerSegundos / segundos) * 100;
      bar.style.width = pct + '%';
      bar.style.background = timerSegundos <= 5 ? '#ff4444' : timerSegundos <= 10 ? '#ffaa00' : '#4cff80';
    }
    if (timerSegundos <= 0) { pararTimer(); }
  }, 1000);
}

function pararTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  const el = document.getElementById('turno-timer');
  const bar = document.getElementById('turno-timer-bar');
  if (el) el.style.display = 'none';
  if (bar) bar.style.width = '0%';
}

// ===== RENDER PLAYERS =====
function renderPlayersBar(playersInfo) {
  const bar = document.getElementById('players-info-bar');
  if (!bar) return;
  bar.innerHTML = '';
  playersInfo.forEach(p => {
    const div = document.createElement('div');
    div.className = 'player-bubble' + (p.id === vezAtualId ? ' vez-atual' : '') + (p.eliminado ? ' eliminado' : '');
    div.id = 'bubble-' + p.id;
    const avatarHtml = p.photo ? '<img src="' + p.photo + '" alt="">' : '<div class="pb-avatar">' + p.name.charAt(0) + '</div>';
    const unoTag = p.cartas === 1 ? '<span class="pb-uno">UNO!</span>' : '';
    div.innerHTML = avatarHtml + '<span class="pb-name">' + p.name.split(' ')[0] + '</span><span class="pb-cards">' + p.cartas + '</span>' + unoTag;
    bar.appendChild(div);
  });
}

// ===== RENDER MAO =====
function podeJogar(carta) {
  if (!descarteAtual && !corAtual) return false;
  if (carta.cor === 'preto') return true;
  if (corAtual && carta.cor === corAtual) return true;
  if (descarteAtual && carta.valor === descarteAtual.valor) return true;
  return false;
}

function renderMinhaMao(cartas) {
  minhasMao = cartas;
  const maoEl = document.getElementById('minha-mao');
  if (!maoEl) return;
  maoEl.innerHTML = '';
  const contEl = document.getElementById('minha-contagem');
  if (contEl) contEl.textContent = cartas.length;
  const isMyTurn = currentUser && vezAtualId === currentUser.id;
  cartas.forEach(carta => {
    const jogavel = isMyTurn && podeJogar(carta);
    const el = criarCartaEl(carta, jogavel);
    el.addEventListener('click', () => {
      if (aguardandoCorEscolha) return;
      if (!isMyTurn) { return; }
      if (!podeJogar(carta)) { return; }
      jogarCarta(carta);
    });
    maoEl.appendChild(el);
  });
  // Botao UNO
  const btnUnoWrap = document.getElementById('btn-uno-wrap');
  if (btnUnoWrap) btnUnoWrap.style.display = isMyTurn && cartas.length === 2 ? 'flex' : 'none';
}

function criarCartaEl(carta, jogavel) {
  const el = document.createElement('div');
  const corClass = (carta.cor === 'preto' || carta.cor === 'especial') ? 'preto' : (COR_CLASS[carta.cor] || 'preto');
  el.className = 'uno-card ' + corClass + (jogavel ? ' jogavel' : ' disabled');
  const val = getCartaDisplay(carta);
  el.innerHTML = '<span class="card-val">' + val.icon + '</span>' + (val.label ? '<span class="card-label">' + val.label + '</span>' : '');
  el.setAttribute('data-carta-id', carta.id);
  return el;
}

function getCartaDisplay(carta) {
  const v = carta.valor;
  if (v === 'pular')    return { icon: '🚫', label: 'Pular' };
  if (v === 'inverter') return { icon: '🔄', label: 'Inv.' };
  if (v === 'mais2')    return { icon: '+2',  label: '' };
  if (v === 'curinga')  return { icon: '⭐',  label: 'Cor' };
  if (v === 'mais4')    return { icon: '+4',  label: '' };
  return { icon: v, label: '' };
}

function renderDescarte(carta, corVigorante) {
  const pile = document.getElementById('discard-pile');
  if (!pile) return;
  if (!carta) { pile.innerHTML = '<div class="card-placeholder">Aguardando...</div>'; return; }
  const corDisplay = (carta.cor === 'preto') ? corVigorante : carta.cor;
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
    } else { badge.style.display = 'none'; }
  }
}

// ===== ACOES =====
async function jogarCarta(carta) {
  if (!currentRoom) return;
  if (carta.cor === 'preto') {
    cartaEspecialPendente = carta;
    aguardandoCorEscolha = true;
    document.getElementById('color-picker').style.display = 'block';
    return;
  }
  await enviarJogada(carta.id, null);
}

async function escolherCor(cor) {
  document.getElementById('color-picker').style.display = 'none';
  if (!aguardandoCorEscolha || !cartaEspecialPendente) return;
  aguardandoCorEscolha = false;
  const id = cartaEspecialPendente.id;
  cartaEspecialPendente = null;
  await enviarJogada(id, cor);
}

async function enviarJogada(cartaId, corEscolhida) {
  if (!currentRoom) return;
  // Desabilitar todas as cartas durante o envio
  document.querySelectorAll('.uno-card.jogavel').forEach(c => c.classList.remove('jogavel'));
  const body = { cartaId };
  if (corEscolhida) body.corEscolhida = corEscolhida;
  try {
    const res = await fetch('/api/uno/' + currentRoom.code + '/jogar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (data.error) { toast('Erro: ' + data.error, 'erro'); renderMinhaMao(minhasMao); }
  } catch(e) { toast('Erro de conexao', 'erro'); renderMinhaMao(minhasMao); }
}

async function comprarCarta() {
  if (!currentRoom) return;
  if (currentUser && vezAtualId !== currentUser.id) { toast('Nao e sua vez!'); return; }
  try {
    const res = await fetch('/api/uno/' + currentRoom.code + '/comprar', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    const data = await res.json();
    if (data.error) toast('Erro: ' + data.error, 'erro');
  } catch(e) { toast('Erro de conexao', 'erro'); }
}

async function gritarUno() {
  if (!currentRoom) return;
  await fetch('/api/uno/' + currentRoom.code + '/uno', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
}

// ===== ATUALIZAR ESTADO =====
function atualizarEstado(data) {
  vezAtualId = data.vezId;
  corAtual = data.corAtual;
  descarteAtual = data.descarte || null;
  const deckEl = document.getElementById('deck-count');
  if (deckEl) deckEl.textContent = data.deckCount || '?';
  const isMyTurn = currentUser && data.vezId === currentUser.id;
  // Turno info
  const turnoEl = document.getElementById('turno-info');
  if (turnoEl) {
    if (isMyTurn) { turnoEl.textContent = '🃏 SUA VEZ! Jogue uma carta ou compre.'; turnoEl.style.color = '#f4d03f'; }
    else { turnoEl.textContent = 'Vez de ' + (data.vezNome || 'Jogador'); turnoEl.style.color = '#ccc'; }
  }
  renderDescarte(data.descarte, data.corAtual);
  if (data.playersInfo) renderPlayersBar(data.playersInfo);
  if (data.minhasMao) renderMinhaMao(data.minhasMao);
  // Timer
  if (isMyTurn && data.segundosRestantes > 0) {
    iniciarTimer(data.segundosRestantes);
  } else {
    pararTimer();
  }
}

// ===== UTILS =====
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

// ===== SALAS =====
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
      const statusLabel = sala.status === 'waiting' ? '<span class="sala-status-aguardando">Aguardando</span>' : '<span class="sala-status-jogo">Em jogo</span>';
      div.innerHTML = '<div class="sala-info"><span class="sala-codigo">' + sala.code + '</span><span class="sala-host">Host: ' + sala.host + '</span></div><div class="sala-right">' + statusLabel + '<span class="sala-players">' + sala.players + ' jogadores</span><button class="btn-entrar-sala" data-code="' + sala.code + '">' + (sala.status === 'waiting' ? 'Entrar' : 'Observar') + '</button></div>';
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

// ===== SOCKET EVENTS =====
socket.on('uno-room-update', (room) => {
  if (currentRoom && room.code === currentRoom.code) {
    currentRoom = room;
    if (document.getElementById('room-screen').classList.contains('active')) renderRoom(room);
  }
});

socket.on('uno-jogo-iniciado', (data) => {
  currentRoom = data.room;
  minhasMao = [];
  vezAtualId = null;
  corAtual = null;
  descarteAtual = null;
  showGame(data.room);
  
});

socket.on('uno-estado', (data) => {
  if (!document.getElementById('game-screen').classList.contains('active')) {
    if (currentRoom) showGame(currentRoom);
  }
  if (!currentRoom) currentRoom = {};
  currentRoom.jogo = data;
  atualizarEstado(data);
});

socket.on('uno-carta-comprada', (data) => { /* sem notificacao */ });;

socket.on('uno-carta-jogada', (data) => { /* sem notificacao */ });;

socket.on('uno-efeito', (data) => { /* sem notificacao */ });;

socket.on('uno-turno-automatico', (data) => { /* sem notificacao */ });;

socket.on('uno-uno', (data) => { /* sem notificacao */ });;

socket.on('uno-penalidade', (data) => { /* sem notificacao */ });;

socket.on('uno-fim', (data) => { showEnd(data); });

socket.on('uno-sala-fechada', (data) => {
  pararTimer();
  toast(data.motivo || 'Sala encerrada.', 'erro');
  currentRoom = null;
  if (currentUser) showHome(currentUser);
  else showScreen('login-screen');
});

socket.on('chat-mensagem', (msg) => { mostrarNotifChat(msg); });

// ===== CHAT =====
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
  icone.addEventListener('click', () => {
    const aberto = painel.style.display !== 'none';
    painel.style.display = aberto ? 'none' : 'block';
    if (!aberto) input.focus();
  });
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

// ===== EVENTOS UI =====
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
document.getElementById('input-codigo').addEventListener('keydown', (e) => {
  document.getElementById('input-codigo').value = document.getElementById('input-codigo').value.toUpperCase();
  if (e.key === 'Enter') document.getElementById('btn-buscar-codigo').click();
});
document.getElementById('btn-sair-sala').addEventListener('click', async () => {
  if (!currentRoom) return;
  await fetch('/api/uno/' + currentRoom.code + '/leave', { method: 'DELETE' });
  currentRoom = null; showHome(currentUser);
});
document.getElementById('btn-sair-jogo').addEventListener('click', async () => {
  if (!currentRoom) return;
  pararTimer();
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
  if (data.error) { toast(data.error, 'erro'); return; }
  currentRoom = data.room;
  showRoom(data.room);
});
document.getElementById('btn-sair-fim').addEventListener('click', async () => {
  if (currentRoom) { await fetch('/api/uno/' + currentRoom.code + '/leave', { method: 'DELETE' }); }
  currentRoom = null; showHome(currentUser);
});

iniciarChat();
checkAuth();
