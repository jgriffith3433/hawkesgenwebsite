// Races: lit gates, a countdown, a lap clock, a best time and a ghost of the best run (docs/{world,api}/47-race.md).
// A world turns it on with `config.race: { courses: [...] }`. Drive a course's vehicle through its first gate and the
// countdown starts; the clock runs from GO through every gate in order and stops when you come back through the first
// one after the last lap. Only the next three gates are lit. The best time is kept with the Overseer's memory (the
// account when signed in), the best run's ghost and the board of the best ten on this device (localStorage "hg_race").
// Nothing here is paid for or sent anywhere: it is the player's own game on their own machine.
//
//   game.race.courses            the courses as set in the world (id, name, vehicle, laps, par...)
//   game.race.state              { phase: 'idle' | 'countdown' | 'running', course, lap, laps, ms, next }
//   game.race.best(id)           best time in ms (0 = none yet)       game.race.board(id)  the rows of the board
//   game.race.abort(why)         ends the race under way              game.race.showBoard(id)  the results card
//   game.on('race', ({ state: 'countdown' | 'go' | 'gate' | 'lap' | 'finish' | 'abort', course, ... }) => {})
(function () {
  'use strict';
  const H = window.HawkesPlay;
  if (!H || H.race) return;
  const C = window.HawkesRaceCore;
  const STORE = 'hg_race';
  const COUNT = 3; // seconds of countdown
  const GRACE = 6; // seconds out of the vehicle before the race is called off
  const FAR = 260; // meters from the start gate before it is called off
  const AFTER = 4; // seconds after a finish before the start gate listens again
  const lit = () => (H.device && H.device.tier === 'phone' ? 2 : 3); // gates lit ahead (the next and one more on a phone: fewer see-through things to draw)

  let cfg = null; // the world's config.race
  let courses = []; // [{ def, gates: [...gate with entities] }]
  let G = null; // the game
  let built = false;
  let run = null; // the race under way
  let prev = null; // where the vehicle was last step (planet numbers)
  let cool = 0; // seconds until a start gate listens again
  let hud = null;
  let sinceCheck = 0;
  let sinceHud = 0;
  const bus = { off: [] };

  // ------------------------------------------------------------------ what is kept on this device
  const disk = {
    read() { try { const v = JSON.parse(localStorage.getItem(STORE) || 'null'); return v && typeof v === 'object' ? v : {}; } catch { return {}; } },
    write(v) { try { localStorage.setItem(STORE, JSON.stringify(v)); } catch { /* full or private: the best still lives in the memory */ } },
  };
  const memory = () => (H.memory && H.memory.raceBests) || null;
  function bestOf(id) {
    const d = disk.read()[id];
    const m = memory();
    const a = d && d.best > 0 ? d.best : 0, b = m ? Number(m.get()[id]) || 0 : 0;
    return a && b ? Math.min(a, b) : a || b;
  }
  const ghostOf = (id) => { const d = disk.read()[id]; return d ? C.cleanGhost(d.ghost) : null; };
  const nameOf = () => { const l = H.presence && H.presence.look; return (l && l.name) || 'You'; };
  function boardOf(id) {
    const c = courses.find((x) => x.def.id === id);
    if (!c) return [];
    const d = disk.read()[id];
    return C.board(d && d.runs, c.def.par ? { name: c.def.rival, ms: c.def.par } : null);
  }
  function keep(def, ms, ghost, splits) {
    const all = disk.read();
    const d = all[def.id] || (all[def.id] = {});
    d.runs = C.addRun(d.runs, { ms, name: nameOf(), at: Date.now() });
    const best = bestOf(def.id);
    const isBest = !best || ms < best;
    if (isBest) {
      d.best = ms; d.ghost = ghost; d.splits = splits;
    } else if (!d.best || ms < d.best) {
      d.best = ms; // (the account had a better one, this device's is better than its own)
    }
    disk.write(all);
    const m = memory();
    if (m && isBest) m.set(def.id, ms);
    return isBest;
  }

  // ------------------------------------------------------------------ sound: a few beeps of our own, assets when the world has them
  function beep(freq, seconds, volume = 0.18) {
    try {
      const A = H.audio, ac = A && A.context;
      if (!ac || ac.state !== 'running') return;
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = 'square'; o.frequency.value = freq;
      g.gain.setValueAtTime(volume, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + seconds);
      o.connect(g); g.connect(A.master || ac.destination);
      o.start(); o.stop(ac.currentTime + seconds + 0.02);
    } catch { /* silent */ }
  }
  function sfx(kind) {
    const names = (cfg && cfg.sounds) || {};
    const name = names[kind];
    if (name && G && G.hasAsset(name)) { G.sound(name, { volume: 0.5 }); return; }
    if (kind === 'tick') beep(520, 0.12);
    else if (kind === 'go') beep(1040, 0.5, 0.22);
    else if (kind === 'gate') beep(780, 0.16, 0.14);
    else if (kind === 'lap') { beep(660, 0.12); setTimeout(() => beep(990, 0.2), 130); }
    else if (kind === 'finish' || kind === 'best') { beep(660, 0.14); setTimeout(() => beep(880, 0.14), 150); setTimeout(() => beep(1320, kind === 'best' ? 0.5 : 0.3), 300); }
  }

  // ------------------------------------------------------------------ the world and the engine's moving frame
  const planet = () => (G && G.planet) || null;
  const toPlanet = (p) => { const pl = planet(); return pl && pl.round ? pl.toPlanet(p) : p; };
  const toLocal = (p) => { const pl = planet(); return pl && pl.round ? pl.toLocal(p) : p; };
  const vec = (v) => (Array.isArray(v) ? v : [v.x, v.y, v.z]);
  /** Where the vehicle (or the player) is, in the world file's numbers. */
  function where(e) {
    const q = vec(toPlanet([e.x, e.y, e.z]));
    return { x: q[0], y: q[1], z: q[2] };
  }

  // ------------------------------------------------------------------ the gates: pillars and a banner of light
  const LOOK = {
    off: null,
    dim: { opacity: 0.2, glow: 0.35 },
    next: { opacity: 0.8, glow: 1 },
    idle: { opacity: 0.5, glow: 0.8 },
    done: { opacity: 0.9, glow: 1 },
  };
  function mix(hex, k) { // a color scaled toward black by k (the glow)
    const n = parseInt(hex.slice(1), 16);
    const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v * Math.max(0, Math.min(1, k))));
    return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  }
  function build() {
    if (built || !G || !cfg) return;
    built = true;
    courses = [];
    for (const raw of (Array.isArray(cfg.courses) ? cfg.courses : [])) {
      const def = C.course(raw);
      if (!def) continue;
      const gates = C.gates(def.gates, def.width / 2);
      for (const g of gates) {
        const yaw = (Math.atan2(-g.lz, g.lx) * 180) / Math.PI;
        const first = g.i === 0;
        const col = first ? '#ffffff' : def.color;
        const mk = (id, make, o) => { const e = make.call(G, { ...o, physics: 'none', shadow: false, visible: false, name: 'Race gate', tag: 'race-gate', data: { race: def.id, gate: g.i } }); e.__gate = { gate: g, role: id }; return e; };
        const ph = first ? 18 : 14; // the start gate stands taller
        const side = (sgn) => {
          const p = [g.x + g.lx * g.half * sgn, g.y + ph / 2, g.z + g.lz * g.half * sgn];
          return mk('post', G.cylinder, { position: toLocal(p), radius: 0.34, height: ph, color: col, emissive: col, opacity: 0.5 });
        };
        g.left = side(-1); g.right = side(1);
        g.bar = mk('bar', G.box, { position: toLocal([g.x, g.y + ph - 1.6, g.z]), rotation: [0, yaw, 0], size: [def.width, 2.4, 0.08], color: def.color, emissive: def.color, opacity: 0.25 });
        g.look = 'off';
      }
      courses.push({ def, gates });
    }
    reset();
  }
  function paint(g, def, state) {
    if (g.look === state) return;
    g.look = state;
    const L = LOOK[state];
    for (const e of [g.left, g.right, g.bar]) {
      if (!e || !e.alive) continue;
      if (!L) { e.visible = false; continue; }
      const base = e === g.bar || g.i !== 0 ? def.color : '#ffffff';
      e.visible = true;
      e.opacity = e === g.bar ? L.opacity * 0.45 : L.opacity;
      e.emissive = mix(base, L.glow);
    }
  }
  /** Which gates are lit: idle shows every course's start gate; a race lights the next few of its own. */
  function light() {
    for (const c of courses) {
      const mine = run && run.course === c;
      c.gates.forEach((g, i) => {
        if (!run) return paint(g, c.def, i === 0 ? 'idle' : 'off');
        if (!mine) return paint(g, c.def, 'off');
        const n = c.gates.length;
        const ahead = (g.i - run.target + n) % n; // 0 = the one to take, 1 and 2 = after
        paint(g, c.def, ahead === 0 ? 'next' : ahead < lit() && run.cp + ahead < run.total ? 'dim' : 'off');
      });
    }
  }
  /** A gate stays where it is on the planet as the engine's frame moves (checked twice a second, only the lit ones). */
  function heal() {
    for (const c of courses) for (const g of c.gates) {
      if (g.look === 'off') continue;
      const ph = g.i === 0 ? 18 : 14;
      const want = [[g.left, [g.x - g.lx * g.half, g.y + ph / 2, g.z - g.lz * g.half]], [g.right, [g.x + g.lx * g.half, g.y + ph / 2, g.z + g.lz * g.half]], [g.bar, [g.x, g.y + ph - 1.6, g.z]]];
      for (const [e, p] of want) {
        if (!e || !e.alive) continue;
        const l = vec(toLocal(p));
        if (Math.hypot(e.x - l[0], e.y - l[1], e.z - l[2]) > 0.8) e.position = l;
      }
    }
  }
  /** The next gate pulses (a breath of light, so the eye finds it). */
  function pulse(t) {
    if (!run) return;
    const g = run.course.gates[run.target];
    if (!g || g.look !== 'next') return;
    const k = 0.72 + 0.2 * Math.sin(t * 6);
    for (const e of [g.left, g.right]) if (e && e.alive) e.opacity = k;
  }

  // ------------------------------------------------------------------ the screen: the clock, the countdown, the result
  const CSS = [
    'body.racing .tour-track,body.racing .tour-stuck{display:none!important}',
    '.race-hud{position:fixed;left:50%;top:max(10px,env(safe-area-inset-top));transform:translateX(-50%);z-index:26;min-width:176px;box-sizing:border-box;padding:7px 14px 8px;border-radius:14px;background:rgba(10,14,24,.72);border:1px solid rgba(255,255,255,.18);color:#fff;font:600 13px system-ui,sans-serif;text-align:center;pointer-events:none;backdrop-filter:blur(6px)}',
    '.race-hud[hidden]{display:none}',
    '.race-hud .n{display:block;font:800 10.5px system-ui,sans-serif;letter-spacing:.09em;text-transform:uppercase;color:#7dd3fc}',
    '.race-hud .t{display:block;font:800 30px ui-monospace,Menlo,Consolas,monospace;letter-spacing:.02em;line-height:1.15}',
    '.race-hud .s{display:block;min-height:15px;font:700 13px ui-monospace,Menlo,Consolas,monospace;color:#cbd5e1}',
    '.race-hud .s.up{color:#fca5a5}.race-hud .s.down{color:#86efac}',
    '.race-hud .b{display:block;font:600 11px system-ui,sans-serif;color:#94a3b8}',
    '.race-count{position:fixed;left:50%;top:34%;transform:translate(-50%,-50%);z-index:27;font:900 clamp(72px,18vw,150px)/1 system-ui,sans-serif;color:#fff;text-shadow:0 4px 0 rgba(0,0,0,.35),0 0 40px rgba(125,211,252,.7);pointer-events:none;animation:race-pop .9s ease-out}',
    '.race-count[hidden]{display:none}.race-count.go{color:#86efac}',
    '@keyframes race-pop{0%{transform:translate(-50%,-50%) scale(1.7);opacity:0}25%{opacity:1}100%{transform:translate(-50%,-50%) scale(1);opacity:.95}}',
    '.race-card{position:fixed;left:50%;top:22%;transform:translateX(-50%);z-index:27;width:min(340px,calc(100vw - 24px));box-sizing:border-box;padding:14px 16px;border-radius:16px;background:rgba(10,14,24,.88);border:1px solid rgba(255,255,255,.2);color:#fff;font:600 14px system-ui,sans-serif;animation:race-in .3s ease-out}',
    '.race-card[hidden]{display:none}',
    '.race-card h3{margin:0 0 2px;font:800 11px system-ui,sans-serif;letter-spacing:.09em;text-transform:uppercase;color:#7dd3fc}',
    '.race-card .big{font:800 36px ui-monospace,Menlo,Consolas,monospace}',
    '.race-card .note{margin:2px 0 8px;color:#fde68a}',
    '.race-card ol{margin:6px 0 0;padding:0;list-style:none;font:600 13px ui-monospace,Menlo,Consolas,monospace}',
    '.race-card li{display:flex;gap:8px;padding:2px 0}.race-card li b{flex:0 0 22px;color:#94a3b8}.race-card li span{flex:1}.race-card li.me{color:#86efac}.race-card li.rival{color:#fcd34d}',
    '@keyframes race-in{from{opacity:0;transform:translate(-50%,-6px)}to{opacity:1;transform:translate(-50%,0)}}',
  ].join('\n');
  function style() {
    if (typeof document === 'undefined' || document.getElementById('race-style')) return;
    const st = document.createElement('style');
    st.id = 'race-style'; st.textContent = CSS;
    document.head.appendChild(st);
  }
  function ui() {
    if (hud || !G || typeof document === 'undefined') return hud;
    style();
    G.ui.remove('race-hud');
    const el = G.ui.html('race-hud', '', { class: 'race-hud' });
    el.removeAttribute('style'); // (its own place: CSS above)
    el.hidden = true;
    hud = { el };
    for (const k of ['n', 't', 's', 'b']) { const s = document.createElement('span'); s.className = k; el.appendChild(s); hud[k] = s; }
    return hud;
  }
  function drawHud() {
    const h = ui();
    if (!h) return;
    const on = Boolean(run && run.phase !== 'ended');
    h.el.hidden = !on;
    if (typeof document !== 'undefined' && document.body) document.body.classList.toggle('racing', on);
    if (!on) return;
    const c = run.course.def;
    const ms = run.phase === 'running' ? now() - run.t0 : 0;
    h.n.textContent = `${c.name}${c.laps > 1 ? ` · lap ${Math.min(run.lap + 1, c.laps)} of ${c.laps}` : ''}`;
    h.t.textContent = run.phase === 'countdown' ? 'READY' : C.fmt(ms * 1000);
    h.s.textContent = run.split ? run.split.text : '';
    h.s.className = `s ${run.split ? run.split.dir : ''}`;
    const best = run.best;
    h.b.textContent = best ? `Best ${C.fmt(best)}${run.ghost ? ' · ghost on' : ''}` : c.par ? `${c.rival}'s time ${C.fmt(c.par)}` : 'No best yet';
  }
  let countEl = null;
  function count(text, go) {
    if (typeof document === 'undefined' || !G) return;
    if (!countEl) { G.ui.remove('race-count'); countEl = G.ui.html('race-count', '', { class: 'race-count' }); countEl.removeAttribute('style'); }
    countEl.hidden = !text;
    countEl.textContent = text || '';
    countEl.classList.toggle('go', Boolean(go));
    // (restarts the pop animation)
    countEl.style.animation = 'none'; void countEl.offsetWidth; countEl.style.animation = '';
  }
  let cardEl = null, cardTimer = null;
  function card(html, seconds) {
    if (typeof document === 'undefined' || !G) return;
    if (!cardEl) { G.ui.remove('race-card'); cardEl = G.ui.html('race-card', '', { class: 'race-card' }); cardEl.removeAttribute('style'); }
    cardEl.innerHTML = html;
    cardEl.hidden = false;
    if (cardTimer) clearTimeout(cardTimer);
    cardTimer = seconds ? setTimeout(() => { if (cardEl) cardEl.hidden = true; }, seconds * 1000) : null;
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function boardHtml(id) {
    const rows = boardOf(id);
    const me = nameOf();
    return `<ol>${rows.map((r) => `<li class="${r.rival ? 'rival' : r.name === me ? 'me' : ''}"><b>${r.rank}</b><span>${esc(r.name)}</span>${C.fmt(r.ms)}</li>`).join('')}</ol>`;
  }
  function showBoard(id) {
    const c = courses.find((x) => x.def.id === id) || courses[0];
    if (!c) return;
    card(`<h3>${esc(c.def.name)} · best on this device</h3>${boardHtml(c.def.id)}`, 12);
    refreshBoards();
  }

  // ------------------------------------------------------------------ the race
  const now = () => (G ? G.time : 0);
  const emit = (d) => { try { G.emit('race', d); } catch { /* a listener's trouble is its own */ } };
  function vehicleOf() {
    const v = G && G.vehicles && G.vehicles.current;
    return v && v.alive && v.vehicle && !v.vehicle.wrecked ? v : null;
  }
  const classOf = (v) => (v && v.vehicle && v.vehicle.def && v.vehicle.def.class) || '';
  const fits = (c, v) => Boolean(v) && (classOf(v) === c.def.vehicle || String(v.vehicle.type || '') === c.def.vehicle);

  /** The countdown holds the vehicle where it crossed the line (the Overseer's light holds it still), so everyone starts
   *  from the line at a standstill: the clock is the same for a slow arrival and a fast one. */
  function hold(v) {
    if (!v || !run) return;
    run.held = { e: v, physics: v.physics === 'static' ? 'dynamic' : v.physics };
    v.velocity = [0, 0, 0];
    try { v.physics = 'static'; } catch { run.held = null; }
  }
  function release() {
    const h = run && run.held;
    if (!h) return;
    run.held = null;
    try { if (h.e.alive) { h.e.physics = h.physics; h.e.velocity = [0, 0, 0]; } } catch { /* gone */ }
  }

  function begin(c, v) {
    const total = c.def.laps * c.gates.length;
    run = {
      course: c, phase: 'countdown', t0: 0, started: now(), lap: 0, cp: 0, total, target: 1 % c.gates.length, splits: [], rec: [], recAt: -1,
      ghost: ghostOf(c.def.id), best: bestOf(c.def.id), bestSplits: (disk.read()[c.def.id] || {}).splits || [], ghostE: null, split: null, ticked: -1, out: 0,
    };
    // (a ghost from a run of another length is no use)
    if (run.ghost && !Array.isArray(run.bestSplits)) run.bestSplits = [];
    hold(v);
    light();
    count('3'); sfx('tick'); run.ticked = 0;
    emit({ state: 'countdown', course: c.def.id, name: c.def.name, n: 3, laps: c.def.laps, best: run.best, par: c.def.par, rival: c.def.rival, vehicle: c.def.vehicle });
  }
  function go() {
    release();
    run.phase = 'running'; run.t0 = now();
    count('GO!', true); sfx('go');
    if (run.ghost) makeGhost();
    sample(0);
    emit({ state: 'go', course: run.course.def.id, ghost: Boolean(run.ghost) });
    setTimeout(() => { if (run && run.phase === 'running') count(''); }, 900);
  }
  function makeGhost() {
    const def = run.course.def;
    const boat = def.vehicle === 'boat';
    try {
      run.ghostE = G.box({ size: boat ? [2.2, 0.9, 5.2] : [2.1, 1.3, 4.6], color: '#7dd3fc', emissive: '#38bdf8', opacity: 0.32, physics: 'none', shadow: false, name: 'Ghost', tag: 'race-ghost', visible: false });
    } catch { run.ghostE = null; }
  }
  function moveGhost(ms) {
    const e = run.ghostE;
    if (!e || !e.alive) return;
    const s = C.ghostAt(run.ghost, ms);
    if (s.done && ms > run.ghost.ms + 1500) { e.visible = false; return; }
    const lift = run.course.def.vehicle === 'boat' ? 0.1 : 0.55;
    e.position = vec(toLocal([s.x, s.y + lift, s.z]));
    if (s.yaw !== null) e.rotation = [0, s.yaw, 0];
    e.visible = true;
  }
  function sample(ms) {
    const v = vehicleOf();
    if (!v) return;
    const p = where(v);
    run.rec.push(p.x, p.y, p.z);
    run.recAt = ms;
  }
  function endRun() {
    release();
    if (run && run.ghostE && run.ghostE.alive) { try { run.ghostE.destroy(); } catch { /* gone */ } }
    run = null; prev = null;
    count('');
    light(); drawHud();
  }
  function abort(why) {
    if (!run) return false;
    const was = run.course.def.id;
    emit({ state: 'abort', course: was, why: why || 'abort' });
    endRun();
    cool = 2;
    return true;
  }

  function hit(cpMs) {
    const c = run.course, n = c.gates.length;
    const k = run.cp; // 0-based checkpoint just taken
    const lapEnd = (k + 1) % n === 0;
    run.cp += 1;
    run.splits.push(Math.round(cpMs));
    const ref = run.bestSplits && run.bestSplits[k];
    const delta = ref ? cpMs - ref : null;
    run.split = delta === null ? { text: C.fmt(cpMs), dir: '' } : { text: C.fmtDelta(delta), dir: delta > 0 ? 'up' : 'down' };
    if (run.cp >= run.total) return finish(cpMs);
    run.target = (run.target + 1) % n;
    if (lapEnd) {
      run.lap += 1;
      sfx('lap');
      emit({ state: 'lap', course: c.def.id, lap: run.lap, laps: c.def.laps, ms: Math.round(cpMs), delta });
    } else {
      sfx('gate');
      emit({ state: 'gate', course: c.def.id, index: k % n + 1, of: n, lap: run.lap + 1, ms: Math.round(cpMs), delta });
    }
    light();
  }
  function finish(ms) {
    const c = run.course, def = c.def;
    ms = Math.round(ms);
    const prevBest = run.best;
    const beatGhost = Boolean(run.ghost && ms < run.ghost.ms);
    const ghost = C.packGhost(run.rec, ms);
    const isBest = keep(def, ms, ghost, run.splits.slice());
    const beatPar = Boolean(def.par && ms < def.par);
    sfx(isBest ? 'best' : 'finish');
    emit({ state: 'finish', course: def.id, name: def.name, ms, best: isBest ? ms : prevBest, previous: prevBest, isBest, beatGhost, par: def.par, beatPar, rival: def.rival, laps: def.laps });
    const delta = prevBest ? ms - prevBest : null;
    const note = isBest ? (prevBest ? `New best! ${C.fmtDelta(delta)}` : 'Your first time. It is your best.') : `Best ${C.fmt(prevBest)} (${C.fmtDelta(delta)})`;
    card(`<h3>${esc(def.name)} · finish</h3><div class="big">${C.fmt(ms)}</div><div class="note">${esc(note)}${beatGhost ? ' You beat your ghost.' : ''}${beatPar ? ` Faster than ${esc(def.rival)}.` : ''}</div>${boardHtml(def.id)}`, 11);
    refreshBoards();
    run.phase = 'ended';
    const id = def.id;
    if (run.ghostE && run.ghostE.alive) { try { run.ghostE.destroy(); } catch { /* gone */ } }
    run = null; prev = null; cool = AFTER;
    count('');
    light(); drawHud();
    return id;
  }

  // ------------------------------------------------------------------ every step
  function update(dt) {
    if (!G || !cfg || G.mode !== 'play' || !G.player) return;
    if (!built) build();
    if (!courses.length) return;
    const t = now();
    sinceCheck += dt; sinceHud += dt;
    if (sinceCheck > 0.5) { sinceCheck = 0; heal(); }
    cool = Math.max(0, cool - dt);
    const v = vehicleOf();
    const cur = v ? where(v) : null;
    if (!run) {
      if (v && cur && prev && cool <= 0) {
        for (const c of courses) {
          if (!fits(c, v)) continue;
          if (C.crossed(prev, cur, c.gates[0]) !== null) { begin(c, v); break; }
        }
      }
      prev = cur;
      if (sinceHud > 0.25) { sinceHud = 0; drawHud(); }
      return;
    }
    // under way
    const c = run.course;
    if (!v || !fits(c, v)) run.out += dt; else run.out = 0;
    if (run.out > GRACE) return void abort('left');
    if (v && v.vehicle.wrecked) return void abort('wrecked');
    if (cur && Math.hypot(cur.x - c.gates[0].x, cur.z - c.gates[0].z) > FAR) return void abort('far');
    if (run.phase === 'countdown') {
      const el = t - run.started;
      const n = Math.floor(el);
      if (n !== run.ticked && n < COUNT) { run.ticked = n; count(String(COUNT - n)); sfx('tick'); emit({ state: 'countdown', course: c.def.id, n: COUNT - n }); }
      if (el >= COUNT) go();
      prev = cur;
      if (sinceHud > 0.1) { sinceHud = 0; drawHud(); }
      return;
    }
    const ms = (t - run.t0) * 1000;
    // the way through the next gate
    if (cur && prev) {
      const g = c.gates[run.target];
      const f = C.crossed(prev, cur, g);
      if (f !== null) hit(ms - (1 - f) * dt * 1000);
    }
    if (!run) return; // (that was the finish)
    prev = cur;
    if (ms - run.recAt >= C.GHOST_STEP) sample(ms);
    if (run.ghost) moveGhost(ms);
    pulse(t);
    if (sinceHud > 0.1) { sinceHud = 0; drawHud(); }
  }

  // ------------------------------------------------------------------ the board by the pier (a thing with data.raceBoard)
  const signs = new Map();
  function W() { return H.world; }
  function boardText(c) {
    const rows = boardOf(c.def.id).slice(0, 4);
    return `${c.def.name.toUpperCase()}\n${rows.length ? rows.map((r) => `${r.rank}. ${r.name.slice(0, 12)} ${C.fmt(r.ms)}`).join('\n') : 'No times yet'}`;
  }
  function refreshBoards() {
    const w = W();
    if (!w || !courses.length) return;
    for (const e of w.entities) {
      if (!e.data || !e.data.raceBoard || !e.node) continue;
      const c = courses.find((x) => x.def.id === e.data.raceBoard) || courses[0];
      const words = boardText(c);
      const b = signs.get(e);
      if (b && b.words === words && !b.mesh.isDisposed()) continue;
      if (b) b.mesh.dispose();
      const mesh = H.textPlane(words, { size: 0.11, billboard: false, color: '#f8f1e4', background: 'rgba(40,24,12,0.0)' });
      mesh.parent = e.node; mesh.position.set(0, 0, 0.06); mesh.rotation.y = Math.PI; mesh.isPickable = false; mesh.metadata = { decor: true };
      signs.set(e, { mesh, words });
    }
  }
  if (H.use) {
    H.use.register('race:board', {
      near(p) {
        const w = W();
        if (!w || !courses.length) return null;
        let best = null, bd = 3.4;
        for (const e of w.entities) { if (!e.data || !e.data.raceBoard || !e.node) continue; const d = Math.hypot(e.x - p.x, e.z - p.z); if (d < bd) { bd = d; best = e; } }
        return best && { label: 'Read the race board', distance: bd, act: () => showBoard(best.data.raceBoard) };
      },
    });
  }
  H.hooks.world.push({
    enter() { signs.clear(); setTimeout(refreshBoards, 500); setTimeout(refreshBoards, 3500); },
    leave() { signs.clear(); document.querySelectorAll('.race-hud, .race-count, .race-card').forEach((el) => el.remove()); if (document.body) document.body.classList.remove('racing'); },
  });

  // ------------------------------------------------------------------ the feature and game.race
  function reset() { run = null; prev = null; cool = 0; light(); }
  function teardown() {
    for (const c of courses) for (const g of c.gates) for (const e of [g.left, g.right, g.bar]) { try { if (e && e.alive) e.destroy(); } catch { /* gone */ } }
    if (run && run.ghostE && run.ghostE.alive) { try { run.ghostE.destroy(); } catch { /* gone */ } }
    courses = []; built = false; run = null; prev = null; hud = null; countEl = null; cardEl = null;
  }
  H.features.register('race', {
    codex: {
      title: 'Races', group: 'World features',
      what: 'Lit gates to drive through: a countdown at the first gate, a lap clock, a best time, a ghost of the best run and a board.',
      value: { courses: [{ id: 'loop', name: 'The loop', vehicle: 'wheeled', laps: 2, width: 14, color: '#34d399', gates: [[0, 20], [20, 0], [0, -20], [-20, 0]] }] },
      fields: [['courses', 'a list: id, name, vehicle (a class: wheeled, boat, heli... or a type), laps, width, color, par (ms, the rival\'s time), rival, gates [[x, z, y], ...] (the first is the start and finish line)', '[]'], ['sounds', 'optional asset names: tick, go, gate, lap, finish, best', '{}']],
    },
    apply(value, ctx) { cfg = value && typeof value === 'object' ? value : null; if (ctx && ctx.game) G = ctx.game; built = false; },
    change(value, old, ctx) { teardown(); cfg = value && typeof value === 'object' ? value : null; if (ctx && ctx.game) G = ctx.game; },
    update(dt, ctx) { if (ctx && ctx.game) G = ctx.game; try { update(dt); } catch (err) { H.report(err, 'race'); } },
    dispose() { teardown(); cfg = null; },
  });
  H.hooks.game.push((game) => {
    G = game;
    game.on('rescue', () => { if (run) abort('rescue'); });
    game.race = {
      get courses() { return courses.map((c) => ({ ...c.def, gates: c.gates.map((g) => ({ x: g.x, y: g.y, z: g.z, dx: g.dx, dz: g.dz })) })); },
      get state() {
        if (!run) return { phase: 'idle', course: null };
        return { phase: run.phase, course: run.course.def.id, lap: run.lap + 1, laps: run.course.def.laps, ms: run.phase === 'running' ? Math.round((now() - run.t0) * 1000) : 0, next: run.target, checkpoint: run.cp, of: run.total };
      },
      best: (id) => bestOf(id),
      ghost: (id) => ghostOf(id),
      board: (id) => boardOf(id),
      showBoard,
      abort,
      /** Sets a course's laps (a playtest's shortcut, or a game with a shorter mode): not while racing it. */
      setLaps(id, n) { const c = courses.find((x) => x.def.id === id); if (!c || (run && run.course === c)) return false; c.def.laps = Math.max(1, Math.min(9, Math.floor(Number(n)) || 1)); return true; },
    };
  });
  H.race = { core: C, bestOf, boardOf, _internal: { courses: () => courses, run: () => run, disk } };
})();
