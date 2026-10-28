// Hawkes Gen, the backend. The portal calls it with its one key (scoped in Gen to the customers' projects); `as` narrows
// that key to one customer's project for the call (X-Hawkesgen-Project), so Gen itself keeps customers apart.
import { genKey, genUrl } from './config.ts';
import { PortalError } from './http.ts';

export type GenCall = { method?: string; body?: unknown; as?: string; headers?: Record<string, string>; signal?: AbortSignal };

export function genHeaders(as?: string, extra: Record<string, string> = {}) {
  const h: Record<string, string> = { Authorization: `Bearer ${genKey()}`, 'X-Hawkes-Client': 'portal-cloud/1', ...extra };
  if (as) h['X-Hawkesgen-Project'] = as;
  return h;
}

/** A raw fetch to Gen (streams, files). */
export function genFetch(route: string, o: GenCall & { rawBody?: BodyInit; duplex?: 'half' } = {}) {
  const json = o.body !== undefined && o.rawBody === undefined;
  return fetch(`${genUrl()}${route}`, {
    method: o.method ?? (json || o.rawBody !== undefined ? 'POST' : 'GET'),
    headers: genHeaders(o.as, { ...(json ? { 'Content-Type': 'application/json' } : {}), ...(o.headers ?? {}) }),
    body: json ? JSON.stringify(o.body) : o.rawBody,
    signal: o.signal ?? AbortSignal.timeout(60_000),
    ...(o.duplex ? { duplex: o.duplex } : {}),
  } as RequestInit);
}

/** A JSON call to Gen; Gen's own error message and status come back as a PortalError. */
export async function gen<T = any>(route: string, o: GenCall = {}): Promise<T> {
  let r: Response;
  try {
    r = await genFetch(route, o);
  } catch (e: any) {
    throw new PortalError(`Hawkes Gen is not answering (${e.message})`, { status: 502 });
  }
  const data: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new PortalError(data?.error ?? `Hawkes Gen answered ${r.status}`, { status: r.status >= 500 ? 502 : r.status });
  return data as T;
}
