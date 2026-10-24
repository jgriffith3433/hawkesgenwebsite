// Living things, part 4: AI friends. The `friend` kind is a creature (a person by default, or a dog, a robot, a
// dinosaur...) with a name and a personality that you talk to: T near them (or tap/click them) opens a chat with quick
// buttons (Follow me, Stay, Dance, Fetch, Build a tower...). They follow you, carry things, sit, dance, play fetch,
// build with you, ride along (and drive, when the Vehicles module lets them), flee explosions and cheer when you win.
//
// Their words: a phrasebook. They understand plain commands and answer in character (personality, species voices):
// free, offline, never broken. (There is no paid AI talk: J's decision, 2026-10-23.)
/* global HawkesPlay, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = BABYLON;
  const living = H.living;
  const W = () => H.world;
  const G = () => H.game;
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const now = () => (W() ? W().time : 0);
  const ACTIONS = ['none', 'follow', 'stay', 'come', 'sit', 'sleep', 'dance', 'cheer', 'fetch', 'carry', 'drop', 'build', 'drive', 'wander', 'flee', 'attack'];
  living.friendActions = ACTIONS;

  // ------------------------------------------------------------------ the friend kind
  function makeFriend(shape, o, spec) {
    const name = String(o.name || shape.name || 'Max').slice(0, 40);
    const species = shape.species || 'person';
    const e = living._make({ ...shape, species, temper: shape.temper || 'pet', follow: shape.follow === false ? null : shape.follow || 'player' }, { ...o, name }, spec);
    e.kind = 'friend';
    const r = e.living;
    r.friend = { name, personality: String(shape.personality || '').slice(0, 400), lines: Array.isArray(shape.lines) ? shape.lines.map(String).slice(0, 30) : null, talk: shape.talk !== false, log: [], greeted: false, key: spec && spec.id ? spec.id : `friend:${name}` };
    if (shape.follow === false) r.follow = null;
    // A friend who stays (a guide at their post): never follows, comes, rides along or wanders off, whatever you say.
    r.friend.stays = shape.stays === true;
    // A name tag over the head.
    const tag = H.textPlane(name, { size: 0.2, color: '#ffffff' });
    tag.parent = e.node; tag.position.y = r.tall / 2 + 0.32; tag.isPickable = false; tag.metadata = { decor: true };
    r.friend.tag = tag;
    e.on('click', () => { if (canTalk(e)) open(e); });
    return e;
  }
  H.kinds.register('friend', {
    physics: 'dynamic',
    maker: (o = {}) => makeFriend(o, o, null),
    build: (shape, o, spec) => makeFriend(shape, o, spec),
    editor: {
      word: 'a friend',
      lift: () => 0.95,
      motion: [['dynamic', 'Lives: follows, talks, helps'], ['static', 'Stands still']],
      hotbar: [{ order: 304, icon: '🧑', label: 'Friend', make: () => ({ type: 'friend', name: 'Max', shape: { species: 'person', personality: 'cheerful, loves building things and bad puns' } }) }],
    },
    codex: {
      group: 'Living things',
      what: 'An AI friend you talk to (T, or click them): follows you, carries things, sits, dances, plays fetch, builds with you, rides along, cheers. They understand plain commands and answer in character (their personality, their species\' voice), for free.',
      spec: { type: 'friend', name: 'Max', shape: { species: 'person', personality: 'cheerful, loves building things and bad puns' }, transform: { position: [2, 1, 2] } },
      fields: [['name', 'what they\'re called', 'Max'], ['shape.personality', 'who they are, in words', ''], ['shape.species', 'person, robot, dog, cat, dinosaur... (any creature)', 'person'], ['shape.follow', 'false: stays put (a villager); "player" or a name', 'player'], ['shape.lines', 'things they say when you come near', ''], ['shape.talk', 'false: no chat', 'true'], ['shape.color', 'their shirt (people) or body', '']],
    },
  });

  const friends = () => living._records().filter((r) => r.friend && r.e.alive);
  const canTalk = (e) => e && e.alive && e.living && e.living.friend && e.living.friend.talk !== false;
  const nearestFriend = (p, reach = 4) => { let best = null, bd = reach; for (const r of friends()) { const d = Math.hypot(r.e.x - p.x, r.e.z - p.z); if (d < bd && r.friend.talk !== false) { bd = d; best = r; } } return best; };
  // E (or T) near a friend opens the chat (H.use: the engine picks between this, riding, vehicles, chairs...).
  H.use.register('living:talk', {
    keys: ['t'],
    near(p) {
      if (panel && panel.friend) return null;
      const r = nearestFriend(p);
      return r ? { label: `Talk to ${r.friend.name}`, key: 't', distance: Math.hypot(r.e.x - p.x, r.e.z - p.z), act: () => open(r.e) } : null;
    },
  });

  // ------------------------------------------------------------------ understanding plain words (free, offline)
  const INTENTS = [
    ['follow', /\b(follow|come with|with me|let'?s go|this way|keep up)\b/],
    ['stay', /\b(stay|wait|stop|hold on|don'?t move|freeze|halt)\b/],
    ['come', /\b(come (here|back|over)|over here|to me)\b/],
    ['sit', /\b(sit|take a seat)\b/],
    ['sleep', /\b(sleep|nap|rest|lie down|go to bed)\b/],
    ['dance', /\b(dance|boogie|party|groove)\b/],
    ['cheer', /\b(cheer|jump|celebrate|yay|hooray)\b/],
    ['fetch', /\b(fetch|ball|throw)\b/],
    ['drop', /\b(drop|put (it|that|this) down|let go)\b/],
    ['carry', /\b(carry|pick (it|that|this)? ?up|grab|bring|hold)\b/],
    ['build', /\b(build|make|place|stack|tower|wall|put a|spawn)\b/],
    ['drive', /\b(drive|get in|hop in|ride|car|truck|boat|plane|helicopter|vehicle)\b/],
    ['flee', /\b(run away|hide|flee|run!)\b/],
    ['attack', /\b(attack|get (him|her|them|it)|fight|bite)\b/],
    ['wander', /\b(explore|wander|go play|look around|free|go away|leave me)\b/],
  ];
  const COLORS = { red: '#e53935', blue: '#1e88e5', green: '#43a047', yellow: '#fdd835', orange: '#fb8c00', purple: '#8e24aa', pink: '#ec407a', white: '#f5f5f5', black: '#212121', gray: '#9e9e9e', grey: '#9e9e9e', brown: '#8d6e63', gold: '#f4c430' };
  /** What a sentence asks for: { action, thing, target }. */
  function understand(text) {
    const t = String(text || '').toLowerCase();
    let action = 'none';
    for (const [a, re] of INTENTS) if (re.test(t)) { action = a; break; }
    let thing = null;
    if (action === 'build') {
      const kind = /\b(ball|sphere)\b/.test(t) ? 'sphere' : /\b(pillar|column|cylinder|barrel)\b/.test(t) ? 'cylinder' : /\b(cone|spike|pyramid)\b/.test(t) ? 'cone' : 'box';
      const color = Object.keys(COLORS).find((c) => new RegExp(`\\b${c}\\b`).test(t));
      const n = /\b(tower|stack)\b/.test(t) ? 5 : /\bwall\b/.test(t) ? 6 : Number((/\b(\d+)\b/.exec(t) || [])[1]) || 1;
      thing = { kind, color: color ? COLORS[color] : null, size: /\b(big|huge|giant|large)\b/.test(t) ? 2 : /\b(small|tiny|little)\b/.test(t) ? 0.5 : 1, count: Math.min(12, n), wall: /\bwall\b/.test(t) };
    }
    return { action, thing, target: null };
  }

  // In character without an AI: a phrasebook, flavored by the personality (grumpy, shy, silly, brave...) and the species.
  const LINES = {
    follow: ['Right behind you!', 'Lead the way!', 'Coming!', 'Wherever you go, I go.'],
    stay: ["I'll wait right here.", 'Staying put.', "Okay, I won't move."],
    come: ['On my way!', 'Coming over!'],
    sit: ['Taking a seat.', "Ahh, that's better."],
    sleep: ['Just five minutes...', 'Zzz...'],
    dance: ['Watch these moves!', 'Dance party!', 'You call that dancing? THIS is dancing!'],
    cheer: ['Woohoo!', 'Yes! Nice one!', 'Amazing!'],
    fetch: ['Throw it! Throw it!', 'Ready when you are!'],
    carry: ['Got it.', "I'll carry that."],
    drop: ['Putting it down.', 'There you go.'],
    build: ['One coming right up!', 'Building!', 'Let me help with that.'],
    drive: ["Let's ride!", 'Shotgun!'],
    wander: ["I'll go look around.", 'Exploring!'],
    flee: ['Run!', 'Hide!'],
    attack: ['Charge!', 'Leave it to me!'],
    hello: ['Hey!', 'Hi there!', 'Oh, hello!', "There you are!"],
    chat: ['Ha! Good one.', 'Tell me more.', 'I like it here.', "You're fun to hang out with.", "Hmm, I'm not sure, but I'm with you.", 'Want to build something?'],
    scared: ['Whoa!', 'Yikes!', 'That was loud!', 'Ahh!'],
    ouch: ['Ouch!', 'Hey, that hurt!'],
    win: ['We did it!', 'Woohoo!', "That's how it's done!"],
    noVehicle: ["I don't see anything to drive around here."],
  };
  const MOODS = {
    grumpy: { follow: ["Fine, I'm coming.", 'Ugh. Lead on.'], chat: ['Hmph.', 'If you say so.', 'Whatever.'], hello: ['Oh. It\'s you.'], dance: ['I do NOT dance. ...Okay, just once.'] },
    shy: { follow: ['O-okay...', "I'll stay close."], chat: ['Um... yeah.', "I'm not good at talking, but I like you."], hello: ['H-hi...'] },
    silly: { chat: ['Did you know cows can\'t walk down stairs? Neither can I, sometimes.', 'Banana.', 'I once raced a snail. It was close.'], dance: ['Behold: the noodle!'], hello: ['Ahoy, friend-shaped person!'] },
    brave: { follow: ["I've got your back."], scared: ["Ha! Is that all?"], attack: ['For glory!'] },
  };
  const SOUNDS = { dog: ['Woof!', 'Woof woof!', 'Arf!'], cat: ['Meow.', 'Mrrp?', 'Purrr...'], robot: null, dinosaur: ['ROAAAR!', 'Rawr!'], horse: ['Neigh!'], cow: ['Moo.'], chicken: ['Bawk!'], sheep: ['Baa!'], pig: ['Oink!'], bird: ['Tweet!'], wolf: ['Awoo!'], bear: ['Grrr.'] };
  function moodOf(f) { const p = f.personality.toLowerCase(); return /grump|grouch|cranky|sarcas/.test(p) ? 'grumpy' : /shy|quiet|timid|nervous/.test(p) ? 'shy' : /silly|goofy|funny|pun|joke/.test(p) ? 'silly' : /brave|bold|hero|tough|warrior/.test(p) ? 'brave' : null; }
  function line(r, what) {
    const f = r.friend, m = moodOf(f), sounds = SOUNDS[r.name];
    if (sounds) return `${pick(sounds)}${what === 'chat' || what === 'hello' ? '' : ` *${{ follow: 'trots after you', stay: 'sits and waits', fetch: 'bounces excitedly', dance: 'spins around', cheer: 'jumps for joy', carry: 'grabs it', drop: 'drops it', scared: 'jumps', ouch: 'yelps', come: 'runs over', sleep: 'curls up', sit: 'sits', win: 'does a happy dance' }[what] || 'tilts head'}*`}`;
    const set = (m && MOODS[m][what]) || LINES[what] || LINES.chat;
    let s = pick(set);
    if (r.name === 'robot') s = `${s.replace(/!$/, '.')} *beep*`;
    return s;
  }

  // ------------------------------------------------------------------ talking: the phrasebook (free)
  /** Says something to a friend: their answer and what they do (a promise of { say, action }). */
  async function talk(e, text) {
    const r = e && e.living;
    if (!r || !r.friend) return null;
    const f = r.friend;
    const msg = String(text || '').trim().slice(0, 300);
    if (!msg) return null;
    r.awake = true;
    f.greeted = true;
    remember(r, 'you', msg);
    const local = understand(msg);
    const reply = { say: line(r, local.action === 'none' ? (/\b(hi|hello|hey|yo)\b/i.test(msg) ? 'hello' : 'chat') : local.action), action: local.action, target: local.target, thing: local.thing };
    if (reply.action === 'build' && !reply.thing) reply.thing = understand(msg).thing || { kind: 'box', count: 1 };
    const p = G().player;
    // Where they're looking (for building in front of them).
    const yaw = W().camera && typeof W().camera.yaw === 'number' ? W().camera.yaw : p ? p.node.rotation.y : 0;
    const at = p ? [+(p.x + Math.sin(yaw) * 4.5).toFixed(2), +p.bottom.toFixed(2), +(p.z + Math.cos(yaw) * 4.5).toFixed(2)] : [e.x, e.bottom, e.z + 2];
    act({ key: f.key, say: reply.say, action: reply.action, target: reply.target, thing: reply.thing, by: H.sync && H.sync.online ? H.sync.me : null, at, yaw });
    return reply;
  }

  // What a friend says and does reaches everyone (the host decides once; everyone hears it).
  let act = (d) => apply(d, { authoritative: true });
  function setupSync() { if (H.sync && H.sync.action) act = H.sync.action('living:friend', (d, o) => apply(d, o)); }
  setupSync();
  function friendByKey(key) { for (const r of friends()) if (r.friend.key === key) return r; return null; }
  function asker(d) { return d.by ? `net:${d.by}` : 'player'; }
  const askedHere = (d) => !d.by || !H.sync || !H.sync.online || d.by === H.sync.me;
  const STAY_LINES = ["I'll stay right here. Off you go!", "I'm not going anywhere: this is my spot.", "You go ahead, I'll wait here!", "I'll be right here when you get back."];
  function apply(d, o) {
    const r = friendByKey(d.key);
    if (!r) return;
    const e = r.e;
    if (r.friend.stays && ['follow', 'come', 'drive', 'wander', 'flee'].includes(d.action)) d = { ...d, action: 'none', say: pick(STAY_LINES) };
    if (d.say) { e.say(d.say, Math.min(8, 2.5 + d.say.length / 18)); remember(r, r.friend.name, d.say); }
    const who = living._resolve(asker(d));
    if (who && d.action === 'none') e.lookAt(who);
    r.seatOn = d.action === 'drive' ? r.seatOn : null;
    switch (d.action) {
      case 'follow': living.command(e, 'follow', { target: asker(d) }); break;
      case 'come': living.command(e, 'come', { target: asker(d), near: 2.2 }); break;
      case 'stay': case 'sit': case 'sleep': case 'dance': case 'wander': living.command(e, d.action); break;
      case 'cheer': living.command(e, 'cheer', { seconds: 3 }); break;
      case 'flee': living.command(e, 'flee', { target: asker(d) }); break;
      case 'drop': living.command(e, 'drop'); break;
      case 'carry': living.command(e, 'carry', { thing: d.target || null, by: asker(d) }); break;
      case 'attack': { const t = d.target && living._resolve(d.target); if (t) living.command(e, 'attack', { target: t }); break; }
      case 'fetch': {
        living.command(e, 'fetch', { target: asker(d) });
        // A ball for whoever asked (if their hands are free).
        const p = G().player;
        if (askedHere(d) && p && !p.tool && H.mode !== 'build') p.tool = 'ball';
        break;
      }
      case 'build': build(r, d); break;
      case 'drive': drive(r, d); break;
      default: break;
    }
    renderPanel();
  }

  // ------------------------------------------------------------------ building with you
  /** Puts what was asked for in front of whoever asked: in the editor it's a real world edit (saved, undoable), while
   *  playing it's there for this game. A tower stacks, a wall goes side by side. */
  function build(r, d) {
    const th = d.thing || {};
    const kind = ['box', 'sphere', 'cylinder', 'cone'].includes(th.kind) ? th.kind : 'box';
    const size = Math.max(0.3, Math.min(4, Number(th.size) || 1));
    const n = Math.max(1, Math.min(12, Number(th.count) || 1));
    const color = /^#[0-9a-f]{6}$/i.test(String(th.color)) ? th.color : pick(['#e53935', '#1e88e5', '#43a047', '#fdd835', '#fb8c00', '#8e24aa']);
    const at = d.at || [r.e.x, r.e.bottom, r.e.z + 2];
    const yaw = Number(d.yaw) || 0, side = { x: Math.cos(yaw), z: -Math.sin(yaw) };
    living.command(r.e, 'goto', { at: [at[0] - Math.sin(yaw) * 1.5, at[2] - Math.cos(yaw) * 1.5], near: 1.2 });
    const specs = [];
    for (let i = 0; i < n; i++) {
      const wall = Boolean(th.wall); // side by side; otherwise a tower
      const off = wall ? (i - (n - 1) / 2) * size : 0;
      const y = at[1] + size / 2 + (wall ? 0 : i * size);
      const pos = [+(at[0] + side.x * off).toFixed(2), +y.toFixed(2), +(at[2] + side.z * off).toFixed(2)];
      const shape = kind === 'box' ? { size: [size, size, size] } : kind === 'sphere' ? { radius: size / 2 } : { radius: size / 2, height: size };
      specs.push({ type: kind, name: `${r.friend.name}'s ${kind === 'box' ? 'block' : kind}`, transform: { position: pos, rotation: [0, Math.round(yaw / (Math.PI / 180)), 0] }, material: { color }, shape, physics: n > 1 ? 'static' : 'dynamic' });
    }
    const g = G();
    if (H.mode === 'build') {
      // The editor: a real edit, from the one who asked (saved and shared with everyone building).
      if (askedHere(d) && window.HawkesBuild && window.HawkesBuild.edit) window.HawkesBuild.edit(specs.map((entity) => ({ op: 'create', entity })), { label: `${r.friend.name} built`, fx: 'materialize' });
    } else {
      for (const s of specs) {
        const make = g[s.type];
        if (!make) continue;
        make({ ...s.shape, position: s.transform.position, rotation: s.transform.rotation, color, physics: s.physics, name: s.name, tag: 'built' });
      }
    }
    if (g) g.burst(at, { color: '#9be7ff', count: 30, speed: 3 });
  }

  // ------------------------------------------------------------------ riding along, driving (the Vehicles module)
  const VEHICLE = /car|truck|jeep|4x4|bus|kart|bike|motorbike|bicycle|boat|sub|submarine|plane|airplane|helicopter|vehicle|tractor|tank/;
  function vehicleNear(e, radius = 25) {
    const V = H.vehicles;
    if (V && typeof V.nearest === 'function') { const v = V.nearest([e.x, e.y, e.z], radius); if (v) return v; }
    let best = null, bd = radius;
    for (const o of W().entities) {
      if (!o.alive || o.living || o.isPlayer) continue;
      if (!(o.vehicle || (o.data && o.data.vehicle) || (V && Array.isArray(V.kinds) && V.kinds.includes(o.kind)) || VEHICLE.test(String(o.kind)))) continue;
      const d = Math.hypot(o.x - e.x, o.z - e.z);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }
  function drive(r, d) {
    const e = r.e, v = vehicleNear(e);
    if (!v) { e.say(line(r, 'noVehicle'), 3); return; }
    const V = H.vehicles;
    // The Vehicles module seats them properly (as the driver if asked and allowed).
    if (V && typeof V.board === 'function') { try { if (V.board(v, e, { driver: /drive/.test(String(d.target || '')) || d.wantsDriver === true }) !== false) return; } catch (err) { H.report(err, 'living'); } }
    // Otherwise: hop on and ride along.
    r.seatOn = v;
    living.command(e, 'sit');
  }
  H.physics.afterStep(() => {
    for (const r of friends()) {
      const v = r.seatOn;
      if (!v) continue;
      if (!v.alive || (r.command && r.command.do !== 'sit')) { r.seatOn = null; r.e.gravity = 1; continue; }
      r.e.node.position.set(v.x, v.box().max[1] + r.tall / 2 - 0.15, v.z);
      r.e.node.rotation.y = v.node.rotation.y;
      r.e.velocity = [0, 0, 0];
      r.e.gravity = 0;
    }
  });

  // ------------------------------------------------------------------ reacting to the world
  const lastSaid = new Map();
  function blurt(r, what, every = 4) {
    const t = now();
    if ((lastSaid.get(r) || -99) > t - every) return;
    lastSaid.set(r, t);
    const s = line(r, what);
    r.e.say(s, 2.5);
    remember(r, r.friend.name, s);
  }
  living.on('startle', (at, o) => { for (const r of friends()) if (Math.hypot(r.e.x - at[0], r.e.z - at[2]) < (o.radius || 15) && (o.strength ?? 1) > 0.9) blurt(r, 'scared'); });
  living.on('hurt', (r) => { if (r.friend) blurt(r, 'ouch', 2); });
  living.on('world', () => {
    const g = G();
    if (!g) return;
    lastSaid.clear();
    // Cheer when you win something.
    for (const ev of ['finish', 'checkpoint', 'kill', 'gate', 'goal', 'score', 'win', 'pickup']) g.on(ev, (d) => {
      for (const r of friends()) {
        if (ev === 'pickup' && Math.random() < 0.7) continue;
        if (ev !== 'pickup') living.command(r.e, 'cheer', { seconds: 2.5 });
        blurt(r, ev === 'pickup' ? 'cheer' : 'win', 2);
      }
      void d;
    });
  });
  // Saying hello (or their lines) when you come near; leaving the chat when you walk away.
  let greetAt = 0;
  H.hooks.frame.push(() => {
    const t = now(), w = W();
    if (!w || t < greetAt) return;
    greetAt = t + 0.5;
    const p = w.player;
    if (!p || !p.alive) return;
    for (const r of friends()) {
      const d = Math.hypot(r.e.x - p.x, r.e.z - p.z);
      if (H.mode !== 'build' && d < 5 && !r.friend.greeted) { r.friend.greeted = true; r.e.lookAt(p); const s = r.friend.lines && r.friend.lines.length ? pick(r.friend.lines) : line(r, 'hello'); r.e.say(s, 3); remember(r, r.friend.name, s); }
      else if (d > 12) r.friend.greeted = r.friend.lines && r.friend.lines.length ? false : r.friend.greeted;
    }
    if (panel && panel.friend && (!panel.friend.alive || Math.hypot(panel.friend.x - p.x, panel.friend.z - p.z) > 14)) close();
  });

  // ------------------------------------------------------------------ the chat: a panel with quick buttons (phones too)
  function remember(r, who, text) { const log = r.friend.log; log.push({ who, text: String(text) }); if (log.length > 30) log.shift(); if (panel && panel.friend === r.e) renderPanel(); }
  function note(r, text) { remember(r, '', text); }
  let panel = null;
  const CHIPS = [['Follow me', 'Follow me'], ['Stay', 'Stay here'], ['Come here', 'Come here'], ['Dance', 'Dance!'], ['Fetch', "Let's play fetch"], ['Carry this', 'Carry this'], ['Build a tower', 'Build a tower'], ['Get in', 'Get in the car'], ['Sit', 'Sit down']];
  function styles() {
    if (document.getElementById('lv-chat-style')) return;
    const st = document.createElement('style');
    st.id = 'lv-chat-style';
    st.textContent = '.lv-chat{position:fixed;top:12px;left:50%;transform:translateX(-50%);width:min(440px,calc(100vw - 24px));z-index:40;background:rgba(12,16,28,.9);color:#eef2ff;border:1px solid rgba(255,255,255,.18);border-radius:16px;font:14px/1.4 system-ui,sans-serif;box-shadow:0 10px 40px rgba(0,0,0,.45);backdrop-filter:blur(6px);display:flex;flex-direction:column;max-height:min(70vh,520px)}.lv-chat header{display:flex;align-items:center;gap:8px;padding:10px 12px 6px}.lv-chat header b{font-size:16px}.lv-chat header span{opacity:.65;font-size:12px;flex:1}.lv-chat header button{background:none;border:0;color:#fff;font-size:20px;cursor:pointer;padding:4px 8px}.lv-log{overflow:auto;padding:0 12px;display:flex;flex-direction:column;gap:4px;min-height:40px}.lv-log p{margin:0}.lv-log .me{color:#9ecbff}.lv-log .note{opacity:.6;font-size:12px;font-style:italic}.lv-chips{display:flex;flex-wrap:wrap;gap:6px;padding:8px 12px}.lv-chips button{font:600 13px system-ui;color:#fff;background:rgba(125,211,252,.16);border:1px solid rgba(125,211,252,.4);border-radius:999px;padding:7px 11px;cursor:pointer;min-height:34px}.lv-chat form{display:flex;gap:8px;padding:0 12px 12px}.lv-chat input{flex:1;min-width:0;font:15px system-ui;color:#fff;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.2);border-radius:10px;padding:10px}.lv-chat form button{font:700 14px system-ui;color:#0b1020;background:#7dd3fc;border:0;border-radius:10px;padding:0 16px;cursor:pointer;min-height:42px}';
    document.head.appendChild(st);
  }
  function open(e) {
    if (!canTalk(e)) return;
    styles();
    close();
    const r = e.living;
    r.awake = true;
    const el = document.createElement('div');
    el.className = 'lv-chat';
    el.setAttribute('role', 'dialog'); // (the engine frees the mouse while you talk)
    el.innerHTML = '<header><b></b><span></span><button type="button" aria-label="Close">✕</button></header><div class="lv-log"></div><div class="lv-chips"></div><form><input maxlength="300" autocomplete="off"><button type="submit">Send</button></form>';
    el.querySelector('b').textContent = r.friend.name;
    const input = el.querySelector('input');
    input.placeholder = `Say something to ${r.friend.name}...`;
    for (const [label, text] of CHIPS) { if (r.friend.stays && /^(Follow me|Come here|Get in)$/.test(label)) continue; const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.onclick = () => send(text); el.querySelector('.lv-chips').appendChild(b); }
    const send = (text) => { if (!text.trim()) return; talk(e, text); input.value = ''; };
    el.querySelector('form').onsubmit = (ev) => { ev.preventDefault(); send(input.value); };
    el.querySelector('header button').onclick = close;
    input.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); close(); } ev.stopPropagation(); });
    for (const t of ['pointerdown', 'wheel', 'touchstart']) el.addEventListener(t, (ev) => ev.stopPropagation(), { passive: true });
    document.body.appendChild(el);
    panel = { el, friend: e };
    const g = G();
    if (g && g.input && g.input.release) g.input.release();
    e.lookAt(g.player);
    if (!H.touchUi) setTimeout(() => input.focus(), 30);
    renderPanel();
  }
  function close() { if (!panel) return; panel.el.remove(); panel = null; }
  // Other modules' buttons in the chat (a quest to give, a shop...): H.living.chat.addChip({ label, show, act }).
  const extraChips = [];
  living.chat = {
    /** A button in a friend's chat: label (text, or fn(friend) -> text), show(friend) -> true when it belongs there,
     *  act(friend) when tapped. Returns a function that takes it away. */
    addChip(def) {
      if (!def || typeof def.act !== 'function') throw new Error('H.living.chat.addChip({ label, show(friend), act(friend) })');
      extraChips.push(def);
      renderPanel();
      return () => { const i = extraChips.indexOf(def); if (i >= 0) extraChips.splice(i, 1); renderPanel(); };
    },
    /** Redraws the open chat's buttons (when what show() says has changed). */
    refresh: () => renderPanel(),
    get friend() { return panel ? panel.friend : null; },
  };
  function renderExtras() {
    const box = panel.el.querySelector('.lv-chips');
    if (!box) return;
    for (const b of [...box.querySelectorAll('.lv-extra')]) b.remove();
    const e = panel.friend;
    for (const c of extraChips) {
      let on = false, label = '';
      try { on = !c.show || c.show(e); if (on) label = typeof c.label === 'function' ? c.label(e) : c.label; } catch (err) { H.report(err, 'friend chat'); }
      if (!on || !label) continue;
      const b = document.createElement('button');
      b.type = 'button'; b.className = `lv-extra ${c.className || ''}`; b.textContent = String(label);
      if (c.style) b.setAttribute('style', c.style);
      b.onclick = () => { try { c.act(e); } catch (err) { H.report(err, 'friend chat'); } };
      if (box.insertBefore) box.insertBefore(b, box.firstChild); else box.appendChild(b);
    }
  }
  function renderPanel() {
    if (!panel) return;
    const r = panel.friend.living;
    if (!r) return;
    renderExtras();
    const s = living.status(panel.friend);
    panel.el.querySelector('header span').textContent = s ? `${{ follow: 'following you', stay: 'waiting', sit: 'sitting', sleep: 'asleep', dance: 'dancing', fetch: 'playing fetch', carry: 'carrying', chase: 'on the attack', flee: 'running!', goto: 'on the way', come: 'coming', wander: 'exploring', idle: s.following ? 'with you' : 'hanging out' }[s.act] || s.act}${s.carrying ? ` · holding ${s.carrying}` : ''}` : '';
    const log = panel.el.querySelector('.lv-log');
    log.textContent = '';
    for (const m of r.friend.log.slice(-10)) {
      const p = document.createElement('p');
      if (!m.who) { p.className = 'note'; p.textContent = m.text; }
      else { p.className = m.who === 'you' ? 'me' : ''; p.textContent = `${m.who === 'you' ? 'You' : m.who}: ${m.text}`; }
      log.appendChild(p);
    }
    log.scrollTop = log.scrollHeight;
  }
  H.hooks.world.push({ leave() { close(); } });

  Object.assign(living, {
    /** Talks to a friend: talk(friend, 'follow me'). A promise of { say, action }. */
    talk,
    /** Opens the chat with a friend (or closes it: openChat(null)). */
    openChat: (e) => (e ? open(e) : close()),
    friends: () => friends().map((r) => r.e),
    understand,
    /** Makes a friend do something and say something (as if they decided it): act(friend, 'dance', 'Watch this!'). */
    act: (e, action, say, o = {}) => { const r = e && e.living; if (r && r.friend) act({ key: r.friend.key, say: say || '', action: ACTIONS.includes(action) ? action : 'none', thing: o.thing || null, target: o.target || null, at: o.at || null, yaw: o.yaw || 0, by: H.sync && H.sync.online ? H.sync.me : null }); return e; },
  });
})();
