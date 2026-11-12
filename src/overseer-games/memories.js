// Lore as memory (docs/story.md section 7 and "Memories"): picking up a lore object plays a short moment from the island's past on
// the spot. The world goes warm sepia with a soft vignette, two or three translucent glowing figures (the engine's own person
// bodies, a ghost material over them, no new 3D) walk their moment out where the object lies, the Overseer remembers it aloud in
// one recorded line, then the world returns with a shimmer. One tap (or Space) skips it. It never replays: the journal keeps
// the painted page (journal.js). Events: memory-start, memory-line, memory-end ({ id, ms, skipped }).
// Nothing here says why the Overseer does anything: it remembers the island, it does not explain it.
(function () {
  const H = window.HawkesPlay;
  const B = window.BABYLON;
  const SECONDS = 9; // every memory (6 to 12 s)
  const emit = (n, d) => { try { game.emit(n, d); } catch { /* fine */ } };
  const vox = (hash) => `/play/audio/voice/overseer-${hash}.mp3`;
  // Figures: islander or person bodies (presence-core cleanLook `what`), a tint, and a path of [seconds, dx, dz] from the object.
  const F = (what, body, path, o = {}) => ({ what, body, path, ...o });
  const MEMORIES = {
    logbook: { hash: '71c75ee1', text: 'Someone sat here and wrote down every ship that came. Then someone took three pages, and was careful about it.',
      figures: [F('duck', '#7aa7d8', [[0, -1.4, 0.2], [3, -1.1, 0.1], [9, -1.1, 0.1]]), F('person', '#d8a77a', [[0, -5, 3], [3, -2.2, 1.4], [5.5, -1.7, 0.7], [6.5, -1.7, 0.7], [9, -5, 3.5]])] },
    planks: { hash: '23f68443', text: 'The third plank sticks. It was left that way, so you would notice.',
      figures: [F('person', '#d8b36a', [[0, -4, 0], [4, -1.4, 0.3], [9, -1.4, 0.3]], { shape: 'big' }), F('duck', '#8fc0a0', [[0, -4, 1.2], [4.5, -2.2, 1.0], [9, -2.2, 1.0]])] },
    letter: { hash: 'fb2804c6', text: 'A letter climbed this path before anyone lived here to read it.',
      figures: [F('toaster', '#c9b1e8', [[0, -6, 3], [4.5, -1.3, 0.8], [5.5, -1.3, 0.8], [9, -6, 4]]), F('person', '#e8c9b1', [[0, 1.6, 1.4], [9, 1.6, 1.4]], { shape: 'tall' })] },
    lamp: { hash: '653fc008', text: 'Someone lit this lamp the first evening. It has never needed more.',
      figures: [F('duck', '#e8b36a', [[0, -4, -1], [3, -1, -0.7], [6.5, -1, -0.7], [9, -4, -2]]), F('person', '#a7c7e8', [[0, 2.5, 1], [9, 2.2, 1.3]], { shape: 'short' })] },
    receipt: { hash: 'd00d0144', text: 'A door was mended here. The hand forgot. The door remembers.',
      figures: [F('rollbot', '#7ad8c9', [[0, 3, 2], [3, 0.8, 0.9], [7, 1.1, 0.8], [9, 4, 3]]), F('person', '#e8d27a', [[0, -3, 0.4], [9, -2.6, 0.4]], { shape: 'tiny' })] },
    tally: { hash: '3ce1dc22', text: 'Someone counted the turns, in fives, long after anyone was watching.',
      figures: [F('cactus', '#c7e89a', [[0, -2.5, 2], [3, -1.1, 0.8], [8, -1.0, 0.7], [9, -1.0, 0.7]]), F('person', '#e89a9a', [[0, 3, -2], [5, 2, -1], [9, 2, -1]], { shape: 'short' })] },
    chair: { hash: '47c6d94d', text: 'Someone sat here, facing the land, waiting for something to arrive.',
      figures: [F('tvbot', '#e8a7c9', [[0, 0.1, 0.05], [9, 0.1, 0.05]], { face: [0, 8], sit: true }), F('person', '#a7e8d2', [[0, 5, 4], [9, 5, 4]], { face: [0, 0] })] },
    drawing: { hash: '24c65706', text: 'A small hand drew a barrel a smile, and called it a friend.',
      figures: [F('duck', '#f2d27a', [[0, -3, 1.5], [3, -1.1, 0.5], [9, -1.1, 0.5]]), F('person', '#9ad0f2', [[0, 3, 2], [9, 2.4, 1.4]], { shape: 'big' })] },
  };

  let live = null; // the memory playing: { id, t, rigs, root, over, ... }
  const P = () => H && H.presence;

  function css() {
    if (document.getElementById('memory-style')) return;
    const st = document.createElement('style');
    st.id = 'memory-style';
    st.textContent = [
      '.mm{position:fixed;inset:0;z-index:20;pointer-events:none;opacity:0;transition:opacity 1.2s ease;backdrop-filter:sepia(.95) saturate(.55) brightness(.94) contrast(1.05);-webkit-backdrop-filter:sepia(.95) saturate(.55) brightness(.94) contrast(1.05);background:radial-gradient(ellipse at center,rgba(255,214,150,.06) 35%,rgba(60,30,8,.55) 100%)}',
      '.mm.on{opacity:1}.mm.out{transition:opacity .9s ease}',
      '.mm-skip{position:fixed;top:max(14px,env(safe-area-inset-top));left:50%;transform:translateX(-50%);z-index:21;pointer-events:none;color:rgba(255,236,200,.8);font:600 12px system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;opacity:0;transition:opacity 1s}',
      '.mm-skip.on{opacity:1}',
    ].join('\n');
    document.head.appendChild(st);
  }

  function ghostify(e, mat) {
    for (const m of e.node.getChildMeshes()) { if (m.material !== mat) { m.material = mat; m.isPickable = false; try { m.receiveShadows = false; } catch { /* fine */ } } }
  }

  function spawn(def, at, ground) {
    const Pr = P();
    if (!Pr || !Pr.showcase || !Pr.core || !B || !H.world) return null;
    const node = new B.TransformNode('memory-ghost', H.world.scene);
    const p0 = def.path[0];
    const e = { node, x: at[0] + p0[1], y: ground + 0.9, z: at[1] + p0[2], alive: true };
    node.position.set(e.x, e.y, e.z);
    const look = Pr.core.cleanLook({ what: def.what || 'person', body: def.body, accent: '#fff2c8', head: '#fff2dc', shape: def.shape || 'normal', hair: 'short' });
    const rig = Pr.showcase.make(e, look, look.body || def.body, { model: false });
    return { def, e, rig, node, yaw: 0 };
  }

  function pos(def, t) {
    const p = def.path;
    if (t <= p[0][0]) return [p[0][1], p[0][2]];
    for (let i = 1; i < p.length; i++) {
      if (t <= p[i][0]) { const a = p[i - 1], b = p[i], k = (t - a[0]) / Math.max(0.001, b[0] - a[0]); return [a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]; }
    }
    const l = p[p.length - 1]; return [l[1], l[2]];
  }

  function unlock(m) {
    const p = game.player;
    if (p && m.heldControls !== undefined) { p.controls = m.heldControls; m.heldControls = undefined; }
  }

  function end(skipped) {
    const m = live;
    if (!m || m.ending) return;
    m.ending = true;
    try { if (H.speech && H.speech.clear) H.speech.clear('memory'); } catch { /* fine */ }
    m.over.classList.remove('on'); m.over.classList.add('out'); m.hint.classList.remove('on');
    const ms = Math.round((performance.now() - m.t0));
    // The world returns with a shimmer where the figures stood.
    try { game.burst([m.at[0], m.ground + 1.2, m.at[1]], { color: '#fff2c0', count: 30, speed: 2.6, size: 0.14 }); } catch { /* fine */ }
    try { if (H.lib && H.lib.siteSound) H.lib.siteSound('lore-glint', { volume: 0.6 }); } catch { /* quiet */ }
    emit('memory-end', { id: m.id, ms, skipped: Boolean(skipped), seconds: Math.round(ms / 100) / 10 });
    game.after(0.9, () => {
      for (const g of m.ghosts) { try { if (P().showcase.dispose) P().showcase.dispose(g.rig); g.node.dispose(); } catch { /* gone */ } }
      if (m.off) m.off();
      m.over.remove(); m.hint.remove();
      try { m.mat.dispose(); } catch { /* gone */ }
      unlock(m);
      if (live === m) live = null;
      try { m.done && m.done(); } catch { /* fine */ }
    });
    window.removeEventListener('pointerdown', m.tap, true);
    window.removeEventListener('keydown', m.key, true);
  }

  /** Plays the memory of a lore object where it lies; done() when it is over (or skipped). false: no memory for it. */
  function play(id, at, done) {
    const mem = MEMORIES[id];
    if (!mem || live || !B || !H.world || !P() || !P().showcase) return false;
    css();
    const p = game.player;
    const ground = (p && Number.isFinite(p.bottom) ? p.bottom : (p ? p.y - 0.9 : 0));
    const mat = new B.StandardMaterial('memory-ghost', H.world.scene);
    mat.emissiveColor = new B.Color3(1, 0.85, 0.6); mat.diffuseColor = new B.Color3(0, 0, 0); mat.specularColor = new B.Color3(0, 0, 0);
    mat.disableLighting = true; mat.alpha = 0; mat.backFaceCulling = false;
    try { mat.transparencyMode = B.Material.MATERIAL_ALPHABLEND; } catch { /* older engine */ }
    const ghosts = mem.figures.map((f) => spawn(f, at, ground)).filter(Boolean);
    if (!ghosts.length) { mat.dispose(); return false; }
    const over = document.createElement('div'); over.className = 'mm';
    const hint = document.createElement('div'); hint.className = 'mm-skip'; hint.textContent = 'Tap to skip';
    document.body.appendChild(over); document.body.appendChild(hint);
    requestAnimationFrame(() => { over.classList.add('on'); hint.classList.add('on'); });
    const m = live = { id, at, ground, ghosts, mat, over, hint, done, t: 0, t0: performance.now(), said: false };
    // Hold still while the island remembers; one tap (or Space) skips and gives control back.
    if (p) { m.heldControls = p.controls; p.controls = false; }
    m.tap = (ev) => { if (live === m) { ev.stopPropagation(); end(true); } };
    m.key = (ev) => { if (live === m && (ev.key === ' ' || ev.key === 'Enter')) { ev.stopPropagation(); end(true); } };
    window.addEventListener('pointerdown', m.tap, true);
    window.addEventListener('keydown', m.key, true);
    emit('memory-start', { id, seconds: SECONDS, figures: ghosts.length });
    m.off = game.onUpdate((dt) => {
      if (live !== m) return;
      m.t += dt;
      const t = m.t;
      const fade = m.ending ? Math.max(0, 1 - (performance.now() - (m.endAt || (m.endAt = performance.now()))) / 700) : Math.min(1, t / 1.2);
      mat.alpha = 0.42 * fade * (0.9 + 0.1 * Math.sin(t * 4));
      for (const g of m.ghosts) {
        const [dx, dz] = pos(g.def, t);
        const nx = at[0] + dx, nz = at[1] + dz;
        const mx = nx - g.e.x, mz = nz - g.e.z;
        if (Math.hypot(mx, mz) > 0.002) g.yaw = Math.atan2(mx, mz);
        else if (g.def.face) g.yaw = Math.atan2(g.def.face[0], g.def.face[1]);
        g.e.x = nx; g.e.z = nz; g.e.y = ground + 0.9;
        g.node.position.set(nx, ground + 0.9 - (g.def.sit ? 0.3 : 0), nz);
        g.node.rotation.y = g.yaw;
        try { P().showcase.animate(g.rig, dt); } catch { /* a rig that failed stays still */ }
        if ((Math.floor(t * 10) % 5) === 0) ghostify(g.e, mat);
      }
      if (!m.said && t >= 1.2) {
        m.said = true;
        const url = (H.lib && H.lib.recordedLine && H.lib.recordedLine('overseer', mem.text)) || vox(mem.hash);
        try { H.speech.say({ text: mem.text, voice: url, priority: 'important', owner: 'memory', seconds: 6 }); } catch { /* the words are in the journal */ }
        emit('memory-line', { id, text: mem.text, clip: url, at: Math.round(t * 10) / 10 });
      }
      if (t >= SECONDS) end(false);
    });
    return true;
  }

  window.__island = Object.assign(window.__island || {}, { memories: { MEMORIES, play, skip: () => end(true), active: () => (live ? live.id : null), SECONDS } });
})();
