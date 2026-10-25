import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export const id = (prefix: string, bytes = 8) => `${prefix}${crypto.randomBytes(bytes).toString('hex')}`;
export const sha256 = (s: Buffer | string) => crypto.createHash('sha256').update(s).digest('hex');

/** An error with the HTTP status it answers with. */
export class PortalError extends Error {
  status: number;
  code?: string;
  constructor(message: string, { status = 400, code }: { status?: number; code?: string } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function send(res: ServerResponse, status: number, body: unknown) {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(text);
}

export async function readBody(req: IncomingMessage, limit = 1024 * 1024): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new PortalError('Request body too large', { status: 413 });
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

export async function readJson(req: IncomingMessage): Promise<any> {
  const raw = (await readBody(req)).toString('utf8');
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new PortalError('Body is not valid JSON');
  }
}
