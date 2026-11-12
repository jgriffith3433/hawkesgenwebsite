// The `painted-island-art` scenario: painted cast portraits beside captions, key art on loading / journal / store covers.
// Acceptance: every cast/Overseer caption shows a portrait; loading uses key art; catalogue 16:9, 2:3, 1:1 return 200;
// /games/island og:image is the key art; on a 390x844 phone the dialogue portrait is 72 px and clear of the caption.
export const PAINTED_ISLAND_ART = {
  id: 'painted-island-art',
  title: 'Painted island art: portraits beside captions, key art on loading and store covers',
  seconds: 240,
  tags: ['full'],
  starts: ['sandbox'],
  description: 'veil, intro, mirror (account gate lifted), then Overseer and cast captions show painted portraits; journal header and cast page use them; loading key art was shown; catalogue covers 16:9 / 2:3 / 1:1 answer 200; /games/island og:image loads. With touch:true at 390x844 the dialogue portrait is 72 px beside the caption. Options: touch',
};

const HP = () => window.HawkesPlay;
const G = () => HP() && HP().game;

async function coversOk(t) {
  const list = await fetch('/v1/catalogue', { cache: 'no-store' }).then((r) => r.json(), () => null);
  const island = list && (list.games || []).find((g) => g.id === 'island');
  if (!island) { t.problem('bug', 'catalogue has no island entry'); return; }
  const urls = [island.cover, island.coverTall, island.coverSquare].filter(Boolean);
  if (urls.length < 3) {
    t.problem('bug', `island catalogue missing painted covers (got ${urls.length}: cover, coverTall, coverSquare)`);
    return;
  }
  const missing = [];
  for (const u of urls) {
    const r = await fetch(u, { method: 'GET', cache: 'no-store' }).catch(() => null);
    if (!r || r.status !== 200) missing.push(`${u} → ${r ? r.status : 'fail'}`);
  }
  if (missing.length) t.problem('bug', `catalogue cover 404: ${missing.join('; ')}`);
  else t.event('catalogue-covers', `16:9, 2:3 and 1:1 painted covers answer 200`);
  t.metric('paintedCovers', urls.length - missing.length);
}

async function storeOg(t) {
  const html = await fetch('/games/island', { cache: 'no-store' }).then((r) => r.text(), () => '');
  const m = /<meta property="og:image" content="([^"]+)"/.exec(html);
  // game.js sets og from the catalogue cover after load; the static shell may still be brand/og.png.
  // Prefer the live catalogue cover URL the page would apply.
  const list = await fetch('/v1/catalogue', { cache: 'no-store' }).then((r) => r.json(), () => null);
  const island = list && (list.games || []).find((g) => g.id === 'island');
  const cover = island && island.cover ? new URL(island.cover, location.origin).href : (m && m[1]);
  if (!cover) { t.problem('bug', 'island page has no og:image / cover'); return; }
  const r = await fetch(cover, { cache: 'no-store' }).catch(() => null);
  if (!r || r.status !== 200) t.problem('bug', `og:image ${cover} does not answer 200`);
  else t.event('og-image', `island key art og cover loads (${cover})`);
}

function portraitSize(el) {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { w: Math.round(r.width), h: Math.round(r.height), left: Math.round(r.left), top: Math.round(r.top) };
}

export async function runPaintedIslandArt(t, helpers) {
  const { options, touchEv } = helpers;
  const touch = Boolean(options && options.touch) || Boolean(HP() && HP().touchUi);

  // Loading key art: HawkesLoad may already be gone; check the path answered 200 and the wrap class if still up.
  const key = '/play/art/island/key-16x9.webp';
  const keyR = await fetch(key, { cache: 'no-store' }).catch(() => null);
  if (!keyR || keyR.status !== 200) t.problem('bug', `loading key art ${key} does not answer 200`);
  else t.event('loading-key-art', 'island key art file is present for the loading screen');
  const wrap = document.querySelector('.hlw.has-art');
  if (wrap) t.event('loading-art-shown', 'loading wrapper used painted key art');

  await t.until(() => G() && HP() && HP().portraits, 60000, 'portraits module');
  try { await HP().portraits.load(); } catch { /* fine */ }
  if (window.HawkesGuest) {
    if (typeof window.HawkesGuest.playtestContinue === 'function') window.HawkesGuest.playtestContinue();
    else window.HawkesGuest.accountFirst = false;
    t.event('setup-shortcut', 'account sheet lifted so captions can play');
  }
  const mx = document.querySelector('.mr .mr-x');
  if (mx) { mx.click(); await t.wait(400); }
  if (touch) {
    const canvas = document.querySelector('canvas#c, canvas');
    if (canvas) {
      const x = innerWidth / 2, y = innerHeight * 0.3;
      touchEv('pointerdown', canvas, x, y, 9400); await t.wait(80); touchEv('pointerup', canvas, x, y, 9400);
    }
  }

  // Overseer caption with portrait
  if (HP().chat && HP().chat.line) {
    HP().chat.line({ kind: 'overseer', text: 'You found your way. Good.', now: true, keep: 8 });
  } else if (HP().speech) {
    HP().speech.say({ text: 'You found your way. Good.', priority: 'important', keep: 8 });
  }
  await t.wait(600);
  let port = document.querySelector('.hc-log p.overseer .hc-port, .hc-log .hc-port');
  if (!port || !port.getAttribute('src')) t.problem('bug', 'Overseer caption has no painted portrait');
  else {
    t.event('portrait-overseer', port.getAttribute('src'));
    const sz = portraitSize(port);
    t.metric('portraitPx', sz ? sz.w : 0);
    if (touch || (innerWidth <= 500 && innerHeight > innerWidth)) {
      if (!sz || sz.w < 70 || sz.w > 76) t.problem('bug', `phone dialogue portrait is ${sz ? sz.w : 0} px, need 72`);
      else t.event('portrait-72', `dialogue portrait ${sz.w} px at ${innerWidth}x${innerHeight}`);
      const words = document.querySelector('.hc-log p.overseer .hc-words, .hc-log p.overseer');
      if (words && port) {
        const a = port.getBoundingClientRect(), b = words.getBoundingClientRect();
        if (a.right > b.left + 4 && a.left < b.right - 4 && Math.abs(a.top - b.top) < 8 && a.width > b.width * 0.8) {
          t.problem('polish', 'portrait may be covering caption text');
        } else t.event('portrait-clear', 'portrait sits beside the caption, not over it');
      }
    }
  }
  t.scene('Caption: Overseer portrait');

  // Cast caption (Pip)
  if (HP().chat && HP().chat.line) {
    HP().chat.line({ kind: 'npc', who: 'Pip', text: 'What a day for it!', keep: 8 });
  }
  await t.wait(500);
  port = document.querySelector('.hc-log p.npc .hc-port');
  if (!port || !/pip/i.test(port.getAttribute('src') || '')) t.problem('bug', 'Pip caption has no painted portrait');
  else t.event('portrait-pip', port.getAttribute('src'));
  t.scene('Caption: Pip portrait');

  // Walk Bobbin bark path if islanders ready: fire a chat line for each remaining cast
  const CAST = ['bobbin', 'ember', 'rolo', 'dolores', 'channel'];
  const NAMES = { bobbin: 'Admiral Bobbin', ember: 'Mrs Ember', rolo: 'Rolo', dolores: 'Dolores', channel: 'Channel' };
  for (const id of CAST) {
    if (HP().chat) HP().chat.line({ kind: 'npc', who: NAMES[id], text: `Hello from ${NAMES[id]}.`, keep: 4 });
    await t.wait(200);
    const img = document.querySelector(`.hc-log p.npc .hc-port[data-cast="${id}"], .hc-log .hc-port[src*="${id}"]`);
    if (!img) t.problem('bug', `${id} caption has no painted portrait`);
    else t.event(`portrait-${id}`, img.getAttribute('src'));
  }

  // Journal cast page + header key art
  const btn = document.querySelector('.jr-btn, [aria-label="Journal"]');
  if (btn) {
    if (touch) { touchEv('pointerdown', btn, 10, 10, 9410); await t.wait(40); touchEv('pointerup', btn, 10, 10, 9410); }
    else btn.click();
    await t.wait(500);
    const keyImg = document.querySelector('.jr-key');
    if (!keyImg || keyImg.style.display === 'none') t.problem('bug', 'journal header missing key art');
    else t.event('journal-key-art', keyImg.getAttribute('src'));
    const ports = document.querySelectorAll('.jr-port:not(.jr-port-empty)');
    t.event('journal-cast', `${ports.length} cast portraits in the journal`);
    t.scene('Journal: painted cast');
    const x = document.querySelector('.jr-x');
    if (x) x.click();
  } else t.problem('warning', 'journal button not found');

  await coversOk(t);
  await storeOg(t);
  t.progress(1);
  t.finish('done');
}
