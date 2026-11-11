// Finish: every placed thing sits on the ground with a true bounding-box bottom (quality rule 4), small props tilt to
// the slope (≤15°), large rocks and buildings sink a few cm, phone tiers get a cheap blob contact shadow under props
// and characters (cascaded shadows are coarse there), and imported models whose faces wind inward are flipped so
// backface culling never shows the inside. Numbers live in finish-math.js so the world audit and the playtest share them.
/* global HawkesPlay, BABYLON, HawkesFinishMath */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = BABYLON;
  const M = window.HawkesFinishMath;
  if (!H || !B || !M) return;

  const SKIP_KINDS = new Set(['terrain', 'water', 'zone', 'spawn', 'waypoint', 'trigger', 'light', 'text', 'sound', 'music', 'path', 'camera']);
  const SKIP_TAGS = new Set(['sky', 'overseer', 'race-gate']);
  // Built surfaces that are meant to sit where the scene put them (pier deck, pads): not snapped to the dirt under them.
  const SKIP_IDS = new Set(['pier', 'helipad', 'helipad_h', 'launch_pad', 'dock', 'start', 'mirror']);

  let world = null;
  const blobs = new Map(); // entity -> { mesh, mat }
  let blobMat = null;
  let blobTex = null;
  let settleTimer = 0;
  let settledOnce = false;

  function phoneTier() {
    const d = H.device;
    if (d && d.tier === 'phone') return true;
    if (H.touchUi) return true;
    const b = H.budget;
    return Boolean(b && b.shadows <= 40 && b.shadowDistance && b.shadowDistance <= 50);
  }

  function assetOf(e) {
    const sh = (e.spec && e.spec.shape) || {};
    return sh.asset || sh.model || (e.data && (e.data.asset || e.data.model)) || null;
  }

  /** Things the finish pass may move: static (and parked) world props, not the player, not beams, not the sea. */
  function eligible(e) {
    if (!e || !e.alive || !e.node || e.temporary || e.keep) return false;
    if (e.isTerrain || e.isPlayer || e === (H.world && H.world.player)) return false;
    if (SKIP_KINDS.has(e.kind)) return false;
    if (e.tag && SKIP_TAGS.has(e.tag)) return false;
    if (e.sceneId && SKIP_IDS.has(e.sceneId)) return false;
    // Pier posts are sized into the seabed on purpose; do not lift them to the dirt height under the deck.
    if (e.sceneId && /^post_\d/.test(e.sceneId)) return false;
    if (e.kind === 'tool-pickup') return false;
    if (e.spec && e.spec.data && (e.spec.data.flies || e.spec.data.air || e.spec.data.hangs || e.spec.data.finish === false)) return false;
    if (e.data && e.data.finish === false) return false;
    // Floating water toys stay where they are (the water module owns them).
    if (e.data && e.data.density != null && Number(e.data.density) < 1) return false;
    if (e.physics === 'none' || e.physics === 'trigger') return false;
    // Dynamic props (barrels, crates) still get one settle at load so they don't spawn in the air.
    if (e.physics !== 'static' && e.physics !== 'kinematic' && e.physics !== 'dynamic') return false;
    // Vehicles: only while empty and not moving (parked).
    if (e.kind === 'truck' || e.kind === 'car' || e.kind === 'boat' || e.kind === 'helicopter' || e.kind === 'rocket' || e.kind === 'plane') {
      if (e._seatedAt || (e.vx * e.vx + e.vz * e.vz) > 0.05) return false;
      if (e.kind === 'boat') return false; // the sea holds it
    }
    // Friends / creatures walk themselves; leave them alone after the first settle.
    if (e.kind === 'friend' || e.kind === 'creature' || e.kind === 'herd' || e.kind === 'person') return false;
    return true;
  }

  function groundUnder(x, z) {
    const T = H.terrain;
    if (!T || !T.heightAt) return null;
    const y = T.heightAt(x, z);
    return Number.isFinite(y) ? y : null;
  }

  function normalUnder(x, z) {
    const T = H.terrain;
    if (!T || !T.normalAt) return [0, 1, 0];
    const n = T.normalAt(x, z);
    return n && Number.isFinite(n[0]) ? n : [0, 1, 0];
  }

  /** Snap one entity's drawn bottom to the terrain (and tilt / sink by the math table). */
  function settleOne(e) {
    if (!eligible(e)) return false;
    if (e.kind === 'model' && !e._loaded) return false;
    e.measure();
    const g = groundUnder(e.x + (e.offset[0] || 0), e.z + (e.offset[2] || 0));
    if (g == null) return false;
    // Standing on another thing (a desk, a pier plank under a lantern): leave it.
    const bottom = e.bottom;
    for (const o of world.entities) {
      if (o === e || !o.alive || o.physics === 'none' || o.physics === 'dynamic') continue;
      if (!eligible(o) && o.kind !== 'box' && o.kind !== 'cylinder' && o.kind !== 'model') continue;
      const ob = o.box ? o.box(0.05) : null;
      if (!ob) continue;
      if (ob.max[1] >= bottom - 0.12 && ob.min[1] < bottom - 0.02
        && ob.min[0] < e.x + e.half[0] && ob.max[0] > e.x - e.half[0]
        && ob.min[2] < e.z + e.half[2] && ob.max[2] > e.z - e.half[2]
        && Math.abs(ob.max[1] - g) > 0.25) {
        // Held up by a built surface well above the dirt (pier, pad, desk).
        return false;
      }
    }
    const info = M.sinkOf(e.half, assetOf(e));
    const ny = M.targetY(g, bottom, e.y, info);
    if (Math.abs(ny - e.y) > 0.0005) e.y = ny;
    if (info.tilt) {
      const n = normalUnder(e.x, e.z);
      const t = M.tiltDegrees(n[0], n[1], n[2], M.TILT_MAX_DEG);
      const yaw = e.rotation3[1];
      e.node.rotation.x = t.pitch * Math.PI / 180;
      e.node.rotation.z = t.roll * Math.PI / 180;
      e.node.rotation.y = yaw * Math.PI / 180;
      e.measure();
      // Re-snap after tilt (the bottom moves).
      const g2 = groundUnder(e.x + (e.offset[0] || 0), e.z + (e.offset[2] || 0));
      if (g2 != null) {
        const info2 = M.sinkOf(e.half, assetOf(e));
        e.y = M.targetY(g2, e.bottom, e.y, info2);
      }
    }
    e.wake();
    e._finished = true;
    return true;
  }

  function settleAll() {
    if (!world) return { n: 0 };
    let n = 0;
    for (const e of world.entities) {
      try { if (settleOne(e)) n++; } catch (err) { if (H.report) H.report(err, 'finish'); }
    }
    settledOnce = true;
    refreshBlobs(true);
    return { n };
  }

  // ------------------------------------------------------------------ contact / blob shadows (phone)
  function ensureBlobMat() {
    if (blobMat && !blobMat.isDisposed()) return blobMat;
    const sc = world.scene;
    if (!blobTex || blobTex.isDisposed()) {
      blobTex = new B.DynamicTexture('finish-blob', 64, sc, false);
      const ctx = blobTex.getContext();
      const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
      g.addColorStop(0, 'rgba(0,0,0,0.55)');
      g.addColorStop(0.55, 'rgba(0,0,0,0.22)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.clearRect(0, 0, 64, 64);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 64, 64);
      blobTex.update();
      blobTex.hasAlpha = true;
    }
    blobMat = new B.StandardMaterial('finish-blob', sc);
    blobMat.diffuseTexture = blobTex;
    blobMat.opacityTexture = blobTex;
    blobMat.diffuseColor = new B.Color3(0, 0, 0);
    blobMat.emissiveColor = new B.Color3(0, 0, 0);
    blobMat.specularColor = new B.Color3(0, 0, 0);
    blobMat.backFaceCulling = false;
    blobMat.disableLighting = true;
    blobMat.alpha = 0.85;
    blobMat.transparencyMode = B.Material.MATERIAL_ALPHABLEND;
    blobMat.zOffset = -2;
    return blobMat;
  }

  function wantsBlob(e) {
    if (!phoneTier() || !world) return false;
    if (!e || !e.alive || !e.node) return false;
    if (e.isTerrain || SKIP_KINDS.has(e.kind)) return false;
    if (e.kind === 'text' || e.kind === 'light' || e.kind === 'zone') return false;
    if (e.tag === 'sky' || e.tag === 'overseer') return false;
    if (e.physics === 'none' || e.physics === 'trigger') return false;
    // Characters, props, parked vehicles.
    return true;
  }

  function placeBlob(e) {
    if (!wantsBlob(e)) { dropBlob(e); return; }
    const g = groundUnder(e.x, e.z);
    if (g == null) { dropBlob(e); return; }
    let row = blobs.get(e);
    if (!row || !row.mesh || row.mesh.isDisposed()) {
      const mesh = B.MeshBuilder.CreateGround('finish-blob', { width: 1, height: 1, subdivisions: 1 }, world.scene);
      mesh.material = ensureBlobMat();
      mesh.isPickable = false;
      mesh.receiveShadows = false;
      mesh.metadata = { decor: true, finishBlob: true };
      mesh.renderingGroupId = 0;
      row = { mesh };
      blobs.set(e, row);
    }
    const foot = Math.max(0.4, Math.max(e.half[0], e.half[2]) * 2.2);
    row.mesh.scaling.set(foot, 1, foot);
    row.mesh.position.set(e.x, g + 0.03, e.z);
    // Flatten to the slope a little so the blob hugs the ground.
    const n = normalUnder(e.x, e.z);
    const t = M.tiltDegrees(n[0], n[1], n[2], 25);
    row.mesh.rotation.x = t.pitch * Math.PI / 180;
    row.mesh.rotation.z = t.roll * Math.PI / 180;
    row.mesh.setEnabled(true);
  }

  function dropBlob(e) {
    const row = blobs.get(e);
    if (!row) return;
    try { row.mesh.dispose(); } catch { /* fine */ }
    blobs.delete(e);
  }

  function refreshBlobs(force) {
    if (!world) return;
    if (!phoneTier()) {
      for (const e of [...blobs.keys()]) dropBlob(e);
      return;
    }
    const cam = world.scene.activeCamera;
    const cx = cam ? cam.position.x : 0, cz = cam ? cam.position.z : 0;
    const near = (H.budget && H.budget.shadowDistance) || 45;
    for (const e of world.entities) {
      if (!wantsBlob(e)) { dropBlob(e); continue; }
      const d = Math.hypot(e.x - cx, e.z - cz);
      if (d > near) { dropBlob(e); continue; }
      if (force || e.isPlayer || e.kind === 'friend' || e.kind === 'person' || e.physics === 'dynamic' || !e._blobAt || Math.hypot(e.x - e._blobAt[0], e.z - e._blobAt[1]) > 0.15) {
        placeBlob(e);
        e._blobAt = [e.x, e.z];
      }
    }
  }

  // ------------------------------------------------------------------ normals on import
  /** Flip a mesh whose triangles mostly wind inward (closed shapes only). Keeps backface culling on. */
  function fixNormals(mesh) {
    if (!mesh || !mesh.getVerticesData || !mesh.getIndices) return false;
    if (mesh.metadata && mesh.metadata.decor) return false;
    const pos = mesh.getVerticesData(B.VertexBuffer.PositionKind);
    const idx = mesh.getIndices();
    if (!pos || !idx || idx.length < 12 || idx.length > 90000) return false;
    // Closed?
    const key = (i) => `${Math.round(pos[i * 3] * 1e3)},${Math.round(pos[i * 3 + 1] * 1e3)},${Math.round(pos[i * 3 + 2] * 1e3)}`;
    const edges = new Map();
    for (let i = 0; i < idx.length; i += 3) {
      for (const [a, b] of [[idx[i], idx[i + 1]], [idx[i + 1], idx[i + 2]], [idx[i + 2], idx[i]]]) {
        const A = key(a), B = key(b);
        if (A === B) continue;
        const k = A < B ? `${A}|${B}` : `${B}|${A}`;
        edges.set(k, (edges.get(k) || 0) + 1);
      }
    }
    let two = 0;
    for (const n of edges.values()) if (n === 2) two++;
    if (!edges.size || two / edges.size < 0.9) return false;
    // Inward share.
    let cx = 0, cy = 0, cz = 0, nv = pos.length / 3;
    for (let i = 0; i < pos.length; i += 3) { cx += pos[i]; cy += pos[i + 1]; cz += pos[i + 2]; }
    cx /= nv; cy /= nv; cz /= nv;
    let out = 0, inn = 0;
    const cross = (ax, ay, az, bx, by, bz) => [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
      const e1x = pos[b] - pos[a], e1y = pos[b + 1] - pos[a + 1], e1z = pos[b + 2] - pos[a + 2];
      const e2x = pos[c] - pos[a], e2y = pos[c + 1] - pos[a + 1], e2z = pos[c + 2] - pos[a + 2];
      const n = cross(e1x, e1y, e1z, e2x, e2y, e2z);
      const area = Math.hypot(n[0], n[1], n[2]);
      if (area < 1e-12) continue;
      const mx = (pos[a] + pos[b] + pos[c]) / 3 - cx;
      const my = (pos[a + 1] + pos[b + 1] + pos[c + 1]) / 3 - cy;
      const mz = (pos[a + 2] + pos[b + 2] + pos[c + 2]) / 3 - cz;
      if (n[0] * mx + n[1] * my + n[2] * mz > 0) out += area; else inn += area;
    }
    if (out + inn <= 0 || inn / (out + inn) < 0.6) {
      // Still force single-sided so a wrong DOUBLESIDE never shows the inside.
      if (mesh.material) mesh.material.backFaceCulling = true;
      return false;
    }
    // Flip winding.
    const flipped = new Uint32Array(idx.length);
    for (let i = 0; i < idx.length; i += 3) {
      flipped[i] = idx[i];
      flipped[i + 1] = idx[i + 2];
      flipped[i + 2] = idx[i + 1];
    }
    mesh.setIndices(flipped);
    try { mesh.createNormals(true); } catch { /* some meshes have no normals channel yet */ }
    if (mesh.material) mesh.material.backFaceCulling = true;
    mesh.sideOrientation = B.Mesh.FRONTSIDE;
    return true;
  }

  function fixEntityNormals(e) {
    if (!e || !e.node) return 0;
    let n = 0;
    const meshes = [e.node, ...(e.node.getChildMeshes ? e.node.getChildMeshes(false) : [])];
    for (const m of meshes) {
      if (!m.getTotalVertices || m.getTotalVertices() < 3) continue;
      if (m.metadata && m.metadata.decor) continue;
      try { if (fixNormals(m)) n++; } catch { /* keep going */ }
      if (m.material) m.material.backFaceCulling = true;
    }
    return n;
  }

  // ------------------------------------------------------------------ hooks
  function onLoaded(e) {
    if (!world || world !== H.world) return;
    fixEntityNormals(e);
    // Settle after the mesh has real bounds (a tick later so measure sees children).
    setTimeout(() => {
      if (!e.alive || H.world !== world) return;
      settleOne(e);
      if (phoneTier()) placeBlob(e);
    }, 0);
  }

  H.hooks.world.push({
    enter(W) {
      world = W;
      settledOnce = false;
      blobs.clear();
      blobMat = null;
      blobTex = null;
      settleTimer = 0.35; // wait a beat for terrain + first models
    },
    leave() {
      for (const e of [...blobs.keys()]) dropBlob(e);
      world = null;
      settledOnce = false;
      if (blobMat) { try { blobMat.dispose(); } catch { /* fine */ } }
      blobMat = null;
      blobTex = null;
    },
    loaded(e) { onLoaded(e); },
  });

  H.hooks.frame.push((dt) => {
    if (!world || world !== H.world) return;
    if (settleTimer > 0) {
      settleTimer -= dt;
      if (settleTimer <= 0) settleAll();
    } else if (!settledOnce) {
      settleAll();
    }
    // Keep character / dynamic blobs under feet.
    if (phoneTier() && (world._finishBlobAcc = (world._finishBlobAcc || 0) + dt) > 0.12) {
      world._finishBlobAcc = 0;
      refreshBlobs(false);
    }
  });

  H.hooks.game.push((game) => {
    const api = {
      settle: settleAll,
      settleOne,
      phone: phoneTier,
      blobs: () => blobs.size,
      math: M,
      fixMesh: fixNormals,
      fixEntity: fixEntityNormals,
      /** Playtest / audit helper: whether contact shadows are drawn on this tier. */
      contactShadows() { return phoneTier() && blobs.size > 0; },
    };
    H.finish = api;
    game.finish = api;
  });
})();
