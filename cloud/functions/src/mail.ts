// Email from support@hawkesgen.com through Resend (resend.com). On only where PORTAL_MAIL=resend (live); staging sends
// nothing. Sending never blocks or breaks what triggered it: a failure is logged. The welcome, gift and low-balance
// emails are the old box's, unchanged (src/mail.ts); password resets are gone with passwords.
import { env, publicUrl, SECRETS } from './config.ts';

const FROM = 'Hawkes Gen <support@hawkesgen.com>';
export const mailOn = () => env('PORTAL_MAIL') === 'resend';

export async function sendEmail(to: string, subject: string, text: string, html: string) {
  if (!mailOn()) return { skipped: true };
  // hawkesgen.com has no mailboxes but support@: anything else there is a test account.
  if (/@hawkesgen\.com$/i.test(to.trim()) && to.trim().toLowerCase() !== 'support@hawkesgen.com') return { skipped: true };
  // The secret file may hold "RESEND_API_KEY=re_..." as it was saved; the key is what follows the name.
  const key = (SECRETS.resend.value() ?? '').trim().replace(/^[A-Za-z_ ]*[=:]\s*/, '');
  if (!key || key === 'unset') return { skipped: true };
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [to], reply_to: 'support@hawkesgen.com', subject, text, html }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${(await r.text()).slice(0, 200)}`);
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
export async function sendWelcome(email: string, name: string | null, credits: number) {
  const m = welcomeEmail(name, credits);
  await sendEmail(email, m.subject, m.text, m.html).catch((e) => console.warn(`[portal] welcome email to ${email}: ${e.message}`));
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
export async function sendGift(email: string, name: string | null, credits: number, balance: number, message: string) {
  const m = giftEmail(name, credits, balance, message);
  await sendEmail(email, m.subject, m.text, m.html).catch((e) => console.warn(`[portal] gift email to ${email}: ${e.message}`));
  return mailOn();
}

/** The low-balance email: what's left, what a pack gets them (and the first-pack bonus while they've never bought). */
export function lowBalanceEmail(name: string | null, credits: number, firstBonus: number) {
  const site = publicUrl();
  const hi = name ? `Hi ${name},` : 'Hi,';
  const bonus = firstBonus ? ` Your first pack comes with ${firstBonus}% more credits.` : '';
  const text = `${hi}

You have ${credits} credit${credits === 1 ? '' : 's'} left on Hawkes Gen.${bonus}

Top up: ${site}/credits
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
<p style="margin:0"><a href="${site}/credits" style="display:inline-block;background:#1a1915;color:#f4f2ed;text-decoration:none;padding:11px 18px;border-radius:3px;font-size:15px;font-weight:600">Top up →</a></p>
</div>
<p style="max-width:520px;margin:14px auto 0;font-size:12px;color:#8b867b;text-align:center">You get this once when your balance runs low.</p>
</body></html>`;
  return { subject: `You have ${credits} Hawkes Gen credit${credits === 1 ? '' : 's'} left`, text, html };
}

export async function sendLowBalance(email: string, name: string | null, credits: number, firstBonus: number) {
  const m = lowBalanceEmail(name, credits, firstBonus);
  await sendEmail(email, m.subject, m.text, m.html).catch((e) => console.warn(`[portal] low-balance email to ${email}: ${e.message}`));
}
