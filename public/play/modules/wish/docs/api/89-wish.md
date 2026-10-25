## The daily wish (`H.wish`, `game.on('wish')`)

```js
game.on('wish', ({ state, id, n, of, pts, streak, gift, text }) => { /* 'offer' (spoken on arrival) | 'progress' | 'done' | 'day' (midnight UTC passed) | 'line' (an Overseer line) */ });
HawkesPlay.wish.state;   // { day: '2026-10-25', wish: 'fish-one', hud, n, of, done, streak, best, loaded }
HawkesPlay.wishCore.wishFor('2026-10-25');   // the wish of a day: a pure function of the UTC date
```

A wish is one line of the table in `wish-core.js`: `[id, kind, n, hud, say, pts, extra?]`. `kind` says what counts (fish, different
fish, things blown up, blown up from a vehicle, meters, races, a race under a time, dock, quest, lore, neighbours, things made,
asks, help, space, standing still, swimming, a photo of the planet, at dawn, a friend at the hut); `say` is the Overseer's words,
spoken once; `extra` is `{ needs, course, under, gift }`. The table has 40, each day takes the next of a shuffle seeded by the
40-day cycle (a wish does not come twice in a cycle, nor on two days running). The streak: a wish done on the day after the last
one adds one; any other gap starts at one; the HUD shows a streak only while it can still be carried on. The record (`last`,
`st`, `best`, `day`, `n`, `set`, `said`) is `H.memory.wish`. The game's own events move a wish on (`catch`, `explosion`,
`race` finish, `docked`, `quest`, `lore-found`, `met`, `spawned`, `asked`, `helped`, `swim`, and `photo`, which the photo
mode emits with the sky's `space` and `hour`).
