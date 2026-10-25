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

/** The welcome email, in the Overseer's voice (docs/story.md: calm, vast, a little amused, generous, never commanding;
 *  it does not talk about credits itself, so those are one plain line apart). `name` is the character's name from the
 *  mirror when they came through the island, otherwise null. */
export function welcomeEmail(name: string | null, credits: number) {
  const site = publicUrl();
  const hi = name ? `Hello, ${name}.` : 'Hello.';
  const images = Math.floor(credits / 5);
  const who = name
    ? `You came down the light as ${name}, and I have kept the name. It suits the island.`
    : 'You came down the light, and the island noticed.';
  const island = name
    ? { text: `Your island is kept with your games. Open it from there, press Play, and the sea will be where you left it.`, label: 'Back to your island', url: `${site}/app` }
    : { text: `The island is open whenever you wish to see it.`, label: 'Come and see the island', url: `${site}/play/sandbox` };
  const makes = 'Ask, and I will send it down: an image, a sprite sheet, a model you can walk around, a voice, a sound, a little music. In the island, say it in the chat ("a castle on the hill") and watch the light carry it in.';
  const plain = `In plain words: your account has ${credits} free credits, enough for about ${images} images or a sprite sheet. What I make uses them. If they run out, the chat will say so and offer more; nothing is taken without your asking.`;
  const ask = 'If something did not come down as it should, or you have an idea, write to support@hawkesgen.com. Replying to this email reaches the same place.';
  const text = `${hi}

${who}

${island.text}
${island.label}: ${island.url}

${makes}

${plain}

${ask}

Hawkes Gen
${site}

You're getting this because you made an account at hawkesgen.com.`;
  const p = (t: string, extra = '') => `<p style="margin:0 0 16px;font-size:15px;line-height:1.65${extra}">${t}</p>`;
  const html = `<!doctype html><html><body style="margin:0;background:#f4f2ed;padding:32px 16px;font-family:'IBM Plex Sans',Helvetica,Arial,sans-serif;color:#1a1915">
<div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #d6d1c6;border-radius:3px;padding:32px">
<div style="font:400 26px Georgia,'Times New Roman',serif;margin-bottom:24px">Hawkes Gen</div>
${p(esc(hi))}
${p(esc(who))}
${p(esc(island.text))}
<p style="margin:0 0 22px"><a href="${island.url}" style="display:inline-block;background:#1a1915;color:#f4f2ed;text-decoration:none;padding:11px 18px;border-radius:3px;font-size:15px;font-weight:600">${island.label} →</a></p>
${p(esc(makes))}
${p(esc(plain), ';color:#4b4840;font-size:14px')}
${p('If something did not come down as it should, or you have an idea, write to <a href="mailto:support@hawkesgen.com" style="color:#1a1915">support@hawkesgen.com</a>. Replying to this email reaches the same place.', ';color:#4b4840;font-size:14px')}
</div>
<p style="max-width:520px;margin:14px auto 0;font-size:12px;color:#8b867b;text-align:center">You're getting this because you made an account at hawkesgen.com.</p>
</body></html>`;
  return { subject: name ? `${name}, your island is waiting` : 'Welcome to Hawkes Gen', text, html };
}

/** Sends the welcome email in the background; a failure is logged, never shown to the person signing up. */
export function sendWelcome(email: string, name: string | null, credits: number) {
  const m = welcomeEmail(name, credits);
  void sendEmail(email, m.subject, m.text, m.html).catch((e) => console.warn(`[portal] welcome email to ${email}: ${e.message}`));
}

/** "Forgot your password?": the one-time link to set a new one. */
export function resetEmail(name: string | null, url: string) {
  const hi = name ? `Hi ${name},` : 'Hi,';
  const text = `${hi}\n\nSomeone (hopefully you) asked to reset the password for your Hawkes Gen account. Set a new one here (the link works once, for 24 hours):\n\n${url}\n\nIf it wasn't you, ignore this email: your password stays as it is.\n\nHawkes Gen`;
  const html = `<p>${esc(hi)}</p><p>Someone (hopefully you) asked to reset the password for your Hawkes Gen account. Set a new one here (the link works once, for 24 hours):</p><p><a href="${esc(url)}">Set a new password</a></p><p>If it wasn't you, ignore this email: your password stays as it is.</p><p>Hawkes Gen</p>`;
  return { subject: 'Reset your Hawkes Gen password', text, html };
}
/** Sends it; false when this server sends no email (beta, local). */
export function mailOn() { return env('PORTAL_MAIL') === 'ses'; }
export function sendReset(email: string, name: string | null, url: string) {
  const m = resetEmail(name, url);
  void sendEmail(email, m.subject, m.text, m.html).catch((e) => console.warn(`[portal] reset email to ${email}: ${e.message}`));
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

/** The low-balance email: what's left, what a pack gets them (and the first-pack bonus while they've never bought). */
export function lowBalanceEmail(name: string | null, credits: number, firstBonus: number) {
  const site = publicUrl();
  const hi = name ? `Hi ${name},` : 'Hi,';
  const bonus = firstBonus ? ` Your first pack comes with ${firstBonus}% more credits.` : '';
  const text = `${hi}

You have ${credits} credit${credits === 1 ? '' : 's'} left on Hawkes Gen.${bonus}

Top up: ${site}/app#credits
Packs start at $10 for 1,000 credits: about 200 images, or 20 sprite sheets.

Hawkes Gen
${site}

You get this once when your balance runs low.`;
  const html = `<!doctype html><html><body style="margin:0;background:#f4f2ed;padding:32px 16px;font-family:'IBM Plex Sans',Helvetica,Arial,sans-serif;color:#1a1915">
<div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #d6d1c6;border-radius:3px;padding:32px">
<div style="font:400 26px Georgia,'Times New Roman',serif;margin-bottom:24px">Hawkes Gen</div>
<p style="margin:0 0 14px;font-size:15px;line-height:1.6">${esc(hi)}</p>
<p style="margin:0 0 6px;font:400 40px/1.1 Georgia,'Times New Roman',serif">${credits} credit${credits === 1 ? '' : 's'} left</p>
<p style="margin:0 0 22px;font-size:15px;line-height:1.6;color:#4b4840">Packs start at $10 for 1,000 credits: about 200 images, or 20 sprite sheets.${firstBonus ? ` <strong style="color:#c8421d">Your first pack comes with ${firstBonus}% more.</strong>` : ''}</p>
<p style="margin:0"><a href="${site}/app#credits" style="display:inline-block;background:#1a1915;color:#f4f2ed;text-decoration:none;padding:11px 18px;border-radius:3px;font-size:15px;font-weight:600">Top up →</a></p>
</div>
<p style="max-width:520px;margin:14px auto 0;font-size:12px;color:#8b867b;text-align:center">You get this once when your balance runs low.</p>
</body></html>`;
  return { subject: `You have ${credits} Hawkes Gen credit${credits === 1 ? '' : 's'} left`, text, html };
}

export function sendLowBalance(email: string, name: string | null, credits: number, firstBonus: number) {
  const m = lowBalanceEmail(name, credits, firstBonus);
  void sendEmail(email, m.subject, m.text, m.html).catch((e) => console.warn(`[portal] low-balance email to ${email}: ${e.message}`));
}
