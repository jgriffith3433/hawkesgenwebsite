## The mirror (`game.mirror`)

Who players are: a `mirror` thing's questions (WORLD.md, "The mirror"). For scripts:

| | |
|---|---|
| `game.mirror.open(mirror?)` | opens the questions at a mirror (the thing, its name, or the nearest one) |
| `game.mirror.dress()` | the same questions anywhere, without a mirror (a character screen); `dress({ steps: ['what'], whats: ['animals'] })` asks less |
| `game.mirror.close()` | closes them (what they chose so far stays) |
| `game.mirror.isOpen`, `game.mirror.step` | whether it's open, and which question is on screen (`what`, `look`, `name`, `view`) |
| `game.mirror.pending` | a mirror will open by itself in a moment (after the intro) or is open: wait before greeting |
| `game.on('mirror', ({ state, what, name, step }) => ...)` | `open`, `step`, `pick` (they picked a `what`), `done` or `skip` (with `what` and `name`) |
| `game.presence.look` | what they chose: `{ what, name, body, accent, head, shape, hat, face, extras, eyeColor, accessory, accessoryColor }` |

```js
// The game starts once the player has been to the mirror.
game.on('mirror', ({ state, name }) => {
  if (state !== 'done' && state !== 'skip') return;
  game.ui.message(name ? `Go, ${name}!` : 'Go!');
  startRace();
});
// A shoe gets a speed boost (what you are can matter).
game.on('mirror', ({ state, what }) => { if (state === 'done' && what === 'shoe') game.player.speed = 9; });
```
