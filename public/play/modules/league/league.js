// A league (config.league; J, 2026-10-27: "a whole football game where I have to recruit players and we fight against
// teams for points"): your club, a squad you recruit, rival clubs, fixtures, a points table, prize money and a season.
// Recruits are free agents (config.league.recruits, and things in the world with the `recruit` ability: E signs them).
// Match day puts your squad (AI players, `teammate`) on your side with you, the rival's on theirs, sized by its strength,
// and starts a match (modules/match); the result goes in the table: 3 points a win, 1 a draw. The 🏆 League panel shows
// the table, the next fixture, your squad, the scouting list and your coins. Online the host runs it; everyone sees it.
/* global HawkesPlay */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const W = () => H.world;
  const G = () => H.game;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const FIRST = ['Ade', 'Bea', 'Cruz', 'Dani', 'Eko', 'Fen', 'Gus', 'Hana', 'Ivo', 'Jojo', 'Kit', 'Lu', 'Mo', 'Nia', 'Oz', 'Pip', 'Quin', 'Rae', 'Sol', 'Tam'];
  const LAST = ['Banks', 'Cole', 'Drift', 'Fox', 'Gale', 'Hart', 'Kane', 'Lark', 'Moss', 'North', 'Pike', 'Reed', 'Stone', 'Vale', 'Wren'];

  let L = null; // the league as it is: { club, rivals, table, fixtures, n, coins, squad, agents, live, done }
  const cfg = () => { const c = W() && W().graph && W().graph.config && W().graph.config.league; return c && typeof c === 'object' ? c : null; };
  const host = () => !H.sync || !H.sync.online || H.sync.isHost;

  /** A free agent: a name, speed and shooting (1-10 each), and a price. */
  function agent(i, seed) {
    const r = (k) => ((Math.sin((seed + i * 7.3 + k) * 12.9898) * 43758.5453) % 1 + 1) % 1;
    const speed = Math.round(3 + r(1) * 7), kick = Math.round(3 + r(2) * 7);
    return { id: `a${i}`, name: `${FIRST[Math.floor(r(3) * FIRST.length)]} ${LAST[Math.floor(r(4) * LAST.length)]}`, speed, kick, cost: 15 + (speed + kick) * 6 };
  }
  function fresh(c) {
    const club = { name: String((c.team && c.team.name) || c.club || 'Your club'), color: 'blue' };
    const rivals = (Array.isArray(c.rivals) && c.rivals.length ? c.rivals : [{ name: 'Harbour United', strength: 2 }, { name: 'Ridge Rovers', strength: 3 }, { name: 'Dockside Athletic', strength: 4 }])
      .slice(0, 9).map((r, i) => ({ id: `r${i}`, name: String(r.name || `Rivals ${i + 1}`), strength: clamp(num(r.strength, 3), 1, 5) }));
    const legs = clamp(num(c.legs, 1), 1, 2);
    const fixtures = [];
    for (let l = 0; l < legs; l++) for (const r of rivals) fixtures.push(r.id);
    const table = { me: row() };
    for (const r of rivals) table[r.id] = row();
    const seed = num(c.seed, 7);
    const agents = (Array.isArray(c.recruits) ? c.recruits.map((a, i) => ({ id: `c${i}`, name: String(a.name || `Player ${i + 1}`), speed: clamp(num(a.speed, 5), 1, 10), kick: clamp(num(a.kick, 5), 1, 10), cost: Math.max(0, num(a.cost, 40)) })) : [])
      .concat(Array.from({ length: clamp(num(c.agents, 6), 0, 20) }, (_, i) => agent(i, seed)));
    return { key: JSON.stringify(c), club, rivals, table, fixtures, n: 0, coins: Math.max(0, num(c.coins, 120)), squad: [], agents, live: null, done: false };
  }
  function row() { return { p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 }; }
  const rivalOf = (id) => L && L.rivals.find((r) => r.id === id);
  const squadSize = () => clamp(num(cfg() && cfg().squad, 3), 1, 6);

  // ------------------------------------------------------------------ recruiting
  function sign(id) {
    if (!L || !host()) return false;
    const a = L.agents.find((x) => x.id === id);
    if (!a || L.coins < a.cost) return false;
    if (L.squad.length >= clamp(num(cfg() && cfg().roster, 8), 1, 20)) return false;
    L.coins -= a.cost;
    L.agents = L.agents.filter((x) => x !== a);
    L.squad.push(a);
    for (const e of W().entities) if (e._recruit && e._recruit.id === id && e.alive) { G().burst([e.x, e.y + 1, e.z], { color: '#3b82f6', count: 18, speed: 3 }); e.destroy(); }
    G().emit('signed', { player: { ...a }, coins: L.coins });
    G().ui.message(`${a.name} signs for ${L.club.name}`, 2.2);
    save(); ui.dirty = true;
    return true;
  }
  /** A recruit in the world: walk up, E signs them (their price comes from the league's coins). */
  H.behavior('recruit', {
    title: 'A player you can sign', group: 'Sports', icon: '✍️',
    says: (o) => `${o.name || 'a player'} (speed ${o.speed}, shooting ${o.kick}) signs for ${o.cost} coins`,
    defaults: { name: '', speed: 6, kick: 6, cost: 50 },
    settings: [{ key: 'name', label: 'Name', type: 'text' }, { key: 'speed', label: 'Speed (1-10)', type: 'number', min: 1, max: 10 }, { key: 'kick', label: 'Shooting (1-10)', type: 'number', min: 1, max: 10 }, { key: 'cost', label: 'Costs', type: 'number', min: 0, max: 1000, unit: 'coins' }],
    start(e, o, s) {
      const id = `w-${e.sceneId || e.name || Math.random().toString(36).slice(2, 7)}`;
      e._recruit = { id };
      s.add = () => { if (L && !L.agents.some((a) => a.id === id) && !L.squad.some((a) => a.id === id)) L.agents.push({ id, name: String(o.name || e.name || 'A player'), speed: clamp(num(o.speed, 6), 1, 10), kick: clamp(num(o.kick, 6), 1, 10), cost: Math.max(0, num(o.cost, 50)) }); };
      s.add();
    },
    update(e, dt, o, s) { if (L && !s.added) { s.added = true; s.add(); } const p = W().player; if (p && !e.remote) e.lookAt([p.x, e.y, p.z]); },
  });
  if (H.use && H.use.register) H.use.register('league-recruit', {
    build: false,
    near(p) {
      if (!L) return null;
      for (const e of W().entities) {
        if (!e.alive || !e._recruit || Math.hypot(e.x - p.x, e.z - p.z) > 2.5) continue;
        const a = L.agents.find((x) => x.id === e._recruit.id);
        if (!a) continue;
        return { label: L.coins >= a.cost ? `Sign ${a.name} (${a.cost} coins)` : `${a.name} wants ${a.cost} coins (you have ${L.coins})`, act: () => sign(a.id), priority: 6 };
      }
      return null;
    },
  });

  // ------------------------------------------------------------------ match day
  /** Where the pitch is: the two goals (score-zones), ours (red scores in it) and theirs. */
  function pitch() {
    let ours = null, theirs = null;
    for (const e of W().entities) {
      if (!e.alive) continue;
      const z = e.behaviors.find((x) => /^(score-zone|goal-zone|net)$/.test(String(x.name)));
      if (!z) continue;
      if (z.o.team === 'red') ours = e; else if (z.o.team === 'blue') theirs = e;
    }
    return ours && theirs ? { ours: [ours.x, ours.y, ours.z], theirs: [theirs.x, theirs.y, theirs.z] } : null;
  }
  function clearBots() { for (const e of [...W().entities]) if (e.alive && e.tag === 'league-bot') e.destroy(); }
  function bot(name, team, at, speed, kick, color) {
    const spec = { type: 'capsule', name, tag: 'league-bot', shape: { radius: 0.35, height: 1.7 }, material: { color }, physics: 'kinematic', transform: { position: at }, behaviors: [{ use: 'teammate', team, speed, kick }] };
    if (H.mayhem && H.mayhem.spawnMany) return H.mayhem.spawnMany(spec, 1, { at, ground: false, effects: false, arrive: 'none' });
    return [H.fromSpec(spec)];
  }
  function kickOff() {
    if (!L || !host() || L.live || L.done) return false;
    const rid = L.fixtures[L.n];
    const r = rivalOf(rid);
    const pt = pitch();
    if (!r || !pt) { if (!pt) G().ui.message('No pitch here: a football pitch (the kit) is needed', 2.5); return false; }
    clearBots();
    const mid = [(pt.ours[0] + pt.theirs[0]) / 2, (pt.ours[1] + pt.theirs[1]) / 2, (pt.ours[2] + pt.theirs[2]) / 2];
    const dx = pt.theirs[0] - pt.ours[0], dz = pt.theirs[2] - pt.ours[2], len = Math.hypot(dx, dz) || 1, fx = dx / len, fz = dz / len;
    const n = squadSize();
    const lineup = L.squad.slice(0, n);
    while (lineup.length < n) lineup.push({ name: `Youth player ${lineup.length + 1}`, speed: 3, kick: 3 });
    lineup.forEach((a, i) => {
      const side = (i - (n - 1) / 2) * 5;
      bot(a.name, 'blue', [mid[0] - fx * len * 0.22 + fz * side, 0.95 + pt.ours[1] - 1.2, mid[2] - fz * len * 0.22 - fx * side], 3.5 + a.speed * 0.4, 10 + a.kick * 2, '#3b82f6');
    });
    for (let i = 0; i < n; i++) {
      const side = (i - (n - 1) / 2) * 5;
      bot(`${r.name} ${i + 1}`, 'red', [mid[0] + fx * len * 0.22 + fz * side, 0.95 + pt.theirs[1] - 1.2, mid[2] + fz * len * 0.22 - fx * side], 4 + r.strength * 0.55, 11 + r.strength * 2.2, '#ef4444');
    }
    // You start on your half, facing their goal.
    const p = W().player;
    if (p) { p.position = [mid[0] - fx * len * 0.3, pt.ours[1] + 0.5, mid[2] - fz * len * 0.3]; p.velocity = [0, 0, 0]; }
    if (H.match.resetBalls) H.match.resetBalls();
    L.live = { rival: rid };
    ui.open = false; // (the table goes away for the match; 🏆 opens it again)
    H.match.start();
    G().emit('matchday', { rival: r.name, n: L.n + 1, of: L.fixtures.length });
    G().ui.message(`Match ${L.n + 1} of ${L.fixtures.length}: ${L.club.name} v ${r.name}`, 3);
    save(); ui.dirty = true;
    return true;
  }
  function result(score) {
    if (!L || !L.live) return;
    const r = rivalOf(L.live.rival), me = num(score.blue, 0), them = num(score.red, 0);
    const a = L.table.me, b = L.table[r.id];
    a.p++; b.p++; a.gf += me; a.ga += them; b.gf += them; b.ga += me;
    let prize;
    const c = cfg() || {};
    if (me > them) { a.w++; b.l++; a.pts += 3; prize = num(c.win, 60); }
    else if (me < them) { a.l++; b.w++; b.pts += 3; prize = num(c.loss, 10); }
    else { a.d++; b.d++; a.pts++; b.pts++; prize = num(c.draw, 25); }
    // The other rivals play each other too (a result by strength), so the table moves.
    const others = L.rivals.filter((x) => x.id !== r.id);
    for (let i = 0; i + 1 < others.length; i += 2) {
      const x = others[(i + L.n) % others.length], y = others[(i + 1 + L.n) % others.length];
      if (!x || !y || x === y) continue;
      const gx = Math.round(Math.random() * x.strength * 0.8), gy = Math.round(Math.random() * y.strength * 0.8);
      const tx = L.table[x.id], ty = L.table[y.id];
      tx.p++; ty.p++; tx.gf += gx; tx.ga += gy; ty.gf += gy; ty.ga += gx;
      if (gx > gy) { tx.w++; ty.l++; tx.pts += 3; } else if (gx < gy) { ty.w++; tx.l++; ty.pts += 3; } else { tx.d++; ty.d++; tx.pts++; ty.pts++; }
    }
    L.coins += prize;
    L.n++;
    L.live = null;
    const won = me > them, drew = me === them;
    G().emit('result', { rival: r.name, us: me, them, won, drew, prize, coins: L.coins });
    G().ui.message(`${won ? 'A win' : drew ? 'A draw' : 'A loss'}: ${me}-${them} v ${r.name} · +${prize} coins`, 3.5);
    G().after(4, () => clearBots());
    if (L.n >= L.fixtures.length) {
      L.done = true;
      const pos = standings().findIndex((x) => x.id === 'me') + 1;
      G().emit('season', { position: pos, champion: pos === 1 });
      G().after(4.5, () => G().ui.message(pos === 1 ? `${L.club.name} are champions!` : `The season is over: ${L.club.name} finish ${ordinal(pos)}`, 5));
    }
    save(); ui.dirty = true;
  }
  const ordinal = (n) => `${n}${['th', 'st', 'nd', 'rd'][(n % 100 >> 3) ^ 1 && n % 10 < 4 ? n % 10 : 0] || 'th'}`;
  function standings() {
    if (!L) return [];
    const rows = [{ id: 'me', name: L.club.name, ...L.table.me }, ...L.rivals.map((r) => ({ id: r.id, name: r.name, ...L.table[r.id] }))];
    return rows.sort((a, b) => b.pts - a.pts || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf);
  }

  // ------------------------------------------------------------------ the panel
  const ui = {
    el: null, open: false, dirty: true,
    make() {
      const css = document.createElement('style');
      css.textContent = `
        .lg-btn[hidden], .lg-panel[hidden] { display: none !important; }
        .lg-btn { position: fixed; left: 14px; top: max(110px, calc(env(safe-area-inset-top) + 100px)); z-index: 6; min-height: 44px; padding: 8px 14px; border-radius: 999px; border: 1px solid rgba(255,255,255,.25); background: rgba(10,14,24,.82); color: #fff; font: 600 13px/1 system-ui, sans-serif; cursor: pointer; }
        .lg-panel { position: fixed; left: 14px; top: max(162px, calc(env(safe-area-inset-top) + 152px)); z-index: 9; width: min(380px, calc(100vw - 28px)); max-height: calc(100vh - 200px); overflow: auto; background: rgba(8,12,22,.95); border: 1px solid rgba(255,255,255,.15); border-radius: 14px; padding: 12px; color: #e8eef7; font: 500 12px/1.35 system-ui, sans-serif; display: grid; gap: 10px; }
        .lg-panel h3 { margin: 0; font: 700 13px/1.2 system-ui, sans-serif; }
        .lg-panel table { width: 100%; border-collapse: collapse; }
        .lg-panel td, .lg-panel th { padding: 3px 4px; text-align: right; }
        .lg-panel td:nth-child(2), .lg-panel th:nth-child(2) { text-align: left; }
        .lg-panel tr.me { color: #93c5fd; font-weight: 700; }
        .lg-panel button { min-height: 40px; padding: 6px 10px; border-radius: 9px; border: 1px solid rgba(255,255,255,.2); background: rgba(255,255,255,.08); color: inherit; font: inherit; cursor: pointer; }
        .lg-panel button.go { background: #2563eb; border-color: #2563eb; font-weight: 700; }
        .lg-panel button:disabled { opacity: .45; cursor: default; }
        .lg-panel .lg-agent { display: flex; justify-content: space-between; align-items: center; gap: 8px; }`;
      document.head.appendChild(css);
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'lg-btn'; btn.textContent = '🏆 League';
      const panel = document.createElement('div');
      panel.className = 'lg-panel'; panel.hidden = true;
      for (const el of [btn, panel]) { el.addEventListener('pointerdown', (e) => e.stopPropagation()); document.body.appendChild(el); }
      btn.onclick = () => { this.open = !this.open; this.dirty = true; this.render(); };
      panel.onclick = (e) => {
        const b = e.target.closest && e.target.closest('button');
        if (!b) return;
        if (b.dataset.go) act({ op: 'kickoff' });
        else if (b.dataset.sign) act({ op: 'sign', id: b.dataset.sign });
      };
      this.el = { btn, panel };
    },
    render() {
      const on = Boolean(L && cfg() && H.mode !== 'build');
      if (!on) { if (this.el) { this.el.btn.hidden = true; this.el.panel.hidden = true; } return; }
      if (!this.el) this.make();
      this.el.btn.hidden = false;
      this.el.btn.textContent = `🏆 League · ${L.coins} coins`;
      this.el.panel.hidden = !this.open;
      if (!this.open || !this.dirty) return;
      this.dirty = false;
      const next = rivalOf(L.fixtures[L.n]);
      const rows = standings().map((r, i) => `<tr class="${r.id === 'me' ? 'me' : ''}"><td>${i + 1}</td><td>${esc(r.name)}</td><td>${r.p}</td><td>${r.w}</td><td>${r.d}</td><td>${r.l}</td><td>${r.gf - r.ga}</td><td>${r.pts}</td></tr>`).join('');
      this.el.panel.innerHTML = `
        <h3>${esc(L.club.name)}</h3>
        <table><tr><th>#</th><th>Club</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GD</th><th>Pts</th></tr>${rows}</table>
        ${L.done ? '<div>The season is over.</div>' : L.live ? '<div>Match on: play!</div>' : next ? `<button type="button" class="go" data-go="1" ${host() ? '' : 'disabled'}>Play match ${L.n + 1} of ${L.fixtures.length}: v ${esc(next.name)}</button>` : ''}
        <h3>Your squad (${L.squad.length})</h3>
        <div>${L.squad.length ? L.squad.map((a) => `${esc(a.name)} <small>speed ${a.speed}, shooting ${a.kick}</small>`).join('<br>') : 'Nobody yet: youth players fill in. Sign someone.'}</div>
        <h3>Free agents</h3>
        ${L.agents.map((a) => `<div class="lg-agent"><span>${esc(a.name)} <small>speed ${a.speed}, shooting ${a.kick}</small></span><button type="button" data-sign="${esc(a.id)}" ${L.coins >= a.cost && host() ? '' : 'disabled'}>Sign · ${a.cost}</button></div>`).join('') || '<div>None left.</div>'}`;
    },
  };
  const action = H.sync && H.sync.action ? H.sync.action('league:act', (d, o) => { if (o.authoritative) run(d); }) : null;
  function run(d) { if (!d) return; if (d.op === 'kickoff') kickOff(); else if (d.op === 'sign') sign(String(d.id)); }
  function act(d) { if (action) action(d); else run(d); }

  // The result: the match's end, for the fixture being played.
  let lastPhase = null;
  function onMatch(M) {
    const was = lastPhase;
    lastPhase = M.phase;
    if (L && L.live && M.phase === 'end' && was !== 'end' && host()) result(M.score || {});
  }

  // ------------------------------------------------------------------ keeping it, sharing it
  function save() { try { if (G() && G().save) G().save('league', L); } catch { /* fine */ } }
  if (H.sync && H.sync.state) H.sync.state('league', { rate: 1, get: () => ({ l: L }), set: (s) => { if (s && s.l && !host()) { L = s.l; ui.dirty = true; } } });

  H.features.register('league', {
    apply(value, ctx) {
      const c = value && typeof value === 'object' ? value : {};
      const kept = ctx.game && ctx.game.load ? ctx.game.load('league', null) : null;
      // (The season so far, kept across a restart of this game: only for the same league.)
      L = kept && kept.club && kept.table && kept.key === JSON.stringify(c) ? { ...kept, live: null } : fresh(c);
      ui.dirty = true;
      lastPhase = null; ctx.state.off = H.match.listen(onMatch);
    },
    change(value, old, ctx) { if (ctx.state.off) ctx.state.off(); L = fresh(value && typeof value === 'object' ? value : {}); ui.dirty = true; lastPhase = null; ctx.state.off = H.match.listen(onMatch); },
    dispose(ctx) { if (ctx.state.off) ctx.state.off(); L = null; ui.render(); },
    codex: {
      title: 'A league', group: 'Games',
      what: 'A season: your club, recruits you sign with coins, rival clubs, a fixture each, a points table. Needs a football pitch (the kit) and config.match.',
      value: { team: { name: 'Hawkes FC' }, rivals: [{ name: 'Harbour United', strength: 2 }, { name: 'Ridge Rovers', strength: 4 }] },
      fields: [['team.name', 'your club', 'Your club'], ['rivals', '[{ name, strength 1-5 }]', 'three'], ['squad', 'players a side besides you', '3'], ['coins', 'to start', '120'], ['recruits', '[{ name, speed, kick, cost }]', ''], ['agents', 'free agents made up', '6'], ['legs', '1 or 2 games with each', '1'], ['win / draw / loss', 'prize coins', '60 / 25 / 10']],
    },
  });
  let t = 0;
  H.hooks.frame.push((dt) => { t -= dt; if (t > 0) return; t = 0.5; ui.render(); });

  const api = {
    get on() { return Boolean(L); },
    get coins() { return L ? L.coins : 0; },
    get squad() { return L ? L.squad.map((a) => ({ ...a })) : []; },
    get agents() { return L ? L.agents.map((a) => ({ ...a })) : []; },
    get table() { return standings(); },
    get next() { const r = L && rivalOf(L.fixtures[L.n]); return r ? { name: r.name, strength: r.strength, n: L.n + 1, of: L.fixtures.length } : null; },
    get playing() { return Boolean(L && L.live); },
    sign: (id) => sign(String(id)),
    kickOff: () => kickOff(),
    give(n) { if (L) { L.coins = Math.max(0, L.coins + num(n, 0)); ui.dirty = true; save(); } },
    open() { ui.open = true; ui.dirty = true; ui.render(); },
  };
  H.league = api;
  H.hooks.game.push((game) => { game.league = api; });
})();
