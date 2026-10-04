import http from 'http';
import os from 'os';
import { WebSocketServer } from 'ws';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const peers = new Map();

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, peers: peers.size }));
    return;
  }
  
  let filePath = path.join(__dirname, '../client', req.url === '/' ? 'index.html' : req.url);
  const extname = path.extname(filePath);
  let contentType = 'text/html';
  switch (extname) {
    case '.js': contentType = 'text/javascript'; break;
    case '.css': contentType = 'text/css'; break;
    case '.json': contentType = 'application/json'; break;
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

const wss = new WebSocketServer({ server });

function listPeers() {
  return [...peers.values()].map(p => ({ id: p.id, name: p.name }));
}

function broadcastPeers() {
  const msg = JSON.stringify({ type: 'peers', peers: listPeers() });
  for (const p of peers.values()) if (p.ws.readyState === 1) p.ws.send(msg);
}

function send(ws, data) {
  if (ws.readyState === 1) ws.send(JSON.stringify(data));
}

wss.on('connection', ws => {
  let me = null;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return send(ws, { type: 'error', message: 'Invalid JSON' }); }

    if (msg.type === 'register') {
      const id = String(msg.id || '').slice(0, 100);
      const name = String(msg.name || 'Unknown PC').slice(0, 100);
      if (!id) return send(ws, { type: 'error', message: 'Missing device id' });

      if (peers.has(id)) {
        peers.get(id).ws.close();
        peers.delete(id);
      }
      me = { id, name, ws };
      ws.me = me;
      peers.set(id, me);
      send(ws, { type: 'registered', id, peers: listPeers() });
      broadcastPeers();
      return;
    }

    if (!me) return send(ws, { type: 'error', message: 'Register first' });

    if (msg.type === 'signal') {
      const to = peers.get(String(msg.to));
      if (!to) return send(ws, { type: 'error', message: 'Peer is offline' });
      send(to.ws, { type: 'signal', from: me.id, data: msg.data });
      return;
    }

    if (msg.type === 'refresh') broadcastPeers();
  });

  ws.on('close', () => {
    if (me && peers.get(me.id)?.ws === ws) {
      peers.delete(me.id);
      broadcastPeers();
    }
  });
});

const interval = setInterval(() => {
  wss.clients.forEach(ws => {
    if (ws.isAlive === false) {
      if (ws.me && peers.get(ws.me.id)?.ws === ws) { peers.delete(ws.me.id); broadcastPeers(); }
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 15000);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`LANDrop signaling server: http://0.0.0.0:${PORT}`);
  console.log('LAN addresses:', Object.values(os.networkInterfaces()).flat().filter(x => x?.family === 'IPv4' && !x.internal).map(x => x.address));
});
