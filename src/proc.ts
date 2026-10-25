// Which process this is. One process does everything (`node src/server.ts`, the default and how Studio runs beta), or
// the portal runs as a cluster (PORTAL_ROLE=web): a primary that keeps N web processes (HTTP, the editor streams, the
// game rooms) on one port and exactly one worker (every background loop). The primary tells its children through the
// environment; nothing else here needs configuring.
import { envInt } from './util.ts';

/** `all` (one process), `web` (a web process, or the primary that keeps them) or `worker`. */
export const role = () => (process.env.PORTAL_ROLE === 'web' || process.env.PORTAL_ROLE === 'worker' ? process.env.PORTAL_ROLE : 'all');
/** Web processes in this portal (1 when it is one process). Limits that live in a process's memory are divided by it. */
export const procs = () => envInt((k) => process.env[k], 'PORTAL_PROCS', 1);
/** Running as a cluster child (so the others can be reached over the bus and by handing sockets over). */
export const clustered = () => process.env.PORTAL_CLUSTER === '1';
/** This web process's slot, 0..procs-1 (a restarted one keeps its slot). */
export const slot = () => Math.max(0, Math.floor(Number(process.env.PORTAL_WEB_INDEX) || 0));
/** A short name for this process, unique among the running ones (connection ids carry it). */
export const procName = () => (clustered() ? `${role() === 'worker' ? 'k' : 'w'}${slot()}` : 'p');
/** The unix socket the worker listens on and every web process connects to. */
export const busPath = (dataDir: string) => process.env.PORTAL_BUS || `${dataDir.replace(/\/+$/, '')}/bus.sock`;
/** This process has been asked to leave (a restart): it takes nothing new. */
let leaving = false;
export const isLeaving = () => leaving;
export const setLeaving = () => { leaving = true; };
