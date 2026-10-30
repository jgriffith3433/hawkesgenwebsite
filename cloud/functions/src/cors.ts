// Open-CORS routes: /.well-known/* (the platform token's public keys, read by Gen, Studio and Net from their own
// origins). An OPTIONS preflight answered 204, and the CORS headers on every answer there, a 404 included.
import { route, send, type Ctx } from './http.ts';

const CORS_ROUTES = /^\/\.well-known\/.*$/;
type CorsHandler = (c: Ctx) => unknown | Promise<unknown>;
const corsTable = new Map<string, CorsHandler>();
/** A handler on one of the CORS paths (any method; it answers non-matching methods itself). */
export function corsRoute(path: string, handler: CorsHandler) { corsTable.set(path, handler); }

function cors(res: Ctx['res']) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
  route(method, CORS_ROUTES, async (c) => {
    cors(c.res);
    if (c.method === 'OPTIONS') return void c.res.status(204).end();
    const h = corsTable.get(c.route);
    if (!h) return send(c.res, 404, { error: 'Not found' });
    return h(c);
  });
}
