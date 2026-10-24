// Leap's rules, screens and sounds: a title, the climb against the setting sun (the day runs: config.time), coins and
// gems (their own sounds, from the "collectible" behavior), checkpoints, the summit and the results with your best.
// The climb is the world: moving platforms ("patrol"), spikes ("hurts"), the launch pad and the waypoints.
// Sounds and music are assets by name (from the community library); a game without one just plays on quietly.

game.ui.theme({ font: '"Rajdhani", "Inter", sans-serif', color: '#1e2a3a', accent: '#ff9f1a', panel: 'rgba(255,250,240,.93)', border: 'rgba(30,42,58,.15)', radius: 16 });
game.ui.style(`
  .leap-title .ui-menu { text-align: center; max-width: 500px; }
  .leap-title .ui-menu-title { font: 700 52px/1 Orbitron, sans-serif; letter-spacing: .12em; color: #ff9f1a; text-shadow: 0 3px 0 #b35f00, 0 8px 24px rgba(255,159,26,.35); margin-bottom: 10px; }
  .leap-title .ui-menu-text { line-height: 1.45; }
  .leap-title .ui-menu-text i { display: block; margin-top: 10px; color: #6a5a7a; font-size: .92em; }
  .leap-title .ui-menu-text small { display: block; margin-top: 8px; letter-spacing: .14em; text-transform: uppercase; font-size: 11px; color: #b35f00; }
  .leap-title .ui-btn { text-align: center; text-transform: uppercase; letter-spacing: .16em; color: #1e2a3a; }
  .leap-title .ui-btn.primary { color: #fff; }
  .leap-lost .ui-menu-title { color: #e2557a; text-shadow: 0 3px 0 #8a2040; }
  .leap-hud { padding: 8px 18px; font-weight: 700; letter-spacing: .08em; box-shadow: 0 6px 20px rgba(0,0,0,.15); white-space: nowrap; }
  .leap-hud b { color: #ff9f1a; font-size: 20px; }
  .leap-hud b.low { color: #e2557a; }
  .leap-hud em { font-style: normal; color: #b07a00; }
`);

const LIMIT = 75;   // seconds of daylight left at the start (the sun sets with the clock)
const COIN_TIME = 1; // each coin buys a little more
const coins = game.all('Coin').length;
const gems = game.all('Gem').length;
game.state.time = 0;
game.state.left = LIMIT;
game.state.climbing = game.mode !== 'play';
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
music('arcade.mp3', { volume: 0.4 });

// The title the first time; "Climb again" goes straight back to the climb.
if (game.mode === 'play' && game.load('leap.seen', false)) game.state.climbing = true;
else if (game.mode === 'play') {
  game.onStart(() => menu('title', {
    title: 'LEAP', class: 'leap-title', closable: false,
    html: `Climb from the village to the summit before the sun sets. ${touch ? '⤒ jumps, again in the air to jump higher.' : 'Space jumps, space again in the air jumps higher.'} ${coins} coins and ${gems} gems on the way: each coin buys a second of light.<i>"I left a rocket at the top. Someone should use it."</i><small>Featured by the Overseer</small>`,
    items: [{ label: 'Climb', primary: true, onClick: () => { sfx('confirm.mp3', { volume: 0.6 }); game.save('leap.seen', true); game.state.climbing = true; game.input.capture(); } }],
  }));
}

// ------------------------------------------------------------------ sounds for jumping, landing, hurting, launching
let jumpsInAir = 0;
game.onUpdate(() => {
  const p = game.player;
  if (!p || game.paused) return;
  const grounded = Boolean(p.grounded);
  if (grounded) jumpsInAir = 0;
  if (game.input.pressed('space') && game.state.climbing) {
    if (grounded) sfx('jump.mp3', { volume: 0.55 });
    else if (jumpsInAir === 0 && p.doubleJump) { jumpsInAir = 1; sfx('jump.mp3', { volume: 0.55, rate: 1.35 }); }
  }
});
if (game.juice && game.juice.feel) game.juice.feel.on('land', (d) => { if (d.speed > 7) sfx('land.mp3', { volume: Math.min(0.8, 0.2 + d.speed / 30) }); });
game.on('hurt', (d) => { if (d.entity === game.player) sfx('punch.mp3', { volume: 0.7 }); });
const pad = game.entity('pad');
if (pad) pad.on('hit', (who) => { if (who === game.player) { sfx('launch.mp3', { volume: 0.8 }); if (game.juice) game.juice.shake(0.25); } });
game.on('checkpoint', () => { sfx('checkpoint.mp3', { volume: 0.7 }); game.ui.message('Checkpoint', 1); });
let score = 0;
game.every(0.1, () => {
  const s = game.state.score || 0;
  if (s > score && game.state.climbing) game.state.left += COIN_TIME * Math.min(5, s - score);
  score = s;
});

// ------------------------------------------------------------------ the clock and the ending
game.onUpdate((dt) => {
  if (!game.state.climbing || game.paused) return;
  game.state.time += dt;
  const before = game.state.left;
  game.state.left = Math.max(0, game.state.left - dt);
  if (game.state.left < 10 && Math.ceil(game.state.left) !== Math.ceil(before)) sfx('alarm.mp3', { volume: 0.3, rate: 1.4 });
  if (game.state.left <= 0) lost();
});

function end(o) {
  game.state.climbing = false;
  game.state.over = true;
  game.input.release();
  game.ui.remove('hud');
  menu('results', { ...o, closable: false, items: [{ label: o.again, primary: true, onClick: () => { sfx('confirm.mp3', { volume: 0.6 }); game.restart(); game.input.capture(); } }] });
}
game.on('finish', () => {
  if (!game.state.climbing) return;
  const t = game.state.time;
  const best = game.load('leap.best', null);
  if (best === null || t < best) game.save('leap.best', t);
  music('victory.mp3', { volume: 0.6, loop: false });
  sfx('level-up.mp3', { volume: 0.8 });
  if (game.juice) game.juice.fx.burst('sparks', [game.player.x, game.player.y + 1, game.player.z], { count: 60 });
  end({
    title: 'SUMMIT!', class: 'leap-title', again: 'Climb again',
    html: `${t.toFixed(1)} s · ★ ${game.state.score || 0} of ${coins + gems * 5}${best !== null ? ` · best ${Math.min(best, t).toFixed(1)} s` : ''}<i>"You made it before dark. The rocket is yours."</i>`,
  });
});
function lost() {
  if (game.state.over) return;
  music('game-over.mp3', { volume: 0.6, loop: false });
  sfx('error.mp3', { volume: 0.7 });
  end({
    title: 'SUNSET', class: 'leap-title leap-lost', again: 'Try again',
    html: `The light ran out ${Math.max(0, Math.round(game.player ? 15.7 - game.player.y : 0))} m below the summit.<i>"There is always another day."</i>`,
  });
}

// ------------------------------------------------------------------ the HUD
game.every(0.1, () => {
  if (game.state.over) return;
  const low = game.state.left < 10;
  game.ui.panel('hud', { html: `☀ <b class="${low ? 'low' : ''}">${game.state.left.toFixed(1)} s</b> &nbsp; ★ <em>${game.state.score || 0}</em>`, x: 'left', y: 'top', class: 'leap-hud' });
});
