// ─────────────────────────────────────────────────────────────────────────────
// relay-server.js — Minimal WebSocket relay for Mobile Mic → Dashboard PoC
//
// HOW IT WORKS:
//   1. Mobile phone opens /mobile in browser, captures mic, sends HTTP POST
//      to this relay server at ws://LAPTOP_IP:3001
//   2. This relay forwards each reading to all connected WebSocket clients
//      (the laptop dashboard browser tab)
//   3. The laptop dashboard React app connects to ws://LAPTOP_IP:3001/ws
//      and receives readings in real time
//
// HTTPS REQUIREMENT:
//   Mobile browsers require a SECURE CONTEXT (HTTPS or localhost) to access
//   the microphone. On the same LAN, plain HTTP (http://192.168.x.x:3000)
//   will BLOCK microphone access on mobile Chrome/Safari.
//
//   SOLUTION: Use the --https flag on this relay (see below), which serves
//   a self-signed cert. You must accept the browser warning once on mobile.
//
// HOW TO RUN:
//   node relay-server.js
//   (Then run: npm run dev -- --host   in a separate terminal)
//
// TO ENABLE HTTPS (required for mobile mic access):
//   node relay-server.js --https
//   Accept the self-signed certificate warning in both laptop and mobile browsers.
//
// DEPENDENCIES: (all built-in to Node.js >= 18, except ws)
//   npm install ws
// ─────────────────────────────────────────────────────────────────────────────

import { createServer as createHttpServer }  from 'http';
import { createServer as createHttpsServer } from 'https';
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { WebSocketServer } from 'ws';
import { execSync } from 'child_process';
import { networkInterfaces } from 'os';

const PORT      = 3001;
const USE_HTTPS = process.argv.includes('--https');

// ── Self-signed certificate (auto-generated if missing) ──────────────────────
function ensureSelfSignedCert() {
  if (existsSync('./cert.pem') && existsSync('./key.pem')) return;
  console.log('[relay] Generating self-signed certificate...');
  try {
    execSync(
      'openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem ' +
      '-days 365 -nodes -subj "/CN=localhost"',
      { stdio: 'ignore' }
    );
    console.log('[relay] Certificate generated: cert.pem + key.pem');
  } catch (e) {
    console.error('[relay] openssl not found. Cannot generate certificate.');
    console.error('       Install OpenSSL or provide cert.pem + key.pem manually.');
    process.exit(1);
  }
}

// ── Get local LAN IP ─────────────────────────────────────────────────────────
function getLanIp() {
  const nets = networkInterfaces();
  for (const ifaces of Object.values(nets)) {
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

// ── CORS helper ──────────────────────────────────────────────────────────────
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// ── Rate limiting (simple per-IP token bucket) ───────────────────────────────
const rateLimits = new Map();
function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateLimits.get(ip) || { count: 0, reset: now + 5000 };
  if (now > entry.reset) { entry.count = 0; entry.reset = now + 5000; }
  entry.count++;
  rateLimits.set(ip, entry);
  return entry.count > 60; // max 60 requests per 5 seconds per IP
}

// ── Connected WebSocket clients ──────────────────────────────────────────────
const wsClients = new Set();

// ── Request handler ──────────────────────────────────────────────────────────
function handleRequest(req, res) {
  const ip = req.socket.remoteAddress;

  // CORS preflight
  if (req.method === 'OPTIONS') {
    setCors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check
  if (req.method === 'GET' && req.url === '/health') {
    setCors(res);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      clients: wsClients.size,
      protocol: USE_HTTPS ? 'https' : 'http',
      ts: Date.now(),
    }));
    return;
  }

  // POST /reading — mobile phone sends readings here
  if (req.method === 'POST' && req.url === '/reading') {
    if (isRateLimited(ip)) {
      setCors(res);
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Too many requests' }));
      return;
    }

    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 4096) req.destroy(); });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);

        // Validate
        if (typeof payload.noiseLevel !== 'number' || payload.noiseLevel < 0 || payload.noiseLevel > 100) {
          setCors(res);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'noiseLevel must be a number 0-100' }));
          return;
        }

        // Enrich
        const reading = {
          noiseLevel:  Math.round(payload.noiseLevel),
          frequencyHz: Number.isFinite(payload.frequencyHz) && payload.frequencyHz >= 0 && payload.frequencyHz <= 5000
            ? Math.round(payload.frequencyHz)
            : null,
          locationId:  payload.locationId  || 'ROOM_101',
          deviceId:    payload.deviceId    || null,
          deviceName:  payload.deviceName  || 'Mobile Phone',
          status:      payload.status      || 'NORMAL',
          timestamp:   payload.timestamp   || new Date().toISOString(),
          source:      payload.source      || 'mobile',
        };

        // Broadcast to all connected dashboard tabs
        const msg = JSON.stringify({ type: 'reading', payload: reading });
        let sent = 0;
        for (const ws of wsClients) {
          try { ws.send(msg); sent++; } catch (_) {}
        }

        console.log(`[relay] Reading ${reading.noiseLevel} → ${sent} client(s) | from ${ip}`);

        setCors(res);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, delivered: sent }));
      } catch (_) {
        setCors(res);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  // 404
  res.writeHead(404);
  res.end('Not found');
}

// ── Start server ─────────────────────────────────────────────────────────────
let server;
if (USE_HTTPS) {
  ensureSelfSignedCert();
  server = createHttpsServer({
    key:  readFileSync('./key.pem'),
    cert: readFileSync('./cert.pem'),
  }, handleRequest);
} else {
  server = createHttpServer(handleRequest);
}

// ── WebSocket server ─────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  wsClients.add(ws);
  const ip = req.socket.remoteAddress;
  console.log(`[relay] Dashboard connected (${wsClients.size} total) from ${ip}`);

  // Send connection confirmation
  ws.send(JSON.stringify({ type: 'connected', clients: wsClients.size }));

  ws.on('close', () => {
    wsClients.delete(ws);
    console.log(`[relay] Dashboard disconnected (${wsClients.size} remaining)`);
  });

  ws.on('error', (e) => { wsClients.delete(ws); });
});

// ── Listen ───────────────────────────────────────────────────────────────────
server.listen(PORT, '0.0.0.0', () => {
  const lanIp   = getLanIp();
  const proto   = USE_HTTPS ? 'https' : 'http';
  const wsProto = USE_HTTPS ? 'wss'   : 'ws';

  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║   Smart Noise Monitor — Mobile Relay Server          ║');
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log(`║  Relay running on port ${PORT}                           ║`);
  console.log(`║  Protocol: ${USE_HTTPS ? 'HTTPS + WSS (secure)     ' : 'HTTP + WS  (LAN only)     '}      ║`);
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log(`║  LAPTOP opens dashboard at:                          ║`);
  console.log(`║    http://${lanIp}:3000  (Vite dev)              ║`);
  console.log(`║                                                      ║`);
  console.log(`║  MOBILE opens sender at:                             ║`);
  console.log(`║    ${proto}://${lanIp}:3000/mobile                 ║`);
  console.log(`║                                                      ║`);
  console.log(`║  WebSocket endpoint (used automatically):            ║`);
  console.log(`║    ${wsProto}://${lanIp}:${PORT}/ws                        ║`);
  console.log(`║                                                      ║`);
  if (!USE_HTTPS) {
    console.log(`║  ⚠  MICROPHONE on mobile requires HTTPS or localhost  ║`);
    console.log(`║     Run with: node relay-server.js --https            ║`);
  } else {
    console.log(`║  ✓  HTTPS mode: accept self-signed cert on mobile     ║`);
    console.log(`║     Open ${proto}://${lanIp}:${PORT}/health in mobile browser ║`);
    console.log(`║     Accept the cert warning, then open the sender URL ║`);
  }
  console.log('╚══════════════════════════════════════════════════════╝\n');
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`[relay] Port ${PORT} is already in use. Kill the process and retry.`);
  } else {
    console.error('[relay] Server error:', e.message);
  }
  process.exit(1);
});
