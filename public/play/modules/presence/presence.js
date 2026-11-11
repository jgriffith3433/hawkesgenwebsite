// Presence: you see who's here. Name tags over players (friends marked), AI friends, named NPCs and pets; speech
// bubbles from game chat and from what anything says (e.say); emotes on everyone's avatar; your look (a block avatar
// you dress up, or a model by asset id) on your player in every game, synced to the room; spectating other players.
// presence-core.js is the logic, presence-ui.js the player's side (chat, emote wheel, who's here, customize).
// API: H.presence (game.presence in scripts). Docs: docs/world/57-presence.md, docs/api/57-presence.md.
/* global HawkesPlay, BABYLON, HawkesNet */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = BABYLON;
  const P = (H.presence = H.presence || {});
  const C = P.core;
  const W = () => H.world;
  // Game time (ms): bubbles, reactions and caches follow the world (and the engine tests can step it).
  const now = () => { const w = W(); return w && Number.isFinite(w.time) ? w.time * 1000 : performance.now(); };

  // ------------------------------------------------------------------ settings: config.presence in scene.json
  // false turns it all off; otherwise { tags, size, max, distance, npcDistance, colors: { player, friend, ai, npc, pet, me },
  // occlude: false | 'dim' | 'hide', self, bubbles, chat, emotes, looks, list, spectate, npcs, customize }.
  function cfg() {
    const w = W();
    const c = w && w.config ? w.config.presence : undefined;
    if (c === false) return { off: true };
    return c && typeof c === 'object' ? c : {};
  }
  const on = (k, d = true) => { const c = cfg(); return !c.off && (c[k] === undefined ? d : c[k] !== false); };
  P.enabled = on;
  /** True when the world turned presence off (config.presence: false). */
  P.off = () => Boolean(cfg().off);

  // ------------------------------------------------------------------ events (for presence-ui.js and scripts)
  const listeners = new Map();
  P.on = (name, fn) => { const l = listeners.get(name) || []; l.push(fn); listeners.set(name, l); return () => listeners.set(name, (listeners.get(name) || []).filter((f) => f !== fn)); };
  const emit = (name, data) => { for (const f of listeners.get(name) || []) try { f(data); } catch (err) { H.report(err, 'presence'); } };
  P._emit = emit;

  // ------------------------------------------------------------------ me: who I am on the platform, and my look
  const me = { user: null, name: null, badge: null, friends: new Set(), look: null, signedIn: false, typing: false, loaded: false };
  P.me = me;
  const token = () => (H.bundle && H.bundle.net && H.bundle.net.token) || null;
  const store = { get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
  let guestSeed = 0;
  function guestLook() {
    const kept = store.get('hg_presence_look');
    if (kept) return C.cleanLook(kept);
    if (!guestSeed) { guestSeed = (Math.random() * 2 ** 32) >>> 0; }
    const look = C.randomLook(guestSeed);
    store.set('hg_presence_look', look);
    return look;
  }
  /** Calls one of the platform's presence routes (src/presence.ts): the room token when there is one (the game is
   *  sandboxed: no cookies), else the site's own sign-in (same origin). text/plain: no CORS preflight. */
  async function api(route, body) {
    if (typeof fetch !== 'function' || !/^https?:$/.test(location.protocol) || /node/i.test(navigator.userAgent || '')) throw new Error('offline');
    const t = token();
    const get = body === undefined;
    const r = await fetch(get ? `${route}${t ? `?t=${encodeURIComponent(t)}` : ''}` : route, {
      method: get ? 'GET' : 'POST', credentials: t ? 'omit' : 'include',
      headers: get ? {} : { 'Content-Type': 'text/plain' }, body: get ? undefined : JSON.stringify({ ...body, ...(t ? { t } : {}) }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || `HTTP ${r.status}`); e.status = r.status; throw e; }
    return j;
  }
  P._api = api;
  let loading = null;
  function loadMe() {
    if (loading) return loading;
    me.look = me.look || guestLook();
    loading = api('/v1/users/me/avatar?soft=1').then((j) => {
      me.user = j.user ? j.user.id : null; me.name = j.user ? j.user.name : null; me.badge = j.badge || null; me.signedIn = Boolean(me.user);
      me.friends = new Set(j.friends || []);
      // First time signed in: the look they had as a guest becomes theirs.
      if (j.avatar) me.look = C.cleanLook(j.avatar); else if (me.signedIn) saveLook(me.look);
    }).catch(() => {}).then(() => { me.loaded = true; emit('me', me); resend(); });
    return loading;
  }
  let saveTimer = null;
  function saveLook(look) {
    store.set('hg_presence_look', look);
    if (!me.signedIn) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { api('/v1/users/me/avatar', { avatar: look }).catch((e) => H.report(new Error(`Your look wasn't saved: ${e.message}`), 'presence')); }, 600);
  }
  /** Changes my look (any part of it): shown at once, saved to my account (or this browser), sent to the room. */
  P.setLook = (part) => { me.look = C.cleanLook({ ...(me.look || {}), ...(part || {}) }); saveLook(me.look); resend(); peopleAt = -Infinity; emit('look', me.look); return me.look; };
  P.randomLook = () => P.setLook(C.randomLook());
  Object.defineProperty(P, 'look', { get: () => me.look, set: (v) => P.setLook(v), configurable: true });

  // ------------------------------------------------------------------ the room: everyone's presence, synced
  // Each player sends their own state (H.sync.state 'presence:<conn>', owned by that player): look, typing, health,
  // host, badge (a signed "this is me" that /v1/presence/who turns into a platform user), spectating.
  const peerInfo = new Map(); // conn -> { look, ty, hp, mx, host, b, sp }
  const synced = new Map(); // conn -> handle
  const hasNet = () => Boolean(H.sync && window.HawkesNet);
  const myConn = () => (H.sync && H.sync.online ? H.sync.me : null);
  function mine() {
    const p = W() && W().player;
    return {
      look: me.look, ty: me.typing ? 1 : 0, hp: p && p.alive ? Math.round(p.health ?? 100) : null, mx: p && p.alive ? (p.maxHealth || 100) : null,
      host: H.sync && H.sync.isHost ? 1 : 0, b: me.badge, sp: floatCam ? 2 : spect ? 1 : 0,
    };
  }
  function resend() { const c = myConn(); const h = c && synced.get(c); if (h) h.resend(); }
  function ensureSync(conn) {
    if (!conn || synced.has(conn) || !H.sync) return;
    const h = H.sync.state(`presence:${conn}`, {
      rate: 6,
      owner: () => H.sync.me === conn,
      get: () => (H.sync.me === conn ? mine() : null),
      set: (s) => { const before = peerInfo.get(conn); peerInfo.set(conn, { ...s }); if (s.b && s.b !== (before && before.b)) askWho(s.b); },
    });
    synced.set(conn, h);
  }
  function syncTick() {
    if (!hasNet()) return;
    const live = new Set();
    const mc = myConn();
    if (mc) { ensureSync(mc); live.add(mc); }
    for (const id of HawkesNet.peers().keys()) { ensureSync(id); live.add(id); }
    for (const [id, h] of synced) if (!live.has(id)) { h.remove(); synced.delete(id); peerInfo.delete(id); }
  }

  // Badges become people: who they are on the platform and whether they're my friend.
  const verified = new Map(); // badge -> { user, name, friend } | false
  let whoQueue = new Set();
  let whoTimer = null;
  function askWho(badge) {
    if (verified.has(badge)) return;
    whoQueue.add(badge);
    if (whoTimer) return;
    whoTimer = setTimeout(() => {
      const list = [...whoQueue].slice(0, 40);
      whoQueue = new Set([...whoQueue].slice(40));
      whoTimer = null;
      api('/v1/presence/who', { badges: list }).then((j) => {
        for (const b of list) verified.set(b, false);
        for (const w of j.who || []) verified.set(list[w.i], { user: w.user, name: w.name, friend: Boolean(w.friend) });
        emit('people', null);
      }).catch(() => { for (const b of list) verified.set(b, false); });
    }, 300);
  }
  /** Asks to be friends with a player in the room (both asking makes it so). */
  P.addFriend = async (who) => {
    const pr = typeof who === 'string' ? person(who.startsWith('p:') ? who : `p:${who}`) : who;
    const v = pr && pr.conn && verifiedOf(pr.conn);
    if (!v) throw new Error('Only players signed in to Hawkes Games can be friends');
    if (!me.signedIn) throw new Error('Sign in to make friends');
    const r = await api('/v1/friends/request', { to: v.user });
    if (r.status === 'friends') { me.friends.add(v.user); v.friend = true; }
    else v.requested = true;
    emit('people', null);
    return r.status;
  };
  const verifiedOf = (conn) => { const i = peerInfo.get(conn); const v = i && i.b ? verified.get(i.b) : null; return v || null; };

  // ------------------------------------------------------------------ people: everything that gets a tag
  // { key, kind: me | player | friend | ai | npc | pet | thing, entity, name, color, conn, host, typing, hp, mx, user }
  let peopleCache = [];
  let peopleAt = 0;
  const muted = new Set(store.get('hg_presence_muted') || []);
  const ids = new WeakMap();
  let nextId = 1;
  const keyOf = (e) => { let k = ids.get(e); if (!k) { k = `e:${e.sceneId || nextId++}`; ids.set(e, k); } return k; };
  function hostConn() {
    if (!hasNet()) return null;
    if (H.sync.online && H.sync.isHost) return H.sync.me;
    for (const [c, i] of peerInfo) if (i.host) return c;
    return null;
  }
  function collect() {
    const w = W();
    const out = [];
    if (!w) return out;
    const host = hostConn();
    const p = w.player;
    if (p && p.alive) out.push({ key: 'me', kind: 'me', entity: p, name: shown((me.look && me.look.name) || nameOf(H.hooks.myName, me.signedIn ? me.name : null), 'me') || 'You', color: H.hooks.myColor || '#4a9eff', conn: myConn(), host: Boolean(host && host === myConn()), typing: me.typing, hp: p.health, mx: p.maxHealth || 100, user: me.user, look: me.look });
    if (hasNet()) {
      for (const [id, pr] of HawkesNet.peers()) {
        const i = peerInfo.get(id) || {};
        const v = i.b ? verified.get(i.b) : null;
        const friend = Boolean(v && (v.friend || me.friends.has(v.user)));
        if (pr.avatar && pr.avatar.alive) for (const c of pr.avatar.node.getChildMeshes(true)) if (c.name === 'text') c.setEnabled(!on('tags'));
        const theirs = i.look ? C.cleanLook(i.look) : null;
        out.push({ key: `p:${id}`, kind: friend ? 'friend' : 'player', entity: pr.avatar && pr.avatar.alive ? pr.avatar : null, name: shown((theirs && theirs.name) || nameOf(pr.name, v ? v.name : null), id) || 'Player', color: pr.color, conn: id, host: Boolean(host && host === id), typing: Boolean(i.ty), hp: i.hp, mx: i.mx, user: v ? v.user : null, verified: Boolean(v), requested: Boolean(v && v.requested), look: i.look ? C.cleanLook(i.look) : null, spectating: Boolean(i.sp), floating: i.sp === 2, state: pr.state });
      }
    }
    if (on('npcs')) {
      for (const e of w.entities) {
        if (!e.alive || e.isPlayer || e.remotePlayer) continue;
        let kind = null, name = null, color = null, look = null;
        if (e._prTag) { kind = e._prTag.kind || 'thing'; name = e._prTag.text; color = e._prTag.color || null; }
        else if (e.data && e.data.nametag === false) continue;
        else if (e.kind === 'friend' && e.living && e.living.friend) { kind = 'ai'; name = e.living.friend.name; look = e.living.friend.look ? C.cleanLook(e.living.friend.look) : null; if (e.living.friend.tag) e.living.friend.tag.setEnabled(!on('tags')); }
        else if (e.living && e.living.temper === 'pet' && (e.name || e.living.follow)) { kind = 'pet'; name = e.name || cap(e.living.name); }
        else if (e.name && (e.living || e.tag === 'npc' || (e.data && (e.data.npc || e.data.nametag)))) { kind = 'npc'; name = e.data && typeof e.data.nametag === 'string' ? e.data.nametag : e.name; }
        if (!kind || !name) continue;
        out.push({ key: keyOf(e), kind, entity: e, name: String(name).slice(0, 40), color, look, hp: e.hp, mx: e.maxHp });
      }
    }
    return out;
  }
  /** A player's name as everyone sees it: the cleaned name, or "Player 1234" for an empty, odd or abusive one (core.filterName). */
  const shown = (name, seed) => (name ? C.filterName(name, seed).name : name);
  const cap = (s) => (s ? String(s)[0].toUpperCase() + String(s).slice(1) : s);
  /** The name a player goes by: the room's ("Player 2" when they didn't give one), or their platform name once known. */
  const nameOf = (room, platform) => (platform && (!room || /^Player \d+$/.test(room)) ? String(platform).slice(0, 24) : room);
  function people(fresh) { if (fresh || now() - peopleAt > 200) { peopleCache = collect(); peopleAt = now(); } return peopleCache; }
  function person(key) { return people().find((x) => x.key === key) || null; }
  P.person = person;
  /** Everyone playing (me first, then friends, then the rest): { id, name, friend, host, typing, user, muted, entity }. */
  P.players = () => people(true).filter((x) => x.kind === 'me' || x.kind === 'player' || x.kind === 'friend')
    .map((x) => ({ id: x.conn || 'me', key: x.key, me: x.kind === 'me', name: x.name, color: x.color, friend: x.kind === 'friend', host: x.host, typing: x.typing, user: x.user, verified: x.kind === 'me' ? me.signedIn : x.verified, requested: x.requested, muted: muted.has(x.key) || (x.user && muted.has(x.user)), spectating: x.spectating, entity: x.entity }))
    .sort((a, b) => (a.me ? -1 : b.me ? 1 : (b.friend - a.friend) || String(a.name).localeCompare(String(b.name))));
  /** Mutes (or unmutes) a player: their chat and bubbles stop showing for you. Remembered by account when known. */
  P.mute = (id, yes = true) => {
    const pr = person(String(id).startsWith('p:') ? id : `p:${id}`);
    const keys = pr ? [pr.key, pr.user].filter(Boolean) : [String(id)];
    for (const k of keys) if (yes) muted.add(k); else muted.delete(k);
    store.set('hg_presence_muted', [...muted].filter((k) => !k.startsWith('p:')));
    if (yes && pr) bub.clear(pr.key);
    emit('people', null);
  };
  const isMuted = (pr) => Boolean(pr && (muted.has(pr.key) || (pr.user && muted.has(pr.user))));
  P.muted = (id) => isMuted(person(String(id).startsWith('p:') ? id : `p:${id}`));
  /** A name tag on anything: P.tag(thing, 'Shopkeeper', { color: '#22c55e', kind: 'npc' }); P.tag(thing, null) removes it. */
  P.tag = (e, text, o = {}) => { if (!e || !e.__entity) return; e._prTag = text ? { text: String(text).slice(0, 40), color: o.color || null, kind: o.kind || 'thing' } : null; peopleAt = -Infinity; };

  // ------------------------------------------------------------------ the block avatar: a body you dress, emotes on it
  const mats = { scene: null, map: new Map() };
  function mat(hex, glow) {
    const w = W();
    if (mats.scene !== w.scene) { mats.scene = w.scene; mats.map.clear(); }
    const k = `${hex}${glow ? '!' : ''}`;
    let m = mats.map.get(k);
    if (!m) {
      m = new B.StandardMaterial(`pr${k}`, w.scene);
      const c = B.Color3.FromHexString(hex);
      m.diffuseColor = c; m.specularColor = new B.Color3(0.08, 0.08, 0.08);
      if (glow) { m.emissiveColor = c; m.disableLighting = true; }
      mats.map.set(k, m);
    }
    return m;
  }
  const rigs = new Map(); // entity -> rig
  function part(rig, name, make, parent, pos, color, glow) {
    const m = make(rig.scene);
    m.name = `pr-${name}`;
    m.parent = parent; m.position.set(pos[0], pos[1], pos[2]);
    m.material = mat(color, glow); m.isPickable = false; m.metadata = { decor: true, entity: rig.e };
    if (rig.shadows) try { rig.shadows.addShadowCaster(m); } catch {}
    rig.meshes.push(m);
    return m;
  }
  if (P.bodies) P.bodies._part = part;
  // Body parts are soft boxes (Living things' rounded shape), small details stay crisp boxes.
  const box = (w, h, d) => (s) => (Math.min(w, h, d) >= 0.07 && H.living && H.living.body && H.living.body.softBox
    ? H.living.body.softBox('b', { width: w, height: h, depth: d }, s)
    : B.MeshBuilder.CreateBox('b', { width: w, height: h, depth: d }, s));
  // What a body wears is built at a detail (WQ): 0.75 near, 0.4 for the level past H.budget.farCharacter (dress, below).
  let WQ = 0.75 * (P.nearDetail ? P.nearDetail() : 1);
  const tess = (n) => Math.max(Math.min(n, 5), Math.round(n * WQ));
  const cyl = (top, bottom, h, n = 14) => (s) => B.MeshBuilder.CreateCylinder('c', { diameterTop: top, diameterBottom: bottom, height: h, tessellation: tess(n) }, s);
  const ball = (d, n = 10) => (s) => B.MeshBuilder.CreateSphere('s', { diameter: d, segments: tess(n) }, s);
  const ring = (d, t) => (s) => B.MeshBuilder.CreateTorus('t', { diameter: d, thickness: t, tessellation: tess(18) }, s);
  function makeRig(e, look, color, opts = {}) {
    const w = W();
    const scene = w.scene;
    const rig = { e, scene, look, meshes: [], lookKey: JSON.stringify(look) + color, emote: null, phase: 0, last: null, speed: 0, model: null, mood: C.mood(), noModel: opts.model === false };
    const root = new B.TransformNode('pr-rig', scene);
    root.parent = e.node;
    rig.root = root;
    const pose = new B.TransformNode('pr-pose', scene); // emotes move this; root holds the shape
    pose.parent = root;
    rig.pose = pose;
    const s0 = C.LOOK.sizes[look.shape] || C.LOOK.sizes.normal, k = Number(look.bodySize) > 0 ? Number(look.bodySize) : 1;
    const s = [s0[0] * k, s0[1] * k, s0[2] * k];
    root.scaling.set(s[0], s[1], s[2]);
    root.position.y = -0.9 * (1 - s[1]); // feet stay on the ground
    rig.baseY = root.position.y;
    const body = look.body || color, head = look.head, acc = look.accent;
    const joint = (name, at) => { const t = new B.TransformNode(`pr-${name}`, scene); t.parent = pose; t.position.set(at[0], at[1], at[2]); return t; };
    // What you are (presence-bodies.js): an animal, a robot, a shoe... built and sized there; the person is built here.
    rig.what = look.what || 'person';
    const what = C.WHAT && C.WHAT.get(rig.what);
    if (what && what.body !== 'person' && P.bodies && P.bodies.build(rig, what, look, shade)) {
      for (const [n, at] of [['hipL', [0.11, -0.36, 0]], ['hipR', [-0.11, -0.36, 0]], ['shL', [0.31, 0.24, 0]], ['shR', [-0.31, 0.24, 0]]]) if (!rig[n]) rig[n] = joint(n, at);
      rig.bodyMeshes = rig.meshes.length; rig.dressArgs = [look, acc, body];
      dress(rig, look, acc, body);
      if (look.model) loadModel(rig, look.model);
      if (P.models) P.models.attach(rig); // (a Gen model for this type, when the registry has one: presence-models.js)
      return rig;
    }
    rig.what = 'person';
    // The soft toy person (presence-person.js): a rounded body, a big head with a face, hair, clothes in the look's colors.
    P.softPerson.build(rig, look, { joint, part, box });
    // A bigger or smaller head (look.headSize): its neck joint, so the face, hair, hats and glasses all follow.
    if (rig.neck && Number(look.headSize) > 0 && Number(look.headSize) !== 1) rig.neck.scaling.scaleInPlace(Number(look.headSize));
    rig.bodyMeshes = rig.meshes.length; rig.dressArgs = [look, acc, body];
    dress(rig, look, acc, body);
    if (look.model) loadModel(rig, look.model);
    if (P.models) P.models.attach(rig);
    return rig;
  }
  /** Puts a rig's hat, extras and accessory on again, after its anchors moved (a Gen model took the body: presence-models.js). */
  P._redress = (rig) => {
    if (!rig.dressArgs) return;
    if (P.hats) P.hats.clear(rig);
    for (const m of rig.meshes.splice(rig.bodyMeshes)) try { m.dispose(); } catch {}
    rig.cape = rig.tail = rig.wings = null;
    dress(rig, ...rig.dressArgs);
  };
  /** The hat, extras and accessory. What a body wears is still: its parts are joined into one mesh per joint and color
   *  (H.mergeParts); the cape, wings and tail swing, so they stay as they are. Built twice, the second at less than half the
   *  tessellation, and joined the same way: each far mesh is the near one's level of detail past H.budget.farCharacter (the
   *  same shapes to within a pixel at that distance, so no pop). */
  function dress(rig, look, acc, body) {
    // A Gen hat (presence-hats.js) takes the procedural hat's place once it has loaded; until then, or if it fails, the procedural one is drawn.
    const modelHat = !!(look.hat && look.hat !== 'none' && P.hats && P.hats.put(rig, look.hat, acc, body));
    if ((!look.hat || look.hat === 'none' || modelHat) && !look.extras.length && (!look.accessory || look.accessory === 'none')) return;
    const wear = () => { if (!modelHat) hat(rig, look.hat, acc, body); for (const x of look.extras) extra(rig, x, acc, body); accessory(rig, look.accessory, look.accessoryColor); };
    const join = (from) => {
      const still = rig.meshes.splice(from);
      if (!H.mergeParts) { rig.meshes.push(...still); return still; }
      const moves = new Set([rig.cape, rig.tail, ...(rig.wings || [])].filter(Boolean));
      const out = H.mergeParts(still, { keep: (m) => moves.has(m) });
      for (const m of out) if (!moves.has(m)) m.name = m.name.replace(/-parts$/, ''); // (named for its first part)
      rig.meshes.push(...out);
      return out;
    };
    const from = rig.meshes.length;
    const nearQ = 0.75 * (P.nearDetail ? P.nearDetail() : 1);
    WQ = nearQ;
    wear();
    const near = join(from);
    const fromFar = rig.meshes.length, keep = { cape: rig.cape, tail: rig.tail, wings: rig.wings };
    WQ = Math.min(0.4, nearQ * 0.6);
    try { wear(); } finally { WQ = nearQ; }
    Object.assign(rig, keep);
    const lows = join(fromFar);
    const far = Number(H.budget && H.budget.farCharacter) || 30;
    const byKey = new Map();
    const swings = new Set([keep.cape, keep.tail, ...(keep.wings || [])].filter(Boolean));
    for (const m of near) if (!swings.has(m) && m.getClassName() === 'Mesh' && m.material && !m.getLODLevels().length) byKey.set(`${m.parent && m.parent.uniqueId}|${m.material.uniqueId}`, m);
    for (const m of lows) {
      const hi = m.getClassName() === 'Mesh' && m.material ? byKey.get(`${m.parent && m.parent.uniqueId}|${m.material.uniqueId}`) : null;
      if (hi && m !== hi) { m.isVisible = false; hi.addLODLevel(far, m); byKey.delete(`${m.parent && m.parent.uniqueId}|${m.material.uniqueId}`); }
      else { m.dispose(); rig.meshes.splice(rig.meshes.indexOf(m), 1); }
    }
  }
  /**
   * The mirror's accessory (docs/characters.md 5d): small procedural meshes in the look's accessoryColor on the anchors every
   * body has: head (rig.neck, as a hat), face (rig.neck at faceY/faceZ, as glasses), neck and back (rig.pose, placed as a
   * person's and moved to follow where this body's head is, as the extras are).
   */
  function accessory(rig, kind, color) {
    if (!kind || kind === 'none') return;
    const n = rig.neck, c = color || '#ffffff';
    const mt = rig.mounts, p = mt ? mt.neck : rig.pose, pBack = mt ? mt.back : rig.pose; // (a Gen model: the mounts are under its own nodes)
    const fy = rig.faceY ?? 0.27, fz = rig.faceZ ?? 0.215, y = 0.44;
    const dy = mt ? 0 : n.position.y - 0.29, dz = mt ? 0 : n.position.z;
    const at = (x, yy, z) => [x, yy + dy, z + dz];
    const dark = '#1f2937';
    switch (kind) {
      case 'headphones': {
        part(rig, 'hpBand', ring(0.5, 0.045), n, [0, y - 0.2, 0], c).rotation.x = Math.PI / 2; // (the band over the top)
        part(rig, 'hpCupL', cyl(0.15, 0.15, 0.08, 14), n, [0.235, y - 0.2, 0], c).rotation.z = Math.PI / 2;
        part(rig, 'hpCupR', cyl(0.15, 0.15, 0.08, 14), n, [-0.235, y - 0.2, 0], c).rotation.z = Math.PI / 2;
        part(rig, 'hpPadL', cyl(0.11, 0.11, 0.1, 12), n, [0.235, y - 0.2, 0], dark).rotation.z = Math.PI / 2;
        part(rig, 'hpPadR', cyl(0.11, 0.11, 0.1, 12), n, [-0.235, y - 0.2, 0], dark).rotation.z = Math.PI / 2;
        break;
      }
      case 'goggles': {
        part(rig, 'gStrap', box(0.46, 0.05, 0.03), n, [0, fy + 0.02, fz - 0.02], dark);
        for (const sx of [1, -1]) {
          const r = part(rig, `gRim${sx}`, ring(0.15, 0.035), n, [sx * 0.1, fy, fz], c); r.rotation.x = Math.PI / 2;
          part(rig, `gLens${sx}`, cyl(0.13, 0.13, 0.02, 12), n, [sx * 0.1, fy, fz], '#7dd3fc', true).rotation.x = Math.PI / 2;
        }
        break;
      }
      case 'monocle': {
        const r = part(rig, 'mRim', ring(0.15, 0.025), n, [-0.1, fy, fz], c, true); r.rotation.x = Math.PI / 2;
        part(rig, 'mChain', box(0.012, 0.22, 0.012), n, [-0.17, fy - 0.12, fz - 0.01], c, true);
        break;
      }
      case 'mustache': {
        for (const sx of [1, -1]) { const m = part(rig, `must${sx}`, box(0.12, 0.05, 0.04), n, [sx * 0.06, fy - 0.1, fz + 0.005], c); m.rotation.z = sx * -0.25; }
        break;
      }
      case 'eyepatch': {
        part(rig, 'patch', box(0.13, 0.12, 0.025), n, [0.1, fy, fz], c);
        const s = part(rig, 'patchStrap', box(0.46, 0.025, 0.02), n, [0, fy + 0.07, fz - 0.03], c); s.rotation.z = -0.25;
        break;
      }
      case 'flower': {
        for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; part(rig, `petal${i}`, ball(0.1, 6), n, [0.16 + Math.sin(a) * 0.075, y + 0.0 + Math.cos(a) * 0.075, 0.08], c); }
        part(rig, 'core', ball(0.08, 6), n, [0.16, y, 0.08], '#fde047');
        break;
      }
      case 'antenna': {
        part(rig, 'antStem', cyl(0.025, 0.035, 0.3, 6), n, [0, y + 0.14, 0], dark);
        part(rig, 'antBall', ball(0.1, 8), n, [0, y + 0.32, 0], c, true);
        break;
      }
      case 'medal': {
        part(rig, 'ribbonL', box(0.05, 0.2, 0.02), p, at(0.03, 0.12, 0.17), '#dc2626').rotation.z = 0.35;
        part(rig, 'ribbonR', box(0.05, 0.2, 0.02), p, at(-0.03, 0.12, 0.17), '#2563eb').rotation.z = -0.35;
        const m = part(rig, 'medal', cyl(0.14, 0.14, 0.03, 16), p, at(0, -0.0, 0.2), c, true); m.rotation.x = Math.PI / 2;
        break;
      }
      case 'bell': {
        const m = part(rig, 'collar', ring(0.42, 0.04), p, at(0, 0.27, 0), '#dc2626'); m.scaling.z = 0.75;
        part(rig, 'bell', ball(0.11, 8), p, at(0, 0.2, 0.17), c, true);
        break;
      }
      case 'jetpack': {
        for (const sx of [1, -1]) {
          part(rig, `tank${sx}`, cyl(0.14, 0.14, 0.4, 10), pBack, at(sx * 0.11, 0.0, -0.24), c);
          part(rig, `nozzle${sx}`, cyl(0.1, 0.13, 0.06, 10), pBack, at(sx * 0.11, -0.22, -0.24), dark);
          part(rig, `flame${sx}`, cyl(0.1, 0, 0.14, 8), pBack, at(sx * 0.11, -0.32, -0.24), '#fb923c', true);
        }
        break;
      }
      case 'bandana': {
        const m = part(rig, 'bandana', ring(0.44, 0.09), p, at(0, 0.27, 0), c); m.scaling.z = 0.75;
        const t = part(rig, 'bandanaTip', cyl(0.18, 0, 0.16, 3), p, at(0, 0.17, 0.17), c); t.rotation.x = Math.PI;
        break;
      }
      case 'earrings': {
        for (const sx of [1, -1]) part(rig, `ear${sx}`, ball(0.07, 8), n, [sx * 0.235, y - 0.28, 0], c, true);
        break;
      }
      default: break;
    }
  }
  function hat(rig, kind, acc, body) {
    const t = rig.neck, y = 0.44;
    switch (kind) {
      case 'cap': part(rig, 'cap', cyl(0.44, 0.44, 0.12), t, [0, y + 0.05, 0], acc); part(rig, 'brim', box(0.4, 0.03, 0.2), t, [0, y + 0.0, 0.25], acc); break;
      case 'beanie': part(rig, 'beanie', (s) => B.MeshBuilder.CreateSphere('s', { diameter: 0.48, segments: tess(10), slice: 0.5 }, s), t, [0, y - 0.04, 0], acc); part(rig, 'pom', ball(0.12), t, [0, y + 0.2, 0], '#ffffff'); break;
      case 'tophat': part(rig, 'brim', cyl(0.56, 0.56, 0.03), t, [0, y + 0.01, 0], '#111827'); part(rig, 'top', cyl(0.32, 0.32, 0.36), t, [0, y + 0.19, 0], '#111827'); part(rig, 'band', cyl(0.33, 0.33, 0.06), t, [0, y + 0.06, 0], acc); break;
      case 'crown': part(rig, 'crown', cyl(0.42, 0.38, 0.16, 8), t, [0, y + 0.07, 0], '#facc15', true); for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; part(rig, `pt${i}`, cyl(0, 0.08, 0.12, 4), t, [Math.sin(a) * 0.19, y + 0.2, Math.cos(a) * 0.19], '#facc15', true); } break;
      case 'cowboy': part(rig, 'brim', cyl(0.78, 0.78, 0.03), t, [0, y + 0.01, 0], '#92400e'); part(rig, 'top', cyl(0.3, 0.38, 0.22), t, [0, y + 0.12, 0], '#92400e'); break;
      case 'party': { const m = part(rig, 'party', cyl(0, 0.3, 0.42, 12), t, [0.04, y + 0.18, 0], acc); m.rotation.z = -0.15; part(rig, 'tip', ball(0.08), t, [0.07, y + 0.4, 0], '#ffffff'); break; }
      case 'halo': { const m = part(rig, 'halo', ring(0.42, 0.05), t, [0, y + 0.22, 0], '#fde047', true); m.rotation.x = 0.1; break; }
      case 'horns': { const a = part(rig, 'hornL', cyl(0, 0.1, 0.24, 8), t, [0.15, y + 0.06, 0], '#e5e7eb'); a.rotation.z = -0.5; const b = part(rig, 'hornR', cyl(0, 0.1, 0.24, 8), t, [-0.15, y + 0.06, 0], '#e5e7eb'); b.rotation.z = 0.5; break; }
      case 'bunny': { const a = part(rig, 'earL', box(0.09, 0.36, 0.05), t, [0.1, y + 0.17, 0], '#ffffff'); a.rotation.z = -0.12; const b = part(rig, 'earR', box(0.09, 0.36, 0.05), t, [-0.1, y + 0.17, 0], '#ffffff'); b.rotation.z = 0.12; break; }
      case 'helmet': { const m = part(rig, 'helmet', (s) => B.MeshBuilder.CreateSphere('s', { diameter: 0.56, segments: tess(12), slice: 0.55 }, s), t, [0, y - 0.1, 0], acc === '#ffffff' ? body : acc); m.scaling.y = 1.05; break; }
      case 'chef': part(rig, 'band', cyl(0.4, 0.4, 0.14), t, [0, y + 0.06, 0], '#ffffff'); part(rig, 'puff', ball(0.5), t, [0, y + 0.28, 0], '#ffffff'); break;
      default: break;
    }
  }
  function extra(rig, kind, acc, body) {
    const mt = rig.mounts, p = mt ? mt.neck : rig.pose, pBack = mt ? mt.back : rig.pose, pRump = mt ? mt.rump : rig.pose, n = rig.neck;
    // On the face (glasses): where this body's face is (presence-bodies.js), a person's otherwise. On the body: placed
    // as on a person, moved to follow where this body's head is.
    const fy = rig.faceY ?? 0.27, fz = rig.faceZ ?? 0.215;
    const dy = mt ? 0 : n.position.y - 0.29, dz = mt ? 0 : n.position.z;
    const at = (x, y, z) => [x, y + dy, z + dz];
    switch (kind) {
      case 'glasses': part(rig, 'lensL', box(0.13, 0.1, 0.02), n, [0.1, fy, fz], '#1f2937'); part(rig, 'lensR', box(0.13, 0.1, 0.02), n, [-0.1, fy, fz], '#1f2937'); part(rig, 'bridge', box(0.08, 0.025, 0.02), n, [0, fy + 0.02, fz], '#1f2937'); break;
      case 'shades': part(rig, 'shades', box(0.4, 0.1, 0.03), n, [0, fy, fz], '#020617'); break;
      case 'scarf': { const m = part(rig, 'scarf', ring(0.44, 0.1), p, at(0, 0.28, 0), acc); m.scaling.z = 0.75; part(rig, 'tailS', box(0.1, 0.3, 0.05), p, at(0.12, 0.12, 0.17), acc); break; }
      case 'backpack': part(rig, 'pack', box(0.38, 0.44, 0.18), pBack, at(0, 0.0, -0.24), acc === '#ffffff' ? '#7c2d12' : acc); break;
      case 'cape': {
        // A person's cape is 0.78 tall in head units; a Gen model's head is the size of its whole body (a toaster, a banana), so the
        // same cape would hang as a red slab below its feet. Cut it to the drop from the neck to the ground.
        let len = 0.78;
        if (mt && rig.pm && rig.pm.on) {
          try {
            for (const n of [rig.pose, p]) n.computeWorldMatrix(true);
            const ms = p.absoluteScaling.y / (rig.pose.absoluteScaling.y || 1); // (mount units in the pose's meters)
            const top = B.Vector3.TransformCoordinates(p.getAbsolutePosition(), B.Matrix.Invert(rig.pose.getWorldMatrix())).y + 0.28 * ms; // (the neck anchor)
            const drop = (top + 0.9) / ms; // (the feet are 0.9 below the pose's middle)
            if (Number.isFinite(drop) && drop > 0) len = Math.max(0.08, Math.min(0.78, drop * 0.8));
          } catch {}
        }
        const m = part(rig, 'cape', box(0.5 * (len / 0.78), len, 0.03), p, at(0, 0.29 - len / 2, -0.18), acc === '#ffffff' ? '#dc2626' : acc);
        m.rotation.x = 0.12; rig.cape = m; break;
      }
      case 'bowtie': part(rig, 'bowL', box(0.09, 0.08, 0.03), p, at(0.05, 0.24, 0.16), acc === '#ffffff' ? '#dc2626' : acc); part(rig, 'bowR', box(0.09, 0.08, 0.03), p, at(-0.05, 0.24, 0.16), acc === '#ffffff' ? '#dc2626' : acc); break;
      case 'wings': { const a = part(rig, 'wingL', box(0.42, 0.5, 0.03), pBack, at(0.24, 0.08, -0.2), '#f8fafc'); a.rotation.y = 0.5; const b = part(rig, 'wingR', box(0.42, 0.5, 0.03), pBack, at(-0.24, 0.08, -0.2), '#f8fafc'); b.rotation.y = -0.5; rig.wings = [a, b]; break; }
      case 'tail': { const m = part(rig, 'tail', cyl(0.04, 0.1, 0.5, 8), pRump, at(0, -0.3, -0.3), body); m.rotation.x = -0.9; rig.tail = m; break; }
      default: break;
    }
  }
  function shade(hex, k) {
    const c = B.Color3.FromHexString(hex);
    const f = (v) => Math.max(0, Math.min(1, k < 0 ? v * (1 + k) : v + (1 - v) * k));
    return new B.Color3(f(c.r), f(c.g), f(c.b)).toHexString().toLowerCase();
  }
  // A model avatar by asset id (a community model's file): the block body hides once it has loaded; emotes play the
  // model's animation with that name (wave, dance...) when it has one.
  P.modelUrl = (id) => `/v1/community/${encodeURIComponent(id)}/file`;
  function loadModel(rig, id) {
    if (!B.SceneLoader || !B.SceneLoader.ImportMeshAsync || /node/i.test(navigator.userAgent || '')) return;
    B.SceneLoader.ImportMeshAsync('', P.modelUrl(id), '', rig.scene, null, '.glb').then((r) => {
      if (!rig.root || rig.root.isDisposed()) { r.meshes.forEach((m) => m.dispose()); return; }
      const top = r.meshes[0];
      top.parent = rig.root;
      const { min, max } = top.getHierarchyBoundingVectors(true);
      const h = Math.max(0.01, max.y - min.y);
      const k = 1.8 / h;
      top.scaling.scaleInPlace(k);
      top.position.y = -0.9 - min.y * k;
      for (const m of r.meshes) { m.isPickable = false; m.metadata = { decor: true, entity: rig.e }; }
      for (const m of rig.meshes) m.setEnabled(false);
      if (rig.body) rig.body.setEnabled(false);
      rig.model = { meshes: r.meshes, groups: r.animationGroups || [] };
      const idle = rig.model.groups.find((g) => /idle/i.test(g.name));
      if (idle) idle.start(true);
    }).catch(() => {});
  }
  function disposeRig(rig) {
    if (P.hats) P.hats.clear(rig);
    if (P.models) P.models.dispose(rig);
    if (rig.model) for (const m of rig.model.meshes) try { m.dispose(); } catch {}
    for (const m of rig.meshes) try { m.dispose(); } catch {}
    try { rig.root.dispose(); } catch {}
    rig.root = null;
  }
  /** The look an entity shows: mine on my player, theirs on other players' avatars. */
  function rigFor(e, look, color) {
    let rig = rigs.get(e);
    const key = JSON.stringify(look) + color;
    if (rig && rig.lookKey !== key) { const em = rig.emote; disposeRig(rig); rig = null; rigs.delete(e); if (em) rigSoon.set(e, em); }
    if (!rig) {
      rig = makeRig(e, look, color);
      rigs.set(e, rig);
      const em = rigSoon.get(e); if (em) { rig.emote = em; rigSoon.delete(e); }
      for (const c of e.node.getChildMeshes(true)) if (c.name === 'visor' || (c.name === 'text' && on('tags'))) c.setEnabled(false);
      if (e === (W() && W().player) && e._visor) e._visor.setEnabled(false);
    }
    return rig;
  }
  // ------------------------------------------------------------------ a crowd (docs/characters.md "A crowd")
  // Which bodies animate in full: those within H.budget.farCharacter meters, in front of the camera, nearest first, at most
  // H.budget.characters (mine counts). The rest take the cheap level (rig.lod 1): the stride only, no blinking, no gaze, no
  // springs, updated every 2nd frame (every 6th out of view); past the far distance the meshes also draw their half-detail
  // level (a LOD of the shared source, presence-person.js shared). A body changes level at most every half second and the far
  // distance has a 3 m band, so nothing flickers at the edge.
  const crowd = { bodies: 0, full: 0, simple: 0, far: 0, out: 0, cap: 0, farAt: 0 };
  function crowdLevels(list, dt) {
    const w = W();
    const cam = w && w.scene && w.scene.activeCamera;
    const cap = Math.max(1, Number(H.budget && H.budget.characters) || 10), farAt = Number(H.budget && H.budget.farCharacter) || 30;
    const cp = cam ? cam.globalPosition : null, fw = cam && cam.getForwardRay ? cam.getForwardRay(1).direction : null;
    const now = w ? w.time || 0 : 0;
    for (const x of list) {
      const rig = x.rig;
      let d = 0, front = true;
      if (cp && !x.self) {
        const p = rig.e.node.getAbsolutePosition();
        const dx = p.x - cp.x, dy = p.y - cp.y, dz = p.z - cp.z;
        d = Math.hypot(dx, dy, dz);
        front = !fw || dx * fw.x + dy * fw.y + dz * fw.z > -1.5; // (a body just behind the camera's plane may still show its feet)
      }
      x.d = d; x.front = front;
      rig.far = d > farAt - (rig.far ? 3 : 0);
    }
    const near = list.filter((x) => !x.rig.far && x.front && x.show).sort((a, b) => a.d - b.d);
    const want = new Set(near.slice(0, cap));
    let full = 0, simple = 0, far = 0, out = 0;
    for (const x of list) {
      const rig = x.rig;
      let lod = want.has(x) || x.self ? 0 : 1;
      if (rig.lod !== undefined && lod !== rig.lod && now - (rig.lodT || 0) < 0.5 && !x.self) lod = rig.lod;
      if (rig.lod === undefined || lod !== rig.lod) rig.lodT = now;
      rig.lod = lod;
      rig.out = !x.front || !x.show;
      if (lod === 0) full++; else simple++;
      if (rig.far) far++;
      if (rig.out) out++;
    }
    crowd.bodies = list.length; crowd.full = full; crowd.simple = simple; crowd.far = far; crowd.out = out; crowd.cap = cap; crowd.farAt = farAt;
    void dt;
  }
  /** How many bodies animate in full or cheaply right now (the monitor shows it; tests read it). */
  P.crowd = () => ({ ...crowd });
  const rigSoon = new Map();
  function updateRigs(dt) {
    const w = W();
    if (!w) return;
    const looks = on('looks');
    const seen = new Set();
    if (looks) {
      const todo = [];
      for (const pr of people()) {
        if (pr.kind !== 'me' && pr.kind !== 'player' && pr.kind !== 'friend' && !(pr.kind === 'ai' && pr.look)) continue;
        const e = pr.entity;
        if (!e || !e.alive) continue;
        const look = pr.look || C.randomLook(C.seedOf(pr.key + pr.name));
        const rig = rigFor(e, look, pr.color || '#4a9eff');
        seen.add(e);
        const self = pr.kind === 'me';
        // My own body shows only when I can see myself (third person, top view); the capsule is the collider only.
        // (At a mirror, or dressing up, I see myself whatever the view: modules/mirror sets e._mirrorShow.)
        const show = self ? (e._mirrorShow || (e._view !== 'first' && e._view !== 'rts')) && e.visible !== false && !e._seatHidden && !floatCam : e.visible !== false && !pr.floating;
        e._rigged = true;
        if (pr.kind === 'ai' && e.living && e.living.rig && e.living.rig.vis) e.living.rig.vis.setEnabled(false); // an islander shows its look, not the creature body
        if (self) { if (e._visor) e._visor.setEnabled(false); }
        e.node.visibility = 0;
        rig.root.setEnabled(show);
        // Small bumps (a slope's steps, the walk settling on uneven ground) smoothed out of the body; it never lags
        // more than a few centimeters behind its capsule (falling, flying, riding: it's right there).
        const wy = e.node.position.y;
        let off = rig.smY === undefined ? 0 : Math.max(-0.12, Math.min(0.12, rig.smY - wy)) * (1 - Math.min(1, dt * 16));
        if (!Number.isFinite(off)) off = 0;
        rig.smY = wy + off;
        rig.root.position.y = (rig.baseY || 0) + off;
        todo.push({ pr, rig, self, show });
      }
      crowdLevels(todo, dt);
      for (const x of todo) {
        // The cheap levels animate every 2nd frame (in view) or 6th (out of view) with the time they missed.
        x.rig.owed = (x.rig.owed || 0) + dt;
        x.rig.tick = ((x.rig.tick || 0) + 1) % (x.rig.lod ? (x.rig.out ? 6 : 2) : 1);
        if (x.rig.tick) continue;
        const step = x.rig.owed; x.rig.owed = 0;
        animate(x.rig, step, x.pr);
      }
    }
    for (const [e, rig] of rigs) {
      if (seen.has(e) && e.alive) continue;
      disposeRig(rig);
      rigs.delete(e);
      if (e.alive) {
        e._rigged = false;
        // Looks turned off: the plain capsule again.
        for (const c of e.node.getChildMeshes(true)) if (c.name === 'visor') c.setEnabled(true);
        if (e === w.player) { e.node.visibility = e._view === 'first' || e._view === 'rts' ? 0 : 1; if (e._visor) e._visor.setEnabled(e._view !== 'first' && e._view !== 'rts'); }
        else { e.node.visibility = 1; if (e.living && e.living.friend && e.living.friend.look && e.living.rig && e.living.rig.vis) e.living.rig.vis.setEnabled(true); }
      }
    }
  }
  // Walking swings arms and legs; an emote takes over the pose while it plays.
  function animate(rig, dt, pr) {
    const e = rig.e;
    const pos = [e.x, e.y, e.z];
    if (rig.last && dt > 0) { const v = Math.hypot(pos[0] - rig.last[0], pos[2] - rig.last[2]) / dt; rig.speed += (Math.min(12, v) - rig.speed) * Math.min(1, dt * 10); }
    rig.last = pos;
    const t = (rig.time = (rig.time || 0) + dt);
    let em = rig.emote;
    if (em && !em.def.loop && t - em.t0 > (em.seconds || em.def.seconds || 2.5)) em = rig.emote = null;
    if (em && em.def.loop && rig.speed > 1.2 && t - em.t0 > 0.6) em = rig.emote = null; // moving ends sitting and sleeping
    const r = rig, s = Math.min(1, rig.speed / 4);
    rig.phase += dt * (4 + rig.speed * 1.6);
    const swing = Math.sin(rig.phase) * 0.7 * s;
    // Rest pose.
    r.pose.position.set(0, Math.abs(Math.sin(rig.phase)) * 0.04 * s, 0); r.pose.rotation.set(0, 0, 0);
    r.hipL.rotation.set(swing, 0, 0); r.hipR.rotation.set(-swing, 0, 0);
    r.shL.rotation.set(-swing * 0.8, 0, 0.06); r.shR.rotation.set(swing * 0.8, 0, -0.06);
    r.neck.rotation.set(0, 0, 0);
    feedFace(rig, t);
    const modelOn = Boolean(rig.pm && rig.pm.on); // a Gen model has the body (presence-models.js): it moves itself, emotes included
    if (rig.person && !modelOn) P.softPerson.animate(rig, dt, em); // its own pose, springs and face (the emotes below go on top)
    if (rig.cape) rig.cape.rotation.x = 0.12 + s * 0.5;
    if (rig.tail) rig.tail.rotation.y = Math.sin(t * 3) * 0.3;
    if (rig.wings) { rig.wings[0].rotation.y = 0.5 + Math.sin(t * 2) * 0.1; rig.wings[1].rotation.y = -0.5 - Math.sin(t * 2) * 0.1; }
    if (modelOn) { P.models.animate(rig, dt, em); return; }
    if (rig.what !== 'person' && P.bodies) P.bodies.animate(rig, dt, s);
    if (!em) { playClip(rig, null); return; }
    const k = t - em.t0;
    if (playClip(rig, em.def.clip || em.def.name)) return;
    const o = Math.sin(k * 10);
    // An animal or a thing emotes with its whole self: a hop, a spin, a lie-down (arms, where it has them, below).
    if (rig.what !== 'person' && !rig.thing) {
      const n = em.def.name, b = Math.sin(k * 7);
      r.pose.position.y = n === 'sit' || n === 'sleep' ? -0.15 : Math.abs(b) * 0.18;
      r.pose.rotation.y = n === 'dance' ? Math.sin(k * 3.5) * 0.9 : n === 'laugh' ? Math.sin(k * 20) * 0.08 : 0;
      r.pose.rotation.z = n === 'sleep' ? 1.3 : Math.sin(k * 9) * 0.06;
    }
    switch (em.def.name) {
      case 'wave': r.shR.rotation.set(0, 0, -2.55 + o * 0.35); r.neck.rotation.z = 0.08; break;
      case 'dance': {
        const b = Math.sin(k * 7);
        r.pose.rotation.y = Math.sin(k * 3.5) * 0.6; r.pose.position.y = Math.abs(b) * 0.12;
        r.shR.rotation.set(0, 0, -1.4 - b * 1.1); r.shL.rotation.set(0, 0, 1.4 - b * 1.1);
        r.hipL.rotation.x = b * 0.4; r.hipR.rotation.x = -b * 0.4; r.neck.rotation.z = b * 0.15;
        break;
      }
      case 'cheer': r.shR.rotation.set(0, 0, -2.85 + o * 0.1); r.shL.rotation.set(0, 0, 2.85 - o * 0.1); r.pose.position.y = Math.abs(Math.sin(k * 7)) * 0.16; break;
      case 'laugh': r.pose.rotation.x = -0.22 + Math.sin(k * 26) * 0.05; r.shL.rotation.set(-0.7, 0, 0.3); r.shR.rotation.set(-0.7, 0, -0.3); r.neck.rotation.x = -0.25; break;
      case 'shrug': r.shL.rotation.set(0, 0, 0.9 + o * 0.03); r.shR.rotation.set(0, 0, -0.9 - o * 0.03); r.pose.position.y = Math.max(0, Math.sin(Math.min(k, 0.5) * 6.3)) * 0.05; r.neck.rotation.z = Math.sin(k * 2.2) * 0.16; r.neck.rotation.x = -0.05; break;
      case 'point': r.shR.rotation.set(-1.55, 0, 0); r.neck.rotation.x = 0.05; break;
      case 'sit': r.pose.position.y = -0.4; r.hipL.rotation.x = -1.5; r.hipR.rotation.x = -1.5; r.shL.rotation.set(-0.5, 0, 0.1); r.shR.rotation.set(-0.5, 0, -0.1); break;
      case 'sleep': r.pose.rotation.z = 1.45; r.pose.position.y = -0.62; r.shL.rotation.set(0, 0, 0.15); r.shR.rotation.set(0, 0, -0.15); r.neck.rotation.z = 0.1 * Math.sin(k); break;
      case 'clap': { const c = 0.35 + Math.sin(k * 16) * 0.25; r.shR.rotation.set(-1.3, 0, c); r.shL.rotation.set(-1.3, 0, -c); break; }
      case 'thumbsup': r.shR.rotation.set(-1.25, 0, -0.25); r.pose.position.y = Math.max(0, Math.sin(k * 3)) * 0.04; break;
      case 'heart': r.shR.rotation.set(0, 0, -2.5); r.shL.rotation.set(0, 0, 2.5); r.neck.rotation.z = Math.sin(k * 3) * 0.12; break;
      default: break;
    }
  }
  function playClip(rig, name) {
    if (!rig.model || !rig.model.groups.length) return false;
    const want = name ? rig.model.groups.find((g) => g.name.toLowerCase().includes(String(name).toLowerCase())) : null;
    if (rig.model.playing === want) return Boolean(want);
    if (rig.model.playing) rig.model.playing.stop();
    rig.model.playing = want || null;
    if (want) want.start(true);
    return Boolean(want);
  }

  // ------------------------------------------------------------------ faces: what they feel and look at (presence-core.js feel, mood, gazeTarget)
  let facePeers = [], facePeersAt = -1;
  /** Gives a rig what its face needs this frame: whether the Overseer is speaking and where it is, and the other players near. */
  function feedFace(rig, t) {
    const speaking = Boolean(H.speech && H.speech.busy);
    rig.overseerSpeaking = speaking;
    rig.overseerAt = speaking && H.overseer && H.overseer.position ? H.overseer.position : null;
    if (t - facePeersAt > 0.25 || t < facePeersAt) { // one list for every rig, four times a second
      facePeersAt = t; facePeers = [];
      for (const e of rigs.keys()) if (e && e.alive && (e.isPlayer || e.remotePlayer)) facePeers.push(e);
    }
    const out = [], me = rig.e;
    for (const o of facePeers) if (o !== me) out.push({ pos: [o.x, o.y + 1.5, o.z], dist: Math.hypot(o.x - me.x, o.y - me.y, o.z - me.z) });
    rig.others = out;
  }
  /** Something happened to a body: P.feel('hurt', { amount: 5 }) for me, P.feel('land', { speed: 12 }, entity) for another thing. */
  P.feel = (event, d, who) => {
    const p = who || (W() && W().player), rig = p && rigs.get(p);
    return rig && rig.mood ? rig.mood.push(event, d) : false;
  };
  /** The face a body wears now ('neutral', 'happy', ...) or null: what the mood says, else the emote's. For the playtest and tools. */
  P.face = (who) => {
    const p = who || (W() && W().player), rig = p && rigs.get(p);
    if (!rig) return null;
    const f = rig.mood && rig.mood.face();
    const em = rig.emote && rig.emote.def && C.EMOTE_FACE[rig.emote.def.name];
    const pp = rig.person || (rig.thing && rig.thing.F);
    const cur = pp && pp.expr;
    return { mood: f || null, emote: rig.emote && rig.emote.def ? rig.emote.def.name : null, shows: f || em || (pp && pp.rest) || 'neutral', talking: Boolean(rig.mood && rig.mood.talking()), gaze: (rig.person && rig.person.gazeKind) || null, blinks: (rig.person && rig.person.blinks) || 0, open: cur ? cur.open : null };
  };
  /** How a body moves now, for the playtest's trace and tools: { what, grounded, airborne, landing, speed, role, take, gait,
   *  feet }. For the person, `feet` is each sole in the world and whether it is in its stance (planted) this frame. */
  P.motion = (who) => {
    const p = who || (W() && W().player), rig = p && rigs.get(p);
    if (!rig) return null;
    const pp = rig.person, A = rig.pm && rig.pm.anim;
    const out = { what: rig.what, grounded: p.grounded !== false, speed: rig.speed || 0, airborne: null, landing: null, role: null, take: null, gait: null, feet: null };
    if (A) { out.role = A.role || null; out.take = A.take ? A.take.name || A.take : null; if (A.gait) out.gait = { lo: A.gait.lo, hi: A.gait.hi, w: A.gait.w, cps: A.gait.cps }; }
    if (pp && rig.hipL && rig.hipR && !rig.model) {
      out.airborne = Boolean(pp.airborne); out.landing = pp.air ? pp.air.landT < 0.25 : null;
      const down = typeof pp.soleY === 'number' ? pp.soleY : -0.52, duty = pp.duty || 0.5; // (the sole in the hip's own space: the hip's matrix scales it)
      const sole = (hip, ph) => { hip.computeWorldMatrix(true); const v = B.Vector3.TransformCoordinates(new B.Vector3(0, down, 0), hip.getWorldMatrix()); return { x: v.x, y: v.y, z: v.z, down: Boolean(C.strideDown && C.strideDown(ph, duty)) && !pp.airborne, via: 'sole' }; };
      out.feet = [sole(rig.hipL, pp.ph || 0), sole(rig.hipR, (pp.ph || 0) + Math.PI)];
    } else if (rig.pm && rig.pm.on && rig.pm.cur) {
      // a Gen model (presence-models.js): what it draws, and where its feet are after the last render (the playtest's trace)
      const pm = rig.pm;
      out.model = true; out.driven = Boolean(A && A.player);
      out.airborne = Boolean(pm.air && pm.air.was); out.landing = pm.air ? pm.air.landT < 0.25 : null;
      try { out.feet = modelFeet(rig, pm); } catch (err) { out.feet = null; out.feetError = String(err && err.message || err); }
    }
    return out;
  };
  /** The foot nodes of a model's drawn level: Mixamo's feet, or the template rigs' leg tips (dinosaur, dog); none: the lowest vertices instead. */
  const FOOT_NODE = [/^(mixamorig\d*[:_])?(Left|Right)Foot$/, /^Leg[LR]Tip$/, /^Leg[FB][LR]Tip$/];
  function modelFeet(rig, pm) {
    const lvl = pm.cur;
    if (!pm.footN || pm.footN.lvl !== lvl) {
      const nodes = [];
      for (const r of lvl.roots) for (const n of [r, ...r.getDescendants(false)]) if (typeof n.getTotalIndices !== 'function' && FOOT_NODE.some((re) => re.test(n.name)) && !nodes.some((x) => x.name === n.name)) nodes.push(n);
      nodes.sort((a, b) => (a.name < b.name ? -1 : 1));
      const meshes = [];
      for (const r of lvl.roots) for (const m of [r, ...r.getChildMeshes(false)]) if (typeof m.getTotalIndices === 'function' && m.getTotalVertices() > 0 && m.isEnabled()) meshes.push(m);
      pm.footN = { lvl, nodes, meshes, data: new Map() };
    }
    const F = pm.footN;
    if (F.nodes.length) {
      return F.nodes.map((n) => { n.computeWorldMatrix(true); const v = n.getAbsolutePosition(); return { x: v.x, y: v.y, z: v.z, down: null, via: 'bone', part: n.name }; });
    }
    // no feet to follow (a toaster): the lowest vertex on each side of the body, from the vertices as they are drawn now
    rig.root.computeWorldMatrix(true);
    const inv = rig.root.getWorldMatrix().clone().invert(), low = [null, null], tmp = new B.Vector3(), loc = new B.Vector3();
    for (const m of F.meshes) {
      let pos = F.data.get(m);
      if (!pos) F.data.set(m, (pos = m.getVerticesData(B.VertexBuffer.PositionKind) || []));
      m.computeWorldMatrix(true);
      const wm = m.getWorldMatrix();
      for (let i = 0; i + 2 < pos.length; i += 3) {
        tmp.set(pos[i], pos[i + 1], pos[i + 2]);
        B.Vector3.TransformCoordinatesToRef(tmp, wm, tmp);
        B.Vector3.TransformCoordinatesToRef(tmp, inv, loc);
        const side = loc.x >= 0 ? 0 : 1;
        if (!low[side] || tmp.y < low[side].y) low[side] = { x: tmp.x, y: tmp.y, z: tmp.z, down: null, via: 'vertex' };
      }
    }
    return low.filter(Boolean);
  }
  const nearestRigs = (pos, radius) => { const out = []; for (const [e, rig] of rigs) { const d = Math.hypot(e.x - pos[0], e.y - pos[1], e.z - pos[2]); if (d <= radius) out.push({ rig, dist: d }); } return out; };
  function wireFeelings() {
    const g = H.game;
    if (g) {
      g.on('hurt', (d) => { try { const rig = d && d.entity && rigs.get(d.entity); if (rig) { rig.mood.push('hurt', d); if ((Number(d.amount) || 0) > 0 && P.anim && P.anim.has(rig, 'hurt')) rig.emote = { def: { name: 'hurt', seconds: 0.5 }, t0: rig.time || 0, seconds: 0.5 }; } } catch {} });
      g.on('catch', (d) => { try { const rig = d && d.entity && rigs.get(d.entity); if (rig) rig.mood.push('catch', d); } catch {} });
    }
  }
  if (H.physics && H.physics.on) H.physics.on('explosion', (ev) => {
    try {
      const p = ev && ev.position; if (!p) return;
      const pos = Array.isArray(p) ? p : [p.x, p.y, p.z];
      for (const { rig, dist } of nearestRigs(pos, Math.max(ev.radius || 4.5, 6) * 4)) rig.mood.push('explosion', { dist, radius: ev.radius });
    } catch (err) { H.report(err, 'presence'); }
  });

  // ------------------------------------------------------------------ emotes: played on everyone's screen
  const reactions = new Map(); // person key -> { icon, until, loop }
  function startEmote(key, entity, def) {
    reactions.set(key, { icon: def.icon, until: def.loop ? Infinity : now() + 2600, at: now(), loop: def.loop, entity });
    const rig = entity && rigs.get(entity);
    const em = { def, t0: rig ? rig.time || 0 : 0 };
    if (rig) rig.emote = em;
    else if (entity) {
      rigSoon.set(entity, { def, t0: 0 });
      // NPCs and AI friends act it out with their own bodies (the living module), when they can.
      const living = H.living;
      const act = { dance: 'dance', cheer: 'cheer', sit: 'sit', sleep: 'sleep', wave: 'cheer', clap: 'cheer', heart: 'cheer' }[def.name];
      if (living && entity.living && act && living.command) try { living.command(entity, act, { seconds: def.loop ? 20 : def.seconds || 3 }); } catch {}
    }
    emit('emote', { key, name: def.name, icon: def.icon, entity });
  }
  function onEmote(d, from) {
    const def = C.emote(d && d.e);
    if (!def || !on('emotes')) return;
    if (d.w === '*') {
      // Everyone: each screen plays it on every player it sees (and its own), and on the AI friends and pets near.
      for (const pr of people(true)) if (pr.entity && (pr.kind === 'me' || pr.kind === 'player' || pr.kind === 'friend' || pr.kind === 'ai' || pr.kind === 'pet')) startEmote(pr.key, pr.entity, def);
      return;
    }
    if (relayedBySomeoneElse(d, from)) return; // you emote for yourself
    const key = !d.w || d.w === 'me' || d.w === myConn() ? 'me' : String(d.w).startsWith('e:') ? d.w : `p:${d.w}`;
    const pr = person(key) || (String(d.w).startsWith('e:') ? sceneEntity(d.w.slice(2)) : null);
    if (!pr) return;
    if (isMuted(pr)) return;
    startEmote(pr.key, pr.entity, def);
  }
  /** A line or emote for player w that came from neither w nor the host (who relays everyone's): someone pretending. */
  function relayedBySomeoneElse(d, from) {
    if (!from || !d.w || d.w === '*' || String(d.w).startsWith('e:') || from.id === d.w) return false;
    const h = hostConn();
    return Boolean(h && from.id !== h);
  }
  const sceneEntity = (id) => { const e = W() && W().byId.get(id); return e ? { key: `e:${id}`, entity: e } : null; };
  let emoteAction = null;
  /** Plays an emote: P.emote('wave') (me), P.emote('dance', 'all') (everyone in the room), P.emote('cheer', thing). */
  P.emote = (name, who) => {
    const def = C.emote(name);
    if (!def) throw new Error(`No emote "${name}": ${C.EMOTES.map((e) => e.name).join(', ')}`);
    if (who && who.__entity) {
      if (who === (W() && W().player)) who = undefined;
      else if (who.sceneId) { emoteAction({ w: `e:${who.sceneId}`, e: def.name }); return def.name; }
      else { startEmote(keyOf(who), who, def); return def.name; }
    }
    if (who === 'all' || who === 'everyone' || who === '*') { emoteAction({ w: '*', e: def.name }); return def.name; }
    emoteAction({ w: myConn() || 'me', e: def.name });
    return def.name;
  };
  P.emotes = () => C.EMOTES.map((e) => ({ ...e }));
  P.stopEmote = () => { const p = W() && W().player; const rig = p && rigs.get(p); if (rig) rig.emote = null; reactions.delete('me'); };

  // ------------------------------------------------------------------ talking: game chat and speech bubbles
  const bub = C.bubbles();
  P._bubbles = bub;
  const lim = C.limiter();
  P.filter = (text) => text; // a game (or the platform's chat filter) can replace this
  function onSay(d, from) {
    if (!d || !on('chat')) return;
    const text = C.cleanLine(P.filter(C.cleanLine(d.t)));
    if (!text) return;
    if (relayedBySomeoneElse(d, from)) return; // nobody speaks for someone else
    const key = !d.w || d.w === 'me' || d.w === myConn() ? 'me' : `p:${d.w}`;
    const pr = person(key);
    if (pr && isMuted(pr)) return;
    const name = pr ? pr.name : 'Someone';
    if (on('bubbles') && key !== 'me') bub.say(key, text, now());
    if (pr && pr.entity && rigs.get(pr.entity)) rigs.get(pr.entity).mood.push('talk', { seconds: C.bubbleSeconds ? C.bubbleSeconds(text) : 2 });
    emit('say', { key, name, text, me: key === 'me', friend: pr ? pr.kind === 'friend' : false, color: pr && pr.color });
    try { if (H.game) H.game.emit('chat', { name, text, me: key === 'me', player: pr ? pr.conn || 'me' : null }); } catch {}
  }
  let sayAction = null;
  /** Says something in game chat (over my head for everyone). False when it's too soon or there's nothing to say. */
  P.say = (a, b) => {
    if (a && a.__entity) { a.say(String(b ?? '')); return true; }
    const text = C.cleanLine(a);
    if (!text || !lim.ok(now())) return false;
    sayAction({ w: myConn() || 'me', t: text });
    return true;
  };
  /** Typing in chat (players see "…" on my tag). */
  P.setTyping = (yes) => { yes = Boolean(yes); if (me.typing === yes) return; me.typing = yes; resend(); };
  // What anything says (e.say: NPCs, AI friends, creatures, scripts) shows as a bubble over it, stacked and timed.
  const Ent = H.lib.Entity;
  const plainSay = Ent.prototype.say;
  Ent.prototype.say = function (text, seconds = 3) {
    if (!on('bubbles') || this.isPlayer) return plainSay.call(this, text, seconds);
    const t = C.cleanLine(text);
    if (!t) return this;
    const key = keyOf(this);
    bub.say(key, t, now(), Math.max(Number(seconds) || 0, C.bubbleSeconds(t)));
    bubbleOwners.set(key, this);
    const p = W() && W().player;
    if (p && Math.hypot(this.x - p.x, this.z - p.z) < 22) emit('say', { key, name: (this.living && this.living.friend && this.living.friend.name) || this.name || cap(this.data && this.data.species) || 'Someone', text: t, npc: true });
    return this;
  };
  const bubbleOwners = new Map(); // key -> entity (things that spoke without being tag people)

  // ------------------------------------------------------------------ spectating: watch another player's view
  let spect = null; // { key, saved: { controls, view } }
  P.spectating = () => (spect ? spect.key : null);
  const watchable = () => people(true).filter((x) => (x.kind === 'player' || x.kind === 'friend') && !x.floating && x.entity && x.entity.alive && x.entity.visible !== false);
  /** Watches a player: P.spectate('next'), P.spectate(id), P.spectate(null) stops. */
  P.spectate = (who = 'next') => {
    const w = W();
    if (!w) return null;
    if (who === null || who === false) { stopSpectate(); return null; }
    if (!on('spectate')) return null;
    const list = watchable();
    if (!list.length) { stopSpectate(); return null; }
    let target = null;
    if (who === 'next' || who === 'prev') {
      const i = spect ? list.findIndex((x) => x.key === spect.key) : -1;
      target = list[(i + (who === 'prev' ? -1 : 1) + list.length * 2) % list.length];
      if (who === 'prev' && i < 0) target = list[list.length - 1];
    } else target = list.find((x) => x.key === who || x.conn === who || x.entity === who) || null;
    if (!target) return null;
    const p = w.player;
    if (!spect) spect = { key: null, saved: { controls: p ? p.controls : true, view: p ? p._view : null }, cam: null };
    spect.key = target.key;
    if (p) { p.controls = false; p.velocity = [0, 0, 0]; }
    resend();
    emit('spectate', { key: target.key, name: target.name });
    return target.key;
  };
  function stopSpectate() {
    if (!spect) return;
    const w = W(), s = spect;
    spect = null;
    resend();
    if (w && w.player && w.player.alive) { w.player.controls = s.saved.controls; if (s.saved.view) w.player.view = s.saved.view; }
    emit('spectate', null);
  }
  function spectFrame(dt) {
    if (!spect) return;
    const w = W();
    const pr = people().find((x) => x.key === spect.key);
    if (!pr || !pr.entity || !pr.entity.alive) { if (!P.spectate('next')) stopSpectate(); return; }
    const e = pr.entity, st = pr.state;
    const yaw = st ? st.y : e.node.rotation.y;
    const pitch = st ? Math.max(-0.9, Math.min(0.9, st.pi || 0)) : 0.1;
    const dir = new B.Vector3(Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    const head = new B.Vector3(e.x, e.y + 0.75, e.z);
    // Over their shoulder, looking where they look.
    const want = head.subtract(new B.Vector3(dir.x, 0, dir.z).normalize().scale(3.2)).add(new B.Vector3(0, 0.7, 0));
    const look = head.add(dir.scale(8));
    const cam = w.scene.activeCamera;
    const k = spect.cam ? Math.min(1, dt * 8) : 1;
    spect.cam = spect.cam ? B.Vector3.Lerp(spect.cam, want, k) : want;
    w.camera.internal(() => w.camera.api.fixed([spect.cam.x, spect.cam.y, spect.cam.z], [look.x, look.y, look.z]));
    if (cam !== w.scene.activeCamera) spect.cam = null;
  }


  // ------------------------------------------------------------------ the Overseer's eye: a camera with no character
  // /play/<slug>?spectate=1 (the gallery's Spectate): you are in the room as a floating view. No body (others do not see
  // one either: sp 2), controls off; WASD/arrows fly, Q/E down and up, Shift faster, drag to look. P.float(false) joins.
  let floatCam = null; // { pos, yaw, pitch, keys, saved: { controls }, drag }
  P.floating = () => Boolean(floatCam);
  P.float = (yes = true) => {
    const w = W();
    if (!w || !w.player) return false;
    if (!yes) { stopFloat(); return false; }
    if (floatCam || !on('spectate')) return Boolean(floatCam);
    if (spect) stopSpectate();
    const p = w.player, c = w.scene.activeCamera;
    const from = c ? [c.position.x, c.position.y + 12, c.position.z] : [p.x, p.y + 14, p.z];
    floatCam = { pos: from, yaw: c && c.rotation ? c.rotation.y : 0, pitch: 0.5, keys: new Set(), drag: null, saved: { controls: p.controls } };
    p.controls = false; p.velocity = [0, 0, 0];
    resend();
    emit('float', true);
    return true;
  };
  function stopFloat() {
    if (!floatCam) return;
    const w = W(), f = floatCam;
    floatCam = null;
    resend();
    if (w && w.player && w.player.alive) { w.player.controls = f.saved.controls; if (w.camera && w.camera.api) w.camera.internal(() => w.camera.api.thirdPerson(w.player, { distance: 5 })); }
    emit('float', false);
  }
  function floatFrame(dt) {
    if (!floatCam) return;
    const w = W(), f = floatCam;
    const k = (n) => (f.keys.has(n) ? 1 : 0);
    const input = { x: k('d') + k('arrowright') - k('a') - k('arrowleft'), y: k('e') - k('q'), z: k('w') + k('arrowup') - k('s') - k('arrowdown') };
    if (input.x || input.y || input.z) {
      const speed = f.keys.has('shift') ? 40 : 12;
      const c = Math.cos(f.pitch), sy = Math.sin(f.yaw);
      const fwd = [sy * c, -Math.sin(f.pitch), Math.cos(f.yaw) * c], right = [Math.cos(f.yaw), 0, -sy], s = speed * dt;
      f.pos = [f.pos[0] + (fwd[0] * input.z + right[0] * input.x) * s, f.pos[1] + (fwd[1] * input.z + input.y) * s, f.pos[2] + (fwd[2] * input.z + right[2] * input.x) * s];
    }
    const c = Math.cos(f.pitch);
    const look = [f.pos[0] + Math.sin(f.yaw) * c * 10, f.pos[1] - Math.sin(f.pitch) * 10, f.pos[2] + Math.cos(f.yaw) * c * 10];
    w.camera.internal(() => w.camera.api.fixed(f.pos, look));
    if (w.player && w.player.alive) w.player.controls = false;
  }
  const floatKey = (down) => (e) => {
    if (!floatCam) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    const k = String(e.key || '').toLowerCase();
    if (down) floatCam.keys.add(k); else floatCam.keys.delete(k);
    if (e.shiftKey) floatCam.keys.add('shift'); else floatCam.keys.delete('shift');
  };
  window.addEventListener('keydown', floatKey(true), true);
  window.addEventListener('keyup', floatKey(false), true);
  window.addEventListener('blur', () => { if (floatCam) floatCam.keys.clear(); });
  window.addEventListener('pointerdown', (e) => { if (floatCam && !(e.target.closest && e.target.closest('button,a,input,.pr-spect'))) floatCam.drag = { x: e.clientX, y: e.clientY }; }, true);
  window.addEventListener('pointermove', (e) => {
    if (!floatCam || !floatCam.drag) return;
    floatCam.yaw += (e.clientX - floatCam.drag.x) * 0.005;
    floatCam.pitch = Math.max(-1.45, Math.min(1.45, floatCam.pitch + (e.clientY - floatCam.drag.y) * 0.005));
    floatCam.drag = { x: e.clientX, y: e.clientY };
  }, true);
  window.addEventListener('pointerup', () => { if (floatCam) floatCam.drag = null; }, true);

  // ------------------------------------------------------------------ drawing: tags and bubbles over heads (the page)
  let layer = null;
  const els = new Map(); // key -> { wrap, tag, name, badges, hp, bubbles, react, sig }
  function ensureLayer() {
    if (layer && layer.isConnected) return layer;
    layer = document.createElement('div');
    layer.id = 'pr-layer';
    layer.className = 'pr-layer';
    document.body.appendChild(layer);
    return layer;
  }
  const pool = []; // tags taken off a head, waiting for the next one (a crowd coming and going makes no new elements)
  function elFor(key) {
    let x = els.get(key);
    if (x) return x;
    x = pool.pop();
    if (x) {
      x.wrap.style.display = ''; x.sig = ''; x.bsig = ''; x.rsig = '';
      els.set(key, x);
      return x;
    }
    const wrap = document.createElement('div');
    wrap.className = 'pr-head';
    wrap.innerHTML = '<div class="pr-bubbles"></div><div class="pr-tag"><span class="pr-badges"></span><b class="pr-name"></b><span class="pr-dots"><i></i><i></i><i></i></span><span class="pr-react"></span></div><div class="pr-hp"><em></em></div>';
    ensureLayer().appendChild(wrap);
    x = { wrap, bubbles: wrap.querySelector('.pr-bubbles'), react: wrap.querySelector('.pr-react'), tag: wrap.querySelector('.pr-tag'), name: wrap.querySelector('.pr-name'), badges: wrap.querySelector('.pr-badges'), dots: wrap.querySelector('.pr-dots'), hp: wrap.querySelector('.pr-hp'), bar: wrap.querySelector('.pr-hp em'), sig: '', bsig: '', rsig: '' };
    els.set(key, x);
    return x;
  }
  function dropEl(key) {
    const x = els.get(key);
    if (!x) return;
    els.delete(key);
    if (pool.length < 40) { x.wrap.style.display = 'none'; x.bubbles.textContent = ''; pool.push(x); } else x.wrap.remove();
  }
  const BADGE = { friend: '★', ai: '✦', pet: '🐾' };
  const phone = () => Boolean(H.touchUi);
  const occluded = new Map(); // key -> { at, hit }
  function project(scene, cam, v, view) {
    const m = cam.getViewMatrix().multiply(cam.getProjectionMatrix());
    const p = B.Vector3.TransformCoordinates(v, m);
    return { x: (p.x * 0.5 + 0.5) * view.w, y: (0.5 - p.y * 0.5) * view.h };
  }
  /** Where tags are this frame (tests read it): [{ key, kind, name, x, y, scale, opacity, tag, bubbles }]. */
  P.shown = [];
  function draw() {
    const w = W();
    if (!w || !w.scene || !w.scene.activeCamera) return;
    const c = cfg();
    const tagsOn = on('tags'), bubblesOn = on('bubbles');
    const cam = w.scene.activeCamera;
    const canvas = document.getElementById('stage');
    const view = { w: (canvas && canvas.clientWidth) || window.innerWidth || 800, h: (canvas && canvas.clientHeight) || window.innerHeight || 600 };
    const fwd = cam.getDirection(B.Axis.Z);
    const cp = cam.globalPosition || cam.position;
    const t = now();
    const all = people();
    const extra = [];
    for (const [key, e] of bubbleOwners) { if (!e.alive || !bub.speaking(key, t)) { bubbleOwners.delete(key); continue; } if (!all.some((x) => x.key === key)) extra.push({ key, kind: 'thing', entity: e, name: null, silent: true }); }
    const cands = [];
    const self = c.self === true;
    for (const pr of [...all, ...extra]) {
      const e = pr.entity;
      if (!e || !e.alive || e.visible === false) continue;
      if (pr.kind === 'me' && !(self && e._view !== 'first' && e._view !== 'rts')) continue;
      const top = topOf(e, pr);
      const d = top.subtract(cp);
      const dist = d.length();
      const front = B.Vector3.Dot(d, fwd) > 0.2;
      const sp = front ? project(w.scene, cam, top, view) : null;
      const onScreen = Boolean(sp && sp.x > -60 && sp.x < view.w + 60 && sp.y > -60 && sp.y < view.h + 80);
      cands.push({ id: pr.key, kind: pr.kind, distance: dist, onScreen, pr, sp, range: pr.kind === 'thing' && pr.silent ? 40 : undefined });
    }
    const opts = { max: Number(c.max) || (phone() ? C.TAGS.maxPhone : C.TAGS.max), distance: Number(c.distance) || C.TAGS.distance, npcDistance: Number(c.npcDistance) || C.TAGS.npcDistance, size: (Number(c.size) || 1) * (phone() ? 0.9 : 1) };
    const laid = tagsOn ? C.layoutTags(cands.filter((x) => !x.pr.silent), opts) : [];
    const byId = new Map(cands.map((x) => [x.id, x]));
    const shownKeys = new Set();
    const out = [];
    // Bubbles show for whoever is speaking nearby, even past the tag limit.
    const speakers = bubblesOn ? cands.filter((x) => x.onScreen && x.distance < 45 && bub.speaking(x.id, t)).slice(0, 8) : [];
    const items = new Map();
    for (const l of laid) items.set(l.id, { ...l, tag: true });
    for (const s of speakers) if (!items.has(s.id)) items.set(s.id, { id: s.id, kind: s.kind, scale: Math.max(0.6, Math.min(1.1, 8 / Math.max(1, s.distance))) * opts.size, opacity: 1, distance: s.distance, tag: false });
    for (const it of items.values()) {
      const cnd = byId.get(it.id);
      const pr = cnd.pr;
      let opacity = it.opacity;
      if (c.occlude && it.tag) {
        let o = occluded.get(it.id);
        if (!o || t - o.at > 250) { o = { at: t, hit: blocked(w.scene, cp, topOf(pr.entity, pr), pr.entity) }; occluded.set(it.id, o); }
        if (o.hit) { if (c.occlude === 'hide') continue; opacity *= 0.35; }
      }
      const x = elFor(it.id);
      shownKeys.add(it.id);
      // The tag: badges, name, typing dots, health.
      const colors = { ...C.TAGS.colors, ...(c.colors || {}) };
      const react = reactions.get(it.id);
      const live = bubblesOn ? bub.live(it.id, t) : [];
      const speaking = live.length > 0;
      const acc = pr.look && C.ACCESSORY.get(pr.look.accessory);
      const badges = `${pr.host ? '👑' : ''}${BADGE[pr.kind] || ''}${pr.spectating ? '👁' : ''}${acc && acc.anchor ? acc.icon : ''}`; // (a player's accessory rides on their tag)
      const lookColor = pr.look && (pr.kind === 'player' || pr.kind === 'friend' || pr.kind === 'me') && pr.look.body;
      const hpOn = pr.hp !== undefined && pr.hp !== null && pr.mx && pr.hp < pr.mx && pr.hp >= 0;
      const sig = `${it.tag ? 1 : 0}|${pr.name}|${pr.kind}|${badges}|${pr.typing ? 1 : 0}|${speaking ? 1 : 0}|${pr.color || ''}|${colors[pr.kind] || ''}|${pr.kind === 'me' ? 1 : 0}|${lookColor || ''}`;
      if (x.sig !== sig) {
        x.sig = sig;
        x.tag.style.display = it.tag ? '' : 'none';
        x.name.textContent = pr.name || '';
        x.badges.textContent = badges;
        x.badges.style.display = badges ? '' : 'none';
        x.dots.style.display = pr.typing ? '' : 'none';
        x.tag.className = `pr-tag pr-${pr.kind}${speaking ? ' pr-speaking' : ''}`;
        x.name.style.color = (c.colors && c.colors[pr.kind]) || ((pr.kind === 'player' || pr.kind === 'me') && pr.color ? '#ffffff' : colors[pr.kind] || '#ffffff');
        x.tag.style.borderColor = pr.kind === 'friend' ? colors.friend : lookColor || pr.color || 'rgba(255,255,255,.18)'; // (the tag takes the main color they chose)
      }
      x.hp.style.display = it.tag && hpOn ? '' : 'none';
      if (hpOn) x.bar.style.width = `${Math.max(0, Math.min(100, (pr.hp / pr.mx) * 100))}%`;
      // Emoji reaction: pops over the name while the emote plays (💤 stays while asleep).
      const rsig = react && (react.until > t) ? react.icon + (react.loop ? 'L' : '') : '';
      if (react && react.until <= t) reactions.delete(it.id);
      if (react && react.loop && react.entity && rigs.get(react.entity) && !rigs.get(react.entity).emote) reactions.delete(it.id);
      if (x.rsig !== rsig) { x.rsig = rsig; x.react.textContent = rsig ? (rsig.endsWith('L') ? rsig.slice(0, -1) : rsig) : ''; x.react.className = `pr-react${rsig ? ' on' : ''}${react && react.loop ? ' loop' : ''}`; }
      // Bubbles, oldest on top.
      const bsig = live.map((b) => b.at).join(',');
      if (x.bsig !== bsig) {
        x.bsig = bsig;
        x.bubbles.innerHTML = '';
        for (const b of live) { const d = document.createElement('div'); d.className = 'pr-bubble'; d.textContent = b.text; x.bubbles.appendChild(d); }
      }
      const sp = cnd.sp;
      x.wrap.style.display = '';
      x.wrap.style.opacity = String(Math.round(opacity * 100) / 100);
      // Speech stays on screen: a bubble near the edge slides in (the tag goes with it).
      const half = live.length ? Math.min(view.w / 2, 120 * it.scale) : 0;
      const sx = half ? Math.max(half, Math.min(view.w - half, sp.x)) : sp.x;
      x.wrap.style.transform = `translate(${Math.round(sx)}px, ${Math.round(sp.y)}px) translate(-50%, -100%) scale(${Math.round(it.scale * 100) / 100})`;
      x.wrap.style.zIndex = String(1000 - Math.round(it.distance));
      out.push({ key: it.id, kind: pr.kind, name: pr.name, x: sp.x, y: sp.y, scale: it.scale, opacity, tag: it.tag, bubbles: live.map((b) => b.text), typing: Boolean(pr.typing), host: Boolean(pr.host), friend: pr.kind === 'friend', react: rsig ? rsig.replace(/L$/, '') : null, hp: hpOn ? pr.hp : null });
    }
    for (const key of [...els.keys()]) if (!shownKeys.has(key)) { const x = els.get(key); if (x.wrap.style.display !== 'none') x.wrap.style.display = 'none'; if (!all.some((p) => p.key === key) && !bubbleOwners.has(key)) dropEl(key); }
    P.shown = out;
  }
  // How far above the head each hat reaches (meters, before the body's shape scales it).
  const HAT_H = { none: 0, cap: 0.12, beanie: 0.2, tophat: 0.4, crown: 0.28, cowboy: 0.24, party: 0.46, halo: 0.3, horns: 0.2, bunny: 0.38, helmet: 0.1, chef: 0.52 };
  function topOf(e) {
    const rig = rigs.get(e);
    let h = e.half ? e.half[1] : 0.9;
    if (rig) {
      // The block body: feet at -0.9, the top of the head 1.62 above them (times the shape), then the hat.
      const s = (C.LOOK.sizes[rig.look.shape] || C.LOOK.sizes.normal)[1] * (Number(rig.look.bodySize) > 0 ? Number(rig.look.bodySize) : 1);
      const hk = Number(rig.look.headSize) > 0 ? Number(rig.look.headSize) : 1;
      h = -0.9 + (1.62 + 0.55 * (hk - 1) + (HAT_H[rig.look.hat] || 0) * hk) * s; // (a bigger head reaches higher: the name tag sits on it)
      if (rig.emote && rig.emote.def.name === 'sleep') h = -0.45;
      else if (rig.emote && rig.emote.def.name === 'sit') h -= 0.4;
    } else if (e.living && e.living.tall) h = e.living.tall / 2;
    return new B.Vector3(e.x, e.y + h + 0.2, e.z);
  }
  function blocked(scene, from, to, skip) {
    const d = to.subtract(from);
    const len = d.length();
    if (len < 1) return false;
    const hit = scene.pickWithRay(new B.Ray(from, d.scale(1 / len), len - 0.6), (m) => {
      if (!m.isEnabled() || m.isPickable === false || (m.metadata && m.metadata.decor)) return false;
      const en = H.entityOf(m);
      return Boolean(en && en !== skip && !en.isPlayer && en.alive && en.visible !== false && en.physics !== 'none' && en.physics !== 'trigger');
    });
    return Boolean(hit && hit.hit);
  }
  function clearDrawn() { for (const key of [...els.keys()]) dropEl(key); P.shown = []; }

  // ------------------------------------------------------------------ the loop
  let tickAt = 0;
  let wasOff = false;
  H.hooks.frame.push((dt) => {
    try {
      const w = W();
      if (!w) return;
      if (cfg().off) {
        if (els.size) clearDrawn();
        if (rigs.size) updateRigs(dt);
        if (!wasOff) {
          // Turned off while playing: the engine's own little name tags come back.
          wasOff = true;
          for (const e of w.entities) if (e.living && e.living.friend && e.living.friend.tag) e.living.friend.tag.setEnabled(true);
          if (hasNet()) for (const pr of HawkesNet.peers().values()) if (pr.avatar && pr.avatar.alive) for (const c of pr.avatar.node.getChildMeshes(true)) if (c.name === 'text') c.setEnabled(true);
        }
        return;
      }
      wasOff = false;
      if (performance.now() - tickAt > 400) { tickAt = performance.now(); syncTick(); }
      updateRigs(dt);
      spectFrame(dt);
      floatFrame(dt);
      draw();
    } catch (err) { H.report(err, 'presence'); }
  });
  H.hooks.world.push({
    enter(w) {
      loadMe();
      wireFeelings();
      if (H.game && !('presence' in H.game)) try { Object.defineProperty(H.game, 'presence', { value: P, configurable: true, enumerable: false }); } catch {}
      peopleAt = -Infinity;
      // The gallery's Spectate: /play/<slug>?spectate=1 enters as a floating camera, once the player is there.
      if (H.mode === 'play' && /[?&]spectate=1\b/.test(location.search)) { let n = 0; const t = setInterval(() => { if (P.float(true) || ++n > 40) clearInterval(t); }, 250); }
    },
    leave() {
      for (const rig of rigs.values()) disposeRig(rig);
      rigs.clear(); rigSoon.clear(); reactions.clear(); bubbleOwners.clear(); bub.clear(); occluded.clear();
      if (spect) spect = null;
      floatCam = null;
      clearDrawn();
    },
    net(status) { if (status === 'online') { resend(); peopleAt = -Infinity; } emit('people', null); },
  });
  if (H.sync) {
    emoteAction = H.sync.action('presence:emote', (d, ctx) => onEmote(d, ctx && ctx.from));
    sayAction = H.sync.action('presence:say', (d, ctx) => onSay(d, ctx && ctx.from));
  } else {
    emoteAction = (d) => onEmote(d, null);
    sayAction = (d) => onSay(d, null);
  }
  // The showcase (/avatars) builds and moves bodies on stand-in entities ({ node, x, y, z, alive }) with the very code the game runs.
  P.showcase = { make: (e, look, color, opts) => makeRig(e, look, color, opts), animate: (rig, dt) => animate(rig, dt, null), dispose: disposeRig };
  P._internal = { rigs, people, reactions, peerInfo, verified, onSay, onEmote, mine, draw, collect };
})();
