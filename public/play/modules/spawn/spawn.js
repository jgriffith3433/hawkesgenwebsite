// The spawn wheel's doing: bringing a chosen thing into the world, beamed down by the Overseer.
//   - building: a real scene op (create, or config for the world), saved and undoable as one step (×10 is one undo)
//   - playing: a runtime spawn (not saved), shared online through Mayhem's spawning, when the game allows it
//     (config.spawn: true or { play: true }); otherwise the wheel is only there while building
//   - community things go into the game through the editor (POST /v1/games/:id/community, as a variant of their word,
//     or replacing it), then into the world
//   - a ghost shows where it will land before you let go
//
//   H.spawn.spawn(item, { count })   -> Promise<{ ok, count, ids, error }>
//   H.spawn.ghost.show(item, count) / hide()
//   game.spawnWheel.open() / close() / spawn('cow', 10) / search('4x4') / allowed()
/* global HawkesPlay, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = BABYLON;
  const S = H.spawn;
  const W = () => H.world;
  const G = () => H.game;
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const r2 = (n) => Math.round(n * 100) / 100;
  const slug = (s) => String(s || 'thing').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 20) || 'thing';
  const say = (text, s = 1.6) => { try { if (window.HawkesBuild && H.mode === 'build') H.spawn.toast(text); else G().ui.message(text, s); } catch { /* no world */ } };
  S.toast = (text) => { try { G().ui.message(text, 1.6); } catch { /* no world */ } };

  /** A new scene id nobody uses. */
  function newId(base) {
    const g = W() && W().graph;
    for (;;) { const id = `${slug(base)}_${Math.random().toString(36).slice(2, 6)}`; if (!g || !g.entities[id]) return id; }
  }
  const radYaw = () => { const w = W(); return (w && w.camera && w.camera.yaw) || 0; };

  // ------------------------------------------------------------------ the community library, through the editor
  const waits = new Map();
  window.addEventListener('message', (ev) => {
    const m = ev.data || {};
    if (ev.source !== window.parent || m.type !== 'spawn-community') return;
    const w = waits.get(m.req);
    if (w) { waits.delete(m.req); w(m); }
  });
  /** Puts a community thing in the game (the editor does the account side): its asset's name in the game. */
  function useLibrary(lib, o = {}) {
    return new Promise((resolve) => {
      if (!S.inEditor()) { resolve({ ok: false, error: 'The library opens while building in the editor' }); return; }
      const req = Math.random().toString(36).slice(2);
      waits.set(req, resolve);
      H.post({ type: 'spawn-community', req, id: lib.id, mode: o.replace ? 'replace' : 'variant', word: o.word || undefined });
      setTimeout(() => { if (waits.delete(req)) resolve({ ok: false, error: 'The library didn\'t answer. Try again in a moment.' }); }, 25000);
    });
  }
  S.useLibrary = useLibrary;
  /**
   * A base stand-in for a library thing that can't be fetched (the row is listed but its file isn't in Gen, the editor
   * didn't answer...): the player is never shown a "not in your library" error. Each kind gets a plain shape of the
   * same sort, tinted, named for the thing, marked `data.standIn` so it can be swapped for the real one later.
   * Pure (tests use it): { spec } for a thing, { config } for a sky.
   */
  function standInFor(lib, toward) {
    const kind = (lib && lib.kind) || 'model';
    const title = String((lib && lib.title) || 'Thing').slice(0, 40);
    const data = { standIn: true, wanted: lib && lib.id };
    if (kind === 'sky') return { config: { sky: '#8fb8e8' }, label: 'the sky', said: 'The sky is now a clear blue' };
    if (kind === 'texture') return { spec: { type: 'box', name: `${title} wall`, shape: { size: [4, 3, 0.3] }, material: { color: '#a9a39a' }, physics: 'static', transform: { rotation: [0, toward || 0, 0] }, data } };
    if (kind === 'music' || kind === 'ambience' || kind === 'sfx' || kind === 'voice' || kind === 'audio') return { spec: { type: 'cylinder', name: `${title} speaker`, shape: { radius: 0.35, height: 0.8 }, material: { color: '#6c7a99' }, physics: 'static', data } };
    if (kind === 'sprite' || kind === 'image' || kind === 'video') return { spec: { type: 'box', name: title, shape: { size: [2, 1.5, 0.1] }, material: { color: '#c9d3e6' }, physics: 'static', transform: { rotation: [0, toward || 0, 0] }, data } };
    return { spec: { type: 'box', name: title, shape: { size: 1.2 }, material: { color: '#8da4c4' }, physics: 'dynamic', data } };
  }
  S.standInFor = standInFor;
  /** Waits (briefly) for an asset to be in the game's bundle: the editor sends the new list just before it answers. */
  async function arrived(name) {
    for (let i = 0; i < 40; i++) { if (H.assets.get(name)) return true; await new Promise((r) => setTimeout(r, 50)); }
    return Boolean(H.assets.get(name));
  }

  // ------------------------------------------------------------------ what an item becomes
  const TAKER = { model: 'mesh', mesh: 'mesh', sprite: 'image', image: 'image', picture: 'image', music: 'audio', ambience: 'audio', sfx: 'audio', voice: 'audio', audio: 'audio', sound: 'audio', video: 'video' };
  /** A spec for a game asset (by name): the kind that takes that sort of asset makes it (kinds' editor.asset). */
  function specOfAsset(name, kind, title, yawDeg) {
    if (kind === 'texture') return { type: 'box', name: `${title || 'Textured'} wall`.slice(0, 40), shape: { size: [4, 3, 0.3] }, material: { texture: name, tile: 1, color: '#ffffff' }, physics: 'static', transform: { rotation: [0, yawDeg, 0] } };
    const want = TAKER[kind] || kind;
    const taker = H.kinds.list().find((k) => k.editor && k.editor.asset && k.editor.asset.kind === want);
    if (!taker) return null;
    const spec = taker.editor.asset.make({ name, kind: want, title }, { title: title ? String(title).slice(0, 40) : null, yaw: yawDeg });
    if (spec && spec.lift !== undefined) { spec.liftHint = spec.lift; delete spec.lift; }
    return spec;
  }
  /** Resolves an item to what spawning does: { spec } (a thing), { config } (the world, building), { act } (now). */
  async function resolve(it, place0) {
    const yaw = radYaw();
    const toward = place0 ? place0.toward : 0;
    if (it.make) return { spec: it.make(yaw) };
    if (it.asset) {
      const spec = specOfAsset(it.asset.name, it.asset.kind, it.asset.title, toward);
      return spec ? { spec } : { error: `${it.name} can't be placed` };
    }
    if (it.lib) {
      if (H.mode !== 'build') return { error: 'Library things come in while building' };
      const r = await S.useLibrary(it.lib, it.libOpts || {});
      // Not fetchable (listed but not in Gen, or no answer): a base stand-in, quietly; the developers get the log.
      if (!r.ok || r.missing || !(r.asset && r.asset.name)) {
        try { console.warn(`[spawn] library thing ${it.lib.id} "${it.lib.title}" could not be fetched (${r.error || 'not in Gen'}): placing a stand-in`); } catch { /* no console */ }
        const f = standInFor(it.lib, toward);
        return f.config ? f : { spec: f.spec, word: r.word };
      }
      const name = r.asset.name;
      await arrived(name);
      if (it.lib.kind === 'sky') return { config: { sky: name }, label: 'the sky', said: `The sky is now ${it.name}` };
      const spec = specOfAsset(name, it.lib.kind, it.lib.title, toward);
      return spec ? { spec, word: r.word } : { error: `${it.name} can't be placed` };
    }
    if (it.world) return { world: it.world };
    if (it.effect) return { effect: it.effect };
    return { error: 'Nothing to spawn' };
  }
  S.resolve = resolve;
  S.specOfAsset = specOfAsset;
  const quickSpec = (it) => { try { if (it.make) return it.make(radYaw()); } catch { /* make needs the world */ } return { type: 'box', shape: { size: 1.4 } }; };
  S.quickSpec = quickSpec;

  // ------------------------------------------------------------------ the beam
  /** The Overseer beams it down (story module: H.overseer.beam); until that lands, a column of light of our own. */
  function beam(at, label) {
    if (H.overseer && typeof H.overseer.beam === 'function') {
      try { H.overseer.beam(at, { label, from: 'spawn' }); return; } catch (err) { H.report(err, 'overseer beam'); }
    }
    const w = W();
    if (!w || !w.scene) return;
    const sc = w.scene;
    const col = B.MeshBuilder.CreateCylinder('spawn-beam', { diameterTop: 0.15, diameterBottom: 1.2, height: 40, tessellation: 16 }, sc);
    col.position.set(at[0], at[1] + 20, at[2]);
    const m = new B.StandardMaterial('spawn-beam', sc);
    m.emissiveColor = new B.Color3(0.65, 0.85, 1); m.disableLighting = true; m.alpha = 0.35; m.backFaceCulling = false;
    col.material = m; col.isPickable = false; col.metadata = { decor: true, spawnGhost: true };
    const t0 = performance.now();
    const obs = sc.onBeforeRenderObservable.add(() => {
      const k = (performance.now() - t0) / 700;
      m.alpha = 0.4 * (1 - k);
      col.scaling.x = col.scaling.z = 1 - k * 0.7;
      if (k >= 1) { sc.onBeforeRenderObservable.remove(obs); col.dispose(); m.dispose(); }
    });
    try { G().burst(at, { color: '#c8e6ff', count: 16, speed: 3 }); } catch { /* no particles */ }
  }
  S.beam = beam;

  // ------------------------------------------------------------------ spawning
  const VEHICLE = new Set(['car', 'truck', 'bicycle', 'motorbike', 'boat', 'submarine', 'airplane', 'helicopter', 'vehicle']);
  /** The specs to create: one per point, each with its own id, place and turn. Pure (tests use it). */
  function layout(spec, place, o = {}) {
    const yaw = VEHICLE.has(spec.type) ? place.away : place.toward;
    return place.points.map((p) => {
      const s = clone(spec);
      delete s.liftHint;
      s.id = o.ids ? o.ids() : newId(s.name || s.type);
      s.transform = { ...(s.transform || {}), position: p };
      if (!spec.transform || !spec.transform.rotation) s.transform.rotation = [0, yaw, 0];
      return s;
    });
  }
  S.layout = layout;
  let busy = false;
  /**
   * Spawns an item (a wheel tile) `count` times in front of the player. Building: scene ops (one undo). Playing:
   * runtime things (not saved), when allowed. Resolves { ok, count, ids, error }.
   */
  S.spawn = async (it, o = {}) => {
    if (!it) return { ok: false, error: 'Nothing chosen' };
    if (!S.allowed()) { say('Spawning is for building in this game'); return { ok: false, error: 'not allowed' }; }
    if (busy && it.lib) return { ok: false, error: 'busy' };
    const st = S.settings();
    const count = Math.max(1, Math.min(st.max || 10, Math.floor(o.count || 1)));
    const building = H.mode === 'build';
    if (it.build && !building) { say(`${it.name}: only while building`); return { ok: false, error: 'build only' }; }
    const pre = S.place(quickSpec(it), { count, floats: it.floats });
    if (it.kit) return kit(it, pre);
    busy = Boolean(it.lib);
    if (it.lib) say(`Bringing ${it.name} from the library…`);
    let r;
    try { r = await resolve(it, pre); } finally { busy = false; }
    if (r.error) { say(r.error, 2.2); return { ok: false, error: r.error }; }
    S.recent.add(it);
    const label = `${count > 1 ? `${count} × ` : ''}${it.name}`;
    // The world itself (building): one config edit.
    if (r.config) { edit([{ op: 'config', patch: r.config }], `changing ${r.label || 'the world'}`); say(r.said || `${it.name} ✓`); done(it, count); return { ok: true, count: 1, ids: [] }; }
    if (r.world) return world(it, r.world, pre);
    if (r.effect) { effect(r.effect, pre, count); done(it, count); return { ok: true, count, ids: [] }; }
    const spec = r.spec;
    const place = S.place(spec, { count, floats: it.floats });
    const specs = layout(spec, place);
    // The Overseer's arrivals (H.arrive) beam, drop and grow things themselves; building, a drop's spot is where it
    // will land (a roof over it catches it), worked out before the edit so the op and undo hold the real spot.
    if (H.arrive) { if (building) H.arrive.plan(specs, { half: place.half }); }
    else for (const s of specs) beam(s.transform.position, it.name);
    let ids = [];
    if (building) {
      edit(specs.map((s) => ({ op: 'create', entity: s })), `spawning ${label.toLowerCase()}`, 'materialize');
      ids = specs.map((s) => s.id);
      say(`${label} ✓ · Ctrl+Z takes ${count > 1 ? 'them' : 'it'} back`);
    } else {
      ids = runtime(specs);
      say(`${label} ✓`, 1.2);
    }
    done(it, count, ids);
    return { ok: true, count: specs.length, ids };
  };
  /** While playing, a kit's settings reach everyone in the room (not saved: playing changes nothing for good). */
  const kitConfig = H.sync && H.sync.action ? H.sync.action('_kitcfg', (patch) => { try { H.applyOps([{ op: 'config', patch }], { local: true }); } catch (err) { H.report(err, 'kit'); } }) : (patch) => H.applyOps([{ op: 'config', patch }], { local: true });
  /** A play kit (H.kits): its things laid out round the spot, facing you; saved while building, shared while playing. */
  function kit(it, pre) {
    const building = H.mode === 'build';
    const specs = H.kits.build(it.kit, pre.center, radYaw()).map((s) => ({ ...s, id: newId(s.name || it.kit) }));
    if (!specs.length) { say(`${it.name} can't be placed`, 2); return { ok: false, error: 'empty kit' }; }
    S.recent.add(it);
    // A kit that is a game (a match, a weapon, waves) changes the world's settings too.
    const cfg = H.kits.config ? H.kits.config(it.kit, {}, pre.center) : null;
    let ids = [];
    if (building) {
      edit([...specs.map((s) => ({ op: 'create', entity: s })), ...(cfg ? [{ op: 'config', patch: cfg }] : [])], `adding ${it.name.toLowerCase()}`, 'materialize');
      ids = specs.map((s) => s.id);
      say(`${it.name} ✓ · Ctrl+Z takes it back`);
    } else {
      ids = runtime(specs);
      if (cfg) kitConfig(cfg);
      say(`${it.name} ✓`, 1.4);
    }
    done(it, 1, ids);
    const shared = H.kits.sharedId && H.kits.sharedId(it.kit);
    if (shared) try { fetch(`${(S.library && S.library.base) || ''}/v1/community/kits/${shared}/used`, { method: 'POST', credentials: 'omit' }).catch(() => {}); } catch { /* fine */ }
    return { ok: true, count: specs.length, ids };
  }
  function done(it, count, ids = []) { try { G().emit('spawn', { item: { id: it.id, name: it.name, type: it.type, category: it.cat }, count, ids }); } catch { /* no world */ } }
  /** A world edit (building): through the editor's tools (saved, undoable), or applied here when there is no editor. */
  function edit(ops, label, fx) {
    if (window.HawkesBuild && window.HawkesBuild.edit) window.HawkesBuild.edit(ops, { label, fx });
    else H.applyOps(ops, { local: true, fx });
  }
  S.edit = edit;
  /** While playing: things that aren't saved (Mayhem's spawning shares them online; the host moves them). */
  function runtime(specs) {
    const out = [];
    for (const s of specs) {
      const p = s.transform.position;
      const rot = s.transform.rotation;
      let made = [];
      if (H.mayhem && H.mayhem.spawnMany) {
        const spec = clone(s); delete spec.id;
        made = H.mayhem.spawnMany(spec, 1, { at: p, ground: false, effects: false, arrive: { delay: out.length * Math.min(0.14, 2.6 / specs.length) } }) || [];
      } else {
        try { const e = H.fromSpec({ ...s, id: undefined }); e.temporary = true; e.spawned = true; made = [e]; } catch (err) { H.report(err, 'spawn'); }
      }
      for (const e of made) { if (rot && e.node) { try { e.rotation = rot[1]; } catch { /* a kind that turns itself */ } } e.keep = false; out.push(e.sceneId || e.id || null); }
    }
    return out;
  }

  // ------------------------------------------------------------------ the world: terrain, water, weather, disasters
  /** A point around you in the terrain's own coordinates ([x, z]). On a round world the terrain is a patch of the
   *  planet: a point outside it (less `margin` from its edge) grows it to hold both (up to 1024 m across), or else, when
   *  there's none yet or it is far, moves it to be round you (`cfg`, the terrain's config, is changed in place). */
  S.terrainPoint = terrainPoint;
  function terrainPoint(cfg, x, y, z, margin) {
    const fr = H.planet && H.planet.frame;
    if (!fr || !fr.on || !fr.toPlanet) return [r2(x), r2(z)];
    const t = H.terrain && H.terrain.info;
    if (t) {
      const f = H.terrain.fieldPoint([x, y, z]);
      const half = t.size / 2;
      const dx = Math.abs(f[0] - t.center[0]), dz = Math.abs(f[2] - t.center[1]);
      if (dx < half - margin && dz < half - margin) return [r2(f[0]), r2(f[2])];
      const lo = [Math.min(t.center[0] - half, f[0] - margin), Math.min(t.center[1] - half, f[2] - margin)];
      const hi = [Math.max(t.center[0] + half, f[0] + margin), Math.max(t.center[1] + half, f[2] + margin)];
      const size = Math.ceil(Math.max(hi[0] - lo[0], hi[1] - lo[1]) / 64) * 64;
      if (size <= 1024) {
        cfg.center = [r2((lo[0] + hi[0]) / 2), r2((lo[1] + hi[1]) / 2)];
        cfg.size = size;
        return [r2(f[0]), r2(f[2])];
      }
    }
    // ([x, 0, z] on the ball is the field's middle, as terrain.js puts it: the planet point's direction, at height 0.)
    const R = H.planet.configure().radius;
    const onBall = (p) => { const q = fr.toPlanet(p); const k = R / (q[1] + R); return [r2(q[0] * k), r2(q[2] * k)]; };
    const v = S.viewer();
    cfg.center = onBall([v.x, v.y, v.z]);
    return onBall([x, y, z]);
  }
  function world(it, w, pre) {
    const building = H.mode === 'build';
    const at = pre.center;
    const c = (() => { try { return H.lib.effectiveConfig() || {}; } catch { return {}; } })();
    if (w.terrainAdd) {
      const v = S.viewer();
      const dist = (w.radius || 20) + 8;
      const cur = c.terrain && typeof c.terrain === 'object' ? clone(c.terrain) : { shape: 'flat' };
      const [x, z] = terrainPoint(cur, v.x + v.dx * dist, v.y, v.z + v.dz * dist, (w.radius || 20) + 10);
      const add = { type: w.terrainAdd, at: [x, z], radius: w.radius };
      if (w.height) add.height = w.height;
      if (w.depth) add.depth = w.depth;
      cur.add = [...(Array.isArray(cur.add) ? cur.add : []), add];
      edit([{ op: 'config', patch: { terrain: cur } }], `adding a ${w.terrainAdd}`);
      if (!H.arrive) beam([x, at[1], z], it.name); // (the ground grows itself, under the Overseer's beam)
      say(`${it.name.replace(/ here$/, '')} ✓ · Ctrl+Z takes it back`);
    } else if (w.terrain) {
      const cur = c.terrain && typeof c.terrain === 'object' ? clone(c.terrain) : {};
      const v = S.viewer();
      terrainPoint(cur, v.x, v.y, v.z, Number(cur.size || 512) * 0.3); // (round: around you, not at the planet's top)
      edit([{ op: 'config', patch: { terrain: { ...cur, shape: w.terrain } } }], 'the ground');
      say(`${it.name} ✓ · Ctrl+Z takes it back`);
    } else if (w.water) {
      edit([{ op: 'config', patch: { water: c.water && typeof c.water === 'object' ? c.water : w.water } }], 'the sea');
      say('The sea ✓');
    } else if (w.weather) {
      if (building) edit([{ op: 'config', patch: { weather: w.weather === 'clear' ? null : w.weather } }], 'the weather');
      else if (H.events && H.events.perform) H.events.perform({ weather: w.weather }, {});
      say(`${it.name} ✓`);
    } else if (w.disaster) {
      if (H.events && H.events.perform) H.events.perform({ disaster: w.disaster, at }, {});
      beam(at, it.name);
      if (building) say(`${it.name} (it happens now; it isn't saved)`, 2.4);
    }
    done(it, 1);
    return { ok: true, count: 1, ids: [] };
  }

  // ------------------------------------------------------------------ effects (now, not saved)
  const COLORS = ['#ff5d73', '#ffd166', '#06d6a0', '#4cc9f0', '#b388ff', '#ffffff'];
  function effect(fx, pre, count) {
    const g = G();
    const pts = pre.points.length ? pre.points : [pre.center];
    pts.forEach((p, i) => setTimeout(() => {
      const at = [p[0], p[1], p[2]];
      if (/explosion|fireball/.test(fx.name) && H.mayhem) H.mayhem.explode(at, { radius: fx.radius, force: fx.force, fire: fx.fire });
      else if (fx.name === 'fireworks') for (let k = 0; k < 5; k++) setTimeout(() => { try { g.burst([at[0] + (Math.random() - 0.5) * 6, at[1] + 7 + Math.random() * 5, at[2] + (Math.random() - 0.5) * 6], { color: COLORS[k % COLORS.length], count: 70, speed: 8 }); if (H.mayhem && H.mayhem.sound) H.mayhem.sound('pop', { at }); } catch { /* gone */ } }, k * 260);
      else if (fx.name === 'confetti') for (const c of COLORS) g.burst([at[0], at[1] + 1.5, at[2]], { color: c, count: 22, speed: 6 });
      else if (fx.name === 'sparks' && H.mayhem && H.mayhem.sparks) H.mayhem.sparks(at, {});
      else if (fx.name === 'smoke' && H.mayhem && H.mayhem.smoke) H.mayhem.smoke(at, {});
      else if (fx.name === 'slow motion') { H.slow('spawn', 0.35); setTimeout(() => H.slow('spawn', null), (fx.seconds || 3) * 1000); }
      else g.burst(at, { color: '#ffffff', count: 30, speed: 4 });
    }, i * 120));
    if (H.mode === 'build' && fx.name !== 'slow motion') say(`${fx.name[0].toUpperCase()}${fx.name.slice(1)} (effects happen now; they aren't saved)`, 2.2);
    void count;
  }

  // ------------------------------------------------------------------ the ghost: where it will land
  const ghost = { item: null, count: 1, meshes: [], mat: null, ring: null, scene: null, spec: null };
  function clearGhost() { for (const m of ghost.meshes) try { m.dispose(); } catch { /* gone */ } ghost.meshes = []; }
  function ghostMat(sc) {
    if (ghost.mat && ghost.scene === sc) return ghost.mat;
    ghost.scene = sc;
    const m = new B.StandardMaterial('spawn-ghost', sc);
    m.emissiveColor = new B.Color3(0.3, 0.6, 1); m.disableLighting = true; m.alpha = 0.1; m.wireframe = false; m.backFaceCulling = false;
    ghost.mat = m;
    return m;
  }
  function drawGhost() {
    const w = W();
    if (!ghost.item || !w || !w.scene) { clearGhost(); return; }
    const it = ghost.item;
    const spec = ghost.spec;
    const place = it.world || it.effect ? S.place({ type: 'box', shape: { size: (it.world && it.world.radius) ? 2 : 1 } }, { count: ghost.count }) : S.place(spec, { count: ghost.count, floats: it.floats });
    const sc = w.scene;
    const n = place.points.length;
    if (ghost.meshes.length !== n * 2) {
      clearGhost();
      const mat = ghostMat(sc);
      for (let i = 0; i < n; i++) {
        const box = B.MeshBuilder.CreateBox('spawn-ghost', { size: 1 }, sc);
        const ring = B.MeshBuilder.CreateTorus('spawn-ghost-ring', { diameter: 1, thickness: 0.04, tessellation: 32 }, sc);
        for (const m of [box, ring]) { m.material = mat; m.isPickable = false; m.metadata = { decor: true, spawnGhost: true }; ghost.meshes.push(m); }
        // A see-through box with bright edges: where it lands, without hiding what's behind.
        try { box.enableEdgesRendering(); box.edgesWidth = 3; box.edgesColor = new B.Color4(0.6, 0.9, 1, 0.9); } catch { /* no edges renderer (tests) */ }
      }
    }
    const t = performance.now() / 1000;
    for (let i = 0; i < n; i++) {
      const p = place.points[i];
      const box = ghost.meshes[i * 2], ring = ghost.meshes[i * 2 + 1];
      const h = Math.max(0.3, place.lift * 2), wd = place.half * 2;
      box.scaling.set(wd, h, wd);
      box.position.set(p[0], p[1], p[2]);
      box.rotation.y = t * 0.6;
      ring.scaling.set(wd * 1.25, 1, wd * 1.25);
      ring.position.set(p[0], p[1] - place.lift + 0.04, p[2]);
    }
    if (ghost.mat) ghost.mat.alpha = 0.07 + 0.04 * Math.sin(t * 5);
  }
  S.ghost = {
    show(it, count = 1) {
      if (!it) { S.ghost.hide(); return; }
      if (ghost.item !== it || ghost.count !== count) { ghost.item = it; ghost.count = count; ghost.spec = quickSpec(it); clearGhost(); }
    },
    hide() { ghost.item = null; ghost.spec = null; clearGhost(); },
    get item() { return ghost.item; },
    get count() { return ghost.count; },
  };
  H.hooks.frame.push(() => { if (ghost.item) drawGhost(); });
  H.hooks.world.push({ enter() { ghost.mat = null; ghost.scene = null; ghost.meshes = []; ghost.item = null; }, leave() { clearGhost(); ghost.item = null; } });

  // ------------------------------------------------------------------ for scripts (game.spawnWheel)
  /** Finds the best item for a word or an id ("cow", "4x4", "kind:truck:4x4"). */
  S.pick = (what) => S.find(String(what)) || S.search(String(what), { limit: 1 })[0] || null;
  H.hooks.game.push((g) => {
    g.spawnWheel = {
      open: () => S.open && S.open(),
      close: () => S.close && S.close(),
      allowed: () => S.allowed(),
      /** Spawns by word or id, as the wheel would (building: saved; playing: when the game allows it). */
      spawn: (what, count = 1) => { const it = S.pick(what); return it ? S.spawn(it, { count }) : Promise.resolve({ ok: false, error: `Nothing called ${what}` }); },
      search: (q) => S.search(q).map((i) => ({ id: i.id, name: i.name, type: i.type, category: i.catName })),
    };
  });
})();
