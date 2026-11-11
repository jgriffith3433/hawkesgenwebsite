// The world audit: what a player sees wrong in a built world, read from the engine's own scene (Studio's quality rules
// 1 to 4: backwards text, z-fighting, inside-out models, things sunk into or floating over the ground). One file for both:
// the repo's tests run it on a world in Node (test/engine/world-quality.test.ts), and Studio's playtest asks a live page
// for it through play.html's automation bridge (public/playtest/world-quality.js). It reads, it never changes the world.
//
//   window.HawkesWorldAudit.audit(H, o) -> { problems: [{ rule, kind, id, detail }], counts: { ... } }
//     H   the engine (window.HawkesPlay) with a world running
//     o   { groundTolerance: 0.15 (m a thing may float), sinkTolerance: 0.6 (m, or half its height, a thing may sink),
//           near: 300 (m: only things this close to the camera, where the planet's curve doesn't matter), skip: [ids] }
//
//   ground     every static thing of the world file (and what spawns at the start): the bottom of its drawn bounds, not its
//              pivot, against the ground under its footprint, or the top of another thing it stands on. A gap of more than
//              the tolerance with nothing under it is `floating`; a base deeper than the tolerance is `sunk`; a thing whose
//              top is under the ground is `buried`. Things on the water (its surface under them) count as standing.
//   text       every flat plane of words: from each side a viewer can see, does u (the words' left to right) run to the
//              viewer's right? A side that reads mirrored is `backwards`. (Billboards turn to the camera and are skipped.)
//   coplanar   axis-aligned boxes and planes whose same-facing faces lie in one plane and overlap (`zfight`), and flat
//              planes laid exactly on the ground; a material's zOffset (drawn in front) clears it.
//   assets     every thing of the world whose model, texture or picture is missing: its reference names nothing the game
//              has (`waiting`: a builder sees a wireframe, a player sees nothing), its file would not load (`broken`), or the
//              server says the library no longer has it (`gone`). Rule 5 (Jaycee, 2026-11-10: no missing assets anywhere).
//   normals    a closed mesh drawn one-sided whose triangles mostly wind inward (`inside-out`), measured against a box the
//              audit builds itself, so it holds whatever the engine's winding convention is.
//   flicker    (browser) two consecutive frames at each of 10 fixed spots; any pixel that changes is a z-fight flicker.
//   backfaces  (browser) eight camera angles around the island; a mesh whose facing triangles wind inward from that view
//              is `inside-out` (rule 3).
//   gaps       per-prop gap (m) of drawn base over (+) or under (−) the ground; the playtest fails any |gap| > 0.05.
(function () {
  const B = () => window.BABYLON;
  const FINISH = () => window.HawkesFinishMath;

  function worldVerts(mesh) {
    const pos = mesh.getVerticesData && mesh.getVerticesData(B().VertexBuffer.PositionKind);
    if (!pos) return null;
    const m = mesh.computeWorldMatrix(true);
    const out = [];
    const v = new (B().Vector3)();
    for (let i = 0; i < pos.length; i += 3) { B().Vector3.TransformCoordinatesFromFloatsToRef(pos[i], pos[i + 1], pos[i + 2], m, v); out.push([v.x, v.y, v.z]); }
    return out;
  }
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const len = (a) => Math.hypot(a[0], a[1], a[2]);
  const r2 = (x) => Math.round(x * 100) / 100;

  // A mesh that is part of the world as drawn (not a helper, a bubble, a gizmo or something hidden).
  function drawn(mesh) {
    if (!mesh || !mesh.isEnabled || !mesh.isEnabled() || !mesh.isVisible || mesh.visibility === 0) return false;
    if (mesh.metadata && mesh.metadata.decor) return false;
    if (mesh.material && mesh.material.wireframe) return false; // a stand-in while a model loads, not what the player will see
    if (!mesh.getTotalVertices || mesh.getTotalVertices() < 3) return false;
    return true;
  }
  function owner(mesh) {
    for (let n = mesh; n; n = n.parent) if (n.metadata && n.metadata.entity) return n.metadata.entity;
    return null;
  }

  // ------------------------------------------------------------------ rule 4: on the ground
  function groundAudit(H, W, o, problems, counts) {
    const T = H.terrain;
    if (!T || !T.heightAt) { counts.groundSkipped = 'no terrain'; return; }
    const water = (x, z) => { try { const s = H.water && H.water.surfaceAt ? H.water.surfaceAt(x, z) : null; return Number.isFinite(s) ? s : null; } catch { return null; } };
    const cam = W.scene.activeCamera;
    const things = [];
    for (const e of W.entities) {
      if (!e.alive || !e.sceneId || e.physics !== 'static' || !e.node || o.skip.includes(e.sceneId)) continue;
      const spec = e.spec || {};
      if ((spec.data && (spec.data.flies || spec.data.air || spec.data.hangs)) || spec.tag === 'sky') continue; // meant to be up there
      const meshes = [e.node, ...(e.node.getChildMeshes ? e.node.getChildMeshes(false) : [])].filter((m) => m.getBoundingInfo && drawn(m));
      if (!meshes.length) continue;
      let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (const m of meshes) {
        m.computeWorldMatrix(true);
        const bb = m.getBoundingInfo().boundingBox;
        for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], bb.minimumWorld.asArray()[k]); max[k] = Math.max(max[k], bb.maximumWorld.asArray()[k]); }
      }
      if (!isFinite(min[1])) continue;
      if (cam && Math.hypot((min[0] + max[0]) / 2 - cam.position.x, (min[2] + max[2]) / 2 - cam.position.z) > o.near) continue;
      things.push({ e, id: e.sceneId, min, max });
    }
    counts.groundChecked = things.length;
    const gaps = [];
    for (const t of things) {
      const hx = (t.max[0] - t.min[0]) / 2, hz = (t.max[2] - t.min[2]) / 2, cx = t.min[0] + hx, cz = t.min[2] + hz;
      // The ground under its footprint: the middle and four points in from the corners (a long thing on a slope).
      const pts = [[cx, cz], ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => [cx + a * hx * 0.7, cz + b * hz * 0.7])];
      const g = pts.map(([x, z]) => T.heightAt(x, z)).filter(Number.isFinite);
      if (!g.length) continue;
      const lo = Math.min(...g), hi = Math.max(...g), mid = g[0];
      const sea = water(cx, cz);
      const bottom = t.min[1], top = t.max[1], height = top - bottom;
      // Held up by something: another thing under or through its base (a box it stands on, the post a board is fixed to),
      // touching its footprint.
      const on = things.find((u) => u !== t && u.min[1] < bottom + 0.05 && u.max[1] >= bottom - 0.1
        && u.min[0] < t.max[0] + 0.1 && u.max[0] > t.min[0] - 0.1 && u.min[2] < t.max[2] + 0.1 && u.max[2] > t.min[2] - 0.1);
      const wet = sea !== null && sea > mid; // standing in the sea: the water's surface is what it rests on or sinks into
      const floor = wet ? Math.max(hi, sea) : hi;
      const gap = bottom - floor;
      gaps.push({ id: t.id, gap: r2(gap), on: Boolean(on), wet: Boolean(wet) });
      if (gap > o.groundTolerance && !on && gap < o.airborne) {
        problems.push({ rule: 4, kind: 'floating', id: t.id, detail: `its base is ${r2(gap)} m over the ${wet ? 'water' : 'ground'}` });
      } else if (top < mid - 0.05 && !wet) {
        problems.push({ rule: 4, kind: 'buried', id: t.id, detail: `all of it is under the ground (top ${r2(mid - top)} m down)` });
      } else if (lo - bottom > Math.max(o.sinkTolerance, height * 0.5) && !on && !wet) {
        problems.push({ rule: 4, kind: 'sunk', id: t.id, detail: `${r2(lo - bottom)} m of its ${r2(height)} m sinks into the ground` });
      }
    }
    counts.gaps = gaps;
    counts.gapWorst = gaps.reduce((w, g) => (!g.on && Math.abs(g.gap) > Math.abs(w) ? g.gap : w), 0);
  }

  // ------------------------------------------------------------------ rule 1: words read the right way round
  function textAudit(W, problems, counts) {
    let checked = 0, billboards = 0;
    for (const mesh of W.scene.meshes) {
      const mat = mesh.material;
      const tex = mat && mat.diffuseTexture;
      if (!drawn(mesh) || !tex || (mesh.name !== 'text' && mesh.name !== 'video')) continue; // the engine's planes of words (textPlane), screens
      if (mesh.billboardMode) { billboards++; continue; }
      const verts = worldVerts(mesh);
      const uv = mesh.getVerticesData(B().VertexBuffer.UVKind);
      const idx = mesh.getIndices();
      if (!verts || !uv || !idx) continue;
      checked++;
      // A mirrored thing (negative scale) is drawn with its faces turned round (the engine flips culling), so its front is
      // the other side of its winding.
      const flip = Math.sign(mesh.getWorldMatrix().determinant()) || 1;
      // Culling off: every triangle is seen from both sides (a two-sided plane's back triangles show through its front).
      const sides = mat.backFaceCulling === false ? [1, -1] : [1];
      let wrong = 0;
      for (let i = 0; i < idx.length; i += 3) {
        const [a, b, c] = [idx[i], idx[i + 1], idx[i + 2]];
        const e1 = sub(verts[b], verts[a]), e2 = sub(verts[c], verts[a]);
        const n = cross(e1, e2);
        if (len(n) < 1e-9) continue;
        // Where the words' left-to-right (U) and bottom-to-top (V) run on this triangle, in the world.
        const du1 = uv[b * 2] - uv[a * 2], dv1 = uv[b * 2 + 1] - uv[a * 2 + 1], du2 = uv[c * 2] - uv[a * 2], dv2 = uv[c * 2 + 1] - uv[a * 2 + 1];
        const det = du1 * dv2 - du2 * dv1;
        if (Math.abs(det) < 1e-12) continue;
        const U = [0, 1, 2].map((k) => (dv2 * e1[k] - dv1 * e2[k]) / det), V = [0, 1, 2].map((k) => (du1 * e2[k] - du2 * e1[k]) / det);
        const facing = n.map((x) => x * WINDING * flip); // out of its front (the winding, calibrated)
        for (const sd of sides) {
          const view = facing.map((x) => -x * sd); // the viewer looks against the side they see
          // Read right: with V as up, U runs to the viewer's right (up x view, in this left-handed world).
          if (dot(cross(V, view), U) < 0) wrong++;
        }
      }
      if (wrong) problems.push({ rule: 1, kind: 'backwards', id: (owner(mesh) && owner(mesh).sceneId) || mesh.name, detail: `${wrong} triangle${wrong > 1 ? 's' : ''} of its words read mirrored` });
    }
    counts.textChecked = checked; counts.textBillboards = billboards;
  }

  // ------------------------------------------------------------------ rule 2: no two faces in one plane
  function axisAligned(mesh) {
    const q = new (B().Quaternion)(), sc = new (B().Vector3)(), tr = new (B().Vector3)();
    mesh.computeWorldMatrix(true).decompose(sc, q, tr);
    const e = q.toEulerAngles();
    const quarter = (a) => Math.abs(a / (Math.PI / 2) - Math.round(a / (Math.PI / 2))) < 0.01;
    return quarter(e.x) && quarter(e.y) && quarter(e.z);
  }
  function coplanarAudit(H, W, o, problems, counts) {
    const boxes = [];
    for (const mesh of W.scene.meshes) {
      if (!drawn(mesh) || !mesh.material || mesh.material.zOffset || mesh.billboardMode) continue;
      const nv = mesh.getTotalVertices();
      if (nv !== 24 && nv !== 4 && nv !== 8) continue; // boxes and planes, the things agents stack
      if (!axisAligned(mesh)) continue;
      const own = owner(mesh);
      if (own && (own.physics === 'dynamic' || !own.sceneId)) continue;
      const bb = mesh.getBoundingInfo().boundingBox;
      boxes.push({ mesh, id: (own && own.sceneId) || mesh.name, min: bb.minimumWorld.asArray(), max: bb.maximumWorld.asArray(), flat: nv !== 24 });
    }
    counts.coplanarChecked = boxes.length;
    const eps = 0.002, seen = new Set();
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      for (let k = 0; k < 3; k++) {
        const u = (k + 1) % 3, v = (k + 2) % 3;
        const ou = Math.min(a.max[u], b.max[u]) - Math.max(a.min[u], b.min[u]);
        const ov = Math.min(a.max[v], b.max[v]) - Math.max(a.min[v], b.min[v]);
        if (ou <= 0.01 || ov <= 0.01) continue;
        // Same-facing faces in one plane: both tops, both bottoms, both fronts... (a face against a face is hidden, not a fight)
        const same = (Math.abs(a.max[k] - b.max[k]) < eps && !(a.flat && b.flat && Math.abs(a.min[k] - b.min[k]) >= eps) ? 'max' : null)
          || (Math.abs(a.min[k] - b.min[k]) < eps ? 'min' : null);
        if (!same) continue;
        // Planes have no thickness: they face whichever way; a box's face and a plane in its plane fight too.
        const key = [a.id, b.id].sort().join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        problems.push({ rule: 2, kind: 'zfight', id: a.id, detail: `a face lies in the same plane as ${b.id}'s (${'xyz'[k]} ${r2(same === 'max' ? a.max[k] : a.min[k])}, ${r2(ou * ov)} m² overlap)` });
      }
    }
    // Flat things laid exactly on the ground flicker with it.
    if (H.terrain && H.terrain.heightAt) for (const t of boxes) {
      if (t.max[1] - t.min[1] > 0.02) continue;
      const cx = (t.min[0] + t.max[0]) / 2, cz = (t.min[2] + t.max[2]) / 2;
      const g = H.terrain.heightAt(cx, cz);
      if (Number.isFinite(g) && Math.abs(t.max[1] - g) < 0.004) problems.push({ rule: 2, kind: 'zfight', id: t.id, detail: 'a flat plane laid exactly on the ground' });
    }
  }

  // ------------------------------------------------------------------ rule 3: drawn from the outside
  let WINDING = 1; // +1 when a triangle's (b-a)x(c-a) points out of a front face, -1 when it points in (calibrated below)
  function calibrate(scene) {
    const box = B().MeshBuilder.CreateBox('audit-calibrate', { size: 1 }, scene);
    box.setEnabled(false);
    WINDING = Math.sign(inwardShare(box, true)) || 1;
    box.dispose();
  }
  // The share of a mesh's triangle area whose winding normal points outward (from its middle), as +out/-in balance when raw.
  function inwardShare(mesh, raw) {
    const verts = worldVerts(mesh);
    const idx = mesh.getIndices();
    if (!verts || !idx || !idx.length) return 0;
    const flip = raw ? 1 : Math.sign(mesh.getWorldMatrix().determinant()) || 1;
    const c = verts.reduce((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0]).map((x) => x / verts.length);
    let out = 0, inn = 0;
    for (let i = 0; i < idx.length; i += 3) {
      const a = verts[idx[i]], b = verts[idx[i + 1]], cc = verts[idx[i + 2]];
      const n = cross(sub(b, a), sub(cc, a));
      const area = len(n);
      if (area < 1e-9) continue;
      const mid = [(a[0] + b[0] + cc[0]) / 3 - c[0], (a[1] + b[1] + cc[1]) / 3 - c[1], (a[2] + b[2] + cc[2]) / 3 - c[2]];
      const d = dot(n, mid) / (area * (len(mid) || 1));
      if (Math.abs(d) < 0.2) continue; // edge-on to the middle (a flat part): says nothing
      if (d * (raw ? 1 : WINDING * flip) > 0) out += area; else inn += area;
    }
    if (raw) return out - inn;
    return out + inn > 0 ? inn / (out + inn) : 0;
  }
  // A closed mesh (every edge, with seams welded, shared by two triangles): only then is "inward" meaningful.
  function closed(mesh) {
    const pos = mesh.getVerticesData(B().VertexBuffer.PositionKind), idx = mesh.getIndices();
    if (!pos || !idx || idx.length > 60000) return false;
    const key = (i) => `${Math.round(pos[i * 3] * 1e4)},${Math.round(pos[i * 3 + 1] * 1e4)},${Math.round(pos[i * 3 + 2] * 1e4)}`;
    const edges = new Map();
    for (let i = 0; i < idx.length; i += 3) for (const [p, q] of [[idx[i], idx[i + 1]], [idx[i + 1], idx[i + 2]], [idx[i + 2], idx[i]]]) {
      const a = key(p), b = key(q);
      if (a === b) continue;
      const k = a < b ? a + '|' + b : b + '|' + a;
      edges.set(k, (edges.get(k) || 0) + 1);
    }
    let two = 0;
    for (const n of edges.values()) if (n === 2) two++;
    return edges.size > 0 && two / edges.size > 0.95;
  }
  // The share of triangles whose stored normals point against the face their winding draws (lit from behind: looks hollow).
  function normalsAgainstWinding(mesh) {
    const pos = mesh.getVerticesData(B().VertexBuffer.PositionKind), nor = mesh.getVerticesData(B().VertexBuffer.NormalKind), idx = mesh.getIndices();
    if (!pos || !nor || !idx || !idx.length) return 0;
    let against = 0, all = 0;
    for (let i = 0; i < idx.length; i += 3) {
      const P = (j) => [pos[idx[i + j] * 3], pos[idx[i + j] * 3 + 1], pos[idx[i + j] * 3 + 2]];
      const n = cross(sub(P(1), P(0)), sub(P(2), P(0)));
      if (len(n) < 1e-12) continue;
      let sn = [0, 0, 0];
      for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) sn[k] += nor[idx[i + j] * 3 + k];
      all++;
      if (dot(n, sn) * WINDING < 0) against++;
    }
    return all ? against / all : 0;
  }
  function normalsAudit(W, problems, counts) {
    let checked = 0;
    const seen = new Set();
    for (const mesh of W.scene.meshes) {
      if (!drawn(mesh) || !mesh.material || mesh.material.backFaceCulling === false || mesh.name === 'text') continue;
      if (mesh.sideOrientation === B().Mesh.DOUBLESIDE) continue;
      const bb = mesh.getBoundingInfo().boundingBox, ext = bb.extendSizeWorld;
      if (Math.min(ext.x, ext.y, ext.z) < 0.01) continue; // flat: no inside to see
      const geo = mesh.geometry || (mesh.sourceMesh && mesh.sourceMesh.geometry);
      const key = geo ? geo.uniqueId + ':' + Math.sign(mesh.computeWorldMatrix(true).determinant()) : null;
      if (key && seen.has(key)) continue; // one look per shape and handedness (instances share them)
      if (key) seen.add(key);
      checked++;
      const flipped = normalsAgainstWinding(mesh);
      const share = closed(mesh) ? inwardShare(mesh) : 0;
      if (flipped > 0.6) {
        const own = owner(mesh);
        problems.push({ rule: 3, kind: 'inside-out', id: (own && own.sceneId) || mesh.name, detail: `${Math.round(flipped * 100)}% of its normals point against its faces (${mesh.name})` });
      } else if (share > 0.6) {
        const own = owner(mesh);
        problems.push({ rule: 3, kind: 'inside-out', id: (own && own.sceneId) || mesh.name, detail: `${Math.round(share * 100)}% of its faces point inward (${mesh.name})` });
      }
    }
    counts.normalsChecked = checked;
  }

  // ------------------------------------------------------------------ rule 5: nothing missing
  function assetAudit(H, W, o, problems, counts) {
    let checked = 0;
    for (const e of W.entities) {
      if (!e.alive || o.skip.includes(e.sceneId)) continue;
      checked++;
      const id = e.sceneId || e.name || e.kind || '';
      if (e._waiting) problems.push({ rule: 5, kind: 'waiting', id, detail: `its asset "${e._waiting}" is not in the game (shown as a wireframe or not at all)` });
      else if (e._broken) problems.push({ rule: 5, kind: 'broken', id, detail: `its file "${e._broken}" would not load` });
    }
    const gone = H.bundle && Array.isArray(H.bundle.gone) ? H.bundle.gone : [];
    for (const g of gone) problems.push({ rule: 5, kind: 'gone', id: String(g), detail: 'the world names a library thing the library no longer has' });
    counts.assetsChecked = checked;
  }

  // Ten fixed spots: road, pier deck, hangar floor, helipad / decals, and other coplanar surfaces on the island.
  const FLICKER_SPOTS = [
    { id: 'road', at: [34, 12, 2], look: [40, 6, 0] },
    { id: 'pier-deck', at: [70, 4, 0], look: [78, 1.2, 0] },
    { id: 'pier-foot', at: [58, 4, 0], look: [62, 1.5, 0] },
    { id: 'helipad', at: [28, 12, 28], look: [30, 6.2, 30] },
    { id: 'helipad-h', at: [30, 9, 34], look: [30, 6.3, 30] },
    { id: 'sign', at: [56, 4, -6], look: [58.5, 2.2, -3.6] },
    { id: 'hut-yard', at: [-18, 10, 12], look: [-20, 6, 14] },
    { id: 'launch', at: [-34, 8, -26], look: [-38, 2, -30] },
    { id: 'ridge', at: [20, 14, 0], look: [34, 7, 0] },
    { id: 'hangar-floor', at: null, look: null }, // filled from the Overseer's hangar pad when present
  ];

  function canReadPixels(H) {
    try {
      const eng = H.world && H.world.scene && H.world.scene.getEngine && H.world.scene.getEngine();
      if (!eng || eng instanceof B().NullEngine) return false;
      const gl = eng._gl || (eng.getRenderingCanvas && eng.getRenderingCanvas() && eng.getRenderingCanvas().getContext('webgl2'));
      return Boolean(gl && gl.readPixels);
    } catch { return false; }
  }

  function readFrame(H, w, h) {
    const eng = H.world.scene.getEngine();
    const gl = eng._gl || eng.getRenderingCanvas().getContext('webgl2') || eng.getRenderingCanvas().getContext('webgl');
    const buf = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    return buf;
  }

  function hangarSpot(H) {
    try {
      const O = H.overseer, d = O && O.near;
      if (!d || !d.f || !d.c) return null;
      // Hangar pad centre in world: the bay's local (0, floor+0.1, padZ) turned by yaw around the ship middle.
      const yaw = d.f.yaw || 0, cos = Math.cos(yaw), sin = Math.sin(yaw);
      const lx = 0, ly = d.f.floor + 0.15, lz = d.f.padZ;
      const wx = d.c[0] + lx * cos + lz * sin, wy = d.c[1] + ly, wz = d.c[2] - lx * sin + lz * cos;
      return { id: 'hangar-floor', at: [wx, wy + 8, wz + 12], look: [wx, wy, wz] };
    } catch { return null; }
  }

  function resolveSpots(H, list) {
    const out = [];
    for (const s of list) {
      if (s.id === 'hangar-floor' && (!s.at || !s.look)) {
        const h = hangarSpot(H);
        if (h) out.push(h);
        continue;
      }
      if (s.at && s.look) out.push(s);
    }
    return out;
  }

  /** Freeze motion so only real z-fighting (A→B→A across three frames) counts, not water / particles / idle anim. */
  function freezeScene(W) {
    const scene = W.scene;
    const was = { anim: scene.animationsEnabled, particles: [], timeScale: null, controls: undefined };
    scene.animationsEnabled = false;
    for (const ps of scene.particleSystems || []) { was.particles.push([ps, ps.isStarted && ps.isStarted()]); try { ps.stop(); } catch { /* fine */ } }
    if (W.player) { was.controls = W.player.controls; W.player.controls = false; }
    const hp = typeof window !== 'undefined' ? window.HawkesPlay : null;
    if (hp && typeof hp.timeScale === 'number') { was.timeScale = hp.timeScale; hp.timeScale = 0; }
    return () => {
      scene.animationsEnabled = was.anim;
      for (const [ps, on] of was.particles) { try { if (on) ps.start(); } catch { /* fine */ } }
      if (W.player && was.controls !== undefined) W.player.controls = was.controls;
      if (was.timeScale !== null && hp) hp.timeScale = was.timeScale;
    };
  }

  /** Three-frame flicker: a pixel that returns to frame-1 after flipping in frame-2 is classic z-fighting. */
  function flickerAudit(H, W, o, problems, counts) {
    if (!canReadPixels(H)) { counts.flickerSkipped = 'no webgl readPixels'; return; }
    const babylonCam = W.scene.activeCamera;
    if (!babylonCam) { counts.flickerSkipped = 'no camera'; return; }
    const spots = resolveSpots(H, Array.isArray(o.flickerSpots) && o.flickerSpots.length ? o.flickerSpots : FLICKER_SPOTS);
    const canvas = W.scene.getEngine().getRenderingCanvas();
    const w = Math.min(160, canvas.width || 160), h = Math.min(90, canvas.height || 90);
    const saved = { pos: babylonCam.position.clone(), rot: babylonCam.rotation && babylonCam.rotation.clone() };
    let pixels = 0, checked = 0;
    const unfreeze = freezeScene(W);
    try {
      for (const s of spots) {
        const [x, y, z] = s.at, [lx, ly, lz] = s.look;
        babylonCam.position.set(x, y, z);
        if (babylonCam.setTarget) babylonCam.setTarget(new (B().Vector3)(lx, ly, lz));
        W.scene.render();
        const a = readFrame(H, w, h);
        W.scene.render();
        const b = readFrame(H, w, h);
        W.scene.render();
        const c = readFrame(H, w, h);
        let diff = 0;
        for (let i = 0; i < a.length; i += 4) {
          const dAB = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
          const dBC = Math.abs(b[i] - c[i]) + Math.abs(b[i + 1] - c[i + 1]) + Math.abs(b[i + 2] - c[i + 2]);
          const dAC = Math.abs(a[i] - c[i]) + Math.abs(a[i + 1] - c[i + 1]) + Math.abs(a[i + 2] - c[i + 2]);
          // Oscillates: A≠B, B≠C, A≈C — coplanar faces swapping which wins depth.
          if (dAB > 24 && dBC > 24 && dAC <= 12) diff++;
        }
        checked++;
        if (diff > 0) {
          pixels += diff;
          problems.push({ rule: 2, kind: 'flicker', id: s.id, detail: `${diff} pixels flickered (A-B-A) at ${s.id}` });
        }
      }
    } finally {
      babylonCam.position.copyFrom(saved.pos);
      if (saved.rot && babylonCam.rotation) babylonCam.rotation.copyFrom(saved.rot);
      unfreeze();
    }
    counts.flickerSpots = checked;
    counts.flickerPixels = pixels;
  }

  /** Eight angles around a centre: any closed mesh whose facing triangles wind inward from that view is inside-out. */
  function backfaceAudit(H, W, o, problems, counts) {
    const cam = W.scene.activeCamera;
    if (!cam) { counts.backfaceSkipped = 'no camera'; return; }
    const centre = o.backfaceAt || (W.player ? [W.player.x, W.player.y + 1.5, W.player.z] : [0, 6, 0]);
    const R = Number(o.backfaceRadius) || 18;
    const angles = 8;
    let checked = 0, bad = 0;
    const saved = cam.position.clone();
    const was = W.player && W.player.controls;
    if (W.player) W.player.controls = false;
    const seen = new Set();
    try {
      for (let i = 0; i < angles; i++) {
        const a = (i / angles) * Math.PI * 2;
        const px = centre[0] + Math.cos(a) * R, pz = centre[2] + Math.sin(a) * R, py = centre[1] + 4;
        cam.position.set(px, py, pz);
        if (cam.setTarget) cam.setTarget(new (B().Vector3)(centre[0], centre[1], centre[2]));
        W.scene.render();
        const view = [centre[0] - px, centre[1] - py, centre[2] - pz];
        for (const mesh of W.scene.meshes) {
          if (!drawn(mesh) || !mesh.material || mesh.material.backFaceCulling === false || mesh.sideOrientation === B().Mesh.DOUBLESIDE) continue;
          const bb = mesh.getBoundingInfo().boundingBox, ext = bb.extendSizeWorld;
          if (Math.min(ext.x, ext.y, ext.z) < 0.02) continue;
          const own = owner(mesh);
          const id = (own && own.sceneId) || mesh.name;
          const key = id + ':' + i;
          if (seen.has(key)) continue;
          const share = closed(mesh) ? inwardShare(mesh) : 0;
          const flipped = normalsAgainstWinding(mesh);
          // From this angle: if the mesh is mostly inward and the camera is outside its bounds, the player would see the inside.
          const outside = !bb.intersectsPoint(cam.position);
          if (outside && (share > 0.6 || flipped > 0.6)) {
            seen.add(key);
            bad++;
            problems.push({ rule: 3, kind: 'inside-out', id, detail: `back faces visible from angle ${i + 1}/8 (${Math.round(Math.max(share, flipped) * 100)}%)` });
          }
          checked++;
        }
      }
    } finally {
      cam.position.copyFrom(saved);
      if (W.player) W.player.controls = was;
    }
    counts.backfaceAngles = angles;
    counts.backfaceChecked = checked;
    counts.backfaceBad = bad;
  }

  function audit(H, o = {}) {
    const W = H.world;
    if (!W || !W.scene) return { problems: [{ rule: 0, kind: 'no-world', id: '', detail: 'no world is running' }], counts: {} };
    // Strict (playtest): 5 cm float rule from finish-math. Offline Node tests keep the older 15 cm default unless asked.
    const finish = FINISH();
    const strictTol = finish ? finish.FLOAT_M : 0.05;
    const opt = {
      groundTolerance: o.strict ? strictTol : (o.groundTolerance ?? 0.15),
      sinkTolerance: 0.6, near: 300, airborne: 4, skip: [], flicker: false, backfaces: false, ...o,
    };
    if (o.strict) opt.groundTolerance = strictTol;
    const problems = [], counts = {};
    calibrate(W.scene);
    // Settle once before measuring when asked (playtest), so the audit sees what the player sees after finish.js runs.
    // Offline detection tests leave a floating crate on purpose: they must not settle.
    if (H.finish && H.finish.settle && o.settle === true) try { H.finish.settle(); } catch { /* fine */ }
    groundAudit(H, W, opt, problems, counts);
    textAudit(W, problems, counts);
    coplanarAudit(H, W, opt, problems, counts);
    normalsAudit(W, problems, counts);
    assetAudit(H, W, opt, problems, counts);
    if (opt.flicker) flickerAudit(H, W, opt, problems, counts);
    if (opt.backfaces) backfaceAudit(H, W, opt, problems, counts);
    if (opt.contactShadows) {
      const on = H.finish && H.finish.contactShadows && H.finish.contactShadows();
      counts.contactShadows = on ? 1 : 0;
      if (H.finish && H.finish.phone && H.finish.phone() && !on) {
        problems.push({ rule: 4, kind: 'contact-shadow', id: 'phone', detail: 'phone tier is on but no contact shadows were drawn under props' });
      }
    }
    return { problems, counts };
  }

  window.HawkesWorldAudit = { audit, FLICKER_SPOTS };
})();
