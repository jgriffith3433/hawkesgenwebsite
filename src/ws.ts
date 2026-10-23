// A small WebSocket server (RFC 6455), enough for the game rooms: text frames, ping/pong, close, fragmented messages,
// a size limit. No runtime dependencies, like the rest of the portal. Binary frames are refused.
import crypto from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export type Socket = {
  send(text: string): void;
  close(code?: number, reason?: string): void;
  readonly open: boolean;
  onMessage: (text: string) => void;
  onClose: () => void;
  /** Bytes queued and not yet written: a slow client is dropped before it grows without end. */
  readonly buffered: number;
};

/** Answers the upgrade and returns the socket, or null (and a 400) when it isn't a WebSocket handshake. */
export function accept(req: IncomingMessage, raw: Duplex, o: { maxMessage?: number } = {}): Socket | null {
  const key = req.headers['sec-websocket-key'];
  if (String(req.headers.upgrade ?? '').toLowerCase() !== 'websocket' || typeof key !== 'string' || !key) {
    raw.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    return null;
  }
  const acceptKey = crypto.createHash('sha1').update(key + GUID).digest('base64');
  raw.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acceptKey}\r\n\r\n`);
  const max = o.maxMessage ?? 256 * 1024;
  let buf: Buffer = Buffer.alloc(0);
  let parts: Buffer[] = [];
  let partsBytes = 0;
  let open = true;
  const s: Socket = {
    onMessage: () => {},
    onClose: () => {},
    get open() { return open; },
    get buffered() { return (raw as any).writableLength ?? 0; },
    send(text: string) {
      if (!open) return;
      raw.write(frame(0x1, Buffer.from(text, 'utf8')));
    },
    close(code = 1000, reason = '') {
      if (!open) return;
      const r = Buffer.from(reason.slice(0, 100), 'utf8');
      const b = Buffer.alloc(2 + r.length);
      b.writeUInt16BE(code, 0);
      r.copy(b, 2);
      try { raw.write(frame(0x8, b)); } catch {}
      finish();
      setTimeout(() => raw.destroy(), 500).unref?.();
    },
  };
  const finish = () => {
    if (!open) return;
    open = false;
    try { s.onClose(); } catch {}
  };
  raw.on('data', (chunk: Buffer) => {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    for (;;) {
      if (buf.length < 2) return;
      const fin = (buf[0] & 0x80) !== 0;
      const op = buf[0] & 0x0f;
      const masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f;
      let at = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); at = 4; }
      else if (len === 127) { if (buf.length < 10) return; const big = buf.readBigUInt64BE(2); if (big > BigInt(max)) return s.close(1009, 'too big'); len = Number(big); at = 10; }
      if (len > max) return s.close(1009, 'too big');
      if (!masked) return s.close(1002, 'clients mask');
      if (buf.length < at + 4 + len) return;
      const mask = buf.subarray(at, at + 4);
      const data = Buffer.from(buf.subarray(at + 4, at + 4 + len));
      for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
      buf = buf.subarray(at + 4 + len);
      if (op === 0x8) { s.close(); return; }
      if (op === 0x9) { raw.write(frame(0xa, data)); continue; }
      if (op === 0xa) continue;
      if (op === 0x2) return s.close(1003, 'text only');
      if (op === 0x1 || op === 0x0) {
        parts.push(data);
        partsBytes += data.length;
        if (partsBytes > max) return s.close(1009, 'too big');
        if (fin) {
          const text = Buffer.concat(parts).toString('utf8');
          parts = [];
          partsBytes = 0;
          try { s.onMessage(text); } catch {}
        }
        continue;
      }
      return s.close(1002, 'bad frame');
    }
  });
  raw.on('close', finish);
  raw.on('end', finish);
  raw.on('error', finish);
  // Pings keep proxies from closing a quiet socket.
  const beat = setInterval(() => { if (open) try { raw.write(frame(0x9, Buffer.alloc(0))); } catch {} else clearInterval(beat); }, 25_000);
  beat.unref?.();
  return s;
}

function frame(op: number, payload: Buffer) {
  const len = payload.length;
  const head = len < 126 ? Buffer.alloc(2) : len < 65536 ? Buffer.alloc(4) : Buffer.alloc(10);
  head[0] = 0x80 | op;
  if (len < 126) head[1] = len;
  else if (len < 65536) { head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
  return Buffer.concat([head, payload]);
}
