## Homes (`game.homes`)

Houses, furniture and screens are things like any other (`game.house({...})`, `game.sofa({...})`, `game.tv({...})`
make them; WORLD.md "Homes" lists their options). `game.homes` is how scripts use them and build with them.

| Call | What |
|---|---|
| `game.homes.house({ rooms, floors, style, x, z, rotation, ... })` | A whole furnished house (the same options as the `house` thing). Returns it. |
| `game.homes.room({ type: 'kitchen', size: [6, 4], x, z })`, `game.homes.wall({ length, openings, x, z, rotation })` | One room; one wall with doors and windows. |
| `game.homes.plan(options)` | The plan of a house without making it: `{ size, floors, rooms: [{ name, type, floor, x, z }], parts }`. |
| `game.homes.find(house, what)`, `findAll(house, what)` | A house's pieces: `'front-door'`, a kind (`'fridge'`, `'tv'`, `'lamp'`), or a room's name (`'Kitchen'`). |
| `game.homes.use(thing, action?)` | Uses it as if a player pressed E (`action` picks one by its words: `'open'`, `'sit'`, `'flush'`, `'eat the apple'`). False if it can't now. |
| `game.homes.target` | What the player is looking at that they can use: `{ thing, action }` or null. |
| `game.homes.usable(thing, label, fn, at?)` | Makes anything usable with E: `game.homes.usable(npc, 'talk', () => npc.say('Hi!'))`. `fn(ctx)` gets `{ player, thing, set }`. |
| `game.homes.state(thing)` | Its shared state: `{ open }`, `{ on }`, `{ on, channel }`, `{ taken }`, `{ flushes }`... |
| `game.homes.set(thing, patch)` | Changes it for everyone: `game.homes.set(door, { open: true })`. |
| `game.homes.open(thing, open = true)`, `game.homes.power(thing, on?)` | Doors, fridges, cupboards; TVs, radios, lamps, taps, ovens (no `on`: flips it). |
| `game.homes.channel(tv, which)` | A channel by number (0 is the first) or by name (`'news'`), for everyone. |
| `game.homes.channels(tv, list)` | Its channel list (scripts run for everyone, so everyone gets it). |
| `game.homes.show(tv, channel)` | Shows a channel now, just here (null goes back): `{ text: () => 'Score: ' + game.state.score }` is a live scoreboard. |
| `game.homes.sit(thing)`, `game.homes.stand()` | Sits the player down on it (or lies them in a bed); gets them up. |
| `game.homes.note(n, { voice, volume })` | Plays a note (60 is middle C; voice piano, organ, synth, bell). |

Things you can use hear it: `thing.on('use', ({ action, player }) => {})`, and `thing.on('change', (state, changed) => {})`
when its state changes (from anyone). The game hears `'eat'` (`{ item, from }`), `'take'`, `'sleep'` (`{ bed }`),
`'shower'`, and `'note'` (`{ note, from }`, piano notes).

Tools (`game.player.tool = 'remote'`): **`remote`** (click: next channel of the TV you point at, R: on/off, Q: put
away) and **`phone`** (its screen shows the clock, every camera and the shows; click: next, Q: put away). Picking up a
`remote` or `phone` thing gives them. The **`seat`** controller is sitting and lying (`game.player.controller ===
'seat'` while seated).

```js
// A game show: the TV in the living room becomes a scoreboard, the fridge gives points.
const house = game.entity('house');
const tv = game.homes.find(house, 'tv');
game.state.score = 0;
game.homes.show(tv, { text: () => `Snacks eaten: ${game.state.score}` });
game.on('eat', () => { game.state.score++; });

// Lock the front door until the player finds the key.
const door = game.homes.find(house, 'front-door');
door.data.locked = true;
game.find('Key').on('hit', (who) => { if (who === game.player) { door.data.locked = false; game.ui.message('The door is open!'); } });

// Lights out at night: every lamp in the house.
game.after(60, () => { for (const lamp of game.homes.findAll(house, 'lamp')) game.homes.power(lamp, false); });

// Make an NPC you talk to with E.
const bob = game.capsule({ x: 3, y: 0.9, color: '#e07a5f' });
game.homes.usable(bob, 'talk to Bob', () => bob.say('Nice house you have!'));
```

Modules: `H.homes` has the same and more: `usable(e, points)`, `track(e, initial, apply, key)` (shared state),
`sit(e, at, yaw, { pose })`, `furniture(kind, shape, opts, make)` (a kind made of parts, wearing a model by name),
`tune(screen, channel)`, `screen(e, mesh)`, `loop({ asset, synth, thing })` (a sound near a thing), `assemble(root, parts)`
(pieces that follow a thing). A vehicle or creature module can make its things usable with `H.homes.usable(e, [{ label:
'get in', at: [x, y, z], use(ctx) {} }])` to share the E prompt.
