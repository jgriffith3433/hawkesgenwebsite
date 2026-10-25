## Progress (`H.progress`, `game.on('progress')`)

```js
// Events: every earn, every level, every unlock, and the Overseer's moment.
game.on('progress', ({ state, id, pts, total, level, key, text }) => { /* state: 'earn' | 'level' | 'unlock' | 'moment' */ });
// A game's own deeds can earn by the table (ids in progress-core.js EARN):
HawkesPlay.progress.earn('quest');        // a quest done
HawkesPlay.progress.did('help');          // a friend helped: its points, and the first time the first-time points
HawkesPlay.progress.state;                // { pts, level, bar: { into, span, frac }, name: { one, many }, firsts, meters }
HawkesPlay.progress.has('tool:grenade');  // is it theirs yet
game.emit('helped', {});                  // the one event a script can send for "helped a friend"
```

Adding an unlock is one line in `progress-core.js` `UNLOCKS`: `[level, kind, id, label, line?]` with kind `acc` (an accessory id
from `presence-core.js`), `col` (a hex color without #) or `tool` (an `H.tools` name). The line is the Overseer's own words when
given; otherwise its kind's line is used. Points are earned only after a world has settled (3 s) and the Overseer's intro and
mirror are over.
