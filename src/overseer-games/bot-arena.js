// Bot Arena's rules, screens and sounds. The world does the fighting: robots ("enemy"), the gates that beam in more
// ("spawner"), pickups, barrels, the launch pad and the rifle in the player settings. This file adds what a game adds
// on top: a title, music, a sound for every shot, hit and pickup, three lives, a HUD and the ending.
// Sounds and music are assets by name (from the community library); a game without one just plays on quietly.

game.ui.theme({ font: '"Rajdhani", "Inter", sans-serif', color: '#e6fbff', accent: '#22d3ee', panel: 'rgba(6,14,26,.86)', border: 'rgba(34,211,238,.45)', radius: 2 });
game.ui.style(`
  .arena-title .ui-menu { text-align: center; min-width: 360px; max-width: 520px; }
  .arena-title .ui-menu-title { font: 700 44px/1 Orbitron, sans-serif; letter-spacing: .2em; text-shadow: 0 0 24px #22d3ee; margin-bottom: 8px; }
  .arena-title .ui-menu-text { line-height: 1.45; }
  .arena-title .ui-menu-text i { display: block; margin-top: 10px; color: #9fe9ff; opacity: .85; font-size: .92em; }
  .arena-title .ui-menu-text small { display: block; margin-top: 8px; letter-spacing: .14em; text-transform: uppercase; font-size: 11px; color: #22d3ee; }
  .arena-title .ui-menu-items .ui-btn { text-align: center; letter-spacing: .2em; text-transform: uppercase; }
  .arena-hud { font-weight: 700; letter-spacing: .14em; text-transform: uppercase; min-width: 0; padding: 10px 18px; white-space: nowrap; }
  .arena-hud b { color: #22d3ee; font-size: 22px; }
  .arena-hud .lives { color: #ff4f6d; letter-spacing: .1em; font-size: 18px; }
  .arena-hud .lives s { color: rgba(255,255,255,.18); text-decoration: none; }
  .arena-end .ui-menu-title { font: 700 32px Orbitron, sans-serif; letter-spacing: .16em; color: #22d3ee; text-shadow: 0 0 20px #22d3ee; }
  .arena-lost .ui-menu-title { color: #ff4f6d; text-shadow: 0 0 20px #ff4f6d; }
  .arena-end .ui-menu-text i { display: block; margin-top: 8px; opacity: .8; }
`);

const GOAL = 25;
const LIVES = 3;
game.state.kills = 0;
game.state.downs = 0;
game.state.time = 0;
game.state.over = false;

const sfx = (name, o) => { if (game.hasAsset(name)) game.sound(name, o); };
const vary = (v = 0.08) => 1 + (Math.random() * 2 - 1) * v;
const music = (name, o) => { if (game.hasAsset(name)) game.music(name, o); else game.stopMusic(); };
const touch = Boolean(window.HawkesPlay && window.HawkesPlay.touchUi);
/** game.ui.menu with a little markup in its text (the Overseer's line in italics). */
function menu(id, o) {
  const r = game.ui.menu(id, { ...o, text: o.html ? ' ' : o.text });
  const el = o.html && document.querySelector(`.${String(o.class).split(' ')[0]} .ui-menu-text`);
  if (el) el.innerHTML = o.html;
  return r;
}

// The music starts with the player's first click (browsers hold sound until then): the title's Start, or the intro's Skip.
music('battle-drive.mp3', { volume: 0.42 });

function title() {
  menu('title', {
    title: 'BOT ARENA', class: 'arena-title', closable: false,
    html: `Clear ${GOAL} bots. You have ${LIVES} lives. Grab the shotgun, ride the launch pad to the rocket launcher on the tower, and shoot the barrels.<i>"I have beamed down twenty-five machines for you. I am curious what you will do with them."</i><small>Featured by the Overseer</small>`,
    items: [
      { label: 'Start', primary: true, onClick: () => { sfx('confirm.mp3', { volume: 0.6 }); game.save('arena.seen', true); game.input.capture(); } },
      { label: 'How to play', close: false, onClick: () => game.ui.popup(touch ? 'The stick moves, drag on the screen to aim (touching it fires), ⤒ jumps. Hearts heal, power cores refill ammo.' : 'WASD to move, mouse to aim, click to shoot, R to reload, space to jump, shift to run. Hearts heal, power cores refill ammo. P pauses.', { title: 'How to play' }) },
    ],
  });
}
if (game.mode === 'play' && !game.load('arena.seen', false)) game.onStart(title);

game.input.onKey('p', () => {
  if (game.paused || game.mode !== 'play' || game.state.over) return;
  game.input.release();
  game.ui.menu('pause', {
    title: 'Paused',
    items: [
      { label: 'Resume', primary: true, onClick: () => game.input.capture() },
      { label: 'Restart', onClick: () => { game.restart(); game.input.capture(); } },
    ],
  });
});

// ------------------------------------------------------------------ sounds for what the engine does by itself
// Shots: the gun in your hands (the engine's) loses a round each time it fires; reloading starts a reload.
const gun = () => (window.HawkesPlay && window.HawkesPlay.gameplay && window.HawkesPlay.gameplay.gun) || null;
let lastMag = null, lastSpec = null, wasReloading = false;
game.onUpdate(() => {
  const g = gun();
  if (!g || !g.spec) { lastSpec = null; return; }
  if (g.spec === lastSpec && lastMag !== null && g.mag < lastMag) {
    const type = g.spec.type;
    if (type === 'launcher') sfx('laser-shot.mp3', { volume: 0.7, rate: 0.55 });
    else if (type === 'shotgun') sfx('gunshot.mp3', { volume: 0.85, rate: 0.72 * vary(0.04) });
    else sfx('gunshot.mp3', { volume: 0.32, rate: 1.12 * vary() });
  }
  const reloading = g.reloading > 0;
  if (reloading && !wasReloading) sfx('reload.mp3', { volume: 0.6 });
  wasReloading = reloading;
  lastMag = g.mag; lastSpec = g.spec;
});

// Bots beamed in through the gates.
let bots = game.all('bot').length;
game.every(0.25, () => {
  const n = game.all('bot').length;
  if (n > bots && game.mode === 'play') sfx('teleport.mp3', { volume: 0.45, rate: vary() });
  bots = n;
});

let clangAt = 0;
game.on('hurt', (d) => {
  if (game.state.over) return;
  if (d.entity === game.player) { sfx('laser-shot.mp3', { volume: 0.35, rate: 1.4 * vary() }); sfx('punch.mp3', { volume: 0.55, rate: vary() }); return; }
  if (d.entity && d.entity.tag === 'bot' && game.time - clangAt > 0.07) { clangAt = game.time; sfx('metal-hit.mp3', { volume: 0.45, rate: vary(0.12) }); }
});
game.on('pickup', (d) => {
  if (d.gives === 'health') sfx('heal.mp3', { volume: 0.7 });
  else if (d.gives === 'weapon') sfx('power-up.mp3', { volume: 0.7 });
  else sfx('reload.mp3', { volume: 0.7, rate: 1.2 });
});

// ------------------------------------------------------------------ the rules: 25 bots, three lives
game.on('kill', (d) => {
  if (game.state.over || !d.entity || d.entity.tag !== 'bot') return;
  game.state.kills++;
  sfx('explosion.mp3', { volume: 0.4, rate: 1.5 * vary() });
  if (game.juice) game.juice.fx.burst('sparks', [d.entity.x, d.entity.y, d.entity.z], { count: 40 });
  if (game.state.kills >= GOAL) return won();
  if (game.state.kills % 5 === 0) { sfx('level-up.mp3', { volume: 0.6 }); game.ui.message(`Wave ${game.state.kills / 5 + 1}`, 1.4); }
});
game.on('death', (d) => {
  if (d.entity !== game.player || game.state.over) return;
  game.state.downs++;
  sfx('alarm.mp3', { volume: 0.5 });
  if (game.state.downs >= LIVES) lost();
});

const clock = () => `${Math.floor(game.state.time / 60)}:${String(Math.floor(game.state.time % 60)).padStart(2, '0')}`;
function end(o) {
  game.state.over = true;
  game.input.release();
  game.ui.remove('stats');
  menu('end', { ...o, closable: false, items: [{ label: o.again, primary: true, onClick: () => { sfx('confirm.mp3', { volume: 0.6 }); game.restart(); game.input.capture(); } }] });
}
function won() {
  music('victory.mp3', { volume: 0.6, loop: false });
  sfx('level-up.mp3', { volume: 0.8 });
  const best = game.load('arena.best', null);
  if (best === null || game.state.time < best) game.save('arena.best', game.state.time);
  end({
    title: 'ARENA CLEARED', class: 'arena-end', again: 'Play again',
    html: `${GOAL} bots in ${clock()} · ${LIVES - game.state.downs} of ${LIVES} lives left${best !== null ? ` · best ${Math.floor(Math.min(best, game.state.time) / 60)}:${String(Math.floor(Math.min(best, game.state.time) % 60)).padStart(2, '0')}` : ''}<i>"Well done. I may send more."</i>`,
  });
}
function lost() {
  music('game-over.mp3', { volume: 0.6, loop: false });
  end({
    title: 'THE BOTS WIN', class: 'arena-end arena-lost', again: 'Try again',
    html: `${game.state.kills} of ${GOAL} bots in ${clock()}<i>"I have beamed you back. They are waiting."</i>`,
  });
}

// ------------------------------------------------------------------ the HUD
game.onUpdate((dt) => { if (!game.paused && !game.state.over) game.state.time += dt; });
game.every(0.2, () => {
  if (game.state.over) return;
  const left = LIVES - game.state.downs;
  const lives = '♥'.repeat(Math.max(0, left)) + `<s>${'♥'.repeat(Math.max(0, LIVES - left))}</s>`;
  game.ui.panel('stats', { html: `BOTS <b>${game.state.kills}</b> / ${GOAL} &nbsp;·&nbsp; ${clock()} &nbsp;·&nbsp; <span class="lives">${lives}</span>`, x: 'center', y: 'top', class: 'arena-hud' });
});
