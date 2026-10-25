// The island's guide. The world (scene.json) has the island, its toys and the quest line ("The island", config.quests);
// this script is how it feels: once the Overseer has beamed you down and you've been to the mirror (who you are:
// modules/mirror, by itself after the intro), Pip comes over, greets you and offers the tour, every step
// done has its moment (a sound, confetti, Pip's line, the Overseer's words), and the island sounds like one: the sea
// and the birds, gentle music, all through the engine's sound (they start with your first click or key).
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
// The music loops with game.music; the sea and the birds are loops of their own through the engine's output.
const loops = (window.__islandLoops = window.__islandLoops || []);
for (const a of loops.splice(0)) { try { a.pause(); } catch { /* gone */ } }
function loop(name, volume) {
  if (!game.hasAsset(name) || !H || !H.audio || !H.audio.media) return null;
  try {
    const a = new Audio(game.asset(name));
    a.crossOrigin = 'anonymous';
    a.loop = true;
    a.volume = volume;
    H.audio.media(a, { background: true }); // (background: it dips under the Overseer's voice)
    loops.push(a);
    a.play().catch(() => {});
    return a;
  } catch { return null; }
}
let sounding = false;
function startSound() {
  if (sounding || game.mode !== 'play') return;
  sounding = true;
  // (Quiet enough to talk over: J, 2026-10-24, "I can't hear the voices".)
  if (game.hasAsset('meadow.mp3')) game.music('meadow.mp3', { volume: 0.14 });
  loop('ocean-waves.mp3', 0);
  loop('forest.mp3', 0.05);
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
  if (!loops.length || !game.player) return;
  if (H.audio.context && H.audio.context.state === 'running') for (const a of loops) if (a.paused) a.play().catch(() => {});
  const p = game.player;
  const h = game.planet ? game.planet.height(p.position) : p.y;
  const d = seaDistance(p.x, p.z);
  const near = d === Infinity ? 0 : Math.pow(Math.max(0, 1 - d / 70), 1.6);
  const up = Math.max(0, 1 - Math.max(0, h - 8) / 120);
  const want = SEA_MAX * near * up;
  seaVol += (want - seaVol) * 0.35; // (eased: no jumps as you walk)
  if (loops[0]) loops[0].volume = Math.max(0, Math.min(1, seaVol));
  const onLand = d > 0;
  if (loops[1]) loops[1].volume = onLand && h < 60 ? 0.05 : 0.01;
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
game.on('intro', (d) => { if (d && d.state === 'end') game.after(1, afterMirror); });
game.onStart(() => {
  const intro = Boolean(H && H.overseer && H.overseer.introWanted && H.overseer.introWanted());
  // (An intro that never ends: begin anyway, unless the mirror is open: then when it closes.)
  game.after(intro ? 40 : 2.5, afterMirror);
});
window.addEventListener('pointerdown', startSound, { once: true });
window.addEventListener('keydown', startSound, { once: true });

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
    clearMark();
    return;
  }
  const el = tracker();
  el.hidden = false;
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
