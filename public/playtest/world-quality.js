// The `world-quality` scenario: Studio's quality rules 1 to 4 on a live world. The world's page (in a frame) runs the world
// audit (public/play/world-audit.js, the same one test/engine/world-quality.test.ts runs) through play.html's automation
// bridge and answers with what a player would see wrong. Loaded by portal.js. Read only: fine on beta and live.
//
//   options { worlds: ['/play/sandbox'] (the pages to audit), near: 400 (m round the camera), wait: 8000 (ms for the world) }
//   events  `audited` per world (what was checked), `clean` when nothing is wrong
//   problems (bug: these fail a world, rule 4 is a hard fail)
//     floating / sunk / buried   a thing's base more than a hand over the ground, or deep in it, or all of it under
//     backwards                  a sign whose words read mirrored from a side you can see
//     zfight                     two faces in one plane (they flicker), or a flat plane laid exactly on the ground
//     inside-out                 a closed model drawn from the inside
//   metrics  quality-ground, quality-text, quality-coplanar, quality-normals (things checked), quality-problems
export const WORLD_QUALITY = {
  id: 'world-quality', title: 'World quality: nothing floating or sunk, no backwards words, no faces fighting, nothing inside out', seconds: 90, tags: ['full'],
  description: 'Each world page in a frame (options.worlds, default /play/sandbox); its own engine runs the world audit (public/play/world-audit.js) and every finding is a bug naming the thing and the rule. Read only.',
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
    const to = setTimeout(() => { removeEventListener('message', on); reject(new Error('the play page did not answer the audit')); }, 15000);
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

const RULE = { 1: 'backwards text', 2: 'z-fighting', 3: 'inside-out', 4: 'ground contact' };

export async function runWorldQuality(t, options = {}) {
  const here = window.HawkesPlay && window.HawkesPlay.world && !(Array.isArray(options.worlds) && options.worlds.length);
  const worlds = here ? [location.pathname] : Array.isArray(options.worlds) && options.worlds.length ? options.worlds : ['/play/sandbox'];
  t.event('plan', `world-quality: ${worlds.join(', ')}`);
  let total = 0;
  for (let i = 0; i < worlds.length; i++) {
    const url = String(worlds[i]);
    if (!/^\/play\/[a-z0-9/_-]+$/i.test(url)) throw new Error(`not a world page: ${url}`);
    const f = here ? null : frameOf(url);
    if (f) await f.load();
    t.scene(`World: ${url}`);
    await t.wait(Number(options.wait) || 8000);
    const ask = () => (f ? audit(f.frame, { near: Number(options.near) || 400 }) : auditHere({ near: Number(options.near) || 400 }));
    let r = await ask();
    if (r.error === 'no world yet') { await t.wait(10000); r = await ask(); }
    if (r.error) throw new Error(`${url}: the audit could not run (${r.error})`);
    const c = r.counts || {};
    t.event('audited', `${url}: ${c.groundChecked ?? 0} things on the ground, ${c.textChecked ?? 0} signs, ${c.coplanarChecked ?? 0} boxes and planes, ${c.normalsChecked ?? 0} shapes`);
    t.metric('quality-ground', c.groundChecked ?? 0);
    t.metric('quality-text', c.textChecked ?? 0);
    t.metric('quality-coplanar', c.coplanarChecked ?? 0);
    t.metric('quality-normals', c.normalsChecked ?? 0);
    for (const p of r.problems || []) t.problem('bug', `${url}: ${RULE[p.rule] || 'quality'}: ${p.kind} ${p.id}: ${p.detail}`);
    total += (r.problems || []).length;
    if (!(r.problems || []).length) t.event('clean', `${url}: nothing floating, sunk, backwards, fighting or inside out`);
    if (f) f.stage.remove();
    t.progress((i + 1) / worlds.length);
  }
  t.metric('quality-problems', total);
  t.finish('done');
}
