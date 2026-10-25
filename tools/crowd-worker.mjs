// The simulated players of tools/crowd.mjs, one worker thread each (a single thread cannot keep 600 sockets busy: the tool would
// measure itself). Takes orders from the parent: grow to a number of players, forget the joining, report.
import net from 'node:net';
import tls from 'node:tls';
import crypto from 'node:crypto';
import { parentPort, workerData } from 'node:worker_threads';
import { monitorEventLoopDelay } from 'node:perf_hooks';

const { base: baseHref, local, cookie, roomSize, pingEvery, shard } = workerData;
const base = new URL(baseHref);
const secure = base.protocol === 'https:';
const r1 = (n) => Math.round(n * 10) / 10;
const fakeIp = (n) => `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`; // (the portal reads X-Forwarded-For from a local peer)
const authHeaders = (i) => ({ ...(cookie ? { Cookie: cookie } : {}), ...(local ? { 'X-Forwarded-For': fakeIp(i + 1) } : {}) });
const mine = monitorEventLoopDelay({ resolution: 10 });
mine.enable();

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
function frame(text) {
  const p = Buffer.from(text), n = p.length, mask = crypto.randomBytes(4);
  const head = n < 126 ? Buffer.from([0x81, 0x80 | n]) : Buffer.from([0x81, 0x80 | 126, n >> 8, n & 255]);
  const body = Buffer.alloc(n);
  for (let i = 0; i < n; i++) body[i] = p[i] ^ mask[i & 3];
  return Buffer.concat([head, mask, body]);
}
class Player {
  constructor(i, room) { this.i = i; this.room = room; this.state = 'new'; this.rtt = []; this.rx = 0; this.tx = 0; this.pending = new Map(); this.driver = i % 8 === 0; this.t0 = 0; }
  connect() {
    return new Promise((resolve) => {
      const key = crypto.randomBytes(16).toString('base64');
      const q = `/v1/ws?play=t/arena&room=${this.room}&v=2&name=Sim${this.i}`;
      const sock = (secure ? tls.connect({ host: base.hostname, port: Number(base.port) || 443, servername: base.hostname }) : net.connect(Number(base.port) || 80, base.hostname));
      this.sock = sock;
      sock.setNoDelay?.(true);
      let buf = Buffer.alloc(0), up = false;
      const done = (s) => { if (this.state === 'new') { this.state = s; resolve(s); } };
      sock.on(secure ? 'secureConnect' : 'connect', () => {
        const h = { Host: base.host, Upgrade: 'websocket', Connection: 'Upgrade', 'Sec-WebSocket-Key': key, 'Sec-WebSocket-Version': '13', ...authHeaders(this.i) };
        sock.write(`GET ${q} HTTP/1.1\r\n${Object.entries(h).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`);
      });
      sock.on('data', (chunk) => {
        this.rx += chunk.length;
        if (process.env.CROWD_LOG && this.restarts && !up) console.log('p', this.i, 'first bytes', chunk.subarray(0, 30).toString('latin1').replace(/\r\n/g, '|'), chunk.length);
        if (process.env.CROWD_LOG && up && chunk.subarray(0, 4).toString() === 'HTTP') console.log('p', this.i, 'second HTTP after up', chunk.length);
        buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
        if (!up) {
          const end = buf.indexOf('\r\n\r\n');
          if (end < 0) return;
          const status = Number(/^HTTP\/1\.1 (\d+)/.exec(buf.toString('latin1', 0, 20))?.[1]);
          buf = buf.subarray(end + 4);
          if (status !== 101) { this.refusedStatus = status; return done('refused'); }
          up = true; this.state = 'open'; resolve('open');
          this.send({ t: 'ping', at: Date.now() });
          if (this.driver) this.send({ t: 'own', id: `car-${this.room}-${this.i}`, on: 1, lock: 1 });
        }
        while (buf.length >= 2) { // server frames are not masked
          let len = buf[1] & 127, off = 2;
          if (len === 126) { if (buf.length < 4) break; len = buf.readUInt16BE(2); off = 4; }
          else if (len === 127) { if (buf.length < 10) break; len = Number(buf.readBigUInt64BE(2)); off = 10; }
          if (buf.length < off + len) break;
          const op = buf[0] & 15;
          if (op === 1 && len < 400) { const t = buf.toString('utf8', off, off + len); if (t.includes('"pong"')) this.pong(t); }
          if (op === 8) { this.closedByServer = true; this.closeCode = len >= 2 ? buf.readUInt16BE(off) : 0; if (process.env.CROWD_LOG) console.log('close frame', buf.subarray(0, off + len).toString('hex')); }
          buf = buf.subarray(off + len);
        }
      });
      const gone = () => {
        if (sock !== this.sock || this.restarting) return;
        if (this.state === 'open' && this.closeCode === 1012) {
          this.restarting = true; this.pingAt = 0; // the server said it is restarting: come back, as a page does
          this.state = 'new'; this.restarts = (this.restarts ?? 0) + 1; this.closeCode = 0; this.closedByServer = false;
          setTimeout(() => { this.restarting = false; this.connect().then((s) => { if (s === 'open') this.state = 'open'; }); }, 200 + Math.random() * 600);
        } else if (this.state === 'open') { this.state = 'reset'; if (process.env.CROWD_LOG) console.log('reset', this.i, 'close code', this.closeCode, 'by server', this.closedByServer); } else done('reset');
      };
      sock.on('error', gone);
      sock.on('close', gone);
    });
  }
  send(o) { if (this.state !== 'open') return; const f = frame(JSON.stringify(o)); this.tx += f.length; this.sock.write(f); }
  ping() { this.pingAt = performance.now(); this.send({ t: 'ping', at: Date.now() }); }
  pong() { if (this.pingAt) { this.rtt.push(performance.now() - this.pingAt); this.pingAt = 0; } }
  close() { this.sock?.destroy(); }
}
const MASK = 0b1001111111; // x y z, rotation, vx
let step = 0;
function drive(players) { // one shared ticker (a timer per player would be the generator's own cost)
  step++;
  for (const p of players) {
    if (p.state !== 'open') continue;
    if ((step + p.i) % 2 === 0) { // 'me' every 66 ms, batched as the page does
      const t = performance.now() / 1000;
      p.send({ t: 'b', m: [{ t: 'me', at: Date.now(), s: { p: [Math.sin(t + p.i) * 30, 1, Math.cos(t + p.i) * 30], y: r1(t % 6.28), pi: 0, f: 0, h: null } }] });
    }
    if (p.driver) p.send({ t: 'b', m: [{ t: 'xf', at: Date.now(), x: [[`car-${p.room}-${p.i}`, MASK, 5 + (step % 50) * 0.1, 0.5, 3, 0, 0.1, 0, 4, 0, 0]] }] });
    if ((step + p.i) % pingEvery === 0) p.ping();
  }
}


const players = [];
setInterval(() => drive(players), 33);
parentPort.on('message', async (m) => {
  if (m.cmd === 'grow') { // players with global numbers shard, shard + S, ... up to `count` of mine
    const wave = [];
    while (players.length < m.count) {
      const batch = [];
      for (let k = 0; k < 25 && players.length + batch.length < m.count; k++) {
        const i = shard + (players.length + batch.length) * m.shards; // the player's number across all workers
        batch.push(new Player(i, `room${Math.floor(i / roomSize).toString(36)}`));
      }
      await Promise.all(batch.map((p) => p.connect()));
      players.push(...batch);
      await new Promise((r) => setTimeout(r, 40));
    }
    parentPort.postMessage({ cmd: 'grown', refused: players.filter((p) => p.state === 'refused').length, statuses: [...new Set(players.filter((p) => p.refusedStatus).map((p) => p.refusedStatus))] });
  } else if (m.cmd === 'reset') {
    for (const p of players) { p.rtt = []; p.rx = 0; p.tx = 0; }
    mine.reset();
    parentPort.postMessage({ cmd: 'reset', resets: players.filter((p) => p.state === 'reset').length });
  } else if (m.cmd === 'report') {
    const open = players.filter((p) => p.state === 'open');
    parentPort.postMessage({ cmd: 'report', rtt: players.flatMap((p) => p.rtt), open: open.length, resets: players.filter((p) => p.state === 'reset').length, refused: players.filter((p) => p.state === 'refused').length, restarts: players.reduce((n, p) => n + (p.restarts ?? 0), 0), rx: open.reduce((n, p) => n + p.rx, 0), tx: open.reduce((n, p) => n + p.tx, 0), loopP99: r1(Math.max(0, mine.percentile(99) / 1e6 - 10)) });
  } else if (m.cmd === 'stop') { for (const p of players) p.close(); process.exit(0); }
});
parentPort.postMessage({ cmd: 'ready' });
