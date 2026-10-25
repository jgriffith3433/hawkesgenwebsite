// The phone layout (public/play/touchlayout.js): the zones the touch controls and HUD live in never overlap, stay inside the
// safe area (notches), keep buttons at 48 px or more and leave room to read, in portrait and landscape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.ts';

const H = await load();
const TL = H.touchLayout;

const phones: Array<[string, any]> = [
  ['390x844 portrait', { w: 390, h: 844 }],
  ['844x390 landscape', { w: 844, h: 390 }],
  ['360x640 small portrait', { w: 360, h: 640 }],
  ['667x375 small landscape', { w: 667, h: 375 }],
  ['390x844 notch', { w: 390, h: 844, top: 47, bottom: 34 }],
  ['844x390 notch', { w: 844, h: 390, left: 47, right: 47, bottom: 21 }],
  ['932x430 big landscape', { w: 932, h: 430, left: 59, right: 59, bottom: 21 }],
  ['768x1024 tablet', { w: 768, h: 1024 }],
  ['390x844 building (hotbar)', { w: 390, h: 844, lift: 70 }],
  ['844x390 building (hotbar)', { w: 844, h: 390, lift: 70 }],
];

test('the layout is exposed and its constants say 48 px or more', () => {
  assert.equal(typeof TL.compute, 'function');
  assert.ok(TL.K.BTN >= 48 && TL.K.MIN === 48);
  assert.equal(typeof H.haptic, 'function');
});

for (const [name, v] of phones) {
  test(`${name}: no two zones overlap`, () => {
    const lay = TL.compute(v);
    assert.deepEqual(TL.zoneOverlaps(lay), []);
  });
  test(`${name}: every zone is inside the safe area`, () => {
    const lay = TL.compute(v), s = lay.safe;
    for (const k of ['stick', 'jump', 'action', 'ctx', 'tl', 'tr', 'mid']) {
      const z = lay[k];
      assert.ok(z.x >= s.x && z.y >= s.y && z.r <= s.r && z.b <= s.b, `${k} ${JSON.stringify(z)} sticks out of ${JSON.stringify(s)}`);
    }
  });
  test(`${name}: thumb buttons are at least 48 px and the stick is thumb-sized`, () => {
    const lay = TL.compute(v);
    for (const k of ['jump', 'action']) assert.ok(lay[k].w >= 48 && lay[k].h >= 48, k);
    assert.ok(lay.stick.w >= 96);
    // the context grid holds three rows of two buttons of that size
    assert.ok(lay.ctx.w >= 2 * 48 && lay.ctx.h >= 3 * 48);
  });
  test(`${name}: the HUD zones have room to read`, () => {
    const lay = TL.compute(v);
    assert.ok(lay.tl.w >= 212, `top left is ${lay.tl.w} wide (the HUD toggle and three buttons need 212)`);
    assert.ok(lay.tl.h >= 96 + 48, `top left is ${lay.tl.h} high`);
    assert.ok(lay.tr.w >= 100 && lay.tr.h >= 96, `top right ${lay.tr.w}x${lay.tr.h}`);
    assert.ok(lay.mid.w >= 240 && lay.mid.h >= 150, `middle ${lay.mid.w}x${lay.mid.h}`);
  });
}

test('landscape puts the chat between the left HUD and the buttons, portrait puts it above the controls', () => {
  const land = TL.compute({ w: 844, h: 390 });
  assert.ok(land.landscape && land.mid.x >= land.tl.r && land.mid.r <= land.cluster.x);
  const port = TL.compute({ w: 390, h: 844 });
  assert.ok(!port.landscape && port.mid.b <= port.cluster.y && port.mid.b <= port.stick.y);
});

test('the safe-area insets move the controls inward, the hotbar lifts them', () => {
  const a = TL.compute({ w: 844, h: 390 }), b = TL.compute({ w: 844, h: 390, left: 47, right: 47, bottom: 21 });
  assert.equal(b.stick.x - a.stick.x, 47);
  assert.equal(a.jump.r - b.jump.r, 47);
  assert.equal(a.jump.b - b.jump.b, 21);
  const c = TL.compute({ w: 390, h: 844, lift: 70 }), d = TL.compute({ w: 390, h: 844 });
  assert.equal(d.stick.y - c.stick.y, 70);
});

test('css variables are produced for every zone', () => {
  const v = TL.cssVars(TL.compute({ w: 390, h: 844 }));
  for (const k of ['stick', 'jump', 'action', 'ctx', 'tl', 'tr', 'mid']) for (const p of ['x', 'y', 'w', 'h']) assert.match(v[`--tl-${k}-${p}`], /^-?\d+px$/);
});

test('haptics: a buzz is sent where the device vibrates, and not for reduced motion or the off switch', () => {
  const g = globalThis as any;
  const sent: any[] = [];
  const nav = g.navigator, vib = nav.vibrate;
  nav.vibrate = (p: any) => { sent.push(p); return true; };
  try {
    assert.equal(H.haptic(8), true);
    assert.deepEqual(sent, [8]);
    g.localStorage = { getItem: (k: string) => (k === 'hg_haptics' ? '0' : null), setItem() {} };
    assert.equal(H.haptic(8), false);
    delete g.localStorage;
    nav.vibrate = undefined;
    assert.equal(H.haptic(8), false, 'no vibration API: false, no error');
  } finally { nav.vibrate = vib; delete g.localStorage; }
});

// ------------------------------------------------------------------ the top-left cards and the quest card (1280x720 to 390x844)
import fs from 'node:fs';
const r = (name: string, x: number, y: number, w: number, h: number) => ({ name, x, y, w, h, r: x + w, b: y + h });

test('a layout check fails when two top-left cards overlap, and passes when they are stacked', () => {
  const bad = TL.overlapPairs([r('tracker', 12, 10, 300, 90), r('quests', 12, 62, 110, 44)]);
  assert.equal(bad.length, 1);
  assert.match(bad[0], /tracker x quests/);
  const good = TL.overlapPairs([r('tracker', 12, 10, 300, 90), r('quests', 12, 106, 110, 44), r('level', 12, 156, 132, 40)]);
  assert.deepEqual(good, []);
});

test('the quest card inside the screen passes, one cut off at the bottom does not', () => {
  for (const [w, h] of [[1280, 720], [390, 844], [1440, 900]]) {
    const safe = r('safe', 0, 0, w, h);
    assert.ok(TL.insideSafe(r('footer', 20, h - 80, 200, 50), safe));
    assert.ok(!TL.insideSafe(r('footer', 20, h - 20, 200, 50), safe), 'a button 30 px past the bottom is cut off');
  }
});

test('the HUD cards flow in one column on a computer, the quest card scrolls inside with a sticky footer and stays in the safe area', () => {
  const tl = fs.readFileSync(new URL('../../public/play/touchlayout.js', import.meta.url), 'utf8');
  const qs = fs.readFileSync(new URL('../../public/play/modules/events/quests.js', import.meta.url), 'utf8');
  assert.match(tl, /#dl-stack\{position:fixed[^}]*flex-direction:column[^}]*overflow-y:auto/);
  assert.match(tl, /\.dl-in\{position:static!important/);
  for (const sel of ['.pg-hud', '.wh-hud', '.qs-btn', '.tour-stuck', '.tour-track', '.qs-track']) assert.ok(tl.includes(sel), `${sel} joins the stack`);
  const panel = qs.match(/\.qs-panel\{[^}]*\}/g)!.join('');
  assert.match(panel, /max-height:min\(calc\(100dvh - 24px - env\(safe-area-inset-top\) - env\(safe-area-inset-bottom\)\),620px\)/);
  assert.match(panel, /overflow:auto/);
  assert.match(qs, /\.qs-panel \.row\{[^}]*position:sticky;bottom:-16px/);
});
