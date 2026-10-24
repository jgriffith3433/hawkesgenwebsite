// Furniture that works: chairs and sofas you sit on, beds you lie in, doors and cupboards that open, a fridge with
// food inside, lamps and light switches, a sink, a shower and a bathtub with running water, a toilet that flushes, an
// oven, a piano you play with the keyboard, a clock with the real time, tables, desks, shelves, plants and rugs.
// Every one is made of primitives (a stand-in) and wears a model when the game has one ("sofa.glb", or shape.model).
// Furniture stands on the floor: its position is the point on the floor under it, and its front faces +z.
/* global HawkesPlay, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = BABYLON;
  const L = H.lib;
  const M = H.homes;
  const RAD = Math.PI / 180;
  const W = () => H.world;
  const P = M.part;
  const num = (v, d) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : d);
  const say = (t, s = 1.6) => H.game && H.game.ui.message(t, s);
  const face = (yaw) => ({ rotation: [0, Math.round((yaw / RAD + 180) / 15) * 15, 0] });
  const ON = { textureable: true, motion: [['static', 'Stays put'], ['dynamic', 'Can be pushed over']] };

  /** Registers a piece of furniture: def.make(root, e, sh, o, spec) adds its parts and actions. */
  function furn(type, def) {
    H.kinds.register(type, {
      physics: def.physics || 'static',
      maker: true,
      build: (sh, o, spec) => M.furniture(type, sh || {}, o, (root, e, main) => def.make(root, e, sh || {}, o, spec, main), { color: def.color }),
      destroy: def.destroy,
      editor: { word: def.word, lift: () => (def.wall ? def.wall : 0.02), ...ON, ...(def.editor || {}), hotbar: def.hotbar || [] },
      codex: { group: def.group || 'Home', what: def.what, spec: def.spec, fields: def.fields || [], uses: def.uses, props: true },
    });
  }

  /** A door on a hinge (a child node) that swings to state.open: used by doors, fridges, cupboards and ovens. */
  function swing(e, hinge, axis, openAngle, speed = 5) {
    let a = 0;
    M.animate(e, (dt) => {
      const want = e.homes && e.homes.state.open ? openAngle : 0;
      if (Math.abs(want - a) < 0.001) return;
      a += (want - a) * Math.min(1, dt * speed);
      if (Math.abs(want - a) < 0.002) a = want;
      hinge.rotation[axis] = a;
    });
  }

  // ------------------------------------------------------------------ seats
  furn('chair', {
    word: 'a chair', color: '#a0703f',
    what: 'A chair you sit on: look at it and press E (B on a phone). Space or walking gets you up.',
    spec: { type: 'chair', name: 'Chair', transform: { position: [0, 0, 0] }, material: { color: '#a0703f' } },
    fields: [['shape.height', 'seat height in meters', '0.47'], ['shape.model', 'a model asset to wear', 'chair.glb if the game has it']],
    hotbar: [{ order: 200, icon: '🪑', label: 'Chair', make: (yaw) => ({ type: 'chair', name: 'Chair', ...{ transform: face(yaw) } }) }],
    make(root, e, sh, o, spec, main) {
      const h = num(sh.height, 0.47);
      P(root, 'box', [0.48, 0.06, 0.46], [0, h - 0.03, 0], main);
      P(root, 'box', [0.48, 0.5, 0.05], [0, h + 0.25, -0.21], main);
      for (const [x, z] of [[-0.2, -0.19], [0.2, -0.19], [-0.2, 0.19], [0.2, 0.19]]) P(root, 'box', [0.05, h - 0.06, 0.05], [x, (h - 0.06) / 2, z], '#5b3d22');
      M.usable(e, [{ label: 'sit', at: [0, h, 0.05], use: () => M.sit(e, [0, h, 0.05], 0) }]);
    },
  });

  furn('sofa', {
    word: 'a sofa', color: '#6d7fb3',
    what: 'A sofa with room for a few (shape.seats). Each seat is its own place to sit: look at one and press E.',
    spec: { type: 'sofa', name: 'Sofa', transform: { position: [0, 0, 0] }, shape: { seats: 3 }, material: { color: '#6d7fb3' } },
    fields: [['shape.seats', '1 (an armchair) to 4', '3'], ['shape.model', 'a model asset to wear', 'sofa.glb']],
    hotbar: [{ order: 210, icon: '🛋', label: 'Sofa', make: (yaw) => ({ type: 'sofa', name: 'Sofa', shape: { seats: 3 }, transform: face(yaw) }) }],
    make(root, e, sh, o, spec, main) {
      const n = Math.max(1, Math.min(4, Math.round(num(sh.seats, 3))));
      const w = n * 0.72 + 0.36;
      P(root, 'box', [w, 0.38, 0.9], [0, 0.19, 0], main);
      P(root, 'box', [w, 0.62, 0.22], [0, 0.69, -0.34], main);
      P(root, 'box', [0.18, 0.62, 0.9], [-w / 2 + 0.09, 0.31, 0], main);
      P(root, 'box', [0.18, 0.62, 0.9], [w / 2 - 0.09, 0.31, 0], main);
      const cushion = M.mat(L.hex(o.color, '#6d7fb3').scale(1.15).toHexString());
      const pts = [];
      for (let i = 0; i < n; i++) {
        const x = -((n - 1) * 0.72) / 2 + i * 0.72;
        P(root, 'box', [0.68, 0.1, 0.62], [x, 0.43, 0.08], cushion);
        pts.push({ label: n > 1 ? 'sit' : 'sit', at: [x, 0.48, 0.12], use: () => M.sit(e, [x, 0.48, 0.12], 0) });
      }
      M.usable(e, pts);
    },
  });

  furn('bed', {
    word: 'a bed', color: '#e8e2d4',
    what: 'A bed you lie in (E). Lying a while, you sleep: the game hears game.on("sleep"). shape.size "single" or "double".',
    spec: { type: 'bed', name: 'Bed', transform: { position: [0, 0, 0] }, shape: { size: 'double' }, material: { color: '#5b7fd1' } },
    fields: [['shape.size', 'single or double', 'double'], ['material.color', 'the blanket', '#5b7fd1'], ['shape.model', 'a model asset', 'bed.glb']],
    hotbar: [{ order: 220, icon: '🛏', label: 'Bed', make: (yaw) => ({ type: 'bed', name: 'Bed', material: { color: '#5b7fd1' }, transform: face(yaw) }) }],
    make(root, e, sh, o, spec, main) {
      const w = sh.size === 'single' ? 1.0 : 1.6, len = 2.1;
      P(root, 'box', [w + 0.08, 0.3, len + 0.08], [0, 0.15, 0], '#6b4a2b');
      P(root, 'box', [w + 0.08, 0.9, 0.08], [0, 0.45, -len / 2 - 0.02], '#6b4a2b');
      P(root, 'box', [w, 0.2, len], [0, 0.4, 0], '#f3efe6');
      const pillows = sh.size === 'single' ? [0] : [-w / 4, w / 4];
      for (const x of pillows) P(root, 'box', [sh.size === 'single' ? 0.6 : 0.55, 0.12, 0.35], [x, 0.56, -len / 2 + 0.28], '#ffffff');
      P(root, 'box', [w + 0.04, 0.06, len * 0.62], [0, 0.52, len * 0.18], main);
      // Who's lying in it (you see yourself in third person, and it's cozy).
      const sleeper = P(root, 'cyl', [0.5, 1.4], [0, 0.6, 0.05], '#4a9eff', { decor: true, rot: [90, 0, 0] });
      sleeper.setEnabled(false);
      e._sleeper = sleeper;
      const pts = [{ label: 'lie down', at: [0, 0.55, -len / 2 + 0.45], use: () => { M.sit(e, [0, 0.55, -len / 2 + 0.45], 0, { pose: 'lie', out: [w / 2 + 0.55, 0.3], say: 'Cozy. Lie a while to sleep.' }); } }];
      M.usable(e, pts);
      let lying = 0, slept = false;
      M.animate(e, (dt) => {
        const p = W().player;
        const here = p && p.controller === 'seat' && p._controller.opts.thing === e;
        if (!here) { lying = 0; slept = false; return; }
        lying += dt;
        if (lying > 4 && !slept) { slept = true; sleep(e); }
      });
    },
  });
  function sleep(e) {
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:#05070d;opacity:0;transition:opacity 1.2s;z-index:7;display:grid;place-items:center;color:#cfd8ff;font:600 28px/1.2 Inter,system-ui,sans-serif;pointer-events:none';
    ov.textContent = 'Zzz…';
    document.body.appendChild(ov);
    requestAnimationFrame(() => { ov.style.opacity = '0.92'; });
    setTimeout(() => { ov.style.opacity = '0'; }, 2400);
    setTimeout(() => ov.remove(), 3800);
    if (H.game) { H.game.emit('sleep', { bed: e }); setTimeout(() => say('Good morning!', 2), 2600); }
  }

  // ------------------------------------------------------------------ tables and storage
  function table(root, e, sh, main, size, round) {
    const s = Array.isArray(sh.size) ? sh.size.map(Number) : size;
    const [w, h, d] = s;
    if (round || sh.round) P(root, 'cyl', [Math.max(w, d), 0.05], [0, h - 0.025, 0], main, { tess: 28 });
    else P(root, 'box', [w, 0.05, d], [0, h - 0.025, 0], main);
    const ix = w / 2 - 0.07, iz = d / 2 - 0.07;
    if (round || sh.round) P(root, 'cyl', [0.08, h - 0.05], [0, (h - 0.05) / 2, 0], main);
    else for (const [x, z] of [[-ix, -iz], [ix, -iz], [-ix, iz], [ix, iz]]) P(root, 'box', [0.06, h - 0.05, 0.06], [x, (h - 0.05) / 2, z], main);
    return s;
  }
  furn('table', {
    word: 'a table', color: '#9a6a3e',
    what: 'A table (shape.size [w, h, d], or shape.round). A coffee table is a low one: { "size": [1.1, 0.42, 0.6] }.',
    spec: { type: 'table', name: 'Table', transform: { position: [0, 0, 0] }, shape: { size: [1.4, 0.75, 0.8] } },
    fields: [['shape.size', '[width, height, depth] in meters', '[1.4, 0.75, 0.8]'], ['shape.round', 'a round table', 'false']],
    make(root, e, sh, o, spec, main) { table(root, e, sh, main, [1.4, 0.75, 0.8]); },
  });
  furn('desk', {
    word: 'a desk', color: '#c7b299',
    what: 'A desk with drawers: put a computer, a lamp or a phone on it (their position y = 0.75 above the floor).',
    spec: { type: 'desk', name: 'Desk', transform: { position: [0, 0, 0] } },
    fields: [['shape.size', '[width, height, depth]', '[1.3, 0.75, 0.6]']],
    make(root, e, sh, o, spec, main) {
      const [w, h, d] = table(root, e, sh, main, [1.3, 0.75, 0.6]);
      P(root, 'box', [0.42, h - 0.08, d - 0.06], [w / 2 - 0.25, (h - 0.08) / 2, 0], main);
      for (let i = 0; i < 3; i++) P(root, 'box', [0.3, 0.02, 0.02], [w / 2 - 0.25, 0.15 + i * 0.22, d / 2 - 0.02], '#3b3f4a');
    },
  });
  furn('shelf', {
    word: 'a bookshelf', color: '#7a5532',
    what: 'A bookshelf full of books (or empty: shape.books false).',
    spec: { type: 'shelf', name: 'Bookshelf', transform: { position: [0, 0, 0] } },
    fields: [['shape.size', '[width, height, depth]', '[1, 1.9, 0.35]'], ['shape.books', 'fill it with books', 'true']],
    make(root, e, sh, o, spec, main) {
      const [w, h, d] = Array.isArray(sh.size) ? sh.size.map(Number) : [1, 1.9, 0.35];
      P(root, 'box', [0.04, h, d], [-w / 2, h / 2, 0], main); P(root, 'box', [0.04, h, d], [w / 2, h / 2, 0], main);
      P(root, 'box', [w, h, 0.03], [0, h / 2, -d / 2], main);
      const rows = Math.max(2, Math.round(h / 0.38));
      const colors = ['#b5452f', '#2f6db5', '#e2b33c', '#3f8a4f', '#7a4fa0', '#d9d4c7', '#1f2a44'];
      let k = 3;
      for (let r = 0; r <= rows; r++) {
        const y = 0.03 + r * (h - 0.06) / rows;
        P(root, 'box', [w, 0.03, d], [0, y, 0], main);
        if (r === rows || sh.books === false) continue;
        let x = -w / 2 + 0.05;
        while (x < w / 2 - 0.08) {
          k = (k * 7 + 3) % 97;
          const bw = 0.03 + (k % 4) * 0.012, bh = 0.2 + (k % 5) * 0.025;
          P(root, 'box', [bw, bh, d * 0.75], [x + bw / 2, y + 0.015 + bh / 2, 0.02], colors[k % colors.length], { decor: true });
          x += bw + 0.004;
        }
      }
    },
  });
  furn('plant', {
    word: 'a plant', color: '#b8643b',
    what: 'A potted plant: green and cozy (shape.height).',
    spec: { type: 'plant', name: 'Plant', transform: { position: [0, 0, 0] } },
    fields: [['shape.height', 'meters', '1']],
    make(root, e, sh, o, spec, main) {
      const h = num(sh.height, 1);
      P(root, 'cone', [0.32, 0.34, 0.42], [0, 0.17, 0], main, { tess: 16 });
      for (let i = 0; i < 7; i++) {
        const a = i * 2.4, r = 0.12 + (i % 3) * 0.05;
        P(root, 'sphere', [0.3 * h, 0.42 * h, 0.3 * h], [Math.cos(a) * r, 0.34 + h * (0.35 + (i % 4) * 0.12), Math.sin(a) * r], i % 2 ? '#3f8a4f' : '#58a85f', { seg: 8 });
      }
    },
  });
  H.kinds.register('rug', {
    physics: 'none', maker: true,
    build: (sh, o) => {
      const s = Array.isArray(sh.size) ? sh.size : [2.2, 1.5];
      const e = L.shape('rug', () => (sh.round ? B.MeshBuilder.CreateCylinder('rug', { diameter: Number(s[0]) || 2, height: 0.012, tessellation: 40 }, W().scene) : B.MeshBuilder.CreateBox('rug', { width: Number(s[0]) || 2.2, height: 0.012, depth: Number(s[1]) || 1.5 }, W().scene)), { color: '#b4553e', ...o, shadow: false });
      return e;
    },
    editor: { word: 'a rug', lift: () => 0.01, textureable: true, motion: [] },
    codex: { group: 'Home', what: 'A rug on the floor (shape.size [w, d], shape.round). A texture from the library makes it patterned.', spec: { type: 'rug', name: 'Rug', transform: { position: [0, 0.006, 0] }, shape: { size: [2.2, 1.5] }, material: { color: '#b4553e' } }, fields: [['shape.size', '[width, depth]', '[2.2, 1.5]'], ['shape.round', 'round', 'false']], noFloor: false },
  });

  /** The food a fridge or cupboard holds: stand-in shapes by name, or a model "<name>.glb" when the game has one. */
  const FOOD = {
    milk: ['box', [0.08, 0.2, 0.08], '#f5f5f5', 'drink'], juice: ['box', [0.08, 0.2, 0.08], '#f39c12', 'drink'], soda: ['cyl', [0.07, 0.12], '#d63031', 'drink'],
    water: ['cyl', [0.07, 0.22], '#74b9ff', 'drink'], apple: ['sphere', [0.08], '#d63031', 'eat'], orange: ['sphere', [0.08], '#f39c12', 'eat'],
    cheese: ['box', [0.14, 0.07, 0.1], '#f6d55c', 'eat'], eggs: ['box', [0.2, 0.06, 0.1], '#e8dcc3', 'eat'], cake: ['cyl', [0.18, 0.1], '#f8a5c2', 'eat'],
    pizza: ['cyl', [0.24, 0.03], '#e17055', 'eat'], sandwich: ['box', [0.12, 0.05, 0.12], '#e1b382', 'eat'], icecream: ['cyl', [0.1, 0.12], '#fdcb6e', 'eat'],
    carrot: ['cone', [0.04, 0.16], '#e67e22', 'eat'], banana: ['cyl', [0.04, 0.18], '#f1c40f', 'eat'], bread: ['box', [0.2, 0.1, 0.1], '#c98d4e', 'eat'],
  };
  const itemOf = (x) => { const n = String(typeof x === 'object' && x ? x.name || x.item : x).toLowerCase(); return { name: n, ...(FOOD[n] ? { shape: FOOD[n][0], size: FOOD[n][1], color: FOOD[n][2], verb: FOOD[n][3] } : { shape: 'box', size: [0.1, 0.1, 0.1], color: '#a29bfe', verb: 'take' }) }; };
  /** Items on shelves inside a cabinet: each one usable while it's open; eating it emits "eat" for the game. */
  function stock(root, e, list, shelves, width, depth) {
    const items = [];
    const per = Math.max(1, Math.ceil(list.length / shelves.length));
    list.forEach((raw, i) => {
      const it = itemOf(raw);
      const row = Math.floor(i / per), col = i % per;
      const y = shelves[Math.min(row, shelves.length - 1)];
      const x = -width / 2 + (width / (per + 1)) * (col + 1);
      const s = it.size;
      const h = it.shape === 'sphere' ? s[0] : s[1];
      const m = P(root, it.shape === 'cone' ? 'cone' : it.shape, it.shape === 'sphere' ? [s[0]] : s, [x, y + h / 2, depth * 0.1], it.color, { keep: true, rot: it.name === 'banana' ? [0, 0, 70] : undefined });
      items.push({ ...it, mesh: m, at: [x, y + h / 2, depth * 0.35] });
    });
    const show = () => { const gone = new Set(e.homes.state.taken || []); items.forEach((it, i) => it.mesh.setEnabled(!gone.has(i))); };
    const pts = items.map((it, i) => ({
      label: `${it.verb} the ${it.name}`, at: it.at,
      when: () => e.homes.state.open && !(e.homes.state.taken || []).includes(i),
      use: (ctx) => {
        ctx.set({ taken: [...(e.homes.state.taken || []), i] });
        say(it.verb === 'drink' ? `You drink the ${it.name}. Refreshing!` : it.verb === 'eat' ? `You eat the ${it.name}. Yum!` : `You take the ${it.name}.`);
        M.noise({ kind: 'click', volume: 0.2 });
        if (H.game) H.game.emit(it.verb === 'take' ? 'take' : 'eat', { item: it.name, from: e });
      },
    }));
    return { items, show, pts };
  }

  furn('fridge', {
    word: 'a fridge', color: '#e8edf2',
    what: 'A fridge with food inside (data.items). E opens it; look at a thing inside and press E to eat or drink it (the game hears game.on("eat", d => d.item)). Restocks when it is empty and closed.',
    spec: { type: 'fridge', name: 'Fridge', transform: { position: [0, 0, 0] }, data: { items: ['milk', 'apple', 'cheese', 'juice', 'cake'] } },
    fields: [['data.items', `what's inside: ${Object.keys(FOOD).join(', ')} (or any name)`, 'milk, apple, cheese, juice, eggs'], ['shape.model', 'a model asset', 'fridge.glb']],
    make(root, e, sh, o, spec, main) {
      const w = 0.72, h = 1.8, d = 0.68;
      P(root, 'box', [w, h, 0.04], [0, h / 2, -d / 2 + 0.02], main);
      P(root, 'box', [0.04, h, d], [-w / 2 + 0.02, h / 2, 0], main); P(root, 'box', [0.04, h, d], [w / 2 - 0.02, h / 2, 0], main);
      P(root, 'box', [w, 0.06, d], [0, 0.03, 0], main); P(root, 'box', [w, 0.04, d], [0, h - 0.02, 0], main);
      const shelves = [0.32, 0.72, 1.12, 1.5];
      for (const y of shelves) P(root, 'box', [w - 0.08, 0.015, d - 0.08], [0, y, 0], M.mat('#cfe8ff', { alpha: 0.7 }), { keep: true });
      const glow = P(root, 'box', [w - 0.1, 0.02, 0.1], [0, h - 0.08, 0], M.mat('#fff7d6', { glow: true }), { keep: true });
      const hinge = new B.TransformNode('fridge-hinge', W().scene); hinge.parent = root; hinge.position.set(-w / 2, 0, d / 2);
      const door = P(hinge, 'box', [w, h - 0.02, 0.06], [w / 2, h / 2, 0.03], main, { keep: true });
      P(door, 'box', [0.03, 0.5, 0.04], [w / 2 - 0.08, 0.15, 0.05], '#9aa3ad');
      const list = Array.isArray(spec && spec.data && spec.data.items) ? spec.data.items : Array.isArray(o.data && o.data.items) ? o.data.items : ['milk', 'apple', 'cheese', 'juice', 'eggs'];
      const st = stock(root, e, list.slice(0, 16), shelves, w - 0.12, d);
      M.track(e, { open: false, taken: [] }, (s, changed, quiet) => {
        glow.setEnabled(s.open);
        st.show();
        if (changed.includes('open') && !quiet) M.noise({ kind: 'click', volume: 0.25, at: M.worldPoint(e, [0, 1, 0]) });
      }, M.keyOf(o, spec));
      swing(e, hinge, 'y', -1.9);
      M.usable(e, [
        { label: () => (e.homes.state.open ? 'close the fridge' : 'open the fridge'), at: [0.1, 1.2, d / 2 + 0.05], use: (ctx) => { const open = !e.homes.state.open; const restock = !open && (e.homes.state.taken || []).length >= st.items.length; ctx.set(restock ? { open, taken: [] } : { open }); } },
        ...st.pts,
      ]);
    },
  });

  furn('cupboard', {
    word: 'a cupboard', color: '#b08a5a',
    what: 'A cupboard or wardrobe with two doors that open (E). Put things in it with data.items (like the fridge). A kitchen cabinet is a low one: shape.size [1, 0.9, 0.6].',
    spec: { type: 'cupboard', name: 'Wardrobe', transform: { position: [0, 0, 0] }, shape: { size: [1.1, 2, 0.6] } },
    fields: [['shape.size', '[width, height, depth]', '[1, 2, 0.55]'], ['data.items', 'what is inside (food names, or anything)', 'nothing']],
    make(root, e, sh, o, spec, main) {
      const [w, h, d] = Array.isArray(sh.size) ? sh.size.map(Number) : [1, 2, 0.55];
      P(root, 'box', [w, h, 0.03], [0, h / 2, -d / 2], main);
      P(root, 'box', [0.03, h, d], [-w / 2, h / 2, 0], main); P(root, 'box', [0.03, h, d], [w / 2, h / 2, 0], main);
      P(root, 'box', [w, 0.03, d], [0, 0.02, 0], main); P(root, 'box', [w, 0.03, d], [0, h - 0.02, 0], main);
      const shelves = h > 1.2 ? [0.4, 0.95, 1.5] : [0.05, h * 0.5];
      for (const y of shelves) P(root, 'box', [w - 0.05, 0.02, d - 0.05], [0, y, 0], main, { keep: true });
      if (h > 1.4) P(root, 'cyl', [0.025, w - 0.06], [0, h - 0.2, 0], '#9aa3ad', { rot: [0, 0, 90], keep: true });
      const doors = [];
      for (const side of [-1, 1]) {
        const hinge = new B.TransformNode('cup-hinge', W().scene); hinge.parent = root; hinge.position.set(side * w / 2, 0, d / 2);
        const door = P(hinge, 'box', [w / 2 - 0.01, h - 0.02, 0.03], [-side * (w / 4), h / 2, 0.015], main, { keep: true });
        P(door, 'box', [0.025, 0.18, 0.03], [-side * (w / 4 - 0.06), h > 1.2 ? 0 : 0.2, 0.03], '#cfd6de');
        doors.push([hinge, side]);
      }
      const list = Array.isArray(spec && spec.data && spec.data.items) ? spec.data.items : Array.isArray(o.data && o.data.items) ? o.data.items : [];
      const st = stock(root, e, list.slice(0, 12), shelves, w - 0.1, d);
      M.track(e, { open: false, taken: [] }, (s, changed, quiet) => { st.show(); if (changed.includes('open') && !quiet) M.noise({ kind: 'click', volume: 0.2, at: M.worldPoint(e, [0, 1, 0]) }); }, M.keyOf(o, spec));
      for (const [hinge, side] of doors) swing(e, hinge, 'y', side * 1.8);
      M.usable(e, [{ label: () => (e.homes.state.open ? 'close it' : 'open it'), at: [0, Math.min(1.1, h * 0.6), d / 2 + 0.05], use: (ctx) => ctx.set({ open: !e.homes.state.open }) }, ...st.pts]);
    },
  });

  // ------------------------------------------------------------------ doors
  furn('door', {
    word: 'a door', color: '#8a5a33',
    what: 'A door in a frame that opens and closes (E). Closed it is solid; open, you walk through. data.locked keeps it shut; shape.auto opens it when someone comes close.',
    spec: { type: 'door', name: 'Door', transform: { position: [0, 0, 0] } },
    fields: [['shape.width', 'meters', '0.9'], ['shape.height', 'meters', '2.1'], ['shape.hinge', 'left or right', 'left'], ['shape.auto', 'opens by itself when you come close', 'false'], ['data.locked', 'shut (says "Locked")', 'false'], ['shape.frame', 'show the frame', 'true']],
    hotbar: [{ order: 215, icon: '🚪', label: 'Door', make: (yaw) => ({ type: 'door', name: 'Door', transform: face(yaw) }) }],
    make(root, e, sh, o, spec, main) {
      const w = num(sh.width, 0.9), h = num(sh.height, 2.1);
      const side = sh.hinge === 'right' ? 1 : -1;
      if (sh.frame !== false) {
        const fm = M.mat('#efe6d6');
        P(root, 'box', [0.06, h + 0.06, 0.16], [-w / 2 - 0.03, (h + 0.06) / 2, 0], fm, { decor: true });
        P(root, 'box', [0.06, h + 0.06, 0.16], [w / 2 + 0.03, (h + 0.06) / 2, 0], fm, { decor: true });
        P(root, 'box', [w + 0.12, 0.06, 0.16], [0, h + 0.03, 0], fm, { decor: true });
      }
      const hinge = new B.TransformNode('door-hinge', W().scene); hinge.parent = root; hinge.position.set(side * w / 2, 0, 0);
      const panel = P(hinge, 'box', [w - 0.02, h - 0.01, 0.05], [-side * (w / 2), h / 2, 0], main, { keep: true });
      P(panel, 'sphere', [0.07], [-side * (w / 2 - 0.1), -0.05, 0.05], '#d4b26a', { keep: true });
      P(panel, 'sphere', [0.07], [-side * (w / 2 - 0.1), -0.05, -0.05], '#d4b26a', { keep: true });
      for (const y of [0.45, -0.45]) P(panel, 'box', [w * 0.62, h * 0.32, 0.012], [0, y, 0.03], M.mat(L.hex(o.color, '#8a5a33').scale(0.85).toHexString()), { decor: true });
      const locked = () => Boolean((e.data && e.data.locked) || (spec && spec.data && spec.data.locked));
      M.track(e, { open: Boolean(sh.open) }, (s, changed, quiet) => {
        e.physics = s.open ? 'none' : 'static';
        if (changed.includes('open') && !quiet) M.sound(s.open ? 'door-open.mp3' : 'door-close.mp3', M.worldPoint(e, [0, 1, 0]), () => M.noise({ kind: s.open ? 'whoosh' : 'click', dur: 0.3, volume: 0.2, at: M.worldPoint(e, [0, 1, 0]) }));
      }, M.keyOf(o, spec));
      swing(e, hinge, 'y', side * -1.7);
      M.usable(e, [{
        label: () => (locked() && !e.homes.state.open ? 'locked' : e.homes.state.open ? 'close the door' : 'open the door'), at: [0, 1.1, 0], reach: 0.4,
        use: (ctx) => { if (locked() && !e.homes.state.open) { say('Locked.'); M.noise({ kind: 'click', volume: 0.3 }); return; } ctx.set({ open: !e.homes.state.open }); },
      }]);
      if (sh.auto) {
        let mine = false, away = 0;
        M.animate(e, (dt) => {
          const p = W().player;
          if (!p || locked()) return;
          const at = M.worldPoint(e, [0, 1, 0]);
          const d = Math.hypot(p.x - at[0], p.z - at[2]);
          if (d < 2.2 && !e.homes.state.open) { mine = true; away = 0; M.set(e, { open: true }); }
          else if (mine && d > 3) { away += dt; if (away > 1.5 && e.homes.state.open) { mine = false; M.set(e, { open: false }); } }
        });
      }
      e._door = { width: w, height: h };
    },
  });

  // ------------------------------------------------------------------ lights and switches
  /** Things a switch or a lamp turns on and off (lamps in the same room of the same house, or listed ones). */
  function lightsFor(sw) {
    const ids = sw.data && (sw.data.controls || sw.data.lights);
    const out = [];
    if (Array.isArray(ids) && ids.length) {
      for (const id of ids) { const t = M.things.get(id) || (W().byId.get(id)); if (t && t._lamp) out.push(t); }
      return out;
    }
    const owner = sw._homesOwner, room = sw.data && sw.data.room;
    for (const e of W().entities) {
      if (!e._lamp || !e.alive) continue;
      if (owner || room) { if (e._homesOwner === owner && (!room || (e.data && e.data.room) === room)) out.push(e); continue; }
      if (e.distanceTo(sw) < 9) out.push(e);
    }
    return out;
  }
  furn('lamp', {
    word: 'a lamp', color: '#f1e3c6',
    what: 'A lamp that lights the room: a floor lamp, a table lamp (shape.table) or a ceiling light (shape.ceiling, hung from shape.height). E turns it on and off; a switch turns a room\'s lamps.',
    spec: { type: 'lamp', name: 'Lamp', transform: { position: [0, 0, 0] }, light: { color: '#ffd9a0', intensity: 1.2, range: 8 } },
    fields: [['shape.table', 'a small lamp for a table', 'false'], ['shape.ceiling', 'hangs from the ceiling', 'false'], ['shape.height', 'the ceiling\'s height (ceiling lights)', '2.9'], ['light.color', 'its light', '#ffd9a0'], ['light.intensity', 'brightness', '1.1'], ['light.range', 'meters', '8'], ['shape.on', 'starts on', 'true']],
    hotbar: [{ order: 230, icon: '💡', label: 'Lamp', make: () => ({ type: 'lamp', name: 'Lamp' }) }],
    make(root, e, sh, o, spec, main) {
      const l = (spec && spec.light) || sh.light || {};
      let bulbAt;
      if (sh.ceiling) {
        const hgt = num(sh.height, 2.9);
        P(root, 'cyl', [0.02, 0.4], [0, hgt - 0.2, 0], '#555c66', { decor: true });
        P(root, 'cone', [0.42, 0.18, 0.12], [0, hgt - 0.46, 0], main, { tess: 20 });
        bulbAt = [0, hgt - 0.56, 0];
      } else if (sh.table) {
        P(root, 'cyl', [0.16, 0.03], [0, 0.015, 0], '#4a4f59');
        P(root, 'cyl', [0.025, 0.3], [0, 0.17, 0], '#4a4f59');
        P(root, 'cone', [0.3, 0.2, 0.18], [0, 0.38, 0], main, { tess: 20 });
        bulbAt = [0, 0.33, 0];
      } else {
        P(root, 'cyl', [0.3, 0.03], [0, 0.015, 0], '#3b3f4a');
        P(root, 'cyl', [0.03, 1.45], [0, 0.74, 0], '#3b3f4a');
        P(root, 'cone', [0.46, 0.3, 0.28], [0, 1.55, 0], main, { tess: 20 });
        bulbAt = [0, 1.48, 0];
      }
      const bulb = P(root, 'sphere', [0.1], bulbAt, M.mat('#fff4d6', { glow: true }), { keep: true, decor: true });
      const light = new B.PointLight('lamp', new B.Vector3(bulbAt[0], bulbAt[1], bulbAt[2]), W().scene);
      light.parent = root;
      light.diffuse = L.hex(l.color, '#ffd9a0');
      light.specular = light.diffuse.scale(0.2);
      light.intensity = num(l.intensity, sh.ceiling ? 0.9 : 0.75);
      light.range = num(l.range, sh.ceiling ? 7 : 6);
      e._light = light; e._lamp = true; e._bulb = bulb;
      const offMat = M.mat('#8c8676');
      M.track(e, { on: sh.on !== false }, (s) => { light.setEnabled(s.on); bulb.material = s.on ? M.mat('#fff4d6', { glow: true }) : offMat; }, M.keyOf(o, spec));
      M.usable(e, [{ label: () => (e.homes.state.on ? 'turn the light off' : 'turn the light on'), at: bulbAt[1] > 2.2 ? [0, 1.4, 0] : bulbAt, reach: bulbAt[1] > 2.2 ? -1 : 0, when: () => !sh.ceiling, use: (ctx) => { ctx.set({ on: !e.homes.state.on }); M.noise({ kind: 'click', volume: 0.25 }); } }]);
    },
    destroy: (e) => { if (e._light) e._light.dispose(); },
  });

  furn('switch', {
    word: 'a light switch', color: '#f4f1ea', wall: 1.2,
    what: 'A light switch on a wall (its position is its center, about 1.2 m up). E flips it: the lamps of its room (in a house), the lamps listed in data.controls, or the lamps within 9 m.',
    spec: { type: 'switch', name: 'Light switch', transform: { position: [0, 1.2, 0] }, data: { controls: [] } },
    fields: [['data.controls', 'ids of the lamps it turns on and off', 'the lamps nearby'], ['data.room', 'a house room\'s name', '']],
    make(root, e, sh, o, spec, main) {
      P(root, 'box', [0.09, 0.13, 0.015], [0, 0, 0.007], main);
      const rocker = P(root, 'box', [0.035, 0.06, 0.02], [0, 0, 0.022], M.mat('#dedad2'), { keep: true });
      M.track(e, { on: true }, (s, changed, quiet) => {
        rocker.rotation.x = s.on ? -0.35 : 0.35;
        if (changed.includes('on') && quiet !== 'init') for (const lamp of lightsFor(e)) M.applyLocal(lamp.homes.id, { on: s.on });
        if (!quiet && changed.includes('on')) M.noise({ kind: 'click', volume: 0.3 });
      }, M.keyOf(o, spec));
      M.usable(e, [{ label: () => (e.homes.state.on ? 'lights off' : 'lights on'), at: [0, 0, 0.05], use: (ctx) => ctx.set({ on: !e.homes.state.on }) }]);
    },
  });

  // ------------------------------------------------------------------ the kitchen and the bathroom
  /** Water from a spout: a stream of drops (and the sound of it) while state.on. */
  function water(e, at, o = {}) {
    let ps = null, snd = null;
    return (on) => {
      if (on && !ps) {
        ps = new B.ParticleSystem('water', o.shower ? 600 : 260, W().scene);
        ps.particleTexture = W().dot;
        const em = new B.TransformNode('spout', W().scene); em.parent = e.node; em.position.set(at[0], at[1], at[2]);
        ps.emitter = em;
        const r = o.shower ? 0.12 : 0.012;
        ps.minEmitBox = new B.Vector3(-r, 0, -r); ps.maxEmitBox = new B.Vector3(r, 0, r);
        ps.color1 = new B.Color4(0.6, 0.85, 1, 0.9); ps.color2 = new B.Color4(0.75, 0.92, 1, 0.7); ps.colorDead = new B.Color4(0.6, 0.85, 1, 0);
        ps.minSize = o.shower ? 0.025 : 0.03; ps.maxSize = o.shower ? 0.05 : 0.05;
        ps.minLifeTime = 0.15; ps.maxLifeTime = o.life || (o.shower ? 0.55 : 0.32);
        ps.emitRate = o.shower ? 900 : 380;
        ps.direction1 = new B.Vector3(-0.05, -1, -0.05).scale(o.shower ? 2 : 1); ps.direction2 = new B.Vector3(0.05, -1, 0.05).scale(o.shower ? 2 : 1);
        ps.minEmitPower = 0.6; ps.maxEmitPower = 1.2;
        ps.gravity = new B.Vector3(0, -9.8, 0);
        ps.start();
        snd = M.loop({ asset: o.sound || (o.shower ? 'shower.mp3' : 'tap.mp3'), synth: M.waterSynth, thing: e, volume: o.shower ? 0.5 : 0.35, range: 10 });
        e.onDestroy(() => { if (ps) ps.dispose(); });
      } else if (!on && ps) { ps.stop(); const old = ps; setTimeout(() => old.dispose(), 800); ps = null; if (snd) { snd.stop(); snd = null; } }
    };
  }
  /** A basin that fills while the tap runs and drains when it stops (a sink, a bathtub). */
  function basin(e, root, size, at, maxDepth, rate = 0.06) {
    const surf = P(root, 'box', [size[0], 0.01, size[1]], [at[0], at[1], at[2]], M.mat('#6ec6ff', { alpha: 0.55, spec: 0.6 }), { keep: true, decor: true });
    surf.setEnabled(false);
    let level = 0;
    M.animate(e, (dt) => {
      const on = e.homes && e.homes.state.on;
      level = Math.max(0, Math.min(maxDepth, level + (on ? rate : -rate * 1.6) * dt));
      surf.setEnabled(level > 0.004);
      surf.position.y = at[1] + level;
      e._waterLevel = level;
    });
    return () => level;
  }
  furn('sink', {
    word: 'a sink', color: '#e9e4da',
    what: 'A sink on a cabinet with a tap: E runs the water (it fills the basin) and stops it. A kitchen sink: shape.size [1.2, 0.9, 0.6].',
    spec: { type: 'sink', name: 'Sink', transform: { position: [0, 0, 0] } },
    fields: [['shape.size', '[width, height, depth]', '[0.8, 0.9, 0.55]'], ['shape.sound', 'a sound asset for the running water', 'tap.mp3']],
    make(root, e, sh, o, spec, main) {
      const [w, h, d] = Array.isArray(sh.size) ? sh.size.map(Number) : [0.8, 0.9, 0.55];
      P(root, 'box', [w, h - 0.04, d], [0, (h - 0.04) / 2, 0], main);
      P(root, 'box', [w + 0.02, 0.04, d + 0.02], [0, h - 0.02, 0], '#d9dde3');
      P(root, 'box', [0.5, 0.012, 0.36], [0, h + 0.001, 0.02], '#9fb3c2', { decor: true });
      P(root, 'cyl', [0.035, 0.28], [0, h + 0.14, -d / 2 + 0.08], '#c9d1da', { keep: true });
      P(root, 'cyl', [0.03, 0.16], [0, h + 0.27, -d / 2 + 0.15], '#c9d1da', { rot: [90, 0, 0], keep: true });
      const run = water(e, [0, h + 0.25, -d / 2 + 0.22], { sound: sh.sound, life: 0.22 });
      basin(e, root, [0.46, 0.32], [0, h + 0.006, 0.02], 0.02, 0.01);
      M.track(e, { on: false }, (s) => run(s.on), M.keyOf(o, spec));
      M.usable(e, [{ label: () => (e.homes.state.on ? 'turn the tap off' : 'turn the tap on'), at: [0, h + 0.2, -d / 2 + 0.1], use: (ctx) => ctx.set({ on: !e.homes.state.on }) }]);
    },
  });
  furn('bathtub', {
    word: 'a bathtub', color: '#f7f7f4',
    what: 'A bathtub: E at the tap runs the water and it fills up (things that float bob in it: a rubber duck!); E at the tub lies you in the bath.',
    spec: { type: 'bathtub', name: 'Bathtub', transform: { position: [0, 0, 0] } },
    fields: [['shape.sound', 'a sound asset for the water', 'tap.mp3']],
    make(root, e, sh, o, spec, main) {
      const w = 0.8, len = 1.7, h = 0.56;
      P(root, 'box', [w, 0.08, len], [0, 0.04, 0], main);
      P(root, 'box', [0.08, h, len], [-w / 2 + 0.04, h / 2, 0], main); P(root, 'box', [0.08, h, len], [w / 2 - 0.04, h / 2, 0], main);
      P(root, 'box', [w, h, 0.08], [0, h / 2, -len / 2 + 0.04], main); P(root, 'box', [w, h, 0.08], [0, h / 2, len / 2 - 0.04], main);
      P(root, 'cyl', [0.035, 0.22], [0, h + 0.1, -len / 2 + 0.06], '#c9d1da', { keep: true });
      P(root, 'cyl', [0.03, 0.14], [0, h + 0.2, -len / 2 + 0.12], '#c9d1da', { rot: [90, 0, 0], keep: true });
      const run = water(e, [0, h + 0.18, -len / 2 + 0.19], { sound: sh.sound, life: 0.35 });
      // A hollow tub (its bottom and four sides), so things (and you) fit in it.
      const B4 = (size, at) => ({ shape: H.physics.shapes.box(size), position: at });
      H.physics.setShape(e, H.physics.shapes.compound([B4([w, 0.08, len], [0, 0.04, 0]), B4([0.08, h, len], [-w / 2 + 0.04, h / 2, 0]), B4([0.08, h, len], [w / 2 - 0.04, h / 2, 0]), B4([w, h, 0.08], [0, h / 2, -len / 2 + 0.04]), B4([w, h, 0.08], [0, h / 2, len / 2 - 0.04])]));
      const level = basin(e, root, [w - 0.16, len - 0.16], [0, 0.09, 0], h - 0.16, 0.05);
      M.track(e, { on: false }, (s) => run(s.on), M.keyOf(o, spec));
      M.usable(e, [
        { label: () => (e.homes.state.on ? 'turn the water off' : 'run the bath'), at: [0, h + 0.15, -len / 2 + 0.1], use: (ctx) => ctx.set({ on: !e.homes.state.on }) },
        { label: () => (level() > 0.15 ? 'take a bath' : 'lie in the tub'), at: [0, 0.35, 0.3], use: () => M.sit(e, [0, 0.35, -0.2], 0, { pose: 'lie', out: [w / 2 + 0.55, 0], say: level() > 0.15 ? 'Ahh, a warm bath.' : 'An empty bath. Run the water!' }) },
      ]);
      // Real water in the tub when the Water module is here (things float in it by themselves: the duck bobs); a
      // gentle lift for floating things otherwise.
      const waterKind = H.kinds.get('water');
      if (waterKind && H.water) {
        let pool = null, made = 0;
        M.animate(e, () => {
          const lv = level();
          const want = lv < 0.06 ? 0 : Math.round(lv / 0.06) * 0.06;
          if (want !== made) {
            made = want;
            if (pool && pool.alive) pool.destroy();
            pool = null;
            if (want) {
              try { pool = waterKind.build({ size: [w - 0.18, want, len - 0.18], fish: false, waves: false, foam: false }, { name: 'Bath water', physics: 'none', lenient: true }, null); pool.temporary = true; } catch (err) { H.report(err, 'bathtub'); }
            }
          }
          if (pool && pool.alive) {
            const c = M.worldPoint(e, [0, 0.09 + made / 2, 0]);
            pool.node.position.set(c[0], c[1], c[2]);
            pool.node.rotation.y = e.node.rotation.y;
          }
        });
        e.onDestroy(() => { if (pool && pool.alive) pool.destroy(); });
      } else {
        const off = H.physics.beforeStep(() => {
          if (!e.alive || level() < 0.05) return;
          const top = M.worldPoint(e, [0, 0.09 + level(), 0])[1];
          const box = e.box();
          for (const t of W().entities) {
            if (t.physics !== 'dynamic' || t === W().player || !t.alive || t.held) continue;
            if (t.x < box.min[0] || t.x > box.max[0] || t.z < box.min[2] || t.z > box.max[2] || t.bottom > top || t.y < box.min[1]) continue;
            const depth = Math.min(1, (top - t.bottom) / Math.max(0.05, t.size[1]));
            t.force([0, Math.abs(H.physics.gravity) * t.mass * 1.6 * depth, 0]);
            t.vy *= 0.92; t.vx *= 0.97; t.vz *= 0.97;
          }
        });
        e.onDestroy(off);
      }
    },
  });
  furn('shower', {
    word: 'a shower', color: '#e9eef2',
    what: 'A shower stall: E turns the water on and off. Stand under it to get clean (the game hears game.on("shower")).',
    spec: { type: 'shower', name: 'Shower', transform: { position: [0, 0, 0] } },
    fields: [['shape.sound', 'a sound asset for the water', 'shower.mp3']],
    make(root, e, sh, o, spec, main) {
      const s = 0.95, h = 2.1;
      P(root, 'box', [s, 0.08, s], [0, 0.04, 0], main);
      P(root, 'box', [s, h, 0.04], [0, h / 2, -s / 2], main, { decor: true });
      const glass = M.mat('#bfe3ff', { alpha: 0.25, spec: 0.8 });
      P(root, 'box', [0.02, h - 0.1, s], [-s / 2, h / 2, 0], glass, { decor: true, keep: true });
      P(root, 'box', [0.02, h - 0.1, s], [s / 2, h / 2, 0], glass, { decor: true, keep: true });
      P(root, 'cyl', [0.03, 0.3], [0, h - 0.05, -s / 2 + 0.15], '#c9d1da', { rot: [90, 0, 0], keep: true, decor: true });
      P(root, 'cyl', [0.18, 0.03], [0, h - 0.1, -s / 2 + 0.3], '#c9d1da', { keep: true, decor: true });
      P(root, 'cyl', [0.07, 0.04], [0.25, 1.1, -s / 2 + 0.03], '#c9d1da', { rot: [90, 0, 0], keep: true });
      const run = water(e, [0, h - 0.13, -s / 2 + 0.3], { shower: true, sound: sh.sound });
      // You step into it: solid only where its tray, back and glass sides are.
      const B4 = (size, at) => ({ shape: H.physics.shapes.box(size), position: at });
      H.physics.setShape(e, H.physics.shapes.compound([B4([s, 0.08, s], [0, 0.04, 0]), B4([s, h, 0.04], [0, h / 2, -s / 2]), B4([0.03, h, s], [-s / 2, h / 2, 0]), B4([0.03, h, s], [s / 2, h / 2, 0])]));
      M.track(e, { on: false }, (st) => run(st.on), M.keyOf(o, spec));
      M.usable(e, [{ label: () => (e.homes.state.on ? 'turn the shower off' : 'turn the shower on'), at: [0.25, 1.1, -s / 2 + 0.1], use: (ctx) => ctx.set({ on: !e.homes.state.on }) }]);
      let under = 0;
      M.animate(e, (dt) => {
        const p = W().player;
        if (!p || !e.homes.state.on) { under = 0; return; }
        const c = M.worldPoint(e, [0, 0, 0]);
        if (Math.hypot(p.x - c[0], p.z - c[2]) < s / 2 && Math.abs(p.bottom - c[1]) < 0.5) { under += dt; if (H.game && H.game.water && H.game.water.wet && Math.floor(under * 2) !== Math.floor((under - dt) * 2)) H.game.water.wet(p, 4); if (under > 1.5 && under - dt <= 1.5) { say('Squeaky clean!'); if (H.game) H.game.emit('shower', { shower: e }); } } else under = 0;
      });
    },
  });
  furn('toilet', {
    word: 'a toilet', color: '#f7f7f4',
    what: 'A toilet: sit on it (E at the seat) or flush it (E at the handle; everyone hears).',
    spec: { type: 'toilet', name: 'Toilet', transform: { position: [0, 0, 0] } },
    fields: [['shape.sound', 'a flush sound asset', 'flush.mp3']],
    make(root, e, sh, o, spec, main) {
      P(root, 'cyl', [0.3, 0.38], [0, 0.19, 0.05], main, { tess: 18 });
      P(root, 'cyl', [0.4, 0.06], [0, 0.41, 0.06], main, { tess: 20 });
      P(root, 'cyl', [0.32, 0.01], [0, 0.445, 0.06], '#5ea7d6', { tess: 18, decor: true });
      P(root, 'box', [0.42, 0.38, 0.18], [0, 0.62, -0.2], main);
      P(root, 'box', [0.08, 0.025, 0.03], [0.14, 0.76, -0.1], '#c9d1da', { keep: true });
      M.track(e, { flushes: 0 }, (s, changed, quiet) => {
        if (quiet || !changed.includes('flushes') || !s.flushes) return;
        const at = M.worldPoint(e, [0, 0.45, 0.06]);
        M.sound(sh.sound || 'flush.mp3', at, () => M.noise({ kind: 'whoosh', dur: 1.6, volume: 0.35, at }));
        if (H.game) H.game.burst(at, { color: '#7cc8ff', count: 24, size: 0.06, speed: 1.2 });
      }, M.keyOf(o, spec));
      M.usable(e, [
        { label: 'sit', at: [0, 0.44, 0.15], use: () => M.sit(e, [0, 0.44, 0.12], 0) },
        { label: 'flush', at: [0.14, 0.76, -0.08], use: (ctx) => ctx.set({ flushes: (e.homes.state.flushes || 0) + 1 }) },
      ]);
    },
  });
  furn('oven', {
    word: 'an oven', color: '#dfe3e8',
    what: 'A cooker: an oven with a window and four rings on top. E turns it on (it glows and warms up) and off.',
    spec: { type: 'oven', name: 'Oven', transform: { position: [0, 0, 0] } },
    fields: [['shape.model', 'a model asset', 'oven.glb']],
    make(root, e, sh, o, spec, main) {
      const w = 0.6, h = 0.9, d = 0.6;
      P(root, 'box', [w, h, d], [0, h / 2, 0], main);
      const win = P(root, 'box', [0.42, 0.26, 0.01], [0, 0.42, d / 2 + 0.003], '#1d2128', { keep: true });
      P(root, 'box', [0.46, 0.025, 0.03], [0, 0.66, d / 2 + 0.03], '#9aa3ad');
      const rings = [];
      for (const [x, z] of [[-0.14, -0.13], [0.14, -0.13], [-0.14, 0.13], [0.14, 0.13]]) rings.push(P(root, 'torus', [0.17, 0.02], [x, h + 0.01, z], '#2b2f36', { keep: true }));
      for (let i = 0; i < 4; i++) P(root, 'cyl', [0.04, 0.025], [-0.21 + i * 0.14, 0.8, d / 2 + 0.012], '#2b2f36', { rot: [90, 0, 0], keep: true });
      const hot = M.mat('#ff5a1f', { glow: true }), cold = M.mat('#2b2f36'), lit = M.mat('#ffb347', { glow: true }), dark = M.mat('#1d2128');
      const light = new B.PointLight('oven', new B.Vector3(0, 0.45, d / 2 + 0.2), W().scene);
      light.parent = root; light.diffuse = new B.Color3(1, 0.6, 0.3); light.intensity = 0.4; light.range = 2.5;
      e._light = light;
      M.track(e, { on: false }, (s) => { for (const r of rings) r.material = s.on ? hot : cold; win.material = s.on ? lit : dark; light.setEnabled(s.on); }, M.keyOf(o, spec));
      M.usable(e, [{ label: () => (e.homes.state.on ? 'turn the oven off' : 'turn the oven on'), at: [0, 0.8, d / 2 + 0.05], use: (ctx) => { ctx.set({ on: !e.homes.state.on }); M.noise({ kind: 'click', volume: 0.3 }); } }]);
    },
    destroy: (e) => { if (e._light) e._light.dispose(); },
  });

  // ------------------------------------------------------------------ the clock and the piano
  const timeIn = (tz) => {
    const now = new Date();
    if (!tz) return { h: now.getHours(), m: now.getMinutes(), s: now.getSeconds() + now.getMilliseconds() / 1000 };
    try {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false }).formatToParts(now);
      const g = (t) => Number((parts.find((p) => p.type === t) || {}).value) || 0;
      return { h: g('hour') % 24, m: g('minute'), s: g('second') + now.getMilliseconds() / 1000 };
    } catch { return { h: now.getHours(), m: now.getMinutes(), s: now.getSeconds() }; }
  };
  const spoken = (t) => `${((t.h + 11) % 12) + 1}:${String(t.m).padStart(2, '0')} ${t.h < 12 ? 'AM' : 'PM'}`;
  furn('clock', {
    word: 'a clock', color: '#f6f1e6', wall: 2,
    what: 'A wall clock showing the real time (where the player is, or shape.timezone like "Asia/Tokyo"); shape.digital for a digital one. E says the time. Its position is its center.',
    spec: { type: 'clock', name: 'Clock', transform: { position: [0, 2, 0] } },
    fields: [['shape.size', 'diameter in meters', '0.4'], ['shape.digital', 'a digital clock', 'false'], ['shape.timezone', 'an IANA time zone', 'the player\'s']],
    make(root, e, sh, o, spec, main) {
      const size = num(sh.size, 0.4);
      const tz = sh.timezone || null;
      if (sh.digital) {
        P(root, 'box', [size * 1.4, size * 0.55, 0.05], [0, 0, 0], '#1d2128');
        const tex = new B.DynamicTexture('clock', { width: 256, height: 96 }, W().scene, false);
        const m = new B.StandardMaterial('clock', W().scene); m.emissiveTexture = tex; m.disableLighting = true; m.diffuseColor = new B.Color3(0, 0, 0);
        const face = P(root, 'plane', [size * 1.3, size * 0.45], [0, 0, 0.027], m, { keep: true });
        face.rotation.y = Math.PI;
        face.metadata = { ...(face.metadata || {}), noGlow: true };
        let last = '';
        M.animate(e, () => {
          const t = timeIn(tz);
          const txt = `${String(t.h).padStart(2, '0')}${Math.floor(t.s) % 2 ? ':' : ' '}${String(t.m).padStart(2, '0')}`;
          if (txt === last) return;
          last = txt;
          const c = tex.getContext();
          c.fillStyle = '#05080c'; c.fillRect(0, 0, 256, 96);
          c.fillStyle = '#5dff9a'; c.font = 'bold 68px monospace'; c.textAlign = 'center'; c.textBaseline = 'middle';
          c.fillText(txt, 128, 52);
          tex.update();
        });
        e.onDestroy(() => tex.dispose());
      } else {
        P(root, 'cyl', [size, 0.04], [0, 0, 0], main, { rot: [90, 0, 0], tess: 32 });
        P(root, 'torus', [size, 0.025], [0, 0, 0.01], '#3b3f4a', { rot: [90, 0, 0], tess: 32 });
        for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; P(root, 'box', [0.012, i % 3 ? 0.025 : 0.045, 0.005], [Math.sin(a) * size * 0.42, Math.cos(a) * size * 0.42, 0.022], '#2b2f36', { rot: [0, 0, -i * 30], decor: true }); }
        const hand = (len, w, color, z) => { const pivot = new B.TransformNode('hand', W().scene); pivot.parent = root; pivot.position.z = z; P(pivot, 'box', [w, len, 0.004], [0, len / 2 - 0.01, 0], color, { keep: true, decor: true }); return pivot; };
        const hh = hand(size * 0.26, 0.018, '#1d2128', 0.026), mh = hand(size * 0.38, 0.012, '#1d2128', 0.03), sh2 = hand(size * 0.42, 0.005, '#d63031', 0.034);
        M.animate(e, () => {
          const t = timeIn(tz);
          hh.rotation.z = -((t.h % 12) + t.m / 60) * Math.PI / 6;
          mh.rotation.z = -(t.m + t.s / 60) * Math.PI / 30;
          sh2.rotation.z = -Math.floor(t.s) * Math.PI / 30;
        });
      }
      M.usable(e, [{ label: 'check the time', at: [0, 0, 0.1], reach: -1.5, use: () => say(`It's ${spoken(timeIn(tz))}.`, 2) }]);
    },
  });

  // Keys: a w s e d f t g y h u j k o l p ; ' (white and black keys from middle C), like a piano's.
  const KEYS = ['a', 'w', 's', 'e', 'd', 'f', 't', 'g', 'y', 'h', 'u', 'j', 'k', 'o', 'l', 'p', ';', "'"];
  const playNote = H.sync ? H.sync.action('homes:note', (d) => { const e = M.things.get(d.id); if (e && e._sound) e._sound(d.n); }) : null;
  function pianoKeys(root, x0, y, z, n0, count) {
    const keys = new Map();
    const white = [0, 2, 4, 5, 7, 9, 11];
    let wi = 0;
    for (let n = n0; n < n0 + count; n++) {
      const black = !white.includes(n % 12);
      if (black) { keys.set(n, P(root, 'box', [0.012, 0.02, 0.07], [x0 + wi * 0.0235 - 0.0117, y + 0.015, z - 0.025], '#15171c', { keep: true })); continue; }
      keys.set(n, P(root, 'box', [0.022, 0.018, 0.12], [x0 + wi * 0.0235, y, z], '#fbfbf8', { keep: true }));
      wi++;
    }
    return keys;
  }
  let touchKeys = null;
  function showTouchKeys(on) {
    if (!H.touchUi) return;
    if (on && !touchKeys) {
      touchKeys = document.createElement('div');
      touchKeys.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:calc(22% + 50px);display:flex;gap:3px;z-index:6;touch-action:none';
      KEYS.slice(0, 13).forEach((k, i) => {
        const b = document.createElement('button');
        const black = [1, 3, 6, 8, 10].includes(i % 12);
        b.style.cssText = `width:${black ? 22 : 30}px;height:${black ? 60 : 92}px;border-radius:0 0 6px 6px;border:1px solid #333;background:${black ? '#15171c' : '#fbfbf8'};${black ? 'margin:0 -12px;z-index:1;align-self:flex-start' : ''}`;
        H.bindTouchKey(b, k);
        touchKeys.appendChild(b);
      });
      document.body.appendChild(touchKeys);
    } else if (!on && touchKeys) { touchKeys.remove(); touchKeys = null; }
  }
  M.onSeat.push((p, o, sitting) => { if (o.instrument) showTouchKeys(sitting); });
  furn('piano', {
    word: 'a piano', color: '#2b1d14',
    what: 'An upright piano with a bench. E sits you at it; then the keys A W S E D F T G Y H U J K (like a piano\'s white and black keys) play notes everyone nearby hears. Space gets up. shape.voice: piano, organ, synth or bell; shape.sound: a note asset (middle C) to play instead.',
    spec: { type: 'piano', name: 'Piano', transform: { position: [0, 0, 0] } },
    fields: [['shape.voice', 'piano, organ, synth or bell', 'piano'], ['shape.sound', 'a sound asset of middle C, pitched for every key', '']],
    make(root, e, sh, o, spec, main) {
      const w = 1.45;
      P(root, 'box', [w, 1.25, 0.32], [0, 0.625, -0.14], main);
      P(root, 'box', [w, 0.08, 0.3], [0, 0.72, 0.1], main);
      P(root, 'box', [0.06, 0.72, 0.3], [-w / 2 + 0.03, 0.36, 0.1], main); P(root, 'box', [0.06, 0.72, 0.3], [w / 2 - 0.03, 0.36, 0.1], main);
      P(root, 'box', [0.7, 0.05, 0.36], [0, 0.5, 0.72], main);
      for (const x of [-0.3, 0.3]) for (const z of [0.58, 0.86]) P(root, 'box', [0.04, 0.48, 0.04], [x, 0.24, z], main);
      const keys = pianoKeys(root, -w / 2 + 0.12, 0.775, 0.17, 48, 50);
      const voice = sh.voice || 'piano';
      const down = new Map();
      e._sound = (n, remote) => {
        const at = M.worldPoint(e, [0, 0.9, 0]);
        if (sh.sound && M.hasAssetRef(sh.sound)) { const a = new Audio(M.assetUrl(sh.sound)); a.crossOrigin = 'anonymous'; H.audio.media(a); a.preservesPitch = false; a.playbackRate = Math.pow(2, (n - 60) / 12); a.volume = Math.min(1, M.near(at, 20)); a.play().catch(() => {}); }
        else M.note(n, { voice, at, range: 22 });
        const k = keys.get(n);
        if (k) { k.position.y -= 0.008; down.set(n, k); setTimeout(() => { k.position.y += 0.008; down.delete(n); }, 180); }
        if (!remote && H.game) H.game.emit('note', { note: n, from: e });
      };
      // Online, the note goes to everyone once (the action plays it here too); offline it just plays.
      e._play = (input) => {
        KEYS.forEach((k, i) => { if (input.pressed(k)) { const n = 60 + i; if (playNote) playNote({ id: e.homes.id, n }); else e._sound(n); } });
      };
      M.track(e, {}, () => {}, M.keyOf(o, spec));
      M.usable(e, [{ label: 'play the piano', at: [0, 0.8, 0.45], use: () => M.sit(e, [0, 0.53, 0.72], 180, { instrument: true, say: 'Keys A to K play notes · Space gets up' }) }]);
    },
  });
})();
