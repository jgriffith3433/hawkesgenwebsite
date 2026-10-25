// Progress, the plain logic (no Babylon, no page): the earning table, the level curve and the unlocks.
// A light way of saying "you have been doing things": the points are not money and not credits (credits are the paid
// currency and never touch this), and nothing here can be bought. Doing things earns; levels give things to wear, use and
// show. Adding an unlock is ONE LINE in UNLOCKS below; adding something that earns is one line in EARN.
//
//   POINTS       what the points are called (a PLACEHOLDER until J picks one of the three names in the PR)
//   EARN         id -> { label, pts, once? (first time only), per? (every `per` of a measured amount), gap? (seconds) }
//   UNLOCKS      [level, kind, id, label, line?] -> { level, kind, id, label, line, key }
//   levelAt(pts) / need(level) / bar(pts)   the level curve
//   unlocksAt(level), momentLine(u), clean(p), merge(a, b)
(function () {
  'use strict';

  // ------------------------------------------------------------------ the name (placeholder)
  // J picks one of the three suggested in the PR (Glints, Embers, Gleams); until then it is "sparks".
  const POINTS = { one: 'spark', many: 'sparks' };

  // ------------------------------------------------------------------ what earns
  // Each activity: the points, and how it counts. `once` is the first time only (a bigger welcome); a repeating one
  // may have `gap`, the seconds that must pass before the same thing earns again (so a chain of ten barrels is one
  // blast, not ten); `per` is for a measured amount (meters driven): points for each `per` of it.
  const EARN = {
    'first-drive': { label: 'first drive', pts: 20, once: true },
    'first-fish': { label: 'first fish', pts: 20, once: true },
    'first-boom': { label: 'first boom', pts: 20, once: true },
    'first-build': { label: 'first thing made', pts: 20, once: true },
    'first-dock': { label: 'first dock', pts: 40, once: true },
    'first-space': { label: 'first time above the air', pts: 40, once: true },
    'first-race': { label: 'first race', pts: 25, once: true },
    'first-ask': { label: 'first ask', pts: 15, once: true },
    'first-help': { label: 'first help', pts: 30, once: true },
    distance: { label: 'distance driven', pts: 3, per: 250 }, // meters
    fish: { label: 'a fish', pts: 5 },
    boom: { label: 'something broken', pts: 2, gap: 4 },
    quest: { label: 'a quest', pts: 30 },
    lore: { label: 'something found', pts: 15 },
    met: { label: 'a neighbour met', pts: 10 },
    race: { label: 'a race finished', pts: 10 },
    help: { label: 'a friend helped', pts: 8, gap: 20 },
  };
  /** The "first of each activity" ids that go with a repeating one (a first also earns the repeating one's points). */
  const FIRST_OF = { drive: 'first-drive', fish: 'first-fish', boom: 'first-boom', build: 'first-build', dock: 'first-dock', space: 'first-space', race: 'first-race', ask: 'first-ask', help: 'first-help' };

  // ------------------------------------------------------------------ levels
  const MAX_LEVEL = 20;
  const STEP = 40; // points for level 2; each level asks STEP more than the one before
  /** Points needed to REACH `level` (level 1 is where everyone starts): 0, 40, 120, 240, 400... */
  const need = (level) => { const l = Math.max(1, Math.min(MAX_LEVEL, Math.floor(Number(level) || 1))); return (STEP * (l - 1) * l) / 2; };
  /** The level these points make. */
  function levelAt(pts) {
    const p = Math.max(0, Number(pts) || 0);
    let l = 1;
    while (l < MAX_LEVEL && p >= need(l + 1)) l++;
    return l;
  }
  /** The bar: { level, into, span, frac, next, max } for the HUD. */
  function bar(pts) {
    const p = Math.max(0, Math.floor(Number(pts) || 0));
    const level = levelAt(p);
    const max = level >= MAX_LEVEL;
    const lo = need(level), hi = need(level + 1);
    return { level, pts: p, into: p - lo, span: max ? 0 : hi - lo, frac: max ? 1 : (p - lo) / (hi - lo), next: max ? null : hi, max };
  }

  // ------------------------------------------------------------------ the unlocks: one line each
  // [level, kind, id, label, line?]   kinds (all three are applied today):
  //   acc    an accessory for the wardrobe (id in presence-core.js ACCESSORIES)
  //   col    a color for the wardrobe (id: hex without #)
  //   tool   a tool for the belt (id in H.tools: mayhem-tools.js)
  // Still to come (stored and announced by the same line when someone builds the part that shows them): `emote` (an emote
  // style), `paint` (vehicle paint, hex), `tag` (a name-tag style). They are not in KINDS yet, so no line can promise
  // something the game does not show; add the kind to KINDS in the same change that makes it appear.
  // `line` is what the Overseer says; without one the kind's own line is used (LINES below). No prices: nothing here is sold.
  const U = [
    [2, 'acc', 'goggles', 'goggles'],
    [2, 'col', '84cc16', 'lime'],
    [3, 'acc', 'monocle', 'a monocle'],
    [4, 'tool', 'grenade', 'grenades'],
    [4, 'col', 'a855f7', 'violet'],
    [5, 'acc', 'mustache', 'a mustache'],
    [6, 'tool', 'gravity-gun', 'the gravity gun'],
    [6, 'col', 'f472b6', 'rose'],
    [7, 'acc', 'eyepatch', 'an eye patch'],
    [8, 'tool', 'lasso', 'the lasso'],
    [9, 'acc', 'earrings', 'earrings'],
    [9, 'col', 'f97316', 'ember orange'],
    [10, 'tool', 'flamethrower', 'the flamethrower', 'Fire is also a way of saying hello. Here.'],
    [12, 'acc', 'jetpack', 'a jetpack', 'You will want to go up. This helps.'],
    [14, 'col', 'ffffff', 'pearl'],
  ];
  const KINDS = ['acc', 'col', 'tool'];
  /** What the Overseer says when an unlock comes, by kind, when the line has no words of its own. Calm, no exclamation marks. */
  const LINES = {
    acc: (l) => `A new one, from me: ${l}.`,
    col: (l) => `I found a color you do not have. ${cap(l)}.`,
    tool: (l) => `Take ${l}. Be kind to the scenery, or not.`,
  };
  const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);
  const UNLOCKS = U.map(([level, kind, id, label, line]) => ({ level, kind, id, label, line: line || null, key: `${kind}:${id}` }));
  const unlocksAt = (level) => UNLOCKS.filter((u) => u.level === level);
  const unlockedBy = (level, list = UNLOCKS) => list.filter((u) => u.level <= level);
  const momentLine = (u) => u.line || (LINES[u.kind] ? LINES[u.kind](u.label) : '');
  /** The sentence for a level-up: what came with the level, said once, short. */
  function levelLine(level, ups) {
    if (!ups.length) return `Level ${level}. Further than before.`;
    if (ups.length === 1) return momentLine(ups[0]);
    return `${momentLine(ups[0])} And ${ups.slice(1).map((u) => u.label).join(' and ')}.`;
  }
  /** Problems with the data (the test runs this): every line well formed, ids unique, levels in range, hex colors real. */
  function check(list = UNLOCKS, o = {}) {
    const bad = [];
    const seen = new Set();
    for (const u of list) {
      if (!KINDS.includes(u.kind)) bad.push(`${u.key}: unknown kind`);
      if (!(u.level >= 2 && u.level <= MAX_LEVEL)) bad.push(`${u.key}: level ${u.level} out of range`);
      if (!/^[a-z0-9-]{1,32}$/.test(u.id)) bad.push(`${u.key}: bad id`);
      if (!u.label) bad.push(`${u.key}: no label`);
      if ((u.kind === 'col' || u.kind === 'paint') && !/^[0-9a-f]{6}$/.test(u.id)) bad.push(`${u.key}: not a hex color`);
      if (seen.has(u.key)) bad.push(`${u.key}: twice`);
      seen.add(u.key);
      if (/[!]|\bcredits?\b|\$|\bbuy\b|\bpurchase\b/i.test(momentLine(u))) bad.push(`${u.key}: the line talks like a shop or shouts`);
      if (o.acc && u.kind === 'acc' && !o.acc.includes(u.id)) bad.push(`${u.key}: no such accessory`);
    }
    return bad;
  }

  // ------------------------------------------------------------------ the record (kept inside the Overseer's memory: `prog`)
  // { p: points, f: [firsts done], d: meters driven, s: the highest level whose moment was shown }
  const FIRSTS = Object.keys(EARN).filter((k) => EARN[k].once);
  const blank = () => ({ p: 0, f: [], d: 0, s: 1 });
  const int = (x, max) => { const n = Math.floor(Number(x)); return Number.isFinite(n) && n > 0 ? Math.min(n, max) : 0; };
  /** Any record, cleaned: unknown keys dropped, every value checked. Keep in step with src/presence.ts cleanMemory. */
  function clean(v) {
    const out = blank();
    if (!v || typeof v !== 'object') return out;
    out.p = int(v.p, 1e7);
    out.f = Array.isArray(v.f) ? [...new Set(v.f.filter((x) => FIRSTS.includes(x)))] : [];
    out.d = int(v.d, 1e9);
    out.s = Math.max(1, Math.min(MAX_LEVEL, int(v.s, MAX_LEVEL) || 1));
    return out;
  }
  /** Two records of one player (this device's and the account's): the further one wins, firsts are joined. */
  function merge(a, b) {
    const x = clean(a), y = clean(b);
    return { p: Math.max(x.p, y.p), f: [...new Set([...x.f, ...y.f])], d: Math.max(x.d, y.d), s: Math.max(x.s, y.s) };
  }

  const api = { POINTS, EARN, FIRST_OF, FIRSTS, MAX_LEVEL, STEP, KINDS, UNLOCKS, LINES, need, levelAt, bar, unlocksAt, unlockedBy, momentLine, levelLine, check, blank, clean, merge };
  if (typeof window !== 'undefined') window.HawkesProgressCore = api;
  const H = typeof window !== 'undefined' ? window.HawkesPlay : null;
  if (H) H.progressCore = api;
})();
