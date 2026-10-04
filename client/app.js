const cfg = {
  signalUrl: `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname || 'localhost'}:3000`
};

const $ = id => document.getElementById(id);
const ADJECTIVES = ["Cosmic", "Clever", "Crimson", "Electric", "Swift", "Mystic", "Cobalt", "Lucky", "Velvet", "Crispy"];
const NOUNS = ["Mango", "Avocado", "Broccoli", "Pineapple", "Otter", "Lemon", "Falcon", "Kiwi", "Panda", "Radish"];
const generateDeviceName = () => `${ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]} ${NOUNS[Math.floor(Math.random() * NOUNS.length)]}`;

const generateId = () => (window.crypto && crypto.randomUUID && crypto.randomUUID()) || Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
const state = { id: generateId(), name: generateDeviceName(), ws: null, peers: [], selected: new Set(), connections: new Map() };


$('fileInput').addEventListener('change', () => {
  const f = $('fileInput').files[0];
  $('fileInfo').textContent = f ? `${f.name} • ${formatSize(f.size)}` : 'Select a device and a file.';
});
$('sendFile').onclick = () => sendFile();
$('sendText').onclick = () => sendText($('textInput').value);
$('sendClip').onclick = async () => { try { sendText(await navigator.clipboard.readText()); } catch { setStatus('Clipboard permission denied'); } };
$('copyText').onclick = async () => { 
  try { 
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText($('textInput').value); 
    } else {
      const ta = $('textInput');
      ta.select();
      document.execCommand('copy');
      window.getSelection().removeAllRanges();
    }
    setTransfer('Text copied to clipboard!'); 
  } catch(e) { 
    setStatus('Clipboard permission denied'); 
  } 
};

function setStatus(s) { $('status').textContent = s; }
function setTransfer(s) { 
  let el = $('sys-msg');
  if (!el) {
    el = document.createElement('div'); el.id = 'sys-msg'; el.className = 'muted';
    const box = $('transfers'); if (box.innerHTML.includes('Idle')) box.innerHTML = '';
    box.appendChild(el);
  }
  el.textContent = s; 
}

function updateTransfer(id, label, progress) {
  const box = $('transfers');
  if (box.innerHTML.includes('Idle')) box.innerHTML = '';
  let el = $(`tx-${id}`);
  if (!el) {
    el = document.createElement('div'); el.id = `tx-${id}`;
    el.innerHTML = `<div style="display:flex; justify-content:space-between; font-weight:bold; margin-bottom:4px;"><span></span><span></span></div><progress value="0" max="100"></progress>`;
    box.appendChild(el);
  }
  const spans = el.querySelectorAll('span');
  spans[0].textContent = label; spans[1].textContent = `${Math.round(progress)}%`;
  el.querySelector('progress').value = progress;
  if (progress >= 100) setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); if (!box.children.length) box.innerHTML = '<p class="muted">Idle</p>'; }, 3000);
}
function formatSize(n) { const u = ['B','KB','MB','GB']; let i=0; while(n>=1024 && i<u.length-1){n/=1024;i++;} return `${n.toFixed(i?1:0)} ${u[i]}`; }
function sendSignal(to, data) { state.ws?.send(JSON.stringify({ type: 'signal', to, data })); }

function connectSignal() {
  state.ws = new WebSocket(cfg.signalUrl);
  state.ws.onopen = () => {
    setStatus(`Online as ${state.name}`);
    state.ws.send(JSON.stringify({ type: 'register', id: state.id, name: state.name }));
  };
  state.ws.onclose = () => { setStatus('Signaling server disconnected'); setTimeout(connectSignal, 2000); };
  state.ws.onerror = () => setStatus('Could not connect to signaling server');
  state.ws.onmessage = e => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'registered' || msg.type === 'peers') renderPeers(msg.peers || []);
    if (msg.type === 'signal') handleSignal(msg.from, msg.data);
    if (msg.type === 'error') setStatus(msg.message);
  };
}

function renderPeers(peers) {
  state.peers = peers.filter(p => p.id !== state.id);
  for (const id of state.selected) {
    if (!state.peers.find(p => p.id === id)) state.selected.delete(id);
  }
  const box = $('devices'); box.innerHTML = '';
  if (!state.peers.length) { box.innerHTML = '<p class="muted">No other LANDrop devices online.</p>'; return; }
  for (const p of state.peers) {
    const el = document.createElement('div'); el.className = `device ${state.selected.has(p.id) ? 'selected' : ''}`;
    el.innerHTML = `<span>🟢 ${escapeHtml(p.name)}</span><button>${state.selected.has(p.id) ? 'Deselect' : 'Select'}</button>`;
    el.querySelector('button').onclick = () => selectPeer(p.id);
    box.appendChild(el);
  }
}
function selectPeer(id) {
  if (state.selected.has(id)) state.selected.delete(id);
  else state.selected.add(id);
  renderPeers(state.peers);
  const disabled = state.selected.size === 0;
  $('sendFile').disabled = disabled; $('sendText').disabled = disabled; $('sendClip').disabled = disabled || !navigator.clipboard;
  setTransfer(state.selected.size ? `Selected ${state.selected.size} device(s)` : 'Idle');
}

function getConnection(peerId) {
  if (!state.connections.has(peerId)) {
    state.connections.set(peerId, { pc: null, dc: null, incoming: null });
  }
  return state.connections.get(peerId);
}

async function createConnection(peerId, offerer) {
  const conn = getConnection(peerId);
  if (conn.pc) conn.pc.close();
  conn.pc = new RTCPeerConnection({ iceServers: [] });
  conn.pc.onicecandidate = e => { if (e.candidate) sendSignal(peerId, { kind: 'candidate', candidate: e.candidate }); };
  conn.pc.onconnectionstatechange = () => setTransfer(`WebRTC: ${conn.pc.connectionState}`);
  conn.pc.ondatachannel = e => setupChannel(conn, e.channel, peerId);
  if (offerer) {
    conn.dc = conn.pc.createDataChannel('LANDrop', { ordered: true }); setupChannel(conn, conn.dc, peerId);
    const offer = await conn.pc.createOffer(); await conn.pc.setLocalDescription(offer);
    sendSignal(peerId, { kind: 'offer', sdp: conn.pc.localDescription });
  }
}
function setupChannel(conn, dc, peerId) {
  conn.dc = dc; dc.binaryType = 'arraybuffer';
  dc.onopen = () => setTransfer('Secure WebRTC channel ready');
  dc.onclose = () => setTransfer('WebRTC channel closed');
  dc.onerror = () => setTransfer('WebRTC channel error');
  dc.onmessage = e => handleData(conn, e.data, peerId);
}
async function ensureChannel(peerId) {
  const conn = getConnection(peerId);
  if (conn.dc?.readyState === 'open') return conn.dc;
  await createConnection(peerId, true);
  return new Promise((resolve, reject) => {
    const t = setInterval(() => { if (conn.dc?.readyState === 'open') { clearInterval(t); resolve(conn.dc); } }, 50);
    setTimeout(() => { clearInterval(t); reject(new Error('WebRTC connection timeout')); }, 15000);
  });
}
async function handleSignal(from, data) {
  const conn = getConnection(from);
  if (!conn.pc) {
    await createConnection(from, false);
  }
  if (data.kind === 'offer') {
    if (conn.pc.signalingState !== 'stable') {
      if (state.id > from) return; // Impolite, ignore
      await Promise.all([conn.pc.setLocalDescription({type: 'rollback'}), conn.pc.setRemoteDescription(data.sdp)]);
    } else {
      await conn.pc.setRemoteDescription(data.sdp);
    }
    const ans = await conn.pc.createAnswer(); await conn.pc.setLocalDescription(ans);
    sendSignal(from, { kind: 'answer', sdp: conn.pc.localDescription });
  } else if (data.kind === 'answer') {
    if (conn.pc.signalingState !== 'stable') await conn.pc.setRemoteDescription(data.sdp);
  } else if (data.kind === 'candidate') { try { await conn.pc.addIceCandidate(data.candidate); } catch {} }
}

async function compressData(data) {
  const stream = new Response(data).body.pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function decompressData(data) {
  const stream = new Response(data).body.pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function sendText(text) {
  if (!text) return setTransfer('Nothing to send');
  let data = new TextEncoder().encode(text);
  const meta = { type: 'text', name: 'text', size: data.byteLength };
  if (window.CompressionStream && data.byteLength > 1024) {
    try { data = await compressData(data); meta.compressed = 'gzip'; } catch(e) {}
  }
  await sendPayload(data, meta);
}
async function sendFile() {
  const f = $('fileInput').files[0]; if (!f) return setTransfer('Choose a file first');
  let data = new Uint8Array(await f.arrayBuffer());
  const mime = f.type || 'application/octet-stream';
  const meta = { type: 'file', name: f.name, size: f.size, mime };
  
  const skip = mime.startsWith('image/') || mime.startsWith('video/') || mime.startsWith('audio/') || mime.includes('zip') || mime.includes('compressed') || f.name.match(/\.(zip|rar|7z|gz|jpg|jpeg|png|gif|mp4|webm|mp3)$/i);
  if (!skip && window.CompressionStream) {
    try {
      setTransfer(`Compressing ${f.name}...`);
      data = await compressData(data);
      meta.compressed = 'gzip';
    } catch(e) { console.error(e); }
  }
  await sendPayload(data, meta);
}

async function sha256(data) {
  if (!window.crypto || !crypto.subtle) return 'no-hash';
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map(x => x.toString(16).padStart(2,'0')).join('');
}

async function sendPayload(data, meta) {
  if (state.selected.size === 0) return setTransfer('Select a device first');
  const hash = await sha256(data);
  const selectedPeers = Array.from(state.selected);
  setTransfer(`Sending to ${selectedPeers.length} peer(s)...`);
  
  await Promise.all(selectedPeers.map(async peerId => {
    try {
      const txId = generateId();
      const dc = await ensureChannel(peerId);
      dc.send(JSON.stringify({ type: 'start', id: txId, meta: { ...meta, hash, size: data.byteLength } }));
      const chunk = 16 * 1024;
      let sent = 0;
      while (sent < data.byteLength) {
        while (dc.bufferedAmount > 4 * 1024 * 1024) await new Promise(r => setTimeout(r, 20));
        const part = data.slice(sent, Math.min(sent + chunk, data.byteLength));
        dc.send(part); sent += part.byteLength;
        updateTransfer(txId, `Sending ${meta.name}`, data.byteLength ? sent / data.byteLength * 100 : 100);
      }
      dc.send(JSON.stringify({ type: 'end', id: txId }));
    } catch(e) {
      console.error(`Failed to send to ${peerId}:`, e);
    }
  }));
  setTransfer(`Sent ${meta.name}` + (hash === 'no-hash' ? '' : ` • SHA-256 ${hash.slice(0, 16)}…`));
}

function handleData(conn, raw, peerId) {
  if (typeof raw === 'string') {
    const msg = JSON.parse(raw);
    if (msg.type === 'start') conn.incoming = { id: msg.id, meta: msg.meta, parts: [], size: 0 };
    if (msg.type === 'end' && conn.incoming?.id === msg.id) finishIncoming(conn, peerId);
    return;
  }
  if (conn.incoming) { 
    conn.incoming.parts.push(new Uint8Array(raw)); 
    conn.incoming.size += raw.byteLength; 
    const pct = conn.incoming.meta.size ? conn.incoming.size / conn.incoming.meta.size * 100 : 0;
    updateTransfer(conn.incoming.id, `Receiving ${conn.incoming.meta.name}`, pct);
  }
}
async function finishIncoming(conn, peerId) {
  const x = conn.incoming; conn.incoming = null;
  let data = concat(x.parts, x.size); const hash = await sha256(data);
  const ok = hash === x.meta.hash || hash === 'no-hash' || x.meta.hash === 'no-hash';
  updateTransfer(x.id, `Received ${x.meta.name}`, 100);
  if (!ok) { setTransfer(`✗ Integrity check failed for ${x.meta.name}`); return; }
  
  if (x.meta.compressed === 'gzip' && window.DecompressionStream) {
    try {
      setTransfer(`Decompressing ${x.meta.name}...`);
      data = await decompressData(data);
    } catch(e) {
      setTransfer(`✗ Decompression failed for ${x.meta.name}`); return;
    }
  }

  setTransfer(hash === 'no-hash' ? `✓ Received ${x.meta.name}` : `✓ Received and verified ${x.meta.name}`);
  if (x.meta.type === 'text') $('textInput').value = new TextDecoder().decode(data);
  else download(data, x.meta.name, x.meta.mime);
}
function concat(parts, size) { const out = new Uint8Array(size); let p=0; for(const x of parts){out.set(x,p);p+=x.length;} return out; }
function download(data, name, mime) { const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([data],{type:mime})); a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000); }
function escapeHtml(s) { return s.replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }

connectSignal();
