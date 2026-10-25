// Presence, part 1e: Gen-made hats (docs/characters.md "Gen hats"). presence.js hat() draws every hat from primitives; when the
// registry (presence-model-registry.js `P.hatRegistry`: { cap: { url, width, sink, tint } }) names a GLB for the worn hat and it has
// loaded, that model sits in its place on rig.neck (the head anchor of the person and of every Gen model type, scaled to the head),
// so it follows the head. While it loads, for a hat with no row, and when the load fails or the file is too heavy, the procedural
// hat stays (nothing in the look changes). One container per file per scene; each wearer is an instance with its own materials.
//
//   put(rig, kind, accent, body)  true when a model hat was placed (presence.js dress() then skips the procedural one); else starts
//                                 the load and, when it arrives, asks P._redress(rig) to dress again
//   clear(rig)                    the instance goes (dress again, a look change, disposeRig)
//   stats(rig)                    { kind, tris, tint } of the worn model hat, for /avatars and the playtest
//   setLoader(fn), reset()        for tests
/* global HawkesPlay, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = BABYLON;
  const P = (H.presence = H.presence || {});
  const HAT_Y = 0.44;          // the head's top in the `neck` node's units (the unit head is 0.43 wide)
  const MAX_TRIS = 1800;       // a hat is made for ~1.5k; one over this is not used (the procedural hat stays)
  let cache = new WeakMap(); // scene -> Map(url -> { promise, value, failed })
  let loader = (scene, url) => {
    if (!B.SceneLoader || !B.SceneLoader.LoadAssetContainerAsync) return Promise.reject(new Error('no model loader'));
    return B.SceneLoader.LoadAssetContainerAsync(url, '', scene, null, '.glb');
  };
  const row = (kind) => { const r = (P.hatRegistry || {})[kind]; return r && r.url ? r : null; };
  function fetch(scene, url) {
    let m = cache.get(scene);
    if (!m) cache.set(scene, (m = new Map()));
    let c = m.get(url);
    if (c && c.failed && (performance.now() - c.failed) < 30000) return c;
    if (!c || c.failed) {
      c = { promise: null, value: null, failed: 0, tris: 0 };
      m.set(url, c);
      let got;
      try { got = loader(scene, url); } catch (err) { got = Promise.reject(err); }
      c.promise = Promise.resolve(got).then((v) => {
        c.tris = Math.round(v.meshes.reduce((n, mesh) => n + (mesh.getTotalIndices ? mesh.getTotalIndices() : 0) / 3, 0));
        if (c.tris > MAX_TRIS) { c.failed = performance.now() || 1; c.tooHeavy = true; try { v.dispose(); } catch {} throw new Error(`hat over budget: ${c.tris} triangles`); }
        c.value = v; return v;
      }, (err) => { c.failed = performance.now() || 1; throw err; });
      c.promise.catch(() => {}); // (a failed load is the procedural hat; nobody waits on it)
    }
    return c;
  }
  function clear(rig) {
    const h = rig.hatModel;
    if (!h) return;
    rig.hatModel = null;
    try { h.holder.dispose(false, false); } catch {}
    for (const m of h.mats) try { m.dispose(false, false); } catch {} // (this wearer's own copies; the textures are the container's)
  }
  /** The hat's colour: the model's main (first, largest) material is multiplied by the accent where the row says it is a flat colour. */
  function tint(h, hex) {
    for (const mat of h.mats) {
      const c = B.Color3.FromHexString(hex);
      if ('albedoColor' in mat) mat.albedoColor = c; else if ('diffuseColor' in mat) mat.diffuseColor = c;
    }
  }
  function build(rig, kind, r, c, accent, body) {
    const inst = c.value.instantiateModelsToScene((n) => `hat-${n}`, true);
    const holder = new B.TransformNode(`hat-${kind}`, rig.scene);
    const fit = new B.TransformNode(`hat-fit-${kind}`, rig.scene);
    fit.parent = holder;
    for (const n of inst.rootNodes) n.parent = fit;
    holder.computeWorldMatrix(true); fit.computeWorldMatrix(true);
    for (const n of inst.rootNodes) n.computeWorldMatrix(true);
    // the base of the hat at the origin, its width as the row says, whatever the file's size and origin
    const bb = fit.getHierarchyBoundingVectors(true);
    const w = Math.max(1e-4, bb.max.x - bb.min.x, bb.max.z - bb.min.z);
    const s = (r.width || 0.5) / w;
    fit.scaling.setAll(s);
    fit.position.set(-(bb.min.x + bb.max.x) / 2 * s, -bb.min.y * s - (r.sink ?? 0.02), -(bb.min.z + bb.max.z) / 2 * s);
    holder.parent = rig.neck; holder.position.set(0, HAT_Y, 0);
    const meshes = inst.rootNodes.flatMap((n) => [n, ...n.getChildMeshes(false)]).filter((n) => n.getTotalIndices);
    for (const m of meshes) { m.isPickable = false; m.metadata = { decor: true, entity: rig.e }; if (rig.shadows) try { rig.shadows.addShadowCaster(m); } catch {} }
    const mats = [...new Set(meshes.map((m) => m.material).filter(Boolean))];
    const h = { kind, holder, mats, tris: c.tris, tinted: false };
    if (r.tint && accent && accent !== '#ffffff') { tint(h, accent); h.tinted = true; }
    else if (r.tint && r.tint === 'body' && body) { tint(h, body); h.tinted = true; }
    return h;
  }
  function put(rig, kind, accent, body) {
    clear(rig);
    const r = row(kind);
    if (!r || !rig.neck || !rig.scene) return false;
    const c = fetch(rig.scene, r.url);
    if (c.value) {
      try { rig.hatModel = build(rig, kind, r, c, accent, body); return true; } catch (err) { if (H.report) H.report(err, 'presence'); return false; }
    }
    if (!c.failed && rig.hatWait !== kind) {
      rig.hatWait = kind;
      rig.hatPromise = c.promise.then(() => {}, () => {});
      c.promise.then(() => { if (rig.hatWait === kind) { rig.hatWait = null; if (rig.root && !rig.root.isDisposed() && P._redress) P._redress(rig); } }, () => { rig.hatWait = null; });
    }
    return false;
  }
  const stats = (rig) => (rig.hatModel ? { kind: rig.hatModel.kind, tris: rig.hatModel.tris, tinted: rig.hatModel.tinted } : null);
  P.hats = { put, clear, stats, MAX_TRIS, setLoader: (fn) => { loader = fn || loader; }, reset: () => { cache = new WeakMap(); }, ready: (rig) => rig.hatPromise || Promise.resolve() };
})();
