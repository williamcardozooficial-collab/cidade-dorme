const socket = io();
let currentUser = null;
let currentRoom = null;
let countdownInterval = null;
let myStatus = 'alive';
let isSpectator = false;
let decisionInterval = null;
let meuPapel = 'cidadao';
let meuPapelInfo = null;

let localStream = null;
let micMuted = true;
let peers = {};
const RTC_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] };

async function ativarMicrofone() {
if (localStream) return;
try { localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false }); localStream.getAudioTracks().forEach(t => { t.enabled = false; }); micMuted = true; atualizarBotaoMic(); } catch (e) { alert('Nao foi possivel acessar o microfone.'); }
}
async function abrirMicAutomatico() {
if (myStatus === 'dead') return;
if (!localStream) { await ativarMicrofone(); }
if (!localStream) return;
micMuted = false; localStream.getAudioTracks().forEach(t => { t.enabled = true; });
atualizarBotaoMicVote();
if (currentRoom) socket.emit('mic-status', { code: currentRoom.code, userId: currentUser.id, muted: false });
}
function forceMute() {
if (!localStream) return;
micMuted = true; localStream.getAudioTracks().forEach(t => { t.enabled = false; });
atualizarBotaoMic(); atualizarBotaoMicVote();
if (currentRoom) socket.emit('mic-status', { code: currentRoom.code, userId: currentUser.id, muted: true });
}
function toggleMic() {
if (myStatus === 'dead') { alert('Voce esta eliminado e nao pode usar o microfone.'); return; }
if (!localStream) {
ativarMicrofone().then(() => { setTimeout(() => { micMuted = false; localStream.getAudioTracks().forEach(t => { t.enabled = true; }); atualizarBotaoMic(); atualizarBotaoMicVote(); if (currentRoom) socket.emit('mic-status', { code: currentRoom.code, userId: currentUser.id, muted: false }); }, 300); }); return;
}
micMuted = !micMuted; localStream.getAudioTracks().forEach(t => { t.enabled = !micMuted; });
atualizarBotaoMic(); atualizarBotaoMicVote();
if (currentRoom) socket.emit('mic-status', { code: currentRoom.code, userId: currentUser.id, muted: micMuted });
}
function atualizarBotaoMic() { const btn = document.getElementById('btn-mic'); if (!btn) return; if (micMuted) { btn.textContent = '🔇 Microfone'; btn.classList.remove('mic-on'); btn.classList.add('mic-off'); } else { btn.textContent = '🎙️ Microfone'; btn.classList.remove('mic-off'); btn.classList.add('mic-on'); } }
function atualizarBotaoMicVote() { const btn = document.getElementById('btn-mic-vote'); if (!btn) return; if (micMuted) { btn.textContent = '🔇 Microfone'; btn.classList.remove('mic-on'); btn.classList.add('mic-off'); } else { btn.textContent = '🎙️ Microfone'; btn.classList.remove('mic-off'); btn.classList.add('mic-on'); } }

function criarPeer(socketId, isInitiator) {
if (peers[socketId]) peers[socketId].close();
const pc = new RTCPeerConnection(RTC_CONFIG); peers[socketId] = pc;
if (localStream) localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
pc.ontrack = (e) => { let audioEl = document.getElementById('audio-' + socketId); if (!audioEl) { audioEl = document.createElement('audio'); audioEl.id = 'audio-' + socketId; audioEl.autoplay = true; document.body.appendChild(audioEl); } audioEl.srcObject = e.streams[0]; };
pc.onicecandidate = (e) => { if (e.candidate) socket.emit('webrtc-ice', { to: socketId, candidate: e.candidate }); };
pc.onconnectionstatechange = () => { if (['disconnected','failed','closed'].includes(pc.connectionState)) removerPeer(socketId); };
if (isInitiator) { pc.createOffer().then(offer => { pc.setLocalDescription(offer); socket.emit('webrtc-offer', { to: socketId, offer }); }); }
return pc;
}
function removerPeer(socketId) { if (peers[socketId]) { peers[socketId].close(); delete peers[socketId]; } const el = document.getElementById('audio-' + socketId); if (el) el.remove(); }
function pararAudio() { Object.keys(peers).forEach(id => removerPeer(id)); if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; } micMuted = true; atualizarBotaoMic(); atualizarBotaoMicVote(); }

socket.on('peer-joined', ({ socketId }) => { if (localStream) criarPeer(socketId, true); });
socket.on('webrtc-offer', async ({ from, offer }) => { if (!localStream) await ativarMicrofone(); const pc = criarPeer(from, false); await pc.setRemoteDescription(new RTCSessionDescription(offer)); const answer = await pc.createAnswer(); await pc.setLocalDescription(answer); socket.emit('webrtc-answer', { to: from, answer }); });
socket.on('webrtc-answer', async ({ from, answer }) => { const pc = peers[from]; if (pc) await pc.setRemoteDescription(new RTCSessionDescription(answer)); });
socket.on('webrtc-ice', async ({ from, candidate }) => { const pc = peers[from]; if (pc && candidate) { try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch(e) {} } });
socket.on('peer-left', ({ socketId }) => removerPeer(socketId));
socket.on('mic-status', ({ userId, muted }) => { const indicator = document.querySelector('[data-userid="' + userId + '"] .mic-indicator'); if (indicator) { indicator.textContent = muted ? '🔇' : '🎙️'; indicator.classList.toggle('falando', !muted); } });
function renderFeed(feed) {
  document.querySelectorAll('.game-feed').forEach(el => {
    if (!el || !feed) return;
    el.innerHTML = '';
    if (!feed.length) return;
    // Mostrar apenas o item mais recente
    const item = feed[0];
    const div = document.createElement('div');
    div.className = 'feed-item feed-' + (item.tipo || 'info');
    div.textContent = item.msg || '';
    el.appendChild(div);
  });
}
function showSpectatorView(data) { hideAll(); document.getElementById('spectator-screen').classList.add('active'); if (data.feed) renderFeed(data.feed); const statusEl = document.getElementById('spectator-status'); const statusMap = { night: '🌙 Fase da Noite', voting: '☀️ Fase de Votacao', result: '📋 Resultado', ended: '🏆 Jogo Encerrado' }; if (statusEl) statusEl.textContent = statusMap[data.status] || 'Aguardando...'; }

const ALL_SCREENS = ['login-screen','home-screen','join-screen','room-screen','game-screen','vote-screen','result-screen','decision-screen','spectator-screen'];
function hideAll() { ALL_SCREENS.forEach(id => { const el = document.getElementById(id); if (el) el.classList.remove('active'); }); }

async function checkAuth() { const res = await fetch('/api/me'); const data = await res.json(); if (data.user) { currentUser = data.user; showHome(data.user); } else showLogin(); }
function showLogin() { hideAll(); esconderChat(); limparMensagensChat(); document.getElementById('login-screen').classList.add('active'); }
function showHome(user) { hideAll(); esconderChat(); limparMensagensChat(); document.getElementById('home-screen').classList.add('active'); isSpectator = false; const name = user.displayName || user.username || 'Jogador'; const photo = ((user.foto_url || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(user.username) + '&background=6c63ff&color=fff&size=80')s && (user.foto_url || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(user.username) + '&background=6c63ff&color=fff&size=80')s[0]) ? (user.foto_url || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(user.username) + '&background=6c63ff&color=fff&size=80')s[0].value : ''; document.getElementById('welcome-name').textContent = (user.role === 'admin' ? '👑 ' : '') + name; document.getElementById('user-name').textContent = (user.role === 'admin' ? '👑 ' : '') + name; const avatar = document.getElementById('user-avatar'); if (photo) { avatar.src = photo; avatar.style.display = 'block'; } myStatus = 'alive'; meuPapel = 'cidadao'; }
function showJoin() { hideAll(); document.getElementById('join-screen').classList.add('active'); document.getElementById('input-codigo').value = ''; carregarSalas(); }
function showRoom(room) { hideAll(); mostrarChat(); document.getElementById('room-screen').classList.add('active'); currentRoom = room; isSpectator = false; renderRoom(room); socket.emit('join-room', { code: room.code, userId: currentUser ? currentUser.id : null, asSpectator: false }); ativarMicrofone(); }
function showSpectatorRoom(room) { hideAll(); mostrarChat(); document.getElementById('spectator-screen').classList.add('active'); currentRoom = room; isSpectator = true; const statusEl = document.getElementById('spectator-status'); if (statusEl) { const statusMap = { waiting: '⏳ Aguardando inicio', night: '🌙 Fase da Noite', voting: '☀️ Votacao em andamento', result: '📋 Resultado', ended: '🏆 Jogo Encerrado' }; statusEl.textContent = statusMap[room.status] || 'Ao vivo...'; } socket.emit('join-room', { code: room.code, userId: currentUser ? currentUser.id : null, asSpectator: true }); }

const PAPEL_ESTILOS = {
assassino: { emoji: '🔪', classe: 'assassino', cor: '#ff6060' },
anjo: { emoji: '👼', classe: 'anjo', cor: '#ffe080' },
detetive: { emoji: '🕵️', classe: 'detetive', cor: '#80d0ff' },
soldado: { emoji: '🪖', classe: 'soldado', cor: '#80ff80' },
palhaco: { emoji: '🤡', classe: 'palhaco', cor: '#ff80ff' },
cidadao: { emoji: '😴', classe: 'cidadao', cor: '#a0a0ff' }
};
function showGame(data) {
if (isSpectator) { showSpectatorView({ status: 'night', feed: data.feed || [], spectators: 0 }); return; }
hideAll();
document.getElementById('game-screen').classList.add('active');
if (data.feed) renderFeed(data.feed);
meuPapel = data.papelId || 'cidadao';
meuPapelInfo = data.papelInfo || { nome: 'Cidadao', emoji: '😴', desc: 'A cidade dorme...', podeAgir: false };
const estilo = PAPEL_ESTILOS[meuPapel] || PAPEL_ESTILOS.cidadao;
const roleEl = document.getElementById('game-role');
const roleDescEl = document.getElementById('game-role-desc');
const artigo = (meuPapel === 'cidadao') ? 'um' : 'o';
roleEl.textContent = estilo.emoji + ' Voce e ' + artigo + ' ' + (meuPapelInfo.nome || meuPapel).toUpperCase();
roleEl.className = 'game-role ' + estilo.classe;
if (roleDescEl) roleDescEl.textContent = meuPapelInfo.desc || meuPapelInfo.descricao || '';
document.getElementById('kill-result-box').style.display = 'none';
document.getElementById('game-overlay-text').textContent = '';
renderAcoesNoite(data);
iniciarCountdown('game-countdown', 'countdown-bar', data.segundos || 30);
forceMute();
const btnMic = document.getElementById('btn-mic');
if (btnMic) { btnMic.disabled = true; btnMic.title = 'Microfone bloqueado durante a noite'; }
}

function renderAcoesNoite(data) {
const secAssassino = document.getElementById('vitimas-section');
const secEspecial = document.getElementById('acoes-especiais-section');
const acoesList = document.getElementById('acoes-especiais-list');
const acaoTitulo = document.getElementById('acao-especial-titulo');
secAssassino.style.display = 'none';
secEspecial.style.display = 'none';
if (meuPapel === 'assassino') {
secAssassino.style.display = 'block';
const vitimasList = document.getElementById('vitimas-list');
vitimasList.innerHTML = '';
(data.vitimas || []).forEach(v => {
const btn = document.createElement('button');
btn.className = 'btn-vitima';
btn.setAttribute('data-id', v.id);
btn.innerHTML = (v.photo ? '<img src="' + v.photo + '" class="vitima-avatar">' : '<div class="vitima-avatar-placeholder">' + v.name.charAt(0) + '</div>') + '<span>' + v.name + '</span>';
btn.addEventListener('click', () => escolherVitima(v.id));
vitimasList.appendChild(btn);
});
} else if (meuPapelInfo && meuPapelInfo.podeAgir) {
secEspecial.style.display = 'block';
acoesList.innerHTML = '';
let lista = data.vitimas || [], titulo = '', onClickFn = null;
if (meuPapel === 'anjo') { titulo = '👼 Escolha quem proteger:'; onClickFn = (id) => usarAnjo(id); }
else if (meuPapel === 'detetive') { titulo = '🕵️ Escolha quem investigar:'; onClickFn = (id) => usarDetetive(id); }
else if (meuPapel === 'soldado') { titulo = '🪖 Escolha o alvo do seu tiro:'; onClickFn = (id) => usarSoldado(id); }
if (acaoTitulo) acaoTitulo.textContent = titulo;
lista.forEach(v => {
const btn = document.createElement('button');
btn.className = 'btn-vitima btn-acao-especial';
btn.setAttribute('data-id', v.id);
btn.innerHTML = (v.photo ? '<img src="' + v.photo + '" class="vitima-avatar">' : '<div class="vitima-avatar-placeholder">' + v.name.charAt(0) + '</div>') + '<span>' + v.name + '</span>';
btn.addEventListener('click', () => { if (onClickFn) onClickFn(v.id); });
acoesList.appendChild(btn);
});
const btnPular = document.createElement('button');
btnPular.className = 'btn-pular-acao';
btnPular.textContent = 'Nao usar habilidade esta noite';
btnPular.addEventListener('click', () => { secEspecial.style.display = 'none'; document.getElementById('game-overlay-text').textContent = 'Voce optou por nao usar sua habilidade.'; });
acoesList.appendChild(btnPular);
} else if (meuPapel === 'palhaco') {
document.getElementById('game-overlay-text').textContent = '🤡 Aguarde... a cidade precisa te eliminar!';
}
}

async function escolherVitima(vitimaId) {
if (!currentRoom) return;
document.querySelectorAll('.btn-vitima').forEach(b => { b.disabled = true; b.classList.add('escolhida'); });
const res = await fetch('/api/rooms/' + currentRoom.code + '/kill', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vitimaId }) });
const data = await res.json();
if (data.error) { alert(data.error); document.querySelectorAll('.btn-vitima').forEach(b => { b.disabled = false; b.classList.remove('escolhida'); }); }
else { document.getElementById('game-overlay-text').textContent = '🔪 Vitima escolhida! Aguardando a noite terminar...'; }
}

async function usarAnjo(alvoId) {
if (!currentRoom) return;
document.querySelectorAll('.btn-acao-especial, .btn-pular-acao').forEach(b => { b.disabled = true; });
const res = await fetch('/api/rooms/' + currentRoom.code + '/anjo-salvar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ alvoId }) });
const data = await res.json();
if (data.error) { alert(data.error); document.querySelectorAll('.btn-acao-especial, .btn-pular-acao').forEach(b => { b.disabled = false; }); }
else { document.getElementById('acoes-especiais-section').style.display = 'none'; document.getElementById('game-overlay-text').textContent = '👼 Protecao enviada!'; }
}

async function usarDetetive(alvoId) {
if (!currentRoom) return;
document.querySelectorAll('.btn-acao-especial, .btn-pular-acao').forEach(b => { b.disabled = true; });
const res = await fetch('/api/rooms/' + currentRoom.code + '/detetive-investigar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ alvoId }) });
const data = await res.json();
if (data.error) { alert(data.error); document.querySelectorAll('.btn-acao-especial, .btn-pular-acao').forEach(b => { b.disabled = false; }); }
else { document.getElementById('acoes-especiais-section').style.display = 'none'; document.getElementById('game-overlay-text').textContent = '🕵️ Investigacao enviada! Resultado em breve...'; }
}

async function usarSoldado(alvoId) {
if (!currentRoom) return;
document.querySelectorAll('.btn-acao-especial, .btn-pular-acao').forEach(b => { b.disabled = true; });
const res = await fetch('/api/rooms/' + currentRoom.code + '/soldado-atirar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ alvoId }) });
const data = await res.json();
if (data.error) { alert(data.error); document.querySelectorAll('.btn-acao-especial, .btn-pular-acao').forEach(b => { b.disabled = false; }); }
else { document.getElementById('acoes-especiais-section').style.display = 'none'; document.getElementById('game-overlay-text').textContent = '🪖 Tiro disparado! Aguarde o resultado...'; }
}
socket.on('resultado-detetive', (data) => {
// Servidor ja emite direto ao socket do detetive, sem necessidade de filtro por ID
const overlay = document.getElementById('game-overlay-text');
const alvoName = data.alvoName || (data.alvo && data.alvo.name) || 'Jogador';
if (data.eBom) { if (overlay) overlay.textContent = '✅ ' + alvoName + ' e BOA PESSOA'; }
else { if (overlay) overlay.textContent = '❌ ' + alvoName + ' e RUIM (Assassino)'; }
mostrarResultadoDetetive({ eBom: data.eBom, alvo: { name: alvoName } });
});

function mostrarResultadoDetetive(data) {
let popup = document.getElementById('detetive-result-global');
if (!popup) {
popup = document.createElement('div');
popup.id = 'detetive-result-global';
popup.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:99999;display:none;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:28px 40px;border-radius:16px;text-align:center;min-width:220px;box-shadow:0 4px 32px rgba(0,0,0,0.7);';
document.body.appendChild(popup);
}
const alvoName = data.alvo ? data.alvo.name : 'Jogador';
if (data.eBom) {
popup.style.background = 'rgba(10,60,30,0.97)';
popup.style.border = '2px solid #4cff80';
popup.innerHTML = '<div style="font-size:2.5rem">✅</div><div style="font-size:1.1rem;font-weight:700;color:#4cff80">' + alvoName + '</div><div style="font-size:0.9rem;color:#b8ffcc;margin-top:4px">BOA PESSOA</div>';
} else {
popup.style.background = 'rgba(70,5,5,0.97)';
popup.style.border = '2px solid #ff4040';
popup.innerHTML = '<div style="font-size:2.5rem">❌</div><div style="font-size:1.1rem;font-weight:700;color:#ff6060">' + alvoName + '</div><div style="font-size:0.9rem;color:#ffbbbb;margin-top:4px">ASSASSINO!</div>';
}
popup.style.display = 'flex';
setTimeout(() => { popup.style.display = 'none'; }, 6000);
}

socket.on('assassino-falhou', (data) => {
if (isSpectator) return;
const box = document.getElementById('kill-result-box');
if (box) {
box.style.display = 'flex';
const icon = document.getElementById('kill-icon');
const msg = document.getElementById('kill-msg');
const sub = document.getElementById('kill-sub');
icon.textContent = '⚠️';
msg.textContent = 'O assassino falhou!';
sub.textContent = 'Alguem foi protegido pelo Anjo esta noite.';
if (countdownInterval) clearInterval(countdownInterval);
const cd = document.getElementById('game-countdown'); if (cd) cd.textContent = '0s';
const bar = document.getElementById('countdown-bar'); if (bar) bar.style.width = '0%';
}
});

function iniciarCountdown(elId, barId, segundos) {
if (countdownInterval) clearInterval(countdownInterval);
let restante = segundos;
const el = document.getElementById(elId); const bar = barId ? document.getElementById(barId) : null;
function tick() { if (restante < 0) { clearInterval(countdownInterval); return; } if (el) el.textContent = restante + 's'; if (bar) { const pct = (restante / segundos) * 100; bar.style.width = pct + '%'; bar.style.background = restante > 20 ? '#6060ff' : restante > 10 ? '#ffaa00' : '#ff4444'; } restante--; }
tick(); countdownInterval = setInterval(tick, 1000);
}

socket.on('kill-result', (data) => {
if (isSpectator) { const statusEl = document.getElementById('spectator-status'); if (statusEl) statusEl.textContent = '🔪 Alguem foi eliminado!'; return; }
if (countdownInterval) clearInterval(countdownInterval);
const box = document.getElementById('kill-result-box');
const countdown = document.getElementById('game-countdown'); const bar = document.getElementById('countdown-bar');
if (countdown) countdown.textContent = '0s'; if (bar) bar.style.width = '0%';
document.getElementById('vitimas-section').style.display = 'none';
document.getElementById('acoes-especiais-section').style.display = 'none';
const listaMortos = data.mortos || (data.vitima ? [{ vitima: data.vitima, tipo: 'assassino' }] : []);
if (listaMortos.length === 0 && !data.assassinoFalhou) {
if (box) { box.style.display = 'flex'; document.getElementById('kill-icon').textContent = '🌙'; document.getElementById('kill-msg').textContent = 'A noite passou...'; document.getElementById('kill-sub').textContent = 'Ninguem morreu esta noite.'; }
return;
}
if (box) box.style.display = 'flex';
const icon = document.getElementById('kill-icon'); const msg = document.getElementById('kill-msg'); const sub = document.getElementById('kill-sub');
if (listaMortos.length > 0) {
const primeiro = listaMortos[0];
const jogador = primeiro.vitima || primeiro;
const tipo = primeiro.tipo || 'assassino';
if (currentUser && jogador.id === currentUser.id) myStatus = 'dead';
icon.textContent = tipo === 'soldado' ? '🪖' : '☠️';
msg.textContent = jogador.name + ' foi eliminado!';
sub.textContent = (tipo === 'soldado' ? 'O Soldado eliminou ' : 'O Assassino matou ') + jogador.name + '.';
if (listaMortos.length > 1) {
sub.textContent += ' E mais ' + (listaMortos.length - 1) + ' eliminado' + (listaMortos.length > 2 ? 's' : '') + '!';
listaMortos.forEach(m => { const j = m.vitima || m; if (currentUser && j.id === currentUser.id) myStatus = 'dead'; });
}
} else if (data.assassinoFalhou) {
icon.textContent = '⚠️'; msg.textContent = 'O assassino falhou!'; sub.textContent = 'Alguem foi protegido pelo Anjo.';
}
});
socket.on('vote-turn', async (data) => {
if (isSpectator) { const statusEl = document.getElementById('spectator-status'); if (statusEl) statusEl.textContent = '☀️ Votando: ' + data.votante.name + ' (' + data.turnoAtual + '/' + data.totalVotantes + ')'; if (data.feed) renderFeed(data.feed); return; }
if (data.turnoAtual === 1) { resetarPlacar(); }
data.alvos.forEach(a => { nomesJogadoresVotacao[a.id] = a.name; });
nomesJogadoresVotacao[data.votante.id] = data.votante.name;
hideAll(); document.getElementById('vote-screen').classList.add('active');
if (data.feed) renderFeed(data.feed);
const isMyTurn = currentUser && data.votante.id === currentUser.id; const isDead = myStatus === 'dead';
document.getElementById('vote-progress').textContent = 'Votando: ' + data.turnoAtual + ' / ' + data.totalVotantes;
document.getElementById('vote-votante-name').textContent = data.votante.name;
const votanteImg = document.getElementById('vote-votante-img');
if (data.votante.photo) { votanteImg.src = data.votante.photo; votanteImg.style.display = 'block'; } else { votanteImg.style.display = 'none'; }
const msgEl = document.getElementById('vote-message');
if (isMyTurn) { msgEl.textContent = 'E SUA VEZ! Vote em quem acha que e o assassino!'; msgEl.className = 'vote-message minha-vez'; }
else { msgEl.textContent = data.votante.name + ' esta votando. Apenas o microfone dele esta ativo.'; msgEl.className = 'vote-message'; }
const btnMic = document.getElementById('btn-mic-vote');
if (isMyTurn && !isDead) { if (btnMic) { btnMic.disabled = false; btnMic.title = ''; } await abrirMicAutomatico(); }
else { forceMute(); if (btnMic) { btnMic.disabled = true; btnMic.title = isDead ? 'Eliminado' : 'Aguarde sua vez'; } }
const alvosDiv = document.getElementById('vote-alvos'); alvosDiv.innerHTML = '';
if (isMyTurn && !isDead) {
data.alvos.forEach(alvo => { const btn = document.createElement('button'); btn.className = 'btn-votar-alvo'; btn.setAttribute('data-id', alvo.id); btn.innerHTML = (alvo.photo ? '<img src="' + alvo.photo + '" class="vitima-avatar">' : '<div class="vitima-avatar-placeholder">' + alvo.name.charAt(0) + '</div>') + '<span>' + alvo.name + '</span>'; btn.addEventListener('click', () => votar(alvo.id)); alvosDiv.appendChild(btn); });
} else { alvosDiv.innerHTML = '<p class="aguardando-texto">' + (isDead ? 'Voce foi eliminado. Apenas observe.' : 'Aguarde a vez de ' + data.votante.name + '...') + '</p>'; }
iniciarCountdown('vote-countdown', 'vote-countdown-bar', data.segundos || 60);
});

socket.on('vote-cast', (data) => {
if (isSpectator) return;
if (data.alvoId) { votosAcumulados[data.alvoId] = (votosAcumulados[data.alvoId] || 0) + 1; atualizarPlacar(); }
if (countdownInterval) clearInterval(countdownInterval);
const el = document.getElementById('vote-countdown'); if (el) el.textContent = '✓';
document.querySelectorAll('.btn-votar-alvo').forEach(b => { b.disabled = true; if (b.getAttribute('data-id') === data.alvoId) b.classList.add('votado'); });
const msgEl = document.getElementById('vote-message');
if (msgEl && currentUser && data.votanteId === currentUser.id) { msgEl.textContent = data.forcado ? 'Tempo esgotado! Voto automatico registrado.' : 'Voto registrado! Aguarde...'; }
forceMute();
});

socket.on('vote-result', (data) => {
if (isSpectator) { if (data.feed) renderFeed(data.feed); const statusEl = document.getElementById('spectator-status'); if (statusEl) { if (data.empate) statusEl.textContent = '🤝 Empate na votacao!'; else if (data.era_palhaco) statusEl.textContent = '🤡 O Palhaco venceu!'; else statusEl.textContent = data.era_assassino ? '🎉 Assassino eliminado!' : '😢 ' + (data.eliminado ? data.eliminado.name : '') + ' eliminado'; } return; }
if (countdownInterval) clearInterval(countdownInterval);
if (data.feed) renderFeed(data.feed);
hideAll(); document.getElementById('result-screen').classList.add('active');
const iconEl = document.getElementById('result-icon'); const titleEl = document.getElementById('result-title'); const subEl = document.getElementById('result-sub'); const roleRevealEl = document.getElementById('result-role-reveal');
if (data.empate) { iconEl.textContent = '🤝'; titleEl.textContent = 'EMPATE!'; subEl.textContent = 'Ninguem foi eliminado. A cidade volta a dormir...'; roleRevealEl.style.display = 'none'; }
else {
const papel = data.papel || 'cidadao';
const estilo = PAPEL_ESTILOS[papel] || PAPEL_ESTILOS.cidadao;
iconEl.textContent = data.era_assassino ? '🎉' : (data.era_palhaco ? '🤡' : '😢');
titleEl.textContent = data.eliminado.name + ' foi eliminado!';
subEl.textContent = data.era_assassino ? 'A cidade venceu! Era o Assassino!' : (data.era_palhaco ? '🤡 O Palhaco foi eliminado — ele venceu sozinho!' : 'Era ' + estilo.emoji + ' ' + (papel.charAt(0).toUpperCase() + papel.slice(1)));
roleRevealEl.style.display = 'block';
roleRevealEl.textContent = estilo.emoji + ' ERA ' + (data.era_assassino ? 'O ASSASSINO!' : (data.era_palhaco ? 'O PALHACO!' : 'UM ' + papel.toUpperCase()));
roleRevealEl.className = 'role-reveal ' + (data.era_assassino ? 'assassino' : data.era_palhaco ? 'palhaco' : 'cidadao');
if (currentUser && data.eliminado.id === currentUser.id) myStatus = 'dead';
}
forceMute();
});
function mostrarTelaDecisao(data) {
if (isSpectator) { const statusEl = document.getElementById('spectator-status'); const txt = data.vencedor === 'palhaco' ? 'Palhaco Venceu!' : data.tipo === 'reveal' ? 'Assassino Venceu!' : (data.vencedor === 'cidade' ? 'Cidade Venceu!' : 'Assassino Venceu!'); if (statusEl) statusEl.textContent = '🏆 ' + txt; return; }
if (countdownInterval) clearInterval(countdownInterval); if (decisionInterval) clearInterval(decisionInterval);
forceMute(); myStatus = 'alive';
hideAll(); document.getElementById('decision-screen').classList.add('active');
if (data.tipo === 'reveal') { document.getElementById('decision-icon').textContent = '💀'; document.getElementById('decision-title').textContent = 'ASSASSINO VENCEU!'; const rev = document.getElementById('decision-reveal'); if (rev) { rev.style.display = 'block'; rev.textContent = '🔪 ' + data.assassino.name + ' ERA O ASSASSINO!'; rev.className = 'role-reveal assassino'; } }
else {
let icon, title;
if (data.vencedor === 'palhaco') { icon = '🤡'; title = (data.vencedorNome || 'Palhaco') + ' — O PALHACO VENCEU!'; }
else if (data.vencedor === 'cidade') { icon = '🏆'; title = 'CIDADE VENCEU!'; }
else { icon = '💀'; title = 'ASSASSINO VENCEU!'; }
document.getElementById('decision-icon').textContent = icon;
document.getElementById('decision-title').textContent = title;
const rev = document.getElementById('decision-reveal'); if (rev) rev.style.display = 'none';
}
const btns = document.getElementById('decision-btns'); const aguardando = document.getElementById('decision-aguardando'); const votoInfo = document.getElementById('decision-voto-info');
if (btns) btns.style.display = 'flex'; if (aguardando) aguardando.style.display = 'none'; if (votoInfo) votoInfo.textContent = '';
let restante = data.segundosDecisao || 30;
const timerEl = document.getElementById('decision-timer'); if (timerEl) timerEl.textContent = restante;
decisionInterval = setInterval(() => { restante--; if (timerEl) timerEl.textContent = restante; if (restante <= 0) { clearInterval(decisionInterval); sairPosjogo(); } }, 1000);
}

socket.on('fim-de-jogo', (data) => { mostrarTelaDecisao(data); });
socket.on('replay-voto', (data) => { const votoInfo = document.getElementById('decision-voto-info'); if (votoInfo) votoInfo.textContent = data.votosCount + ' de ' + data.total + ' querem jogar novamente'; });

async function jogarNovamente() {
if (!currentRoom) return;
const btnSim = document.getElementById('btn-decision-sim'); const btnNao = document.getElementById('btn-decision-nao');
if (btnSim) btnSim.disabled = true; if (btnNao) btnNao.disabled = true;
if (decisionInterval) clearInterval(decisionInterval);
await fetch('/api/rooms/' + currentRoom.code + '/jogar-novamente', { method: 'POST' });
const btns = document.getElementById('decision-btns'); const aguardando = document.getElementById('decision-aguardando');
if (btns) btns.style.display = 'none'; if (aguardando) aguardando.style.display = 'block';
}
async function sairPosjogo() {
if (!currentRoom) return; if (decisionInterval) clearInterval(decisionInterval);
await fetch('/api/rooms/' + currentRoom.code + '/sair-pos-jogo', { method: 'POST' });
currentRoom = null; isSpectator = false; showHome(currentUser);
}
async function votar(alvoId) {
if (!currentRoom) return; document.querySelectorAll('.btn-votar-alvo').forEach(b => { b.disabled = true; });
const res = await fetch('/api/rooms/' + currentRoom.code + '/vote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ alvoId }) });
const data = await res.json(); if (data.error) { alert(data.error); document.querySelectorAll('.btn-votar-alvo').forEach(b => { b.disabled = false; }); }
}

async function carregarSalas() {
const lista = document.getElementById('salas-lista'); lista.innerHTML = '<div class="salas-loading">Carregando...</div>';
try {
const res = await fetch('/api/rooms'); const data = await res.json(); const salas = data.rooms;
if (!salas || salas.length === 0) { lista.innerHTML = '<div class="salas-vazio">Nenhuma sala aberta no momento.<br>Que tal criar uma?</div>'; return; }
lista.innerHTML = '';
salas.forEach(sala => {
const div = document.createElement('div'); div.className = 'sala-item';
const statusLabel = sala.status === 'waiting' ? '<span class="sala-status-aguardando">⏳ Aguardando</span>' : '<span class="sala-status-jogo">🔴 Em jogo</span>';
const entrarLabel = sala.status === 'waiting' && sala.players < 50 ? 'Entrar' : '👁️ Observar';
div.innerHTML = '<div class="sala-info"><span class="sala-codigo">' + sala.code + '</span><span class="sala-host">Host: ' + sala.host + '</span></div><div class="sala-right">' + statusLabel + '<span class="sala-players">👥 ' + sala.players + '/50</span>' + (sala.spectators > 0 ? '<span class="sala-spectators">👁️ ' + sala.spectators + '</span>' : '') + '<button class="btn-entrar-sala" data-code="' + sala.code + '" data-status="' + sala.status + '" data-players="' + sala.players + '">' + entrarLabel + '</button></div>';
lista.appendChild(div);
});
lista.querySelectorAll('.btn-entrar-sala').forEach(btn => { btn.addEventListener('click', () => entrarNaSala(btn.dataset.code, btn.dataset.status, parseInt(btn.dataset.players))); });
} catch (e) { lista.innerHTML = '<div class="salas-vazio">Erro ao carregar salas.</div>'; }
}
async function entrarNaSala(code, status, playerCount) { const res = await fetch('/api/rooms/' + code.toUpperCase() + '/join', { method: 'POST', headers: { 'Content-Type': 'application/json' } }); const data = await res.json(); if (data.error) { alert(data.error); return; } if (data.asSpectator) { showSpectatorRoom(data.room); } else { showRoom(data.room); } }
function renderRoom(room) {
document.getElementById('room-code').textContent = room.code;
document.getElementById('room-players-count').textContent = room.players.length;
document.getElementById('room-min').textContent = room.minPlayers;
const specBadge = document.getElementById('room-spectators'); if (specBadge) specBadge.textContent = (room.spectators || 0) > 0 ? '👁️ ' + room.spectators + ' espectador' + (room.spectators === 1 ? '' : 'es') : '';
const list = document.getElementById('players-list'); list.innerHTML = '';
room.players.forEach(p => { const div = document.createElement('div'); div.className = 'player-item'; div.setAttribute('data-userid', p.id); const initials = p.name.charAt(0).toUpperCase(); const micIcon = '<span class="mic-indicator">🔇</span>'; div.innerHTML = p.photo ? '<img src="' + p.photo + '" class="player-avatar-img"><div class="player-info"><span class="player-name">' + p.name + (p.isHost ? ' <span class="host-badge">HOST</span>' : '') + '</span>' + micIcon + '</div>' : '<div class="player-avatar-placeholder">' + initials + '</div><div class="player-info"><span class="player-name">' + p.name + (p.isHost ? ' <span class="host-badge">HOST</span>' : '') + '</span>' + micIcon + '</div>'; list.appendChild(div); });
const startBtn = document.getElementById('btn-start'); const fakeBtn = document.getElementById('btn-add-fake'); const isHost = currentUser && room.host === currentUser.id;
if (isHost) { startBtn.style.display = 'block'; const canStart = room.players.length >= room.minPlayers; startBtn.disabled = !canStart; startBtn.title = canStart ? '' : 'Precisa de pelo menos ' + room.minPlayers + ' jogadores'; if (fakeBtn) fakeBtn.style.display = 'block'; }
else { startBtn.style.display = 'none'; if (fakeBtn) fakeBtn.style.display = 'none'; }
}

document.getElementById('card-criar').addEventListener('click', async () => { const res = await fetch('/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) }); const data = await res.json(); if (data.error) { alert(data.error); return; } showRoom(data.room); });
document.getElementById('card-entrar').addEventListener('click', () => showJoin());
document.getElementById('btn-voltar-join').addEventListener('click', () => showHome(currentUser));
document.getElementById('btn-atualizar').addEventListener('click', () => carregarSalas());
document.getElementById('btn-buscar-codigo').addEventListener('click', () => { const codigo = document.getElementById('input-codigo').value.trim().toUpperCase(); if (!codigo) { alert('Digite o codigo da sala'); return; } entrarNaSala(codigo); });
document.getElementById('input-codigo').addEventListener('keydown', (e) => { if (e.key === 'Enter') document.getElementById('btn-buscar-codigo').click(); document.getElementById('input-codigo').value = document.getElementById('input-codigo').value.toUpperCase(); });
document.getElementById('btn-sair-sala').addEventListener('click', async () => { if (!currentRoom) return; pararAudio(); if (!isSpectator) { await fetch('/api/rooms/' + currentRoom.code + '/leave', { method: 'DELETE' }); } currentRoom = null; isSpectator = false; showHome(currentUser); });
document.getElementById('btn-mic').addEventListener('click', () => toggleMic());
const btnMicVote = document.getElementById('btn-mic-vote'); if (btnMicVote) btnMicVote.addEventListener('click', () => toggleMic());
document.getElementById('btn-add-fake').addEventListener('click', async () => { if (!currentRoom) return; const res = await fetch('/api/rooms/' + currentRoom.code + '/add-fake-players', { method: 'POST', headers: { 'Content-Type': 'application/json' } }); const data = await res.json(); if (data.error) { alert(data.error); return; } currentRoom = data.room; renderRoom(data.room); });
document.getElementById('btn-start').addEventListener('click', async () => { if (!currentRoom) return; const res = await fetch('/api/rooms/' + currentRoom.code + '/start', { method: 'POST', headers: { 'Content-Type': 'application/json' } }); const data = await res.json(); if (data.error) { alert(data.error); } });
const btnDecisionSim = document.getElementById('btn-decision-sim'); if (btnDecisionSim) { btnDecisionSim.addEventListener('click', () => jogarNovamente()); }
const btnDecisionNao = document.getElementById('btn-decision-nao'); if (btnDecisionNao) { btnDecisionNao.addEventListener('click', () => sairPosjogo()); }
const btnSairPosJogo = document.getElementById('btn-sair-pos-jogo'); if (btnSairPosJogo) { btnSairPosJogo.addEventListener('click', async () => { if (!currentRoom) return; await fetch('/api/rooms/' + currentRoom.code + '/sair-pos-jogo', { method: 'POST' }); currentRoom = null; isSpectator = false; showHome(currentUser); }); }
const btnReplay = document.getElementById('btn-replay'); if (btnReplay) { btnReplay.addEventListener('click', () => jogarNovamente()); }
const btnSairSpec = document.getElementById('btn-sair-spectator'); if (btnSairSpec) { btnSairSpec.addEventListener('click', () => { currentRoom = null; isSpectator = false; showHome(currentUser); }); }
socket.on('room-update', (room) => { if (currentRoom && room.code === currentRoom.code) { currentRoom = room; if (!isSpectator) renderRoom(room); } });
socket.on('game-night-player', (data) => { if (currentUser && data.playerId === currentUser.id) { showGame({ papelId: data.papel, papelInfo: data.papelInfo, segundos: data.segundos, vitimas: data.vitimas || [], feed: data.feed || [] }); } });
socket.on('game-night', (data) => { if (isSpectator) { showSpectatorView({ status: 'night', feed: data.feed || [], spectators: 0 }); } });
socket.on('room-reset', (data) => { if (countdownInterval) clearInterval(countdownInterval); if (decisionInterval) clearInterval(decisionInterval); forceMute(); myStatus = 'alive'; isSpectator = false; currentRoom = data.room; showRoom(data.room); });
socket.on('sala-pronta', (data) => { if (isSpectator) return; if (decisionInterval) clearInterval(decisionInterval); currentRoom = data.room; myStatus = 'alive'; meuPapel = 'cidadao'; showRoom(data.room); });
socket.on('jogador-saiu-pos-jogo', (data) => { if (currentUser && data.userId === currentUser.id) { if (decisionInterval) clearInterval(decisionInterval); currentRoom = null; isSpectator = false; showHome(currentUser); } });
socket.on('sala-fechada', (data) => { if (countdownInterval) clearInterval(countdownInterval); if (decisionInterval) clearInterval(decisionInterval); pararAudio(); currentRoom = null; isSpectator = false; myStatus = 'alive'; alert(data.motivo || 'A sala foi encerrada.'); if (currentUser) showHome(currentUser); else showLogin(); });

// ===== PLACAR DE VOTOS =====
let votosAcumulados = {};
let nomesJogadoresVotacao = {};

function resetarPlacar() {
  votosAcumulados = {};
  nomesJogadoresVotacao = {};
  const placar = document.getElementById('vote-placar');
  if (placar) placar.style.display = 'none';
}

function atualizarPlacar() {
  const placar = document.getElementById('vote-placar');
  if (!placar) return;
  const comVotos = Object.entries(votosAcumulados).filter(([id, qtd]) => qtd > 0);
  if (comVotos.length === 0) { placar.style.display = 'none'; return; }
  comVotos.sort((a, b) => b[1] - a[1]);
  placar.style.display = 'flex';
  placar.innerHTML = comVotos.map(([id, qtd]) => {
    const nome = nomesJogadoresVotacao[id] || id;
    const primeiroNome = nome.split(' ')[0];
    return '<span class="placar-item"><span class="placar-nome">' + primeiroNome + '</span><span class="placar-votos">' + qtd + '</span></span>';
  }).join('');
}

// ===== CHAT DA SALA =====
let chatMinimizado = false;
let chatAberto = false;

// ===== CHAT: ICONE + PAINEL + NOTIFICACOES =====

function mostrarChat() {
  const icone = document.getElementById('chat-icone');
  if (icone) icone.style.display = 'flex';
}

function esconderChat() {
  const icone = document.getElementById('chat-icone');
  const painel = document.getElementById('chat-painel');
  if (icone) icone.style.display = 'none';
  if (painel) painel.style.display = 'none';
}

function limparMensagensChat() {
  const notifs = document.getElementById('chat-notifs');
  if (notifs) notifs.innerHTML = '';
}

function mostrarNotifChat(msg) {
  const notifs = document.getElementById('chat-notifs');
  if (!notifs) return;
  const div = document.createElement('div');
  div.className = 'chat-notif';
  const nome = document.createElement('span');
  nome.className = 'chat-notif-nome';
  nome.textContent = (msg.isSpectator ? '👁 ' : '') + msg.nomeUsuario + ':';
  const texto = document.createElement('span');
  texto.className = 'chat-notif-texto';
  texto.textContent = msg.texto;
  div.appendChild(nome);
  div.appendChild(texto);
  notifs.appendChild(div);
  setTimeout(() => {
    div.classList.add('saindo');
    setTimeout(() => { if (div.parentNode) div.parentNode.removeChild(div); }, 300);
  }, 5000);
}

function iniciarChat() {
  const icone = document.getElementById('chat-icone');
  const painel = document.getElementById('chat-painel');
  const input = document.getElementById('chat-input');
  const btn = document.getElementById('chat-enviar');
  const counter = document.getElementById('chat-char-count');
  if (!icone || !painel || !input || !btn) return;
  icone.addEventListener('click', () => {
    const aberto = painel.style.display !== 'none';
    painel.style.display = aberto ? 'none' : 'block';
    if (!aberto) {
      input.value = '';
      if (counter) counter.textContent = '0/50';
      input.focus();
    }
  });
  if (counter) {
    input.addEventListener('input', () => {
      const len = input.value.length;
      counter.textContent = len + '/50';
      counter.className = 'chat-painel-counter' + (len >= 50 ? ' cheio' : len >= 40 ? ' quase' : '');
    });
  }
  btn.addEventListener('click', enviarMensagemChat);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') enviarMensagemChat(); });
}

function enviarMensagemChat() {
  if (!currentRoom || !currentUser) return;
  const input = document.getElementById('chat-input');
  const painel = document.getElementById('chat-painel');
  if (!input) return;
  const texto = input.value.trim().slice(0, 50);
  if (!texto) return;
  socket.emit('chat-mensagem', {
    code: currentRoom.code,
    texto,
    nomeUsuario: currentUser.displayName || currentUser.name,
    isSpectator: isSpectator || false
  });
  input.value = '';
  const counter = document.getElementById('chat-char-count');
  if (counter) counter.textContent = '0/50';
  if (painel) painel.style.display = 'none';
}

socket.on('chat-mensagem', (msg) => {
  mostrarNotifChat(msg);
});

// Inicializar chat ao carregar
iniciarChat();
checkAuth();


// === SISTEMA DE AUTH PROPRIO ===

// initApp é chamado pelo index.html após login bem-sucedido
window.initApp = function(user) {
  if (user) showHome(user);
};

// Logout
window.fazerLogout = async function() {
  await fetch('/api/logout', { method: 'POST' });
  location.reload();
};

// Atualizar foto de perfil
window.atualizarFoto = async function() {
  const url = prompt('Cole a URL da sua foto de perfil:');
  if (!url) return;
  const r = await fetch('/api/perfil/foto', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({foto_url: url}) });
  if (r.ok) { alert('Foto atualizada! Recarregando...'); location.reload(); }
  else alert('Erro ao atualizar foto.');
};

// Painel Admin - aprovação de cadastros e busca por telefone
window.abrirPainelAdmin = async function() {
  let modal = document.getElementById('admin-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'admin-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:9999;display:flex;align-items:center;justify-content:center';
    modal.innerHTML = `
      <div style="background:#1a1a2e;border-radius:16px;padding:24px;width:90%;max-width:480px;max-height:80vh;overflow-y:auto;color:#fff">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <h2 style="margin:0;color:#6c63ff">👑 Painel Admin</h2>
          <button onclick="document.getElementById('admin-modal').remove()" style="background:none;border:none;color:#fff;font-size:22px;cursor:pointer">✕</button>
        </div>
        
        <h3 style="color:#ffcc00;margin-bottom:8px">📋 Cadastros Pendentes</h3>
        <div id="admin-pendentes" style="margin-bottom:20px">Carregando...</div>
        
        <h3 style="color:#6bff8e;margin-bottom:8px">🔍 Buscar por Telefone</h3>
        <div style="display:flex;gap:8px">
          <input id="admin-busca-tel" type="text" placeholder="00 9 0000-0000" oninput="formatarTelefoneAdmin(this)" maxlength="15" style="flex:1;padding:8px;border-radius:8px;border:1px solid #444;background:#111;color:#fff;font-size:14px">
          <button onclick="buscarPorTelefone()" style="padding:8px 14px;border-radius:8px;border:none;background:#6c63ff;color:#fff;cursor:pointer">Buscar</button>
        </div>
        <div id="admin-resultado-busca" style="margin-top:10px;color:#aaa;font-size:14px"></div>
      </div>
    `;
    document.body.appendChild(modal);
  } else {
    modal.style.display = 'flex';
  }
  carregarPendentes();
};

function formatarTelefoneAdmin(input) {
  let v = input.value.replace(/\D/g, '').substring(0, 11);
  if (v.length > 7) v = v.replace(/(\d{2})(\d{1})(\d{4})(\d{0,4})/, '$1 $2 $3-$4');
  else if (v.length > 3) v = v.replace(/(\d{2})(\d{1})(\d{0,4})/, '$1 $2 $3');
  else if (v.length > 2) v = v.replace(/(\d{2})(\d{0,1})/, '$1 $2');
  input.value = v;
}

async function carregarPendentes() {
  const el = document.getElementById('admin-pendentes');
  if (!el) return;
  const r = await fetch('/api/admin/pendentes');
  const pendentes = await r.json();
  if (!pendentes.length) { el.innerHTML = '<span style="color:#888">Nenhum cadastro pendente.</span>'; return; }
  el.innerHTML = pendentes.map(p => `
    <div style="background:#111;border-radius:8px;padding:10px;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between">
      <div>
        <strong>${p.username}</strong>
        <span style="color:#888;font-size:12px;margin-left:8px">${new Date(p.created_at).toLocaleDateString('pt-BR')}</span>
      </div>
      <div style="display:flex;gap:6px">
        <button onclick="aprovarUser(${p.id}, 'aprovado')" style="padding:5px 10px;border-radius:6px;border:none;background:#6bff8e;color:#111;font-weight:bold;cursor:pointer">✓ Aprovar</button>
        <button onclick="aprovarUser(${p.id}, 'rejeitado')" style="padding:5px 10px;border-radius:6px;border:none;background:#ff6b6b;color:#fff;font-weight:bold;cursor:pointer">✗ Rejeitar</button>
      </div>
    </div>
  `).join('');
}

async function aprovarUser(userId, acao) {
  await fetch('/api/admin/aprovar', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({userId, acao}) });
  carregarPendentes();
}

async function buscarPorTelefone() {
  const tel = document.getElementById('admin-busca-tel').value;
  const el = document.getElementById('admin-resultado-busca');
  if (!tel) return;
  const r = await fetch('/api/admin/buscar-telefone?tel=' + encodeURIComponent(tel));
  const results = await r.json();
  if (!results.length) { el.innerHTML = '<span style="color:#ff6b6b">Nenhum usuário encontrado.</span>'; return; }
  el.innerHTML = results.map(u => `
    <div style="background:#111;border-radius:8px;padding:10px;margin-top:6px">
      <strong>${u.username}</strong>
      <span style="color:#6c63ff;font-size:12px;margin-left:8px">${u.status}</span><br>
      <span style="color:#888;font-size:12px">Tel: ${u.telefone} | Último login: ${u.ultimo_login ? new Date(u.ultimo_login).toLocaleDateString('pt-BR') : 'Nunca'}</span>
    </div>
  `).join('');
}
