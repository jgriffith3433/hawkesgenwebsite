// One player for the network tests (test/engine/netsim.ts): the whole engine in a worker thread, on a clock the test
// moves (performance.now and Date.now are virtual, so a run is the same every time and takes no real waiting), with
// a WebSocket that hands what it sends to the test and gets what the simulated network delivers.
import { parentPort, workerData } from 'node:worker_threads';

let vt = 1000; // ms on this player's clock
const base = Number(workerData.base) || 1_800_000_000_000;
const skew = Number(workerData.skew) || 0; // this machine's clock is this far off the server's
const perf = globalThis.performance as any;
try { Object.defineProperty(perf, 'now', { value: () => vt, configurable: true, writable: true }); } catch { perf.now = () => vt; }
Date.now = () => Math.round(base + vt + skew);

const out: string[] = [];
let sock: FakeSocket | null = null;
class FakeSocket {
  readyState = 0;
  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  constructor(url: string) { this.url = url; sock = this; parentPort!.postMessage({ t: 'connect', url }); }
  send(text: string) { if (this.readyState === 1) out.push(text); }
  close() { if (this.readyState === 3) return; this.readyState = 3; parentPort!.postMessage({ t: 'disconnect' }); }
}
(globalThis as any).WebSocket = FakeSocket;

const { load, world } = await import('./harness.ts');
const H = await load({ extra: workerData.extra || [] });
const g = globalThis as any;

parentPort!.on('message', async (m: any) => {
  try {
    if (m.t === 'tick') {
      vt = m.now;
      for (const d of m.inbox as any[]) {
        if (!sock) continue;
        if (d.open) { sock.readyState = 1; sock.onopen?.(); continue; }
        if (d.close) { sock.readyState = 3; sock.onclose?.({ code: d.code ?? 1006 }); continue; }
        sock.onmessage?.({ data: d.text });
      }
      if (m.run !== false) H.tick(m.dt);
      const sent = out.splice(0);
      parentPort!.postMessage({ t: 'ticked', id: m.id, out: sent });
    } else if (m.t === 'world') {
      world(H, m.scene, { mode: m.mode || 'play', scripts: m.scripts });
      parentPort!.postMessage({ t: 'done', id: m.id, value: true });
    } else if (m.t === 'eval') {
      // eslint-disable-next-line no-new-func
      const fn = new Function('H', 'game', 'W', 'Net', 'g', `return (async () => { ${m.code} })();`);
      const value = await fn(H, H.game, H.world, g.HawkesNet, g);
      parentPort!.postMessage({ t: 'done', id: m.id, value: value === undefined ? null : JSON.parse(JSON.stringify(value)) });
    }
  } catch (err: any) {
    parentPort!.postMessage({ t: 'done', id: m.id, error: String(err && err.stack || err) });
  }
});
parentPort!.postMessage({ t: 'ready' });
