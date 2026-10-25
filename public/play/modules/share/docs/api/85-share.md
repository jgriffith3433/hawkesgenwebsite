## Cinematic camera, photos and clips (`game.cinematic`, `game.photo`)

Shots take the camera, hide the HUD, put up letterbox bars, then give everything back as it was. Each call returns a
promise that resolves when the shot ends: `{ done, skipped, clip }`. Shots are described in WORLD.md (`config.cinematics`).

```js
// The intro saved in config.cinematics, then the game begins.
game.onStart(async () => {
  await game.cinematic.play('intro');
  game.ui.message('Go!');
});

// An orbit round the volcano, 8 seconds, half way round, with a title.
game.cinematic.orbit('Volcano', { seconds: 8, degrees: 180, title: 'Mount Doom' });

// A camera car alongside the 4x4 you're driving (you keep driving), until stopped.
game.cinematic.dolly('vehicle', { side: 7, height: 2 });
game.after(20, () => game.cinematic.stop());

// Through keyframes: positions and what to look at (a point or a thing's name), with an ease.
game.cinematic.path([
  { pos: [0, 30, -80], look: 'Island' },
  { pos: [20, 12, -30], look: 'Island', ease: 'out' },
  { pos: [4, 3, -8], look: [0, 1, 0], hold: 1.5 },
], { seconds: 10, fade: 1, title: 'Fire Island' });

// Cows stampede from a rocket, in slow motion, filmed from a fixed place and recorded to a clip.
game.cinematic.record({ type: 'fixed', pos: [20, 4, -12], target: 'Rocket', seconds: 6, slowmo: 0.35 })
  .then(({ clip }) => { /* the clip opens for review: trim, download, or share a link */ });

// Bullet time for a moment (real seconds).
game.cinematic.slowmo(0.2, 1.5);   // e.g. where your script blows something up
```

| Call | What |
|---|---|
| `game.cinematic.play(nameOrShot, opts?)` | A shot from `config.cinematics` by name, or a shot object (WORLD.md); `opts` override its fields |
| `game.cinematic.path(keys, opts)`, `.orbit(target, opts)`, `.follow(target, opts)`, `.dolly(target, opts)`, `.fixed(pos, target, opts)`, `.sequence(shots, opts)` | The same, per kind of shot. Targets: a thing, its name, `'player'`, `'vehicle'`, or `[x, y, z]` |
| `game.cinematic.record(nameOrShot, opts?)` | Plays it and records what the player sees (letterbox, titles and fades included); the clip opens for review. Resolves with `{ clip: { blob, mime, seconds } }` |
| `game.cinematic.stop()`, `.skip()` | Ends it now (the camera comes back) |
| `game.cinematic.slowmo(scale, seconds?)` | The world at `scale` speed (0.25 = a quarter) for `seconds` of real time, or until `slowmo(1)`. The camera moves in real time |
| `game.cinematic.letterbox(on, aspect?)`, `.caption(title, subtitle?)`, `.fade(to, seconds)` | The pieces by hand: bars, words over the picture (`caption(null)` clears), fade to black (1) and back (0) |
| `game.cinematic.define(name, shot)`, `.list()`, `.get(name)` | Shots for this run (config.cinematics keeps them in the game) |
| `game.cinematic.playing`, `game.cinematic.current` | Whether a shot plays, and which |
| `game.photo.open()`, `.close()`, `.take()`, `.on` | Photo mode from a script (a "Photo" button in your menu) |
| `game.photo.clip()` | "Clip that": saves the last 15 seconds and opens it for review |

Players (when the world turns the keys on, `config.share.keys`): **P** photo mode (WASD, Q/E down and up, Shift faster, drag or mouse to look, wheel zooms, Z/X tilt, Space takes
it, H hides the panel, Esc goes back; phones get a stick and up/down buttons; gamepads: sticks, triggers, A takes, B
goes back). **F8** (or 🎬) clip that; right-click 🎬 turns the rolling clip off or on. Photos and clips are downloaded or
shared from a small window on hawkesgen.com: sharing needs an account (free), downloading doesn't.

**Moments:** `game.on('moment', fn)` hears the chip's life: `{ state, kind, caption }` with `state` `chip` (shown), `tap`, `kept`
(the clip or photo is ready), `link` (`url`, `id`), `shared` / `copied`, `window` (the sandboxed game's share window opened),
`declined` (the guest put the sheet away), `failed`, `gone`. `kind` is `boom`, `catch`, `jump` or `dock`. In a script,
`HawkesPlay.share.moments.trigger('boom')` offers one by hand (the same rules apply) and `.hide()` puts it away.
