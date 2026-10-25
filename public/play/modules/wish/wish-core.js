// The daily wish, the plain logic (no Babylon, no page): the table of 40 wishes, the pick by date (UTC), how a wish is
// completed and how the streak counts. Each day the Overseer makes one small wish of the player; everyone gets the same one
// that day. It is never required and never pushy: nothing is lost by ignoring it, and a missed day only resets the streak,
// quietly (no message, no penalty). Not money: the points are Progress's, credits never touch this.
//
//   WISHES       the table: [id, kind, n, hud, say, pts, extra?] -> { id, kind, n, hud, say, pts, needs, course, gift, under }
//   dayKey(ms)   'YYYY-MM-DD' in UTC;  dayNum(key) days since 1970-01-01;  prevDay(key)
//   wishFor(key) the wish of that day (same for everyone: a shuffle of the table seeded by the cycle, 40 days a cycle)
//   advance(wish, rec, ev)  { rec, done, changed }   a game event moves the wish on (ev: { type, ... })
//   complete(rec, key)      the record after the wish is done (streak counted)
//   streakShown(rec, key)   the streak to show now (0 when the last wish is older than yesterday: reset, quietly)
//   clean(v) / merge(a, b)  the record kept in the Overseer's memory (`wish`); src/presence.ts cleanMemory agrees
(function () {
  'use strict';

  // ------------------------------------------------------------------ the table
  // kind (what counts, and the events that move it):
  //   catch n            fish caught (any)            catch-kinds n   different species caught today
  //   boom n             things blown up              boom-seated n   blown up without leaving the vehicle (leaving starts again)
  //   meters n           driven today                 race n          races finished        race-time (under s, course?)
  //   dock | quest | lore | met | build | ask | help | space   n of them
  //   still n            seconds standing still (moving starts again)       swim n   seconds swimming today
  //   photo-planet       a photo taken with the planet whole below           photo-dawn   the same at dawn (needs a running clock)
  //   hut-friend         another player at Pip's hut with you
  // extra: { needs: 'hut' | 'clock' | 'race' (a world without it gets INSTEAD's plain wish), course, under (seconds), gift: ['acc'|'col', id, label] }
  // `say` is the Overseer's words, said once when the player arrives that day; `hud` is the short line in the corner.
  // Calm, short, no exclamation marks, no shop words. Every wish can be done on the island.
  const T = [
    ['fish-three-kinds', 'catch-kinds', 3, 'Catch three different fish', 'Three different fish, if you can. The sea likes variety.', 40, { gift: ['acc', 'bell', 'a bell'] }],
    ['fish-two-kinds', 'catch-kinds', 2, 'Catch two different fish', 'Two kinds of fish today. Not the same one twice.', 30],
    ['fish-one', 'catch', 1, 'Catch a fish', 'One fish. Take as long as it takes.', 20],
    ['fish-three', 'catch', 3, 'Catch three fish', 'Three fish. The water is patient, and so can you be.', 30],
    ['fish-five', 'catch', 5, 'Catch five fish', 'Five fish today. I would like to see how the sea answers.', 40],
    ['ridge-ninety', 'race-time', 1, 'Finish the Ridge Run in under 90 s', 'The Ridge Run, in under ninety seconds. I have not seen it done lightly.', 45, { needs: 'race', course: 'ridge', under: 90 }],
    ['ridge-hundred', 'race-time', 1, 'Finish the Ridge Run in under 100 s', 'Drive the Ridge Run in under a hundred seconds. The lights will help.', 35, { needs: 'race', course: 'ridge', under: 100 }],
    ['harbour-eighty', 'race-time', 1, 'Finish the Harbour Run in under 80 s', 'The Harbour Run, under eighty seconds. Mind the turns.', 45, { needs: 'race', course: 'harbour', under: 80 }],
    ['harbour-ninety', 'race-time', 1, 'Finish the Harbour Run in under 90 s', 'Take the boat round the harbour in under ninety seconds.', 35, { needs: 'race', course: 'harbour', under: 90 }],
    ['race-one', 'race', 1, 'Finish a race', 'Run any course to its end today. The lights are lit.', 25, { needs: 'race' }],
    ['race-two', 'race', 2, 'Finish two races', 'Two courses today, or the same one twice. Either is fine.', 40, { needs: 'race' }],
    ['boom-three', 'boom', 3, 'Blow up three things', 'Blow up three things. Make them count.', 20],
    ['boom-six', 'boom', 6, 'Blow up six things', 'Six small endings. I will watch from here.', 30],
    ['boom-ten', 'boom', 10, 'Blow up ten things', 'Ten. It is a round number, and a loud one.', 40, { gift: ['col', 'e11d48', 'crimson'] }],
    ['boom-seated-three', 'boom-seated', 3, 'Blow up 3 things without leaving the 4x4', 'Blow up three things without leaving the 4x4. Leaning out is allowed.', 45],
    ['boom-seated-five', 'boom-seated', 5, 'Blow up 5 things without leaving the 4x4', 'Five explosions, and you never put a foot on the ground.', 50, { gift: ['acc', 'headphones', 'headphones'] }],
    ['drive-three-hundred', 'meters', 300, 'Drive 300 m', 'A short drive today. Three hundred meters.', 15],
    ['drive-one-thousand', 'meters', 1000, 'Drive 1,000 m', 'Drive a kilometer. The island has more than one road in it.', 30],
    ['drive-two-thousand', 'meters', 2000, 'Drive 2,000 m', 'Two kilometers. Go the long way, whichever it is.', 40],
    ['dock', 'dock', 1, 'Come up to the ship', 'Come up to the ship today. The door is open.', 40],
    ['hut-friend', 'hut-friend', 1, 'Bring a friend to the hut', 'Bring a friend to Pip’s hut. Someone real. Pip will manage.', 50, { needs: 'hut', gift: ['acc', 'flower', 'a flower'] }],
    ['still-thirty', 'still', 30, 'Stand still for 30 seconds', 'Find a quiet place and stand in it for half a minute.', 20],
    ['still-forty-five', 'still', 45, 'Stand still for 45 seconds', 'Stand still for forty-five seconds. It is harder than it sounds.', 25],
    ['still-sixty', 'still', 60, 'Find a quiet place and stand still for a minute', 'Find a quiet place and stand still for a minute. I will not interrupt.', 35, { gift: ['acc', 'antenna', 'an antenna'] }],
    ['still-ninety', 'still', 90, 'Stand still for a minute and a half', 'Ninety seconds of nothing. I think you will like it.', 40],
    ['photo-planet', 'photo-planet', 1, 'Photograph the whole planet', 'Go up until the planet is whole, and take its picture.', 40],
    ['photo-sphere-dawn', 'photo-dawn', 1, 'Photograph the sphere at dawn', 'Photograph the sphere at dawn. The light is thin and kind then.', 50, { needs: 'clock', gift: ['col', 'fbbf24', 'amber'] }],
    ['space', 'space', 1, 'Go up until the planet is whole', 'Go up today, until you can see all of it.', 30],
    ['quest-one', 'quest', 1, 'Finish a quest', 'Finish one thing Pip or the island asked of you.', 30],
    ['quest-two', 'quest', 2, 'Finish two quests', 'Two quests today, if there are two left.', 40],
    ['lore-one', 'lore', 1, 'Find something the island is keeping', 'The island keeps things. Find one of them today.', 30],
    ['lore-two', 'lore', 2, 'Find two things the island is keeping', 'Find two of the things the island keeps. They are not hidden well.', 40, { gift: ['acc', 'medal', 'a medal'] }],
    ['met-one', 'met', 1, 'Say hello to a neighbour', 'Say hello to a neighbour. They are friendlier than they look.', 25],
    ['met-two', 'met', 2, 'Meet two neighbours', 'Two neighbours today. Introduce yourself, whoever you are today.', 35],
    ['build-one', 'build', 1, 'Make something', 'Make something today. Anything. I will find a use for it.', 25],
    ['build-three', 'build', 3, 'Make three things', 'Three things made. I am curious what.', 35],
    ['ask-one', 'ask', 1, 'Ask me for something', 'Ask me for something. Small is fine.', 20],
    ['swim-fifteen', 'swim', 15, 'Swim for 15 seconds', 'The water is warm enough. Fifteen seconds in it.', 20],
    ['swim-thirty', 'swim', 30, 'Swim for 30 seconds', 'Half a minute in the sea, with nothing in your hands.', 30, { gift: ['col', '38bdf8', 'sea blue'] }],
    ['help-one', 'help', 1, 'Help a friend', 'Help someone today. They may not ask.', 30],
  ];
  const WISHES = T.map(([id, kind, n, hud, say, pts, x]) => ({ id, kind, n, hud, say, pts, needs: (x && x.needs) || null, course: (x && x.course) || null, under: (x && x.under) || 0, gift: (x && x.gift) || null }));
  const CYCLE = WISHES.length;
  /** A world without what a wish needs (a hut, a course, a running clock) is asked for the nearest plain wish instead, so there is always one. */
  const INSTEAD = { hut: 'met-one', clock: 'photo-planet', race: 'drive-one-thousand' };
  const byId = (id) => WISHES.find((w) => w.id === id) || null;

  /** The wish to offer in a world: the day's own, or its plain stand-in when `has(need)` says the world lacks what it needs. */
  function offer(wish, has) {
    if (!wish || !wish.needs || !has || has(wish.needs, wish)) return wish;
    return byId(INSTEAD[wish.needs]) || wish;
  }

  // ------------------------------------------------------------------ days (UTC)
  const DAY = 86400000;
  const KEY = /^\d{4}-\d{2}-\d{2}$/;
  const dayKey = (ms) => new Date(Number(ms) || 0).toISOString().slice(0, 10);
  const dayNum = (key) => Math.floor(Date.parse(`${key}T00:00:00Z`) / DAY);
  const fromNum = (n) => dayKey(n * DAY);
  const prevDay = (key) => fromNum(dayNum(key) - 1);

  // ------------------------------------------------------------------ the pick: the same for everyone
  /** A small seeded generator (mulberry32). */
  function rng(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  /** The order of the table in one cycle (40 days): a shuffle seeded by the cycle, so a wish does not come twice inside a cycle. */
  function order(cycle) {
    const make = (c) => {
      const r = rng(c * 2654435761 + 12345), o = WISHES.map((_, i) => i);
      for (let i = o.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [o[i], o[j]] = [o[j], o[i]]; }
      return o;
    };
    const o = make(cycle);
    if (cycle > 0) { const last = make(cycle - 1)[CYCLE - 1]; if (o[0] === last) [o[0], o[1]] = [o[1], o[0]]; } // not the same wish two days running
    return o;
  }
  /** The wish of a day ('YYYY-MM-DD'). Pure: the same key gives the same wish on every device. */
  function wishFor(key) {
    const n = dayNum(key);
    if (!Number.isFinite(n)) return WISHES[0];
    const cycle = Math.floor(n / CYCLE), at = ((n % CYCLE) + CYCLE) % CYCLE;
    return WISHES[order(cycle)[at]];
  }

  // ------------------------------------------------------------------ the record (kept in the Overseer's memory: `wish`)
  // { last: the day of the last wish done, st: the streak that day made, best, day: the day n and set belong to,
  //   n: progress, set: ids (species) counted today, said: 1 once the wish was spoken that day }
  const blank = () => ({ last: null, st: 0, best: 0, day: null, n: 0, set: [], said: 0 });
  const int = (x, max) => { const n = Math.floor(Number(x)); return Number.isFinite(n) && n > 0 ? Math.min(n, max) : 0; };
  const date = (x) => (typeof x === 'string' && KEY.test(x) && Number.isFinite(dayNum(x)) ? x : null);
  const SET_MAX = 8;
  /** Any record, cleaned: unknown keys dropped, every value checked. Keep in step with src/presence.ts cleanMemory. */
  function clean(v) {
    const out = blank();
    if (!v || typeof v !== 'object') return out;
    out.last = date(v.last); out.day = date(v.day);
    out.st = out.last ? Math.max(1, int(v.st, 100000)) : 0;
    out.best = Math.max(out.st, int(v.best, 100000));
    out.n = int(v.n, 1e6);
    out.set = Array.isArray(v.set) ? [...new Set(v.set.filter((x) => typeof x === 'string' && /^[a-z0-9-]{1,32}$/.test(x)))].slice(0, SET_MAX) : [];
    out.said = v.said ? 1 : 0;
    return out;
  }
  /** Two records of one player (this device's and the account's): the later completed day wins its streak, the same day's progress is joined. */
  function merge(a, b) {
    const x = clean(a), y = clean(b);
    const l = (x.last || '') >= (y.last || '') ? x : y; // the streak comes from the later completed day
    const out = { last: l.last, st: l.st, best: Math.max(x.best, y.best), day: null, n: 0, set: [], said: 0 };
    const d = (x.day || '') >= (y.day || '') ? x.day : y.day; // today's progress: whoever is on the later day, joined if equal
    out.day = d;
    for (const r of [x, y]) if (r.day === d) { out.n = Math.max(out.n, r.n); out.set = [...new Set([...out.set, ...r.set])].slice(0, SET_MAX); out.said = out.said || r.said; }
    return out;
  }
  /** The record as it stands on `key`: a new day starts the progress again (the streak is not touched). */
  function forDay(rec, key) {
    const r = clean(rec);
    if (r.day !== key) { r.day = key; r.n = 0; r.set = []; r.said = 0; }
    return r;
  }
  const isDone = (rec, key) => Boolean(rec && rec.last === key);
  /** The streak to show on `key`: alive if the last wish was done today or yesterday; otherwise 0, and nothing is said about it. */
  function streakShown(rec, key) {
    const r = clean(rec);
    return r.last && (r.last === key || r.last === prevDay(key)) ? r.st : 0;
  }
  /** The record after the wish of `key` is done: the streak goes on from yesterday, or begins again at one. */
  function complete(rec, key) {
    const r = forDay(rec, key);
    if (r.last === key) return r;
    r.st = r.last === prevDay(key) ? r.st + 1 : 1;
    r.last = key;
    r.best = Math.max(r.best, r.st);
    return r;
  }
  /** Points for finishing: the wish's own, a little more for each day of the streak (never above +10). */
  const pointsFor = (wish, streak) => wish.pts + Math.min(10, Math.max(0, (streak || 1) - 1) * 2);

  // ------------------------------------------------------------------ the rules: an event moves the wish on
  // ev: { type: 'catch', species } | 'boom' | 'unseat' | 'meters' (n) | 'race' (course, ms) | 'dock' | 'quest' | 'lore' | 'met' |
  //     'build' | 'ask' | 'help' | 'space' | 'still' (s: seconds now still) | 'moved' | 'swim' (s: seconds swum) | 'photo' ({ space, hour }) |
  //     'hut-friend'.   `seated` on a 'boom' event says the player was in a vehicle.
  function advance(wish, rec, ev) {
    const r = clean(rec);
    const was = JSON.stringify(r);
    const add = (k = 1) => { r.n = Math.min(wish.n, r.n + k); };
    const t = ev && ev.type;
    switch (wish.kind) {
      case 'catch': if (t === 'catch') add(); break;
      case 'catch-kinds': if (t === 'catch' && ev.species && !r.set.includes(ev.species)) { r.set.push(String(ev.species)); r.set = r.set.slice(0, SET_MAX); r.n = Math.min(wish.n, r.set.length); } break;
      case 'boom': if (t === 'boom') add(); break;
      case 'boom-seated': if (t === 'boom' && ev.seated) add(); else if (t === 'unseat') r.n = 0; break;
      case 'meters': if (t === 'meters') add(Math.max(0, Math.floor(Number(ev.n) || 0))); break;
      case 'race': if (t === 'race') add(); break;
      case 'race-time': if (t === 'race' && (!wish.course || wish.course === ev.course) && Number(ev.ms) > 0 && Number(ev.ms) < wish.under * 1000) r.n = wish.n; break;
      case 'dock': case 'quest': case 'lore': case 'met': case 'build': case 'ask': case 'help': case 'space': if (t === wish.kind) add(); break;
      case 'still': if (t === 'still') r.n = Math.min(wish.n, Math.max(r.n, Math.floor(Number(ev.s) || 0))); else if (t === 'moved') r.n = 0; break;
      case 'swim': if (t === 'swim') r.n = Math.min(wish.n, Math.max(r.n, Math.floor(Number(ev.s) || 0))); break;
      case 'photo-planet': if (t === 'photo' && ev.space > 0.5) r.n = wish.n; break;
      case 'photo-dawn': if (t === 'photo' && ev.space > 0.5 && ev.hour !== null && ev.hour !== undefined && ev.hour >= 5 && ev.hour < 8) r.n = wish.n; break;
      case 'hut-friend': if (t === 'hut-friend') r.n = wish.n; break;
    }
    return { rec: r, done: r.n >= wish.n, changed: JSON.stringify(r) !== was };
  }
  /** The events that finish a wish (tests and the playtest's named shortcuts feed these; nothing else makes them). */
  function eventsFor(w) {
    const rep = (e) => Array.from({ length: w.n }, () => e);
    switch (w.kind) {
      case 'catch': return rep({ type: 'catch', species: 'trout' });
      case 'catch-kinds': return Array.from({ length: w.n }, (_, i) => ({ type: 'catch', species: `fish-${i}` }));
      case 'boom': return rep({ type: 'boom' });
      case 'boom-seated': return rep({ type: 'boom', seated: true });
      case 'meters': return [{ type: 'meters', n: w.n }];
      case 'race': return rep({ type: 'race', course: 'ridge', ms: 1000 });
      case 'race-time': return [{ type: 'race', course: w.course, ms: Math.max(1, w.under * 1000 - 1000) }];
      case 'still': return [{ type: 'still', s: w.n }];
      case 'swim': return [{ type: 'swim', s: w.n }];
      case 'photo-planet': return [{ type: 'photo', space: 1, hour: 14 }];
      case 'photo-dawn': return [{ type: 'photo', space: 1, hour: 6 }];
      case 'hut-friend': return [{ type: 'hut-friend' }];
      default: return rep({ type: w.kind });
    }
  }
  /** "1 / 3", for the HUD (nothing for a wish done at once). */
  const progressText = (wish, rec) => (wish.n > 1 && !['still', 'swim', 'meters'].includes(wish.kind) ? `${Math.min(rec.n, wish.n)} / ${wish.n}` : wish.kind === 'meters' ? `${Math.min(rec.n, wish.n)} / ${wish.n} m` : ['still', 'swim'].includes(wish.kind) ? `${Math.min(rec.n, wish.n)} / ${wish.n} s` : '');

  // ------------------------------------------------------------------ the Overseer's words when it is done
  // Short, in its voice, never a fanfare. The streak is mentioned only when it has some length, and only warmly.
  const DONE = ['That is the wish. Thank you.', 'Done. I did not doubt it.', 'That was what I hoped for.', 'Thank you. It was a small one.', 'Good. That is enough for today.', 'Mm. Yes. Like that.'];
  const GIFT = (g) => ` Here, ${g[2]}. It is yours.`;
  function doneLine(key, streak, gift) {
    const n = dayNum(key);
    let s = DONE[((n % DONE.length) + DONE.length) % DONE.length];
    if (streak >= 3) s += streak >= 7 ? ' A week of them, now.' : ` ${streak} days, now.`;
    if (gift) s += GIFT(gift);
    return s;
  }
  /** Problems with the data (the test runs this): 40 of them, ids unique, kinds known, voice rules kept. */
  const KINDS = ['catch', 'catch-kinds', 'boom', 'boom-seated', 'meters', 'race', 'race-time', 'dock', 'quest', 'lore', 'met', 'build', 'ask', 'help', 'space', 'still', 'swim', 'photo-planet', 'photo-dawn', 'hut-friend'];
  function check(list = WISHES) {
    const bad = [], seen = new Set();
    if (list.length !== 40) bad.push(`${list.length} wishes, not 40`);
    for (const w of list) {
      if (!/^[a-z0-9-]{1,32}$/.test(w.id)) bad.push(`${w.id}: bad id`);
      if (seen.has(w.id)) bad.push(`${w.id}: twice`);
      seen.add(w.id);
      if (!KINDS.includes(w.kind)) bad.push(`${w.id}: unknown kind`);
      if (!(w.n >= 1) || !(w.pts >= 10 && w.pts <= 60)) bad.push(`${w.id}: n or points out of range`);
      if (!w.hud || !w.say) bad.push(`${w.id}: no words`);
      if (w.hud && w.hud.length > 60) bad.push(`${w.id}: hud line too long`);
      if (/!|\bcredits?\b|\$|\bbuy\b|\bpurchase\b|\boffice\b|\bwork\b|\bmeeting\b/i.test(`${w.hud} ${w.say}`)) bad.push(`${w.id}: shouts, sells or talks about work`);
      if (w.kind === 'race-time' && !(w.under > 0)) bad.push(`${w.id}: no time`);
      if (w.needs && !byId(INSTEAD[w.needs])) bad.push(`${w.id}: no stand-in for ${w.needs}`);
      if (w.gift && !(['acc', 'col'].includes(w.gift[0]) && w.gift[1] && w.gift[2])) bad.push(`${w.id}: bad gift`);
      if (w.gift && w.gift[0] === 'col' && !/^[0-9a-f]{6}$/.test(w.gift[1])) bad.push(`${w.id}: gift color not hex`);
    }
    return bad;
  }

  const api = { WISHES, KINDS, CYCLE, INSTEAD, byId, offer, eventsFor, dayKey, dayNum, prevDay, wishFor, order, blank, clean, merge, forDay, isDone, streakShown, complete, pointsFor, advance, progressText, doneLine, check };
  if (typeof window !== 'undefined') window.HawkesWishCore = api;
  const H = typeof window !== 'undefined' ? window.HawkesPlay : null;
  if (H) H.wishCore = api;
})();
