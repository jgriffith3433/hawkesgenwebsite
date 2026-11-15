// The `world-quality` scenario: Studio's quality rules 1 to 4 on a live world. The world's page (in a frame) runs the world
// audit (public/play/world-audit.js, the same one test/engine/world-quality.test.ts runs) through play.html's automation
// bridge and answers with what a player would see wrong. Loaded by portal.js. Read only: fine on beta and live.
//
//   options {
//     worlds: ['/play/sandbox'] (the pages to audit),
//     near: 400 (m round the camera),
//     wait: 8000 (ms for the world),
//     touch: true (phone tier at 390x844: contact shadows required),
//     strict: true (5 cm ground rule, flicker + 8-angle back-face checks — default on)
//   }
//   events  `audited` per world (what was checked), `clean` when nothing is wrong,
//           `ground-gaps`, `flicker-clean`, `backfaces-clean`, `contact-shadows` (phone)
//   problems (bug: these fail a world, rule 4 is a hard fail)
//     floating / sunk / buried   a thing's base more than 5 cm over the ground, or deep in it, or all of it under
//     backwards                  a sign whose words read mirrored from a side you can see
//     zfight / flicker           two faces in one plane, or pixels that change between two frames at a fixed spot
//     inside-out                 a closed model drawn from the inside (incl. from one of 8 camera angles)
//     contact-shadow             phone tier with no blob contact shadows under props
//     waiting / broken / gone    a thing whose model, texture or picture is missing, won't load, or the library lost
//   metrics  quality-ground, quality-gap-worst, quality-flicker-pixels, quality-backface-bad, quality-contact-shadows,
//            quality-text, quality-coplanar, quality-normals, quality-assets, quality-problems
export const WORLD_QUALITY = {
  id: 'world-quality', title: 'World quality: nothing floating or sunk, no backwards words, no faces fighting, nothing inside out, nothing missing', seconds: 120, tags: ['full'],
  description: 'Each world page in a frame (options.worlds, default /play/sandbox); its own engine runs the world audit (public/play/world-audit.js) with a 5 cm ground rule, a two-frame flicker check at 10 spots and an 8-angle back-face check. Every finding is a bug. options.touch opens the phone tier and requires contact shadows.',
};

function frameOf(url) {
  document.getElementById('pt-quality-stage')?.remove();
  const stage = document.createElement('div');
  stage.id = 'pt-quality-stage';
  stage.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:#14151c';
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0;background:#000';
  stage.append(frame);
  document.body.appendChild(stage);
  return { stage, frame, load: () => new Promise((res) => { frame.onload = res; frame.src = url; }) };
}

/** Asks the sandboxed play page (play.html's audit bridge) for the audit of the world it is running. */
function audit(frame, options) {
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => { removeEventListener('message', on); reject(new Error('the play page did not answer the audit')); }, 20000);
    const on = (e) => { if (e.source !== frame.contentWindow || !e.data || e.data.hawkesPlaytest !== 'audit-state') return; clearTimeout(to); removeEventListener('message', on); resolve(e.data.result || {}); };
    addEventListener('message', on);
    frame.contentWindow.postMessage({ hawkesPlaytest: 'audit', options }, '*');
  });
}

/** On the world's own page (the portal runs there too, under automation): the audit straight from this page's engine. */
function auditHere(options) {
  const run = () => window.HawkesWorldAudit.audit(window.HawkesPlay, options);
  if (window.HawkesWorldAudit) return Promise.resolve(run());
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/play/world-audit.js';
    s.onload = () => { try { resolve(run()); } catch (err) { reject(err); } };
    s.onerror = () => reject(new Error('the audit did not load'));
    document.head.appendChild(s);
  });
}

const RULE = { 1: 'backwards text', 2: 'z-fighting', 3: 'inside-out', 4: 'ground contact', 5: 'missing asset' };

function withTouch(url, touch) {
  if (!touch) return url;
  const u = new URL(url, location.origin);
  u.searchParams.set('touch', '1');
  return u.pathname + u.search;
}

export async function runWorldQuality(t, options = {}) {
  const touch = Boolean(options.touch);
  const here = window.HawkesPlay && window.HawkesPlay.world && !(Array.isArray(options.worlds) && options.worlds.length);
  const worlds = here ? [location.pathname + (touch && !/[?&]touch=/.test(location.search) ? (location.search ? location.search + '&touch=1' : '?touch=1') : location.search || '')]
    : Array.isArray(options.worlds) && options.worlds.length ? options.worlds : ['/play/sandbox'];
  t.event('plan', `world-quality: ${worlds.join(', ')}${touch ? ' (phone touch)' : ''}`);
  if (touch) {
    // Phone size so the phone tier and contact shadows are what a 390x844 player gets.
    try { document.documentElement.style.width = '390px'; document.body.style.width = '390px'; } catch { /* fine */ }
    t.event('phone-size', '390x844 touch');
  }
  let total = 0;
  const auditOpts = {
    near: Number(options.near) || 400,
    strict: options.strict !== false,
    flicker: options.flicker !== false,
    backfaces: options.backfaces !== false,
    contactShadows: touch || Boolean(options.contactShadows),
    settle: true,
  };
  for (let i = 0; i < worlds.length; i++) {
    const raw = String(worlds[i]);
    const url = withTouch(raw.replace(/\?.*$/, ''), touch) + (raw.includes('?') && !touch ? raw.slice(raw.indexOf('?')) : '');
    const pathOnly = url.split('?')[0];
    if (!/^\/play\/[a-z0-9/_-]+$/i.test(pathOnly)) throw new Error(`not a world page: ${url}`);
    const f = here ? null : frameOf(url);
    if (f) await f.load();
    t.scene(`World: ${pathOnly}${touch ? ' (phone)' : ''}`);
    await t.wait(Number(options.wait) || 10000);
    // Give finish.js a beat to settle props after models load.
    await t.wait(1500);
    const ask = () => (f ? audit(f.frame, auditOpts) : auditHere(auditOpts));
    let r = await ask();
    if (r.error === 'no world yet') { await t.wait(10000); r = await ask(); }
    if (r.error) throw new Error(`${url}: the audit could not run (${r.error})`);
    const c = r.counts || {};
    t.event('audited', `${url}: ${c.groundChecked ?? 0} things on the ground, ${c.textChecked ?? 0} signs, ${c.coplanarChecked ?? 0} boxes and planes, ${c.normalsChecked ?? 0} shapes, ${c.assetsChecked ?? 0} things' assets, flicker ${c.flickerPixels ?? 'n/a'} px, backfaces ${c.backfaceBad ?? 'n/a'}`);
    t.metric('quality-ground', c.groundChecked ?? 0);
    t.metric('quality-text', c.textChecked ?? 0);
    t.metric('quality-coplanar', c.coplanarChecked ?? 0);
    t.metric('quality-normals', c.normalsChecked ?? 0);
    t.metric('quality-assets', c.assetsChecked ?? 0);
    t.metric('quality-gap-worst', Math.abs(Number(c.gapWorst) || 0));
    t.metric('quality-flicker-pixels', c.flickerPixels ?? (c.flickerSkipped ? -1 : 0));
    t.metric('quality-backface-bad', c.backfaceBad ?? (c.backfaceSkipped ? -1 : 0));
    if (c.gaps) {
      const bad = c.gaps.filter((g) => !g.on && Math.abs(g.gap) > 0.05);
      t.event('ground-gaps', `${c.gaps.length} props measured, ${bad.length} over 5 cm (worst ${c.gapWorst ?? 0} m)`);
      for (const g of bad) t.problem('bug', `quality.ground-contact: ${g.id} ${(g.gap * 100).toFixed(0)} cm off the ground`);
    }
    if (c.flickerSkipped) t.event('flicker-skipped', c.flickerSkipped);
    else if ((c.flickerPixels || 0) === 0) t.event('flicker-clean', `${c.flickerSpots || 0} spots, 0 flickering pixels`);
    if (c.backfaceSkipped) t.event('backfaces-skipped', c.backfaceSkipped);
    else if ((c.backfaceBad || 0) === 0) t.event('backfaces-clean', `8 angles, ${c.backfaceChecked || 0} mesh checks, no back faces`);
    if (auditOpts.contactShadows) {
      t.metric('quality-contact-shadows', c.contactShadows ?? 0);
      if (c.contactShadows) t.event('contact-shadows', 'phone contact shadows under props');
    }
    for (const p of r.problems || []) t.problem('bug', `${url}: ${RULE[p.rule] || 'quality'}: ${p.kind} ${p.id}: ${p.detail}`);
    total += (r.problems || []).length;
    if (!(r.problems || []).length) t.event('clean', `${url}: nothing floating, sunk, backwards, fighting, flickering, inside out or missing`);
    // Eight stills around the island with the camera really moved (back-face visual check for the review).
    if (options.angles !== false) {
      const centre = [0, 5, 0], R = 22;
      for (let a = 0; a < 8; a++) {
        const ang = (a / 8) * Math.PI * 2;
        const at = [centre[0] + Math.cos(ang) * R, 9, centre[2] + Math.sin(ang) * R];
        if (f) {
          await new Promise((resolve) => {
            const to = setTimeout(() => { removeEventListener('message', on); resolve(); }, 2000);
            const on = (e) => { if (e.source !== f.frame.contentWindow || !e.data || e.data.hawkesPlaytest !== 'look-state') return; clearTimeout(to); removeEventListener('message', on); resolve(); };
            addEventListener('message', on);
            f.frame.contentWindow.postMessage({ hawkesPlaytest: 'look', at, look: centre }, '*');
          });
        } else if (window.HawkesPlay && window.HawkesPlay.world && window.HawkesPlay.world.scene.activeCamera) {
          const cam = window.HawkesPlay.world.scene.activeCamera;
          cam.position.set(at[0], at[1], at[2]);
          if (cam.setTarget) cam.setTarget(new window.BABYLON.Vector3(centre[0], centre[1], centre[2]));
          window.HawkesPlay.world.scene.render();
        }
        t.scene(`Angle ${a + 1}/8: ${pathOnly}`);
        await t.wait(250);
      }
    }
    if (f) f.stage.remove();
    t.progress((i + 1) / worlds.length);
  }
  t.metric('quality-problems', total);
  t.finish('done');
}
