const socket = io();
let currentUser = null;
let currentRoom = null;
let countdownInterval = null;
let myStatus = 'alive'; // 'alive' | 'dead'
let isSpectator = false; // true se entrou como espectador

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

async function abrirMicAutomatico() {
if (myStatus === 'dead') return;
if (!localStream) {
await ativarMicrofone();
}
if (!localStream) return;
micMuted = false;
localStream.getAudioTracks().forEach(t => { t.enabled = true; });
atualizarBotaoMicVote();
if (currentRoom) socket.emit('mic-status', { code: currentRoom.code, userId: currentUser.id, muted: false });
}

function forceMute() {
if (!localStream) return;
micMuted = true;
localStream.getAudioTracks().forEach(t => { t.enabled = false; });
atualizarBotaoMic();
atualizarBotaoMicVote();
if (currentRoom) socket.emit('mic-status', { code: currentRoom.code, userId: currentUser.id, muted: true });
}

function toggleMic() {
if (myStatus === 'dead') { alert('Voce esta eliminado e nao pode usar o microfone.'); return; }
if (!localStream) {
ativarMicrofone().then(() => {
setTimeout(() => {
micMuted = false;
localStream.getAudioTracks().forEach(t => { t.enabled = true; });
atualizarBotaoMic();
atualizarBotaoMicVote();
if (currentRoom) socket.emit('mic-status', { code: currentRoom.code, userId: currentUser.id, muted: false });
}, 300);
});
return;
}
micMuted = !micMuted;
localStream.getAudioTracks().forEach(t => { t.enabled = !micMuted; });
atualizarBotaoMic();
atualizarBotaoMicVote();
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

function atualizarBotaoMicVote() {
const btn = document.getElementById('btn-mic-vote');
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
atualizarBotaoMicVote();
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

// ---- FEED DE STATUS ----
function renderFeed(feed) {
document.querySelectorAll('.game-feed').forEach(el => {
if (!el || !feed) return;
el.innerHTML = '';
feed.forEach(item => {
const div = document.createElement('div');
div.className = 'feed-item feed-' + (item.tipo || 'sistema');
div.textContent = item.msg;
el.appendChild(div);
});
});
}

socket.on('feed-update', (feed) => {
renderFeed(feed);
});

// ---- CONTADOR DE ESPECTADORES ----
socket.on('spectator-count', (data) => {
document.querySelectorAll('.spectator-count-badge').forEach(el => {
el.textContent = '👁️ ' + data.count + ' espectador' + (data.count === 1 ? '' : 'es');
});
});

// ---- MODO ESPECTADOR (entra durante jogo) ----
socket.on('spectator-mode', (data) => {
// Espectador entrou enquanto jogo ja estava em andamento
// Mostra tela de espectador com o feed atual
showSpectatorView(data);
});

function showSpectatorView(data) {
hideAll();
document.getElementById('spectator-screen').classList.add('active');
if (data.feed) renderFeed(data.feed);
const statusEl = document.getElementById('spectator-status');
const statusMap = { night: '🌙 Fase da Noite', voting: '☀️ Fase de Votacao', result: '📋 Resultado', ended: '🏆 Jogo Encerrado' };
if (statusEl) statusEl.textContent = statusMap[data.status] || 'Aguardando...';
const countEl = document.getElementById('spectator-count-val');
if (countEl) countEl.textContent = data.spectators || 0;
}

// ---- TELAS ----
const ALL_SCREENS = ['login-screen','home-screen','join-screen','room-screen','game-screen','vote-screen','result-screen','spectator-screen'];
function hideAll() {
ALL_SCREENS.forEach(id => {
const el = document.getElementById(id);
if (el) el.classList.remove('active');
});
}

async function checkAuth() {
const res = await fetch('/api/me');
const data = await res.json();
if (data.user) { currentUser = data.user; showHome(data.user); }
else showLogin();
}

function showLogin() { hideAll(); document.getElementById('login-screen').classList.add('active'); }

function showHome(user) {
hideAll(); document.getElementById('home-screen').classList.add('active');
isSpectator = false;
const name = user.displayName || user.name || 'Jogador';
const photo = (user.photos && user.photos[0]) ? user.photos[0].value : '';
document.getElementById('welcome-name').textContent = name.split(' ')[0];
document.getElementById('user-name').textContent = name.split(' ')[0];
const avatar = document.getElementById('user-avatar');
if (photo) { avatar.src = photo; avatar.style.display = 'block'; }
myStatus = 'alive';
}

function showJoin() {
hideAll(); document.getElementById('join-screen').classList.add('active');
document.getElementById('input-codigo').value = '';
carregarSalas();
}

function showRoom(room) {
hideAll(); document.getElementById('room-screen').classList.add('active');
currentRoom = room;
isSpectator = false;
renderRoom(room);
socket.emit('join-room', { code: room.code, userId: currentUser ? currentUser.id : null, asSpectator: false });
}

function showSpectatorRoom(room) {
hideAll(); document.getElementById('spectator-screen').classList.add('active');
currentRoom = room;
isSpectator = true;
const statusEl = document.getElementById('spectator-status');
if (statusEl) {
const statusMap = { waiting: '⏳ Aguardando inicio', night: '🌙 Fase da Noite', voting: '☀️ Votacao em andamento', result: '📋 Resultado', ended: '🏆 Jogo Encerrado' };
statusEl.textContent = statusMap[room.status] || 'Ao vivo...';
}
socket.emit('join-room', { code: room.code, userId: currentUser ? currentUser.id : null, asSpectator: true });
}

// ---- TELA DE JOGO (noite) ----
function showGame(data) {
if (isSpectator) {
// Espectadores veem tela de espectador com feed atualizado
showSpectatorView({ status: 'night', feed: data.feed || [], spectators: 0 });
return;
}
hideAll();
document.getElementById('game-screen').classList.add('active');
if (data.feed) renderFeed(data.feed);

const isAssassino = currentUser && data.assassinoId === currentUser.id;

const roleEl = document.getElementById('game-role');
const roleDescEl = document.getElementById('game-role-desc');
if (isAssassino) {
roleEl.textContent = '🔪 Você é o ASSASSINO';
roleEl.className = 'game-role assassino';
roleDescEl.textContent = 'Escolha sua vítima. Você tem 30 segundos.';
} else {
roleEl.textContent = '😴 Você é um CIDADÃO';
roleEl.className = 'game-role cidadao';
roleDescEl.textContent = 'A cidade dorme... O assassino está agindo.';
}

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

document.getElementById('kill-result-box').style.display = 'none';
document.getElementById('game-overlay-text').textContent = '';

iniciarCountdown('game-countdown', 'countdown-bar', data.segundos || 30);

// Mic bloqueado durante a noite
forceMute();
const btnMic = document.getElementById('btn-mic');
if (btnMic) { btnMic.disabled = true; btnMic.title = 'Microfone bloqueado durante a noite'; }
}

function iniciarCountdown(elId, barId, segundos) {
if (countdownInterval) clearInterval(countdownInterval);
let restante = segundos;
const el = document.getElementById(elId);
const bar = barId ? document.getElementById(barId) : null;
function tick() {
if (restante < 0) { clearInterval(countdownInterval); return; }
if (el) el.textContent = restante + 's';
if (bar) {
const pct = (restante / segundos) * 100;
bar.style.width = pct + '%';
bar.style.background = restante > 20 ? '#6060ff' : restante > 10 ? '#ffaa00' : '#ff4444';
}
restante--;
}
tick();
countdownInterval = setInterval(tick, 1000);
}

async function escolherVitima(vitimaId) {
if (!currentRoom) return;
document.querySelectorAll('.btn-vitima').forEach(b => { b.disabled = true; b.classList.add('escolhida'); });
const res = await fetch('/api/rooms/' + currentRoom.code + '/kill', {
method: 'POST', headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ vitimaId })
});
const data = await res.json();
if (data.error) { alert(data.error); document.querySelectorAll('.btn-vitima').forEach(b => { b.disabled = false; b.classList.remove('escolhida'); }); }
}

// ---- RESULTADO DO ASSASSINATO ----
socket.on('kill-result', (data) => {
if (isSpectator) {
// Espectador: atualiza status
const statusEl = document.getElementById('spectator-status');
if (statusEl) statusEl.textContent = '🔪 ' + data.vitima.name + ' foi assassinado!';
return;
}
if (countdownInterval) clearInterval(countdownInterval);
const isAssassino = currentUser && data.assassinoId === currentUser.id;
const isVitima = currentUser && data.vitima.id === currentUser.id;
if (isVitima) myStatus = 'dead';
const box = document.getElementById('kill-result-box');
const countdown = document.getElementById('game-countdown');
const bar = document.getElementById('countdown-bar');
if (countdown) countdown.textContent = '0s';
if (bar) bar.style.width = '0%';
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
if (isAssassino) {
document.querySelectorAll('.btn-vitima').forEach(b => {
if (b.getAttribute('data-id') === data.vitima.id) b.classList.add('morta');
});
}
});

// ---- TELA DE VOTAÇÃO ----
socket.on('vote-turn', async (data) => {
if (isSpectator) {
const statusEl = document.getElementById('spectator-status');
if (statusEl) statusEl.textContent = '☀️ Votando: ' + data.votante.name + ' (' + data.turnoAtual + '/' + data.totalVotantes + ')';
if (data.feed) renderFeed(data.feed);
return;
}
hideAll();
document.getElementById('vote-screen').classList.add('active');
if (data.feed) renderFeed(data.feed);

const isMyTurn = currentUser && data.votante.id === currentUser.id;
const isDead = myStatus === 'dead';

document.getElementById('vote-progress').textContent = 'Votando: ' + data.turnoAtual + ' / ' + data.totalVotantes;
document.getElementById('vote-votante-name').textContent = data.votante.name;
const votanteImg = document.getElementById('vote-votante-img');
if (data.votante.photo) { votanteImg.src = data.votante.photo; votanteImg.style.display = 'block'; }
else { votanteImg.style.display = 'none'; }

const msgEl = document.getElementById('vote-message');
if (isMyTurn) {
msgEl.textContent = 'É SUA VEZ! Você é suspeito? Você viu alguma coisa? Vote em quem acha que é o assassino!';
msgEl.className = 'vote-message minha-vez';
} else {
msgEl.textContent = data.votante.name + ' está votando. Apenas o microfone dele está ativo.';
msgEl.className = 'vote-message';
}

const btnMic = document.getElementById('btn-mic-vote');
if (isMyTurn && !isDead) {
if (btnMic) { btnMic.disabled = false; btnMic.title = ''; }
await abrirMicAutomatico();
} else {
forceMute();
if (btnMic) { btnMic.disabled = true; btnMic.title = isDead ? 'Eliminado' : 'Aguarde sua vez'; }
}

const alvosDiv = document.getElementById('vote-alvos');
alvosDiv.innerHTML = '';
if (isMyTurn && !isDead) {
data.alvos.forEach(alvo => {
const btn = document.createElement('button');
btn.className = 'btn-votar-alvo';
btn.setAttribute('data-id', alvo.id);
btn.innerHTML = (alvo.photo ? '<img src="' + alvo.photo + '" class="vitima-avatar">' : '<div class="vitima-avatar-placeholder">' + alvo.name.charAt(0) + '</div>') +
'<span>' + alvo.name + '</span>';
btn.addEventListener('click', () => votar(alvo.id));
alvosDiv.appendChild(btn);
});
} else {
alvosDiv.innerHTML = '<p class="aguardando-texto">' + (isDead ? 'Você foi eliminado. Apenas observe.' : 'Aguarde a vez de ' + data.votante.name + '...') + '</p>';
}

iniciarCountdown('vote-countdown', 'vote-countdown-bar', data.segundos || 60);
});

socket.on('vote-cast', (data) => {
if (isSpectator) return;
if (countdownInterval) clearInterval(countdownInterval);
const el = document.getElementById('vote-countdown');
if (el) el.textContent = '✓';
document.querySelectorAll('.btn-votar-alvo').forEach(b => {
b.disabled = true;
if (b.getAttribute('data-id') === data.alvoId) b.classList.add('votado');
});
const msgEl = document.getElementById('vote-message');
if (msgEl && currentUser && data.votanteId === currentUser.id) {
msgEl.textContent = data.forcado ? 'Tempo esgotado! Voto automático registrado.' : 'Voto registrado! Aguarde...';
}
forceMute();
});

socket.on('vote-result', (data) => {
if (isSpectator) {
if (data.feed) renderFeed(data.feed);
const statusEl = document.getElementById('spectator-status');
if (statusEl) {
if (data.empate) statusEl.textContent = '🤝 Empate na votacao!';
else statusEl.textContent = data.era_assassino ? '🎉 Assassino eliminado!' : '😢 ' + (data.eliminado ? data.eliminado.name : '') + ' eliminado (cidadao)';
}
return;
}
if (countdownInterval) clearInterval(countdownInterval);
if (data.feed) renderFeed(data.feed);
hideAll();
document.getElementById('result-screen').classList.add('active');

const iconEl = document.getElementById('result-icon');
const titleEl = document.getElementById('result-title');
const subEl = document.getElementById('result-sub');
const roleRevealEl = document.getElementById('result-role-reveal');

if (data.empate) {
iconEl.textContent = '🤝';
titleEl.textContent = 'EMPATE!';
subEl.textContent = 'Ninguém foi eliminado. A cidade volta a dormir...';
roleRevealEl.style.display = 'none';
} else {
const eraAssassino = data.era_assassino;
iconEl.textContent = eraAssassino ? '🎉' : '😢';
titleEl.textContent = data.eliminado.name + ' foi eliminado!';
subEl.textContent = eraAssassino ? 'A cidade venceu!' : 'Era um cidadão inocente... O assassino continua solto.';
roleRevealEl.style.display = 'block';
roleRevealEl.textContent = eraAssassino ? '🔪 ERA O ASSASSINO!' : '😇 ERA UM CIDADÃO';
roleRevealEl.className = 'role-reveal ' + (eraAssassino ? 'assassino' : 'cidadao');
if (currentUser && data.eliminado.id === currentUser.id) myStatus = 'dead';
}
forceMute();
});

socket.on('game-over', (data) => {
if (isSpectator) {
const statusEl = document.getElementById('spectator-status');
if (statusEl) statusEl.textContent = data.vencedor === 'cidade' ? '🏆 Cidade Venceu!' : '💀 Assassino Venceu!';
return;
}
if (countdownInterval) clearInterval(countdownInterval);
hideAll();
document.getElementById('result-screen').classList.add('active');

document.getElementById('result-icon').textContent = data.vencedor === 'cidade' ? '🏆' : '💀';
document.getElementById('result-title').textContent = data.vencedor === 'cidade' ? 'CIDADE VENCEU!' : 'ASSASSINO VENCEU!';
document.getElementById('result-sub').textContent = data.vencedor === 'cidade'
? 'O assassino foi descoberto e eliminado. Parabéns cidadãos!'
: 'O assassino eliminou jogadores demais. A cidade perdeu!';
document.getElementById('result-role-reveal').style.display = 'none';

const btnReplay = document.getElementById('btn-replay');
if (btnReplay) {
btnReplay.style.display = (currentUser && currentRoom && currentRoom.host === currentUser.id) ? 'block' : 'none';
}
myStatus = 'alive';
forceMute();
});

socket.on('game-over-reveal', (data) => {
if (isSpectator) {
const statusEl = document.getElementById('spectator-status');
if (statusEl) statusEl.textContent = '💀 Assassino Venceu!';
return;
}
if (countdownInterval) clearInterval(countdownInterval);
hideAll();
document.getElementById('result-screen').classList.add('active');

document.getElementById('result-icon').textContent = '😇';
document.getElementById('result-title').textContent = data.cidadao.name + ' era inocente!';
document.getElementById('result-sub').textContent = 'Era um cidadão... não conseguiu descobrir o assassino.';
const roleRevealEl = document.getElementById('result-role-reveal');
roleRevealEl.style.display = 'block';
roleRevealEl.textContent = '😇 ERA UM CIDADÃO';
roleRevealEl.className = 'role-reveal cidadao';

setTimeout(() => {
document.getElementById('result-icon').textContent = '💀';
document.getElementById('result-title').textContent = data.assassino.name + ' era o ASSASSINO!';
document.getElementById('result-sub').textContent = 'O assassino eliminou todos os cidadãos. A cidade perdeu!';
roleRevealEl.textContent = '🔪 ERA O ASSASSINO — VENCEDOR!';
roleRevealEl.className = 'role-reveal assassino';
const btnReplay = document.getElementById('btn-replay');
if (btnReplay) {
btnReplay.style.display = (currentUser && currentRoom && currentRoom.host === currentUser.id) ? 'block' : 'none';
}
}, 3000);

myStatus = 'alive';
forceMute();
});

async function votar(alvoId) {
if (!currentRoom) return;
document.querySelectorAll('.btn-votar-alvo').forEach(b => { b.disabled = true; });
const res = await fetch('/api/rooms/' + currentRoom.code + '/vote', {
method: 'POST', headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ alvoId })
});
const data = await res.json();
if (data.error) { alert(data.error); document.querySelectorAll('.btn-votar-alvo').forEach(b => { b.disabled = false; }); }
}

// ---- SALA ----
async function carregarSalas() {
const lista = document.getElementById('salas-lista');
lista.innerHTML = '<div class="salas-loading">Carregando...</div>';
try {
const res = await fetch('/api/rooms');
const data = await res.json();
const salas = data.rooms;
if (!salas || salas.length === 0) { lista.innerHTML = '<div class="salas-vazio">Nenhuma sala aberta no momento.<br>Que tal criar uma?</div>'; return; }
lista.innerHTML = '';
salas.forEach(sala => {
const div = document.createElement('div');
div.className = 'sala-item';
const statusLabel = sala.status === 'waiting' ? '<span class="sala-status-aguardando">⏳ Aguardando</span>' : '<span class="sala-status-jogo">🔴 Em jogo</span>';
const entrarLabel = sala.status === 'waiting' && sala.players < 50 ? 'Entrar' : '👁️ Observar';
div.innerHTML = '<div class="sala-info"><span class="sala-codigo">' + sala.code + '</span><span class="sala-host">Host: ' + sala.host + '</span></div>' +
'<div class="sala-right">' + statusLabel + '<span class="sala-players">👥 ' + sala.players + '/50</span>' + (sala.spectators > 0 ? '<span class="sala-spectators">👁️ ' + sala.spectators + '</span>' : '') +
'<button class="btn-entrar-sala" data-code="' + sala.code + '" data-status="' + sala.status + '" data-players="' + sala.players + '">' + entrarLabel + '</button></div>';
lista.appendChild(div);
});
lista.querySelectorAll('.btn-entrar-sala').forEach(btn => {
btn.addEventListener('click', () => entrarNaSala(btn.dataset.code, btn.dataset.status, parseInt(btn.dataset.players)));
});
} catch (e) { lista.innerHTML = '<div class="salas-vazio">Erro ao carregar salas.</div>'; }
}

async function entrarNaSala(code, status, playerCount) {
const res = await fetch('/api/rooms/' + code.toUpperCase() + '/join', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
const data = await res.json();
if (data.error) { alert(data.error); return; }
if (data.asSpectator) {
showSpectatorRoom(data.room);
} else {
showRoom(data.room);
}
}

function renderRoom(room) {
document.getElementById('room-code').textContent = room.code;
document.getElementById('room-players-count').textContent = room.players.length;
document.getElementById('room-min').textContent = room.minPlayers;
// Atualiza badge de espectadores
const specBadge = document.getElementById('room-spectators');
if (specBadge) specBadge.textContent = (room.spectators || 0) > 0 ? '👁️ ' + room.spectators + ' espectador' + (room.spectators === 1 ? '' : 'es') : '';
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
if (!isSpectator) {
await fetch('/api/rooms/' + currentRoom.code + '/leave', { method: 'DELETE' });
}
currentRoom = null;
isSpectator = false;
showHome(currentUser);
});
document.getElementById('btn-mic').addEventListener('click', () => toggleMic());
const btnMicVote = document.getElementById('btn-mic-vote');
if (btnMicVote) btnMicVote.addEventListener('click', () => toggleMic());
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
const btnReplay = document.getElementById('btn-replay');
if (btnReplay) {
btnReplay.addEventListener('click', () => {
if (!currentRoom) return;
myStatus = 'alive';
showRoom(currentRoom);
});
}
const btnSairSpec = document.getElementById('btn-sair-spectator');
if (btnSairSpec) {
btnSairSpec.addEventListener('click', () => {
currentRoom = null;
isSpectator = false;
showHome(currentUser);
});
}
socket.on('room-update', (room) => {
if (currentRoom && room.code === currentRoom.code) {
currentRoom = room;
if (!isSpectator) renderRoom(room);
}
});
socket.on('game-night', (data) => { showGame(data); });

checkAuth();
