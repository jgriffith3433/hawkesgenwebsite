// /vendor/<name>@<version>/<file>: the pinned third-party libraries (tools/vendor.mjs writes them, each with a .br and a
// .gz beside it). The version is in the path, so a file never changes under its address: cached for good. Served
// precompressed (brotli, else gzip) when the browser accepts it, with Vary: Accept-Encoding. Open CORS: the play page is
// sandboxed (its origin is null), and Havok's wasm is fetched.
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ROOT } from './config.ts';

const DIR = path.join(ROOT, 'public', 'vendor');
const TYPES: Record<string, string> = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.wasm': 'application/wasm', '.md': 'text/markdown; charset=utf-8', '.map': 'application/json' };

/** The best encoding the browser accepts that we have a file for. */
function pick(accept: string, file: string): { file: string; encoding?: string } {
  const has = (e: string) => new RegExp(`(^|[\\s,])${e}\\s*(;\\s*q=(?!0(\\.0*)?\\s*(,|$)))?\\s*(,|$)`, 'i').test(accept);
  if (has('br') && fs.existsSync(`${file}.br`)) return { file: `${file}.br`, encoding: 'br' };
  if (has('gzip') && fs.existsSync(`${file}.gz`)) return { file: `${file}.gz`, encoding: 'gzip' };
  return { file };
}

/** Serves a vendored file; false when the route is not one (the caller goes on to 404). */
export function serveVendor(req: IncomingMessage, res: ServerResponse, route: string): boolean {
  if (!/^\/vendor\/[\w.@-]+\/[\w./-]+$/.test(route) || route.includes('..') || /\.(br|gz)$/.test(route)) return false;
  const file = path.join(DIR, route.slice('/vendor/'.length));
  if (!file.startsWith(DIR + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
  const body = pick(String(req.headers['accept-encoding'] ?? ''), file);
  res.writeHead(200, {
    'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream',
    'Content-Length': fs.statSync(body.file).size,
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Vary': 'Accept-Encoding',
    'Access-Control-Allow-Origin': '*',
    'X-Content-Type-Options': 'nosniff',
    ...(body.encoding ? { 'Content-Encoding': body.encoding } : {}),
  });
  if (req.method === 'HEAD') res.end();
  else pipeline(fs.createReadStream(body.file), res).catch(() => {});
  return true;
}
