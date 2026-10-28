// Matches (H.match, config.match): any game becomes a match with a few settings: teams or everyone for themselves, rounds,
// a clock, lives, a score to win, and a mode (classic, tag, hide and seek). The host keeps the score and the clock and
// shares them (H.sync.state 'match'); everyone sees one scoreboard at the top. Points come from anywhere: rules
// ({ "point": "red" }), scripts (game.match.point), kills (team deathmatch), and the sports and capture-the-flag
// abilities here: ball (kick it, dribble it), score-zone (a goal, a hoop, a base: a ball or a flag in it scores),
// flag (carry the other team's flag home) and teammate (an AI player that chases the ball and shoots at the right goal).
//   config.match: { teams: ["red", "blue"] | 2 | false, time: 300 (s a round), rounds: 1, score: 0 (points to win a
//                   round; 0: the clock decides), lives: 0 (0: endless), mode: "classic" | "tag" | "hide", start: 5 (s),
//                   kills: true (a kill is a point), objective: "Score in the other team's goal" }
/* global HawkesPlay */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const W = () => H.world;
  const G = () => H.game;
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const RAD = Math.PI / 180;
  const COLORS = { red: '#ef4444', blue: '#3b82f6', green: '#22c55e', yellow: '#eab308', purple: '#a855f7', orange: '#f97316', seekers: '#ef4444', hiders: '#22c55e' };
  const colorOf = (t) => COLORS[t] || '#e5e7eb';
  const cap = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);

  // ------------------------------------------------------------------ who's who
  const meId = () => (H.sync && H.sync.online && H.sync.me) || 'me';
  const isHost = () => !H.sync || !H.sync.online || H.sync.isHost;
  function people() {
    const g = G();
    const out = [{ id: meId(), name: (H.presence && H.presence.look && H.presence.look.name) || 'You', entity: W() && W().player }];
    if (H.sync && H.sync.online && g && g.net && g.net.players) for (const p of g.net.players) if (p.id !== meId()) out.push({ id: p.id, name: p.name || 'Someone', entity: p.entity });
    return out;
  }

  // ------------------------------------------------------------------ the state (the host's, shared)
  let cfg = null;
  const blank = () => ({ on: false, phase: 'off', round: 0, rounds: 1, clock: 0, startIn: 0, teams: [], team: {}, score: {}, wins: {}, lives: {}, out: {}, it: null, winner: null, mode: 'classic', obj: '' });
  let M = blank();
  const listeners = new Set();
  const changed = () => { for (const f of listeners) try { f(M); } catch (err) { H.report(err, 'match'); } };
  if (H.sync && H.sync.state) {
    try { H.sync.state('match', { get: () => ({ m: M }), set: (copy) => { if (copy && copy.m) { const was = M.phase; M = copy.m; onRemote(was); } }, rate: 4 }); } catch (err) { H.report(err, 'match'); }
  }
  const act = (name, run) => (H.sync && H.sync.action ? H.sync.action(name, (d, o) => { if (o.authoritative) run(d); }) : (d) => run(d));
  const pointAct = act('_mpoint', (d) => addPoint(d.who, num(d.n, 1), d.why));
  const deathAct = act('_mdeath', (d) => onDeath(d.who, d.by));
  const tagAct = act('_mtag', (d) => onTag(d.from, d.to));

  function teamsOf(c) {
    if (c.mode === 'hide') return ['seekers', 'hiders'];
    if (Array.isArray(c.teams)) return c.teams.map(String).slice(0, 6);
    if (c.teams === false || c.teams === 0 || c.teams === 1 || c.mode === 'tag') return [];
    const n = Math.max(2, Math.min(6, num(c.teams, 2)));
    return ['red', 'blue', 'green', 'yellow', 'purple', 'orange'].slice(0, n);
  }
  function startMatch() {
    const c = cfg || {};
    M = { ...blank(), on: true, phase: 'start', round: 1, rounds: Math.max(1, num(c.rounds, 1)), clock: Math.max(0, num(c.time, 300)), startIn: Math.max(0, num(c.start, 5)), teams: teamsOf(c), mode: c.mode || 'classic', obj: String(c.objective || '') };
    assign();
    changed();
  }
  /** Teams for everyone, kept balanced (newcomers join the smallest); in hide and seek, one seeker in five. */
  function assign() {
    const ps = people();
    for (const p of ps) {
      if (M.lives[p.id] === undefined) M.lives[p.id] = Math.max(0, num(cfg && cfg.lives, 0));
      if (!M.teams.length || M.team[p.id]) continue;
      if (M.mode === 'hide') { const seekers = Object.values(M.team).filter((t) => t === 'seekers').length; M.team[p.id] = seekers < Math.max(1, Math.round(ps.length / 5)) ? 'seekers' : 'hiders'; continue; }
      // (config.match.join: the team every player is on: a league's home side.)
      if (cfg && cfg.join && M.teams.includes(String(cfg.join))) { M.team[p.id] = String(cfg.join); continue; }
      const counts = M.teams.map((t) => Object.values(M.team).filter((x) => x === t).length);
      M.team[p.id] = M.teams[counts.indexOf(Math.min(...counts))];
    }
    if (M.mode === 'tag' && (!M.it || !ps.some((p) => p.id === M.it))) M.it = ps[Math.floor(Math.random() * ps.length)].id;
  }
  /** Who a point goes to: a team (in team games), or a player. */
  function addPoint(who, n, why) {
    if (!M.on || M.phase !== 'play' || !who) return;
    const key = M.teams.length && !M.teams.includes(who) ? M.team[who] || who : who;
    M.score[key] = (M.score[key] || 0) + n;
    const goal = num(cfg && cfg.score, 0);
    if (goal > 0 && M.score[key] >= goal) endRound(key);
    changed();
    try { G().emit('point', { who: key, n, why: why || null, score: M.score[key] }); } catch { /* fine */ }
  }
  function onDeath(who, by) {
    if (!M.on || M.phase !== 'play') return;
    if (by && by !== who && (!cfg || cfg.kills !== false)) {
      if (!M.teams.length || M.team[by] !== M.team[who]) addPoint(by, 1, 'kill');
    }
    if (num(cfg && cfg.lives, 0) > 0) {
      M.lives[who] = Math.max(0, (M.lives[who] ?? num(cfg.lives, 0)) - 1);
      if (!M.lives[who]) M.out[who] = true;
      const alive = people().filter((p) => !M.out[p.id]);
      const sides = new Set(alive.map((p) => (M.teams.length ? M.team[p.id] : p.id)));
      if (people().length > 1 && sides.size <= 1) endRound(sides.values().next().value || null);
    }
    changed();
  }
  function onTag(from, to) {
    if (!M.on || M.phase !== 'play') return;
    if (M.mode === 'tag' && M.it === from) { M.it = to; changed(); try { G().emit('tag', { from, to }); } catch { /* fine */ } }
    if (M.mode === 'hide' && M.team[from] === 'seekers' && M.team[to] === 'hiders') {
      M.team[to] = 'seekers';
      addPoint(from, 1, 'found');
      if (!Object.values(M.team).includes('hiders')) endRound('seekers');
      changed();
    }
  }
  function endRound(winner) {
    if (M.phase !== 'play') return;
    if (winner === undefined || winner === null) {
      const best = Object.entries(M.score).sort((a, b) => b[1] - a[1]);
      winner = M.mode === 'hide' ? (Object.values(M.team).includes('hiders') ? 'hiders' : 'seekers') : best.length && (best.length < 2 || best[0][1] > best[1][1]) ? best[0][0] : null;
    }
    M.winner = winner;
    if (winner) M.wins[winner] = (M.wins[winner] || 0) + 1;
    M.phase = M.round >= M.rounds ? 'end' : 'over';
    M.startIn = 6;
    changed();
    try { G().emit('round', { round: M.round, winner, over: M.phase === 'end' }); } catch { /* fine */ }
  }
  function nextRound() {
    M.round += 1;
    M.score = {}; M.out = {}; M.winner = null;
    M.clock = Math.max(0, num(cfg && cfg.time, 300));
    M.startIn = Math.max(0, num(cfg && cfg.start, 5));
    for (const id of Object.keys(M.lives)) M.lives[id] = Math.max(0, num(cfg && cfg.lives, 0));
    if (M.mode === 'hide') M.team = {};
    assign();
    M.phase = 'start';
    changed();
  }

  // ------------------------------------------------------------------ every step: the host runs the clock, everyone their own part
  let shownPhase = null, tagT = 0, frozen = false;
  function step(dt) {
    if (!M.on) return;
    if (isHost()) {
      assign();
      if (M.phase === 'start') { M.startIn -= dt; if (M.startIn <= 0) { M.phase = 'play'; changed(); } }
      else if (M.phase === 'play') {
        if (M.clock > 0) { M.clock -= dt; if (M.clock <= 0) { M.clock = 0; endRound(); } }
        if (M.mode === 'tag') for (const p of people()) if (p.id !== M.it) M.score[p.id] = (M.score[p.id] || 0) + dt;
      } else if (M.phase === 'over') { M.startIn -= dt; if (M.startIn <= 0) nextRound(); }
    }
    mine(dt);
    hud();
  }
  /** My part: my team's spawn, frozen while seekers count, tagging whoever I touch. */
  function mine(dt) {
    const p = W() && W().player, g = G();
    if (!p || !g) return;
    const team = M.team[meId()];
    if (team && M.phase !== shownPhase && M.phase === 'start') {
      const s = [...W().entities].find((e) => e.kind === 'spawn' && (e.data.role === team || e.tag === team));
      if (s) { g.checkpoint([s.x, s.bottom + 0.05, s.z]); p.position = [s.x, s.bottom + 1, s.z]; p.velocity = [0, 0, 0]; }
    }
    shownPhase = M.phase;
    // Hide and seek: seekers wait (still, the screen dark) while the hiders hide.
    const freeze = M.mode === 'hide' && team === 'seekers' && M.phase === 'start';
    if (freeze !== frozen) { frozen = freeze; p.controls = !freeze; dark(freeze); }
    // Tagging: whoever is "it" (or seeks) and touches someone passes it on (the host decides).
    tagT -= dt;
    const tagger = (M.mode === 'tag' && M.it === meId()) || (M.mode === 'hide' && team === 'seekers');
    if (!tagger || M.phase !== 'play' || tagT > 0) return;
    for (const o of people()) {
      if (o.id === meId() || !o.entity || !o.entity.alive) continue;
      if (M.mode === 'hide' && M.team[o.id] !== 'hiders') continue;
      if (Math.hypot(o.entity.x - p.x, o.entity.y - p.y, o.entity.z - p.z) < 1.7) { tagT = 1.5; tagAct({ from: meId(), to: o.id }); g.burst(o.entity.position, { color: '#f43f5e', count: 24, speed: 5 }); break; }
    }
  }
  function onRemote(was) { if (was !== M.phase) shownPhase = null; }

  // ------------------------------------------------------------------ the scoreboard
  let hudEl = null, darkEl = null;
  const CSS = `.mt-hud{position:fixed;left:50%;top:10px;transform:translateX(-50%);z-index:35;display:flex;flex-direction:column;align-items:center;gap:4px;pointer-events:none;font:700 15px/1.2 var(--hud,system-ui,sans-serif);color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.9)}
.mt-row{display:flex;gap:10px;align-items:center;padding:6px 14px;border-radius:12px;background:rgba(6,10,20,.72);border:1px solid rgba(255,255,255,.15)}
.mt-team{display:inline-flex;align-items:center;gap:6px}.mt-team i{width:10px;height:10px;border-radius:50%}
.mt-clock{font:700 15px var(--display,system-ui);letter-spacing:.06em;color:#fde68a}
.mt-sub{font:600 12.5px var(--hud,system-ui);color:#cbd5e1;padding:2px 10px;border-radius:8px;background:rgba(6,10,20,.55)}
.mt-big{font:800 34px var(--display,system-ui);letter-spacing:.04em;padding:10px 22px;border-radius:14px;background:rgba(6,10,20,.8)}
.mt-dark{position:fixed;inset:0;z-index:34;background:rgba(0,0,0,.92);display:grid;place-items:center;color:#fff;font:800 30px var(--display,system-ui);pointer-events:none}
body.pr-touch .mt-hud{top:auto;bottom:auto;top:max(8px,env(safe-area-inset-top));font-size:13px}`;
  function dark(on) {
    if (on && !darkEl && typeof document !== 'undefined' && document.body) { darkEl = document.createElement('div'); darkEl.className = 'mt-dark'; darkEl.textContent = 'Count to twenty… the hiders are hiding'; document.body.appendChild(darkEl); }
    if (!on && darkEl) { darkEl.remove(); darkEl = null; }
  }
  const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  let shown = '';
  function hud() {
    if (typeof document === 'undefined' || !document.body) return;
    if (!M.on) { if (hudEl) { hudEl.remove(); hudEl = null; } return; }
    if (!hudEl) {
      if (!document.getElementById('mt-css')) { const st = document.createElement('style'); st.id = 'mt-css'; st.textContent = CSS; document.head.appendChild(st); }
      hudEl = document.createElement('div'); hudEl.className = 'mt-hud'; document.body.appendChild(hudEl);
    }
    const ps = people(), nameOf = (id) => (ps.find((p) => p.id === id) || {}).name || 'Someone';
    const me = meId(), team = M.team[me];
    const sides = M.teams.length ? M.teams.map((t) => `<span class="mt-team"><i style="background:${colorOf(t)}"></i>${cap(t)} ${Math.floor(M.score[t] || 0)}${M.rounds > 1 ? ` (${M.wins[t] || 0})` : ''}</span>`)
      : Object.entries(M.score).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id, n]) => `<span class="mt-team">${nameOf(id)} ${Math.floor(n)}</span>`);
    const top = `<div class="mt-row">${sides.join('<span style="opacity:.4">·</span>') || '<span>Ready</span>'}${M.clock ? `<span class="mt-clock">${clock(M.clock)}</span>` : ''}</div>`;
    let sub = '';
    if (M.phase === 'start') sub = `<div class="mt-big">${M.round > 1 ? `Round ${M.round} · ` : ''}${Math.ceil(M.startIn)}</div>`;
    else if (M.phase === 'over' || M.phase === 'end') sub = `<div class="mt-big" style="color:${colorOf(M.winner)}">${M.winner ? `${M.teams.length ? cap(M.winner) : nameOf(M.winner)} win${M.teams.length || M.winner === me ? '' : 's'}${M.phase === 'end' ? ' the match!' : ' the round'}` : 'A draw'}</div>`;
    const mine = M.mode === 'tag' ? (M.it === me ? 'You are IT: touch someone!' : `${nameOf(M.it)} is it: run!`) : M.mode === 'hide' ? (team === 'seekers' ? 'You seek: find the hiders' : 'You hide: don’t get found') : team ? `You: ${cap(team)}` : '';
    const lives = cfg && num(cfg.lives, 0) > 0 ? ` · ${'♥'.repeat(M.lives[me] || 0) || 'out'}` : '';
    const html = `${top}${sub}${mine || M.obj || lives ? `<div class="mt-sub">${[mine, M.obj].filter(Boolean).join(' · ')}${lives}</div>` : ''}`;
    if (html !== shown) { shown = html; hudEl.innerHTML = html; }
  }

  // ------------------------------------------------------------------ the feature, and hearing the game
  H.features.register('match', {
    codex: {
      title: 'Matches', group: 'Game rules',
      what: 'Teams, rounds, a clock, lives and a score to win; classic, tag or hide and seek. One scoreboard for everyone.',
      value: { teams: ['red', 'blue'], time: 180, score: 5 },
      fields: [['teams', '["red", "blue"], a number, or false (everyone for themselves)', '2'], ['time', 'seconds a round (0: no clock)', '300'], ['rounds', 'rounds in the match', '1'], ['score', 'points to win a round (0: the clock decides)', '0'], ['lives', 'lives each (0: endless)', '0'], ['mode', 'classic, tag, hide', 'classic'], ['start', 'countdown seconds', '5'], ['kills', 'a kill is a point', 'true'], ['objective', 'a line under the scoreboard', '']],
    },
    // (auto: false waits for H.match.start(): a league's match day.)
    apply(value) { cfg = value && typeof value === 'object' ? value : {}; if (cfg.auto !== false) startMatch(); },
    change(value) { cfg = value && typeof value === 'object' ? value : {}; if (cfg.auto !== false) startMatch(); },
    update(dt) { try { step(dt); } catch (err) { H.report(err, 'match'); } },
    dispose() { M = blank(); cfg = null; dark(false); if (frozen && W() && W().player) W().player.controls = true; frozen = false; hud(); },
  });
  H.hooks.game.push((g) => {
    g.match = H.match;
    // My death: the host takes a life and gives the killer their point.
    g.on('death', (d) => {
      if (!M.on || !d || d.entity !== g.player) return;
      const by = d.by && people().find((p) => p.entity && p.entity === d.by);
      deathAct({ who: meId(), by: by ? by.id : null });
    });
  });

  // ------------------------------------------------------------------ the API
  H.match = {
    get on() { return M.on; },
    get state() { return JSON.parse(JSON.stringify(M)); },
    /** A point (or n) for a team ("red") or a player (their id; in team games it goes to their team). */
    point(who, n = 1, why) { pointAct({ who: String(who), n: Number(n) || 1, why: why || null }); },
    teamOf: (id) => M.team[id || meId()] || null,
    get myTeam() { return M.team[meId()] || null; },
    colorOf,
    start() { if (isHost()) startMatch(); },
    end(winner) { if (isHost()) endRound(winner); },
    /** fn(state) on every change. Returns off(). */
    listen(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    /** Every ball back where it started, still. */
    resetBalls() { for (const b of W().entities) if (b.alive && homes.has(b)) resetBall(b); },
    /** The match's settings now (config.match). */
    get config() { return cfg ? JSON.parse(JSON.stringify(cfg)) : null; },
    _: { step, people, meId, tag: (to) => tagAct({ from: meId(), to }) },
  };
  // Rules: { "point": "red" } (or "point": "player": the one who set it off; "n": 3).
  if (H.events && H.events.defineAction) {
    H.events.defineAction('point', { scope: 'host', run(a, ctx) { const who = a.point === 'player' || a.point === true ? (ctx && ctx.who && (ctx.who.id || ctx.who)) : a.point; if (who) addPoint(String(who), num(a.n, 1), a.why); } });
  }

  // ------------------------------------------------------------------ sports and flags: abilities that score
  const def = (names, d) => { for (const n of [].concat(names)) H.behavior(n, d); };
  const inside = (e, p, pad) => (H.abilities ? H.abilities.inside(e, p, pad) : Math.hypot(p[0] - e.x, p[2] - e.z) < Math.max(e.half[0], e.half[2]) + (pad || 0));
  const isBall = (x) => x && x.behaviors && x.behaviors.some((b) => b.def === H.behaviorDef('ball'));
  const homes = new WeakMap();
  function resetBall(b) {
    const h = homes.get(b);
    if (!h) return;
    b.position = h; b.velocity = [0, 0, 0];
  }
  def(['ball', 'football', 'soccer-ball', 'basketball'], {
    title: 'A ball (kick it, dribble it)', group: 'Sports', icon: '⚽', says: (o) => `a ball: run into it to dribble, E or click to kick (${o.kick} m/s)`,
    defaults: { kick: 18, lift: 5, dribble: 1.2 }, settings: [{ key: 'kick', label: 'Kick strength', type: 'number', min: 4, max: 60, step: 1, unit: 'm/s' }, { key: 'lift', label: 'Kick lift', type: 'number', min: 0, max: 20, step: 0.5, unit: 'm/s' }, { key: 'dribble', label: 'Dribble push', type: 'number', min: 0, max: 4, step: 0.1 }],
    start(e) { homes.set(e, e.position.slice()); if (e.physics !== 'dynamic') e.physics = 'dynamic'; },
    update(e, dt, o, s, game) {
      const p = game.player;
      if (!p || e.held) return;
      // Out of the world: back to the middle.
      if (e.y < -30) resetBall(e);
      const dx = e.x - p.x, dz = e.z - p.z, d = Math.hypot(dx, dz);
      // Running into it pushes it along (a dribble); E or a click near it kicks it the way you look.
      if (d < 0.6 + e.half[0] + 0.4 && Math.abs(e.y - p.y) < 1.6 && Math.hypot(p.vx, p.vz) > 1) {
        if (H.sync && H.sync.online && e.sceneId && !H.sync.mine(e)) H.sync.claim(e);
        e.velocity = [p.vx * o.dribble + (dx / (d || 1)) * 1.5, Math.max(e.vy, 0.5), p.vz * o.dribble + (dz / (d || 1)) * 1.5];
      }
      const kick = game.input.pressed('e') || (game.input.mouse && game.input.mouse.pressed && game.input.captured && !(H.abilities && H.abilities.holding));
      if (kick && d < 2.4 && (!s.k || game.now - s.k > 0.3)) {
        s.k = game.now;
        if (H.sync && H.sync.online && e.sceneId && !H.sync.mine(e)) H.sync.claim(e);
        const f = game.camera && game.camera.forward ? game.camera.forward : [dx / (d || 1), 0, dz / (d || 1)];
        const l = Math.hypot(f[0], f[2]) || 1;
        e.velocity = [(f[0] / l) * o.kick, o.lift + Math.max(0, f[1]) * o.kick * 0.6, (f[2] / l) * o.kick];
        game.burst(e.position, { color: '#ffffff', count: 10, speed: 3 });
        game.emit('kick', { thing: e });
      }
    },
  });
  def(['score-zone', 'goal-zone', 'hoop', 'net', 'base'], {
    title: 'Scores when a ball (or a flag) gets in', group: 'Sports', icon: '🥅', says: (o) => `a goal: a ${o.takes} in it scores ${o.points} for ${o.team || 'whoever put it there'}`,
    defaults: { team: 'red', points: 1, takes: 'ball' }, settings: [{ key: 'team', label: 'Points go to (team)', type: 'text' }, { key: 'points', label: 'Points', type: 'number', min: 1, max: 10, step: 1 }, { key: 'takes', label: 'What scores', type: 'choice', options: [['ball', 'A ball'], ['flag', 'An enemy flag']] }],
    start(e) { if (e.physics !== 'none') e.ghost = true; },
    update(e, dt, o, s, game) {
      for (const x of W().entities) {
        if (!x.alive || x === e) continue;
        const flag = o.takes === 'flag' && x._flag && x.held && x._flag.team !== o.team;
        if (!(o.takes === 'flag' ? flag : isBall(x))) continue;
        if (H.sync && H.sync.online && x.sceneId && !H.sync.mine(x)) continue; // (whoever moves it decides)
        if (!inside(e, x.position, 0.1)) continue;
        if (o.takes === 'flag') { if (H.abilities && H.abilities.holding === x) H.abilities.drop(); x.position = x._flag.home; x.velocity = [0, 0, 0]; }
        else resetBall(x);
        if (H.match.on) H.match.point(o.team || meId(), o.points, o.takes === 'flag' ? 'capture' : 'goal');
        game.burst(e.position, { color: colorOf(o.team), count: 60, speed: 8 });
        if (game.camera && game.camera.shake) try { game.camera.shake(0.4, 0.3); } catch { /* fine */ }
        game.ui.message(o.takes === 'flag' ? 'CAPTURED!' : o.points > 1 ? `${o.points} POINTS!` : 'GOAL!', 1.6);
        game.emit('goal', { zone: e, team: o.team, points: o.points });
      }
    },
  });
  def(['flag', 'team-flag'], {
    title: 'A team’s flag (carry the enemy’s home)', group: 'Sports', icon: '🚩', says: (o) => `the ${o.team} team's flag: the other team carries it to their base`,
    defaults: { team: 'red', back: 10 }, settings: [{ key: 'team', label: 'Whose flag', type: 'text' }, { key: 'back', label: 'Goes home after (dropped)', type: 'number', min: 1, max: 120, step: 1, unit: 's' }],
    start(e, o) { e._flag = { team: o.team, home: e.position.slice() }; if (e.physics === 'static') e.physics = 'dynamic'; },
    update(e, dt, o, s) {
      // Dropped away from home: it goes back after a while.
      const away = Math.hypot(e.x - e._flag.home[0], e.z - e._flag.home[2]) > 1;
      s.t = !e.held && away ? (s.t || 0) + dt : 0;
      if (s.t > o.back) { e.position = e._flag.home; e.velocity = [0, 0, 0]; s.t = 0; }
    },
  });
  // A flag is picked up like a holdable, by the other team only (its own team leaves it).
  H.use.register('flags', {
    build: false,
    near(p) {
      if (!H.abilities || H.abilities.holding) return null;
      for (const e of W().entities) {
        if (!e.alive || !e._flag || e.held || Math.hypot(e.x - p.x, e.z - p.z) > 2.2) continue;
        if (H.match.on && H.match.myTeam === e._flag.team) return null;
        return { label: `Take the ${e._flag.team} flag`, act: () => H.abilities.pick(e, { throw: 6 }), priority: 5 };
      }
      return null;
    },
  });
  def(['teammate', 'player-bot', 'footballer'], {
    title: 'An AI player (chases the ball, shoots at goal)', group: 'Sports', icon: '🤖', says: (o) => `plays for ${o.team}: runs at the ball and shoots it at the goal that scores for ${o.team}`,
    defaults: { team: 'blue', speed: 5.5, kick: 16 }, settings: [{ key: 'team', label: 'Team', type: 'text' }, { key: 'speed', label: 'Speed', type: 'number', min: 1, max: 12, step: 0.5, unit: 'm/s' }, { key: 'kick', label: 'Shot strength', type: 'number', min: 4, max: 40, step: 1, unit: 'm/s' }],
    start(e) { if (e.physics === 'dynamic') e.physics = 'kinematic'; },
    update(e, dt, o, s, game) {
      if (H.mode === 'build' || (H.sync && H.sync.online && e.sceneId && !H.sync.mine(e))) return;
      if (H.match.on && H.match.state.phase !== 'play') return;
      const w = W();
      let ball = null, bd = Infinity;
      for (const x of w.entities) if (x.alive && isBall(x)) { const d = Math.hypot(x.x - e.x, x.z - e.z); if (d < bd) { bd = d; ball = x; } }
      if (!ball) return;
      const goal = [...w.entities].find((x) => x.alive && x.behaviors.some((b) => b.def === H.behaviorDef('score-zone') && b.o.team === o.team && b.o.takes !== 'flag'));
      // Run to the side of the ball away from the goal, then push it at the goal.
      const gx = goal ? goal.x : ball.x, gz = goal ? goal.z : ball.z + 10;
      const ax = ball.x - gx, az = ball.z - gz, al = Math.hypot(ax, az) || 1;
      const tx = ball.x + (ax / al) * 0.9, tz = ball.z + (az / al) * 0.9;
      const dx = tx - e.x, dz = tz - e.z, d = Math.hypot(dx, dz);
      if (d > 0.3) { const k = Math.min(d, o.speed * dt) / d; e.node.position.x += dx * k; e.node.position.z += dz * k; e.node.rotation.y = Math.atan2(dx, dz); }
      if (bd < 1.4 && (!s.k || game.now - s.k > 0.8)) {
        s.k = game.now;
        ball.velocity = [(-ax / al) * o.kick, 3, (-az / al) * o.kick];
        game.emit('kick', { thing: ball, by: e });
      }
    },
  });
})();
