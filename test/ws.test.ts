// The WebSocket server (src/ws.ts): a connection that goes silent (no frames, no answers to pings) is closed, so a
// host whose laptop slept hands the world on instead of freezing it for everyone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { accept } from '../src/ws.ts';

test('a socket that hears nothing for idleMs is closed; one that keeps talking stays', async () => {
  const closed: string[] = [];
  const server = http.createServer();
  server.on('upgrade', (req, raw) => { const s = accept(req, raw, { idleMs: 1200 }); if (s) s.onClose = () => closed.push(String(req.url)); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as net.AddressInfo).port;
  const open = (path: string) => new Promise<net.Socket>((r) => { const c = net.connect(port, '127.0.0.1', () => { c.write(`GET ${path} HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`); r(c); }); c.on('error', () => {}); });
  const quiet = await open('/quiet');
  const talky = await open('/talky');
  // A masked, empty pong frame every 300 ms from the talky one.
  const t = setInterval(() => talky.write(Buffer.from([0x8a, 0x80, 1, 2, 3, 4])), 300);
  await new Promise((r) => setTimeout(r, 2600));
  clearInterval(t);
  assert.deepEqual(closed, ['/quiet']);
  quiet.destroy(); talky.destroy();
  server.close();
});
