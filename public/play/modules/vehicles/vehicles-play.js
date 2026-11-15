// Vehicles, part 3: the player in a vehicle. E (B on a phone) gets in and out, the 'drive' controller reads the keys,
// the chase and cockpit cameras, the speedometer, touch buttons, engine and horn sounds (by asset name, or made up
// on the spot when the game has none), seats for friends, and the scripts' side (game.vehicles, 'enter'/'exit').
/* global HawkesPlay, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = BABYLON;
  const V = H.vehicles;
  const X = V._;
  const W = () => H.world;
  const G = () => H.game;
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const REACH = 2.4;

  // The local player's ride: { v, seat, cam: 'chase' | 'far' | 'cockpit', look: {...}, saved, hud... } or null.
  let local = null;
  // When the player last got in or out, on that world's clock (a world that starts again, a hot reload of a script,
  // starts its clock at 0: an old time from the last world must never block E for minutes).
  let lastSwitch = { w: null, t: -1 };
  const settled = () => lastSwitch.w !== W() || W().time - lastSwitch.t > 0.25;

  // ------------------------------------------------------------------ seats (taken in the room's one order)
  const byKey = (k) => V.list().find((e) => e.vehicle.key === k) || null;
  function ensureNet() {
    const w = W(), g = G();
    if (!w || !g || w.__vehNet) return;
    w.__vehNet = true;
    g.net.on('veh', (d) => onSeat(d));
    g.net.on('leave', (d) => { for (const e of V.list()) for (const s of e.vehicle.seats) if (s.who && d && s.who === d.id) { s.who = null; emit(e, 'exit', { id: d.id }, s.i); } });
  }
  const asked = new Map(); // request -> its fallback timer
  function send(d) {
    ensureNet();
    if (!(H.sync && H.sync.online)) { onSeat(d); return; }
    G().net.everyone('veh', d);
    const k = `${d.op}|${d.k}|${d.who}`;
    clearTimeout(asked.get(k));
    asked.set(k, setTimeout(() => { asked.delete(k); onSeat(d); }, 900));
  }
  function onSeat(d) {
    if (!d || !d.k) return;
    { const k = `${d.op}|${d.k}|${d.who}`; if (asked.has(k)) { clearTimeout(asked.get(k)); asked.delete(k); } }
    const e = byKey(d.k);
    if (!e) return;
    const v = e.vehicle;
    v.seatEvents = true;
    if (d.op === 'sit') {
      if (v.wrecked) { if (V.isMe(d.who)) G().ui.message('It\'s a wreck', 1.2); return; }
      freeStale(v, d.who);
      const already = v.seats.find((s) => s.who === d.who);
      let idx = -1;
      if (typeof d.seat === 'number' && v.seats[d.seat] && (!v.seats[d.seat].who || v.seats[d.seat].who === d.who)) idx = d.seat;
      else if (d.want !== 'passenger' && !v.seats[0].who) idx = 0;
      else idx = v.seats.findIndex((s) => !s.who);
      if (idx < 0) { if (V.isMe(d.who)) G().ui.message('No seats left', 1.2); return; }
      // Out of any seat they had (here or in another vehicle).
      for (const o of V.list()) for (const s of o.vehicle.seats) if (s.who === d.who && !(o === e && s.i === idx)) s.who = null;
      v.seats[idx].who = d.who;
      X.wake(v);
      if (V.isMe(d.who)) enterLocal(v, idx, Boolean(already));
      emit(e, 'enter', { id: d.who }, idx);
    } else if (d.op === 'stand') {
      const s = v.seats.find((x) => x.who === d.who);
      if (!s) return;
      s.who = null;
      if (s.i === 0) v.input = { ...X.ZERO_INPUT };
      X.wake(v);
      if (V.isMe(d.who) && local && local.v === v) leaveLocal(d.pop);
      emit(e, 'exit', { id: d.who }, s.i);
    }
  }
  /** Seats held by players who are gone (a dropped connection, my own id before a reconnect) are free again. */
  function freeStale(v, asker) {
    const online = H.sync && H.sync.online;
    const here = new Set(online ? (G().net.players || []).map((p) => p.id) : []);
    for (const s of v.seats) {
      if (!s.who || s.who === 'npc') continue;
      if (V.isMe(s.who) && V.isMe(asker) && s.who !== asker) { s.who = asker; continue; } // (mine, under an old id)
      if (online && !V.isMe(s.who) && !here.has(s.who)) s.who = null;
    }
  }
  function emit(e, name, who, seat) {
    const g = G();
    if (!g) return;
    const person = who.entity || (V.isMe(who.id) ? g.player : (g.net.players.find((p) => p.id === who.id) || {}).entity || null);
    const data = { vehicle: e, player: person, id: who.id || null, seat, driver: seat === 0, me: V.isMe(who.id) };
    for (const h of (e.handlers && e.handlers[name]) || []) h(data);
    g.emit(name, data);
  }

  /** Gets the local player in (the driver's seat if it's free, else a passenger's; o.seat picks one). */
  function enter(e, o = {}) {
    const v = e && e.vehicle;
    const g = G();
    if (!v || !g || !e.alive) return false;
    if (e.physics === 'static' || e.physics === 'none') { g.ui.message('That one is parked for good', 1.2); return false; }
    ensureNet();
    send({ op: 'sit', k: v.key, who: V.myId(), seat: typeof o.seat === 'number' ? o.seat : undefined, want: o.passenger ? 'passenger' : 'driver' });
    return true;
  }
  /** Gets the local player out. */
  function exit(pop) {
    if (!local) return false;
    const v = local.v;
    const me = V.myId();
    if (H.sync && H.sync.online) { leaveLocal(pop); G().net.everyone('veh', { op: 'stand', k: v.key, who: me }); }
    else send({ op: 'stand', k: v.key, who: me, pop });
    return true;
  }

  // ------------------------------------------------------------------ in and out
  function enterLocal(v, seat, switching) {
    const g = G();
    const p = g && g.player;
    if (!p || !p.alive) return;
    if (local && local.v !== v) leaveLocal(false, true);
    const cam = W().scene.activeCamera;
    local = local && local.v === v ? { ...local, seat } : {
      v, seat, cam: 'chase', yaw: 0, pitch: 0, lookT: 9, camPos: null,
      saved: { physics: p.physics === 'trigger' ? 'dynamic' : p.physics, gravity: p.gravity, fov: cam ? cam.fov : 1 },
    };
    p._vehRider = true;
    p.held = true; // (its character controller rests while it sits)
    p.physics = 'trigger';
    // The driver simulates the vehicle (no lag at the wheel): they take it over from whoever had it.
    if (seat === 0 && H.sync && H.sync.online && v.e.sceneId && !H.sync.claim(v.e)) {
      const h = H.sync.holder(v.e), here = (g.net.players || []).some((x) => x.id === h);
      if (!here || V.isMe(h)) H.sync.claim(v.e, { force: true });
    }
    p.velocity = [0, 0, 0];
    p.flying = false;
    if (p.controller !== 'drive') p.control('drive', { vehicle: v.e, seat });
    lastSwitch = { w: W(), t: W().time };
    if (!switching) {
      startAudio();
      const D = v.def;
      const what = seat === 0 ? hintFor(D) : 'You\'re riding along. V camera, E gets out.';
      g.ui.message(seat === 0 ? `${D.title}: ${what}` : what, 3.2);
    }
    showHud(true);
  }
  /** The player out of the vehicle: beside a door (or wherever there's room), moving as it was. */
  function leaveLocal(pop, quiet) {
    if (!local) return;
    const { v, saved } = local;
    local = null;
    lastSwitch = { w: W(), t: W() ? W().time : 0 };
    const g = G();
    const p = g && W().player;
    if (g && W().player) W().player._seatHidden = false;
    showHud(false);
    const cam = W() && W().scene.activeCamera;
    if (cam) { cam.upVector = new B.Vector3(0, 1, 0); cam.fov = saved.fov || 1; }
    if (!p || !p.alive) return;
    p._vehRider = false;
    p.held = false;
    p.physics = saved.physics || 'dynamic';
    if (H.sync && H.sync.online && v.e.sceneId) H.sync.release(v.e);
    p.gravity = saved.gravity ?? 1;
    if (!quiet) {
      const at = exitSpot(v, p);
      p.position = at;
      const vel = v.vel;
      p.velocity = [vel.x * 0.5, Math.max(0, vel.y * 0.5) + (pop ? 9 : 2), vel.z * 0.5];
    }
    const n = v.e.node;
    W().camera.yaw = n.rotation.y;
    W().camera.pitch = 0.1;
    if (p.controller === 'drive') p.control('walk');
    p.view = p.view;
  }
  function exitSpot(v, p) {
    X.axes(v.pos ? v : Object.assign(v, { pos: v.e.node.position.clone() }));
    v.pos = v.e.node.position.clone();
    X.axes(v);
    const [w, h, l] = v.def.size;
    const tries = [[-(w / 2 + 0.9), 0, 0.3], [w / 2 + 0.9, 0, 0.3], [0, 0, -(l / 2 + 1)], [0, 0, l / 2 + 1], [0, h / 2 + 1.2, 0]];
    for (const t of tries) {
      const P = X.toWorld(v, t);
      const floor = X.cast(v, P.add(new B.Vector3(0, 1.5, 0)), new B.Vector3(0, -1, 0), 4);
      const y = floor ? floor.point.y + 0.95 : P.y;
      const box = H.physics.shapes.box([0.7, 1.7, 0.7]);
      const blocked = H.physics.overlap(box, [P.x, y + 0.05, P.z], { ignore: [p, v.e] }).some((o) => o.solid && o !== p && o !== v.e && !o._vehRider);
      if (!blocked) return [P.x, y, P.z];
    }
    const P = X.toWorld(v, [0, h / 2 + 1.5, 0]);
    return [P.x, P.y, P.z];
  }
  V._ejectAll = (v) => {
    if (local && local.v === v) exit(true);
    for (const s of v.seats) if (s.who === 'npc' && s.entity) unboard(s.entity);
  };
  // A vehicle rebuilt (a new look, an edit that remade it) is the same vehicle: whoever sat in it sits in the new one, in
  // the same seat, and the driver keeps driving. Gone for good (destroyed, wrecked away): the rider steps out.
  const reborn = new Map(); // key -> { seats: [who], mine: seat or -1, at: ms }
  V._onGone = (v) => {
    const mine = local && local.v === v ? local.seat : -1;
    // (It can be told twice for one rebuild: the second, after the rider stepped out, never forgets the first.)
    const had = v.key && reborn.get(v.key);
    if (v.key && !(had && had.mine >= 0 && mine < 0 && performance.now() - had.at < 1400)) reborn.set(v.key, { seats: v.seats.map((s) => s.who), mine, at: performance.now() });
    if (mine >= 0) leaveLocal(false, true);
    // (Not back within a moment: it really is gone, so step out where it was.)
    if (mine >= 0) setTimeout(() => { const r = reborn.get(v.key); if (r && r.mine >= 0) { reborn.delete(v.key); const p = W() && W().player; if (p && p.alive) { p.position = [v.e.x + 2, v.e.y + 1, v.e.z]; p.velocity = [0, 2, 0]; } } }, 1500);
  };
  V._onBorn = (v) => {
    const r = v.key && reborn.get(v.key);
    if (!r || performance.now() - r.at > 1400) return;
    reborn.delete(v.key);
    r.seats.forEach((who, i) => { if (who && v.seats[i] && !V.isMe(who)) v.seats[i].who = who; });
    if (r.mine >= 0 && v.seats[r.mine]) { v.seats[r.mine].who = V.myId(); enterLocal(v, r.mine, false); }
  };

  // ------------------------------------------------------------------ the controller
  H.controllers.register('drive', {
    title: 'In a vehicle: WASD drive, E gets out, V camera, H horn, L lights',
    speed: 6,
    tools: false,
    enter(p) { p.velocity = [0, 0, 0]; },
    idle(p) { if (local && local.seat === 0) local.v.input = { ...X.ZERO_INPUT }; p.velocity = [0, 0, 0]; p._walked = true; },
    update(p, dt, ctx) {
      p.velocity = [0, 0, 0];
      p._walked = true;
      if (!local || !local.v.e.alive) { local = null; showHud(false); p.physics = 'dynamic'; p._vehRider = false; p.control('walk'); return; }
      const v = local.v, input = ctx.game.input;
      const a = input.axis();
      const key = (k) => input.key(k);
      if (local.seat === 0) {
        v.input = { x: a.x, y: a.y, up: key('space'), down: key('c') || key('control'), boost: key('shift'), brake: key('space') };
        const honk = key('h');
        if (honk !== v.horn && !v.hornUntil) v.horn = honk;
        if (input.pressed('l')) X.setLights(v, !v.lights);
        if (input.pressed('r')) X.flipUpright(v);
        if (honk || v.cur && (v.cur.y || v.cur.x)) X.wake(v);
        // Still the one simulating it? (Someone bumping it can take it over: take it back.)
        if (H.sync && H.sync.online && v.e.sceneId && !H.sync.mine(v.e) && (local.claimT = (local.claimT || 0) + dt) > 0.5) { local.claimT = 0; H.sync.claim(v.e); }
      }
      if (input.pressed('v')) { local.cam = local.cam === 'chase' ? 'far' : local.cam === 'far' ? 'cockpit' : 'chase'; local.camPos = null; }
    },
    exit(p) {
      // Switched away by a script (game.player.control('walk')) while still seated: get out properly.
      if (local && p._vehRider) { const v = local.v; leaveLocal(false); if (H.sync && H.sync.online) G().net.everyone('veh', { op: 'stand', k: v.key, who: V.myId() }); else onSeat({ op: 'stand', k: v.key, who: V.myId() }); }
    },
  });

  // ------------------------------------------------------------------ walking up to one: the prompt, E to get in
  // All of getting in and out is this one offer: what E (or a tap on the hint) does for a player right here, or null.
  // It goes in the engine's use registry (H.use), which picks between it, a horse to ride, a friend to talk to...
  function useOffer(p) {
    const w = W();
    if (!w || H.mode !== 'play' || !p || !p.alive) return null;
    // The ride is over if the player is no longer driving (got out into the water, was moved by a script...): never
    // keep offering "Get out" for it.
    if (local && p === w.player && (p.controller !== 'drive' || !p._vehRider)) {
      const v = local.v;
      leaveLocal(false, true);
      const s = v.seats.find((x) => V.isMe(x.who));
      if (s) { s.who = null; if (s.i === 0) v.input = { ...X.ZERO_INPUT }; }
    }
    if (local) return { entity: local.v.e, label: `Get out of the ${local.v.def.title.toLowerCase()}`, key: 'e', priority: 100, act: () => { if (settled()) exit(false); } };
    if (!p.controls || p.controller !== 'walk' || p._view === 'rts') return null;
    const e = nearest(p, REACH);
    if (!e) return null;
    const v = e.vehicle;
    const verb = v.seats[0].who ? 'Ride in' : ['plane', 'heli', 'rocket', 'ship'].includes(v.def.class) ? 'Fly' : v.def.twoWheels ? 'Ride' : 'Drive';
    const d = Math.hypot(p.x - e.x, p.y - e.y, p.z - e.z) - Math.max(v.def.size[0], v.def.size[2]) / 2;
    return { entity: e, label: `${verb} the ${e.name && e.name !== v.def.title ? e.name : v.def.title.toLowerCase()}`, key: 'e', distance: Math.max(0, d), act: () => { if (settled()) enter(e); } };
  }
  let near = null;
  H.use.register('vehicles:enter', { near: (p) => useOffer(p) });
  H.hooks.step.push(() => {
    const w = W();
    const offer = w ? useOffer(w.player) : null;
    near = offer && !local ? offer.entity : null;
  });
  /** The closest vehicle with a free seat to a thing or a point ([x, y, z]), within reach (meters from its side). */
  function nearest(from, reach = REACH) {
    const f = Array.isArray(from) ? { x: +from[0] || 0, y: +from[1] || 0, z: +from[2] || 0 } : from;
    if (!f) return null;
    let best = null, bd = Infinity;
    for (const e of V.list()) {
      const v = e.vehicle;
      if (v.wrecked || e.physics === 'static' || e.physics === 'none' || !e.visible) continue;
      if (!v.seats.some((s) => !s.who)) continue;
      const d = Math.hypot(f.x - e.x, f.y - e.y, f.z - e.z) - Math.max(v.def.size[0], v.def.size[2]) / 2;
      if (d < reach && d < bd) { bd = d; best = e; }
    }
    return best;
  }

  // ------------------------------------------------------------------ riders sit where their seat is
  function seatWorld(v, s) {
    const n = v.e.node;
    n.computeWorldMatrix(true);
    return B.Vector3.TransformCoordinates(new B.Vector3(s.at[0], s.at[1], s.at[2]), n.getWorldMatrix());
  }
  function placeRiders() {
    const w = W();
    if (!w) return;
    if (local) {
      const p = w.player;
      if (p && p.alive && local.v.e.alive) {
        const at = seatWorld(local.v, local.v.seats[local.seat]);
        p.node.position.copyFrom(at);
        p.node.rotation.y = local.v.e.node.rotation.y;
        p.vx = p.vy = p.vz = 0;
        p.grounded = true;
      }
    }
    for (const e of V.list()) for (const s of e.vehicle.seats) {
      if (s.who !== 'npc' || !s.entity) continue;
      if (!s.entity.alive) { s.who = null; s.entity = null; continue; }
      s.entity.node.position.copyFrom(seatWorld(e.vehicle, s));
      s.entity.node.rotation.y = e.node.rotation.y;
      s.entity.vx = s.entity.vy = s.entity.vz = 0;
    }
  }
  H.physics.afterStep(placeRiders);

  /** Puts a non-player thing (an AI friend, an animal, a dummy) in a seat; it rides until unboard. seat: a number, or
   *  { driver: true } (the driver's seat if it's free, else a passenger's), or { seat }. */
  function board(e, who, seat) {
    const v = e && e.vehicle;
    if (!v || !who || !who.alive) return false;
    const o = seat && typeof seat === 'object' ? seat : { seat };
    let idx = typeof o.seat === 'number' ? o.seat : o.driver && !v.seats[0].who ? 0 : v.seats.findIndex((s, i) => !s.who && i > 0);
    if (idx < 0 && !o.driver) idx = v.seats.findIndex((s) => !s.who);
    if (idx < 0 || !v.seats[idx] || v.seats[idx].who) return false;
    unboard(who);
    v.seats[idx].who = 'npc';
    v.seats[idx].entity = who;
    who._vehRider = { v, seat: idx, physics: who.physics, visible: who.visible };
    who.physics = 'trigger';
    who._vehRider.held = who.held;
    who.held = true; // (a character controller rests while it sits)
    who.visible = v.seats[idx].show || who._vehRider.visible === false ? who._vehRider.visible : false;
    X.wake(v);
    emit(e, 'enter', { entity: who }, idx);
    return true;
  }
  function unboard(who) {
    const r = who && who._vehRider;
    if (!r || who === (W() && W().player)) return false;
    const v = r.v;
    const s = v.seats[r.seat];
    if (s && s.entity === who) { s.who = null; s.entity = null; if (r.seat === 0) v.autopilot = null; }
    who._vehRider = false;
    who.physics = r.physics || 'dynamic';
    who.held = Boolean(r.held);
    who.visible = r.visible !== false;
    const at = exitSpot(v, who);
    who.position = at;
    emit(v.e, 'exit', { entity: who }, r.seat);
    return true;
  }

  // ------------------------------------------------------------------ cameras: chase (near and far) and cockpit
  const tmp = new B.Vector3();
  function camera(dt) {
    const w = W();
    if (!local || !w) return;
    const v = local.v, e = v.e;
    if (!e.alive) return;
    const cam = w.scene.activeCamera;
    if (!cam || !cam.setTarget) return;
    const n = e.node;
    n.computeWorldMatrix(true);
    const M = n.getWorldMatrix();
    const fwd = B.Vector3.TransformNormal(B.Axis.Z, M).normalize();
    const upv = B.Vector3.TransformNormal(B.Axis.Y, M).normalize();
    const D = v.def;
    // Mouse (or a finger) looks around; let go and the view swings back behind.
    const m = H.input.mouse;
    if (m.dx || m.dy) { local.yaw += m.dx * 0.004; local.pitch = clamp(local.pitch + m.dy * 0.003, -0.5, 0.9); local.lookT = 0; }
    else local.lookT += dt;
    if (local.lookT > 1.4 && local.cam !== 'cockpit') { const k = Math.min(1, dt * 2.5); local.yaw -= local.yaw * k; local.pitch -= local.pitch * k; }
    const heading = Math.atan2(fwd.x, fwd.z);
    w.camera.yaw = heading;
    const flying = ['plane', 'heli', 'rocket', 'ship'].includes(D.class);
    const speed = v.vel.length();
    // How driving feels (vehicles-feel.js): the view widens with speed, trails, dips after a landing, swings into a drift.
    const F = V.feel ? V.feel.camera(v, speed, flying, v.boosting) : { fov: (v.boosting ? 0.14 : 0) + clamp(speed / 90, 0, 0.12), rate: flying ? 7 : 9, back: 0, dip: 0, yaw: 0 };
    cam.fov += ((local.saved.fov || 1) + F.fov - cam.fov) * Math.min(1, dt * 4);
    if (local.cam === 'cockpit') {
      const eye = B.Vector3.TransformCoordinates(new B.Vector3(D.eye[0], D.eye[1], D.eye[2]), M);
      const look = B.Quaternion.RotationAxis(upv, local.yaw).multiply(B.Quaternion.RotationAxis(B.Vector3.TransformNormal(B.Axis.X, M).normalize(), local.pitch));
      const dir = fwd.rotateByQuaternionToRef(look, tmp).clone();
      cam.position.copyFrom(eye);
      cam.upVector = flying ? upv.clone() : new B.Vector3(0, 1, 0);
      cam.setTarget(eye.add(dir.scale(10)));
      return;
    }
    cam.upVector = new B.Vector3(0, 1, 0);
    const far = local.cam === 'far' ? 1.7 : 1;
    const dist = (D.cam.distance + F.back) * far, height = D.cam.height * far;
    const basePitch = D.class === 'plane' ? clamp(Math.asin(clamp(-fwd.y, -1, 1)) * 0.7, -0.6, 0.6) + 0.14 : 0.2;
    const yaw = heading + local.yaw - F.yaw, pitch = basePitch + local.pitch;
    const target = n.position.add(new B.Vector3(0, D.size[1] * 0.4 + 0.4, 0));
    const back = new B.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    let want = target.add(back.scale(dist)).addInPlaceFromFloats(0, height * 0.45, 0);
    // Never through a wall: pulled in in front of whatever is between.
    const toCam = want.subtract(target);
    const len = toCam.length();
    if (len > 0.1) {
      const hit = w.scene.pickWithRay(new B.Ray(target, toCam.scale(1 / len), len), (mesh) => { const en = H.entityOf(mesh); return Boolean(en && en !== e && en.solid && !en._vehRider && !en.isPlayer && !(mesh.metadata && mesh.metadata.decor)); });
      if (hit && hit.hit) want = target.add(toCam.scale(Math.max(0.15, (hit.distance - 0.4) / len)));
    }
    if (!local.camPos || B.Vector3.Distance(local.camPos, want) > 60) local.camPos = want.clone();
    const k = 1 - Math.exp(-dt * F.rate);
    local.camPos = B.Vector3.Lerp(local.camPos, want, k);
    cam.position.copyFrom(local.camPos);
    cam.position.y += F.dip; // (the view is only dipped, the followed position is not)
    // A game's framing (H.cameraAim: the Overseer's bay ahead while a rocket climbs): the look swings toward a point, the
    // ship and the planet below staying in view because the camera itself stays behind and above.
    let look = target.add(fwd.scale(flying ? 6 : 2));
    const aim = H.cameraAim ? H.cameraAim(e) : null;
    local.aimK = (local.aimK || 0) + ((aim ? aim.k : 0) - (local.aimK || 0)) * Math.min(1, dt * 1.5);
    if (aim && local.aimK > 0.005) {
      const dir = new B.Vector3(aim.point[0], aim.point[1], aim.point[2]).subtract(target);
      if (dir.length() > 1) look = B.Vector3.Lerp(look, target.add(dir.normalize().scale(40)), local.aimK);
    }
    cam.setTarget(look);
  }

  // ------------------------------------------------------------------ each frame: camera, riders' look, avatars in seats
  H.hooks.frame.push((dt) => {
    const w = W(), g = G();
    if (!w || !g) return;
    try { camera(dt); } catch (err) { H.report(err, 'vehicles camera'); }
    const p = w.player;
    if (local && p && p.alive) {
      const s = local.v.seats[local.seat];
      const showMe = s.show && local.cam !== 'cockpit';
      // With the looks on, the figure is the body and the capsule stays hidden (presence.js); only the plain capsule is shown here.
      p._seatHidden = !showMe;
      p._seatedAt = w.time; // the person's body sits (presence.js)
      if (!p._rigged) p.node.visibility = showMe ? 1 : 0;
      if (p._visor) p._visor.setEnabled(showMe);
      placeRiders();
    }
    // Friends in seats: their avatars sit there (and hide inside closed cabins).
    if (H.sync && H.sync.online) {
      const players = g.net.players;
      for (const e of V.list()) for (const s of e.vehicle.seats) {
        if (!s.who || s.who === 'npc' || V.isMe(s.who)) continue;
        const pl = players.find((x) => x.id === s.who);
        const a = pl && pl.entity;
        if (!a || !a.alive) continue;
        a.node.position.copyFrom(seatWorld(e.vehicle, s));
        a.node.rotation.y = e.node.rotation.y;
        a.visible = Boolean(s.show);
        a._seatedAt = w.time;
      }
    }
    hud(dt);
    sounds(dt);
  });

  // ------------------------------------------------------------------ the screen: prompt, speedometer, touch buttons
  const CSS = `
#veh-prompt{position:absolute;left:50%;bottom:110px;transform:translateX(-50%);padding:9px 16px;border-radius:999px;background:rgba(10,14,24,.72);border:1px solid rgba(255,255,255,.22);color:#fff;font:600 15px/1.2 var(--ui-font,Rajdhani,Inter,system-ui,sans-serif);letter-spacing:.02em;pointer-events:auto;cursor:pointer;user-select:none;white-space:nowrap;backdrop-filter:blur(6px)}
#veh-prompt b{display:inline-grid;place-items:center;min-width:24px;height:24px;margin-right:8px;border-radius:6px;background:var(--ui-accent,#4a9eff);color:#06101e;font-weight:800}
#veh-hud{position:absolute;right:18px;bottom:18px;min-width:190px;padding:12px 16px 12px;border-radius:14px;background:rgba(8,12,22,.66);border:1px solid rgba(255,255,255,.14);color:#e9f1ff;font:500 13px/1.25 var(--ui-font,Rajdhani,Inter,system-ui,sans-serif);pointer-events:none;backdrop-filter:blur(6px)}
#veh-hud .spd{font:800 44px/1 Orbitron,var(--ui-font,system-ui),sans-serif;letter-spacing:.02em}
#veh-hud .unit{font-size:13px;opacity:.7;margin-left:6px}
#veh-hud .row{display:flex;align-items:center;gap:8px;margin-top:6px}
#veh-hud .row span{width:58px;opacity:.75;font-size:12px;text-transform:uppercase;letter-spacing:.06em}
#veh-hud .track{flex:1;height:7px;border-radius:4px;background:rgba(255,255,255,.14);overflow:hidden}
#veh-hud .fill{height:100%;border-radius:4px;background:var(--ui-accent,#4a9eff);transition:width .1s}
#veh-hud .info{margin-top:6px;font-size:13px;opacity:.9}
#veh-hud .warn{color:#ff5a4a;font-weight:800;letter-spacing:.12em;animation:vehblink .5s steps(2) infinite}
#veh-hud .hint{margin-top:8px;font-size:11.5px;opacity:.6;max-width:260px}
@keyframes vehblink{50%{opacity:.2}}
#veh-touch{position:fixed;right:max(18px,env(safe-area-inset-right));bottom:calc(max(30px,env(safe-area-inset-bottom)) + 150px);display:grid;grid-template-columns:repeat(2,58px);gap:10px;z-index:6}
#veh-touch button{width:58px;height:58px;border-radius:50%;border:1px solid rgba(255,255,255,.4);background:rgba(10,12,20,.55);color:#fff;font:20px/1 system-ui;display:grid;place-items:center;align-content:center;gap:1px;touch-action:none}
#veh-touch button span{font:600 9.5px/1 Rajdhani,Inter,system-ui,sans-serif}
body.veh-touching #veh-hud{bottom:auto;top:calc(max(14px,env(safe-area-inset-top)) + 54px);right:12px;min-width:150px;padding:8px 12px}
body.veh-touching #veh-hud .spd{font-size:30px}
body.veh-touching #veh-hud .hint{display:none}
`;
  function style() {
    if (document.getElementById('veh-style')) return;
    const el = document.createElement('style');
    el.id = 'veh-style';
    el.textContent = CSS;
    document.head.appendChild(el);
  }
  const layer = () => document.getElementById('ui') || document.body;
  let promptEl = null, promptFor = null;
  function prompt(offer) {
    const e = offer ? offer.entity : null;
    if (e === promptFor && (!offer || (promptEl && promptEl.__label === offer.label))) return;
    promptFor = e;
    if (!e) { if (promptEl) { promptEl.remove(); promptEl = null; } return; }
    style();
    if (!promptEl) {
      promptEl = document.createElement('div');
      promptEl.id = 'veh-prompt';
      promptEl.onclick = (ev) => { ev.stopPropagation(); if (promptFor) enter(promptFor); };
      layer().appendChild(promptEl);
    }
    promptEl.__label = offer.label;
    promptEl.innerHTML = `<b>${H.touchUi ? 'B' : 'E'}</b>${escape(offer.label)}`;
  }
  const escape = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  V.hintFor = (D) => hintFor(D);
  function hintFor(D) {
    const t = H.touchUi;
    if (D.class === 'plane') return t ? 'Stick: pitch and roll. ⤒ throttle up, ▼ down. Push up on the ground to roll, pull back at speed to lift off.' : 'Hold W to roll, S lifts off at speed. W/S pitch, A/D roll, space/C throttle, shift boost, E out.';
    if (D.class === 'heli') return t ? 'Stick: tilt and turn. ⤒ climbs, ▼ descends; it coasts down when you let go.' : 'Space climbs, C descends (let go and it sinks), W/S tilt, A/D turn, E out.';
    if (D.class === 'sub') return t ? '▼ dives, ⤒ rises, the stick drives.' : 'C dives, space rises, W/S thrust, A/D turn, L lights, E out.';
    if (D.class === 'rocket') return t ? '⤒ more thrust, ▼ less; the stick pitches and leans. Fuel fills on the ground.' : 'Space: more thrust, C: less. W/S pitch, A/D lean, shift boosts. Fuel fills on the ground. E out.';
    if (D.class === 'ship') return t ? '⤒ climbs, ▼ descends (it hovers); the stick flies and turns.' : 'Space climbs, C descends (it hovers), W/S thrust, A/D turn, shift boost, E out.';
    if (D.class === 'boat') return t ? 'The stick drives, ⚡ boosts.' : 'W/S throttle, A/D steer, shift boost, H horn, E out.';
    if (D.hop) return t ? 'The stick pedals and steers, ⤒ hops.' : 'W pedals, A/D steer, space hops, shift sprints, E off.';
    return t ? 'The stick drives, ⤒ handbrake (drift), ⚡ boost, B gets out.' : 'W/S drive, A/D steer, space drifts, shift boosts, H horn, L lights, V camera, R flips, E out.';
  }

  let hudEl = null, touchEl = null, hudT = 0;
  function showHud(on) {
    if (!on) {
      if (hudEl) { hudEl.remove(); hudEl = null; }
      if (touchEl) { touchEl.remove(); touchEl = null; }
      document.body.classList.remove('veh-touching');
      return;
    }
    style();
    if (!hudEl) {
      hudEl = document.createElement('div');
      hudEl.id = 'veh-hud';
      layer().appendChild(hudEl);
    }
    if (H.touchUi && !touchEl) {
      touchEl = document.createElement('div');
      touchEl.id = 'veh-touch';
      const btn = (key, icon, label) => `<button type="button" data-key="${key}" aria-label="${label}">${icon}<span>${label}</span></button>`;
      const D = local && local.v.def;
      const flyer = D && ['plane', 'heli', 'sub', 'rocket', 'ship'].includes(D.class);
      touchEl.innerHTML = btn('shift', '⚡', 'Boost') + (flyer ? btn('c', '▼', 'Down') : btn('h', '📯', 'Horn')) + btn('v', '🎥', 'View') + btn('l', '💡', 'Lights') + btn('r', '↺', 'Flip');
      document.body.appendChild(touchEl);
      for (const b of touchEl.querySelectorAll('button')) H.bindTouchKey(b, b.dataset.key);
      document.body.classList.add('veh-touching');
    }
    hudT = 1;
  }
  function hud(dt) {
    if (!local || !hudEl) return;
    hudT += dt;
    if (hudT < 1 / 12) return;
    hudT = 0;
    const v = local.v, D = v.def;
    const kmh = Math.round(v.vel.length() * 3.6);
    const bar = (label, x, color) => `<div class="row"><span>${label}</span><div class="track"><div class="fill" style="width:${Math.round(clamp(x, 0, 1) * 100)}%${color ? `;background:${color}` : ''}"></div></div></div>`;
    let info = '';
    const ground = groundBelow(v);
    if (D.class === 'plane') info = `Altitude ${Math.round(ground)} m · throttle ${Math.round(v.throttle * 100)}%${v.stalled ? ' · <span class="warn">STALL</span>' : ''}`;
    else if (D.class === 'heli') info = `Altitude ${Math.round(ground)} m · ${v.vel.y > 0.3 ? '▲' : v.vel.y < -0.3 ? '▼' : '◆'} ${Math.abs(v.vel.y).toFixed(1)} m/s`;
    else if (D.class === 'sub') { const s = V.waterLevel(v.e.x, v.e.z); const depth = s === null ? 0 : Math.max(0, s - v.e.y); info = depth < 0.8 ? 'Surfaced' : `Depth ${depth.toFixed(1)} m`; }
    else if (D.class === 'rocket' || D.class === 'ship') info = `Altitude ${altText(v)} · ${v.vel.y > 0.5 ? '▲' : v.vel.y < -0.5 ? '▼' : '◆'} ${Math.abs(v.vel.y).toFixed(0)} m/s${v.chute ? ' · parachute' : ''}${D.class === 'rocket' && v.fuel <= 0 ? ' · <span class="warn">NO FUEL</span>' : ''}`;
    // The air thins as you climb (the Overseer module's planet): wings and rotors give out, then it's space.
    if (['plane', 'heli', 'rocket', 'ship'].includes(D.class)) {
      const air = v.air ?? 1;
      const thin = (D.class === 'heli' && (v.ceiling || air < 0.55)) || (D.class === 'plane' && air < 0.2);
      info += air < 0.004 ? ' · <b>SPACE</b>' : ` · air ${Math.round(air * 100)}%${thin ? ' · <span class="warn">THIN AIR</span>' : ''}`;
    }
    const html = `<div><span class="spd">${kmh}</span><span class="unit">km/h</span></div>`
      + (info ? `<div class="info">${info}</div>` : '')
      + (D.class === 'plane' || D.class === 'rocket' ? bar('Throttle', v.throttle) : '')
      + (D.class === 'rocket' ? bar('Fuel', v.fuel / (D.engine.fuel || 150), '#a78bfa') : '')
      + (D.class === 'sub' ? bar('Ballast', (v.ballast + 1) / 2, '#22d3ee') : '')
      + bar('Boost', v.boostFuel, '#ffb020')
      + bar('Health', v.health / D.health, v.health < D.health * 0.3 ? '#ff5a4a' : '#34d399');
    // (The keys are in Controls now, and said once on getting in: the gauges stay small.)
    if (html !== hudEl.__last) { hudEl.innerHTML = html; hudEl.__last = html; }
  }
  /** Height above the planet's surface (sea level), for things that go high. */
  function altText(v) {
    const a = H.planet ? H.planet.altitude(v.e.y) : v.e.y;
    return a > 1500 ? `${(a / 1000).toFixed(1)} km` : `${Math.round(Math.max(0, a))} m`;
  }
  function groundBelow(v) {
    const hit = X.cast(v, v.e.node.position, new B.Vector3(0, -1, 0), 400);
    const water = V.waterLevel(v.e.x, v.e.z);
    let h = hit ? hit.dist : v.e.y;
    if (water !== null) h = Math.min(h, v.e.y - water);
    return Math.max(0, h - V.restHeight(v.def));
  }

  // ------------------------------------------------------------------ sound: engines, horns, crashes
  let ac = null, master = null;
  const voices = new Map(); // vehicle entity -> voice
  function startAudio() {
    // The engine's audio (H.audio): one context, and everything through its master (water muffles it under water).
    if (ac) { if (ac.state === 'suspended') ac.resume().catch(() => {}); return; }
    try {
      ac = H.audio.context;
      if (!ac) return;
      master = ac.createGain();
      master.gain.value = 0.32;
      master.connect(H.audio.effects || H.audio.master);
    } catch { ac = null; }
  }
  /** The game's sound for this vehicle (an asset id or name): shape.sounds.<what>, else its word ("car engine", then
   *  "engine": H.assets finds them by their words). */
  function soundAsset(v, what) {
    const sh = (v.e.spec && v.e.spec.shape) || {};
    const named = sh.sounds && sh.sounds[what];
    if (named && H.assets.has(named)) return named;
    return H.assets.pick(`${v.type} ${what}`, { kind: 'sound' }) || H.assets.pick(what, { kind: 'sound' });
  }
  const buffers = new Map();
  function buffer(name) {
    if (!buffers.has(name)) buffers.set(name, fetch(H.lib.assetUrl(name)).then((r) => { if (!r.ok) throw new Error(`${r.status}`); return r.arrayBuffer(); }).then((b) => ac.decodeAudioData(b)).catch(() => null));
    return buffers.get(name);
  }
  const ENGINE = { car: [42, 130], truck: [34, 95], motorbike: [70, 230], boat: [48, 140], submarine: [28, 40], airplane: [55, 150], helicopter: [32, 30], rocket: [26, 40], spaceship: [70, 60] };
  function makeVoice(v) {
    const out = ac.createGain();
    out.gain.value = 0;
    out.connect(master);
    const voice = { out, v, nodes: [] };
    const name = soundAsset(v, 'engine');
    if (name) {
      buffer(name).then((buf) => {
        if (!buf || voice.dead) return;
        const src = ac.createBufferSource();
        src.buffer = buf; src.loop = true; src.connect(out); src.start();
        voice.src = src; voice.nodes.push(src);
      });
      return voice;
    }
    if (!ENGINE[v.type]) return voice;
    const filter = ac.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = v.type === 'submarine' ? 260 : 900; filter.Q.value = 2;
    const a = ac.createOscillator(); a.type = 'sawtooth';
    const b = ac.createOscillator(); b.type = 'square';
    const bg = ac.createGain(); bg.gain.value = 0.35;
    a.connect(filter); b.connect(bg).connect(filter);
    const amp = ac.createGain(); amp.gain.value = 1;
    filter.connect(amp).connect(out);
    if (v.type === 'helicopter') {
      const lfo = ac.createOscillator(); lfo.frequency.value = 6;
      const depth = ac.createGain(); depth.gain.value = 0.8;
      lfo.connect(depth).connect(amp.gain);
      lfo.start();
      voice.lfo = lfo; voice.nodes.push(lfo);
    }
    a.start(); b.start();
    voice.a = a; voice.b = b; voice.filter = filter;
    voice.nodes.push(a, b);
    return voice;
  }
  function stopVoice(voice) {
    voice.dead = true;
    try { voice.out.gain.setTargetAtTime(0, ac.currentTime, 0.08); } catch {}
    setTimeout(() => { for (const n of voice.nodes) { try { n.stop(); } catch {} } try { voice.out.disconnect(); } catch {} }, 400);
    if (voice.horn) stopHorn(voice);
  }
  function hornOn(voice) {
    if (voice.horn) return;
    const v = voice.v;
    const name = soundAsset(v, 'horn');
    const g = ac.createGain(); g.gain.value = 0.22; g.connect(master);
    const h = { g, nodes: [] };
    if (name) buffer(name).then((buf) => { if (!buf || h.dead) return; const s = ac.createBufferSource(); s.buffer = buf; s.connect(g); s.start(); h.nodes.push(s); });
    else for (const f of v.def.twoWheels ? [880] : [392, 494]) { const o = ac.createOscillator(); o.type = v.def.twoWheels ? 'triangle' : 'square'; o.frequency.value = f; const lp = ac.createBiquadFilter(); lp.frequency.value = 1800; o.connect(lp).connect(g); o.start(); h.nodes.push(o); }
    voice.horn = h;
  }
  function stopHorn(voice) {
    const h = voice.horn;
    if (!h) return;
    voice.horn = null;
    h.dead = true;
    try { h.g.gain.setTargetAtTime(0, ac.currentTime, 0.03); } catch {}
    setTimeout(() => { for (const n of h.nodes) { try { n.stop(); } catch {} } try { h.g.disconnect(); } catch {} }, 200);
  }
  function sounds() {
    if (!ac || !W()) return;
    const cam = W().scene.activeCamera;
    if (!cam) return;
    const live = new Set();
    // The nearest few running engines are heard (yours always), quieter farther away.
    const running = V.list().filter((e) => { const v = e.vehicle; return !v.wrecked && (v.seats[0].who || v.autopilot) && (v.type !== 'bicycle' || v.horn) && !(V.sound && V.sound.owns(v)); })
      .map((e) => ({ e, d: B.Vector3.Distance(cam.position, e.node.position) }))
      .filter((x) => x.d < 70 || (local && local.v.e === x.e))
      .sort((a, b) => a.d - b.d).slice(0, 4);
    for (const { e, d } of running) {
      const v = e.vehicle;
      live.add(e);
      let voice = voices.get(e);
      if (!voice) { voice = makeVoice(v); voices.set(e, voice); }
      const mine = local && local.v === v;
      const gain = (mine ? 1 : 0.7) / (1 + d / 14);
      const top = v.def.engine.top || 30;
      const feelRpm = V.feel ? V.feel.rpm(v) : null;
      const rpm = feelRpm !== null ? feelRpm : clamp(v.def.class === 'heli' ? v.spool * (0.6 + v.collective * 0.6) : v.def.class === 'plane' ? 0.15 + v.throttle * 0.85 : v.def.class === 'rocket' || v.def.class === 'ship' ? 0.1 + (v.throttleNow || 0) * 0.9 : (v.vel.length() / top) * 0.85 + Math.abs(v.throttleNow || 0) * 0.25, 0, 1.3) * (v.boosting ? 1.15 : 1);
      const t = ac.currentTime;
      try {
        voice.out.gain.setTargetAtTime(v.type === 'bicycle' ? 0 : gain, t, 0.1);
        if (voice.a) { const [base, span] = ENGINE[v.type]; const f = base + span * rpm; voice.a.frequency.setTargetAtTime(f, t, 0.06); voice.b.frequency.setTargetAtTime(f * 0.5, t, 0.06); voice.filter.frequency.setTargetAtTime(500 + rpm * 1500, t, 0.1); }
        if (voice.lfo) voice.lfo.frequency.setTargetAtTime(2 + v.spool * 9, t, 0.2);
        if (voice.src) voice.src.playbackRate.setTargetAtTime(0.6 + rpm * 1.1, t, 0.08);
      } catch {}
      if (v.horn) hornOn(voice); else if (voice.horn) stopHorn(voice);
    }
    for (const [e, voice] of voices) if (!live.has(e)) { stopVoice(voice); voices.delete(e); }
  }
  /** A crash: a thump you hear, and a shake you feel if you're in it. */
  V._crashFx = (v, speed) => {
    if (local && local.v === v && W()) W().camera.api.shake(Math.min(0.6, speed * 0.025), 0.25);
    if (!ac) return;
    try {
      const cam = W().scene.activeCamera;
      const d = cam ? B.Vector3.Distance(cam.position, v.e.node.position) : 0;
      const vol = Math.min(1, speed / 25) / (1 + d / 12);
      if (vol < 0.03) return;
      const name = soundAsset(v, 'crash');
      const g = ac.createGain(); g.gain.value = vol * 0.9; g.connect(master);
      if (name) { buffer(name).then((buf) => { if (!buf) return; const s = ac.createBufferSource(); s.buffer = buf; s.connect(g); s.start(); }); return; }
      const len = Math.floor(ac.sampleRate * 0.35);
      const buf = ac.createBuffer(1, len, ac.sampleRate);
      const ch = buf.getChannelData(0);
      for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
      const s = ac.createBufferSource(); s.buffer = buf;
      const lp = ac.createBiquadFilter(); lp.frequency.value = 900;
      s.connect(lp).connect(g); s.start();
    } catch {}
  };

  // ------------------------------------------------------------------ worlds come and go
  H.hooks.world.push({
    enter() { local = null; near = null; promptFor = null; ensureNet(); },
    leave() {
      local = null;
      prompt(null);
      showHud(false);
      for (const [, voice] of voices) stopVoice(voice);
      voices.clear();
    },
    respawn(p) { if (local && p === W().player) { const v = local.v; leaveLocal(false, true); if (H.sync && H.sync.online) G().net.everyone('veh', { op: 'stand', k: v.key, who: V.myId() }); else onSeat({ op: 'stand', k: v.key, who: V.myId() }); } },
  });

  // ------------------------------------------------------------------ the scripts' side: game.vehicles
  function api() {
    return {
      /** Puts you in a vehicle (the driver's seat if free): game.vehicles.enter(car) or enter(car, { seat: 1 }). */
      enter: (e, o) => enter(e, o || {}),
      /** Gets you out. */
      exit: () => exit(false),
      /** The vehicle you're in (or null), and your seat (0 drives). */
      get current() { return local ? local.v.e : null; },
      get seat() { return local ? local.seat : null; },
      /** Every vehicle in the world (or of one type: 'car', 'boat'...). */
      list: (type) => V.list().filter((e) => !type || e.vehicle.type === (V.typeOf(type) || type)),
      /** The closest vehicle to a thing or point (within maxDistance, default 50 m). */
      nearest(from, maxDistance = 50) { const g = G(); const f = from ? (from.__entity ? from : { x: from[0], y: from[1], z: from[2] }) : g.player; return nearest(f, maxDistance); },
      /** Makes one: game.vehicles.make('4x4', { x: 3, z: 5 }) (any type or name: car, truck, 4x4, bike, plane...). */
      make(type, opts = {}) { const t = V.typeOf(type); if (!t) throw new Error(`No vehicle called "${type}". These exist: ${Object.keys(V.types).join(', ')}`); return G()[t](opts); },
      /** Drives it from code: { steer, throttle or speed, up, down, boost, brake, hover }; null stops. */
      drive: (e, input) => V.drive(e, input),
      /** Seats an NPC or thing (it rides along until unboard); seat 0 makes it the driver (then drive() steers). */
      board, unboard,
      repair: (e) => V.repair(e),
      flip: (e) => V.flip(e),
      honk: (e, seconds) => e && e.honk && e.honk(seconds),
      /** Throws and hurts vehicles near a point (the Mayhem module's explosions do this by themselves). */
      blast: (at, o) => V.blast(at, o || {}),
      types: Object.keys(V.types),
    };
  }
  // game.vehicles for every game object, before the scripts run (H.hooks.game).
  H.hooks.game.push((g) => { g.vehicles = api(); });

  Object.assign(V, {
    enter, exit, board, unboard, nearest, useOffer,
    /** A vehicle within radius meters of a thing or point (one you could get into), or null. */
    near: (from, radius = REACH) => nearest(from, radius),
    kinds: [...Object.keys(V.types), 'vehicle'],
  });
  Object.defineProperties(V, {
    current: { get: () => (local ? local.v.e : null), configurable: true },
    seat: { get: () => (local ? local.seat : null), configurable: true },
  });
})();
