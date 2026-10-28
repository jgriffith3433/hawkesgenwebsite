// Smarter characters (J, 2026-10-27: "players can literally do anything"): people who say things and let you answer,
// belong to sides that like or hate you (and each other), and live a day. Abilities any thing stacks:
//   `talk`     E talks: a line and answers to pick; an answer can lead on, give or take an item, set a signal, send an
//              event, change how a side feels about you, or end. Trees are data ({ start, nodes }), or just `lines`.
//   `faction`  belongs to a side (config.factions): a side that hates you comes for you (or for its enemies), a side that
//              likes you fights beside you. Hurting one of them makes the whole side like you less.
//   `routine`  lives a day: hunger and tiredness rise; it goes to eat, to sleep at night, to work by day, and wanders
//              between (to things named for each), with a sign over its head of what it's doing.
// Online the host runs them; your standing with each side is shared. Docs: WORLD.md "Characters".
/* global HawkesPlay, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = BABYLON;
  const W = () => H.world;
  const G = () => H.game;
  const num = (v, d) => (Number.isFinite(Number(v)) && v !== '' && v !== null ? Number(v) : d);
  const lower = (s) => String(s || '').trim().toLowerCase();
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const online = () => Boolean(H.sync && H.sync.online);
  const host = () => !online() || H.sync.isHost;
  const rep = {}; // side -> how it feels about the player(s): -100 hates .. 100 loves

  // ------------------------------------------------------------------ sides
  const factions = () => { const c = W() && W().graph && W().graph.config && W().graph.config.factions; return c && typeof c === 'object' ? c : {}; };
  /** How side `a` feels about `b` ('player' for the player): 'hostile', 'friendly' or 'neutral'. */
  function attitude(a, b) {
    if (!a || !b || a === b) return 'friendly';
    if (b === 'player') {
      const r = standing(a);
      return r <= -30 ? 'hostile' : r >= 30 ? 'friendly' : 'neutral';
    }
    const f = factions()[a] || {}, g = factions()[b] || {};
    const say = (x, y) => lower((x.hates || []).includes(y) ? 'hostile' : (x.likes || []).includes(y) ? 'friendly' : x[y] || '');
    const v = say(f, b) || say(g, a);
    return v === 'hostile' || v === 'friendly' ? v : 'neutral';
  }
  function standing(side) {
    if (rep[side] === undefined) {
      const f = factions()[side] || {}, p = lower(f.player);
      rep[side] = p === 'hostile' ? -60 : p === 'friendly' ? 60 : num(f.standing, 0);
    }
    return rep[side];
  }
  const repAct = H.sync && H.sync.action ? H.sync.action('chars:rep', (d, o) => { if (o.authoritative && d) changeRep(d.side, d.by, true); }) : null;
  function changeRep(side, by, here) {
    if (!side) return;
    if (!here && repAct) { repAct({ side, by }); return; }
    const was = attitude(side, 'player');
    rep[side] = clamp(standing(side) + num(by, 0), -100, 100);
    const now = attitude(side, 'player');
    if (now !== was) { G().emit('standing', { side, standing: rep[side], attitude: now }); G().ui.message(`The ${side} ${now === 'hostile' ? 'are against you now' : now === 'friendly' ? 'are on your side now' : 'are wary of you'}`, 2.4); }
  }
  if (H.sync && H.sync.state) H.sync.state('chars', { rate: 1, get: () => ({ r: rep }), set: (s) => { if (s && s.r && !host()) Object.assign(rep, s.r); } });

  // ------------------------------------------------------------------ talking
  function treeOf(o, e) {
    if (o.tree && typeof o.tree === 'object' && o.tree.nodes) return o.tree;
    const lines = Array.isArray(o.lines) ? o.lines : String(o.lines || o.say || '').split('|').map((x) => x.trim()).filter(Boolean);
    const nodes = {};
    (lines.length ? lines : [`${e.name || 'They'} nods at you.`]).forEach((l, i, a) => { nodes[`l${i}`] = { say: l, choices: i < a.length - 1 ? [{ text: 'Go on', go: `l${i + 1}` }] : [{ text: 'Bye', end: true }] }; });
    return { start: 'l0', nodes };
  }
  const talking = { e: null, node: null, menu: null };
  function talk(e, nodeId) {
    const s = e._talk, tree = s.tree, n = tree.nodes[nodeId || tree.start];
    if (!n) return end();
    const g = G(), p = W().player;
    talking.e = e; talking.node = nodeId;
    if (p) p.controls = false;
    if (n.do) perform(n.do, e);
    const choices = (Array.isArray(n.choices) ? n.choices : [{ text: 'Bye', end: true }]).filter((c) => !c.need || (H.items && H.items.has(c.need)) || (c.standing !== undefined && s.side && standing(s.side) >= num(c.standing, 0)));
    talking.menu = g.ui.menu('chars-talk', {
      title: e.name || 'Someone', text: String(n.say || ''), pause: false, closable: true, class: 'chars-talk',
      items: choices.map((c) => ({ label: String(c.text || '…'), onClick: () => { setTimeout(() => choose(e, c), 0); } })),
    });
    g.emit('talk', { thing: e, node: nodeId || tree.start, say: n.say });
    s.met = true;
  }
  function choose(e, c) {
    perform(c, e);
    if (c.end || !c.go) end(); else talk(e, c.go);
  }
  function perform(c, e) {
    const g = G();
    if (c.give && H.items) H.items.give(c.give, num(c.count, 1));
    if (c.take && H.items) H.items.take(c.take, num(c.count, 1));
    if (c.signal && H.signals) H.signals.set(String(c.signal), c.on !== false);
    if (c.emit) g.emit(String(c.emit), { thing: e });
    if (c.standing && e._talk.side) changeRep(e._talk.side, num(c.standing, 0));
    if (c.follow && e._routine) e._routine.s.follow = true;
  }
  function end() {
    const p = W() && W().player;
    if (p) p.controls = true;
    if (talking.menu) talking.menu.close();
    if (talking.e) G().emit('talked', { thing: talking.e });
    talking.e = null; talking.menu = null;
  }
  H.behavior('talk', {
    title: 'Talks with you', group: 'Characters', icon: '💬',
    says: (o) => (o.tree ? 'talks with you (answers to choose)' : `says "${String(o.lines || o.say || '').split('|')[0].slice(0, 40)}"`),
    defaults: { lines: '', side: '' },
    settings: [{ key: 'lines', label: 'Lines (| between them)', type: 'text' }, { key: 'side', label: 'Side', type: 'text' }],
    start(e, o) { e._talk = { tree: treeOf(o, e), side: lower(o.side || (e.data && e.data.faction) || ''), met: false }; },
    update(e, dt, o) { if (o.tree && e._talk.tree !== o.tree && o.tree.nodes) e._talk.tree = o.tree; },
  });
  if (H.use && H.use.register) H.use.register('talk', {
    build: false,
    near(p) {
      if (talking.e) return null;
      let best = null, bd = 3;
      for (const e of W().entities) {
        if (!e.alive || !e._talk || e.dead) continue;
        if (e._fac && attitude(e._fac.side, 'player') === 'hostile') continue;
        const d = Math.hypot(e.x - p.x, e.z - p.z) - Math.max(e.half[0], e.half[2]);
        if (d < bd) { best = e; bd = d; }
      }
      return best ? { label: `Talk to ${best.name || 'them'}`, act: () => talk(best), priority: 7 } : null;
    },
  });

  // ------------------------------------------------------------------ moving like a person
  function walkTo(e, to, speed) {
    const dx = to[0] - e.x, dz = to[2] - e.z, d = Math.hypot(dx, dz);
    if (d < 0.6) { stand(e); return d; }
    const k = Math.min(1, d);
    if (e.physics === 'dynamic') e.walk({ x: dx / d * k, z: dz / d * k }, speed);
    else { const st = Math.min(d, speed * W().dt); e.position = [e.x + dx / d * st, e.y, e.z + dz / d * st]; e.node.rotation.y = Math.atan2(dx, dz); }
    return d;
  }
  function stand(e) { if (e.physics === 'dynamic') e.walk({ x: 0, z: 0 }, 0); }
  function place(word, e) {
    if (!word) return null;
    if (Array.isArray(word)) return word.map(Number);
    const low = lower(word);
    let best = null, bd = Infinity;
    for (const x of W().entities) {
      if (!x.alive || x === e || !(lower(x.name) === low || lower(x.tag) === low || (x.data && lower(x.data.place) === low))) continue;
      const d = Math.hypot(x.x - e.x, x.z - e.z);
      if (d < bd) { best = x; bd = d; }
    }
    return best ? [best.x, best.y, best.z] : null;
  }

  // ------------------------------------------------------------------ sides that fight
  function foeFor(e, side, sight) {
    let best = null, bd = sight;
    const p = W().player;
    if (p && p.alive && attitude(side, 'player') === 'hostile') { const d = Math.hypot(p.x - e.x, p.z - e.z); if (d < bd) { best = p; bd = d; } }
    for (const o of W().entities) {
      if (o === e || !o.alive || o.dead || !o._fac) continue;
      if (attitude(side, o._fac.side) !== 'hostile') continue;
      const d = Math.hypot(o.x - e.x, o.z - e.z);
      if (d < bd) { best = o; bd = d; }
    }
    // A side that likes you goes for whatever is hurting you.
    if (!best && p && attitude(side, 'player') === 'friendly' && W().time - (p._hurtAt || -99) < 5 && p._hurtBy && p._hurtBy.alive) best = p._hurtBy;
    return best;
  }
  H.behavior('faction', {
    title: 'On a side', group: 'Characters', icon: '🚩',
    says: (o) => `one of the ${o.side}${o.fights ? ', fights' : ''}`,
    defaults: { side: 'villagers', fights: true, hp: 80, damage: 10, range: 1.8, rate: 1, speed: 3.6, sight: 18, shoots: false },
    settings: [{ key: 'side', label: 'Side', type: 'text' }, { key: 'fights', label: 'Fights', type: 'bool' }, { key: 'hp', label: 'Health', type: 'number', min: 1, max: 2000 }, { key: 'damage', label: 'Damage', type: 'number', min: 0, max: 200 }, { key: 'shoots', label: 'Shoots (from range)', type: 'bool' }, { key: 'range', label: 'Range', type: 'number', min: 1, max: 40, unit: 'm' }, { key: 'speed', label: 'Speed', type: 'number', min: 0.5, max: 12, unit: 'm/s' }],
    start(e, o, s) {
      e._fac = { side: lower(o.side || 'villagers') };
      e.data.faction = e._fac.side;
      if (e.hp === undefined) e.maxHp = e.hp = num(o.hp, 80);
      if (e._talk && !e._talk.side) e._talk.side = e._fac.side;
      s.cool = Math.random(); s.look = 0;
    },
    update(e, dt, o, s, g) {
      if (e.remote || e.dead || g.mode === 'build' || o.fights === false || !host()) return;
      s.cool -= dt; s.look -= dt;
      if (s.look <= 0) { s.look = 0.3; s.foe = foeFor(e, e._fac.side, num(o.sight, 18)); }
      const f = s.foe;
      if (!f || !f.alive || f.dead) { s.fighting = false; return; }
      s.fighting = true;
      const range = o.shoots ? Math.max(6, num(o.range, 12)) : num(o.range, 1.8);
      const d = Math.hypot(f.x - e.x, f.z - e.z) - Math.max(f.half[0], f.half[2]);
      if (d > range) walkTo(e, [f.x, f.y, f.z], num(o.speed, 3.6));
      else {
        stand(e); e.lookAt([f.x, e.y, f.z]);
        if (s.cool <= 0) {
          s.cool = num(o.rate, 1);
          if (o.shoots) { const a = new B.Vector3(e.x, e.y + 0.4, e.z), b = new B.Vector3(f.x, f.y + 0.3, f.z); const l = B.MeshBuilder.CreateLines('shot', { points: [a, b] }, W().scene); l.color = new B.Color3(1, 0.8, 0.3); setTimeout(() => l.dispose(), 80); }
          g.damage(f, num(o.damage, 10), e);
        }
      }
    },
  });
  // Hurting one of a side: the whole side likes you less (more if it dies).
  H.hooks.world.push({
    enter() {
      for (const k of Object.keys(rep)) delete rep[k];
      const g = G();
      if (!g) return;
      g.on('hurt', (d) => {
        const t = d && d.entity, by = d && d.from;
        if (t === W().player && by && by.__entity) { W().player._hurtAt = W().time; W().player._hurtBy = by; }
        if (t && t._fac && by === W().player) changeRep(t._fac.side, -8);
      });
      g.on('death', (d) => { const t = d && d.entity; if (t && t._fac && d.by === W().player) changeRep(t._fac.side, -25); });
    },
  });

  // ------------------------------------------------------------------ a day
  const SIGN = { eat: '🍞', sleep: '💤', work: '🔨', wander: '', home: '🏠', follow: '👣', fight: '⚔️' };
  function sign(e, s, what) {
    const t = SIGN[what] || '';
    if (s.signText === t) return;
    s.signText = t;
    if (s.sign) { s.sign.dispose(false, true); s.sign = null; }
    if (!t) return;
    const plane = B.MeshBuilder.CreatePlane('chars-sign', { size: 0.6 }, W().scene);
    const tex = new B.DynamicTexture('chars-sign', { width: 64, height: 64 }, W().scene, true);
    tex.hasAlpha = true;
    const ctx = tex.getContext(); ctx.clearRect(0, 0, 64, 64); ctx.font = '48px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(t, 32, 36); tex.update();
    const m = new B.StandardMaterial('chars-sign', W().scene); m.diffuseTexture = tex; m.emissiveColor = new B.Color3(1, 1, 1); m.disableLighting = true; m.useAlphaFromDiffuseTexture = true; m.backFaceCulling = false;
    plane.material = m; plane.parent = e.node; plane.position.y = e.half[1] + 0.6; plane.billboardMode = B.Mesh.BILLBOARDMODE_ALL; plane.isPickable = false; plane.metadata = { decor: true };
    s.sign = plane;
  }
  const hourNow = () => { const g = G(); try { const h = g && g.events && g.events.hour; if (Number.isFinite(h)) return h; } catch { /* no clock */ } return null; };
  H.behavior('routine', {
    title: 'Lives a day', group: 'Characters', icon: '🕰',
    says: (o) => `eats at ${o.eat || '—'}, sleeps at ${o.sleep || '—'}, works at ${o.work || '—'}`,
    defaults: { eat: '', sleep: '', work: '', home: '', speed: 2.2, hunger: 1, wander: 8, day: 120 },
    settings: [{ key: 'eat', label: 'Eats at (a thing)', type: 'thing' }, { key: 'sleep', label: 'Sleeps at', type: 'thing' }, { key: 'work', label: 'Works at', type: 'thing' }, { key: 'home', label: 'Home', type: 'thing' }, { key: 'speed', label: 'Walks at', type: 'number', min: 0.5, max: 8, unit: 'm/s' }, { key: 'hunger', label: 'Gets hungry', type: 'number', min: 0, max: 5, step: 0.1 }, { key: 'wander', label: 'Wanders', type: 'number', min: 0, max: 50, unit: 'm' }, { key: 'day', label: 'A day lasts (no clock)', type: 'number', min: 20, max: 3600, unit: 's' }],
    start(e, o, s) { e._routine = { s }; s.hunger = Math.random() * 40; s.tired = Math.random() * 30; s.home = e.position.slice(); s.t = Math.random() * num(o.day, 120); s.wait = 0; s.doing = 'wander'; },
    update(e, dt, o, s, g) {
      if (e.remote || e.dead || g.mode === 'build' || !host()) return;
      if (talking.e === e) { stand(e); e.lookAt([W().player.x, e.y, W().player.z]); return; }
      if (e.behaviors.some((b) => b.name === 'faction' && b.s.fighting)) { sign(e, s, 'fight'); return; }
      s.t += dt;
      const day = num(o.day, 120), hr = hourNow(), hour = hr !== null ? hr : (s.t / day * 24) % 24;
      const night = hour >= 21 || hour < 6;
      s.hunger = clamp(s.hunger + dt * num(o.hunger, 1) * (100 / day) * 1.5, 0, 100);
      s.tired = clamp(s.tired + dt * (night ? 2.5 : 0.6) * (100 / day), 0, 100);
      // What to do now: follow the player if asked; sleep when tired at night; eat when hungry; work by day; wander.
      let what = 'wander', at = null;
      if (s.follow && W().player) { what = 'follow'; at = [W().player.x - 1.5, W().player.y, W().player.z - 1.5]; }
      else if ((night || s.tired > 85) && place(o.sleep, e)) { what = 'sleep'; at = place(o.sleep, e); }
      else if (s.hunger > 70 && place(o.eat, e)) { what = 'eat'; at = place(o.eat, e); }
      else if (!night && hour >= 8 && hour < 17 && place(o.work, e)) { what = 'work'; at = place(o.work, e); }
      else if (night && place(o.home, e)) { what = 'home'; at = place(o.home, e); }
      if (what !== s.doing) { s.doing = what; g.emit('routine', { thing: e, doing: what }); }
      sign(e, s, what);
      if (what === 'wander') {
        s.wait -= dt;
        if (!s.to || s.wait <= 0) { const r = num(o.wander, 8); s.to = [s.home[0] + (Math.random() * 2 - 1) * r, s.home[1], s.home[2] + (Math.random() * 2 - 1) * r]; s.wait = 4 + Math.random() * 6; }
        if (walkTo(e, s.to, num(o.speed, 2.2) * 0.6) < 0.7) stand(e);
        return;
      }
      const d = walkTo(e, at, num(o.speed, 2.2));
      if (d < 2.2) {
        stand(e);
        if (what === 'eat') { s.hunger = Math.max(0, s.hunger - dt * 25); }
        if (what === 'sleep') { s.tired = Math.max(0, s.tired - dt * 12); }
      }
    },
    stop(e, o, s) { if (s.sign) s.sign.dispose(false, true); },
  });

  const api = {
    /** How a side feels about the player: -100 .. 100, and its attitude. */
    standing: (side) => standing(lower(side)),
    attitude: (a, b = 'player') => attitude(lower(a), b === 'player' ? 'player' : lower(b)),
    /** Changes how a side feels about the player (a quest done: +20; a theft: -30). */
    like: (side, by) => changeRep(lower(side), num(by, 10)),
    talk: (thing, node) => thing && thing._talk && talk(thing, node),
    endTalk: () => end(),
    get talking() { return talking.e; },
    /** Asks a character to follow the player (or stop: false). */
    follow: (thing, on = true) => { if (thing && thing._routine) thing._routine.s.follow = Boolean(on); },
  };
  H.characters = api;
  H.hooks.game.push((game) => { game.characters = api; });
})();
