// Juice: ragdolls. Players and creatures go limp when they're blasted, hit hard by a vehicle or fall far: their body
// becomes 6-8 boxes on ball joints (Havok) fitted to the block avatar or the creature, thrown by what hit them, and
// after a moment they get back up where they landed. Your own rocket launches you (you aren't killed by it).
//   H.juice.ragdoll(entity, { velocity: [x, y, z], spin })   H.juice.ragdoll.end(entity)   H.juice.ragdoll.active
// Who simulates it: the thing's simulator (you for yourself, the host or owner for a creature) runs the real ragdoll and
// the thing follows its body, so its position reaches everyone through the usual sync; everyone else shows a ragdoll
// whose body is pulled to where the thing is. A budget (per device: 8, phones 3) goes to the nearest first.
/* global HawkesPlay, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = BABYLON;
  const M = H.juiceMath;
  const J = H.juice;
  const W = () => H.world;
  const G = () => H.game;
  const clamp = M.clamp;
  const havok = () => H.physics && H.physics.engine === 'havok';
  const online = () => Boolean(H.sync && H.sync.online);
  const mine = (e) => !H.sync || H.sync.mine(e);
  const camPos = () => { const w = W(); const c = w && w.scene && w.scene.activeCamera; return c ? c.globalPosition || c.position : null; };

  const MIN_T = 1.3;  // seconds limp at least
  const MAX_T = 5;    // and at most
  const rags = new Map(); // entity -> rag
  const queue = []; // { e, v, t }: going limp in the next steps (a few a step)
  const PER_STEP = 2;

  // ------------------------------------------------------------------ fitting a body to a thing
  function hexOf(mesh, fallback) {
    try { const m = mesh && mesh.material; const c = m && (m.diffuseColor || m.albedoColor); if (c) return c.toHexString(); } catch { /* fine */ }
    return fallback;
  }
  const findMesh = (root, re) => (root ? root.getChildMeshes(false).find((m) => re.test(m.name)) : null);
  /** The body's plan and colours: a creature's species, or the block avatar for players. */
  function fit(e) {
    const r = e.living;
    if (r && r.sp) {
      const sp = r.sp;
      const plan = sp.plan === 'human' ? 'human' : sp.plan === 'bird' ? 'bird' : sp.plan === 'quad' ? 'quad' : null;
      if (!plan) return null; // fish flop by themselves
      const c = sp.colors || {};
      const rig = r.rig || {};
      const torso = rig.torso && rig.torso.material ? rig.torso : null;
      const colors = { body: hexOf(torso, c.body || '#a07a50'), head: c.head || c.body || '#a07a50', legs: c.legs || c.body || '#7a5a3a', accent: c.accent || '#333333' };
      if (e._shapeColor) colors.body = e._shapeColor;
      const dims = plan === 'human' ? { height: (r.tall || 1.8), size: 1 } : { len: sp.len, h: sp.h, w: sp.w, legH: sp.legH, legW: sp.legW, head: sp.head, size: r.size || 1, wings: Boolean(sp.wings) };
      return { plan, dims, colors, material: /robot/.test(String(e.data && e.data.species)) ? 'metal' : 'flesh', mass: clamp(Number(sp.mass) * Math.pow(r.size || 1, 3) || 60, 3, 600) };
    }
    if (e.isPlayer || e.remotePlayer) {
      const look = e === (W() && W().player) && H.presence && H.presence.me ? H.presence.me.look : null;
      const base = e.data && e.data.color ? e.data.color : '#4a9eff';
      const torso = findMesh(e.node, /pr-torso/), head = findMesh(e.node, /pr-head/), leg = findMesh(e.node, /pr-legL/);
      const own = (() => { try { return e._mat && e._mat.diffuseColor ? e._mat.diffuseColor.toHexString() : null; } catch { return null; } })();
      const body = hexOf(torso, (look && look.body) || own || base);
      return { plan: 'human', dims: { height: 1.8, size: 1 }, colors: { body, head: hexOf(head, (look && look.head) || '#f1c27d'), legs: hexOf(leg, body), accent: (look && look.accent) || '#222222' }, material: 'flesh', mass: 70 };
    }
    return null;
  }

  // ------------------------------------------------------------------ making one
  const rotY = (v, yaw) => { const c = Math.cos(yaw), s = Math.sin(yaw); return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c]; };
  function canRagdoll(e) {
    if (!e || !e.alive || e._ragdoll || e.held || e.dead || e._vehRider || e._riding) return false;
    if (e.living && (e.living.ridden || e.living.statue || (e.living.sp && e.living.sp.swims))) return false;
    if (e.isPlayer && !e.remotePlayer && (e.controller && e.controller !== 'walk' && e.controller !== 'swim')) return false;
    return true;
  }
  /** Makes a thing go limp. o: { velocity (m/s, what it's thrown with), spin (0-3), mirror (follow the thing instead
   *  of simulating: someone else simulates it), quiet }. Returns the ragdoll or null (no physics engine, over the
   *  budget, turned off, or it can't). */
  function ragdoll(target, o = {}) {
    const g = G(), w = W();
    const e = typeof target === 'string' ? g && (g.entity(target) || g.find(target)) : target;
    const no = (why) => { J.ragdoll.why = why; return null; };
    if (!w || !g) return no('no world');
    if (!havok()) return no('no physics engine');
    if (!J.allowed('ragdolls') || H.mode === 'build') return no('turned off');
    if (!canRagdoll(e)) return no('not now (riding, held, in a vehicle)');
    const max = J.budget.ragdolls;
    if (max <= 0) return no('this juice level has none');
    // Over the budget: the farthest one gets up now if this one is nearer (you always get yours).
    if (rags.size >= max) {
      const c = camPos();
      const dist = (x) => (x.isPlayer && !x.remotePlayer ? -1 : c ? Math.hypot(x.x - c.x, x.y - c.y, x.z - c.z) : 0);
      let far = null;
      for (const x of rags.keys()) if (!far || dist(x) > dist(far)) far = x;
      if (!far || dist(far) <= dist(e)) return no('over the budget');
      end(far, true);
    }
    const f = fit(e);
    if (!f) return no('no body to fit');
    const plan = M.ragdollPlan(f.plan, f.dims);
    const yaw = e.node.rotation.y || 0;
    const feet = [e.x, e.bottom + 0.04, e.z];
    const authority = !o.mirror && (e === w.player || (!e.remotePlayer && mine(e)));
    const base = o.velocity ? o.velocity.slice(0, 3) : [e.vx || 0, e.vy || 0, e.vz || 0];
    const rag = { e, parts: new Map(), joints: [], t: 0, still: 0, authority, yaw, plan, fit: f, hidden: [], prev: {}, torsoAt: 0, rise: 0 };
    let vol = 0;
    for (const p of plan.parts) vol += p.size[0] * p.size[1] * p.size[2];
    for (const p of plan.parts) {
      const at = rotY(p.at, yaw);
      const part = g.box({
        x: feet[0] + at[0], y: feet[1] + at[1], z: feet[2] + at[2], size: p.size, color: f.colors[p.color] || f.colors.body,
        physics: 'dynamic', mass: Math.max(0.5, f.mass * (p.size[0] * p.size[1] * p.size[2]) / vol), name: 'Ragdoll', tag: 'ragdoll', grab: false, friction: 0.8,
      });
      part.node.rotation.y = yaw;
      part.temporary = true; part.keep = true;
      part.data.material = f.material; part.data.ragdoll = true;
      part._ragPart = { rag, name: p.name };
      part.layer = 'juice-ragdoll'; part.collidesWith = ['default'];
      if (part.node) part.node.isPickable = false;
      const jit = () => (Math.random() - 0.5) * 1.2;
      part.velocity = [base[0] + jit(), base[1] + jit() * 0.5, base[2] + jit()];
      rag.parts.set(p.name, { ent: part, plan: p });
    }
    const torso = rag.parts.get('torso');
    rag.torso = torso.ent;
    rag.torsoAt = torso.plan.at[1];
    const sp = clamp(Number(o.spin ?? 1), 0, 3) * clamp(Math.hypot(...base) / 8, 0.3, 2);
    torso.ent.angularVelocity = [(Math.random() - 0.5) * 400 * sp, (Math.random() - 0.5) * 200 * sp, (Math.random() - 0.5) * 400 * sp];
    for (const j of plan.joints) {
      const A = rag.parts.get(j.a), Bp = rag.parts.get(j.b);
      if (!A || !Bp) continue;
      const pa = [j.at[0] - A.plan.at[0], j.at[1] - A.plan.at[1], j.at[2] - A.plan.at[2]];
      const pb = [j.at[0] - Bp.plan.at[0], j.at[1] - Bp.plan.at[1], j.at[2] - Bp.plan.at[2]];
      try { const jt = H.physics.joint('ball', A.ent, Bp.ent, { pivotA: pa, pivotB: pb }); if (jt) rag.joints.push(jt); } catch (err) { H.report(err, 'juice ragdoll'); }
    }
    // The thing itself: hidden while its body flops; it stops being solid (its simulator moves it with the body).
    for (const m of [e.node, ...e.node.getChildMeshes(false)]) if (m.isVisible !== undefined && m.name !== 'text' && !/^pr-tag|tag$/.test(m.name)) { rag.hidden.push([m, m.isVisible]); m.isVisible = false; }
    // A tumble (Mayhem's, from the same blast) is taken over: it turned off standing upright to spin them, and only
    // it would have turned it back on. The ragdoll gets them up now, upright as they were.
    if (e._wasUpright !== undefined) { e.upright = e._wasUpright; e._wasUpright = undefined; }
    rag.prev = { ghost: e.ghost, gravity: e.gravity, controls: e.controls, upright: e._upright };
    e.ghost = true;
    if (authority) {
      e.velocity = [0, 0, 0];
      if (e === w.player) { e.controls = false; e.gravity = 0; }
    }
    e._ragdoll = rag;
    rag.tumble = { spin: [0, 0, 0], t: 0, rest: 0, ragdoll: true };
    e._tumble = rag.tumble; // (Living things: it lies there while this is set)
    rags.set(e, rag);
    J.ragdoll.made++;
    if (e === w.player) {
      J.feel.cameraOverride = chaseCamera;
      cam.pos = null;
      if (online()) try { g.net.send('juice:rd', { on: 1, v: base.map((x) => Math.round(x * 10) / 10) }); } catch { /* fine */ }
    }
    if (!o.quiet) try { g.emit('ragdoll', { entity: e, on: true }); } catch { /* fine */ }
    return rag;
  }

  /** Back on its feet (now, or `quick` without the getting-up). */
  function end(target, quick = false, moved = false) {
    const e = target && target.__entity ? target : null;
    const rag = e && rags.get(e);
    if (!rag) return false;
    rags.delete(e);
    const w = W(), g = G();
    const t = rag.torso;
    const tp = t && t.alive ? [t.x, t.y, t.z] : [e.x, e.y, e.z];
    for (const j of rag.joints) try { j.remove(); } catch { /* gone */ }
    for (const { ent } of rag.parts.values()) if (ent.alive) ent.destroy();
    for (const [m, v] of rag.hidden) try { if (!m.isDisposed || !m.isDisposed()) m.isVisible = v; } catch { /* gone */ }
    e._ragdoll = null;
    if (e._tumble === rag.tumble) e._tumble = null;
    e.ghost = rag.prev.ghost;
    if (rag.authority && e.alive) {
      if (!moved) {
        // Stand up where the body lies: on the ground under it.
        let y = tp[1] - rag.torsoAt + 0.02;
        try {
          const hit = H.physics.raycast([tp[0], tp[1] + 0.5, tp[2]], [0, -1, 0], 6, { ignore: [e] });
          if (hit && !(hit.entity && hit.entity._ragPart)) y = hit.point[1] + 0.03;
        } catch { /* fine */ }
        e.position = [tp[0], y + (e.half ? e.half[1] : 0.9) - (e.offset ? e.offset[1] : 0), tp[2]];
        e.velocity = [0, 0, 0];
      }
      if (e === w.player) e.controls = rag.prev.controls !== false;
      e.gravity = rag.prev.gravity ?? 1;
      e._upright = rag.prev.upright;
      if (e.living) e.upright = true; // (creatures and friends walk on their feet, whatever tipped them before)
      const r = e.node.rotation;
      if (!e.isPlayer) { if (!quick) rising.set(e, { t: 0, x: r.x, z: r.z }); else { r.x = 0; r.z = 0; } }
      if (e.wake) e.wake();
    }
    if (w && e === w.player) {
      cam.leaving = quick ? 0 : 0.45;
      if (!quick) J.feel.cameraOverride = chaseCamera; else J.feel.cameraOverride = null;
      if (online()) try { g.net.send('juice:rd', { on: 0 }); } catch { /* fine */ }
    }
    try { if (g) g.emit('ragdoll', { entity: e, on: false }); } catch { /* fine */ }
    return true;
  }

  // ------------------------------------------------------------------ every step: the thing follows its body (or the other way round)
  const rising = new Map(); // entity -> { t, x, z }: getting back up (turning upright)
  function runRags(dt) {
    const w = W();
    for (const [e, rag] of [...rags]) {
      const t = rag.torso;
      if (!e.alive || !t || !t.alive) { end(e, true); continue; }
      rag.t += dt;
      if (rag.authority) {
        // Moved by someone else (a script's teleport, a respawn): up at once, where it was put.
        if (rag.put && Math.hypot(e.x - rag.put[0], e.y - rag.put[1], e.z - rag.put[2]) > 1.5) { end(e, true, true); continue; }
        const ty = t.y - rag.torsoAt + (e.half ? e.half[1] : 0.9) - (e.offset ? e.offset[1] : 0);
        e.position = [t.x, ty, t.z];
        rag.put = [e.x, e.y, e.z];
        e.velocity = [0, 0, 0];
        if (!e.isPlayer) { const r = t.node.rotation; e.node.rotation.x = r.x; e.node.rotation.z = r.z; e.node.rotation.y = r.y; }
        e._tumble = rag.tumble;
      } else {
        // Someone else simulates it: pull the body to where it is (its synced place).
        const want = [e.x, e.bottom + rag.torsoAt, e.z];
        const k = 9;
        t.velocity = [clamp((want[0] - t.x) * k, -40, 40), clamp((want[1] - t.y) * k, -40, 40), clamp((want[2] - t.z) * k, -40, 40)];
      }
      const sp = Math.hypot(t.vx, t.vy, t.vz);
      if (sp < 0.9) rag.still += dt; else rag.still = 0;
      const fell = w && t.y < w.catchY + 2;
      if (fell) { end(e, true); if (e === w.player) H.respawn(); continue; }
      if ((rag.t > MIN_T && rag.still > 0.45) || rag.t > MAX_T) end(e);
    }
    for (const [e, s] of [...rising]) {
      if (!e.alive || e._ragdoll) { rising.delete(e); continue; }
      s.t += dt;
      const k = clamp(s.t / 0.35, 0, 1), ease = 1 - (1 - k) * (1 - k);
      e.node.rotation.x = s.x * (1 - ease); e.node.rotation.z = s.z * (1 - ease);
      if (k >= 1) { e.node.rotation.x = 0; e.node.rotation.z = 0; rising.delete(e); }
    }
  }

  // ------------------------------------------------------------------ your camera while you're limp: a chase that never goes through walls
  const cam = { pos: null, leaving: 0 };
  function chaseCamera(c, dt) {
    const w = W();
    const p = w && w.player;
    const rag = p && rags.get(p);
    if (!rag) {
      // Back up: ease from where the chase was into your eyes.
      if (cam.leaving > 0 && cam.pos) {
        cam.leaving = Math.max(0, cam.leaving - dt);
        const k = cam.leaving / 0.45;
        c.position.copyFrom(B.Vector3.Lerp(c.position, cam.pos, k * k));
        if (cam.leaving <= 0) { cam.pos = null; J.feel.cameraOverride = null; }
        return;
      }
      cam.pos = null; J.feel.cameraOverride = null;
      return;
    }
    const t = rag.torso;
    const target = new B.Vector3(t.x, t.y + 0.3, t.z);
    const yaw = w.camera.yaw || 0;
    const back = new B.Vector3(-Math.sin(yaw) * 0.85, 0.55, -Math.cos(yaw) * 0.85).normalize();
    let dist = 4.2;
    const hit = w.scene.pickWithRay(new B.Ray(target, back, dist), (m) => { const en = H.entityOf(m); return Boolean(en && en.solid && !en._ragPart && en !== p && !(m.metadata && m.metadata.decor)); });
    if (hit && hit.hit) dist = Math.max(0.7, hit.distance - 0.3);
    const want = target.add(back.scale(dist));
    if (!cam.pos) cam.pos = c.position.clone();
    cam.pos = B.Vector3.Lerp(cam.pos, want, Math.min(1, dt * 7));
    c.position.copyFrom(cam.pos);
    if (c.setTarget) c.setTarget(target);
  }

  // ------------------------------------------------------------------ what knocks things over
  // Blasts: everything close enough is thrown limp (the nearest first, within the budget).
  H.physics.on('explosion', (d) => {
    const w = W();
    if (!w || !havok() || !J.allowed('ragdolls') || H.mode === 'build') return;
    const at = d.position, R = Number(d.radius) || 4.5, F = Number(d.force ?? 14);
    if (F <= 0) return;
    const c = camPos();
    const cands = [];
    for (const e of w.entities) {
      if (!e.alive || !(e.living || e === w.player) || e._ragdoll) continue;
      if (e !== w.player && !d.authoritative && !mine(e)) continue; // (it's the simulator's to throw)
      const dist = Math.hypot(e.x - at[0], e.y - at[1], e.z - at[2]);
      if (dist > R * 1.1) continue;
      const v = M.blastVelocity(at, [e.x, e.y, e.z], R, F);
      if (!M.knocksDown(Math.hypot(...v), { threshold: e === w.player ? 5 : 4 })) continue;
      if (!canRagdoll(e)) continue;
      cands.push({ e, v, distance: e === w.player ? -1 : c ? Math.hypot(e.x - c.x, e.y - c.y, e.z - c.z) : dist });
    }
    const room = Math.max(0, J.budget.ragdolls - rags.size) || (cands.some((x) => x.e === w.player) ? 1 : 0);
    // Two now (you first, then the nearest), the rest over the next steps: a herd going limp at once is spread out.
    M.pickNearest(cands, room).forEach((x, i) => {
      const e = x.e;
      const v = [(e.vx || 0) + x.v[0], (e.vy || 0) + x.v[1] + 1.5, (e.vz || 0) + x.v[2]];
      if (i < PER_STEP) ragdoll(e, { velocity: v, spin: 1.4 });
      else queue.push({ e, v, t: 0 });
    });
    if (pendingSelf.length) settleSelf(d);
  });
  // Your own blast launches you; it doesn't kill you (config.juice.selfBlast: 'hurt' turns this off). Damage that would
  // finish you (from nobody, or from you) is held for a step: if an explosion of yours caused it, it leaves you at 1
  // health. Anything else is applied as it was, a step later.
  const pendingSelf = [];
  function settleSelf(d) {
    const p = W() && W().player;
    const yours = d.by !== 'world' && (!online() || d.by === (H.sync && H.sync.me) || d.by === undefined);
    for (const x of pendingSelf) if (yours && p && x.amount >= p.health) x.amount = Math.max(0, p.health - 1);
    flushSelf();
  }
  function flushSelf() {
    const list = pendingSelf.splice(0);
    for (const x of list) try { x.orig(x.target, x.amount, x.from); } catch (err) { H.report(err, 'juice'); }
  }
  H.hooks.game.push((g, w) => {
    const orig = g.damage;
    if (typeof orig !== 'function') return;
    g.damage = (target, amount = 10, from = null) => {
      const p = w.player;
      if (p && target === p && (from === null || from === p) && Number(amount) >= p.health && p.health > 1 && J.settings.selfBlast !== 'hurt' && J.on && havok() && H.mode !== 'build') {
        pendingSelf.push({ orig, target, amount: Number(amount), from });
        return true;
      }
      return orig(target, amount, from);
    };
  });

  // Vehicles hitting people and animals hard; and falls.
  const lastPos = new WeakMap();
  function runHits(dt) {
    const w = W();
    if (!w || !havok() || !J.allowed('ragdolls') || H.mode === 'build') return;
    const list = H.vehicles && H.vehicles.list ? H.vehicles.list() : [];
    for (const ve of list) {
      const v = ve.vehicle;
      if (!v || !ve.alive) continue;
      const vel = v.vel ? [v.vel.x, v.vel.y, v.vel.z] : [ve.vx, ve.vy, ve.vz];
      const sp = Math.hypot(vel[0], vel[2]);
      if (sp < 7) continue;
      const reach = Math.max(...(ve.half || [1, 1, 2])) + 0.9;
      for (const e of w.entities) {
        if (!e.alive || e._ragdoll || !(e.living || e === w.player) || e === ve || e._vehRider) continue;
        if (e !== w.player && !mine(e)) continue;
        const dx = e.x - ve.x, dz = e.z - ve.z;
        if (Math.abs(dx) > reach || Math.abs(dz) > reach || Math.abs(e.y - ve.y) > 2.5) continue;
        // In front of it, inside its box (turned with it).
        const yaw = ve.node.rotation.y || 0;
        const lx = dx * Math.cos(yaw) - dz * Math.sin(yaw), lz = dx * Math.sin(yaw) + dz * Math.cos(yaw);
        const h = ve.half || [1, 1, 2];
        if (Math.abs(lx) > h[0] + 0.5 || Math.abs(lz) > h[2] + 0.6) continue;
        if (!canRagdoll(e)) continue;
        const k = clamp(sp / 18, 0.4, 1.6);
        ragdoll(e, { velocity: [vel[0] * 1.15, 3 + sp * 0.35 * k, vel[2] * 1.15], spin: 1.8 });
      }
    }
    // Falls: landing hard (creatures; you: the 'land' feel event).
    for (const e of w.entities) {
      if (!e.living || !e.alive || e._ragdoll || !mine(e)) continue;
      const s = lastPos.get(e);
      if (s && !s.g && e.grounded && M.fallRagdolls(s.vy) && canRagdoll(e)) ragdoll(e, { velocity: [e.vx * 0.6, 0, e.vz * 0.6], spin: 0.7 }); // (no bounce off the ground)
      lastPos.set(e, { g: e.grounded, vy: e.vy });
    }
    // Other people's creatures thrown about (we don't simulate them): a ragdoll that follows them.
    for (const e of w.entities) {
      if (!e.living || !e.alive || e._ragdoll || mine(e) || !e.visible) continue;
      const s = lastPos.get(e);
      const p = [e.x, e.y, e.z];
      if (s && s.p && dt > 0) {
        const vy = (p[1] - s.p[1]) / dt, vh = Math.hypot(p[0] - s.p[0], p[2] - s.p[2]) / dt;
        const run = (e.living.sp && e.living.sp.run) || 6;
        if ((vy > 5 || vh > Math.max(run * 1.8, 12)) && vh < 80 && canRagdoll(e)) ragdoll(e, { mirror: true, velocity: [(p[0] - s.p[0]) / dt, vy, (p[2] - s.p[2]) / dt] });
      }
      lastPos.set(e, { p });
    }
  }
  J.feel.on('land', ({ speed, entity }) => {
    const w = W();
    if (w && w.time < 2) return; // (dropped in at the start: not a fall)
    if (entity && M.fallRagdolls(-speed) && canRagdoll(entity)) ragdoll(entity, { velocity: [(entity.vx || 0) * 0.6, 0, (entity.vz || 0) * 0.6], spin: 0.6 }); // (no bounce off the ground)
  });

  // Other players: they tell everyone when they go limp; their avatar shows it.
  H.hooks.world.push({
    enter() {
      const g = G();
      g.net.on('juice:rd', (d, from) => {
        if (!from || !H.hooks.net) return;
        const pl = H.hooks.net.players().find((x) => x.id === from.id);
        const av = pl && pl.entity;
        if (!av) return;
        if (d && d.on) ragdoll(av, { mirror: true, velocity: Array.isArray(d.v) ? d.v : [0, 4, 0], quiet: true });
        else end(av);
      });
    },
    leave() { rags.clear(); rising.clear(); queue.length = 0; pendingSelf.length = 0; cam.pos = null; cam.leaving = 0; J.feel.cameraOverride = null; },
  });

  function runQueue(dt) {
    for (let n = 0; n < PER_STEP && queue.length; n++) {
      const q = queue.shift();
      q.t += dt * (n + 1);
      // (Falling as it waited: a little gravity taken off the throw.)
      if (canRagdoll(q.e)) ragdoll(q.e, { velocity: [q.v[0], q.v[1] - 24 * q.t * 0.5, q.v[2]], spin: 1.4 });
    }
    for (const q of queue) q.t += dt;
  }
  H.physics.afterStep((dt) => {
    if (!W()) return;
    try { runQueue(dt); runRags(dt); runHits(dt); } catch (err) { H.report(err, 'juice ragdoll'); }
  });
  H.hooks.step.push(() => { if (pendingSelf.length) flushSelf(); });

  J.ragdoll = Object.defineProperties(ragdoll, Object.getOwnPropertyDescriptors({
    end,
    /** Is it limp right now? */
    is: (e) => Boolean(e && rags.has(e)),
    get active() { return [...rags.keys()]; },
    get count() { return rags.size; },
    made: 0,
    /** Why the last one didn't happen. */
    why: null,
    fit,
  }));
  // For scripts: game.ragdoll(thing, { velocity }) (game.juice.ragdoll too).
  H.hooks.game.push((g) => { if (!g.ragdoll) g.ragdoll = (t, o) => ragdoll(t, o || {}); });
})();
