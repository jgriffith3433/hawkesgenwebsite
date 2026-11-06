## The Overseer, the sky and the planet (`game.overseer`, `game.sky`)

```js
// A beam from the Overseer onto the crate (things you create are beamed in by themselves).
game.overseer.beam(game.find('Crate'), { radius: 2 });
// Beam something in: it grows out of the light.
const gift = game.box({ x: 0, y: 0.5, z: 6, color: '#ffd166' });
game.overseer.materialize(gift);
// Arrivals: things made by spawnMany come down by themselves (dropped, grown or beamed, by what they are).
game.spawnMany('car', 1, { at: [0, 0, 10] });              // out of the sky onto that spot (on the roof if there is one)
game.spawnMany('cow', 20, { at: game.player, area: 10 });  // a herd rains down one by one
game.spawnMany('crate', 4, { arrive: 'beam' });            // or say how: 'drop', 'grow', 'beam', 'none'
// Things a script makes with game.box, game.model... just appear; bring one in from the sky yourself:
const prize = game.box({ x: 0, y: 0.5, z: 6, color: '#ffd166', physics: 'dynamic' });
game.arrive(prize, 'drop');
game.on('landed', ({ thing, at, weight }) => { if (weight > 0.6) game.ui.message('THUD', 1); });
// The Overseer speaks: a line in the game's chat window, never a caption over the picture.
game.overseer.say('You found the key. Do with it what you will.', 4);
// The time of day.
game.sky.hour = 'night';              // or 21.5
game.sky.time = { hour: 6, minutes: 8 }; // a running clock
if (game.sky.hour > 20) game.ui.message('Night falls');
// How high you are, and whether you've reached space.
game.every(1, () => { if (game.sky.space > 0.9) game.ui.message('Space!', 1); });
game.on('docked', () => game.ui.message('Welcome aboard'));
// While the Overseer builds something someone asked for (its beams, the lit-up area, the work pill):
game.on('workStart', ({ at }) => {});          // it started (at: where)
game.on('workBeat', ({ n, title }) => {});     // a new beat of the build ("The stalls go up")
game.on('workEnd', ({ ok, ops }) => {});       // it finished (ops: how many changes landed)
game.on('terrainStep', ({ step, of }) => {});  // the ground it is reshaping moved another step
```

| | |
|---|---|
| `game.overseer.beam(target, opts)` | A beam from the emitter to a thing or `[x, y, z]`. `opts`: `radius` (m, at the bottom), `seconds` (1.6), `hold: true` (stays until `.end()`), `color`, `entity` (grows in), `ring`, `sound`. Returns `{ end(), move(target) }` |
| `game.overseer.materialize(thing or [things], opts)` | Beams it in (one wide beam for several) |
| `game.overseer.say(text, seconds, opts)` | Words from the Overseer: a line in the game's chat, through the speech desk (below). `seconds` is the least time it holds the desk; `opts.priority`: `'low'`, `'normal'` (default) or `'important'` |
| `game.overseer.speak(text, voice, seconds)` | The same, spoken in its voice: `voice` is one of its lines (`HawkesPlay.overseer.VOICES`: the intro, the mirror's questions and remarks, `overseer-welcome-aboard.mp3`...) or a sound asset of the game's. A new line needs a voice made first (ask J). Same `opts` as `say` |
| `game.speech` / `HawkesPlay.speech` | The speech desk, below |
| `game.on('overseer-speech', ({ state, text, voice, caption, voiced, priority, seconds, interrupted }) => ...)` | A line starts (`state: 'start'`: `caption` says whether its words are shown, `voiced` whether its clip plays) or ends (`'end'`), or the settings change (`'settings'`) |
| `game.arrive(thing or [things], how)` | Brings it in from the Overseer where it is now: `'drop'` (from high in the beam; real physics while playing; lands on a roof over it), `'grow'` (up out of the ground), `'beam'`, `'auto'` (by what it is). Several drop one by one |
| `game.spawnMany(what, n, { arrive })` | `arrive`: `'drop'`, `'grow'`, `'beam'`, `'none'`, or `{ how, delay, gap }` (seconds before the first, between each). Default: by what it is. Online the host's copies fall for real and everyone sees the same |
| `game.on('landed', ({ thing, at, weight, on }) => ...)` | A dropped thing came down (`weight` 0-1: how heavy it felt; `on`: what it landed on) |
| `game.overseer.intro()` | Plays the intro now (a promise: `{ skipped }`) |
| `game.overseer.position`, `.radius` | Where it is (`null` when the game has none) |
| `game.sky(colorOrAsset)` | As before: a sky picture or colour |
| `game.sky.hour` | The clock's hour (0-24; `null` with no clock). Set it (a number or `"night"`, `"dawn"`...) to jump there |
| `game.sky.time = value` | Like `config.time` (WORLD.md) |
| `game.sky.day` | Daylight now, 0.12 (night) to 1 |
| `game.sky.altitude`, `game.sky.space` | The camera's height above sea level, and 0 (in the air) to 1 (in space) |
| `game.on('intro', ({ state, skipped }) => ...)` | The intro starts (`state: 'start'`) and ends (`'end'`) |
| `game.on('beam', ({ at, radius, entity }) => ...)` | Every beam |
| `game.on('docked')`, `game.on('undocked')`, `game.on('docked-pad', ({ vehicle }))` | In the Overseer's hangar; landed on its pad |
| `game.on('observatory', ({ state, first }))` | The Observatory (the round room inside the ship, up the hangar's lift): `state` is `'enter'`, `'scene'` (the first arrival's scene starts), `'gift'`, `'ready'` (the scene or the quick line is done) or `'leave'`; `first` is true on the first arrival |
| `game.on('observatory-gift', ({ gift, kind, label }))` | The Overseer's gift (an accessory id, now in the player's look), once per device |
| `H.overseer.observatory` | `{ on, inside, state ('bay' \| 'riding' \| 'inside'), first, scene, lift, liftRoom, gift, pearl, level, music, places, go(), leave(), skip() }`; `H.overseer.interior(on)` hides the hull and hangar's look (the Observatory does); `H.overseer.bay` gives the bay's numbers |
| `H.overseer.dockShip(vehicle, out)` | Settles a ship on the hangar's pad by the dock path (the Docked moment and `docked-pad`, as a flown ship does); `out` puts the player on foot beside it. For tests and playtests. In the hangar on foot the sandbox's quest line reads "The Overseer's lift" |
| `game.on('bay-catch', ({ distance }))` | The catch took hold of a rocket or ship coming in (`H.overseer.assist = false` turns it off) |
| `game.on('ascent-failed', (d))` | A rocket/ship climb failed: `d.why` is `'wrecked'`, `'fuel'` (out of fuel high up) or `'fell'` (back on the ground after a climb), `d.vehicle`, `d.maxAltitude`. Set `d.handled = true` to say your own line (and give a new rocket); else the Overseer speaks |
| `H.overseer.approach` | While a rocket/ship flies: `{ distance, speed, closing, align, lateral, height, allowed, tooFast, state, advice, catching }` toward the pad, else null |

**A round planet** (`config.planet.sphere`, new games): scripts work in the world around the player, as on flat ground:
up is +y where the player is, positions near the player are small numbers, `game.box({ y: 1 })` near the start is on
the ground. Farther round, use `game.planet`:

| | |
|---|---|
| `game.planet.round`, `.radius` | Whether the world is a round planet; its radius (m) |
| `game.planet.up([x, y, z])` | Which way is up there (away from the middle; `[0, 1, 0]` on a flat world) |
| `game.planet.height([x, y, z])` | How high a point is over the ground |
| `game.planet.toPlanet(p)`, `.toLocal(p)` | A point here → where it is on the planet (scene.json's numbers), and back |

```js
// A beacon 20 m over the ground wherever the player is, standing up there.
const up = game.planet.up(game.player.position);
game.cylinder({ position: game.player.position.map((v, i) => v + up[i] * 20), radius: 0.3, height: 2, emissive: '#8fd8ff' });
```

Modules (round worlds): `H.planet.round`, `H.planet.heightOf(p)`, `H.planet.up(p)`, `H.planet.center`, and
`H.planet.frame` (round.js): the engine runs in a frame around the player that moves under them every ~100 m round;
`frame.onRebase((tr) => ...)` turns what a module keeps itself (`tr.point(p)`, `tr.dir(v)`, `tr.quat(q)`: Living things'
goals and vehicles' own state do this; entities, bodies, characters, the camera and the Overseer are moved for you),
`frame.toPlanet(p)` / `toLocal(p)`, `frame.fromScene(transform)` / `toScene(ops)` (scene.json keeps things on the
planet; edits made here are converted by `H.applyOps(ops, { local: true })` and the editor). Gravity pulls bodies to the
middle (physics.js); dynamic things and characters more than 1.5 km off rest (`e._far`) until the player comes back.

Modules: `H.sky` (the one owner of the clock and the light: report what you want with `H.sky.set(owner, { dark, flash,
weather })`, never write the lights yourself; `H.sky.bg` is the far layer, `H.sky.onBg(fn)` places far things each
frame), `H.planet` (`air(y)`, `altitude(y)`, `drop(d)`, `space`, `radius`, `surface`; every standard/PBR material curves
with the planet; a custom shader adds `y -= |xz - camera.xz|² / 2R` itself), `H.overseer` (`beam`, `materialize`,
`emitter()`, `flare(k)`, `hangar`, `docked`, `intro`; a beam's `pulse(k)`), `H.arrive` (`bring(things, { how, exact })`,
`how(entity)`, `plan(specs)` (building: a drop's spot, roof and all, before the op), `landing(at, { lift, half })`,
`quake(at, { radius, rise, seconds })` (the ground moving), `down(at)` / `up(at)`, `of(entity)`, `active`).

The Overseer's first-time lines (`lines.js`): `H.lines.say(id)`, `.seen(id)`, `.blocked()`, `.reset()`; ids `build`, `fish`, `death`, `dock`, `space`, `boom`, `friend`, `return`. Each is said once per device, in the chat (`game.on('overseer-line', ({ id, text, voice }))` hears it), and waits while the intro, the mirror or a tour moment is on or another Overseer line is being read.

The Overseer's free phrasebook (`talk.js`): in every game, published ones too, Enter (or the 💬 button on a phone) opens the chat box and plain talk is answered in the Overseer's voice at no cost (no model: keyword rules, several variants each). Where the builder's assistant is attached (the editor, the signed-in sandbox) typing goes to it instead. Requests to make or change things are explained, with a Get started link; questions about its motives are turned away kindly. `H.talk.reply(text)` gives `{ intent, text, action? }`, `H.talk.say(text)` says it in the chat, `game.on('overseer-talk', ({ intent, said, text }))` hears it. With other players here, typing also goes to them and the Overseer answers only when its name is said.

**The Overseer's speech desk** (`HawkesPlay.speech`, `modules/overseer/speech.js`): every Overseer line, whoever asks (`say`, `speak`, its first-time lines, the mirror, the tour, talk), goes through one desk, one line at a time.

- Lines never overlap. A later line of the same or lower priority waits its turn (a `low` one gives up after 20 s, a `normal` one after 45 s); an `important` one (the answer to what you typed, the mirror's questions, the intro) cuts in gently: the voice fades in a quarter of a second, the words showing finish at once, then it speaks.
- A line lasts as long as its voice clip, else as long as it takes to read (about a second and 0.3 s a word). Its words type out in the chat over that time.
- **Captions.** With captions on (the default) every line is shown. Off, a line is hidden only while its voice is really heard (it has a clip, the voice is up, sound is running): with sound off, the voice at 0 or no clip, it is always shown. Sound off never loses a line.
- **Settings** (kept per device; the chat's ⚙, the editor's menu): captions on/off, the Overseer's voice volume and the music volume, each apart (`audio.voiceVolume`, `audio.musicVolume`). The chat's ⟲ (the editor's menu) replays the last line.
- The editor's assistant replies are captions in its chat. They are spoken only when the Overseer has a clip with those very words; never the browser's voice.

```js
const s = HawkesPlay.speech;
s.say({ text: 'The tide is in.', priority: 'normal' });          // queues behind what is being said
s.say({ text: 'Look up.', voice: 'overseer-ask.mp3', priority: 'important' }); // cuts in gently
s.set({ captions: false, voice: 0.6, music: 0.3 });             // the player's choices
s.replay();                                                      // the last line again
s.current; s.waiting; s.busy; s.log;                             // what is said, what waits, what was said
```

### The journal (the sandbox island; `H.memory.journal`)

The Overseer's memory also keeps which neighbours the player has met and which lore they have found, as ids (at most 16 each, `[a-z0-9-]`, kept in the account when signed in, on the device otherwise, merged by union).

```js
const j = HawkesPlay.memory.journal;
j.get();            // { met: ['pip', 'dolores'], lore: ['lamp'] }
j.meet('rolo');     // true when it was new; saved
j.find('tally');    // true when it was new; saved
```

The sandbox's `journal.js` is the panel (a book button top right, **N**, or the editor's pause menu "Journal"). Events: `game.on('met', {id})`, `game.on('lore-found', {id, n, title})`, `game.on('journal', {open, from})`. Funnel: `sandbox_journal_open {from, quests, met, lore}` and `sandbox_lore_found {id, n, found}` (add, never rename).
### The travel board (inside the Observatory)

```js
const ob = H.overseer.observatory;
ob.board;                  // [{ id, name, line, count, at }]: the featured games as planets (count: players there now, null until known)
ob.travel('platform-run'); // what E under a planet does: the Overseer speaks, fade, then navigate to /play/t/<id>?from=observatory&look=...
ob.beamIn();               // back from a game (?return=observatory does it on load): at the board, with a line
ob.traveling;              // { game, phase, href } while a trip lasts
game.on('observatory', ({ state }) => {}); // + 'travel', 'beam-down', 'return', 'travel-failed'
```
A featured game page opened with `?from=observatory` has a corner button and a pause menu (Esc twice) with "Return to the Observatory".

### It is alive (presence)

The ship reacts, with the same meshes (no draw calls added): while the speech desk has a line, the halo brightens and the rings turn about three times as fast; before a beam opens the emitter flares (the shaft follows 0.28 s later); at night the seams glow much stronger; when the player asks it something (the chat, or `game.emit('asked')`) it turns its bay toward them for 14 s (seen from afar, where the ship is drawn in the sky; close up the real hangar stays put); after 40 s of nothing it idles with slow, deeper breathing. A low hum (two sines and a soft triangle, through the background so a voice ducks it and the music slider sets it) is silent on the ground and rises as the player climbs and the ship gets near.

```js
game.overseer.presence();   // { speaking, flare, idle, quiet, attending, turn, halo: {alpha, scale}, rings: {speed}, seams: {glow}, night, hum: {level, playing, altitude, distance}, beams }
HawkesPlay.overseer.attend(seconds);   // face the player, as a question does
```

## Reactions (`H.reactions`, modules/overseer/reactions.js)

The Overseer answers what it just did, every time, in its own voice. `build` (a request came down), `fail` (it did not) and
`idle` (the player has been quiet 75 s, at most one per 120 s) each have twelve or more lines; `think` is the work pill's
headline while it works (it changes every 4 s until the first beat). Each kind is a shuffled deck: every line is used
before any repeats and never the same twice in a row. `H.reactions.say(kind)`, `pick(kind)`, `history()`, `reset()`,
`IDLE_AFTER` / `IDLE_GAP` (settable); `game.on('reaction')` gives `{ kind, text }`. Spoken through the speech desk when
`H.lines.blocked()` is clear, dropped after 25 s. Tests `test/engine/reactions.test.ts`; playtest `overseer-personality`.
