// Events: one generic rule system, "when -> if -> do", in plain JSON the assistant writes from words.
//
//   config.events (scene.json)  { vars, clock, hud, rules: [{ id, when, if, do, else, once, cooldown, max }] }
//   game.events.add(rule)       the same rules from a script
//
// A rule's `when` is one trigger or a list (any of them): the start, a timer, a time of day, a player entering or leaving
// a zone, touching / clicking / using (E) a thing, a key, a variable crossing a value, a thing destroyed, the weather, a
// creature's state, a count of things, or ANY event by name (`game.emit` from the engine, every module and scripts:
// explosion, catch, enter, death, kill, pickup, finish, quest...). `if` is conditions (variables, chance, who, items,
// zones, quests, time windows). `do` is a list of actions (make, change, hit, say, world, player, game flow), with wait,
// repeat, if/else and random branches; disasters (disasters.js) and quests (quests.js) are more actions on the same bus.
//
// Playing together: the host decides. Triggers that belong to one player (their zone, their click, their catch) are seen
// on that player's machine and sent to the host; the host checks the conditions, keeps the variables (synced to everyone)
// and runs the actions: world changes the host makes once (spawning, explosions, damage, digging), effects everyone sees
// (messages, sounds, weather, sky, disasters) go to every player, and player things (a tool, a message "to": "player",
// a teleport) go to that player only. Rules only run while playing (not while building).
//
// docs/world/75-events.md and docs/api/75-events.md (in this folder) are what the assistant reads.
/* global HawkesPlay, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = BABYLON;
  const W = () => H.world;
  const G = () => H.game;
  const E = (H.events = H.events || {});
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const num = (v, d) => (v !== null && v !== '' && v !== undefined && Number.isFinite(Number(v)) ? Number(v) : d);
  const lower = (s) => String(s ?? '').trim().toLowerCase();
  const arr = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
  const r2 = (v) => Math.round(Number(v) * 100) / 100;
  const isEntity = (v) => Boolean(v && v.__entity);
  const SINGULAR = { sheep: 'sheep', fish: 'fish', mice: 'mouse', geese: 'goose', wolves: 'wolf', people: 'person', zombies: 'zombie', ponies: 'pony', puppies: 'puppy', bunnies: 'bunny', boxes: 'box' };
  const single = (w) => SINGULAR[w] || (w.endsWith('ies') && w.length > 4 ? `${w.slice(0, -3)}y` : /(ss|x|ch|sh)es$/.test(w) ? w.slice(0, -2) : w.endsWith('s') && !w.endsWith('ss') && w.length > 3 ? w.slice(0, -1) : w);
  const report = (err, where = 'events') => { try { H.report(err instanceof Error ? err : new Error(String(err)), where); } catch { /* the page has no error box */ } };
  const log = (text) => { try { const g = G(); if (g && g.log) g.log(`[events] ${text}`); } catch { /* ignore */ } };

  // ------------------------------------------------------------------ playing together (with a test seam: E._net)
  const net = {
    get online() { return E._net ? Boolean(E._net.online) : Boolean(H.sync && H.sync.online); },
    get host() { return E._net ? !E._net.online || Boolean(E._net.host) : !(H.sync && H.sync.online) || Boolean(H.sync.isHost); },
    get me() { return E._net ? E._net.me || 'me' : H.sync && H.sync.online ? H.sync.me : 'me'; },
  };
  const myName = () => (E._net && E._net.name) || H.hooks.myName || 'You';
  const meWho = () => ({ id: net.me, name: myName() });
  const syncRuns = new Map();
  /** A host-decided action (H.sync.action), with a seam the tests use to play host and guest in one process. */
  function syncAction(name, run) {
    syncRuns.set(name, run);
    const real = H.sync && H.sync.action ? H.sync.action(name, run) : (d) => run(d, { authoritative: true, from: null });
    return (d) => {
      const t = E._net;
      if (!t) return real(d);
      if (!t.online || t.host) { run(d, { authoritative: true, from: null }); if (t.online && t.out) t.out.push({ name, d, host: true }); }
      else { run(d, { authoritative: false, from: null }); if (t.out) t.out.push({ name, d, host: false }); }
      return undefined;
    };
  }
  /** Tests: hands a message sent through syncAction to this machine as if it came over the network. */
  E._deliver = (name, d, o = {}) => { const run = syncRuns.get(name); if (run) run(clone(d), { authoritative: Boolean(o.authoritative), from: o.from || null }); };

  // ------------------------------------------------------------------ per world
  let S = null;
  function fresh(g, w) {
    return {
      g, w, rules: [], byId: new Map(), vars: {}, pvars: {}, inv: {}, names: {}, decl: {}, hud: [], timers: [], boards: [],
      clock: null, dark: { v: 0, to: 0, rate: 0.6, until: null }, base: null, lit: false, seqs: [], tweens: [], zones: new Map(),
      inThings: new Map(), seen: new Map(), touching: new Map(), listened: new Set(), disasters: [], started: false, leaving: false,
      uid: 0, history: [], weather: null, cache: new Map(), cacheAt: -1, nextLocal: 0, nextHost: 0, nextRescan: 0, ui: {},
      useCands: [], useAt: -1, actionsThisStep: 0, clicked: new WeakMap(),
    };
  }
  const live = () => (S && S.w === W() && !S.leaving ? S : null);
  const playing = () => H.mode === 'play';
  const active = () => Boolean(live() && S.started && playing());
  const now = () => (W() ? W().time : 0);

  // ------------------------------------------------------------------ registries (open: scripts and modules add more)
  const TRIGGERS = ['start', 'after', 'every', 'time', 'enter', 'leave', 'touch', 'click', 'use', 'key', 'var', 'count', 'destroyed', 'weather', 'creature', 'quest', 'event', 'on'];
  const ACTIONS = new Map(); // name -> { scope: 'host' | 'all' | 'player' | fn(a, ctx), run(a, ctx), text: [fields to fill], at: [position fields] }
  const CONDS = new Map(); // name -> fn(c, ctx) -> boolean
  const ORDER = []; // action names in the order they are recognized (the first key of an action that names one wins)
  function defineAction(name, def) {
    const n = String(name);
    if (!def || typeof def.run !== 'function') throw new Error(`events: action "${n}" needs run(a, ctx)`);
    ACTIONS.set(n, { scope: 'all', text: [], at: [], ...def });
    if (!ORDER.includes(n)) ORDER.push(n);
  }
  function defineCondition(name, fn) { if (typeof fn !== 'function') throw new Error(`events: condition "${name}" needs a function`); CONDS.set(String(name), fn); }
  E.defineAction = defineAction;
  E.defineCondition = defineCondition;
  E.actions = () => [...ORDER];
  E.conditions = () => [...CONDS.keys()];
  E.triggers = () => TRIGGERS.slice();

  // ------------------------------------------------------------------ things, players, places
  const TIMES = { midnight: 0, dawn: 6, sunrise: 6, morning: 8, day: 8, noon: 12, midday: 12, afternoon: 15, dusk: 19, sunset: 19, evening: 19, night: 21 };
  /** The words a thing answers to: its id, name, tag, kind, species, data.tag. */
  function wordsOf(e) {
    if (!e) return [];
    const d = e.data || {};
    const ws = [e.sceneId, e.id, e.name, e.tag, e.kind, d.tag, d.species || e.species, d.critter, d.vehicle, d.standIn, e.living && e.living.name, d.fish, e.rarity];
    if (Array.isArray(d.tags)) ws.push(...d.tags);
    return ws.filter((w) => w !== undefined && w !== null && w !== '').map(lower);
  }
  /** Does a thing (an entity, or a thing as an event carried it) answer to this word (or any of a list)? */
  function matches(e, ref) {
    if (!e) return false;
    if (ref === undefined || ref === null || ref === true || ref === '*' || lower(ref) === 'any' || lower(ref) === 'anything') return true;
    if (Array.isArray(ref)) return ref.some((r) => matches(e, r));
    if (typeof ref === 'object') return Object.entries(ref).every(([k, v]) => lower(getPath(e, k)) === lower(v));
    const r = lower(ref);
    if (r === 'player' || r === 'players' || r === 'me') return Boolean(e.isPlayer || e.player);
    const s = single(r);
    for (const w of wordsOf(e)) if (w === r || w === s || single(w) === s) return true;
    return false;
  }
  function remotePlayers() {
    if (E._net && Array.isArray(E._net.players)) return E._net.players;
    try { return (G() && G().net && G().net.players) || []; } catch { return []; }
  }
  /** Everyone playing: [{ id, name, e }] (you first). */
  function playersAll() {
    const g = G(), out = [];
    const p = g && W() ? W().player : null;
    out.push({ id: net.me, name: myName(), e: p && p.alive ? p : null });
    for (const r of remotePlayers()) if (r && r.id !== net.me) out.push({ id: r.id, name: r.name || 'Player', e: r.entity || null });
    return out;
  }
  function playerEntity(who) {
    if (!who || who.id === net.me || who.id === undefined) { const p = W() && W().player; return p && p.alive ? p : null; }
    const r = playersAll().find((x) => x.id === who.id);
    return r ? r.e : null;
  }
  /** Things in the world that answer to a word: 'player' (you), 'players' (everyone), an id, a name, a tag, a kind, a species. */
  function things(ref, ctx) {
    const w = W();
    if (!w || ref === undefined || ref === null || ref === false) return [];
    if (isEntity(ref)) return ref.alive ? [ref] : [];
    if (Array.isArray(ref) && typeof ref[0] !== 'number') return [...new Set(ref.flatMap((r) => things(r, ctx)))];
    const r = lower(typeof ref === 'object' ? JSON.stringify(ref) : ref);
    if (r === 'player' || r === 'me') { const p = playerEntity(ctx && ctx.who); return p ? [p] : []; }
    if (r === 'players' || r === 'everyone') return playersAll().map((x) => x.e).filter(Boolean);
    if (r === 'it' || r === 'this' || r === 'that') {
      // What the trigger was about: the thing touched, clicked, used, destroyed, the vehicle got into...
      const d = ctx && ctx.data;
      const s = d && (d.entity || d.vehicle || d.thing || d.target);
      if (isEntity(s)) return s.alive ? [s] : [];
      const e = s && s.id && G() ? G().entity(s.id) : null;
      return e && e.alive ? [e] : [];
    }
    if (S && S.cacheAt === w.time && S.cache.has(r)) return S.cache.get(r).filter((e) => e.alive);
    const out = [];
    const byId = G() && G().entity(String(ref));
    if (byId && byId.alive) out.push(byId);
    for (const e of w.entities) if (e !== byId && e.alive && !e.isPlayer && matches(e, ref)) out.push(e);
    if (S) { if (S.cacheAt !== w.time) { S.cache.clear(); S.cacheAt = w.time; } S.cache.set(r, out); }
    return out;
  }
  function groundY(x, z, fromY = 60) {
    try { if (H.mayhem && H.mayhem.groundAt) { const y = H.mayhem.groundAt(x, z, fromY); if (y !== null && y !== undefined && isFinite(y)) return y; } } catch { /* ignore */ }
    try { if (H.terrain && H.terrain.active !== false && H.terrain.heightAt) { const y = H.terrain.heightAt(x, z); if (y !== null && isFinite(y)) return y; } } catch { /* ignore */ }
    try { const hit = G().raycast([x, fromY, z], [0, -1, 0], 200, { ignore: W().player }); if (hit) return hit.point[1]; } catch { /* ignore */ }
    return 0;
  }
  function rng(seed) { let a = (Number(seed) >>> 0) || 1; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  /** A place: [x, y, z], [x, z] (on the ground), 'player', a thing's name, { at, radius } (a random spot in it), 'random'. */
  function posOf(ref, ctx, rand = Math.random) {
    if (ref === undefined || ref === null || ref === true) ref = 'player';
    if (isEntity(ref)) return [ref.x, ref.y, ref.z];
    if (Array.isArray(ref) && typeof ref[0] === 'number') return ref.length >= 3 ? [num(ref[0], 0), num(ref[1], 0), num(ref[2], 0)] : [num(ref[0], 0), groundY(num(ref[0], 0), num(ref[1], 0)), num(ref[1], 0)];
    if (typeof ref === 'object' && !Array.isArray(ref)) {
      const c = posOf(ref.at ?? ref.near ?? 'player', ctx, rand);
      const rad = num(ref.radius, 0);
      if (!rad) return c;
      const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * rad;
      const x = c[0] + Math.sin(a) * d, z = c[2] + Math.cos(a) * d;
      return [x, groundY(x, z, c[1] + 30), z];
    }
    const r = lower(ref);
    if (r === 'random' || r === 'anywhere') { const x = (rand() - 0.5) * 50, z = (rand() - 0.5) * 50; return [x, groundY(x, z), z]; }
    if (r === 'player' || r === 'me') { const p = playerEntity(ctx && ctx.who) || (W() && W().player); return p ? [p.x, p.bottom, p.z] : [0, 0, 0]; }
    const list = things(ref, ctx);
    if (!list.length) return null;
    const p = playerEntity(ctx && ctx.who);
    if (p && list.length > 1) list.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
    const e = list[0];
    return [e.x, e.y, e.z];
  }
  function inZoneThing(e, p, pad) {
    const z = e.data && e.data.zone;
    if (z && z.radius) return Math.hypot(p[0] - e.x, p[2] - e.z) <= z.radius && Math.abs(p[1] - e.y) <= e.half[1] + 1.2;
    const b = e.box(pad);
    return p[0] >= b.min[0] && p[0] <= b.max[0] && p[2] >= b.min[2] && p[2] <= b.max[2] && p[1] >= b.min[1] - 1.2 && p[1] <= b.max[1] + 1.2;
  }
  /** Is a point inside a zone: a zone/trigger thing (exactly), any other thing (within `near` meters, 2.5), a point
   *  ([x, y, z]: within `near`, 3), or { at, radius }. */
  function inside(p, ref, near, ctx) {
    if (!p || ref === undefined || ref === null) return false;
    if (Array.isArray(ref) && typeof ref[0] === 'number') { const c = posOf(ref, ctx); return Math.hypot(p[0] - c[0], p[2] - c[2]) <= num(near, 3) && Math.abs(p[1] - c[1]) <= Math.max(3, num(near, 3)); }
    if (typeof ref === 'object' && !Array.isArray(ref) && !isEntity(ref) && (ref.at || ref.radius)) {
      const c = posOf(ref.at ?? 'player', ctx), r = num(ref.radius, 5);
      return Math.hypot(p[0] - c[0], p[2] - c[2]) <= r && Math.abs(p[1] - c[1]) <= Math.max(r, 3);
    }
    for (const e of things(ref, ctx)) {
      if (e.isPlayer) { if (Math.hypot(p[0] - e.x, p[2] - e.z) <= num(near, 3)) return true; continue; }
      const zoneLike = e.kind === 'zone' || e.kind === 'trigger';
      if (inZoneThing(e, p, zoneLike ? num(near, 0) : num(near, 2.5))) return true;
    }
    return false;
  }
  const posOfEntity = (e) => (e ? [e.x, e.y, e.z] : null);
  function whoPos(who) { const e = playerEntity(who); return e ? [e.x, e.y, e.z] : null; }

  // ------------------------------------------------------------------ variables (the host keeps them; everyone sees them)
  const perOf = (name, o) => { const p = (o && (o.per || o.scope)) || (S && S.decl[name] && S.decl[name].per); return p === 'player' || p === 'each' || p === 'players' ? 'player' : 'global'; };
  function getVar(name, who, o) {
    if (!S) return 0;
    const d = S.decl[name];
    const fallback = d ? d.value : 0;
    if (perOf(name, o) === 'player') { const pid = (o && o.player) || (who && who.id) || net.me; const m = S.pvars[pid]; return m && m[name] !== undefined ? m[name] : fallback; }
    return S.vars[name] !== undefined ? S.vars[name] : fallback;
  }
  function setVar(name, value, who, o) {
    if (!S) return;
    const old = getVar(name, who, o);
    if (perOf(name, o) === 'player') {
      const pid = (o && o.player) || (who && who.id) || net.me;
      (S.pvars[pid] = S.pvars[pid] || {})[name] = value;
      if (who && who.name) S.names[pid] = who.name;
    } else S.vars[name] = value;
    if (old !== value) varChanged(name, old, value, who);
  }
  /** Values every player has of a per-player variable, best first: [{ id, name, value }]. */
  function standings(name) {
    if (!S) return [];
    const ids = new Set([...Object.keys(S.pvars), ...playersAll().map((p) => p.id)]);
    const out = [];
    for (const id of ids) { const v = S.pvars[id] && S.pvars[id][name]; out.push({ id, name: S.names[id] || (id === net.me ? myName() : 'Player'), value: v === undefined ? (S.decl[name] ? S.decl[name].value : 0) : v }); }
    return out.sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0));
  }

  // ------------------------------------------------------------------ words in text: {player}, {score}, {best:fish}
  function getPath(o, path) { let v = o; for (const k of String(path).split('.')) { if (v === null || v === undefined) return undefined; v = v[k]; } return v; }
  function fill(text, ctx) {
    if (typeof text !== 'string' || !text.includes('{')) return text;
    return text.replace(/\{([^{}]+)\}/g, (all, key) => {
      const k = key.trim();
      const show = (v) => (typeof v === 'number' ? String(r2(v)) : v === undefined || v === null ? '' : typeof v === 'object' ? (v.name || '') : String(v));
      if (k === 'player' || k === 'who') return (ctx && ctx.who && ctx.who.name) || myName();
      if (k === 'hour') return S && S.clock ? String(Math.floor(S.clock.hour)) : '';
      if (k === 'clock') return S && S.clock ? clockText() : '';
      const m = /^(best|bestValue|top|topValue|count):(.+)$/.exec(k);
      if (m) {
        if (m[1] === 'count') return String(things(m[2].trim(), ctx).length);
        const s = standings(m[2].trim())[0];
        return s ? (m[1] === 'best' || m[1] === 'top' ? s.name : show(s.value)) : '';
      }
      if (ctx && ctx.data && k.startsWith('data.')) return show(getPath(ctx.data, k.slice(5)));
      if (ctx && ctx.data && getPath(ctx.data, k) !== undefined && !(S && (S.decl[k] || k in S.vars))) return show(getPath(ctx.data, k));
      if (S && (S.decl[k] || k in S.vars || Object.values(S.pvars).some((m2) => k in m2))) return show(getVar(k, ctx && ctx.who));
      return all;
    });
  }
  function clockText() { const h = S.clock.hour, hh = Math.floor(h), mm = Math.floor((h - hh) * 60); return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`; }

  // ------------------------------------------------------------------ comparing
  const OPS = ['>', '>=', '<', '<=', '=', '==', '!=', 'is', 'not', 'above', 'below', 'atLeast', 'atMost', 'equals', 'min', 'max'];
  function compare(v, c) {
    let any = false;
    for (const op of OPS) {
      if (!(op in c)) continue;
      if (op === 'not' && typeof c.not === 'object') continue; // { not: condition } is the logic one
      any = true;
      const x = c[op];
      const n = Number(v), m = Number(x);
      const ok = op === '>' || op === 'above' ? n > m : op === '>=' || op === 'atLeast' || op === 'min' ? n >= m : op === '<' || op === 'below' ? n < m : op === '<=' || op === 'atMost' || op === 'max' ? n <= m : op === '!=' || op === 'not' ? lower(v) !== lower(x) : lower(v) === lower(x);
      if (!ok) return false;
    }
    return any ? true : Boolean(v) && v !== '0';
  }
  function hourIn(h, win) {
    if (typeof win === 'string') { const w = lower(win); if (w === 'night') return h >= 20 || h < 5; if (w === 'day' || w === 'daytime') return h >= 6 && h < 19; if (TIMES[w] !== undefined) return Math.abs(h - TIMES[w]) < 1; return false; }
    if (Array.isArray(win)) { const [a, b] = win.map(Number); return a <= b ? h >= a && h < b : h >= a || h < b; }
    return Math.abs(h - Number(win)) < 1;
  }

  // ------------------------------------------------------------------ conditions
  function check(c, ctx) {
    if (c === undefined || c === null || c === true) return true;
    if (c === false) return false;
    if (Array.isArray(c)) return c.every((x) => check(x, ctx));
    if (typeof c === 'string') { const w = lower(c); if (w === 'night' || w === 'day') return hourIn(S && S.clock ? S.clock.hour : 12, w); if (w === 'host') return net.host; return Boolean(getVar(c, ctx.who)); }
    if (typeof c !== 'object') return Boolean(c);
    if (c.not !== undefined && typeof c.not === 'object') { if (check(c.not, ctx)) return false; }
    if (c.any !== undefined && Array.isArray(c.any)) { if (!c.any.some((x) => check(x, ctx))) return false; }
    if (c.all !== undefined && Array.isArray(c.all)) { if (!c.all.every((x) => check(x, ctx))) return false; }
    for (const [k, f] of CONDS) if (k in c) { let ok = false; try { ok = f(c, ctx); } catch (err) { report(err, `events condition ${k}`); } if (!ok) return false; }
    return true;
  }
  defineCondition('var', (c, ctx) => compare(getVar(c.var, ctx.who, c), c));
  defineCondition('count', (c, ctx) => compare(things(c.count, ctx).length, c));
  defineCondition('chance', (c) => Math.random() < num(c.chance, 0.5));
  defineCondition('who', (c, ctx) => {
    const w = lower(c.who), who = ctx.who || meWho();
    if (w === 'any' || w === 'anyone') return true;
    if (w === 'host') return who.id === net.me && net.host;
    if (w.startsWith('team:')) return lower(getVar('team', who, { per: 'player' })) === w.slice(5);
    return lower(who.name) === w || lower(who.id) === w;
  });
  defineCondition('team', (c, ctx) => lower(getVar('team', ctx.who, { per: 'player' })) === lower(c.team));
  defineCondition('has', (c, ctx) => hasItem(ctx.who, c.has, num(c.count, 1)));
  defineCondition('in', (c, ctx) => inside(whoPos(ctx.who), c.in, c.near, ctx));
  defineCondition('everyone', (c, ctx) => { const z = typeof c.everyone === 'object' && !Array.isArray(c.everyone) ? c.everyone.in : c.everyone; const ps = playersAll().filter((p) => p.e); return ps.length > 0 && ps.every((p) => inside([p.e.x, p.e.y, p.e.z], z, c.near, ctx)); });
  defineCondition('nobody', (c, ctx) => !playersAll().some((p) => p.e && inside([p.e.x, p.e.y, p.e.z], c.nobody, c.near, ctx)));
  defineCondition('time', (c) => hourIn(S && S.clock ? S.clock.hour : 12, c.time));
  defineCondition('elapsed', (c) => { const t = now(); if (Array.isArray(c.elapsed)) return t >= Number(c.elapsed[0]) && t < Number(c.elapsed[1]); return t >= Number(c.elapsed); });
  defineCondition('players', (c) => compare(playersAll().length, c));
  defineCondition('weather', (c) => lower(S && S.weather || 'clear') === lower(c.weather));
  defineCondition('alive', (c, ctx) => things(c.alive, ctx).length > 0);

  // ------------------------------------------------------------------ items (a bag per player; tools are items too)
  function hasItem(who, item, n = 1) {
    const pid = (who && who.id) || net.me;
    const name = lower(item);
    if (S && S.inv[pid] && (S.inv[pid][name] || 0) >= n) return true;
    if (pid === net.me) {
      const held = H.tools && H.tools.held;
      if (held && lower(held.name) === name) return true;
      if (H.mayhem && Array.isArray(H.mayhem.belt) && H.mayhem.belt.map(lower).includes(name)) return true;
      const t = W() && W().player && W().player.tool;
      if (t && lower(typeof t === 'string' ? t : t.type) === name) return true;
    }
    return false;
  }
  function addItem(who, item, n) {
    const pid = (who && who.id) || net.me;
    const name = lower(item);
    const bag = (S.inv[pid] = S.inv[pid] || {});
    bag[name] = Math.max(0, (bag[name] || 0) + n);
    if (!bag[name]) delete bag[name];
    if (who && who.name) S.names[pid] = who.name;
  }

  // ------------------------------------------------------------------ rules
  /** A trigger in its one shape: { type, ...options }. Words work too: "start", "night", "noon", "explosion". */
  function normTrigger(t) {
    if (t === undefined || t === null || t === false) return null;
    if (typeof t === 'string') {
      const w = lower(t);
      if (w === 'start' || w === 'begin') return { type: 'start' };
      if (TIMES[w] !== undefined) return { type: 'time', time: TIMES[w] };
      return { type: 'event', event: t.trim() };
    }
    if (typeof t !== 'object') return null;
    if (t.type) return { ...t, type: lower(t.type) === 'on' ? 'event' : lower(t.type) };
    for (const k of TRIGGERS) if (k in t) {
      if (k === 'on') return { ...t, type: 'event', event: t.on };
      if (k === 'quest') return { ...t, type: 'event', event: 'quest', where: { ...(t.where || {}), id: t.quest, ...(t.is || t.state ? { state: t.is || t.state } : {}), ...(t.step ? { step: t.step } : {}) } };
      return { ...t, type: k };
    }
    return null;
  }
  function norm(raw, source) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('events: a rule is { "when": ..., "if": ..., "do": [...] }');
    const id = String(raw.id || raw.name || `rule${++S.uid}`);
    const when = arr(raw.when ?? raw.on ?? raw.trigger).map(normTrigger).filter(Boolean);
    for (const t of when) if (t.type === 'time') t.time = typeof t.time === 'string' ? (TIMES[lower(t.time)] ?? Number(t.time)) : Number(t.time);
    return {
      id, name: String(raw.name || raw.id || ''), when, cond: raw.if ?? raw.conditions ?? null,
      act: arr(raw.do ?? raw.then ?? raw.actions), else: arr(raw.else), once: Boolean(raw.once), cooldown: num(raw.cooldown, 0),
      max: num(raw.max, Infinity), enabled: raw.enabled !== false, source, count: 0, last: -1e9, st: {}, raw,
    };
  }
  function addRule(raw, source = 'script') {
    if (!S) throw new Error('events: no game is running');
    const r = norm(raw, source);
    if (S.byId.has(r.id)) removeRule(r.id);
    S.rules.push(r);
    S.byId.set(r.id, r);
    for (const t of r.when) if (t.type === 'event') listen(t.event);
    if (r.when.some((t) => t.type === 'time')) ensureClock();
    if (r.when.some((t) => t.type === 'weather')) listen('weather');
    // Rules added after the start (scripts' onStart, or later) still see "start" if the game hasn't started yet.
    return r.id;
  }
  function removeRule(id) { const r = S && S.byId.get(String(id)); if (!r) return false; S.byId.delete(r.id); S.rules = S.rules.filter((x) => x !== r); return true; }
  function listen(name) {
    if (!S || !name || S.listened.has(name)) return;
    S.listened.add(name);
    try { S.g.on(name, (d) => onEvent(name, d)); } catch (err) { report(err); }
  }

  /** The thing an event is about, slimmed to plain data so it can travel to the host. */
  function slim(v, depth = 0) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return isFinite(v) ? r2(v) : null;
    if (typeof v === 'string' || typeof v === 'boolean') return v;
    if (typeof v !== 'object' || depth > 3) return null;
    if (isEntity(v)) return { id: v.sceneId || null, name: v.name || null, tag: v.tag || null, kind: v.kind || null, species: (v.data && (v.data.species || v.data.critter)) || null, data: v.data && v.data.tag ? { tag: v.data.tag } : undefined, player: v.isPlayer ? true : undefined, pos: [r2(v.x), r2(v.y), r2(v.z)] };
    if (Array.isArray(v)) return v.slice(0, 24).map((x) => slim(x, depth + 1));
    if (v.getClassName) return null; // a Babylon object
    const o = {};
    for (const [k, x] of Object.entries(v)) { if (typeof x === 'function') continue; const s = slim(x, depth + 1); if (s !== null && s !== undefined) o[k] = s; }
    return o;
  }
  /** Which things an event is about (for "of"): the entity, vehicle, fish, thing... */
  const SUBJECTS = ['entity', 'vehicle', 'thing', 'fish', 'trigger', 'target', 'creature', 'item'];
  function eventMatch(t, d) {
    if (t.of !== undefined) {
      let ok = false;
      for (const k of SUBJECTS) { const s = d && d[k]; if (s && (isEntity(s) ? matches(s, t.of) : typeof s === 'object' ? matches(s, t.of) || arr(t.of).some((o) => [s.id, s.name, s.rarity, s.kind, s.species].map(lower).includes(lower(o))) : lower(s) === lower(t.of))) { ok = true; break; } }
      if (!ok && d && typeof d.what === 'string' && arr(t.of).some((o) => single(lower(o)) === single(lower(d.what)))) ok = true;
      if (!ok) return false;
    }
    if (t.where && typeof t.where === 'object') {
      for (const [path, want] of Object.entries(t.where)) {
        const v = getPath(d || {}, path);
        if (want && typeof want === 'object' && !Array.isArray(want)) { if (!compare(v, want)) return false; }
        else if (Array.isArray(want)) { if (!want.map(lower).includes(lower(v))) return false; }
        else if (lower(v) !== lower(want)) return false;
      }
    }
    if (t.by !== undefined) { const by = d && d.by; if (!by || !(isEntity(by) ? matches(by, t.by) : lower(by.name || by) === lower(t.by))) return false; }
    return true;
  }
  // Events the engine and modules announce only on the machine of the player they're about.
  const LOCAL_EVENTS = new Set(['kill', 'pickup', 'checkpoint', 'finish', 'waypoint', 'gate', 'cast', 'bite', 'hooked', 'escape', 'snap', 'swim', 'underwater', 'bucket', 'wet', 'knocked', 'mayhem', 'score']);
  function onEvent(name, d) {
    if (!active()) return;
    if (name === 'weather') weatherSeen(d);
    const mine = Boolean(d && (d.mine === true || d.me === true || (d.entity && d.entity === W().player)));
    const theirs = Boolean(d && (d.mine === false || d.me === false));
    for (const r of [...S.rules]) {
      if (!r.enabled) continue;
      for (const t of r.when) {
        if (t.type !== 'event' || lower(t.event) !== lower(name)) continue;
        let ok = false;
        try { ok = eventMatch(t, d); } catch (err) { report(err); }
        if (!ok) continue;
        if (mine || (!theirs && LOCAL_EVENTS.has(lower(name)))) trigger(r, d, true);
        else if (!theirs && net.host) trigger(r, d, false);
        break;
      }
    }
  }
  function weatherName(d) {
    if (!d) return 'clear';
    if (typeof d === 'string') return lower(d);
    if (d.name) return lower(d.name);
    if (d.snow) return 'snow';
    if (d.lightning) return 'storm';
    const rain = Number(d.rain) || 0;
    return rain > 0.55 ? 'rain' : rain > 0.02 ? 'drizzle' : 'clear';
  }
  function weatherSeen(d) {
    const name = weatherName(d);
    if (!S || name === S.weather) return;
    S.weather = name;
    if (!net.host || !active()) return;
    for (const r of [...S.rules]) for (const t of r.when) if (t.type === 'weather' && (t.weather === true || lower(t.weather) === 'any' || lower(t.weather) === name || (lower(t.weather) === 'rain' && name === 'storm'))) { fire(r, { who: meWho(), data: { weather: name } }); break; }
  }

  // Asked of the host by the player who saw the trigger (their zone, click, catch...).
  const fireAction = syncAction('events:fire', (d, o) => {
    if (!o.authoritative || !live()) return;
    const r = S.byId.get(String(d.r));
    if (r) fire(r, { who: d.who || meWho(), data: d.d || null });
  });
  /** A trigger happened. `local`: it's this player's (sent to the host when someone else hosts). */
  function trigger(r, data, local) {
    if (!live() || !r.enabled) return;
    if (local && net.online && !net.host) { fireAction({ r: r.id, who: meWho(), d: slim(data) }); return; }
    fire(r, { who: local ? meWho() : whoOf(data), data });
  }
  function whoOf(d) {
    const by = d && d.by;
    if (by && typeof by === 'object' && !isEntity(by) && by.id) return { id: by.id, name: by.name || 'Player' };
    if (d && d.entity && d.entity.remotePlayer) return { id: d.entity.netId, name: d.entity.name || 'Player' };
    return meWho();
  }
  /** The host runs a rule: its conditions, then its actions. Returns true if it ran. */
  function fire(r, ctx) {
    if (!live() || !r.enabled) return false;
    if ((r.once && r.count > 0) || r.count >= r.max) return false;
    const t = now();
    if (r.cooldown && t - r.last < r.cooldown) return false;
    const c = { who: ctx.who || meWho(), data: ctx.data || null, rule: r.id };
    let ok = false;
    try { ok = check(r.cond, c); } catch (err) { report(err); }
    if (!ok) { if (r.else.length) runSeq(r.else, c); return false; }
    r.count++;
    r.last = t;
    S.history.push({ rule: r.id, t: r2(t), who: c.who.name });
    if (S.history.length > 60) S.history.shift();
    runSeq(r.act, c);
    return true;
  }

  // ------------------------------------------------------------------ running actions: wait, repeat, if, random
  function runSeq(list, ctx) {
    const run = { stack: [{ list: arr(list), i: 0 }], until: -1, ctx, dead: false };
    S.seqs.push(run);
    advance(run);
    return run;
  }
  function advance(run) {
    const w = W();
    let guard = 0;
    while (!run.dead && run.stack.length && guard++ < 400) {
      if (run.until > w.time) return;
      const f = run.stack[run.stack.length - 1];
      if (f.i >= f.list.length) {
        if (f.repeat !== undefined) {
          f.done = (f.done || 0) + 1;
          const more = f.repeat === Infinity || f.done < f.repeat;
          if (more && (f.while === undefined || check(f.while, run.ctx)) && !(f.until !== undefined && check(f.until, run.ctx))) { f.i = 0; if (f.every) run.until = w.time + f.every; continue; }
        }
        run.stack.pop();
        continue;
      }
      const a = f.list[f.i++];
      try { if (!control(a, run)) perform(a, run.ctx); } catch (err) { report(err, `events rule ${run.ctx.rule || ''}`); }
    }
    if (!run.stack.length) run.dead = true;
  }
  function control(a, run) {
    if (!a || typeof a !== 'object') return false;
    const ctx = run.ctx, w = W();
    if ('wait' in a && Object.keys(a).filter((k) => k !== 'wait').length === 0) { run.until = w.time + Math.max(0, num(a.wait, 1)); return true; }
    if ('repeat' in a) {
      const n = a.repeat === true || lower(a.repeat) === 'forever' ? Infinity : Math.max(0, Math.floor(num(a.repeat, 1)));
      if (n > 0 && (a.while === undefined || check(a.while, ctx))) run.stack.push({ list: arr(a.do), i: 0, repeat: n, every: num(a.every, 0), while: a.while, until: a.until });
      return true;
    }
    if ('if' in a && ('do' in a || 'then' in a || 'else' in a)) { const branch = check(a.if, ctx) ? arr(a.do ?? a.then) : arr(a.else); if (branch.length) run.stack.push({ list: branch, i: 0 }); return true; }
    if ('random' in a && Array.isArray(a.random)) {
      const opts = a.random.filter(Boolean);
      if (opts.length) { const pick = opts[Math.floor(Math.random() * opts.length)]; run.stack.push({ list: arr(pick && pick.do ? pick.do : pick), i: 0 }); }
      return true;
    }
    if ('each' in a && 'do' in a) {
      const list = lower(a.each) === 'player' || lower(a.each) === 'players' ? playersAll() : [];
      for (const p of list) runSeq(arr(a.do), { ...ctx, who: { id: p.id, name: p.name } });
      return true;
    }
    if ('do' in a && Object.keys(a).length === 1) { run.stack.push({ list: arr(a.do), i: 0 }); return true; }
    return false;
  }
  function actionName(a) {
    if (typeof a === 'string') return ACTIONS.has(a) ? a : null;
    if (!a || typeof a !== 'object') return null;
    for (const k of ORDER) if (k in a) return k;
    return null;
  }
  /** Fills words and places for an action before it travels (the host knows the variables and where everyone is). */
  function prepare(a, def, ctx, scope) {
    const out = clone(a);
    if (def.defaults) for (const [k, v] of Object.entries(def.defaults)) if (!(k in out)) { out[k] = clone(v); out[`_auto_${k}`] = true; }
    for (const k of def.text || []) if (typeof out[k] === 'string') out[k] = fill(out[k], ctx);
    if (scope === 'all') for (const k of def.at || []) if (k in out && (out[k] === 'player' || out[k] === 'me' || out[k] === true)) { const p = posOf('player', ctx); if (p) out[k] = p.map(r2); }
    if (out._seed === undefined) out._seed = Math.floor(Math.random() * 1e9);
    return out;
  }
  const doAction = syncAction('events:do', (d) => applyAction(d));
  /** Where an action runs: once on the host, on every player's screen, or on one player's. */
  function perform(raw, ctx) {
    const a = typeof raw === 'string' ? { [raw]: true } : raw;
    const name = actionName(a);
    if (!name) { report(new Error(`events: no action in ${JSON.stringify(raw).slice(0, 120)} (known: ${ORDER.slice(0, 40).join(', ')}...)`)); return; }
    if (S && ++S.actionsThisStep > 600) return; // a runaway loop: the rest waits for the next step
    const def = ACTIONS.get(name);
    let scope = typeof def.scope === 'function' ? def.scope(a, ctx) : def.scope;
    if (scope === 'player' && (a.to === 'all' || a.to === 'everyone' || a.to === 'players')) scope = 'all';
    const prepared = prepare(a, def, ctx, scope);
    if (scope === 'host' || (!net.online && !E._net)) { runDef(def, name, prepared, { ...ctx, seed: prepared._seed }); return; }
    doAction({ n: name, a: prepared, pid: scope === 'player' ? (ctx.who && ctx.who.id) || net.me : null, who: ctx.who || meWho(), d: slim(ctx.data) });
  }
  function applyAction(d) {
    if (!live()) return;
    if (d.pid && d.pid !== net.me) return;
    const a = d.a || {};
    if (typeof a.to === 'string' && lower(a.to).startsWith('team:') && lower(getVar('team', meWho(), { per: 'player' })) !== lower(a.to).slice(5)) return;
    const def = ACTIONS.get(d.n);
    if (def) runDef(def, d.n, a, { who: d.who || meWho(), data: d.d || null, seed: a._seed, here: true });
  }
  function runDef(def, name, a, ctx) { try { def.run(a, ctx); } catch (err) { report(err, `events action ${name}`); } }

  // ------------------------------------------------------------------ the clock (time of day) and the light
  function ensureClock(v) {
    if (!S) return;
    const o = v && typeof v === 'object' ? v : typeof v === 'number' ? { hour: v } : {};
    // One clock for the world: the sky's (H.sky owns the time of day; config.time and this are the same clock).
    if (!S.clock) S.clock = H.sky ? H.sky.clock(true) : { hour: 8, day: 720, light: true, run: true };
    if (o.hour !== undefined || o.start !== undefined) S.clock.hour = ((num(o.hour ?? o.start, 8) % 24) + 24) % 24;
    if (o.day !== undefined) S.clock.day = Math.max(10, num(o.day, 720));
    if (o.minutes !== undefined) S.clock.day = Math.max(10, num(o.minutes, 12) * 60);
    if (o.light !== undefined) S.clock.light = o.light !== false;
    if (o.run !== undefined || o.stopped !== undefined) S.clock.run = o.run !== false && !o.stopped;
  }
  function setHour(h) { ensureClock(); S.clock.hour = ((Number(h) % 24) + 24) % 24; S.clock.jumped = true; }
  const crossed = (a, b, h) => (b >= a ? a < h && h <= b : h > a || h <= b);
  function daylight(h) { if (h >= 7 && h <= 18) return 1; if (h < 5 || h > 20) return 0.12; return h < 7 ? 0.12 + (h - 5) / 2 * 0.88 : 1 - (h - 18) / 2 * 0.88; }
  /** The dark (disasters, zombie nights) goes to the sky, which works out the light with the clock (H.sky). */
  function applyLight() {
    if (!S || !H.sky) return;
    H.sky.set('events', S.dark.v > 0.003 ? { dark: S.dark.v } : null);
  }
  /** Darkens the world (0 to 1) over `fade` seconds, for `seconds` if given (then back). Disasters and zombie nights. */
  function setDark(v, fade = 2, seconds = null) { if (!S) return; S.dark.to = Math.max(0, Math.min(1, Number(v) || 0)); S.dark.rate = 1 / Math.max(0.05, fade); S.dark.until = seconds ? now() + seconds : null; }

  // ------------------------------------------------------------------ world features from rules (weather, the sea)
  /** Turns a world feature on, changes it or turns it off for this game (not saved in the world). */
  function setFeature(key, value) {
    const w = W(), def = H.features.get(key);
    if (!w || !def || !w.features) return false;
    const on = value !== undefined && value !== null && value !== false;
    const f = w.features.get(key);
    const ctx = (x) => ({ game: G(), H, world: w, scene: w.scene, key, state: x.state, value: x.value });
    if (!on) { if (f) { w.features.delete(key); if (def.dispose) def.dispose(ctx(f)); } return true; }
    if (f && def.change) { const old = f.value; f.value = clone(value); def.change(f.value, old, ctx(f)); return true; }
    if (f) { w.features.delete(key); if (def.dispose) def.dispose(ctx(f)); }
    const n = { def, value: clone(value), state: {} };
    w.features.set(key, n);
    def.apply(n.value, ctx(n));
    return true;
  }

  // ------------------------------------------------------------------ the screen: the HUD, banners, countdowns
  function css() {
    if (typeof document === 'undefined' || document.getElementById('ev-style')) return;
    const st = document.createElement('style');
    st.id = 'ev-style';
    st.textContent = [
      '.ev-hud{position:fixed;top:12px;right:12px;z-index:25;display:flex;flex-direction:column;gap:6px;align-items:flex-end;pointer-events:none;font:600 15px/1.3 system-ui,sans-serif;color:#fff;max-width:calc(100vw - 24px)}',
      '.ev-hud:empty{display:none}.ev-hud .ev-box{background:rgba(10,14,24,.7);border:1px solid rgba(255,255,255,.18);border-radius:12px;padding:6px 12px;backdrop-filter:blur(4px);text-align:right;white-space:pre-line}',
      '.ev-hud .ev-box b{color:#ffd84a}.ev-hud .ev-time{font-variant-numeric:tabular-nums;font-size:18px}.ev-hud .ev-board{text-align:left;min-width:150px}.ev-hud .ev-board i{opacity:.7;font-style:normal;margin-right:6px}',
      '.ev-banner{position:fixed;left:50%;top:28%;transform:translate(-50%,-50%) scale(.92);z-index:36;text-align:center;color:#fff;pointer-events:none;opacity:0;transition:opacity .35s,transform .35s;font:800 clamp(30px,7vw,66px)/1.05 system-ui,sans-serif;text-shadow:0 4px 26px rgba(0,0,0,.65);width:min(92vw,900px)}',
      '.ev-banner.on{opacity:1;transform:translate(-50%,-50%) scale(1)}.ev-banner small{display:block;font:600 clamp(15px,3.6vw,23px)/1.3 system-ui,sans-serif;opacity:.92;margin-top:10px}',
      '.ev-banner.win{color:#ffe066}.ev-banner.lose{color:#ff7b7b}.ev-banner.quest{color:#9ef0b6}',
      '.ev-count{position:fixed;left:50%;top:40%;transform:translate(-50%,-50%);z-index:37;font:900 clamp(70px,20vw,180px)/1 system-ui,sans-serif;color:#fff;text-shadow:0 6px 30px rgba(0,0,0,.6);pointer-events:none;animation:ev-pop .9s ease-out both}',
      '@keyframes ev-pop{0%{transform:translate(-50%,-50%) scale(1.6);opacity:0}25%{opacity:1;transform:translate(-50%,-50%) scale(1)}100%{opacity:.0;transform:translate(-50%,-50%) scale(.85)}}',
      '.ev-toast{position:fixed;left:50%;bottom:30%;transform:translateX(-50%);z-index:34;font:700 17px system-ui,sans-serif;color:#fff;background:rgba(10,14,24,.75);border-radius:12px;padding:8px 14px;pointer-events:none;transition:opacity .4s}',
      '.ev-prompt{position:fixed;left:50%;bottom:22%;transform:translateX(-50%);z-index:30;pointer-events:none}.ev-prompt button{pointer-events:auto;font:600 15px system-ui,sans-serif;color:#fff;background:rgba(10,14,24,.75);border:1px solid rgba(255,255,255,.25);border-radius:12px;padding:10px 14px;cursor:pointer;min-height:44px}.ev-prompt kbd{display:inline-block;min-width:1.4em;margin-right:6px;padding:1px 6px;border-radius:6px;background:rgba(255,255,255,.18);font:700 13px system-ui}.ev-prompt:empty{display:none}',
    ].join('\n');
    document.head.appendChild(st);
  }
  function el(key, cls) {
    if (typeof document === 'undefined' || !document.body) return null;
    if (S.ui[key] && S.ui[key].isConnected !== false) return S.ui[key];
    css();
    const x = document.createElement('div');
    x.className = cls;
    document.body.appendChild(x);
    S.ui[key] = x;
    return x;
  }
  function clearUi() { if (!S) return; for (const x of Object.values(S.ui)) try { x.remove(); } catch { /* gone */ } S.ui = {}; }
  function banner(title, sub, seconds = 3, cls = '') {
    const b = el('banner', 'ev-banner');
    if (!b) return;
    b.className = `ev-banner ${cls}`;
    b.textContent = String(title || '');
    if (sub) { const s = document.createElement('small'); s.textContent = String(sub); b.appendChild(s); }
    S.bannerUntil = now() + Math.max(0.5, seconds);
    requestAnimationFrame(() => b.classList.add('on'));
    b.classList.add('on');
  }
  function toast(text, seconds = 1.6) {
    const t = el('toast', 'ev-toast');
    if (!t) return;
    t.textContent = String(text);
    t.style.opacity = '1';
    S.toastUntil = now() + seconds;
  }
  function bigNumber(text) {
    if (typeof document === 'undefined' || !document.body) return;
    css();
    const x = document.createElement('div');
    x.className = 'ev-count';
    x.textContent = String(text);
    document.body.appendChild(x);
    setTimeout(() => x.remove(), 950);
  }
  function renderHud() {
    const box = el('hud', 'ev-hud');
    if (!box || !S) return;
    const parts = [];
    for (const h of S.hud) {
      if (h.var === 'clock') { if (S.clock) parts.push(`<div class="ev-box ev-time">${esc(h.label || '')}${h.label ? ' ' : ''}${clockText()}</div>`); continue; }
      const v = getVar(h.var, meWho(), h);
      parts.push(`<div class="ev-box">${esc(h.label || h.var)}: <b>${esc(typeof v === 'number' ? r2(v) : v)}${h.of ? ` / ${esc(h.of)}` : ''}</b></div>`);
    }
    for (const t of S.timers) {
      const left = Math.max(0, t.end - now());
      const m = Math.floor(left / 60), s = Math.floor(left % 60);
      parts.push(`<div class="ev-box ev-time">${esc(t.label || '')}${t.label ? ' ' : ''}<b>${m}:${String(s).padStart(2, '0')}</b></div>`);
    }
    for (const bd of S.boards) {
      const rows = standings(bd.var).slice(0, bd.top || 5);
      parts.push(`<div class="ev-box ev-board">${bd.title ? `<div>${esc(bd.title)}</div>` : ''}${rows.map((r, i) => `<div><i>${i + 1}.</i>${esc(r.name)} <b>${esc(r2(Number(r.value) || 0))}</b></div>`).join('')}</div>`);
    }
    const html = parts.join('');
    if (html !== box._html) { box._html = html; box.innerHTML = html; }
  }
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ------------------------------------------------------------------ sounds: the game's asset, a module's, or a made one
  let ac = null;
  function audio() {
    if (H.audio && H.audio.context) return { ctx: H.audio.context, out: H.audio.master || H.audio.context.destination };
    if (ac) return ac;
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!AC) return null;
    try { const c = new AC(); ac = { ctx: c, out: c.destination }; } catch { return null; }
    return ac;
  }
  function tone(notes, o = {}) {
    const a = audio();
    if (!a || !a.ctx || a.ctx.state === 'closed') return;
    try {
      if (a.ctx.state === 'suspended') a.ctx.resume();
      const t0 = a.ctx.currentTime + 0.01;
      notes.forEach(([f, at, dur, type], i) => {
        const o1 = a.ctx.createOscillator(), g = a.ctx.createGain();
        o1.type = type || o.type || 'sine';
        o1.frequency.setValueAtTime(f, t0 + at);
        if (o.slide) o1.frequency.exponentialRampToValueAtTime(Math.max(20, f * o.slide), t0 + at + dur);
        g.gain.setValueAtTime(0.0001, t0 + at);
        g.gain.exponentialRampToValueAtTime((o.volume ?? 0.25) / (1 + i * 0.05), t0 + at + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
        o1.connect(g).connect(a.out);
        o1.start(t0 + at); o1.stop(t0 + at + dur + 0.05);
      });
    } catch { /* no sound */ }
  }
  const SYNTH = {
    bell: () => tone([[660, 0, 2.2], [1320, 0, 1.4], [1980, 0, 0.8], [990, 0, 1.6]], { volume: 0.22 }),
    chime: () => tone([[1046, 0, 0.6], [1318, 0.12, 0.6], [1568, 0.24, 0.9]], { volume: 0.18 }),
    fanfare: () => tone([[523, 0, 0.18, 'triangle'], [659, 0.15, 0.18, 'triangle'], [784, 0.3, 0.18, 'triangle'], [1046, 0.45, 0.7, 'triangle'], [784, 0.45, 0.7, 'sine']], { volume: 0.2 }),
    alarm: () => tone([[880, 0, 0.25, 'square'], [660, 0.3, 0.25, 'square'], [880, 0.6, 0.25, 'square'], [660, 0.9, 0.25, 'square']], { volume: 0.08 }),
    siren: () => tone([[400, 0, 1.4, 'sawtooth']], { volume: 0.06, slide: 2.2 }),
    horn: () => tone([[220, 0, 0.9, 'sawtooth'], [277, 0, 0.9, 'sawtooth']], { volume: 0.07 }),
    whistle: () => tone([[1800, 0, 0.5, 'sine']], { volume: 0.12, slide: 1.3 }),
    drum: () => tone([[110, 0, 0.35, 'sine']], { volume: 0.5, slide: 0.4 }),
    rumble: () => tone([[45, 0, 2.5, 'sawtooth'], [52, 0.1, 2.5, 'sawtooth']], { volume: 0.12 }),
    wind: () => tone([[180, 0, 3, 'sawtooth']], { volume: 0.03, slide: 1.6 }),
    beep: () => tone([[880, 0, 0.15, 'square']], { volume: 0.06 }),
    lose: () => tone([[392, 0, 0.3, 'triangle'], [330, 0.3, 0.3, 'triangle'], [262, 0.6, 0.8, 'triangle']], { volume: 0.2 }),
    win: () => tone([[523, 0, 0.15, 'triangle'], [659, 0.12, 0.15, 'triangle'], [784, 0.24, 0.15, 'triangle'], [1046, 0.36, 0.9, 'triangle']], { volume: 0.22 }),
  };
  const ASSET_EXT = ['', '.mp3', '.wav', '.ogg', '.m4a'];
  function playSound(name, o = {}) {
    const g = G();
    const n = String(name || 'beep');
    const asset = g && g.hasAsset ? ASSET_EXT.map((x) => n + x).find((x) => g.hasAsset(x)) : null;
    if (asset) { g.sound(asset, { volume: num(o.volume, 1) }); return; }
    const k = lower(n).replace(/\.(mp3|wav|ogg|m4a)$/, '');
    if (SYNTH[k]) { SYNTH[k](); return; }
    if (H.mayhem && H.mayhem.sound && ['boom', 'crash', 'whoosh', 'pop', 'beep', 'fire', 'throw', 'zap', 'rope', 'moo'].includes(k)) { H.mayhem.sound(k, o); return; }
    if (H.water && H.water.sound && ['splash', 'plop', 'bite', 'reel', 'catch', 'snap', 'drip'].includes(k)) { H.water.sound(k, o); return; }
    SYNTH.chime();
  }
  E.sound = playSound;

  // ------------------------------------------------------------------ the actions
  const toPlayer = (a) => (a.to === 'player' || a.to === 'me' ? 'player' : 'all');
  const seeded = (ctx) => rng(ctx.seed || Math.floor(Math.random() * 1e9));
  // Variables and score (host).
  defineAction('var', {
    scope: 'host',
    run(a, ctx) {
      const name = String(a.var);
      if ('set' in a) setVar(name, typeof a.set === 'string' ? fill(a.set, ctx) : a.set, ctx.who, a);
      else if ('add' in a) setVar(name, (Number(getVar(name, ctx.who, a)) || 0) + num(a.add, 1), ctx.who, a);
      else if ('sub' in a || 'subtract' in a) setVar(name, (Number(getVar(name, ctx.who, a)) || 0) - num(a.sub ?? a.subtract, 1), ctx.who, a);
      else if ('toggle' in a) setVar(name, !getVar(name, ctx.who, a), ctx.who, a);
      else setVar(name, (Number(getVar(name, ctx.who, a)) || 0) + 1, ctx.who, a);
    },
  });
  defineAction('score', {
    scope: 'host',
    run(a, ctx) {
      const n = num(a.score, 1);
      setVar('score', (Number(getVar('score', ctx.who, { per: 'player' })) || 0) + n, ctx.who, { per: 'player' });
      perform({ _toast: `${n >= 0 ? '+' : ''}${n}`, to: 'player' }, ctx);
      perform({ emit: 'score', data: { points: n, total: getVar('score', ctx.who, { per: 'player' }), by: ctx.who } }, ctx);
    },
  });
  defineAction('_toast', { scope: 'player', text: ['_toast'], run(a) { toast(a._toast, num(a.seconds, 1.6)); } });
  // Making and changing things.
  // Zombies: people who hunt players (Living things' brains), green and slow, for zombie nights.
  if (H.living && H.living.species && H.living.species.get && H.living.species.add && !H.living.species.get('zombie') && H.living.species.get('person')) {
    try { H.living.species.add('zombie', { ...H.living.species.get('person'), temper: 'angry', walk: 1.1, run: 3.4, hp: 60, bite: 10, sight: 24, hunts: ['person'], sound: 'groan', colors: { body: '#4f6b3a', head: '#8fb07a', legs: '#3b3f4a', accent: '#2a1d14' } }); } catch (err) { report(err); }
  }
  function spawnSpec(what, a) {
    if (what && typeof what === 'object') return clone(what);
    const w = lower(what), s = single(w);
    const L = H.living;
    if (H.kinds.has('creature') && L && L.species && L.species.get) {
      if (s === 'zombie') return { type: 'creature', name: 'Zombie', shape: { species: 'zombie', ...(a.size ? { size: num(a.size, 1) } : {}), ...(a.temper ? { temper: a.temper } : {}) }, physics: 'dynamic' };
      if (L.species.get(s) && !H.kinds.has(s)) return { type: 'creature', name: s.charAt(0).toUpperCase() + s.slice(1), shape: { species: s, ...(a.size ? { size: num(a.size, 1) } : {}), ...(a.temper ? { temper: a.temper } : {}), ...(a.follow ? { follow: a.follow } : {}) }, physics: 'dynamic' };
    }
    return String(what);
  }
  defineAction('spawn', {
    scope: () => (H.mayhem && H.mayhem.spawnMany ? 'host' : 'all'),
    at: ['at'],
    run(a, ctx) {
      const count = Math.max(1, Math.min(400, Math.floor(num(a.count, 1))));
      const rand = seeded(ctx);
      let at = a.at !== undefined ? posOf(a.at, ctx, rand) : posOf('player', ctx, rand);
      if (!at) { log(`spawn: no "${a.at}" in the world`); return; }
      if (a.at === undefined || lower(a.at) === 'player') { const p = playerEntity(ctx.who); if (p && a.ahead !== false) { const f = p.forward; at = [at[0] + f.x * num(a.ahead, 6), at[1], at[2] + f.z * num(a.ahead, 6)]; } }
      const tag = a.tag || a.as || null;
      const data = { ...(a.data || {}), ...(tag ? { tag } : {}), events: true };
      const spec = spawnSpec(a.spawn, a);
      if (H.mayhem && H.mayhem.spawnMany) {
        H.mayhem.spawnMany(spec, count, { at, area: a.area ?? (count > 1 ? Math.min(30, 2 + Math.sqrt(count) * 2) : 0.01), pattern: a.pattern || 'scatter', height: a.height, size: a.size, data, effects: a.effects !== false });
        return;
      }
      // Without Mayhem: everyone makes the same things from the same seed.
      const base = typeof spec === 'string' ? { type: H.kinds.has(spec) ? spec : 'box', name: spec, physics: 'dynamic', shape: { size: 0.8 } } : spec;
      for (let i = 0; i < count; i++) {
        const s = clone(base);
        const ang = rand() * Math.PI * 2, d = Math.sqrt(rand()) * num(a.area, count > 1 ? 4 : 0);
        const x = at[0] + Math.sin(ang) * d, z = at[2] + Math.cos(ang) * d;
        const y = a.pattern === 'rain' ? at[1] + num(a.height, 20) : groundY(x, z, at[1] + 10) + 0.8;
        s.id = `ev${ctx.seed}~${i}`;
        s.transform = { position: [r2(x), r2(y), r2(z)], rotation: [0, Math.round(rand() * 360), 0] };
        s.data = { ...(s.data || {}), ...data };
        try { const e = H.fromSpec(s); e.temporary = true; } catch (err) { report(err, 'events spawn'); break; }
      }
    },
  });
  function burstAt(p, color = '#c8f0ff', count = 14) { try { G().burst(p, { color, count, speed: 3, size: 0.25 }); } catch { /* no particles */ } }
  defineAction('remove', {
    scope: 'all',
    run(a, ctx) {
      let list = things(a.remove, ctx).filter((e) => !e.isPlayer);
      if (a.count !== undefined) list = list.slice(0, Math.max(0, num(a.count, 1)));
      for (const e of list) { if (a.effects !== false) burstAt([e.x, e.y, e.z], a.color || '#dddddd', 10); e.destroy(); }
    },
  });
  defineAction('move', {
    scope: 'all',
    at: ['to'],
    run(a, ctx) {
      for (const e of things(a.move, ctx)) {
        const from = [e.x, e.y, e.z];
        const to = a.by ? [from[0] + num(a.by[0], 0), from[1] + num(a.by[1], 0), from[2] + num(a.by[2], 0)] : posOf(a.to, ctx);
        if (!to) continue;
        const secs = num(a.seconds, 0);
        if (secs > 0) S.tweens.push({ e, from, to, t: 0, dur: secs });
        else { e.position = to; if (e.physics === 'dynamic') e.velocity = [0, 0, 0]; }
      }
    },
  });
  defineAction('teleport', {
    scope: (a) => (lower(a.teleport) === 'player' || a.teleport === true ? 'player' : lower(a.teleport) === 'players' || lower(a.teleport) === 'everyone' ? 'all' : 'all'),
    at: [],
    run(a, ctx) {
      const t = a.teleport === true ? 'player' : a.teleport;
      const list = lower(t) === 'player' || lower(t) === 'players' || lower(t) === 'everyone' ? [W().player].filter(Boolean) : things(t, ctx);
      const to = posOf(a.to, { ...ctx, who: meWho() });
      if (!to) return;
      for (const e of list) {
        const lift = e.isPlayer ? 1 : 0;
        e.position = [to[0], to[1] + lift, to[2]];
        e.velocity = [0, 0, 0];
        burstAt([to[0], to[1] + 1, to[2]], '#b9a6ff', 16);
      }
    },
  });
  const PROPS = ['position', 'rotation', 'scale', 'color', 'emissive', 'opacity', 'visible', 'physics', 'tag', 'name', 'velocity', 'gravity', 'mass', 'bounce', 'friction', 'upright'];
  defineAction('set', {
    scope: 'all',
    run(a, ctx) {
      for (const e of things(a.set, ctx)) {
        for (const k of PROPS) if (k in a) {
          try {
            if (k === 'position') { const p = posOf(a.position, ctx); if (p) e.position = p; }
            else e[k] = clone(a[k]);
          } catch (err) { report(err, 'events set'); }
        }
        if (a.data && typeof a.data === 'object') Object.assign(e.data, clone(a.data));
        if (a.text !== undefined && e.kind === 'text' && e.setText) e.setText(String(a.text));
        if (a.behaviors) { try { H.lib.attachBehaviors(e, arr(a.behaviors)); } catch (err) { report(err, 'events set'); } }
      }
    },
  });
  defineAction('behavior', {
    scope: 'all',
    run(a, ctx) {
      const b = { ...a };
      delete b.behavior; delete b._seed;
      if (!b.use) return;
      for (const e of things(a.behavior, ctx)) { try { H.lib.attachBehaviors(e, [b]); } catch (err) { report(err, 'events behavior'); } }
    },
  });
  // Hits.
  defineAction('explode', {
    scope: 'host',
    run(a, ctx) {
      const at = posOf(a.explode === true ? a.at ?? 'player' : a.explode, ctx);
      if (!at) return;
      const o = { radius: num(a.radius, 6), force: num(a.force, 20), damage: num(a.damage, 40), fire: Boolean(a.fire) };
      if (H.mayhem && H.mayhem.explode) H.mayhem.explode(at, { by: 'world', ...o }); // (a world-made blast: no one's score)
      else { if (H.sync && H.sync.explode) H.sync.explode(at, { radius: o.radius, force: o.force }); if (H.physics && H.physics.explode) H.physics.explode(at, { radius: o.radius, damage: o.damage, force: 0 }); perform({ burst: at, color: '#ffb347', count: 40 }, ctx); }
    },
  });
  const playerTarget = (t) => t === undefined || t === true || ['player', 'me', 'players', 'everyone'].includes(lower(t));
  defineAction('damage', {
    scope: (a) => (playerTarget(a.damage) ? (['players', 'everyone'].includes(lower(a.damage)) ? 'all' : 'player') : 'host'),
    run(a, ctx) {
      const n = num(a.amount, 20);
      if (playerTarget(a.damage)) { const g = G(); if (g && W().player) g.hurt(n); return; }
      for (const e of things(a.damage, ctx)) G().damage(e, n, null);
    },
  });
  defineAction('heal', {
    scope: (a) => (playerTarget(a.heal) ? (['players', 'everyone'].includes(lower(a.heal)) ? 'all' : 'player') : 'all'),
    run(a, ctx) {
      const n = num(a.amount, 100);
      const list = playerTarget(a.heal) ? [W().player].filter(Boolean) : things(a.heal, ctx);
      for (const e of list) { if (typeof e.health === 'number') e.health = Math.min(num(a.max, 100), e.health + n); else if (typeof e.hp === 'number') e.hp += n; burstAt([e.x, e.y + 1, e.z], '#7dffa0', 14); }
    },
  });
  defineAction('ignite', { scope: 'host', run(a, ctx) { if (!H.mayhem || !H.mayhem.ignite) return; for (const e of things(a.ignite, ctx)) H.mayhem.ignite(e, { seconds: a.seconds }); } });
  // Messages and sound.
  defineAction('message', { scope: toPlayer, text: ['message'], run(a) { const g = G(); if (g) g.ui.message(String(a.message), num(a.seconds, 2.5)); if (a.sound) playSound(a.sound); } });
  defineAction('banner', { scope: toPlayer, text: ['banner', 'sub'], run(a) { banner(a.banner, a.sub, num(a.seconds, 3), a.style || ''); if (a.sound) playSound(a.sound); } });
  defineAction('countdown', {
    scope: toPlayer, text: ['then'],
    run(a) {
      const g = G(), p = W().player;
      let n = Math.max(1, Math.floor(num(a.countdown, 3)));
      const freeze = a.freeze !== false && p;
      if (freeze) p.controls = false;
      const show = () => { bigNumber(n); playSound('beep'); };
      show();
      const next = () => {
        n--;
        if (n > 0) { show(); g.after(1, next); return; }
        bigNumber(a.then || 'GO!'); tone([[1320, 0, 0.4, 'square']], { volume: 0.07 });
        if (freeze && W().player) W().player.controls = true;
      };
      g.after(1, next);
    },
  });
  defineAction('timer', {
    scope: 'all', text: ['timer', 'label'],
    run(a) {
      const label = typeof a.timer === 'string' ? a.timer : a.label || '';
      S.timers = S.timers.filter((t) => t.label !== label);
      if (a.seconds === 0 || a.timer === false) return;
      S.timers.push({ label, end: now() + Math.max(1, num(a.seconds, 60)) });
    },
  });
  defineAction('hud', {
    scope: 'all', text: ['label'],
    run(a) {
      if (a.hud === false || a.hud === null) { S.hud = []; return; }
      S.hud = S.hud.filter((h) => h.var !== a.hud);
      if (a.remove) return;
      S.hud.push({ var: String(a.hud), label: a.label || null, per: a.per || null, of: a.of });
    },
  });
  defineAction('leaderboard', {
    scope: 'all', text: ['title'],
    run(a) {
      S.boards = S.boards.filter((b) => b.var !== a.leaderboard);
      if (a.remove || a.leaderboard === false) return;
      S.boards.push({ var: String(a.leaderboard), title: a.title || null, top: num(a.top, 5) });
      if (!S.decl[a.leaderboard]) S.decl[a.leaderboard] = { value: 0, per: 'player' };
    },
  });
  defineAction('sound', { scope: toPlayer, run(a) { playSound(a.sound === true ? 'chime' : a.sound, a); } });
  defineAction('music', { scope: 'all', run(a) { const g = G(); if (!a.music) { g.stopMusic(); return; } const n = String(a.music); const asset = ASSET_EXT.map((x) => n + x).find((x) => g.hasAsset(x)); if (asset) g.music(asset, { volume: num(a.volume, 0.5) }); } });
  defineAction('say', {
    scope: 'all', text: ['say'],
    run(a, ctx) {
      const who = a.by ?? a.thing ?? a.who;
      const list = who === undefined ? [W().player] : things(who, ctx);
      const e = list[0];
      if (e) e.say(String(a.say), num(a.seconds, Math.min(8, 2.5 + String(a.say).length / 18)));
    },
  });
  defineAction('shake', { scope: 'all', run(a) { try { G().camera.shake(num(a.shake === true ? 0.5 : a.shake, 0.5), num(a.seconds, 0.6)); } catch { /* no camera */ } } });
  defineAction('burst', { scope: 'all', at: ['burst', 'at'], run(a, ctx) { const p = posOf(a.burst === true ? a.at : a.burst, ctx); if (p) G().burst([p[0], p[1] + 0.5, p[2]], { color: a.color || '#ffd84a', count: num(a.count, 30), speed: num(a.speed, 4), size: num(a.size, 0.25) }); } });
  // The world.
  defineAction('weather', {
    scope: 'all',
    run(a) {
      const v = a.weather === 'clear' || a.weather === false || a.weather === null ? null : a.weather;
      if (!H.features.get('weather')) { log('weather needs the Water module'); return; }
      setFeature('weather', v);
      const name = v === null ? 'clear' : weatherName(typeof v === 'string' ? v : v);
      weatherSeen(typeof v === 'string' ? lower(v) : name);
    },
  });
  defineAction('sky', { scope: 'all', run(a) { try { G().sky(a.sky); } catch (err) { report(err, 'events sky'); } } });
  defineAction('time', {
    scope: 'all',
    run(a) {
      const v = typeof a.time === 'string' ? (TIMES[lower(a.time)] ?? Number(a.time)) : Number(a.time);
      if (a.time === false) { if (S.clock) S.clock.run = false; return; }
      ensureClock({ ...(a.day ? { day: a.day } : {}), ...(a.minutes ? { minutes: a.minutes } : {}) });
      if (Number.isFinite(v)) setHour(v);
      if (a.run !== undefined) S.clock.run = a.run !== false;
    },
  });
  defineAction('dark', { scope: 'all', run(a) { setDark(a.dark === true ? 0.8 : num(a.dark, 0), num(a.fade, 2), a.seconds ? num(a.seconds, 0) : null); } });
  defineAction('fog', {
    scope: 'all',
    run(a) {
      const sc = W().scene;
      if (!a.fog) { sc.fogMode = B.Scene.FOGMODE_NONE; return; }
      const f = typeof a.fog === 'object' ? a.fog : {};
      sc.fogMode = B.Scene.FOGMODE_LINEAR;
      sc.fogColor = B.Color3.FromHexString(f.color || a.color || '#c9d3dc');
      sc.fogStart = num(f.start ?? a.start, 8); sc.fogEnd = num(f.end ?? a.end, 60);
    },
  });
  defineAction('water', {
    scope: 'all',
    run(a) {
      const Wt = H.water;
      if (!Wt || !Wt.rise) { log('raising water needs the Water module'); return; }
      const level = num(a.water === true ? a.level : a.water, 2);
      if (!Wt.sea && H.features.get('water')) setFeature('water', { level: num(a.from, -4), waves: num(a.waves, 0.25) });
      Wt.rise(level, num(a.seconds, 10));
    },
  });
  const terrainOp = (op) => ({
    scope: 'host', at: [op],
    run(a, ctx) {
      const T = H.terrain;
      if (!T || T.active === false || typeof T[op] !== 'function') { log(`${op} needs terrain (config.terrain)`); return; }
      const p = posOf(a[op] === true ? a.at ?? 'player' : a[op], ctx);
      if (!p) return;
      const r = num(a.radius, 6);
      if (op === 'dig' || op === 'crater') T[op](p[0], p[2], r, num(a.depth, 3), { share: true, pile: a.pile });
      else if (op === 'flatten') T.flatten(p[0], p[2], r, a.height === undefined ? undefined : num(a.height, 0), { share: true });
      else T[op](p[0], p[2], r, num(a.height ?? a.depth, 4), { share: true });
    },
  });
  for (const op of ['dig', 'raise', 'lower', 'flatten', 'crater']) defineAction(op, terrainOp(op));
  // The player.
  const isTool = (n) => Boolean(H.tools && H.tools.has(n)) || ['blaster', 'rifle', 'shotgun', 'launcher', 'rocket-launcher', 'grenade', 'sticky-bomb', 'spawn-gun', 'gravity-gun', 'lasso', 'flamethrower', 'matches', 'rod', 'fishing-rod', 'bucket', 'shovel', 'ball'].includes(lower(n));
  defineAction('give', {
    scope: (a) => (isTool(a.give) ? 'player' : 'host'),
    text: ['give'],
    run(a, ctx) {
      const n = String(a.give);
      if (isTool(n)) {
        const p = W().player;
        if (!p) return;
        const opts = a.options || {};
        if (H.mayhem && H.mayhem.giveTool) H.mayhem.giveTool(n, opts);
        else p.tool = Object.keys(opts).length ? { type: n, ...opts } : n;
        toast(a.say || `Got: ${n.replace(/-/g, ' ')}`);
        return;
      }
      const c = Math.max(1, Math.floor(num(a.count, 1)));
      addItem(ctx.who, n, c);
      perform({ _toast: a.say || `+${c} ${n}`, to: 'player' }, ctx);
      perform({ emit: 'item', data: { item: lower(n), count: c, total: S.inv[(ctx.who && ctx.who.id) || net.me] ? S.inv[(ctx.who && ctx.who.id) || net.me][lower(n)] || 0 : 0, by: ctx.who } }, ctx);
    },
  });
  defineAction('take', {
    scope: (a) => (isTool(a.take) && !a.count ? 'player' : 'host'),
    run(a, ctx) {
      const n = String(a.take);
      if (isTool(n) && !a.count) { const p = W().player; if (p && p.tool && lower(typeof p.tool === 'string' ? p.tool : p.tool.type) === lower(n)) p.tool = null; return; }
      addItem(ctx.who, n, -Math.max(1, Math.floor(num(a.count, 1))));
    },
  });
  // Living things.
  defineAction('friend', { scope: 'host', text: ['say'], run(a, ctx) { const L = H.living; if (!L || !L.act) return; for (const e of things(a.friend, ctx)) L.act(e, a.act || a.do || 'none', a.say || ''); } });
  defineAction('creatures', {
    scope: 'host',
    run(a, ctx) {
      const L = H.living;
      if (!L || !L.command) return;
      const t = a.target === undefined || lower(a.target) === 'player' ? (ctx.who && ctx.who.id !== net.me ? `net:${ctx.who.id}` : 'player') : a.target;
      for (const e of things(a.creatures, ctx)) if (e.living) L.command(e, a.do || 'follow', { target: t, seconds: a.seconds, at: a.at });
    },
  });
  // Game flow.
  function ending(text, cls, sound) {
    banner(text, null, 2.2, cls);
    playSound(sound);
    const g = G();
    g.after(1.6, () => { if (live()) g.over(text); });
  }
  defineAction('win', { scope: 'all', text: ['win'], run(a) { ending(typeof a.win === 'string' ? a.win : 'You win!', 'win', 'win'); } });
  defineAction('lose', { scope: 'all', text: ['lose'], run(a) { ending(typeof a.lose === 'string' ? a.lose : 'Game over', 'lose', 'lose'); } });
  defineAction('end', { scope: 'all', text: ['end'], run(a) { G().over(typeof a.end === 'string' ? a.end : 'The end'); } });
  defineAction('restart', { scope: 'all', run() { G().restart(); } });
  defineAction('run', { scope: 'host', run(a, ctx) { const r = S.byId.get(String(a.run)); if (r) { const was = r.enabled; r.enabled = true; fire(r, ctx); r.enabled = was; } } });
  defineAction('enable', { scope: 'host', run(a) { for (const id of arr(a.enable)) { const r = S.byId.get(String(id)); if (r) r.enabled = true; } } });
  defineAction('disable', { scope: 'host', run(a) { for (const id of arr(a.disable)) { const r = S.byId.get(String(id)); if (r) r.enabled = false; } } });
  defineAction('emit', { scope: 'all', run(a, ctx) { G().emit(String(a.emit), a.data === undefined ? { by: ctx.who } : clone(a.data)); } });
  defineAction('log', { scope: 'all', text: ['log'], run(a) { log(String(a.log)); } });

  // ------------------------------------------------------------------ every step
  H.hooks.step.push((dt) => {
    const s = live();
    if (!s) return;
    s.actionsThisStep = 0;
    const w = W();
    // The clock (the sky's: it runs it, and sends the host's to everyone); time rules fire as it crosses their hour.
    if (!s.clock && H.sky && H.sky.clock(false)) s.clock = H.sky.clock(false);
    if (s.clock && s.clock.run !== false && playing()) {
      const prev = s.lastHour ?? s.clock.hour;
      if (!H.sky) s.clock.hour = (s.clock.hour + dt * 24 / s.clock.day) % 24;
      if (net.host && active() && !s.clock.jumped) for (const r of [...s.rules]) for (const t of r.when) if (t.type === 'time' && crossed(prev, s.clock.hour, ((t.time % 24) + 24) % 24)) { trigger(r, { hour: t.time }, false); break; }
      s.clock.jumped = false;
    }
    s.lastHour = s.clock ? s.clock.hour : null;
    // The dark comes and goes.
    if (s.dark.until !== null && now() >= s.dark.until) { s.dark.to = 0; s.dark.until = null; }
    if (s.dark.v !== s.dark.to) { const d = s.dark.to - s.dark.v; s.dark.v += Math.sign(d) * Math.min(Math.abs(d), dt * s.dark.rate); }
    // Moving things.
    for (const tw of s.tweens) {
      tw.t += dt;
      const k = Math.min(1, tw.t / tw.dur), e2 = k * k * (3 - 2 * k);
      if (tw.e.alive) { tw.e.position = [tw.from[0] + (tw.to[0] - tw.from[0]) * e2, tw.from[1] + (tw.to[1] - tw.from[1]) * e2, tw.from[2] + (tw.to[2] - tw.from[2]) * e2]; if (tw.e.physics === 'dynamic') tw.e.velocity = [0, 0, 0]; }
      if (k >= 1) tw.done = true;
    }
    s.tweens = s.tweens.filter((tw) => !tw.done && tw.e.alive);
    // Disasters.
    for (const d of [...s.disasters]) { try { d.step(dt); } catch (err) { report(err, `events disaster ${d.name}`); d.stop(); } }
    if (!active()) return;
    // Running action lists (waits, repeats).
    for (const run of s.seqs) advance(run);
    s.seqs = s.seqs.filter((run) => !run.dead);
    // Timers (host).
    const t = w.time;
    if (net.host) {
      for (const r of [...s.rules]) {
        if (!r.enabled) continue;
        r.when.forEach((tr, i) => {
          const st = (r.st[i] = r.st[i] || {});
          if (tr.type === 'after') { if (!st.done && t >= num(tr.after, 1)) { st.done = true; fireEach(r, tr); } }
          else if (tr.type === 'every') {
            const every = Math.max(0.1, num(tr.every, 10));
            if (st.next === undefined) st.next = num(tr.from ?? tr.start, every);
            if (t >= st.next) { st.next += every; if (tr.until === undefined || t <= num(tr.until, Infinity)) fireEach(r, tr); }
          }
        });
      }
    }
    // Keys (this player's).
    const g = G();
    for (const r of s.rules) if (r.enabled) for (const tr of r.when) if (tr.type === 'key' && g.input.pressed(lower(tr.key))) { trigger(r, { key: tr.key }, true); break; }
    // This player's zones and touches, 10 times a second.
    if (t >= s.nextLocal) { s.nextLocal = t + 0.1; localChecks(); }
    // The host's polls (things in zones, counts, creatures), twice a second.
    if (net.host && t >= s.nextHost) { s.nextHost = t + 0.5; hostChecks(); }
    if (t >= s.nextRescan) { s.nextRescan = t + 1; rescan(); }
  });
  function fireEach(r, tr) {
    if (lower(tr.each) === 'player' || lower(tr.each) === 'players') { for (const p of playersAll()) fire(r, { who: { id: p.id, name: p.name }, data: null }); return; }
    fire(r, { who: meWho(), data: null });
  }
  function localChecks() {
    const p = W().player;
    if (!p || !p.alive) return;
    const pos = [p.x, p.y, p.z];
    for (const r of S.rules) {
      if (!r.enabled) continue;
      r.when.forEach((tr, i) => {
        if ((tr.type === 'enter' || tr.type === 'leave') && tr.what === undefined) {
          const key = `${r.id}#${i}`;
          const now2 = inside(pos, tr.enter ?? tr.leave, tr.near);
          const was = S.zones.get(key);
          S.zones.set(key, now2);
          if (was === undefined) return;
          if (tr.type === 'enter' && now2 && !was) trigger(r, { zone: tr.enter }, true);
          if (tr.type === 'leave' && !now2 && was) trigger(r, { zone: tr.leave }, true);
        } else if (tr.type === 'touch') {
          const key = `${r.id}#${i}`;
          const list = things(tr.touch);
          let hit = null;
          for (const e of list) if (e !== p && e.visible && p.overlaps(e, num(tr.pad, 0.3))) { hit = e; break; }
          const was = S.touching.get(key);
          S.touching.set(key, hit);
          if (hit && hit !== was) trigger(r, { entity: hit }, true);
        }
      });
    }
  }
  function hostChecks() {
    for (const r of [...S.rules]) {
      if (!r.enabled) continue;
      r.when.forEach((tr, i) => {
        const key = `${r.id}#${i}`;
        if ((tr.type === 'enter' || tr.type === 'leave') && tr.what !== undefined) {
          // Things (not players) going in or out of a zone: "when a sheep goes into the barn".
          const inNow = new Set(things(tr.what).filter((e) => inside([e.x, e.y, e.z], tr.enter ?? tr.leave, tr.near)));
          const before = S.inThings.get(key);
          S.inThings.set(key, inNow);
          if (!before) return;
          if (tr.type === 'enter') { for (const e of inNow) if (!before.has(e)) fire(r, { who: meWho(), data: { entity: e } }); }
          else for (const e of before) if (!inNow.has(e)) fire(r, { who: meWho(), data: { entity: e } });
        } else if (tr.type === 'count') {
          const n = things(tr.count).length;
          const was = S.seen.get(key);
          S.seen.set(key, n);
          if (was === undefined) return;
          if (crossing(was, n, tr)) fire(r, { who: meWho(), data: { count: n } });
        } else if (tr.type === 'creature') {
          const L = H.living;
          if (!L || !L.status) return;
          const states = S.seen.get(key) || new Map();
          for (const e of things(tr.creature)) {
            const st = (L.status(e) || {}).state;
            const was = states.get(e);
            states.set(e, st);
            const want = lower(tr.is || tr.state);
            if (was !== undefined && st !== was && (!want || lower(st) === want)) fire(r, { who: meWho(), data: { entity: e, state: st } });
          }
          S.seen.set(key, states);
        }
      });
    }
  }
  /** A number crossing a line: reaches / above / below / equals (or any change). */
  function crossing(was, v, tr) {
    const has = (k) => tr[k] !== undefined;
    if (has('reaches') || has('atLeast') || has('>=')) { const x = num(tr.reaches ?? tr.atLeast ?? tr['>='], 0); return Number(was) < x && Number(v) >= x; }
    if (has('above') || has('>')) { const x = num(tr.above ?? tr['>'], 0); return Number(was) <= x && Number(v) > x; }
    if (has('below') || has('<')) { const x = num(tr.below ?? tr['<'], 0); return Number(was) >= x && Number(v) < x; }
    if (has('equals') || has('is') || has('=')) { const x = tr.equals ?? tr.is ?? tr['=']; return lower(was) !== lower(x) && lower(v) === lower(x); }
    return was !== v;
  }
  function varChanged(name, old, value, who) {
    if (!active() || !net.host) return;
    for (const r of [...S.rules]) {
      if (!r.enabled) continue;
      for (const t of r.when) if (t.type === 'var' && t.var === name && crossing(old, value, t)) { fire(r, { who: who || meWho(), data: { var: name, value, old } }); break; }
    }
  }
  // Clicking things: their own click handlers, attached once.
  function rescan() {
    for (const r of S.rules) for (const tr of r.when) if (tr.type === 'click') {
      for (const e of things(tr.click)) {
        if (S.clicked.has(e) && S.clicked.get(e).has(r.id)) continue;
        if (!S.clicked.has(e)) S.clicked.set(e, new Set());
        S.clicked.get(e).add(r.id);
        const id = r.id;
        e.on('click', () => { const rr = live() && S.byId.get(id); if (rr && active()) trigger(rr, { entity: e }, true); });
      }
    }
  }
  // Destroyed things (the host).
  H.hooks.destroy.push((e) => {
    if (!active() || !net.host || e.isPlayer) return;
    for (const r of [...S.rules]) if (r.enabled) for (const t of r.when) if (t.type === 'destroyed' && matches(e, t.destroyed)) { fire(r, { who: meWho(), data: { entity: e } }); break; }
  });

  // ------------------------------------------------------------------ E near things: "use" triggers
  function useOffer(p) {
    if (!active() || !p) return null;
    const t = now();
    if (t - S.useAt > 0.25) {
      S.useAt = t;
      S.useCands = [];
      for (const r of S.rules) if (r.enabled) for (const tr of r.when) if (tr.type === 'use') for (const e of things(tr.use)) S.useCands.push({ r, tr, e });
    }
    let best = null;
    for (const c of S.useCands) {
      if (!c.e.alive || !c.r.enabled || (c.r.once && c.r.count) || c.r.count >= c.r.max || (c.r.cooldown && t - c.r.last < c.r.cooldown)) continue;
      const d = Math.max(0, Math.hypot(c.e.x - p.x, c.e.z - p.z) - Math.max(c.e.half[0], c.e.half[2]));
      if (d <= num(c.tr.reach, 2.5) && Math.abs(c.e.y - p.y) < 4 && (!best || d < best.d)) best = { ...c, d };
    }
    if (!best) return null;
    const label = fill(best.tr.label || `Use the ${(best.e.name || String(best.tr.use)).toLowerCase()}`, { who: meWho() });
    return { label, distance: best.d, priority: num(best.tr.priority, 0), act: () => trigger(best.r, { entity: best.e }, true) };
  }
  E.useOffer = useOffer;
  // The engine's "E near things" (H.use) when it has one; otherwise a small prompt of our own.
  const offers = []; // other parts of events (quests) add theirs: fn(player) -> offer
  E.offer = (fn) => offers.push(fn);
  function bestOffer(p) {
    let best = null;
    for (const f of [useOffer, ...offers]) { let o = null; try { o = f(p); } catch (err) { report(err); } if (o && (!best || (o.priority || 0) > (best.priority || 0) || ((o.priority || 0) === (best.priority || 0) && (o.distance ?? 99) < (best.distance ?? 99)))) best = o; }
    return best;
  }
  E.bestOffer = bestOffer;
  function installUse() {
    // (keys: T also does a quest giver's offer, as it talks to a friend.)
    if (H.use && typeof H.use.register === 'function') { H.use.register('events', { keys: ['t'], near: (p) => bestOffer(p) }); return true; }
    return false;
  }
  if (!installUse()) {
    // Temporary until the engine's H.use registry lands: E does our offer (only when nothing else on beta uses E nearby).
    let shown = '';
    H.hooks.step.push(() => {
      if (H.use || !active()) return;
      const p = W().player;
      const o = p && p.alive && p.controls !== false ? bestOffer(p) : null;
      if (o && G().input.pressed('e')) o.act();
    });
    H.hooks.frame.push(() => {
      if (H.use || !live()) return;
      const p = W().player;
      const o = active() && p && p.alive ? bestOffer(p) : null;
      const key = o ? o.label : '';
      if (key === shown && S.ui.prompt) return;
      shown = key;
      const box = el('prompt', 'ev-prompt');
      if (!box) return;
      box.textContent = '';
      if (!o) return;
      const b = document.createElement('button');
      b.innerHTML = '<kbd>E</kbd><span></span>';
      b.querySelector('span').textContent = o.label;
      b.onpointerdown = (ev) => { ev.preventDefault(); ev.stopPropagation(); const now2 = bestOffer(W().player); if (now2) now2.act(); };
      box.appendChild(b);
    });
  }

  // ------------------------------------------------------------------ the screen, a few times a second
  let hudAt = 0;
  H.hooks.frame.push(() => {
    const s = live();
    if (!s) return;
    applyLight();
    const t = now();
    if (s.bannerUntil && t > s.bannerUntil && s.ui.banner) { s.ui.banner.classList.remove('on'); s.bannerUntil = 0; }
    if (s.toastUntil && t > s.toastUntil && s.ui.toast) { s.ui.toast.style.opacity = '0'; s.toastUntil = 0; }
    s.timers = s.timers.filter((x) => x.end > t - 1);
    if (t - hudAt < 0.25 && t >= hudAt) return;
    hudAt = t;
    if (playing()) renderHud();
  });

  // ------------------------------------------------------------------ the shared state (variables, bags, the clock)
  if (H.sync && H.sync.state) {
    H.sync.state('events', {
      rate: 6,
      get: () => (live() ? { v: S.vars, p: S.pvars, i: S.inv, n: S.names, r: S.rules.filter((r) => !r.enabled).map((r) => r.id) } : null),
      set: (st) => {
        if (!live()) return;
        if (st.v) S.vars = st.v;
        if (st.p) S.pvars = st.p;
        if (st.i) S.inv = st.i;
        if (st.n) S.names = st.n;
        if (Array.isArray(st.r)) for (const r of S.rules) r.enabled = !st.r.includes(r.id);
      },
    });
  }

  // ------------------------------------------------------------------ config.events (a world feature)
  function loadConfig(value) {
    if (!S) return;
    for (const r of S.rules.filter((x) => x.source === 'config')) removeRule(r.id);
    if (!value || value === true) return;
    const v = Array.isArray(value) ? { rules: value } : value;
    if (v.vars && typeof v.vars === 'object') {
      for (const [k, d] of Object.entries(v.vars)) {
        const decl = d && typeof d === 'object' && !Array.isArray(d) ? { value: d.value ?? d.start ?? 0, per: d.per || d.scope || null } : { value: d, per: null };
        S.decl[k] = decl;
      }
    }
    if (v.clock !== undefined && v.clock !== false) ensureClock(v.clock === true ? {} : v.clock);
    if (v.hud) S.hud = arr(v.hud).map((h) => (typeof h === 'string' ? { var: h, label: h === 'clock' ? '' : h.charAt(0).toUpperCase() + h.slice(1) } : { var: String(h.var), label: h.label || null, per: h.per || null, of: h.of }));
    if (v.leaderboard) for (const b of arr(v.leaderboard)) { const bb = typeof b === 'string' ? { var: b } : b; S.boards.push({ var: String(bb.var), title: bb.title || null, top: num(bb.top, 5) }); if (!S.decl[bb.var]) S.decl[bb.var] = { value: 0, per: 'player' }; }
    for (const raw of arr(v.rules)) { try { addRule(raw, 'config'); } catch (err) { report(err, 'scene.json events'); } }
  }
  H.features.register('events', {
    apply(value, ctx) { setup(ctx.game, ctx.world); loadConfig(value); },
    change(value, old, ctx) { setup(ctx.game, ctx.world); loadConfig(value); },
    dispose() { if (live()) loadConfig(null); },
    codex: { title: 'Events', group: 'World', what: 'Rules: when something happens, if conditions hold, do actions (timers, zones, any event, disasters, quests).', value: { rules: [{ when: { every: 5 }, do: [{ message: 'Five more seconds went by' }] }] } },
  });

  // ------------------------------------------------------------------ zones: places rules watch
  H.kinds.register('zone', {
    physics: 'none',
    maker: true,
    build(shape, o) {
      const r = num(shape.radius, 0);
      const h = num(shape.height, 4);
      const size = r ? [r * 2, h, r * 2] : H.lib.size3(shape.size ?? [6, 4, 6], 6);
      const sc = H.world.scene;
      const e = H.lib.shape('zone', () => (r ? B.MeshBuilder.CreateCylinder('zone', { diameter: r * 2, height: h, tessellation: 40 }, sc) : B.MeshBuilder.CreateBox('zone', { width: size[0], height: size[1], depth: size[2] }, sc)), { ...o, physics: 'none', color: o.color || shape.color || '#ffd84a', opacity: o.opacity ?? (shape.show ? 0.22 : 0.16), shadow: false });
      e.data.zone = { radius: r || null, show: Boolean(shape.show) };
      if (H.mode !== 'build') { if (shape.show) { e.node.isPickable = false; } else e.visible = false; }
      return e;
    },
    editor: {
      word: 'a zone',
      lift: (spec) => num(spec.shape && spec.shape.height, num(spec.shape && Array.isArray(spec.shape.size) ? spec.shape.size[1] : spec.shape && spec.shape.size, 4)) / 2,
      motion: [],
      hotbar: [{ order: 960, icon: '▢', label: 'Zone', make: () => ({ type: 'zone', name: 'Zone', shape: { size: [6, 4, 6] } }) }],
    },
    codex: {
      group: 'Events',
      what: 'An invisible area rules watch: players (or things) entering or leaving it, standing in it ("king of the hill"). Visible while building; shape.show keeps it visible while playing.',
      spec: { type: 'zone', name: 'Hill', shape: { radius: 4, height: 3, show: true }, transform: { position: [0, 1.5, 6] } },
      fields: [['shape.size', '[w, h, d] meters (a box)', '[6, 4, 6]'], ['shape.radius', 'meters (a round zone instead)', ''], ['shape.height', 'meters (round zones)', '4'], ['shape.show', 'true: players see it (a glowing area)', 'false'], ['material.color', 'its color', '#ffd84a']],
    },
  });

  // ------------------------------------------------------------------ game.events (scripts) and HawkesPlay.events (modules)
  function api() {
    const need = () => { if (!live()) throw new Error('game.events: the game is not running'); return S; };
    return {
      /** Adds a rule ({ id, when, if, do }) or a list of them; returns the id. */
      add: (rule) => (Array.isArray(rule) ? rule.map((x) => addRule(x, 'script')) : addRule(rule, 'script')),
      remove: (id) => removeRule(id),
      get: (id) => { const r = need().byId.get(String(id)); return r ? { id: r.id, enabled: r.enabled, count: r.count, rule: r.raw } : null; },
      list: () => need().rules.map((r) => ({ id: r.id, enabled: r.enabled, count: r.count, source: r.source })),
      enable: (id, on = true) => { const r = need().byId.get(String(id)); if (r) r.enabled = Boolean(on); return Boolean(r); },
      disable: (id) => { const r = need().byId.get(String(id)); if (r) r.enabled = false; return Boolean(r); },
      /** Runs a rule now (its conditions too), as if it had triggered. Host only (the others ignore it). */
      run: (id, data) => { const r = need().byId.get(String(id)); return r && net.host ? fire(r, { who: meWho(), data: data || null }) : false; },
      /** Runs actions now (host only: scripts run on every machine, the host does it once for everyone). */
      do: (actions, o = {}) => { need(); if (!net.host) return null; runSeq(arr(actions), { who: o.who || meWho(), data: o.data || null }); return true; },
      /** A variable: value(name), value(name, playerId) for a per-player one. */
      value: (name, player) => getVar(String(name), player ? { id: player } : meWho(), player ? { per: 'player', player } : undefined),
      set: (name, value, o = {}) => { if (net.host) setVar(String(name), value, o.player ? { id: o.player, name: o.name } : meWho(), o); },
      change: (name, by = 1, o = {}) => { if (net.host) setVar(String(name), (Number(getVar(String(name), o.player ? { id: o.player } : meWho(), o)) || 0) + Number(by), o.player ? { id: o.player } : meWho(), o); },
      declare: (name, value = 0, per = null) => { need().decl[String(name)] = { value, per }; },
      get vars() { return live() ? { ...S.vars } : {}; },
      standings: (name) => standings(String(name)),
      /** Items: has(item), items() this player's bag. */
      has: (item, n = 1) => hasItem(meWho(), item, n),
      items: (player) => (live() ? { ...(S.inv[player || net.me] || {}) } : {}),
      give: (item, count = 1) => { if (net.host) perform({ give: item, count }, { who: meWho() }); },
      /** New actions and conditions, by name: action('confetti', (a, ctx) => {...}, { scope: 'all' }). */
      action: (name, fn, o = {}) => defineAction(name, { scope: o.scope || 'all', text: o.text || [], at: o.at || [], run: fn }),
      condition: (name, fn) => defineCondition(name, (c, ctx) => fn(c, ctx)),
      /** The time of day (hours, 0-24) when the world has a clock. */
      get hour() { return live() && S.clock ? S.clock.hour : null; },
      set hour(h) { if (live()) setHour(h); },
      get clock() { return live() && S.clock ? { hour: S.clock.hour, day: S.clock.day, text: clockText() } : null; },
      dark: (v, fade, seconds) => { if (live()) setDark(v, fade, seconds); },
      disaster: (name, o) => (E.disaster ? E.disaster(name, o) : null),
      stop: (name) => (E.stopDisaster ? E.stopDisaster(name) : 0),
      get disasters() { return live() ? S.disasters.map((d) => d.name) : []; },
      get history() { return live() ? S.history.slice() : []; },
      emit: (name, data) => G().emit(name, data),
      on: (name, fn) => G().on(name, fn),
      banner: (title, sub, seconds) => banner(title, sub, seconds),
      sound: (name) => playSound(name),
    };
  }
  function setup(g, w) {
    if (!g || typeof g !== 'object') return;
    if (S && S.g === g) return;
    if (S && S.w !== w) teardown();
    S = fresh(g, w || W());
    try { Object.defineProperty(g, 'events', { value: api(), enumerable: true, configurable: true }); } catch { /* frozen */ }
    for (const f of E.setupHooks) try { f(g, S); } catch (err) { report(err); }
  }
  E.setupHooks = E.setupHooks || [];
  function teardown() {
    if (!S) return;
    S.leaving = true;
    for (const d of [...S.disasters]) { try { d.stop(true); } catch { /* gone with the world */ } }
    S.disasters = [];
    clearUi();
    for (const f of E.teardownHooks) try { f(S); } catch (err) { report(err); }
  }
  E.teardownHooks = E.teardownHooks || [];
  // game.events exists for every game, before its scripts run (H.hooks.game).
  H.hooks.game.push(setup);
  H.hooks.world.push({
    enter() {
      if (!S || S.w !== W()) setup(G(), W());
      S.started = true;
      if (!playing() || !net.host) return;
      for (const r of [...S.rules]) for (const t of r.when) if (t.type === 'start') { fire(r, { who: meWho(), data: null }); break; }
    },
    leave() { teardown(); },
  });

  // For disasters.js, quests.js and other modules.
  // (Descriptors, not Object.assign: the getters must stay getters.)
  Object.defineProperties(E, Object.getOwnPropertyDescriptors({
    get state() { return live(); },
    get net() { return net; },
    active, playing, live, things, matches, posOf, inside, playersAll, playerEntity, groundY, rng, fill, check, perform, runSeq, fire, trigger, addRule, removeRule,
    getVar, setVar, standings, hasItem, addItem, setFeature, setDark, banner, toast, bigNumber, tone, el, css, syncAction, slim, meWho, myName, report, num, lower, arr, single, clone, wordsOf,
    get rules() { return live() ? S.rules : []; },
    api,
  }));
})();
