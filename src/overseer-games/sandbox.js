// The island's guide. The world (scene.json) has the island, its toys and the quest line ("The island", config.quests);
// this script is how it feels: Pip greets you once the Overseer has beamed you down and offers the tour, every step
// done has its moment (a sound, confetti, Pip's line, the Overseer's words), and the island sounds like one: the sea
// and the birds, gentle music, all through the engine's sound (they start with your first click or key).
// Sounds and music are assets by name (the community library's); a game without one plays on quietly.

const H = window.HawkesPlay;
const sfx = (name, o) => { if (game.hasAsset(name)) game.sound(name, o); };
const pip = () => game.all('Pip')[0] || null;
const say = (text, seconds = 4) => { const p = pip(); if (p && p.say) p.say(text, seconds); };
const overseer = (text, seconds = 5) => { if (game.overseer && game.overseer.say) game.overseer.say(text, seconds); };
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
    H.audio.media(a);
    loops.push(a);
    a.play().catch(() => {});
    return a;
  } catch { return null; }
}
let sounding = false;
function startSound() {
  if (sounding || game.mode !== 'play') return;
  sounding = true;
  if (game.hasAsset('meadow.mp3')) game.music('meadow.mp3', { volume: 0.28 });
  loop('ocean-waves.mp3', 0);
  loop('forest.mp3', 0.12);
}
// The sea is heard by the shore: quiet, and fading out as you walk inland (silent ~70 m from the water) or go up; the
// birds stay over the land. (A loop the browser held back starts as soon as sound is allowed: the first click or key.)
const SEA = -1.5; // config.water.level
const SEA_MAX = 0.12;
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
  if (loops[1]) loops[1].volume = onLand && h < 60 ? 0.12 : 0.01;
});

// ------------------------------------------------------------------ the beginning: Pip offers the tour
let began = false;
function begin() {
  if (began || game.mode !== 'play') return;
  began = true;
  startSound();
  game.after(1.2, () => say('Hi! I\'m Pip. Welcome to the island!', 4));
  game.after(3.4, () => {
    const q = game.events && game.events.quests;
    if (q && q.state('tour') === 'available') q.start('tour');
    say('Come on, I\'ll show you around. The 4x4 first!', 4);
  });
}
// After the Overseer's intro (it plays every time here), or straight away when there isn't one.
game.on('intro', (d) => { if (d && d.state === 'end') begin(); });
game.onStart(() => {
  const intro = Boolean(H && H.overseer && H.overseer.introWanted && H.overseer.introWanted());
  game.after(intro ? 40 : 2, begin); // (an intro that never ends: begin anyway)
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
  spawn: { sound: 'teleport.mp3', pip: 'It came from the Overseer! Last one: the helicopter on the hill. Go up, way up.', overseer: 'Ask, and I will send it down.', voice: 'overseer-ask.mp3' },
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
  game.after(1.4, () => { overseer(m.overseer, m.seconds || 5); sfx(m.voice, { volume: 1 }); });
  if (m.give && game.mayhem && game.mayhem.giveTool) game.after(1, () => { for (const t of m.give) game.mayhem.giveTool(t); });
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
    overseer('A new one, from me.', 4);
  });
});
