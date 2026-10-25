// The island's guide. The world (scene.json) has the island, its toys and the quest line ("The island", config.quests);
// this script is how it feels: once the Overseer has beamed you down and you've been to the mirror (who you are:
// modules/mirror, by itself after the intro), Pip comes over, greets you and offers the tour, every step
// done has its moment (a sound, confetti, Pip's line, the Overseer's words), and the island sounds like one: the sea
// and the birds, gentle music, all through the engine's sound (asked for once the intro starts, faded in once loaded).
// Sounds and music are assets by name (the community library's); a game without one plays on quietly.

const H = window.HawkesPlay;
const sfx = (name, o) => { if (game.hasAsset(name)) game.sound(name, o); };
const pip = () => game.all('Pip')[0] || null;
const say = (text, seconds = 4) => { const p = pip(); if (p && p.say) p.say(text, seconds); };
const overseer = (text, seconds = 5, voice = null) => {
  // Spoken through the Overseer (its voice, by name; the music and the sea dip under it), else just its words.
  if (voice && game.overseer && game.overseer.speak) game.overseer.speak(text, voice, seconds);
  else if (game.overseer && game.overseer.say) game.overseer.say(text, seconds);
};
const confetti = () => {
  const p = game.player;
  if (!p) return;
  game.burst([p.x, p.y + 1.4, p.z], { color: '#ffd84a', count: 70, speed: 7, size: 0.28 });
  game.burst([p.x, p.y + 1.8, p.z], { color: '#7dd3fc', count: 50, speed: 6, size: 0.22 });
  game.burst([p.x, p.y + 1.6, p.z], { color: '#f472b6', count: 40, speed: 6.5, size: 0.24 });
};

// ------------------------------------------------------------------ the island's sound
// The music, the sea and the birds are loops of their own through the engine's output. None is fetched before the world
// is playable: the elements are made with preload "none" (no request) and only asked for once the intro has started (the
// intro's voice is warmed first and goes first), and each one fades in only after it has loaded, so nothing waits on a
// download and the first frame is never held up by sound. (J, 2026-10-25: the files were 2.66 MB of the first play.)
const sounds = (window.__islandLoops = window.__islandLoops || []);
for (const s of sounds.splice(0)) { try { s.el.pause(); } catch { /* gone */ } }
// What was asked of the network and what played, for the playtest's timeline (the page's console shows it too).
const audioLog = (window.__islandAudioLog = []);
const logAudio = (what, name) => { audioLog.push({ t: Math.round(performance.now()), what, name }); try { console.log(`island audio: ${what} ${name}`); } catch { /* fine */ } };
const FADE_IN = 1.5; // seconds from silent to the sound's own level, once it has loaded
const MUSIC_VOLUME = 0.14; // (Quiet enough to talk over: J, 2026-10-24, "I can't hear the voices".)
function loop(name, target) {
  if (!game.hasAsset(name) || !H || !H.audio || !H.audio.media) return null;
  try {
    const el = new Audio();
    el.preload = 'none'; // (no request until load() below)
    el.crossOrigin = 'anonymous';
    el.loop = true;
    el.volume = 0;
    el.src = game.asset(name);
    H.audio.media(el, { background: true }); // (background: it dips under the Overseer's voice)
    const s = { name, el, target, fade: 0, ready: false };
    sounds.push(s);
    return s;
  } catch { return null; }
}
const music = loop('meadow.mp3', MUSIC_VOLUME);
const sea = loop('ocean-waves.mp3', 0);
const birds = loop('forest.mp3', 0.05);
/** Asks for the file now; it plays and fades in when the browser says it can play through. */
function fetchSound(s) {
  if (!s || s.asked) return;
  s.asked = true;
  const ready = () => { if (s.ready) return; s.ready = true; logAudio('ready', s.name); playSound(s); };
  s.el.addEventListener('canplaythrough', ready, { once: true });
  s.el.preload = 'auto';
  logAudio('request', s.name);
  try { s.el.load(); } catch { /* it tries again on play */ }
}
function playSound(s) {
  s.el.play().then(() => { if (!s.started) { s.started = true; s.fadeFrom = performance.now(); logAudio('start', s.name); } }).catch(() => {});
}
let sounding = false;
function startSound() {
  if (sounding || game.mode !== 'play') return;
  sounding = true;
  // The music first (it carries the first minute), then the sea and the birds.
  for (const s of [music, sea, birds]) fetchSound(s);
}
// The sea is heard by the shore: quiet, and fading out as you walk inland (silent ~70 m from the water) or go up; the
// birds stay over the land. (A loop the browser held back starts as soon as sound is allowed: the first click or key.)
const SEA = -1.5; // config.water.level
const SEA_MAX = 0.06;
/** How far the nearest sea is (meters, 0 over it), from the ground's height in rings around you. */
function seaDistance(x, z) {
  const ground = (px, pz) => { const t = game.terrain && game.terrain.heightAt ? game.terrain.heightAt(px, pz) : null; return t === null || t === undefined ? -99 : t; };
  if (ground(x, z) < SEA + 0.3) return 0;
  for (const d of [6, 12, 20, 30, 45, 70]) for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    if (ground(x + Math.cos(a) * d, z + Math.sin(a) * d) < SEA + 0.3) return d;
  }
  return Infinity;
}
let seaVol = 0;
game.every(0.25, () => {
  if (!game.player) return;
  const now = performance.now();
  for (const s of sounds) {
    if (!s.ready) continue;
    // A loop the browser held back starts as soon as sound is allowed: the first click or key.
    if (s.el.paused && H.audio.context && H.audio.context.state === 'running') playSound(s);
    s.fade = s.started ? Math.min(1, (now - s.fadeFrom) / (FADE_IN * 1000)) : 0;
  }
  const p = game.player;
  const h = game.planet ? game.planet.height(p.position) : p.y;
  const d = seaDistance(p.x, p.z);
  const near = d === Infinity ? 0 : Math.pow(Math.max(0, 1 - d / 70), 1.6);
  const up = Math.max(0, 1 - Math.max(0, h - 8) / 120);
  const want = SEA_MAX * near * up;
  seaVol += (want - seaVol) * 0.35; // (eased: no jumps as you walk)
  const level = (s, v) => { if (s) s.el.volume = Math.max(0, Math.min(1, v * s.fade)); };
  level(music, music && music.target);
  level(sea, seaVol);
  const onLand = d > 0;
  level(birds, onLand && h < 60 ? 0.05 : 0.01);
});

// ------------------------------------------------------------------ the beginning: Pip offers the tour
let began = false;
function begin() {
  if (began || game.mode !== 'play') return;
  // The guest page (/play/sandbox): the account comes first, then the tour goes on in the editor (public/play/guest.js).
  if (window.HawkesGuest && window.HawkesGuest.accountFirst) return void game.after(2, begin);
  began = true;
  startSound();
  // Pip walks over to meet you (and stays put after: the tour sends you places, Pip waves you on).
  const p = pip();
  const living = H && H.living;
  if (p && living && living.command) { try { living.command(p, 'come', { target: 'player' }); } catch { /* Pip stays */ } game.after(7, () => { try { living.command(p, 'stay'); } catch { /* fine */ } }); }
  const me = H && H.presence && H.presence.look;
  const name = me && me.name;
  game.after(1.2, () => say(name ? `Hi, ${name}! I'm Pip. Welcome to the island!` : 'Hi! I\'m Pip. Welcome to the island!', 4));
  game.after(3.4, () => {
    const q = game.events && game.events.quests;
    if (q && q.state('tour') === 'available') q.start('tour');
    say('Come on, I\'ll show you around. The 4x4 first!', 4);
  });
}
// After the Overseer's intro (it plays every time here) and the mirror that follows it, or straight away when there
// are neither. The mirror says when you're done (game.on('mirror')); while it's open (or about to open) Pip waits.
const mirrorBusy = () => Boolean(game.mirror && game.mirror.pending);
function afterMirror() { if (!mirrorBusy()) begin(); }
game.on('mirror', (d) => { if (d && (d.state === 'done' || d.state === 'skip')) game.after(1.6, begin); });
// The intro's voice is warmed first, the moment the world is playable (the one file asked for before the music), so it is
// ready when the intro speaks; the music and loops are asked for when the intro starts (or a second after the start when
// there is none), once the voice is in or after 1.5 s, whichever is first.
let voiceWarm = Promise.resolve();
const VOICE = 'overseer-intro.mp3';
function warmVoice() {
  if (!game.hasAsset(VOICE) || typeof fetch !== 'function') return;
  logAudio('request', VOICE);
  voiceWarm = fetch(game.asset(VOICE), { mode: 'cors' }).then((r) => r.arrayBuffer()).then(() => logAudio('ready', VOICE)).catch(() => {});
}
function soundAfterVoice() {
  if (sounding) return;
  Promise.race([voiceWarm, new Promise((r) => setTimeout(r, 1500))]).then(() => startSound());
}
// The gateway's one gesture (Enter, a click or a tap) unlocks the sound: the music, the sea and the birds start right then.
game.on('gateway', () => { warmVoice(); startSound(); });
game.on('intro', (d) => {
  if (!d) return;
  if (d.state === 'start') soundAfterVoice();
  if (d.state === 'end') { startSound(); game.after(1, afterMirror); } // (skipped or not, the island sounds)
});
game.onStart(() => {
  const intro = Boolean(H && H.overseer && H.overseer.introWanted && H.overseer.introWanted());
  // (An intro that never ends: begin anyway, unless the mirror is open: then when it closes.)
  if (intro) warmVoice(); else game.after(1, soundAfterVoice);
  game.after(intro ? 40 : 2.5, afterMirror);
});

// ------------------------------------------------------------------ each step done: its moment
// The Overseer speaks each moment (the community library's Overseer voice, by name), and its words show as a caption.
// "Do with it what you will" is the beginning's alone: said once, in the intro.
const MOMENTS = {
  drive: { sound: 'level-up.mp3', pip: 'You made it! The rod is at the end of the pier. Hold click to cast, click when the bobber dips.', overseer: 'You found your way. Good.', voice: 'overseer-found-your-way.mp3' },
  fish: { sound: 'power-up.mp3', pip: 'A fish! Here, take the rocket launcher. See the barrels up the beach? Go on.', overseer: 'The sea gives. Remember that.', voice: 'overseer-the-sea-gives.mp3', give: ['rocket-launcher'] },
  boom: { sound: 'level-up.mp3', pip: 'BOOM! Now ask the Overseer for something: hold Q and pick anything.', overseer: 'Destruction is a kind of freedom too.', voice: 'overseer-destruction.mp3' },
  // (The Overseer's "Ask, and I will send it down" is said when they first hold Q: below.)
  spawn: { sound: 'teleport.mp3', pip: 'It came from the Overseer! It listens, too: tell it what you want in the chat. Anything!' },
  // The Overseer in the chat: what you ask for, it makes (on the player's credits). Its answer is in the chat too.
  ask: { sound: 'teleport.mp3', pip: 'It heard you! Last one: the helicopter on the hill. Go up, way up.', overseer: 'I heard you. Watch the sky.' },
  fly: { sound: 'victory.mp3', pip: 'Look down! That speck in the sea is our island. The spawn gun and the gravity gun are yours too.', overseer: 'That is your world. All of it.', voice: 'overseer-your-world.mp3', seconds: 6, give: ['spawn-gun', 'gravity-gun'] },
};
// Each moment plays once: a step the quest enters again (a restored or re-synced quest state, a second blast of the
// same barrels) must not make the Overseer say its line again. Kept on window: a script that runs again (hot reload)
// keeps its old listeners, and each one would otherwise have its own set and say the line too.
const played = (window.__islandPlayed = window.__islandPlayed || new Set());
game.on('tour', (d) => {
  const m = d && MOMENTS[d.step];
  if (!m || played.has(d.step)) return;
  played.add(d.step);
  sfx(m.sound, { volume: 0.55 });
  confetti();
  game.camera.shake(0.08, 0.2);
  game.after(0.6, () => say(m.pip, 6));
  if (m.overseer) game.after(1.4, () => overseer(m.overseer, m.seconds || 5, m.voice));
  if (m.give && game.mayhem && game.mayhem.giveTool) game.after(1, () => { for (const t of m.give) game.mayhem.giveTool(t); });
});

// ------------------------------------------------------------------ the first time they ask (hold Q: the spawn wheel)
// The Overseer answers the first ask, as the wheel opens: "Ask, and I will send it down." Once a visit.
game.on('spawn-wheel', (d) => {
  if (!d || d.state !== 'open' || window.__islandAsked) return;
  window.__islandAsked = true;
  overseer('Ask, and I will send it down.', 4, 'overseer-ask.mp3');
});

// ------------------------------------------------------------------ the barrels: teach the switch to the launcher
// On the "boom" step, a player who isn't holding the rocket launcher (they picked something else, or can't tell what
// they hold) is told how to switch: Q cycles the belt (⇄ on a phone). Said again every 12 s while it's still not out, 2 s after switching away from it (even if they've switched before).
const toolOf = (t) => (typeof t === 'string' ? t : t && (t.type || t.name)) || null;
let teachT = 2;
game.every(0.5, () => {
  const p = game.player;
  const q = game.events && game.events.quests;
  if (!p || game.mode !== 'play' || !q || q.state('tour') !== 'active' || q.step('tour') !== 'boom') { teachT = 2; return; }
  if (toolOf(p.tool) === 'rocket-launcher') { teachT = 2; return; }
  teachT -= 0.5;
  if (teachT > 0) return;
  teachT = 12;
  const belt = (game.mayhem && game.mayhem.belt) || [];
  if (belt.includes('rocket-launcher')) say(`Press ${H && H.touchUi ? 'the ⇄ button' : 'Q'} to switch to the rocket launcher, then click to fire.`, 6);
  else if (game.mayhem && game.mayhem.giveTool) game.mayhem.giveTool('rocket-launcher'); // (lost or never given: back in hand)
});

// ------------------------------------------------------------------ asking the Overseer in the chat
// The editor tells the game when you send the Overseer a message (game.on('asked')). Where there's no chat (a published
// copy of the island, the guest page), the step passes by itself.
game.every(1, () => {
  const q = game.events && game.events.quests;
  // (Where the Overseer is in the chat (the editor; the sandbox page signed in: H.chat attached), it waits for a real ask.)
  if (window.HawkesBuild || (H && H.chat && H.chat.attached) || !q || q.state('tour') !== 'active' || q.step('tour') !== 'ask') return;
  game.emit('asked', { skipped: true });
});

// ------------------------------------------------------------------ the last step: high enough to see the planet
let high = false;
game.onUpdate(() => {
  const p = game.player;
  if (high || !p || game.mode !== 'play') return;
  const h = game.planet ? game.planet.height(p.position) : p.y;
  if (h > 280) { high = true; game.emit('sandbox-high', { height: Math.round(h), mine: true }); }
});

// ------------------------------------------------------------------ the helicopter is the tour's last step
// Blow it up (the rocket launcher is yours by then) and the tour could never finish: a new one lands on the helipad a few
// seconds after the wreck, the old one cleared away. (Any helicopter that is wrecked, the spawned ones too.)
const HELIPAD = { x: 30, z: 30 };
let replacing = false;
game.on('wrecked', (d) => {
  const wreck = d && d.vehicle;
  if (!wreck || replacing || !String(wreck.type || '').includes('helicopter')) return;
  replacing = true;
  game.after(6, () => {
    replacing = false;
    try { if (wreck.alive) wreck.destroy(); } catch { /* gone */ }
    if (game.all('Helicopter').some((h) => h.alive && !(h.vehicle && h.vehicle.wrecked))) return;
    const y = game.terrain && game.terrain.heightAt ? game.terrain.heightAt(HELIPAD.x, HELIPAD.z) : null;
    game.helicopter({ x: HELIPAD.x, y: (y === null || y === undefined ? 6 : y) + 1.55, z: HELIPAD.z, rotation: [0, 200, 0], name: 'Helicopter', color: '#2b5fd9', model: wreck.shape && wreck.shape.model });
    overseer('A new one, from me.', 4, 'overseer-a-new-one.mp3');
  });
});

// ------------------------------------------------------------------ out of order: a goal done early is kept
// The quest line asks for its steps in order and only listens to the step it is on, so a player who flies first, fires the
// barrels first or catches a fish before the rod would lose that deed. Each one is kept here (on window: a script that runs
// again keeps its old listeners) and, when the quest reaches the step, it passes at once, its moment and all. Nothing is
// removed: every step still ends in its own moment, in order.
const early = (window.__islandEarly = window.__islandEarly || new Set());
const TOUR_ORDER = ['drive', 'rod', 'fish', 'boom', 'spawn', 'ask', 'fly'];
const tourStep = () => { const q = game.events && game.events.quests; return q && game.mode === 'play' && q.state('tour') === 'active' ? q.step('tour') : null; };
const mark = (step) => { if (!early.has(step)) early.add(step); };
game.on('pickup', (d) => { if (d && d.gives === 'tool' && d.tool === 'rod') mark('rod'); });
game.on('catch', (d) => { if (d && d.mine !== false) mark('fish'); });
game.on('explosion', () => mark('boom'));
game.on('spawned', () => mark('spawn'));
game.on('asked', () => mark('ask'));
game.on('sandbox-high', () => mark('fly'));
// The dock is reached on foot or by 4x4 at any time, whatever the quest is on.
game.every(0.5, () => {
  const p = game.player, dock = game.find && game.find('dock');
  if (p && dock && game.mode === 'play' && Math.hypot(p.x - dock.x, p.z - dock.z) < 9) mark('drive');
});
/** The current step is already done: let the quest through it (and the next ones the same way). */
function passEarly() {
  const step = tourStep();
  if (!step || !early.has(step) || step === 'ask') return; // (ask passes in its own way, below)
  game.after(0.6, () => {
    const q = game.events.quests;
    if (tourStep() === step && early.has(step)) { q.advance('tour'); game.emit('tour-early', { step }); }
  });
}
game.on('quest', (d) => { if (d && d.id === 'tour' && d.state === 'step') passEarly(); });
game.every(1, passEarly);

// ------------------------------------------------------------------ Stuck? R puts you and the thing you need back
// One action for a flipped 4x4, a swim in the sea, a launcher lost, barrels gone, a rod missing: you go to the place of the
// step you are on, the thing it needs goes there too (made again when it was destroyed), with the Overseer's beam over both
// and a line in its voice. R on a keyboard, the "Stuck?" button anywhere. (R is also reload: not while a gun is out.)
const HOME = {
  jeep: [4, 6.5, 90], heli: [30, 30, 200], rocket: [-38, -30, 0], rod: [86.5, -0.4], rodStand: [82, 0], dock: [58, 0], start: [-3, 1],
  barrels: [[50, -18], [51.2, -18.4], [50.5, -19.5], [51.7, -17.2], [49.6, -16.9]], beach: [55, -14],
};
// The journey up (below): 'off' until the tour is done, then 'invited' (a marker leads to the rocket) until they dock.
const journey = (window.__islandJourney = window.__islandJourney || { state: 'off', beam: null, mark: null, tut: 'burn', tilted: false, replacing: false });
const rescueMeta = (window.__islandRescue = window.__islandRescue || { count: 0, last: -99 });
const RESCUE_COOLDOWN = 2; // seconds
const ground = (x, z) => { const t = game.terrain && game.terrain.heightAt ? game.terrain.heightAt(x, z) : null; return t === null || t === undefined ? 4 : t; };
/** A place on the island (the world file's numbers) as the engine's own, which moves under a round world as you travel. */
const at = (x, y, z) => {
  const v = game.planet && game.planet.round && game.planet.toLocal ? game.planet.toLocal([x, y, z]) : [x, y, z];
  return Array.isArray(v) ? v : [v.x, v.y, v.z];
};
const settle = (e, pos, yaw) => {
  e.position = pos; e.velocity = [0, 0, 0];
  if (yaw !== undefined) e.rotation = [0, yaw, 0];
  if (e.angularVelocity) e.angularVelocity = [0, 0, 0];
  const v = e.vehicle;
  if (v) { try { if (v.vel && v.vel.set) v.vel.set(0, 0, 0); v.flipT = 0; } catch { /* fine */ } }
};
const seated = () => { const p = game.player; return Boolean(p && (p._vehRider || p.controller === 'drive')); };
const getOut = () => { try { if (seated() && game.vehicles && game.vehicles.exit) game.vehicles.exit(); } catch { /* it lets go in the move */ } };
const aliveOne = (name) => (game.all(name) || []).find((e) => e && e.alive && !(e.vehicle && e.vehicle.wrecked)) || null;
function bringVehicle(name, id, home, kind) {
  let e = aliveOne(name);
  const [hx, hz, yw] = home;
  const y = ground(hx, hz) + (kind === 'heli' ? 1.55 : kind === 'rocket' ? 6.55 : 1.4); // (the rocket stands on its pad: 1.8 m of it)
  if (e) { settle(e, at(hx, y, hz), yw); return e; }
  const old = (game.all(name) || [])[0];
  const model = old && old.shape && old.shape.model;
  try { if (old && old.alive) old.destroy(); } catch { /* gone */ }
  const maker = kind === 'heli' ? game.helicopter : kind === 'rocket' ? game.rocket : game.truck;
  if (typeof maker !== 'function') return null;
  const [lx, ly, lz] = at(hx, y, hz);
  const opts = { x: lx, y: ly, z: lz, rotation: [0, yw, 0], name, ...(model ? { model } : {}), ...(kind === 'heli' ? { color: '#2b5fd9' } : kind === 'rocket' ? {} : { color: '#3f7d3a' }) };
  e = maker.call(game, opts);
  return e || null;
}
function ensureRod() {
  const rod = game.find && game.find('rod');
  if (rod && rod.alive) { settle(rod, at(HOME.rod[0], ground(HOME.rod[0], HOME.rod[1]) + 1.15, HOME.rod[1])); return; }
  const maker = game['tool-pickup'];
  if (typeof maker === 'function') { const [x, y, z] = at(HOME.rod[0], ground(HOME.rod[0], HOME.rod[1]) + 1.15, HOME.rod[1]); maker('rod', { x, y, z, name: 'Fishing rod', respawn: 5 }); }
}
function ensureBarrels() {
  let made = 0;
  HOME.barrels.forEach(([x, z], i) => {
    const b = game.find && game.find(`barrel_${i + 1}`);
    if (b && b.alive) return;
    if (typeof game.barrel !== 'function') return; // (the mayhem kind: it goes off when shot, like the island's own)
    const [lx, ly, lz] = at(x, ground(x, z) + 0.6, z);
    const n = game.barrel({ x: lx, y: ly, z: lz, name: 'Fuel barrel' });
    if (n) made++;
  });
  return made;
}
const RESCUE_LINES = {
  drive: 'Back at the start. The 4x4 is right there.', rod: 'The rod is where it was. Walk to it.', fish: 'The rod is in your hands. Cast.',
  boom: 'The barrels are as they were. The launcher is in your hands.', spawn: 'Back where you started. Ask for something.',
  ask: 'Back where you started. Speak, and I will hear.', fly: 'The helicopter is on its pad. Go up.',
  rocket: 'The rocket is on its pad, full. The way is up.',
};
function rescue(why) {
  const p = game.player;
  if (!p || game.mode !== 'play') return false;
  const now = game.time;
  if (now - rescueMeta.last < RESCUE_COOLDOWN) return false;
  rescueMeta.last = now; rescueMeta.count++;
  const step = tourStep() || (journey.state !== 'off' ? 'rocket' : early.has('fly') ? 'fly' : 'drive');
  const from = [p.x, p.y, p.z];
  getOut();
  let spot = HOME.start, thing = null;
  if (step === 'drive') { thing = bringVehicle('4x4', 'jeep', HOME.jeep, 'truck'); spot = [HOME.jeep[0] - 3, HOME.jeep[1] - 2]; }
  else if (step === 'rod') { ensureRod(); spot = HOME.dock; thing = game.find && game.find('rod'); }
  else if (step === 'fish') { if (game.mayhem && game.mayhem.giveTool) game.mayhem.giveTool('rod'); spot = HOME.rodStand; }
  else if (step === 'boom') { ensureBarrels(); if (game.mayhem && game.mayhem.giveTool) game.mayhem.giveTool('rocket-launcher'); spot = HOME.beach; thing = game.find && game.find('barrel_1'); }
  else if (step === 'fly') { thing = bringVehicle('Helicopter', 'heli', HOME.heli, 'heli'); spot = [HOME.heli[0] - 6, HOME.heli[1] - 4]; }
  else if (step === 'rocket') { thing = bringVehicle('Rocket', 'rocket', HOME.rocket, 'rocket'); spot = [HOME.rocket[0] + 7, HOME.rocket[1] + 4]; endBeam(); }
  const to = at(spot[0], ground(spot[0], spot[1]) + 1, spot[1]);
  // A beam where you were, a beam where you land and over the thing: the Overseer sends you back.
  const O = H && H.overseer;
  try { if (O && O.beam) { O.beam(from, { radius: 1.4, seconds: 1.4 }); O.beam(to, { radius: 1.4, seconds: 1.8 }); if (thing && thing.alive) O.beam([thing.x, thing.y, thing.z], { radius: 1.8, seconds: 1.8 }); } } catch { /* the move is what matters */ }
  p.position = [to[0], to[1], to[2]]; p.velocity = [0, 0, 0]; p.flying = false;
  if (p.health !== undefined && p.health < 100) p.health = 100;
  sfx('teleport.mp3', { volume: 0.5 });
  overseer(RESCUE_LINES[step] || RESCUE_LINES.drive, 4, null);
  game.emit('rescue', { step, why: why || 'key', count: rescueMeta.count });
  return true;
}
window.__islandRescueNow = rescue; // (for tests and playtests)
game.input.onKey('r', () => {
  const t = game.player && game.player.tool;
  if (toolOf(t) === 'rocket-launcher' || toolOf(t) === 'shovel') return; // (R reloads and piles)
  if (tourStep() || early.size) rescue('key');
});
// The drowned: 6 s in the sea, or the sea under a boat you didn't mean to take, and the Overseer sends you back.
let wet = 0;
game.every(0.5, () => {
  const p = game.player;
  if (!p || game.mode !== 'play' || !(tourStep() || journey.state !== 'off')) { wet = 0; return; }
  const swimming = Boolean(H && H.water && H.water.swimming && H.water.swimming());
  wet = swimming ? wet + 0.5 : 0;
  if (wet >= 8) { wet = 0; rescue('sea'); }
});

// ------------------------------------------------------------------ Pip notices when you have stopped getting anywhere
const NUDGES = {
  drive: 'The path goes east, to the dock. The 4x4 is faster: press E at it.',
  rod: 'The rod is at the very end of the pier. Walk right into it.',
  fish: 'Hold click to cast the rod out into the sea. Wait for the bobber to dip.',
  boom: 'The fuel barrels are up the beach. Switch to the rocket launcher and fire!',
  spawn: 'Hold Q and pick anything. The Overseer will beam it down.',
  ask: 'Type what you want in the chat. Anything at all!',
  fly: 'The helicopter is on the hill. Get in and keep going up.',
};
const NUDGE_AFTER = 30; // seconds on one step
const nudged = (window.__islandNudged = window.__islandNudged || new Set());
let nudgeStep = null, nudgeSince = 0;
game.every(1, () => {
  const step = tourStep();
  if (step !== nudgeStep) { nudgeStep = step; nudgeSince = game.time; return; }
  if (!step || nudged.has(step) || game.time - nudgeSince < NUDGE_AFTER || !NUDGES[step]) return;
  nudged.add(step);
  say(`${NUDGES[step]} Stuck? ${H && H.touchUi ? 'Tap Stuck?' : 'Press R'} and I'll get you back.`, 7);
  game.emit('nudge', { step });
});

// ------------------------------------------------------------------ the tour's tracker
// Pip's line is gone in a few seconds; this stays: the step in one line, "2 of 7", a flourish when one is done, a hint with
// the controls after 20 s without progress, and a marker over the place (it fades as you get there). Top left, under the
// safe area, clear of the stick and buttons at the bottom. The quest list's own tracker would say the same thing twice.
const STEPS = ['drive', 'rod', 'fish', 'boom', 'spawn', 'ask', 'fly'];
const SHORT = {
  drive: 'Drive the 4x4 to the dock', rod: 'Grab the fishing rod at the end of the pier', fish: 'Catch a fish',
  boom: 'Blow up the fuel barrels', spawn: 'Spawn something', ask: 'Ask the Overseer for something', fly: 'Fly the helicopter up high',
};
// What to press, for the step, on a keyboard and on a phone.
const HINTS = {
  drive: ['Walk with WASD, or press E at the 4x4 to get in. Follow the yellow arrow.', 'Use the stick to walk, or tap B at the 4x4 to get in. Follow the yellow arrow.'],
  rod: ['Walk out along the pier (WASD). The rod is at the far end: walk into it.', 'Use the stick to walk out along the pier. The rod is at the far end: walk into it.'],
  fish: ['Hold click to cast, release to throw. Click again when the bobber dips.', 'Hold the screen to cast, let go to throw. Tap again when the bobber dips.'],
  boom: ['Press Q until the rocket launcher is in your hands, then click to fire at the barrels.', 'Tap ⇄ until the rocket launcher is in your hands, then tap the screen to fire at the barrels.'],
  spawn: ['Hold Q and pick anything from the wheel.', 'Tap the ➕ button and pick anything.'],
  ask: ['Type what you want in the chat at the bottom (try "a castle on the hill").', 'Type what you want in the chat (try "a castle on the hill").'],
  fly: ['Get in the helicopter with E. Hold W to climb, or use the mouse to tilt up.', 'Tap B at the helicopter. Push the stick up and keep going up.'],
};
const NAMES = { drive: 'Dock', rod: 'Fishing rod', fish: 'Fishing rod', boom: 'Fuel barrel', fly: 'Helicopter' };
const HINT_AFTER = 20; // seconds without progress
const FADE_NEAR = 14; // the marker is gone by here (meters), fully there from FADE_FAR
const FADE_FAR = 30;

if (typeof document !== 'undefined' && !document.getElementById('tour-style')) {
  const st = document.createElement('style');
  st.id = 'tour-style';
  st.textContent = [
    'body.tour-on .qs-track{display:none!important}',
    '.tour-track{position:fixed;left:12px;top:max(10px,env(safe-area-inset-top));z-index:25;width:min(300px,calc(100vw - 24px));box-sizing:border-box;padding:8px 11px;border-radius:12px;background:rgba(10,14,24,.7);border:1px solid rgba(255,216,74,.45);color:#fff;font:600 14px/1.3 system-ui,sans-serif;pointer-events:none;backdrop-filter:blur(4px)}',
    '.tour-track[hidden]{display:none}',
    '.tour-track .n{display:block;font:800 11px system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#ffd84a}',
    '.tour-track .t{display:block}',
    '.tour-track .h{display:none;margin-top:6px;padding-top:6px;border-top:1px solid rgba(255,255,255,.18);font-weight:500;font-size:13px;color:#dbe7ff}',
    '.tour-track.hint .h{display:block;animation:tour-in .3s ease-out}',
    '.tour-track.flash{animation:tour-flash .9s ease-out}',
    '@keyframes tour-flash{0%{transform:scale(1);box-shadow:0 0 0 0 rgba(255,216,74,.9);background:rgba(60,48,8,.9)}25%{transform:scale(1.07)}100%{transform:scale(1);box-shadow:0 0 0 18px rgba(255,216,74,0)}}',
    '@keyframes tour-in{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}',
    '.tour-stuck{position:fixed;left:12px;top:max(78px,calc(env(safe-area-inset-top) + 68px));z-index:25;padding:5px 11px;border-radius:999px;background:rgba(10,14,24,.6);border:1px solid rgba(255,255,255,.28);color:#dbe7ff;font:600 12px system-ui,sans-serif;cursor:pointer;pointer-events:auto;backdrop-filter:blur(4px)}',
    '.tour-stuck[hidden]{display:none}',
    '.tour-mark{padding:0!important;border:0!important;background:none!important;font-size:26px;line-height:1;color:#ffd84a;text-shadow:0 2px 6px rgba(0,0,0,.7);transition:opacity .25s;animation:tour-bob 1.1s ease-in-out infinite alternate}',
    '@keyframes tour-bob{from{margin-top:0}to{margin-top:-8px}}',
  ].join('\n');
  document.head.appendChild(st);
}

const tour = { step: null, since: 0, shown: null, markFor: null, mark: null };
const clearMark = () => { if (tour.mark) { try { tour.mark.close(); } catch { /* gone */ } } tour.mark = null; tour.markFor = null; };
const tracker = () => {
  let el = tour.n ? game.ui.el('tour-track') : null; // (a script that runs again builds its own)
  if (!el) {
    game.ui.remove('tour-track');
    tour.shown = null;
    el = game.ui.html('tour-track', '', { class: 'tour-track' });
    el.removeAttribute('style'); // (its own place: CSS above)
    for (const k of ['n', 't', 'h']) { const s = document.createElement('span'); s.className = k; el.appendChild(s); tour[k] = s; }
  }
  return el;
};
const stuckButton = () => {
  let b = game.ui.el('tour-stuck');
  if (!b) {
    game.ui.button('tour-stuck', H && H.touchUi ? 'Stuck?' : 'Stuck? (R)', () => rescue('button'));
    b = game.ui.el('tour-stuck');
    b.removeAttribute('style'); // (its own place: CSS above)
    b.classList.add('tour-stuck');
  }
  return b;
};
const markTarget = (step) => {
  const list = (game.all(NAMES[step]) || []).filter((e) => e && e.alive && !(e.vehicle && e.vehicle.wrecked));
  const p = game.player;
  if (p) list.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
  return list[0] || null;
};
function drawTour() {
  const q = game.events && game.events.quests;
  const active = Boolean(q && game.mode === 'play' && q.state('tour') === 'active');
  const step = active ? q.step('tour') : null;
  if (typeof document !== 'undefined' && document.body) document.body.classList.toggle('tour-on', active && !!step);
  if (!active || !step || !STEPS.includes(step)) {
    const el = game.ui.el('tour-track');
    if (el) el.hidden = true;
    const sb = game.ui.el('tour-stuck');
    if (sb && journey.state !== 'invited') sb.hidden = true; // (the journey up keeps it)
    clearMark();
    return;
  }
  const el = tracker();
  el.hidden = false;
  stuckButton().hidden = false;
  const now = game.time;
  if (tour.step !== step) {
    const first = tour.step === null;
    tour.step = step; tour.since = now;
    el.classList.remove('hint');
    if (!first) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); } // (a short flourish: the step before is done)
  }
  const i = STEPS.indexOf(step) + 1;
  if (tour.shown !== step) {
    tour.shown = step;
    tour.n.textContent = `The tour · ${i} of ${STEPS.length}`;
    tour.t.textContent = SHORT[step];
    tour.h.textContent = (HINTS[step] || [])[H && H.touchUi ? 1 : 0] || '';
  }
  el.classList.toggle('hint', now - tour.since >= HINT_AFTER);
  // The marker over the place; fades as the player arrives.
  const target = NAMES[step] ? markTarget(step) : null;
  if (!target) { clearMark(); return; }
  if (tour.markFor !== target) {
    clearMark();
    tour.markFor = target;
    tour.mark = game.ui.attach('tour-mark', target, { html: '▼', class: 'tour-mark', offset: step === 'drive' ? 3 : 1.2 });
  }
  const m = game.ui.el('tour-mark');
  const p = game.player;
  if (m && p) {
    const d = Math.hypot(target.x - p.x, target.z - p.z);
    m.style.opacity = String(Math.max(0, Math.min(1, (d - FADE_NEAR) / (FADE_FAR - FADE_NEAR))));
  }
}
game.every(0.2, drawTour);
// A step done: draw at once, so the flourish is on the same beat as the confetti.
game.on('quest', (d) => { if (d && d.id === 'tour') drawTour(); });

// ------------------------------------------------------------------ after the tour: "Come and see where I live."
// The tour's last step done (high enough to see the planet), the Overseer invites them up. A beam from its ship comes
// down on the rocket on its pad across the island (and an arrow over it), the tracker says what to do, and a short rocket
// lesson follows them in: hold to burn, lean it toward the ship, cut the engine and coast, line up with the bay (the
// approach readout and the catch are the engine's: modules/overseer/dock.js). A climb that fails is never a dead end:
// the Overseer says so, the rocket fills on the ground or a new one stands on the pad (free), and R / "Stuck?" bring them back.
const rocketOf = () => aliveOne('Rocket');
const rideOf = () => { const r = H && H.vehicles && H.vehicles.current; return r && r.alive && r.vehicle && r.vehicle.def && r.vehicle.def.class === 'rocket' ? r : null; };
function endBeam() { if (journey.beam) { try { journey.beam.end(false); } catch { /* gone */ } } journey.beam = null; journey.beamFor = null; }
function clearJourneyMark() { if (journey.mark) { try { journey.mark.close(); } catch { /* gone */ } } journey.mark = null; journey.markFor = null; }
function invite() {
  if (journey.state !== 'off' || game.mode !== 'play') return;
  journey.state = 'invited'; journey.tut = 'burn'; journey.tilted = false; journey.since = game.time;
  overseer('Come and see where I live.', 5, null);
  game.emit('journey', { state: 'invited' });
  drawJourney();
}
game.on('tour', (d) => { if (d && d.step === 'fly') game.after(9, invite); });
// (A player who flew first and finished the tour some other way is invited when the quest completes.)
game.on('quest', (d) => { if (d && d.id === 'tour' && d.state === 'done') game.after(10, invite); });

// The words for each moment: the tracker's title and what to press, keyboard first, phone second.
const JOURNEY = {
  invited: ['Come and see where I live', 'Go to the rocket on the launch pad (follow the beam) and press E to get in.', 'Go to the rocket on the launch pad (follow the beam) and tap B to get in.'],
  burn: ['Hold to burn', 'Hold SPACE: the engine burns while you hold it, and keeps burning when you let go. C cuts it.', 'Hold the up button: the engine burns while you hold it. The down button cuts it.'],
  steer: ['Steer toward the Overseer', 'W / S tip the nose, A / D lean it. It points where it flies: tip it toward the big ship in the sky.', 'The stick tips the nose and leans it. It flies where it points: tip it toward the big ship in the sky.'],
  stage: ['Stage: cut the engine and coast', 'Up in the thin air, press C to cut the engine. Coast. Burn again (SPACE) only to correct your way.', 'Up in the thin air, cut the engine with the down button. Coast. Burn again only to correct your way.'],
  bay: ['Line up with the bay', 'Follow the readout: slow down as you near it, keep the align low. The Overseer will catch you if you are careful.', 'Follow the readout: slow down as you near it, keep the align low. The Overseer will catch you if you are careful.'],
};
function journeyKey() {
  if (journey.state !== 'invited') return null;
  const ride = rideOf();
  if (!ride) return 'invited';
  if (journey.tut === 'burn' || journey.tut === 'steer' || journey.tut === 'stage') return journey.tut;
  return 'bay';
}
function advanceLesson(ride) {
  const v = ride.vehicle;
  const tilt = Math.acos(Math.max(-1, Math.min(1, v.up ? v.up.y : 1))) * 57.3;
  const alt = game.planet && game.planet.height ? game.planet.height(ride.position) : ride.y;
  const gauge = H && H.overseer && H.overseer.approach;
  if (tilt > 12) journey.tilted = true;
  if (journey.tut === 'burn' && (v.throttle > 0.3 && alt > 25)) journey.tut = 'steer';
  if (journey.tut === 'steer' && (journey.tilted || alt > 600)) journey.tut = 'stage';
  if (journey.tut === 'stage' && ((alt > 500 && v.throttle < 0.05) || (gauge && gauge.distance < 2500))) journey.tut = 'bay';
}
function ensureBeam() {
  const r = rocketOf();
  if (!r || rideOf()) { endBeam(); return r; }
  if (journey.beamFor !== r) {
    endBeam();
    const O = H && H.overseer;
    try { journey.beam = O && O.beam ? O.beam(r, { hold: true, radius: 3, ring: true }) : null; } catch { journey.beam = null; }
    journey.beamFor = r;
  }
  return r;
}
function drawJourney() {
  const key = journeyKey();
  const el = game.ui.el('journey-track');
  if (!key) {
    if (el) el.hidden = true;
    const sb = game.ui.el('tour-stuck');
    if (sb && journey.state === 'off') sb.hidden = true;
    endBeam(); clearJourneyMark();
    return;
  }
  let box = el;
  if (!box) {
    box = game.ui.html('journey-track', '', { class: 'tour-track' });
    box.removeAttribute('style');
    for (const k of ['n', 't', 'h']) { const s = document.createElement('span'); s.className = k; box.appendChild(s); }
  }
  box.hidden = false;
  stuckButton().hidden = false;
  const touch = H && H.touchUi ? 2 : 1;
  const [title, ...hints] = JOURNEY[key];
  const [n, t, h] = box.children;
  if (n) n.textContent = 'The Overseer';
  if (t) t.textContent = title;
  if (h) h.textContent = hints[touch - 1] || hints[0];
  box.classList.add('hint'); // (the lesson is short: its words stay up)
  const r = ensureBeam();
  const p = game.player;
  if (r && key === 'invited') {
    if (journey.markFor !== r) {
      clearJourneyMark();
      journey.markFor = r;
      journey.mark = game.ui.attach('journey-mark', r, { html: '▼', class: 'tour-mark', offset: 6 });
    }
    const m = game.ui.el('journey-mark');
    if (m && p) m.style.opacity = String(Math.max(0, Math.min(1, (Math.hypot(r.x - p.x, r.z - p.z) - FADE_NEAR) / (FADE_FAR - FADE_NEAR))));
  } else clearJourneyMark();
}
game.every(0.25, () => {
  if (journey.state !== 'invited') return;
  const ride = rideOf();
  if (ride) advanceLesson(ride);
  drawJourney();
});
game.on('docked-pad', () => {
  if (journey.state !== 'invited') return;
  journey.state = 'docked';
  confetti();
  drawJourney();
  game.emit('journey', { state: 'docked' });
});
game.on('bay-catch', () => { if (journey.state === 'invited' && !journey.caught) { journey.caught = true; overseer('I have you. Let the engine rest.', 4, null); } });

// A climb that failed (the engine says so: modules/overseer/dock.js `ascent-failed`): the Overseer answers and the way
// back up is open: the rocket fills on the ground, and one that is wrecked or gone is replaced on the pad (free).
function newRocket(why) {
  if (journey.replacing) return;
  journey.replacing = true;
  game.after(why === 'wrecked' ? 5 : 3, () => {
    journey.replacing = false;
    if (journey.state !== 'invited') return;
    const old = (game.all('Rocket') || []).find((e) => e && e.alive && !(e.vehicle && e.vehicle.wrecked));
    if (old) { endBeam(); return; } // (still standing: it only needs fuel, and the ground fills it)
    const wreck = (game.all('Rocket') || [])[0];
    try { if (wreck && wreck.alive) wreck.destroy(); } catch { /* gone */ }
    const made = bringVehicle('Rocket', 'rocket', HOME.rocket, 'rocket');
    const O = H && H.overseer;
    try { if (made && O && O.beam) O.beam(made, { radius: 2.6, seconds: 2 }); } catch { /* fine */ }
    overseer('A new one, from me.', 4, 'overseer-a-new-one.mp3');
    game.emit('journey', { state: 'new-rocket', why });
  });
}
game.on('ascent-failed', (d) => {
  if (!d || journey.state !== 'invited') return;
  d.handled = true;
  const lines = {
    wrecked: 'That one is gone. I will send another.',
    fuel: 'The fire has gone out. Fall gently. The ground will fill it again.',
    fell: 'Down you came. It is a long way up. Go again.',
  };
  overseer(lines[d.why] || lines.fell, 5, null);
  journey.tut = 'burn'; journey.tilted = false; journey.caught = false;
  if (d.why === 'wrecked') newRocket('wrecked');
  game.emit('journey', { state: 'retry', why: d.why });
});
// A wrecked rocket (a crash on the way up, the launcher turned on it): a new one stands on the pad either way.
game.on('wrecked', (d) => {
  const wreck = d && d.vehicle;
  if (!wreck || journey.state !== 'invited' || !String(wreck.type || '').includes('rocket')) return;
  newRocket('wrecked');
});
