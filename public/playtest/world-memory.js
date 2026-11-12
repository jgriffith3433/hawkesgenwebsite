// `world-memory`: Chapter One lasting marks. After the first-minutes path to the account sheet, four tour quests are
// finished (named setup-shortcut through world-marks.celebrate, the same path a tour step uses), each change is
// screenshotted at its spot, each celebration logs sparkle/sound/islander voice, then marks are cleared from the scene
// and rebuilt from Overseer memory (a reload stand-in) and still present. On touch (390x844) a welcome-back pans the
// camera across the newest mark for 3–5 s with an Overseer line and no panel.
export const WORLD_MEMORY = {
  id: 'world-memory',
  title: 'World memory: four quest marks appear with celebration, persist after reload, return pan on phone',
  seconds: 360,
  tags: ['full'],
  starts: ['sandbox'],
  description: 'first-minutes path to the account sheet, then four Chapter One world marks (drive, fish, boom, fly) via named setup-shortcut celebrate; screenshot each spot; world-change with sparkle/sound/cheer; dispose and rebuild from memory (kept-after-reload); with touch: welcome-back pan 3–5 s (world-mark-pan, no panel). Options: touch, watch',
};

const HP = () => window.HawkesPlay;
const W = () => HP() && HP().world;
const G = () => HP() && HP().game;
const M = () => window.__island && window.__island.marks;
const FOUR = ['drive', 'fish', 'boom', 'fly'];

function liftGate(t) {
  if (window.HawkesGuest && typeof window.HawkesGuest.playtestContinue === 'function') {
    window.HawkesGuest.playtestContinue();
    t.event('setup-shortcut', 'account sheet closed so the marks can run (a playtest cannot Google-sign-up)');
  } else if (window.HawkesGuest) {
    window.HawkesGuest.accountFirst = false;
    t.event('setup-shortcut', 'account gate lifted so the marks can run');
  }
  const mx = document.querySelector('.mr .mr-x');
  if (mx) mx.click();
}

/** Put the active camera near a mark so the screenshot reads from the default/phone view. */
function frameMark(step) {
  const at = M().at(step);
  if (!at) return;
  const cam = W().scene && W().scene.activeCamera;
  if (!cam) return;
  const y = (HP().terrain && HP().terrain.heightAt ? HP().terrain.heightAt(at[0], at[2]) : null);
  const gy = Number.isFinite(y) ? y : at[1] || 0;
  cam.position.set(at[0] - 4.5, gy + 2.6, at[2] - 3.8);
  if (cam.setTarget) cam.setTarget(new (HP().BABYLON || window.BABYLON).Vector3(at[0], gy + 0.8, at[2]));
}

export async function runWorldMemory(t, helpers) {
  const { options } = helpers;
  await t.until(() => W() && W().player && G() && M() && M().celebrate, 90000, 'the island and world marks');
  liftGate(t);
  await t.wait(800);

  const changes = [];
  const cheers = [];
  const pans = [];
  G().on('world-change', (d) => { changes.push(d); t.event('world-change', `${d.step}${d.first ? ' (first)' : ''}${d.cheer ? `, ${d.cheer.who}: ${d.cheer.text}` : ''}`); });
  G().on('bark', (d) => { if (d && d.ctx === 'mark') { cheers.push(d); t.event('mark-cheer', `${d.who}: ${d.text}${d.clip ? ' (clip)' : ''}`); } });
  G().on('world-mark-pan', (d) => { pans.push(d); t.event('world-mark-pan', `${d.step} ${d.ms} ms: ${d.line || ''}`); });

  // Finish four quests: the same celebrate path a tour step fires (named setup-shortcut).
  for (const step of FOUR) {
    t.event('setup-shortcut', `quest mark "${step}" through world-marks.celebrate (tour moment path)`);
    const ok = M().celebrate(step);
    if (!ok && !M().list().includes(step)) t.problem('error', `mark ${step} did not apply`);
    await t.wait(900);
    await t.until(() => M().built().includes(step), 5000, `${step} meshes built`);
    frameMark(step);
    await t.wait(350);
    t.scene(`Mark: ${step}`);
    t.event('mark-visible', `${step} at ${JSON.stringify(M().at(step))}; meshes ${M().built().filter((s) => s === step).length ? 'yes' : 'no'}`);
    t.progress(0.15 + FOUR.indexOf(step) * 0.12);
  }

  if (changes.filter((c) => c.first).length < 4) t.problem('error', `expected 4 first world-change events, got ${changes.filter((c) => c.first).length}`);
  const withCheer = changes.filter((c) => c.first && c.cheer && c.cheer.who);
  if (withCheer.length < 4) t.problem('error', `expected islander cheers on each mark, got ${withCheer.length}`);
  t.event('marks-done', `done=${M().list().join(',')}; last=${M().last()}`);

  // Reload stand-in: clear built meshes, re-read memory, rebuild quietly — must still be in place.
  const before = M().list().slice();
  t.event('setup-shortcut', 'reload: dispose mark meshes and rebuild from Overseer memory / chapterMarks');
  M().dispose();
  if (M().built().length) t.problem('error', 'dispose left built marks');
  await t.wait(200);
  M().apply(true);
  await t.wait(400);
  const after = M().list();
  t.event('kept-after-reload', `before ${before.join(',')}; after ${after.join(',')}; built ${M().built().join(',')}`);
  for (const step of FOUR) {
    if (!after.includes(step)) t.problem('error', `${step} missing from memory after reload`);
    if (!M().built().includes(step)) t.problem('error', `${step} meshes missing after reload rebuild`);
    frameMark(step);
    await t.wait(250);
    t.scene(`Mark after reload: ${step}`);
  }
  t.progress(0.75);

  // Phone return pan: 3–5 s across the newest mark, Overseer line, no panel.
  const touch = Boolean((options && options.touch) || (HP() && HP().touchUi));
  if (touch || (options && options.pan)) {
    const t0 = performance.now();
    pans.length = 0;
    G().emit('welcome-back', { name: 'Pip', mark: M().last() });
    await t.until(() => pans.length > 0, 8000, 'welcome-back pan to start');
    const pan = pans[0];
    const ms = pan.ms || 0;
    t.metric('returnPanMs', ms);
    if (ms < 3000 || ms > 5500) t.problem('error', `return pan should be 3–5 s, got ${ms} ms`);
    // No modal / sheet during the pan.
    const panel = document.querySelector('.gs-sheet, .gs-veil[data-open], .ui-menu, .fn-act');
    if (panel && panel.offsetParent !== null && getComputedStyle(panel).display !== 'none') {
      t.problem('error', 'a panel was open during the return pan');
    } else t.event('no-panel', 'return pan had no account sheet or menu over it');
    frameMark(M().last());
    await t.wait(Math.min(4200, Math.max(500, ms - (performance.now() - t0))));
    t.scene('Return pan: newest mark');
    t.event('return-pan-done', `${M().last()} in ${Math.round(performance.now() - t0)} ms`);
  } else {
    t.event('return-pan-skipped', 'desktop run; phone criterion uses touch:true / 390x844');
  }

  t.progress(1);
}
