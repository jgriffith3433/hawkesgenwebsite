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
  loop('ocean-waves.mp3', 0.45);
  loop('forest.mp3', 0.18);
}
// The sea is louder by the shore and quieter up high; the birds stay over the land. (A loop the browser held back
// starts as soon as sound is allowed: after the first click or key.)
game.every(0.5, () => {
  if (!loops.length || !game.player) return;
  if (H.audio.context && H.audio.context.state === 'running') for (const a of loops) if (a.paused) a.play().catch(() => {});
  const h = game.planet ? game.planet.height(game.player.position) : game.player.y;
  const t = game.terrain && game.terrain.heightAt ? game.terrain.heightAt(game.player.x, game.player.z) : null;
  const onLand = t !== null && t > 0.5;
  if (loops[0]) loops[0].volume = Math.max(0.05, Math.min(0.55, 0.55 - Math.max(0, h - 6) / 400) * (onLand ? 0.75 : 1));
  if (loops[1]) loops[1].volume = onLand && h < 60 ? 0.18 : 0.02;
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
const MOMENTS = {
  drive: { sound: 'level-up.mp3', pip: 'Nice driving! The rod is at the end of the pier. Hold click to cast, click when the bobber dips.', overseer: 'You took the wheel. Good.' },
  fish: { sound: 'power-up.mp3', pip: 'A fish! See the barrels up the beach? Tap Q for the rocket launcher. Go on.', overseer: 'The sea gives. Remember that.' },
  boom: { sound: 'level-up.mp3', pip: 'BOOM! Now ask the Overseer for something: hold Q and pick anything.', overseer: 'Destruction is a kind of freedom too.' },
  spawn: { sound: 'teleport.mp3', pip: 'It came from the Overseer! Last one: the helicopter on the hill. Go up, way up.', overseer: 'Ask, and I will send it down.' },
  fly: { sound: 'victory.mp3', pip: 'Look down! That speck in the sea is our island.', overseer: 'That is your world. All of it. Do with it what you will.', seconds: 7 },
};
game.on('tour', (d) => {
  const m = d && MOMENTS[d.step];
  if (!m) return;
  sfx(m.sound, { volume: 0.7 });
  confetti();
  game.camera.shake(0.08, 0.2);
  game.after(0.6, () => say(m.pip, 6));
  game.after(1.4, () => overseer(m.overseer, m.seconds || 5));
});

// ------------------------------------------------------------------ the last step: high enough to see the planet
let high = false;
game.onUpdate(() => {
  const p = game.player;
  if (high || !p || game.mode !== 'play') return;
  const h = game.planet ? game.planet.height(p.position) : p.y;
  if (h > 280) { high = true; game.emit('sandbox-high', { height: Math.round(h), mine: true }); }
});
