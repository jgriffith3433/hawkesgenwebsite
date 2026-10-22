// Email from support@hawkesgen.com through Amazon SES (API v2), signed by hand (SigV4) with the box's instance role,
// which may only send as support@. Off unless PORTAL_MAIL=ses. Sending never blocks or breaks what triggered it.
import crypto from 'node:crypto';
import { env, publicUrl } from './config.ts';

const REGION = 'us-east-1';
const FROM = 'Hawkes Gen <support@hawkesgen.com>';
type Creds = { id: string; secret: string; token?: string; expires: number };
let cached: Creds | null = null;

/** The instance role's temporary keys (IMDSv2), kept until five minutes before they expire. */
async function creds(): Promise<Creds> {
  if (cached && cached.expires - Date.now() > 300_000) return cached;
  const imds = 'http://169.254.169.254/latest';
  const token = await (await fetch(`${imds}/api/token`, { method: 'PUT', headers: { 'X-aws-ec2-metadata-token-ttl-seconds': '600' }, signal: AbortSignal.timeout(2000) })).text();
  const h = { 'X-aws-ec2-metadata-token': token };
  const role = (await (await fetch(`${imds}/meta-data/iam/security-credentials/`, { headers: h, signal: AbortSignal.timeout(2000) })).text()).trim().split('\n')[0];
  const c = await (await fetch(`${imds}/meta-data/iam/security-credentials/${role}`, { headers: h, signal: AbortSignal.timeout(2000) })).json() as any;
  return (cached = { id: c.AccessKeyId, secret: c.SecretAccessKey, token: c.Token, expires: Date.parse(c.Expiration) });
}

/** AWS Signature Version 4 headers for a JSON POST. */
export function sigv4(url: string, body: string, c: { id: string; secret: string; token?: string }, service: string, region: string, now = new Date()) {
  const u = new URL(url);
  const amz = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amz.slice(0, 8);
  const hash = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
  const hmac = (k: crypto.BinaryLike, s: string) => crypto.createHmac('sha256', k).update(s).digest();
  const headers: Record<string, string> = { 'content-type': 'application/json', host: u.host, 'x-amz-date': amz, ...(c.token ? { 'x-amz-security-token': c.token } : {}) };
  const names = Object.keys(headers).sort();
  const canonical = ['POST', u.pathname, '', names.map((n) => `${n}:${headers[n]}\n`).join(''), names.join(';'), hash(body)].join('\n');
  const scope = `${day}/${region}/${service}/aws4_request`;
  const key = hmac(hmac(hmac(hmac(`AWS4${c.secret}`, day), region), service), 'aws4_request');
  const signature = crypto.createHmac('sha256', key).update(`AWS4-HMAC-SHA256\n${amz}\n${scope}\n${hash(canonical)}`).digest('hex');
  return { ...headers, authorization: `AWS4-HMAC-SHA256 Credential=${c.id}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}` };
}

export async function sendEmail(to: string, subject: string, text: string, html: string) {
  if (env('PORTAL_MAIL') !== 'ses') return { skipped: true };
  // hawkesgen.com has no mailboxes but support@: anything else there is a test account, and would bounce (SES counts those).
  // Test signups that should get mail use success+<label>@simulator.amazonses.com (never counted).
  if (/@hawkesgen\.com$/i.test(to.trim()) && to.trim().toLowerCase() !== 'support@hawkesgen.com') return { skipped: true };
  const url = `https://email.${REGION}.amazonaws.com/v2/email/outbound-emails`;
  const body = JSON.stringify({ FromEmailAddress: FROM, ReplyToAddresses: ['support@hawkesgen.com'], Destination: { ToAddresses: [to] }, Content: { Simple: { Subject: { Data: subject, Charset: 'UTF-8' }, Body: { Text: { Data: text, Charset: 'UTF-8' }, Html: { Data: html, Charset: 'UTF-8' } } } } });
  const r = await fetch(url, { method: 'POST', headers: sigv4(url, body, await creds(), 'ses', REGION), body, signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`SES ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** The welcome email, in the site's plain voice. */
export function welcomeEmail(name: string | null, credits: number) {
  const site = publicUrl();
  const hi = name ? `Hi ${name},` : 'Hi,';
  const links: [string, string, string][] = [
    ['See what it can do', `${site}/examples`, 'real prompts, with the results, time and cost'],
    ['Make something now', `${site}/app`, 'images, sprite sheets, 3D, voice and music in the browser'],
    ['Use it from your editor', `${site}/connect`, 'Claude Code, Cursor, VS Code, Claude and more'],
  ];
  const text = `${hi}

Your Hawkes Gen account is ready, with ${credits} free credits: enough for about ${Math.floor(credits / 5)} images, or a sprite sheet.

${links.map(([t, u, d]) => `${t}: ${u}\n  (${d})`).join('\n')}

Questions, ideas or something that didn't work? Reply to this email. It comes straight to us.

Hawkes Gen
${site}`;
  const html = `<!doctype html><html><body style="margin:0;background:#f4f2ed;padding:32px 16px;font-family:'IBM Plex Sans',Helvetica,Arial,sans-serif;color:#1a1915">
<div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #d6d1c6;border-radius:3px;padding:32px">
<div style="font:400 26px Georgia,'Times New Roman',serif;margin-bottom:24px">Hawkes Gen</div>
<p style="margin:0 0 14px;font-size:15px;line-height:1.6">${esc(hi)}</p>
<p style="margin:0 0 22px;font-size:15px;line-height:1.6">Your account is ready, with <strong>${credits} free credits</strong>: enough for about ${Math.floor(credits / 5)} images, or a sprite sheet.</p>
${links.map(([t, u, d]) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.5"><a href="${u}" style="color:#1a1915;font-weight:600">${t} →</a><br><span style="color:#8b867b;font-size:13px">${d}</span></p>`).join('\n')}
<p style="margin:22px 0 0;font-size:14px;line-height:1.6;color:#4b4840">Questions, ideas or something that didn't work? Reply to this email. It comes straight to us.</p>
</div>
<p style="max-width:520px;margin:14px auto 0;font-size:12px;color:#8b867b;text-align:center">You're getting this because you made an account at hawkesgen.com.</p>
</body></html>`;
  return { subject: 'Welcome to Hawkes Gen', text, html };
}

/** Sends the welcome email in the background; a failure is logged, never shown to the person signing up. */
export function sendWelcome(email: string, name: string | null, credits: number) {
  const m = welcomeEmail(name, credits);
  void sendEmail(email, m.subject, m.text, m.html).catch((e) => console.warn(`[portal] welcome email to ${email}: ${e.message}`));
}

/** The email for an admin's gift: how many credits, what they're good for, the admin's message, the new balance. */
export function giftEmail(name: string | null, credits: number, balance: number, message: string) {
  const site = publicUrl();
  const hi = name ? `Hi ${name},` : 'Hi,';
  const n = (x: number) => x.toLocaleString('en-US');
  const worth = `enough for about ${n(Math.floor(credits / 5))} images${credits >= 50 ? ` or ${n(Math.floor(credits / 50))} sprite sheet${credits >= 100 ? 's' : ''}` : ''}`;
  const text = `${hi}

We've added ${n(credits)} credits to your Hawkes Gen account, a gift from us: ${worth}.
${message ? `
"${message}"
` : ''}
Your balance is now ${n(balance)} credits.

Use them: ${site}/app
Or from your editor: ${site}/connect

Questions? Reply to this email. It comes straight to us.

Hawkes Gen
${site}`;
  const html = `<!doctype html><html><body style="margin:0;background:#f4f2ed;padding:32px 16px;font-family:'IBM Plex Sans',Helvetica,Arial,sans-serif;color:#1a1915">
<div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #d6d1c6;border-radius:3px;padding:32px">
<div style="font:400 26px Georgia,'Times New Roman',serif;margin-bottom:24px">Hawkes Gen</div>
<p style="margin:0 0 14px;font-size:15px;line-height:1.6">${esc(hi)}</p>
<p style="margin:0 0 6px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#8b867b">A gift from us</p>
<p style="margin:0 0 6px;font:400 44px/1.05 Georgia,'Times New Roman',serif">${n(credits)} credits</p>
<p style="margin:0 0 22px;font-size:15px;line-height:1.6;color:#4b4840">${worth[0].toUpperCase() + worth.slice(1)}. Your balance is now <strong style="color:#1a1915">${n(balance)}</strong>.</p>
${message ? `<p style="margin:0 0 22px;padding:2px 0 2px 14px;border-left:2px solid #c8421d;font-size:15px;line-height:1.6">${esc(message).replace(/\n/g, '<br>')}</p>` : ''}
<p style="margin:0 0 14px"><a href="${site}/app" style="display:inline-block;background:#1a1915;color:#f4f2ed;text-decoration:none;padding:11px 18px;border-radius:3px;font-size:15px;font-weight:600">Use them now →</a></p>
<p style="margin:0 0 0;font-size:14px;line-height:1.6"><a href="${site}/connect" style="color:#1a1915">Or from Unity, Claude Code, Cursor or VS Code →</a></p>
<p style="margin:22px 0 0;font-size:14px;line-height:1.6;color:#4b4840">Questions? Reply to this email. It comes straight to us.</p>
</div>
<p style="max-width:520px;margin:14px auto 0;font-size:12px;color:#8b867b;text-align:center">You're getting this because you have an account at hawkesgen.com.</p>
</body></html>`;
  return { subject: `A gift: ${n(credits)} Hawkes Gen credits`, text, html };
}

/** Sends the gift email in the background (a failure is logged). Returns whether mail is on at all. */
export function sendGift(email: string, name: string | null, credits: number, balance: number, message: string) {
  const m = giftEmail(name, credits, balance, message);
  void sendEmail(email, m.subject, m.text, m.html).catch((e) => console.warn(`[portal] gift email to ${email}: ${e.message}`));
  return env('PORTAL_MAIL') === 'ses';
}
