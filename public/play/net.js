// Playing together: one WebSocket to the game's room (src/rooms.ts). Everyone runs the whole game; this keeps them in
// one world:
//   - you see each other: everyone sends where they are and where they look (15 times a second), as an avatar
//   - moving things agree: each thing that falls or gets thrown is simulated by one player, its owner (whoever grabbed
//     or pushed it last), or by the host (the oldest player) when nobody holds it; the others see where it is
//   - things that move on their own (spin, float, patrol) line up through a shared clock, with nothing sent
//   - world edits arrive here as ops (saved by the server first) and are applied live
//   - scripts talk with game.net.send / game.net.on
/* global HawkesPlay */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  let ws = null;
  let opts = null;
  let me = null;
  let host = null;
  let online = false;
  let retry = 0;
  const peers = new Map(); // conn -> { name, color, state, avatar, tag, seen }
  const owners = new Map(); // scene id -> conn
  const sent = new Map(); // scene id -> last sent pose (to send only what moved)
  let lastMe = 0;
  let lastXf = 0;
  let lastPing = 0;
  const offsets = [];
  const W = () => H.world;
  const game = () => H.game;

  function url() {
    const base = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/v1/ws`;
    if (opts.token) return `${base}?t=${encodeURIComponent(opts.token)}`;
    return `${base}?play=${encodeURIComponent(opts.play)}&room=${encodeURIComponent(opts.room)}&name=${encodeURIComponent(opts.name || '')}`;
  }
  function send(m) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); }

  function connect(o) {
    opts = { ...opts, ...o };
    if (ws) { ws.onclose = null; try { ws.close(); } catch {} }
    try { ws = new WebSocket(url()); } catch (e) { status('offline'); return; }
    status('connecting');
    ws.onopen = () => { retry = 0; };
    ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } try { onMessage(m); } catch (err) { console.warn('net', err); } };
    ws.onclose = (e) => {
      online = false;
      host = null;
      for (const id of [...peers.keys()]) dropPeer(id);
      owners.clear();
      flags();
      status(e.code === 4003 ? 'removed' : 'offline');
      if (e.code === 4003 || e.code === 1008) return;
      const wait = Math.min(15000, 1000 * 2 ** retry++);
      setTimeout(() => { if (!online) connect({}); }, wait);
    };
  }
  function status(s) { for (const f of H.hooks.world) if (f.net) f.net(s, { me, host, peers: peers.size }); H.post({ type: 'net', status: s, conn: me, peers: [...peers.values()].map((p) => ({ name: p.name, color: p.color })) }); }

  function onMessage(m) {
    switch (m.t) {
      case 'hello':
        me = m.you; host = m.host; online = true;
        owners.clear();
        for (const [k, v] of Object.entries(m.owners || {})) owners.set(k, v);
        H.hooks.myName = m.name; H.hooks.myColor = m.color;
        const p = W() && W().player;
        if (p && p.alive) { p.name = m.name; p.color = m.color; }
        for (const pr of m.peers || []) if (pr.c !== me) addPeer(pr.c, pr.name, pr.color);
        ping();
        flags();
        status('online');
        return;
      case 'pong': {
        const rtt = Date.now() - m.at;
        offsets.push(m.now + rtt / 2 - Date.now());
        if (offsets.length > 7) offsets.shift();
        const sorted = [...offsets].sort((a, b) => a - b);
        H.setClockOffset(sorted[Math.floor(sorted.length / 2)]);
        return;
      }
      case 'join': addPeer(m.c, m.name, m.color); dispatch('join', { id: m.c, name: m.name }); status('online'); return;
      case 'leave': dropPeer(m.c); for (const [k, v] of owners) if (v === m.c) owners.delete(k); flags(); dispatch('leave', { id: m.c }); status('online'); return;
      case 'host': host = m.c; flags(); return;
      case 'me': { const pr = peers.get(m.c); if (pr) { pr.state = m.s; pr.seen = performance.now(); if (!pr.avatar || !pr.avatar.alive) makeAvatar(pr); } return; }
      case 'xf': return onXf(m.c, m.x || []);
      case 'own': if (m.c) owners.set(m.id, m.c); else owners.delete(m.id); flags(); return;
      case 'ops': H.applyOps(m.ops || [], { fx: m.fx, by: m.by, remote: true }); flags(); return;
      case 'ev': {
        const from = m.c ? { id: m.c, name: peers.get(m.c)?.name ?? null } : null;
        if (m.c === null && H.hooks.onRoomEvent) H.hooks.onRoomEvent(m.name, m.data);
        dispatch(m.name, m.data, from);
        return;
      }
    }
  }
  function dispatch(name, data, from) { const w = W(); if (!w) return; for (const f of w.netHandlers.get(name) || []) f(data, from); }

  // ------------------------------------------------------------------ who simulates what
  const isHost = () => !online || host === me;
  const ownerOf = (id) => owners.get(id) || null;
  /** I simulate it if I own it, or nobody does and I'm the host. Everyone else follows what's sent. */
  const mine = (id) => { const o = ownerOf(id); return o ? o === me : isHost(); };
  function flags() {
    const w = W();
    if (!w) return;
    for (const e of w.entities) {
      if (!e.sceneId || e.remotePlayer) continue;
      const r = online && !mine(e.sceneId);
      if (e.remote && !r) { e.wake(); e._net = null; }
      e.remote = r;
    }
  }
  function claim(e) {
    if (!online || !e || !e.sceneId) return;
    if (owners.get(e.sceneId) === me) return;
    owners.set(e.sceneId, me);
    e.remote = false; e._net = null; e.wake();
    send({ t: 'own', id: e.sceneId, on: true });
  }
  function release(e) {
    if (!online || !e || !e.sceneId || owners.get(e.sceneId) !== me) return;
    owners.delete(e.sceneId);
    send({ t: 'own', id: e.sceneId, on: false });
    flags();
  }

  function onXf(c, list) {
    const w = W();
    if (!w) return;
    for (const x of list) {
      const e = w.byId.get(x[0]);
      if (!e) continue;
      const o = ownerOf(x[0]);
      if (o ? o !== c : c !== host) continue; // only the one simulating it says where it is
      e.remote = true;
      e._net = { p: [x[1], x[2], x[3]], r: [x[4], x[5], x[6]], v: [x[7], x[8], x[9]], at: performance.now() };
    }
  }

  // ------------------------------------------------------------------ avatars
  function addPeer(c, name, color) {
    if (c === me || peers.has(c)) return;
    peers.set(c, { id: c, name, color, state: null, avatar: null, seen: 0 });
  }
  function dropPeer(c) { const p = peers.get(c); if (p && p.avatar) p.avatar.destroy(); peers.delete(c); }
  function makeAvatar(pr) {
    const g = game();
    if (!g || !pr.state) return;
    const s = pr.state;
    const a = g.capsule({ x: s.p[0], y: s.p[1], z: s.p[2], radius: 0.35, height: 1.8, color: pr.color, physics: 'kinematic', tag: 'player', name: pr.name, shadow: true });
    a.remotePlayer = true;
    a.isPlayer = true;
    a.netId = pr.id;
    const B = g.BABYLON;
    const visor = B.MeshBuilder.CreateBox('visor', { width: 0.5, height: 0.14, depth: 0.12 }, g.scene);
    const vm = new B.StandardMaterial('visor', g.scene);
    vm.emissiveColor = new B.Color3(0.85, 0.95, 1); vm.disableLighting = true;
    visor.material = vm; visor.parent = a.node; visor.position.set(0, 0.5, 0.32); visor.metadata = { entity: a, decor: true };
    const tag = H.textPlane(pr.name, { size: 0.22 });
    tag.parent = a.node; tag.position.set(0, 1.35, 0); tag.isPickable = false; tag.metadata = { decor: true };
    a.measure();
    pr.avatar = a;
  }

  // ------------------------------------------------------------------ every step: say where I am and what I move
  function step() {
    if (!online) return;
    const w = W();
    if (!w) return;
    const now = performance.now();
    if (now - lastPing > 5000) { lastPing = now; ping(); }
    const p = w.player;
    if (p && p.alive && now - lastMe > 66) {
      lastMe = now;
      const cam = w.camera;
      send({ t: 'me', s: { p: round3(p.position), y: r2(cam.yaw), pi: r2(cam.pitch), f: p.flying ? 1 : 0, h: H.hooks.holding || null } });
    }
    if (now - lastXf > 100) {
      lastXf = now;
      const out = [];
      for (const e of w.entities) {
        if (!e.sceneId || e.remote || e.physics !== 'dynamic' || !e.alive) continue;
        if (!mine(e.sceneId)) continue;
        const pose = [e.x, e.y, e.z, e.node.rotation.x, e.node.rotation.y, e.node.rotation.z];
        const before = sent.get(e.sceneId);
        const moved = !before || pose.some((v, i) => Math.abs(v - before[i]) > 0.005);
        if (!moved && (e.sleeping || now - (before.at || 0) < 1000)) continue;
        pose.at = now;
        sent.set(e.sceneId, pose);
        out.push([e.sceneId, ...pose.slice(0, 6).map(r3), r2(e.vx), r2(e.vy), r2(e.vz)]);
        // Done moving and not held: give it back to the host.
        if (owners.get(e.sceneId) === me && !e.held && e.sleeping && !isHost()) release(e);
      }
      if (out.length) send({ t: 'xf', x: out });
    }
  }
  const r2 = (n) => Math.round(n * 100) / 100;
  const r3 = (n) => Math.round(n * 1000) / 1000;
  const round3 = (a) => a.map(r3);
  function ping() { send({ t: 'ping', at: Date.now() }); }

  // ------------------------------------------------------------------ every frame: show where others are
  function frame(dt) {
    const w = W();
    if (!w) return;
    const k = 1 - Math.exp(-dt * 14);
    for (const e of w.entities) {
      const n = e._net;
      if (!n || !e.remote) continue;
      const ahead = Math.min(0.2, (performance.now() - n.at) / 1000);
      const tx = n.p[0] + n.v[0] * ahead, ty = n.p[1] + n.v[1] * ahead, tz = n.p[2] + n.v[2] * ahead;
      const far = Math.abs(tx - e.x) + Math.abs(ty - e.y) + Math.abs(tz - e.z) > 4;
      e.node.position.set(far ? tx : e.x + (tx - e.x) * k, far ? ty : e.y + (ty - e.y) * k, far ? tz : e.z + (tz - e.z) * k);
      e.node.rotation.set(n.r[0], lerpAngle(e.node.rotation.y, n.r[1], k), n.r[2]);
      e.vx = n.v[0]; e.vy = n.v[1]; e.vz = n.v[2];
    }
    for (const pr of peers.values()) {
      const a = pr.avatar, s = pr.state;
      if (!a || !a.alive || !s) continue;
      const far = Math.abs(s.p[0] - a.x) + Math.abs(s.p[1] - a.y) + Math.abs(s.p[2] - a.z) > 6;
      a.node.position.set(far ? s.p[0] : a.x + (s.p[0] - a.x) * k, far ? s.p[1] : a.y + (s.p[1] - a.y) * k, far ? s.p[2] : a.z + (s.p[2] - a.z) * k);
      a.node.rotation.y = lerpAngle(a.node.rotation.y, s.y, k);
      // Gone quiet for a long time (their tab was closed without a goodbye): hide them.
      a.visible = performance.now() - pr.seen < 20000;
    }
  }
  function lerpAngle(a, b, k) { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * k; }

  H.hooks.step.push(step);
  H.hooks.frame.push(frame);
  H.hooks.push.push((o) => claim(o));
  H.hooks.world.push({
    enter() { for (const pr of peers.values()) pr.avatar = null; for (const pr of peers.values()) makeAvatar(pr); sent.clear(); flags(); },
    leave() { for (const pr of peers.values()) pr.avatar = null; },
    ops() { flags(); },
    reset(e) { if (online && e.sceneId && !mine(e.sceneId)) return; },
  });
  H.hooks.net = {
    send(name, data, self) { send({ t: 'ev', name, data, self: Boolean(self) }); },
    get online() { return online; },
    get isHost() { return isHost(); },
    get me() { return me ? { id: me, name: H.hooks.myName, color: H.hooks.myColor } : null; },
    players() { return [...peers.entries()].map(([id, p]) => ({ id, name: p.name, color: p.color, entity: p.avatar && p.avatar.alive ? p.avatar : null })); },
  };
  window.HawkesNet = { connect, claim, release, mine: (e) => !e.sceneId || mine(e.sceneId), get online() { return online; }, get me() { return me; }, peers: () => peers, ownerOf };
})();
