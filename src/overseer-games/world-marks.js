// Chapter One world marks (docs/story.md §5): each finished tour quest leaves a lasting, visible change near where it
// happened — road markers, lit pier lamps and a fish mural, a fenced blast site, a beam pad, Ember's ribbon, Dolores's
// cairn, helipad lights and a windsock, a hangar banner. Built as grounded Babylon decor (no Gen 3D). Kept in the
// Overseer's memory (`marks`: { done, last }) and mirrored onto the island's scene config (`chapterMarks`) so goLive /
// save persist it with the island. A short celebration (sparkle, sound, nearby islander bark) plays once when a mark
// appears; a return visit pans the camera across the newest mark for 3–5 s with an Overseer line.
//
//   window.__island.marks  { list, last, at, apply, celebrate, panNewest, MARKS }
//   game.on('world-change', { step, first, at, cheer })
//   game.on('world-mark-pan', { step, ms })
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const game = H && H.game;
  if (!H || !game || (window.__island && window.__island.marks)) return;

  const STEPS = ['drive', 'fish', 'boom', 'spawn', 'ask', 'hill', 'fly', 'launch'];
  const MARKS = {
    // Painted road chevrons near the dock end of Gravel Road (quest: drive).
    drive: {
      at: [54, 0.02, 0], look: [58, 0.4, 0], who: 'pip',
      cheer: 'The road kept your tracks. Look!',
      overseer: 'The road remembers. Good.',
      build: (B, sc, y) => {
        const meshes = [];
        for (let i = 0; i < 5; i++) {
          const x = 48 + i * 2.2;
          const m = B.MeshBuilder.CreateBox(`wm-drive-${i}`, { width: 0.55, height: 0.04, depth: 0.9 }, sc);
          m.position.set(x, y(x, 0) + 0.03, (i % 2 === 0 ? 0.55 : -0.55));
          m.rotation.y = (i % 2 === 0 ? -0.18 : 0.18);
          mat(m, '#f4c430', 0.15);
          m.isPickable = false; m.metadata = { decor: true, worldMark: 'drive' };
          meshes.push(m);
        }
        return meshes;
      },
    },
    // Pier lamps light warmer and a fish mural sits on the pier deck (quest: fish).
    fish: {
      at: [72, 1.2, -1.4], look: [72, 1.6, -1.4], who: 'bobbin',
      cheer: 'The lamps are lit. The harbour remembers your cast.',
      overseer: 'The sea left a mark. The lamps stay on.',
      build: (B, sc, y) => {
        const meshes = [], lights = [];
        const pierY = 0.95;
        const mural = B.MeshBuilder.CreateBox('wm-fish-mural', { width: 1.6, height: 1.05, depth: 0.08 }, sc);
        mural.position.set(72, pierY + 0.7, -1.55);
        mat(mural, '#1e3a5f', 0.05);
        mural.isPickable = false; mural.metadata = { decor: true, worldMark: 'fish' };
        meshes.push(mural);
        const fish = B.MeshBuilder.CreateBox('wm-fish-shape', { width: 0.9, height: 0.35, depth: 0.06 }, sc);
        fish.position.set(72, pierY + 0.75, -1.5);
        mat(fish, '#7dd3fc', 0.45);
        fish.isPickable = false; fish.metadata = { decor: true, worldMark: 'fish' };
        meshes.push(fish);
        for (const [id, x, z] of [['a', 61, -2.4], ['b', 61, 2.4]]) {
          const g = y(x, z);
          const glow = B.MeshBuilder.CreateSphere(`wm-lamp-glow-${id}`, { diameter: 0.45, segments: 10 }, sc);
          glow.position.set(x, g + 3.05, z);
          mat(glow, '#ffd27a', 1.2);
          glow.isPickable = false; glow.metadata = { decor: true, worldMark: 'fish' };
          meshes.push(glow);
          const L = new B.PointLight(`wm-lamp-${id}`, new B.Vector3(x, g + 3.1, z), sc);
          L.diffuse = new B.Color3(1, 0.85, 0.45); L.intensity = 0.85; L.range = 14;
          lights.push(L);
        }
        return { meshes, lights };
      },
    },
    // Scorch ring fenced as a blast site with a sign (quest: boom).
    boom: {
      at: [50.5, 0.2, -18], look: [50.5, 0.8, -18], who: 'channel',
      cheer: 'Breaking: a blast site. Fenced. Historic. Ratings: record.',
      overseer: 'Destruction left a place. It stays.',
      build: (B, sc, y) => {
        const meshes = [];
        const cx = 50.5, cz = -18;
        const scorch = B.MeshBuilder.CreateCylinder('wm-scorch', { diameter: 4.2, height: 0.05, tessellation: 20 }, sc);
        scorch.position.set(cx, y(cx, cz) + 0.03, cz);
        mat(scorch, '#2a1a12', 0.05);
        scorch.isPickable = false; scorch.metadata = { decor: true, worldMark: 'boom' };
        meshes.push(scorch);
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          const x = cx + Math.cos(a) * 2.3, z = cz + Math.sin(a) * 2.3;
          const post = B.MeshBuilder.CreateCylinder(`wm-fence-${i}`, { diameter: 0.12, height: 1.1, tessellation: 8 }, sc);
          post.position.set(x, y(x, z) + 0.55, z);
          mat(post, '#6b7280', 0.1);
          post.isPickable = false; post.metadata = { decor: true, worldMark: 'boom' };
          meshes.push(post);
        }
        const board = B.MeshBuilder.CreateBox('wm-blast-sign', { width: 1.35, height: 0.55, depth: 0.06 }, sc);
        board.position.set(cx + 0.2, y(cx, cz) + 1.35, cz + 2.6);
        mat(board, '#111827', 0.08);
        board.isPickable = false; board.metadata = { decor: true, worldMark: 'boom' };
        meshes.push(board);
        const pole = B.MeshBuilder.CreateCylinder('wm-blast-pole', { diameter: 0.1, height: 1.4, tessellation: 8 }, sc);
        pole.position.set(cx + 0.2, y(cx, cz) + 0.7, cz + 2.6);
        mat(pole, '#4b5563', 0.1);
        pole.isPickable = false; pole.metadata = { decor: true, worldMark: 'boom' };
        meshes.push(pole);
        // Words as a flat emissive plate (readable from the beach camera; not mirrored).
        const label = B.MeshBuilder.CreatePlane('wm-blast-label', { width: 1.2, height: 0.35 }, sc);
        label.position.set(cx + 0.2, y(cx, cz) + 1.35, cz + 2.64);
        label.billboardMode = B.Mesh.BILLBOARDMODE_Y;
        const lm = new B.StandardMaterial('wm-blast-label-mat', sc);
        lm.emissiveColor = new B.Color3(1, 0.85, 0.35); lm.disableLighting = true; lm.backFaceCulling = false;
        label.material = lm; label.isPickable = false; label.metadata = { decor: true, worldMark: 'boom', label: 'BLAST SITE' };
        meshes.push(label);
        return meshes;
      },
    },
    // A small glowing pad where the Overseer's first gift landed (quest: spawn).
    spawn: {
      at: [2, 0.15, 6], look: [2, 0.8, 6], who: 'pip',
      cheer: 'That spot glowed. The Overseer left a mark.',
      overseer: 'A place where something arrived. It is still warm.',
      build: (B, sc, y) => {
        const meshes = [], lights = [];
        const x = 2, z = 6, g = y(x, z);
        const pad = B.MeshBuilder.CreateCylinder('wm-spawn-pad', { diameter: 1.8, height: 0.08, tessellation: 20 }, sc);
        pad.position.set(x, g + 0.05, z);
        mat(pad, '#93c5fd', 0.55);
        pad.isPickable = false; pad.metadata = { decor: true, worldMark: 'spawn' };
        meshes.push(pad);
        const ring = B.MeshBuilder.CreateTorus('wm-spawn-ring', { diameter: 1.6, thickness: 0.06, tessellation: 24 }, sc);
        ring.position.set(x, g + 0.12, z);
        mat(ring, '#60a5fa', 0.9);
        ring.isPickable = false; ring.metadata = { decor: true, worldMark: 'spawn' };
        meshes.push(ring);
        const L = new B.PointLight('wm-spawn-light', new B.Vector3(x, g + 1.4, z), sc);
        L.diffuse = new B.Color3(0.55, 0.75, 1); L.intensity = 0.55; L.range = 8;
        lights.push(L);
        return { meshes, lights };
      },
    },
    // A ribbon on Mrs Ember's mailbox (quest: ask).
    ask: {
      at: [-12.5, 0.4, 17], look: [-12.5, 1.0, 17], who: 'ember',
      cheer: 'A ribbon on the box, dear. For the new one. Sorry.',
      overseer: 'A letter found its place. The ribbon stays.',
      build: (B, sc, y) => {
        const meshes = [];
        // Prefer the mailbox entity if it exists; else the known mailbox spot.
        const box = (game.find && (game.find('mailbox') || game.find('ember_mailbox'))) || null;
        const px = box ? box.x : -12.5, pz = box ? box.z : 17;
        const g = y(px, pz);
        const bow = B.MeshBuilder.CreateBox('wm-ribbon', { width: 0.35, height: 0.18, depth: 0.08 }, sc);
        bow.position.set(px + 0.15, g + 1.15, pz + 0.2);
        mat(bow, '#fb923c', 0.35);
        bow.isPickable = false; bow.metadata = { decor: true, worldMark: 'ask' };
        meshes.push(bow);
        const tail = B.MeshBuilder.CreateBox('wm-ribbon-tail', { width: 0.08, height: 0.45, depth: 0.04 }, sc);
        tail.position.set(px + 0.15, g + 0.9, pz + 0.2);
        mat(tail, '#ea580c', 0.25);
        tail.isPickable = false; tail.metadata = { decor: true, worldMark: 'ask' };
        meshes.push(tail);
        return meshes;
      },
    },
    // A small cairn near Dolores on the hill (quest: hill).
    hill: {
      at: [28, 0.3, 28], look: [28, 1.0, 28], who: 'dolores',
      cheer: 'I put a stone. I was not waiting. It is there.',
      overseer: 'A stone on the hill. She left it for you.',
      build: (B, sc, y) => {
        const meshes = [];
        const x = 28, z = 28, g = y(x, z);
        [[0.55, 0.28, 0], [0.4, 0.5, 0.12], [0.28, 0.7, -0.08]].forEach(([d, h, ox], i) => {
          const s = B.MeshBuilder.CreateSphere(`wm-cairn-${i}`, { diameter: d, segments: 8 }, sc);
          s.position.set(x + ox, g + h, z);
          mat(s, i === 2 ? '#a3a3a3' : '#78716c', 0.05);
          s.isPickable = false; s.metadata = { decor: true, worldMark: 'hill' };
          meshes.push(s);
        });
        return meshes;
      },
    },
    // Windsock and landing-pad edge lights (quest: fly).
    fly: {
      at: [30, 0.4, 30], look: [30, 1.2, 30], who: 'dolores',
      cheer: 'The pad lights. The windsock. Use them. Or do not.',
      overseer: 'The pad is ready. The view was yours.',
      build: (B, sc, y) => {
        const meshes = [], lights = [];
        const hx = 30, hz = 30, g = y(hx, hz);
        const pole = B.MeshBuilder.CreateCylinder('wm-windsock-pole', { diameter: 0.08, height: 2.4, tessellation: 8 }, sc);
        pole.position.set(hx + 5.2, g + 1.2, hz + 0.4);
        mat(pole, '#9ca3af', 0.1);
        pole.isPickable = false; pole.metadata = { decor: true, worldMark: 'fly' };
        meshes.push(pole);
        const sock = B.MeshBuilder.CreateCylinder('wm-windsock', { diameterTop: 0.15, diameterBottom: 0.45, height: 1.1, tessellation: 10 }, sc);
        sock.position.set(hx + 5.2 + 0.55, g + 2.15, hz + 0.4);
        sock.rotation.z = Math.PI / 2;
        mat(sock, '#f97316', 0.35);
        sock.isPickable = false; sock.metadata = { decor: true, worldMark: 'fly' };
        meshes.push(sock);
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          const x = hx + Math.cos(a) * 4.6, z = hz + Math.sin(a) * 4.6;
          const bulb = B.MeshBuilder.CreateSphere(`wm-pad-light-${i}`, { diameter: 0.22, segments: 8 }, sc);
          bulb.position.set(x, y(x, z) + 0.12, z);
          mat(bulb, '#fde68a', 1.1);
          bulb.isPickable = false; bulb.metadata = { decor: true, worldMark: 'fly' };
          meshes.push(bulb);
          const L = new B.PointLight(`wm-pad-pl-${i}`, new B.Vector3(x, y(x, z) + 0.35, z), sc);
          L.diffuse = new B.Color3(1, 0.9, 0.5); L.intensity = 0.35; L.range = 5;
          lights.push(L);
        }
        return { meshes, lights };
      },
    },
    // Hangar-side banner and lit launch pad (quest: launch).
    launch: {
      at: [-38, 0.5, -30], look: [-38, 2.0, -30], who: 'rolo',
      cheer: 'huh. a banner. the pad is lit. that is fine.',
      overseer: 'The pad remembers the climb. Come when you will.',
      build: (B, sc, y) => {
        const meshes = [], lights = [];
        const rx = -38, rz = -30, g = y(rx, rz);
        const postL = B.MeshBuilder.CreateCylinder('wm-banner-l', { diameter: 0.1, height: 3.2, tessellation: 8 }, sc);
        postL.position.set(rx - 2.4, g + 1.6, rz + 3.2);
        mat(postL, '#64748b', 0.1);
        postL.isPickable = false; postL.metadata = { decor: true, worldMark: 'launch' };
        meshes.push(postL);
        const postR = B.MeshBuilder.CreateCylinder('wm-banner-r', { diameter: 0.1, height: 3.2, tessellation: 8 }, sc);
        postR.position.set(rx + 2.4, g + 1.6, rz + 3.2);
        mat(postR, '#64748b', 0.1);
        postR.isPickable = false; postR.metadata = { decor: true, worldMark: 'launch' };
        meshes.push(postR);
        const banner = B.MeshBuilder.CreateBox('wm-banner', { width: 4.6, height: 1.1, depth: 0.06 }, sc);
        banner.position.set(rx, g + 2.55, rz + 3.2);
        mat(banner, '#0ea5e9', 0.55);
        banner.isPickable = false; banner.metadata = { decor: true, worldMark: 'launch' };
        meshes.push(banner);
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2;
          const x = rx + Math.cos(a) * 2.8, z = rz + Math.sin(a) * 2.8;
          const bulb = B.MeshBuilder.CreateSphere(`wm-launch-light-${i}`, { diameter: 0.28, segments: 8 }, sc);
          bulb.position.set(x, y(x, z) + 0.2, z);
          mat(bulb, '#67e8f9', 1.2);
          bulb.isPickable = false; bulb.metadata = { decor: true, worldMark: 'launch' };
          meshes.push(bulb);
          const L = new B.PointLight(`wm-launch-pl-${i}`, new B.Vector3(x, y(x, z) + 0.5, z), sc);
          L.diffuse = new B.Color3(0.4, 0.9, 1); L.intensity = 0.5; L.range = 7;
          lights.push(L);
        }
        return { meshes, lights };
      },
    },
  };

  function mat(mesh, hex, emissive) {
    const B = H.BABYLON || window.BABYLON;
    const m = new B.StandardMaterial(mesh.name + '-mat', mesh.getScene());
    const c = B.Color3.FromHexString(hex);
    m.diffuseColor = c; m.specularColor = new B.Color3(0.05, 0.05, 0.05);
    if (emissive) m.emissiveColor = c.scale(Math.min(1, emissive));
    mesh.material = m;
    return m;
  }

  const state = (window.__worldMarks = window.__worldMarks || { done: [], last: null, built: {}, meshes: [], lights: [], celebrated: new Set() });

  function groundY(x, z) {
    try {
      const g = H.terrain && H.terrain.heightAt ? H.terrain.heightAt(x, z) : null;
      if (Number.isFinite(g)) return g;
    } catch { /* fall through */ }
    return 0;
  }

  function keep(step) {
    if (!STEPS.includes(step)) return false;
    if (!state.done.includes(step)) state.done.push(step);
    state.last = step;
    // Overseer's memory (account when signed in, device otherwise).
    try {
      if (H.memory && H.memory.marks) H.memory.marks.add(step);
    } catch { /* fine */ }
    // Island scene config so goLive / save persist with the island.
    try {
      const graph = H.world && H.world.graph;
      if (graph) {
        const cfg = graph.config || (graph.config = {});
        cfg.chapterMarks = { done: state.done.slice(), last: state.last };
      }
    } catch { /* fine */ }
    // guest.js return record (welcome-back pan).
    try {
      if (window.HawkesGuest && window.HawkesGuest.ret && typeof window.HawkesGuest.ret.patch === 'function') {
        window.HawkesGuest.ret.patch({ mark: step });
      }
    } catch { /* fine */ }
    return true;
  }

  function loadDone() {
    const fromMem = (H.memory && H.memory.marks && H.memory.marks.get()) || { done: [], last: null };
    const fromCfg = (H.world && H.world.graph && H.world.graph.config && H.world.graph.config.chapterMarks) || null;
    const fromRet = (() => { try { return (window.HawkesGuest && window.HawkesGuest.ret && window.HawkesGuest.ret.get && window.HawkesGuest.ret.get()) || null; } catch { return null; } })();
    const done = [];
    for (const src of [fromMem.done, fromCfg && fromCfg.done, null]) {
      if (!Array.isArray(src)) continue;
      for (const s of src) if (STEPS.includes(s) && !done.includes(s)) done.push(s);
    }
    // Also honour tour steps already played this session (resume / early).
    try {
      const played = window.__islandPlayed;
      if (played && typeof played.forEach === 'function') played.forEach((s) => { if (STEPS.includes(s) && !done.includes(s)) done.push(s); });
    } catch { /* fine */ }
    state.done = done;
    state.last = (fromMem.last && STEPS.includes(fromMem.last) && done.includes(fromMem.last) ? fromMem.last : null)
      || (fromCfg && STEPS.includes(fromCfg.last) && done.includes(fromCfg.last) ? fromCfg.last : null)
      || (fromRet && STEPS.includes(fromRet.mark) && done.includes(fromRet.mark) ? fromRet.mark : null)
      || (done.length ? done[done.length - 1] : null);
  }

  function disposeBuilt(step) {
    const b = state.built[step];
    if (!b) return;
    for (const m of b.meshes || []) try { m.dispose(); } catch { /* fine */ }
    for (const L of b.lights || []) try { L.dispose(); } catch { /* fine */ }
    delete state.built[step];
  }

  function applyOne(step, quiet) {
    const def = MARKS[step];
    if (!def) return null;
    const B = H.BABYLON || window.BABYLON;
    const sc = H.world && H.world.scene;
    if (!B || !sc) return null;
    if (state.built[step]) return state.built[step];
    const y = (x, z) => groundY(x, z);
    let out;
    try { out = def.build(B, sc, y); } catch (err) { try { if (H.report) H.report(err, 'world-marks'); } catch { /* fine */ } return null; }
    const pack = Array.isArray(out) ? { meshes: out, lights: [] } : { meshes: out.meshes || [], lights: out.lights || [] };
    state.built[step] = pack;
    state.meshes.push(...pack.meshes);
    state.lights.push(...pack.lights);
    if (!quiet) {
      try {
        const at = def.at;
        game.burst([at[0], groundY(at[0], at[2]) + 0.6, at[2]], { color: '#fff4c4', count: 28, speed: 3.2, size: 0.14 });
        game.burst([at[0], groundY(at[0], at[2]) + 1.8, at[2]], { color: '#7dd3fc', count: 22, speed: 4, size: 0.12 });
      } catch { /* fine */ }
      try { if (H.lib && H.lib.siteSound) H.lib.siteSound('ui-quest', { volume: 0.55 }); } catch { /* fine */ }
    }
    return pack;
  }

  function applyAll(quiet) {
    loadDone();
    for (const step of state.done) applyOne(step, true);
    if (!quiet && state.last) { /* already built quietly on return */ }
    return state.done.slice();
  }

  function cheer(step) {
    const def = MARKS[step];
    if (!def || !def.cheer) return null;
    const who = def.who;
    const text = def.cheer;
    const names = { pip: 'Pip', bobbin: 'Admiral Bobbin', ember: 'Mrs Ember', rolo: 'Rolo', dolores: 'Dolores', channel: 'Channel' };
    const label = names[who] || who;
    try {
      const e = game.find && game.find(who);
      if (e && H.living && H.living.command) {
        try { H.living.command(e, 'goto', { at: [def.at[0], def.at[2]], face: true }); } catch { /* fine */ }
      }
      if (e && e.lookAt && game.player) try { e.lookAt(game.player); } catch { /* fine */ }
      if (H.chat && H.chat.line) H.chat.line({ kind: 'npc', who: label, text, keep: 10 });
      if (e && e.say) try { e.say(text, Math.min(7, 2.5 + text.length / 18)); } catch { /* chat stands */ }
      const clip = (H.lib && H.lib.recordedLine && H.lib.recordedLine(who, text)) || null;
      // Play the clip when the entity's say did not (tests and some bodies have no voice bus).
      if (clip && H.audio && !e) {
        try { H.audio.play(clip, { bus: 'voice', volume: 0.9 }); } catch { /* fine */ }
      }
      game.emit('bark', { id: who, who: label, ctx: 'mark', text, clip, turned: true, dist: 0, at: Date.now(), mark: step });
      return { who: label, text, clip: Boolean(clip) };
    } catch { return { who: label, text, clip: false }; }
  }

  function celebrate(step) {
    if (!STEPS.includes(step) || state.celebrated.has(step)) return false;
    state.celebrated.add(step);
    keep(step);
    applyOne(step, false);
    const c = cheer(step);
    game.emit('world-change', { step, first: true, at: MARKS[step].at, cheer: c });
    return true;
  }

  function panNewest(o) {
    const step = (o && o.step) || state.last;
    const def = MARKS[step];
    if (!def) return Promise.resolve(false);
    applyOne(step, true);
    const cin = game.cinematic;
    const seconds = Math.max(3, Math.min(5, Number(o && o.seconds) || 4));
    const at = def.at;
    const look = def.look || [at[0], at[1] + 1, at[2]];
    const gy = groundY(at[0], at[2]);
    const line = (o && o.line) || def.overseer || 'This one is new. Look.';
    try {
      if (H.speech && H.speech.say) H.speech.say({ text: line, priority: 3, seconds });
      else if (H.chat) H.chat.line({ kind: 'overseer', text: line, keep: 12 });
    } catch { /* fine */ }
    game.emit('world-mark-pan', { step, ms: seconds * 1000, line });
    if (!(cin && cin.path)) return Promise.resolve(true);
    const camFrom = [at[0] - 6.5, gy + 3.2, at[2] - 5.5];
    const camTo = [at[0] - 3.8, gy + 2.4, at[2] - 3.2];
    return cin.path([
      { pos: camFrom, look: [look[0], gy + (look[1] || 1), look[2]], at: 0 },
      { pos: camTo, look: [look[0], gy + (look[1] || 1), look[2]], at: seconds - 0.2 },
    ], { seconds, fade: { in: 0.15, out: 0.25 }, letterbox: false, skippable: true, ease: 'inOut' })
      .then(() => true)
      .catch(() => true);
  }

  // ------------------------------------------------------------------ wiring
  game.on('tour', (d) => {
    if (!d || !MARKS[d.step]) return;
    // A resumed tour marks earlier steps played without celebration; only celebrate the live completion.
    const GU = window.HawkesGuest;
    if (GU && GU.skipped && GU.skipped.has && GU.skipped.has(d.step)) {
      keep(d.step);
      applyOne(d.step, true);
      game.emit('world-change', { step: d.step, first: false, at: MARKS[d.step].at, cheer: null });
      return;
    }
    game.after(0.85, () => celebrate(d.step));
  });

  game.on('welcome-back', (d) => {
    applyAll(true);
    if (!state.last) return;
    const delay = (d && d.delayMs) != null ? d.delayMs : 1600;
    game.after(delay / 1000, () => panNewest({ step: state.last, seconds: 4 }));
  });

  game.onStart(() => {
    game.after(2.5, () => applyAll(true));
  });

  window.__island = Object.assign(window.__island || {}, {
    marks: {
      MARKS, STEPS,
      list: () => state.done.slice(),
      last: () => state.last,
      at: (step) => (MARKS[step] && MARKS[step].at) || null,
      built: () => Object.keys(state.built),
      apply: applyAll,
      applyOne,
      celebrate,
      panNewest,
      keep,
      load: loadDone,
      dispose: () => { for (const s of Object.keys(state.built)) disposeBuilt(s); state.meshes.length = 0; state.lights.length = 0; },
    },
  });
})();
