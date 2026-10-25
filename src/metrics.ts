// What the running portal can say about itself (GET /v1/health/details: admins, or a request from this machine).
// Cheap to keep: an event-loop histogram, a few counters, a ten-second window of request counts. Nothing here is saved,
// and no request, address or name is kept.
import fs from 'node:fs';
import path from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { DATA_DIR } from './config.ts';
import { db } from './db.ts';
import { listBackups } from './backup.ts';
import { roomStats, socketStats } from './rooms.ts';
import { liveStats } from './live.ts';
import { procName, role, procs } from './proc.ts';
import { busMode } from './bus.ts';

const loop = monitorEventLoopDelay({ resolution: 10 });
loop.enable();
let loopSince = Date.now();

let httpSockets = 0;
/** Counts the open HTTP connections of a server (the upgraded game sockets leave this count, and join `websockets`). */
export function trackServer(server: import('node:http').Server) {
  server.on('connection', (s) => { httpSockets++; s.once('close', () => { httpSockets--; }); });
}

// Requests in the last ten seconds, one counter per second.
const WINDOW = 10;
const perSecond = new Array<number>(WINDOW).fill(0);
let slot = Math.floor(Date.now() / 1000);
function advance(now = Date.now()) {
  const s = Math.floor(now / 1000);
  for (let i = slot + 1; i <= Math.min(s, slot + WINDOW); i++) perSecond[i % WINDOW] = 0;
  slot = s;
}
export function countRequest() { advance(); perSecond[slot % WINDOW]++; }
function requestsPerSecond() {
  advance();
  let n = 0;
  for (let i = 1; i < WINDOW; i++) n += perSecond[(slot - i + WINDOW * 2) % WINDOW]; // the nine whole seconds before this one
  return Math.round((n / (WINDOW - 1)) * 10) / 10;
}

// Calls to Hawkes Gen: how long they took (a ring of the last 200) and how many failed (a network error or a 5xx).
const gens: number[] = [];
let genCalls = 0, genErrors = 0;
export function genCall(ms: number, ok: boolean) {
  genCalls++;
  if (!ok) genErrors++;
  gens.push(ms);
  if (gens.length > 200) gens.shift();
}
const pct = (xs: number[], p: number) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))] : 0);
// The histogram holds each timer's whole interval (10 ms resolution plus what it was late by): the lateness is what we report.
const ms = (ns: number) => Math.max(0, Math.round((ns / 1e6 - 10) * 100) / 100);

/** The event-loop delay since the last reset (or the start), then starts a new window when `reset` is true. */
export function eventLoop(reset = false) {
  const r = { p50: ms(loop.percentile(50)), p99: ms(loop.percentile(99)), max: ms(loop.max), sinceSeconds: Math.round((Date.now() - loopSince) / 1000) };
  if (reset) { loop.reset(); loopSince = Date.now(); }
  return r;
}

function lastBackup() {
  try {
    const dir = path.join(DATA_DIR, 'backups');
    const newest = listBackups(dir).pop();
    if (!newest) return null;
    const t = fs.statSync(path.join(dir, newest)).mtimeMs;
    return { file: newest, at: new Date(t).toISOString(), ageMinutes: Math.round((Date.now() - t) / 60_000) };
  } catch { return null; }
}

function oldestUnsettled() {
  const r = db.prepare('SELECT id, tool, status, created FROM jobs WHERE settled IS NULL ORDER BY created LIMIT 1').get() as { id: string; tool: string; status: string; created: number } | undefined;
  const open = Number((db.prepare('SELECT COUNT(*) AS n FROM jobs WHERE settled IS NULL').get() as { n: number }).n);
  return { open, oldest: r ? { id: r.id, tool: r.tool, status: r.status, ageSeconds: Math.round((Date.now() - r.created) / 1000) } : null };
}

let lastCpu = process.cpuUsage(), lastCpuAt = Date.now();
function cpuPercent() {
  const now = Date.now(), u = process.cpuUsage(lastCpu);
  const wall = Math.max(1, now - lastCpuAt);
  lastCpu = process.cpuUsage(); lastCpuAt = now;
  return Math.round(((u.user + u.system) / 1000 / wall) * 1000) / 10;
}

export function details(resetLoop = false) {
  const mem = process.memoryUsage();
  const mb = (n: number) => Math.round((n / 1048576) * 10) / 10;
  const sock = socketStats(), rm = roomStats(), live = liveStats();
  return {
    ok: true,
    process: { name: procName(), role: role(), webProcesses: procs(), bus: busMode() },
    uptimeSeconds: Math.round(process.uptime()),
    eventLoopMs: eventLoop(resetLoop),
    memoryMB: { heapUsed: mb(mem.heapUsed), heapTotal: mb(mem.heapTotal), rss: mb(mem.rss) },
    cpuPercent: cpuPercent(),
    connections: { http: httpSockets, websockets: sock.sockets, websocketAddresses: sock.addresses, sseStreams: live.streams },
    rooms: { play: rm.rooms, players: rm.people },
    requestsPerSecond: requestsPerSecond(),
    gen: { calls: genCalls, errors: genErrors, recentP50Ms: pct(gens, 0.5), recentP99Ms: pct(gens, 0.99) },
    jobs: oldestUnsettled(),
    lastBackup: lastBackup(),
  };
}
