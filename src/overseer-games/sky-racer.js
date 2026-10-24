// Sky Racer's rules, screens and sounds: a title, a countdown, a clock that every gate tops up, your starship, the
// results with your best time, and music. The course itself is the world: "gate" rings joined by next, and a finish.
// Sounds and music are assets by name (from the community library); a game without one just plays on quietly.

game.ui.theme({ font: '"Rajdhani", "Inter", sans-serif', color: '#fff0fb', accent: '#ff4ad8', panel: 'rgba(28,10,40,.82)', border: 'rgba(255,122,216,.5)', radius: 18 });
game.ui.style(`
  .race-title .ui-menu { text-align: center; max-width: 520px; background: linear-gradient(160deg, rgba(90,30,110,.92), rgba(24,8,40,.94)); }
  .race-title .ui-menu-title { font: 700 46px/1 Orbitron, sans-serif; letter-spacing: .16em; background: linear-gradient(90deg, #ffb36b, #ff7ad8, #7ad8ff); -webkit-background-clip: text; background-clip: text; color: transparent; margin-bottom: 10px; }
  .race-title .ui-menu-text { line-height: 1.45; }
  .race-title .ui-menu-text i { display: block; margin-top: 10px; color: #ffd0f0; opacity: .85; font-size: .92em; }
  .race-title .ui-menu-text small { display: block; margin-top: 8px; letter-spacing: .14em; text-transform: uppercase; font-size: 11px; color: #ff9ae0; }
  .race-title .ui-btn { text-align: center; text-transform: uppercase; letter-spacing: .2em; }
  .race-lost .ui-menu-title { background: linear-gradient(90deg, #ff6a6a, #ffb36b); -webkit-background-clip: text; background-clip: text; }
  .race-hud { text-align: center; padding: 8px 22px 10px; font-weight: 700; letter-spacing: .1em; min-width: 190px; }
  .race-hud big { display: block; font: 700 34px/1.1 Orbitron, sans-serif; color: #ff7ad8; text-shadow: 0 0 16px #ff4ad8; }
  .race-hud big.low { color: #ff5a5a; text-shadow: 0 0 18px #ff2020; }
  .race-hud span { opacity: .8; font-size: 13px; }
`);

let GATES = 0;
while (game.entity(`gate_${GATES + 1}`)) GATES++;
const START = 8;      // seconds on the clock at GO
const PER_GATE = 1.5; // what each gate adds (a clean run ends with about 10 s to spare)

game.state.time = 0;
game.state.left = START;
game.state.gates = 0;
game.state.racing = false;
game.state.over = false;

const sfx = (name, o) => { if (game.hasAsset(name)) game.sound(name, o); };
const music = (name, o) => { if (game.hasAsset(name)) game.music(name, o); else game.stopMusic(); };
const touch = Boolean(window.HawkesPlay && window.HawkesPlay.touchUi);
function menu(id, o) {
  const r = game.ui.menu(id, { ...o, text: o.html ? ' ' : o.text });
  const el = o.html && document.querySelector(`.${String(o.class).split(' ')[0]} .ui-menu-text`);
  if (el) el.innerHTML = o.html;
  return r;
}

// The music starts with the player's first click (browsers hold sound until then).
music('synthwave.mp3', { volume: 0.45 });

// ------------------------------------------------------------------ your starship
// The flight controls fly a small built-in craft; this dresses it in the community's starship (when the game has it).
let craft = null;
function wearShip() {
  const p = game.player;
  if (!p || !p.node || !game.hasAsset('spaceship.glb')) return;
  const holder = p._ship || null;
  if (craft && craft.alive && craft.mesh.parent === (holder || p.node)) return hideBody(p);
  if (!craft || !craft.alive) craft = game.model('spaceship.glb', { size: 0.9, physics: 'none' });
  craft.mesh.parent = holder || p.node;
  craft.mesh.position.set(0, 0, 0);
  craft.mesh.rotation.set(0, Math.PI, 0);
  // (The built-in craft's own parts are hidden: the starship is drawn instead.)
  if (holder) for (const m of holder.getChildMeshes(true)) if (m.metadata && m.metadata.decor) m.isVisible = false;
  hideBody(p);
}
/** You're the pilot: the walking body (your look) rides hidden inside the ship. */
function hideBody(p) { for (const c of p.node.getChildren()) if (c.name === 'pr-rig' || c.name === 'visor') for (const m of c.getChildMeshes ? [c, ...c.getChildMeshes()] : [c]) if (m.isVisible) m.isVisible = false; }
game.onUpdate(() => { if (game.player && game.player._ship !== undefined) wearShip(); });

// ------------------------------------------------------------------ the start
function countdown() {
  game.player.controls = false;
  let n = 3;
  game.ui.message(String(n), 0.8);
  sfx('tick.mp3', { volume: 0.7 });
  const stop = game.every(1, () => {
    n--;
    if (n > 0) { game.ui.message(String(n), 0.8); sfx('tick.mp3', { volume: 0.7 }); }
    else { stop(); game.ui.message('GO!', 0.8); sfx('go.mp3', { volume: 0.8 }); game.player.controls = true; game.state.racing = true; }
  });
}

if (game.mode === 'play') {
  game.onStart(() => menu('title', {
    title: 'SKY RACER', class: 'race-title', closable: false,
    html: `Fly down the valley through all ${GATES} gates. The clock starts at ${START} seconds; every gate adds ${PER_GATE}. ${touch ? 'Steer with the stick, hold ⤒ to boost.' : 'Steer with the mouse or WASD, hold space to boost.'}<i>"I hung these rings in the evening for you. The light will not wait."</i><small>Featured by the Overseer</small>`,
    items: [{ label: 'Race', primary: true, onClick: () => { game.input.capture(); countdown(); } }],
  }));
} else game.state.racing = true;

// ------------------------------------------------------------------ the race
let streak = 0, lastGateAt = -10;
game.on('gate', () => {
  if (!game.state.racing) return;
  game.state.gates++;
  game.state.left += PER_GATE;
  streak = game.state.time - lastGateAt < 3 ? streak + 1 : 0;
  lastGateAt = game.state.time;
  sfx('gate.mp3', { volume: 0.7, rate: Math.min(1.5, 1 + streak * 0.05) });
  game.ui.message(`+${PER_GATE}s`, 0.5);
  if (game.juice) game.juice.shake(0.15);
});

let boosting = false;
game.onUpdate((dt) => {
  if (!game.state.racing || game.paused) return;
  game.state.time += dt;
  const before = game.state.left;
  game.state.left = Math.max(0, game.state.left - dt);
  if (game.state.left < 5 && Math.ceil(game.state.left) !== Math.ceil(before)) sfx('alarm.mp3', { volume: 0.35, rate: 1.3 });
  if (game.state.left <= 0) lost();
  const b = game.input.key('space');
  if (b && !boosting) { sfx('boost.mp3', { volume: 0.6 }); if (game.juice) game.juice.shake(0.2); }
  boosting = b;
});

function end(o) {
  game.state.racing = false;
  game.state.over = true;
  game.player.controls = false;
  game.input.release();
  game.ui.remove('hud');
  menu('results', { ...o, closable: false, items: [{ label: o.again, primary: true, onClick: () => { game.restart(); game.input.capture(); } }] });
}
game.on('finish', () => {
  if (!game.state.racing) return;
  const t = game.state.time;
  const best = game.load('race.best', null);
  if (best === null || t < best) game.save('race.best', t);
  music('victory.mp3', { volume: 0.6, loop: false });
  sfx('level-up.mp3', { volume: 0.8 });
  end({
    title: best === null || t < best ? 'NEW BEST!' : 'FINISHED', class: 'race-title', again: 'Race again',
    html: `${t.toFixed(2)} s · ${game.state.gates} of ${GATES} gates${best !== null ? ` · best ${Math.min(best, t).toFixed(2)} s` : ''}<i>"Beautifully flown."</i>`,
  });
});
function lost() {
  if (game.state.over) return;
  music('game-over.mp3', { volume: 0.6, loop: false });
  sfx('error.mp3', { volume: 0.7 });
  end({
    title: 'OUT OF TIME', class: 'race-title race-lost', again: 'Try again',
    html: `${game.state.gates} of ${GATES} gates in ${game.state.time.toFixed(1)} s<i>"The evening ended before you did. It comes again."</i>`,
  });
}

// ------------------------------------------------------------------ the HUD
game.every(0.1, () => {
  if (game.state.over) return;
  const low = game.state.racing && game.state.left < 5;
  game.ui.panel('hud', { html: `<big class="${low ? 'low' : ''}">${game.state.left.toFixed(1)}</big><span>GATES ${game.state.gates} / ${GATES} &nbsp;·&nbsp; ${game.state.time.toFixed(1)} s</span>`, x: 'center', y: 'top', class: 'race-hud' });
});
