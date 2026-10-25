// Playing together: the game's room on Hawkes Net (Hawkes Gen's multiplayer: peer to peer while a room is small, its
// relay when it grows; /play/hawkes-net.mjs, src/hnet.ts), or one WebSocket to this site (src/rooms.ts, src/relay.ts)
// when Hawkes Net isn't in use. The messages are the same either way. Everyone runs the whole game; this keeps them in
// one world, where what you see of everyone else is a replay of their data:
//   - one authority per moving thing: its owner (whoever grabbed, pushed or drives it) or the host (the oldest player)
//     when nobody holds it. Your own player and the car you drive are yours: they answer your keys at once, at any ping
//   - the authority sends where its things are (10 times a second, 20 for important ones), stamped with the shared
//     clock; everyone else keeps a short buffer of those snapshots and shows them about one send behind the newest
//     (adaptive: more when the network is jittery), interpolated (positions lerped, turns slerped), with velocity-based
//     extrapolation only to cover a short gap. So remote things move smoothly however the packets arrive
//   - when the authority over a thing changes (you take it over, someone else does, the host leaves), the change is
//     blended over a fraction of a second instead of snapping: the new authority starts from the newest data
//     (extrapolated to now), so things in flight keep flying
//   - the server sends each player what's relevant to them (near things at full rate, far ones less often, important and
//     moving things first) within a byte budget, and keeps the newest pose and state so joiners and new hosts start
//     from the world as it is
//   - things that move on their own (spin, float, patrol) line up through the shared clock, with nothing sent
//   - world edits arrive here as ops (saved by the server first) and are applied live
//   - scripts talk with game.net.send / game.net.on; modules sync their state with H.sync (docs/engine-modules.md)
/* global HawkesPlay, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = BABYLON;
  let ws = null;
  let hn = null; // the Hawkes Net room (when the site uses Hawkes Net)
  let hnTry = 0;
  let opts = null;
  let me = null;
  let host = null;
  let online = false;
  let retry = 0;
  const peers = new Map(); // conn -> { id, name, color, state, avatar, trk, seen }
  const owners = new Map(); // scene id -> conn
  const locks = new Map(); // scene id -> conn that holds it (drives it, carries it): nobody else takes it by bumping it
  const sent = new Map(); // scene id -> last sent values (to send only what changed)
  let everOnline = false; // (a friend answering an invitation that never got in was refused: closed or full)
  let lastMe = 0;
  let lastPing = 0;
  const xfAt = { normal: 0, fast: 0 };
  const offsets = [];
  const W = () => H.world;
  const game = () => H.game;
  const nowMs = () => performance.now();
  /** The shared clock (the server's, from pings), in ms: every snapshot is stamped with it. */
  const serverNow = () => Date.now() + H.lib.clockOffset;

  // ------------------------------------------------------------------ what this player sees of the network
  const stats = { up: 0, down: 0, upMsgs: 0, downMsgs: 0, corrections: 0, maxCorrection: 0, extrapolated: 0, interpolated: 0, takeovers: 0, since: nowMs() };
  const STATS0 = { ...stats };

  function url() {
    const base = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/v1/ws`;
    if (opts.token) return `${base}?t=${encodeURIComponent(opts.token)}&v=2`;
    return `${base}?play=${encodeURIComponent(opts.play)}&room=${encodeURIComponent(opts.room)}&name=${encodeURIComponent(opts.name || '')}${opts.join ? '&join=1' : ''}&v=2`;
  }
  // Everything said in one ~33 ms goes as one message (the room counts messages: 90 a second at most).
  let outq = [];
  let lastFlush = 0;
  let flushTimer = null;
  function send(m) {
    if (hn) return void hn.raw.send(m);
    if (!ws || ws.readyState !== 1) return;
    outq.push(m);
    if (!flushTimer) flushTimer = setTimeout(flush, 34);
  }
  function sendNow(m) { if (hn) return; if (ws && ws.readyState === 1) { const t = JSON.stringify(m); stats.up += t.length; stats.upMsgs++; ws.send(t); } }
  function flush() {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    lastFlush = nowMs();
    if (!outq.length || !ws || ws.readyState !== 1) { outq = []; return; }
    const m = outq.length === 1 ? outq[0] : { t: 'b', m: outq };
    outq = [];
    sendNow(m);
  }

  function connect(o) {
    opts = { ...opts, ...o };
    const n = ++hnTry;
    if (hn) { const h = hn; hn = null; void h.leave('moved'); }
    // Hawkes Net when the site offers it (its answer says so); the room on this site otherwise.
    void connectHawkesNet(n).then((ok) => { if (!ok && n === hnTry) connectWs(); });
  }
  /** Joins through Hawkes Net (/play/hawkes-net.mjs): a ticket from this site (src/hnet.ts), then the room. The engine's
   *  messages ride it unchanged (raw), and Hawkes Net does the transport, reconnecting and the clock. False: not in use. */
  async function connectHawkesNet(n) {
    let mod;
    try { mod = await import('/play/hawkes-net.mjs'); } catch (e) { console.warn('net: Hawkes Net SDK did not load', e); return false; }
    const body = opts.token ? { token: opts.token } : { play: opts.play, room: opts.room, name: opts.name || '', join: Boolean(opts.join) };
    const ask = async () => {
      // text/plain: a simple request, no preflight (the page is sandboxed; no cookies go).
      const r = await fetch('/v1/net/ticket', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ ...body, sdk: mod.VERSION }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw Object.assign(new Error(j.error || `ticket ${r.status}`), { status: r.status });
      return j;
    };
    let first;
    try { first = await ask(); } catch (e) {
      if (e.status === 409 || e.status === 404 || e.status === 401) { status(opts.join ? 'refused' : 'offline'); return true; } // a real no: don't fall back
      return false;
    }
    if (first.mode !== 'hawkesnet') return false;
    if (n !== hnTry) return true;
    status('connecting');
    let used = false;
    try {
      const room = await mod.join(first.room, {
        project: 'hawkesgenwebsite', transport: 'auto', leaveOnHide: true, log: false,
        ticket: async () => (used ? ask() : ((used = true), first)),
        onRaw: (m) => { try { onMessage(m); } catch (err) { console.warn('net', err); } },
      });
      if (n !== hnTry) { void room.leave('moved'); return true; }
      hn = room;
      room.when('status', (s) => {
        if (room !== hn) return;
        if (s.status === 'reconnecting') { online = false; flags(); status('offline'); }
        else if (s.status === 'closed') { online = false; for (const id of [...peers.keys()]) dropPeer(id); owners.clear(); locks.clear(); flags(); status('offline'); }
      });
      room.when('problem', (p) => { if (p.code === 'full') status('refused'); });
    } catch (e) {
      if (n === hnTry) status(e && e.code === 4009 ? 'refused' : 'offline');
    }
    return true;
  }
  function connectWs() {
    if (ws) { ws.onclose = null; try { ws.close(); } catch {} }
    try { ws = new WebSocket(url()); } catch (e) { status('offline'); return; }
    status('connecting');
    ws.onopen = () => { retry = 0; };
    ws.onmessage = (e) => {
      stats.down += e.data.length; stats.downMsgs++;
      let m; try { m = JSON.parse(e.data); } catch { return; }
      try { if (m.t === 'b') { for (const x of m.m || []) onMessage(x); } else onMessage(m); } catch (err) { console.warn('net', err); }
    };
    ws.onclose = (e) => {
      const refused = opts.join && !everOnline;
      online = false;
      host = null;
      for (const id of [...peers.keys()]) dropPeer(id);
      owners.clear(); locks.clear();
      outq = [];
      flags();
      // A friend answering an invitation (join) who never got in: the island is closed or full. No retrying; the page says so.
      status(e.code === 4003 ? 'removed' : refused ? 'refused' : 'offline');
      if (e.code === 4003 || e.code === 1008 || refused) return;
      const wait = Math.min(15000, 1000 * 2 ** retry++);
      setTimeout(() => { if (!online) connectWs(); }, wait);
    };
  }
  function status(s) { for (const f of H.hooks.world) if (f.net) f.net(s, { me, host, peers: peers.size }); H.post({ type: 'net', status: s, conn: me, peers: [...peers.values()].map((p) => ({ name: p.name, color: p.color })) }); }

  function onMessage(m) {
    switch (m.t) {
      case 'hello': {
        me = m.you; host = m.host; online = true; everOnline = true;
        owners.clear(); locks.clear();
        for (const [k, v] of Object.entries(m.owners || {})) owners.set(k, v);
        for (const [k, v] of Object.entries(m.locks || {})) locks.set(k, v);
        if (!offsets.length && typeof m.now === 'number') H.setClockOffset(m.now - Date.now());
        H.hooks.myName = m.name; H.hooks.myColor = m.color;
        const p = W() && W().player;
        if (p && p.alive) { p.name = m.name; p.color = m.color; }
        for (const pr of m.peers || []) if (pr.c !== me) addPeer(pr.c, pr.name, pr.color);
        // (Re)connected: the server may have nothing of ours (it restarted): send everything once.
        sent.clear();
        for (const st of states.values()) st.sent = null;
        ping();
        flags();
        status('online');
        return;
      }
      case 'pong': {
        // The shared clock: of the last few pings, trust the quickest (a slow answer, queued somewhere or behind a
        // busy page, says little about the clock). The first few go a second apart so it settles fast.
        const rtt = Date.now() - m.at;
        offsets.push({ rtt, off: m.now + rtt / 2 - Date.now() });
        if (offsets.length > 10) offsets.shift();
        const best = offsets.reduce((a, b) => (b.rtt < a.rtt ? b : a));
        H.setClockOffset(best.off);
        stats.rtt = rtt;
        if (offsets.length < 5) setTimeout(ping, 1000);
        return;
      }
      case 'join': addPeer(m.c, m.name, m.color, true); dispatch('join', { id: m.c, name: m.name }); status('online'); return;
      case 'leave': {
        dropPeer(m.c);
        for (const [k, v] of owners) if (v === m.c) owners.delete(k);
        for (const [k, v] of locks) if (v === m.c) locks.delete(k);
        flags(); dispatch('leave', { id: m.c }); status('online');
        return;
      }
      case 'host': {
        const was = host;
        host = m.c;
        // The new host simulates what nobody holds, from the newest data (flags: takeOver), and sends its states.
        if (host === me && was !== me) for (const st of states.values()) st.sent = null;
        flags();
        for (const f of hostHandlers) try { f(host, was); } catch (err) { H.report(err, 'host'); }
        return;
      }
      case 'me': {
        const pr = peers.get(m.c);
        if (!pr) return;
        const s = m.s || {};
        if (!Array.isArray(s.p)) return;
        pr.state = { ...(pr.state || {}), ...s };
        pr.seen = nowMs();
        (pr.trk || (pr.trk = new Track({ yaw: [3] }))).push(m.at, [s.p[0], s.p[1], s.p[2], s.y || 0], m.c);
        if (!pr.avatar || !pr.avatar.alive) makeAvatar(pr);
        return;
      }
      case 'xf': return onXf(m.c, m.x || [], m.at);
      case 'own': {
        if (m.c) owners.set(m.id, m.c); else owners.delete(m.id);
        if (m.c && m.lock) locks.set(m.id, m.c); else locks.delete(m.id);
        flags();
        return;
      }
      case 'ops': H.applyOps(m.ops || [], { fx: m.fx, by: m.by, remote: true }); flags(); return;
      case 'ev': {
        const from = m.c ? { id: m.c, name: peers.get(m.c)?.name ?? null } : null;
        if (m.name === '_s' || m.name === '_a' || m.name === '_ar') return onSync(m.name, m.data || {}, from);
        if (m.c === null && H.hooks.onRoomEvent) H.hooks.onRoomEvent(m.name, m.data);
        dispatch(m.name, m.data, from);
        return;
      }
    }
  }
  function dispatch(name, data, from) { const w = W(); if (!w) return; for (const f of w.netHandlers.get(name) || []) f(data, from); }

  // ------------------------------------------------------------------ the snapshot buffer (H.sync.track)
  // How late each sender's snapshots arrive: the lower edge (the network's own delay) and how much later than that they
  // tend to be (jitter). A track plays its snapshots back that much (plus one send interval) behind the shared clock.
  const links = new Map(); // conn -> { transit, jit, n }
  function noteLink(from, at) {
    const d = serverNow() - at;
    if (!Number.isFinite(d)) return;
    let l = links.get(from);
    if (!l) { l = { transit: d, jit: 8, n: 0 }; links.set(from, l); }
    l.n++;
    if (d < l.transit) l.transit += (d - l.transit) * 0.3; else l.transit += (d - l.transit) * 0.01;
    l.jit += (Math.max(0, d - l.transit) - l.jit) * 0.06;
  }
  const qa = new B.Quaternion(), qb = new B.Quaternion(), qc = new B.Quaternion(), ve = new B.Vector3();
  function lerpAngle(a, b, k) { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * k; }
  /** A buffer of stamped snapshots of some numbers, sampled smoothly in the past. o: { pos: [i, i, i] (positions,
   *  extrapolated for short gaps), vel: [i, i, i] (velocities of pos, else worked out), euler: [i, i, i] (turns in
   *  radians, slerped), yaw: [i...] (single angles), quat: [i, i, i, i] (slerped), maxAhead: ms }. */
  class Track {
    constructor(o = {}) {
      // (With velocities, carrying on is a good guess for longer: a car keeps going.)
      this.o = { pos: [0, 1, 2], vel: null, euler: null, yaw: [], quat: null, maxAhead: o.vel ? 450 : 250, ...o };
      this.buf = [];
      this.gaps = [];
      this.interval = 100;
      this.delay = null;
      this.at = 0; // when it was last sampled (ms, this machine)
      this.from = null;
      this.out = [];
      this.ahead = 0; // ms past the newest snapshot of the last sample (0: interpolated)
    }
    get size() { return this.buf.length; }
    /** Was it standing still at this snapshot? (Its velocity, or how far it went since the one before.) */
    still(s) {
      const o = this.o;
      if (!o.pos) return true;
      if (o.vel) return Math.abs(s.v[o.vel[0]]) + Math.abs(s.v[o.vel[1]]) + Math.abs(s.v[o.vel[2]]) < 0.1;
      const b = this.buf, i = b.indexOf(s), p = i > 0 ? b[i - 1] : null;
      if (!p) return true;
      const d = Math.abs(s.v[o.pos[0]] - p.v[o.pos[0]]) + Math.abs(s.v[o.pos[1]] - p.v[o.pos[1]]) + Math.abs(s.v[o.pos[2]] - p.v[o.pos[2]]);
      return d / Math.max(1, s.at - p.at) * 1000 < 0.1;
    }
    get newest() { return this.buf.length ? this.buf[this.buf.length - 1] : null; }
    push(at, vals, from) {
      if (!Number.isFinite(at)) at = serverNow();
      const b = this.buf;
      const last = b[b.length - 1];
      if (last && at <= last.at) { if (at === last.at) last.v = vals.slice(); return; } // late (out of order): dropped
      if (last) {
        const gap = at - last.at;
        this.gaps.push(gap); if (this.gaps.length > 9) this.gaps.shift();
        const sorted = [...this.gaps].sort((x, y) => x - y);
        this.interval = Math.max(16, Math.min(3000, sorted[Math.floor(sorted.length / 2)]));
        // It rested (nothing was sent because it wasn't moving): it stayed where it was until just before it moved
        // again. (A gap while it was moving is the network's: that's interpolated across.)
        if (gap > this.interval * 2.5 && this.still(last)) b.push({ at: at - Math.min(gap / 2, this.interval), v: last.v.slice() });
      }
      b.push({ at, v: vals.slice() });
      while (b.length > 3 && b[1].at < at - 3000) b.shift();
      while (b.length > 48) b.shift();
      if (from) { this.from = from; noteLink(from, at); }
    }
    /** How far behind the shared clock it plays (ms): the sender's delay, one interval, and room for jitter. */
    target() {
      const l = this.from && links.get(this.from);
      const transit = l ? l.transit : 60, jit = l ? l.jit : 10;
      return Math.max(0, transit) + Math.min(this.interval, 1500) * 1.05 + jit * 2.5 + 8;
    }
    /** The values at this moment (or null): interpolated between snapshots, a little extrapolated after the newest. */
    sample(now = serverNow()) {
      const b = this.buf;
      if (!b.length) return null;
      const wall = nowMs();
      const want = this.target();
      if (this.delay === null || wall - this.at > 1000) this.delay = want;
      else {
        // Stretch time a little instead of jumping: at most 10% faster or slower than real time.
        const room = (wall - this.at) * 0.1;
        this.delay += Math.max(-room, Math.min(room, want - this.delay));
      }
      this.at = wall;
      const rt = now - this.delay;
      const o = this.o, out = this.out;
      const was = this.ahead > 0 && this.out.length ? this.o.pos.map((p) => this.out[p]) : null;
      const r = this.read(rt, b);
      // Back on real data after carrying on without it (a late packet): blend the difference out, don't jump.
      if (was && this.ahead <= 0 && o.pos) {
        const d = o.pos.map((p, k) => was[k] - out[p]);
        const len = Math.hypot(d[0], d[1], d[2]);
        if (len > 0.01 && len < 10) { this.err = d; this.errAt = wall; }
      }
      if (this.err && o.pos) {
        const k = Math.exp(-(wall - this.errAt) / 90);
        if (k < 0.02) this.err = null;
        else for (let j = 0; j < 3; j++) out[o.pos[j]] += this.err[j] * k;
      }
      return r;
    }
    read(rt, b) {
      const o = this.o, out = this.out;
      let i = b.length - 1;
      while (i > 0 && b[i].at > rt) i--;
      const a = b[i];
      if (i === b.length - 1 || rt < a.at) {
        // Past the newest (a gap): carry on by its velocity a short while, then hold. (Before the oldest: the oldest.)
        const ahead = rt < a.at ? 0 : Math.min(rt - a.at, o.maxAhead);
        this.ahead = rt - a.at;
        for (let k = 0; k < a.v.length; k++) out[k] = a.v[k];
        if (ahead > 0 && o.pos) {
          const prev = b.length > 1 ? b[b.length - 2] : null;
          for (let k = 0; k < 3; k++) {
            const p = o.pos[k];
            const v = o.vel ? a.v[o.vel[k]] : prev ? (a.v[p] - prev.v[p]) / Math.max(1, a.at - prev.at) * 1000 : 0;
            out[p] = a.v[p] + v * (ahead / 1000);
          }
        }
        if (this.ahead > 0) stats.extrapolated++;
        return out;
      }
      const c = b[i + 1];
      const k = (rt - a.at) / Math.max(1e-3, c.at - a.at);
      this.ahead = 0;
      stats.interpolated++;
      for (let j = 0; j < a.v.length; j++) out[j] = a.v[j] + (c.v[j] - a.v[j]) * k;
      for (const j of o.yaw) out[j] = lerpAngle(a.v[j], c.v[j], k);
      if (o.euler) {
        const [x, y, z] = o.euler;
        B.Quaternion.FromEulerAnglesToRef(a.v[x], a.v[y], a.v[z], qa);
        B.Quaternion.FromEulerAnglesToRef(c.v[x], c.v[y], c.v[z], qb);
        B.Quaternion.SlerpToRef(qa, qb, k, qc);
        qc.toEulerAnglesToRef(ve);
        out[x] = ve.x; out[y] = ve.y; out[z] = ve.z;
      }
      if (o.quat) {
        const [x, y, z, w] = o.quat;
        qa.set(a.v[x], a.v[y], a.v[z], a.v[w]); qb.set(c.v[x], c.v[y], c.v[z], c.v[w]);
        B.Quaternion.SlerpToRef(qa, qb, k, qc);
        out[x] = qc.x; out[y] = qc.y; out[z] = qc.z; out[w] = qc.w;
      }
      return out;
    }
    /** The newest snapshot carried on to `now` by its velocity (at most `cap` ms): where a new authority starts from. */
    latest(now = serverNow(), cap = 400) {
      const a = this.newest;
      if (!a) return null;
      const v = a.v.slice();
      const o = this.o;
      const dt = Math.max(0, Math.min(cap, now - a.at)) / 1000;
      if (o.pos && o.vel) for (let k = 0; k < 3; k++) v[o.pos[k]] += a.v[o.vel[k]] * dt;
      return v;
    }
    clear() { this.buf.length = 0; this.gaps.length = 0; this.delay = null; }
  }

  // ------------------------------------------------------------------ who simulates what
  const isHost = () => !online || host === me;
  const ownerOf = (id) => owners.get(id) || null;
  /** I simulate it if I own it, or nobody does and I'm the host. Everyone else follows what's sent. */
  const mine = (id) => { const o = ownerOf(id); return o ? o === me : isHost(); };
  const heldByOther = (id) => { const l = locks.get(id); return Boolean(l && l !== me && peers.has(l)); };
  function flags() {
    const w = W();
    if (!w) return;
    for (const e of w.entities) {
      if (!e.sceneId || e.remotePlayer) continue;
      const r = online && !mine(e.sceneId);
      if (e.remote && !r) takeOver(e);
      else if (!e.remote && r) { e._blend = true; e._err = null; sent.delete(e.sceneId); }
      e.remote = r;
    }
  }
  /** It's mine now (I claimed it, or its owner or the host left): carry on from the newest data, not from the
   *  slightly-behind copy I was showing, so it keeps flying for everyone. The jump is hidden (blended on screen). */
  function takeOver(e) {
    const t = e._trk;
    e.remote = false;
    e._err = null; e._blend = false;
    if (t && t.size && e.alive) {
      const v = t.latest(serverNow());
      const before = [e.x, e.y, e.z];
      e.node.position.set(v[0], v[1], v[2]);
      e.node.rotation.set(v[3], v[4], v[5]);
      if (e.physics === 'dynamic') {
        e.velocity = [v[6], v[7], v[8]];
        if (e._netAv) e.angularVelocity = e._netAv;
      }
      // A blast the old authority decided but whose result never reached me (it left first): it happens now.
      const seenAt = t.newest.at;
      for (const bl of blasts) if (bl.at > seenAt && serverNow() - bl.at < 2500 && e.physics === 'dynamic') blastOne(e, bl.d);
      const off = [before[0] - v[0], before[1] - v[1], before[2] - v[2]];
      const d = Math.hypot(off[0], off[1], off[2]);
      if (d > 0.01 && d < 8) visual.set(e, { off, t0: nowMs() });
      stats.takeovers++;
    }
    e._trk = null; e._netVals = null; e._netAv = null;
    e.wake();
  }
  /** Take over simulating a thing (before pushing something someone else simulates). A thing someone holds (drives,
   *  carries) stays theirs. o.hold: I hold it (nobody takes it by bumping into it) until release. */
  function claim(e, o = {}) {
    if (!online || !e || !e.sceneId || !e.alive) return false;
    const id = e.sceneId;
    if (heldByOther(id) && !o.force) return false;
    const hold = Boolean(o.hold);
    if (owners.get(id) === me && (!hold || locks.get(id) === me)) return true;
    owners.set(id, me);
    if (hold) locks.set(id, me);
    if (e.remote) takeOver(e);
    send({ t: 'own', id, on: true, lock: locks.get(id) === me ? 1 : 0 });
    return true;
  }
  function release(e) {
    if (!online || !e || !e.sceneId || owners.get(e.sceneId) !== me) return;
    owners.delete(e.sceneId);
    locks.delete(e.sceneId);
    send({ t: 'own', id: e.sceneId, on: false });
    flags();
  }
  /** Is this thing held by me right now (a car I drive, something I carry)? Then it's locked to me. */
  function holding(e) {
    if (e.held || e.netHold) return true;
    const v = e.vehicle;
    const d = v && v.seats && v.seats[0] && v.seats[0].who;
    return Boolean(d && (d === me || d === 'local'));
  }

  const NV = 12;
  function onXf(c, list, at) {
    const w = W();
    if (!w) return;
    for (const x of list) {
      const e = w.byId.get(x[0]);
      if (!e) continue;
      const o = ownerOf(x[0]);
      if (o ? o !== c : c !== host) continue; // only the one simulating it says where it is
      if (!e.remote) { e._blend = true; e._err = null; }
      e.remote = true;
      // [id, mask, ...the values whose bits are set] (x y z, rx ry rz, vx vy vz, spin x y z): only what changed.
      const last = e._netVals || (e._netVals = [e.x, e.y, e.z, e.node.rotation.x, e.node.rotation.y, e.node.rotation.z, 0, 0, 0, 0, 0, 0]);
      const mask = x[1];
      let k = 2;
      for (let i = 0; i < NV; i++) if (mask & (1 << i)) last[i] = x[k++];
      if (mask & (7 << 9)) e._netAv = [last[9], last[10], last[11]];
      (e._trk || (e._trk = new Track({ euler: [3, 4, 5], vel: [6, 7, 8] }))).push(at, last, c);
    }
  }

  // ------------------------------------------------------------------ avatars
  function addPeer(c, name, color, fresh = false) {
    if (c === me || peers.has(c)) return;
    peers.set(c, { id: c, name, color, state: null, avatar: null, trk: null, seen: 0, fresh });
  }
  function dropPeer(c) { const p = peers.get(c); if (p && p.avatar) p.avatar.destroy(); peers.delete(c); links.delete(c); }
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
    // Someone joining the room right now comes down the Overseer's beam, with their name over them, where everyone
    // sees it (once; a world reload or someone already here just appears; a crowd past the budget just appears).
    if (pr.fresh) {
      pr.fresh = false;
      if (H.arrive && peers.size <= ((H.budget && H.budget.characters) || 10)) {
        try { H.arrive.joined(a, pr.name); } catch (err) { H.report(err, 'net'); }
      }
    }
  }

  // ------------------------------------------------------------------ every step: say where I am and what I move
  function step() {
    if (!online) return;
    const w = W();
    if (!w) return;
    const now = nowMs();
    if (hn) H.setClockOffset(hn.now() - Date.now()); // Hawkes Net keeps the shared clock
    else if (now - lastPing > 5000) { lastPing = now; ping(); }
    const p = w.player;
    if (p && p.alive && now - lastMe > 66) {
      lastMe = now;
      const cam = w.camera;
      send({ t: 'me', at: serverNow(), s: { p: round3(p.position), y: r2(cam.yaw), pi: r2(cam.pitch), f: p.flying ? 1 : 0, h: H.hooks.holding || null } });
    }
    // Important things (held, driven) 20 times a second, the rest 10.
    const fast = now - xfAt.fast >= 50, normal = now - xfAt.normal >= 100;
    if (fast || normal) {
      if (fast) xfAt.fast = now;
      if (normal) xfAt.normal = now;
      const out = [];
      for (const e of w.entities) {
        if (!e.sceneId || e.remote || !e.alive) continue;
        const id = e.sceneId;
        if (!mine(id)) continue;
        // Held by me: locked to me, so nobody takes it by bumping into it.
        const hold = owners.get(id) === me && holding(e);
        if (hold !== (locks.get(id) === me)) {
          if (hold) locks.set(id, me); else locks.delete(id);
          send({ t: 'own', id, on: true, lock: hold ? 1 : 0 });
        }
        if (e.physics !== 'dynamic') continue;
        if (!(hold ? fast : normal)) continue;
        const av = e.sleeping ? [0, 0, 0] : e.angularVelocity || [0, 0, 0];
        const vals = [r3(e.x), r3(e.y), r3(e.z), r3(e.node.rotation.x), r3(e.node.rotation.y), r3(e.node.rotation.z), r2(e.vx), r2(e.vy), r2(e.vz), r1(av[0]), r1(av[1]), r1(av[2])];
        const before = sent.get(id);
        // Only what moved (and once more when it comes to rest), delta-encoded: the bits of what changed, then those
        // values. Everything every few seconds, so nothing drifts.
        const moved = !before || vals.some((v, i) => Math.abs(v - before[i]) > (i < 6 ? 0.004 : i < 9 ? 0.05 : 1));
        if (!moved) continue;
        const full = !before || now - (before.full || 0) > 5000;
        let mask = 0;
        const changed = [];
        vals.forEach((v, i) => { if (full || Math.abs(v - before[i]) > (i < 6 ? 0.002 : i < 9 ? 0.05 : 1)) { mask |= 1 << i; changed.push(v); } else vals[i] = before[i]; });
        if (hold || e.vehicle) mask |= 1 << 12;
        vals.full = full ? now : before.full;
        sent.set(id, vals);
        out.push([id, mask, ...changed]);
        // Done moving and not held: give it back to the host.
        if (owners.get(id) === me && !hold && e.sleeping && !isHost()) release(e);
      }
      if (out.length) send({ t: 'xf', at: serverNow(), x: out });
    }
    syncStates(now);
    if (now - lastFlush >= 33) flush();
  }
  const r1 = (n) => Math.round(n * 10) / 10;
  const r2 = (n) => Math.round(n * 100) / 100;
  const r3 = (n) => Math.round(n * 1000) / 1000;
  const round3 = (a) => a.map(r3);
  function ping() { sendNow({ t: 'ping', at: Date.now() }); }

  // ------------------------------------------------------------------ every frame: show where others are
  const ERR_MS = 160; // how long a correction takes to blend out (ms)
  const visual = new Map(); // entity -> { off, t0 }: a jump of mine hidden on screen (it fades)
  const blasts = []; // { at, d }: recent host explosions (see takeOver)
  function frame() {
    const w = W();
    if (!w) return;
    const now = serverNow(), wall = nowMs();
    for (const e of w.entities) {
      const t = e._trk;
      if (!t || !e.remote || !e.alive) continue;
      const s = t.sample(now);
      if (!s) continue;
      let x = s[0], y = s[1], z = s[2];
      if (e._blend) {
        // It just became someone else's: start from where it is on my screen and blend into their data.
        e._blend = false;
        const err = [e.x - x, e.y - y, e.z - z];
        const d = Math.hypot(err[0], err[1], err[2]);
        if (d > 0.02 && d < 8) { e._err = err; e._errAt = wall; }
        if (d > 0.25) { stats.corrections++; stats.maxCorrection = Math.max(stats.maxCorrection, d); }
      }
      if (e._err) {
        const k = Math.exp(-(wall - e._errAt) / ERR_MS * 3);
        if (k < 0.01) e._err = null;
        else { x += e._err[0] * k; y += e._err[1] * k; z += e._err[2] * k; }
      }
      e.node.position.set(x, y, z);
      e.node.rotation.set(s[3], s[4], s[5]);
      e.vx = s[6]; e.vy = s[7]; e.vz = s[8];
    }
    for (const pr of peers.values()) {
      const a = pr.avatar, t = pr.trk;
      if (!a || !a.alive || !t) continue;
      const s = t.sample(now);
      if (s) { a.node.position.set(s[0], s[1], s[2]); a.node.rotation.y = s[3]; }
      // Gone quiet for a long time (their tab was closed without a goodbye): hide them.
      a.visible = wall - pr.seen < 20000;
    }
    if (now - lastFlush >= 33) flush();
  }
  // Hidden jumps: drawn where they were, fading into where they are (only on screen: physics sees the truth).
  let applied = [];
  function beforeRender() {
    if (!visual.size) return;
    const wall = nowMs();
    for (const [e, v] of visual) {
      const k = Math.exp(-(wall - v.t0) / ERR_MS * 3);
      if (k < 0.01 || !e.alive || e.remote) { visual.delete(e); continue; }
      const d = [v.off[0] * k, v.off[1] * k, v.off[2] * k];
      e.node.position.addInPlaceFromFloats(d[0], d[1], d[2]);
      applied.push([e, d]);
    }
  }
  function afterRender() { for (const [e, d] of applied) e.node.position.addInPlaceFromFloats(-d[0], -d[1], -d[2]); applied = []; }
  let observed = null;
  function observe() {
    const w = W();
    if (!w || !w.scene || observed === w.scene) return;
    observed = w.scene;
    w.scene.onBeforeRenderObservable.add(beforeRender);
    w.scene.onAfterRenderObservable.add(afterRender);
  }

  // ------------------------------------------------------------------ the sync registry: modules sync their own state
  // H.sync.state(name, { get, set, rate, owner, where, important }): a module's state (a vehicle's seats and lights,
  //   terrain edits, the water level) sent by its owner (the host unless owner says otherwise) up to `rate` times a
  //   second, only the keys that changed; everyone else gets set(state, changed, from, { at }). where() (optional) says
  //   where it is ([x, y, z]): far players get it less often; important: true sends it first.
  // H.sync.action(name, run): something that must happen once for everyone, decided by the host (explosions, mass
  //   physics, spawning): invoke(data) runs run(data, { authoritative: false }) at once where it was asked (effects),
  //   and run(data, { authoritative: true }) on the host, which tells everyone else (authoritative: false there).
  // docs/engine-modules.md has examples.
  const states = new Map(); // name -> { def, sent, copy, t, full }
  const actions = new Map(); // name -> run
  const hostHandlers = new Set();
  const ownsState = (def) => (typeof def.owner === 'function' ? Boolean(def.owner()) : def.owner === 'everyone' ? true : isHost());
  const json = (v) => { try { return JSON.stringify(v); } catch { return ''; } };
  function syncStates(now) {
    if (!online) return;
    for (const [name, st] of states) {
      const def = st.def;
      if (!ownsState(def) || now - st.t < 1000 / Math.max(0.2, def.rate || 10)) continue;
      st.t = now;
      let snap;
      try { snap = def.get(); } catch (err) { H.report(err, `sync ${name}`); continue; }
      if (!snap || typeof snap !== 'object') continue;
      const full = !st.sent || now - st.full > 10000;
      const d = {};
      let any = false;
      const js = {};
      for (const [k, v] of Object.entries(snap)) { const j = json(v); js[k] = j; if (full || st.sent[k] !== j) { d[k] = v; any = true; } }
      if (!any) continue;
      st.sent = js;
      if (full) st.full = now;
      const data = { n: name, d, f: full ? 1 : 0, at: serverNow() };
      if (typeof def.where === 'function') { try { const p = def.where(); if (p) data.w = [r2(p[0]), r2(p[2] ?? p[1])]; } catch {} }
      if (def.important) data.i = 1;
      send({ t: 'ev', name: '_s', data });
    }
  }
  function onSync(kind, data, from) {
    if (kind === '_s') {
      const st = states.get(data.n);
      if (!st || !data.d || ownsState(st.def)) return;
      st.copy = { ...(data.f ? {} : st.copy), ...data.d };
      try { st.def.set(st.copy, Object.keys(data.d), from, { at: Number.isFinite(data.at) ? data.at : serverNow(), from: from && from.id }); } catch (err) { H.report(err, `sync ${data.n}`); }
      return;
    }
    const run = actions.get(data.n);
    if (!run) return;
    if (kind === '_ar') {
      // Asked of the host: it decides, then tells everyone (the asker already showed the effect).
      if (!isHost()) return;
      try { run(data.d, { authoritative: true, from }); } catch (err) { H.report(err, `sync ${data.n}`); }
      send({ t: 'ev', name: '_a', data: { n: data.n, d: data.d, by: from && from.id } });
    } else if (data.by !== me) {
      try { run(data.d, { authoritative: false, from }); } catch (err) { H.report(err, `sync ${data.n}`); }
    }
  }
  H.sync = {
    state(name, def) {
      if (!def || typeof def.get !== 'function' || typeof def.set !== 'function') throw new Error('H.sync.state(name, { get, set })');
      states.set(String(name), { def, sent: null, copy: {}, t: 0, full: 0 });
      return { remove: () => states.delete(String(name)), resend: () => { const st = states.get(String(name)); if (st) st.sent = null; } };
    },
    action(name, run) {
      const n = String(name);
      actions.set(n, run);
      return (data) => {
        if (!online || isHost()) {
          run(data, { authoritative: true, from: null });
          if (online) send({ t: 'ev', name: '_a', data: { n, d: data, by: me } });
        } else {
          run(data, { authoritative: false, from: null });
          send({ t: 'ev', name: '_ar', data: { n, d: data } });
        }
      };
    },
    /** True if this player simulates the entity (owns it, or nobody does and this is the host; always offline). */
    mine: (e) => !online || !e || !e.sceneId || mine(e.sceneId),
    /** Take over simulating it. { hold: true }: nobody else can take it by bumping into it until release. False if
     *  someone else holds it. */
    claim: (e, o) => claim(e, o),
    release: (e) => release(e),
    /** Who holds it (drives or carries it), or null. */
    holder: (e) => (e && e.sceneId && locks.get(e.sceneId)) || null,
    /** A snapshot buffer for your own synced things (herds, vehicles): push(at, values, from) as they arrive (at: the
     *  shared clock's ms, given to set() as meta.at), sample() each frame. See Track above for the options. */
    track: (o) => new Track(o),
    /** The shared clock, in ms (the server's). */
    now: () => serverNow(),
    /** fn(newHost, oldHost) when the host changes. Returns off(). */
    onHost(fn) { hostHandlers.add(fn); return () => hostHandlers.delete(fn); },
    /** Bytes and messages sent and received, corrections blended, extrapolated frames, since `reset()`. */
    stats: () => ({ ...stats, seconds: (nowMs() - stats.since) / 1000, links: Object.fromEntries([...links].map(([k, l]) => [k, { transit: Math.round(l.transit), jitter: Math.round(l.jit) }])) }),
    resetStats() { Object.assign(stats, STATS0, { since: nowMs() }); },
    get online() { return online; },
    get isHost() { return isHost(); },
    get me() { return me; },
    get host() { return host; },
  };

  // The host-authoritative explosion (H.sync.explode(at, { radius, force, up })): the host throws things, and so takes
  // over simulating what it throws (their new places reach everyone as transforms); what someone else holds (a car they
  // drive) they throw themselves, and everyone's own player is pushed where they are. Damage is the caller's to do
  // (H.physics.explode with force 0 and event: false), so kills are credited right. Every player gets one 'explosion'
  // event (authoritative on the host).
  const explodeAction = H.sync.action('_explode', (d, { authoritative }) => {
    const info = { ...(d.info || {}), damage: d.damage || 0 };
    if (authoritative) { H.physics.explode(d.at, { radius: d.radius, force: d.force, up: d.up, owner: 'host', info }); return; }
    H.physics.announce({ ...info, position: d.at, radius: d.radius, force: d.force, authoritative: false });
    // What I simulate (things I hold, my own script-made things) I push myself; my player too.
    H.physics.explode(d.at, { radius: d.radius, force: d.force, up: d.up, event: false });
    // Kept a moment: if the host leaves before its result reaches me, what I take over still flies (takeOver).
    blasts.push({ at: serverNow(), d });
    while (blasts.length > 8 || (blasts.length && serverNow() - blasts[0].at > 3000)) blasts.shift();
  });
  /** One blast's kick on one thing (the same as H.physics.explode gives it). */
  function blastOne(e, d) {
    const dx = e.x - d.at[0], dy = e.y - d.at[1], dz = e.z - d.at[2];
    const k = Math.max(0, 1 - Math.hypot(dx, dy, dz) / (d.radius || 4.5));
    if (!k) return;
    const up = d.up ?? 0.6, l = Math.hypot(dx, dy + up, dz) || 1, f = d.force ?? 14;
    e.velocity = [e.vx + (dx / l) * f * k, e.vy + ((dy + up) / l) * f * 0.7 * k, e.vz + (dz / l) * f * k];
  }
  /** o: { radius, force, up, damage (for the event: do the damage yourself), info (more fields for the event) }. */
  H.sync.explode = (at, o = {}) => explodeAction({ at: Array.isArray(at) ? at.slice(0, 3) : [at.x, at.y, at.z], radius: Number(o.radius) || 4.5, force: o.force ?? 14, up: o.up ?? 0.6, damage: Number(o.damage) || 0, info: o.info || null });

  H.hooks.step.push(step);
  H.hooks.frame.push(frame);
  // Bumping into or blasting something someone else simulates: take it over (unless they hold it).
  H.hooks.push.push((o) => claim(o));
  H.hooks.world.push({
    enter() {
      for (const pr of peers.values()) pr.avatar = null;
      for (const pr of peers.values()) makeAvatar(pr);
      sent.clear(); visual.clear();
      observe();
      flags();
    },
    leave() { for (const pr of peers.values()) pr.avatar = null; visual.clear(); },
    ops() { sent.clear(); flags(); },
    reset(e) { if (online && e.sceneId && !mine(e.sceneId)) return; },
  });
  H.hooks.net = {
    send(name, data, self) { send({ t: 'ev', name, data, self: Boolean(self) }); },
    /** The host put the world back (reset, rewind): the room forgets the poses it kept. */
    clear() { if (online && isHost()) send({ t: 'clear' }); },
    get online() { return online; },
    get isHost() { return isHost(); },
    get me() { return me ? { id: me, name: H.hooks.myName, color: H.hooks.myColor } : null; },
    players() { return [...peers.entries()].map(([id, p]) => ({ id, name: p.name, color: p.color, entity: p.avatar && p.avatar.alive ? p.avatar : null })); },
  };
  window.HawkesNet = { connect, claim, release, mine: (e) => !e.sceneId || mine(e.sceneId), get online() { return online; }, get me() { return me; }, get host() { return host; }, peers: () => peers, ownerOf, holder: (id) => locks.get(id) || null, flush,
    /** How this page is connected: 'hawkesnet' (and on what: p2p or relay) or 'site' (/v1/ws). */
    get via() { return hn ? { kind: 'hawkesnet', transport: hn.transport, room: hn.room, stats: hn.stats() } : { kind: ws ? 'site' : 'none' }; } };
})();
