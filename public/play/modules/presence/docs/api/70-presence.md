## Presence (`game.presence`)

Name tags, chat, emotes, looks and spectating for scripts. `game.presence` is the same as `HawkesPlay.presence` (write
`const presence = HawkesPlay.presence;` at the top of a script if you need it before the world runs).

| | |
|---|---|
| `presence.say(text)` | says something in game chat as this player: a bubble over your head for everyone, in the chat log. False if too soon (a few lines per 10 s) |
| `presence.say(thing, text)` | a bubble over any thing (the same as `thing.say(text)`) |
| `presence.emote(name)` | plays an emote on your avatar for everyone: `wave dance cheer laugh point sit sleep clap thumbsup heart` (also "hi", "lol", "thumbs up"...) |
| `presence.emote(name, 'all')` | everyone in the room does it (players, AI friends and pets) |
| `presence.emote(name, thing)` | a thing does it (AI friends and creatures act it out; scene things are synced) |
| `presence.emotes()` | the list: `[{ name, icon, label, loop }]` |
| `presence.tag(thing, text, { color, kind })` | a name tag on anything (`kind`: npc, pet, ai, thing); `presence.tag(thing, null)` removes it |
| `presence.players()` | everyone here, you first then friends: `[{ id, name, me, friend, host, typing, muted, user, entity }]` |
| `presence.spectate(who)` | watch a player: `'next'`, `'prev'`, a player id, or `null` to stop. `presence.spectating()` is the one watched |
| `presence.mute(id, on)`, `presence.muted(id)` | mute a player's chat and emotes (for you only) |
| `presence.look`, `presence.setLook({ ... })`, `presence.randomLook()` | your look: `{ body, head, accent: '#hex', shape, hat, face, extras: [], model }` (saved to your account when signed in) |
| `presence.customize()`, `presence.showPeople()`, `presence.openChat()`, `presence.openEmotes()` | open the panels |
| `presence.on('say' / 'emote' / 'spectate' / 'people' / 'look', fn)` | hear about it (`say`: `{ name, text, me, friend, npc }`) |
| `presence.filter = (text) => text` | change chat lines before they show (a word filter) |
| `game.on('chat', fn)` | every chat line as a game event: `{ name, text, me, player }` |

Playing together: each player sends their own look, typing, health and host flag (`H.sync.state('presence:<id>')`);
lines and emotes go through the host (`H.sync.action('presence:say' / 'presence:emote')`) so everyone sees each once,
and a player can only speak or emote for themselves. Signed-in players show a signed badge; `/v1/presence/who` turns it
into their platform name and whether they're your friend.

```js
// A dance floor: step on it and everyone dances.
game.entity('floor').on('hit', (who) => { if (who === game.player) game.presence.emote('dance', 'all'); });

// A greeter who answers when someone says hello in chat.
const greeter = game.entity('greeter');
game.presence.tag(greeter, 'Greeter', { color: '#22c55e', kind: 'npc' });
game.on('chat', (m) => { if (!m.me && /\b(hi|hello)\b/i.test(m.text)) greeter.say(`Welcome, ${m.name}!`); });

// Out of lives: watch the others until the round ends.
game.on('death', () => { if (game.state.lives <= 0) game.presence.spectate('next'); });
game.on('round', () => game.presence.spectate(null));
```
