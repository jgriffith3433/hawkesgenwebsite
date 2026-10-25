## Presence: name tags, chat, emotes, looks, who's here

Every game has it, with nothing to set up. Players see each other's names, talk, emote and dress up; the world only
changes it through `config.presence`.

**What players get:**
- **Name tags** over other players, AI friends, pets and named NPCs. Readable at any distance: they shrink with distance
  (never too small), fade near the edge of their range, and only the nearest show (10 on a computer, 6 on a phone).
  Players and platform friends come before NPCs when it's crowded. Friends are marked ★ (light blue), AI friends ✦,
  pets 🐾; the host wears 👑; three dots show someone typing; a health bar shows when they're hurt. Your own name shows
  only if `self` is on and you're in third person.
- **Speech bubbles:** what players say in game chat (Enter, or 💬 on phones) shows over their head, stacked (three at
  most), wrapped and timed (longer lines stay longer). Everything that talks gets one too: AI friends' replies, NPCs'
  `lines`, creatures and any `e.say(...)`. Lines also show in a small chat log. Scripts hear chat as the event `chat`.
- **Emotes:** wave, dance, cheer, laugh, point, sit, sleep, clap, thumbs up, heart. Hold B (or 😀, or Y on a gamepad)
  for the wheel; keys 1–0 pick one. Everyone in the room sees it on the avatar, with the emoji on the name tag. Sit and
  sleep last until you move. AI friends and pets join in when everyone emotes.
- **Looks:** every player is what they chose at a mirror ("The mirror": a person, an animal, a robot, a shoe...) with a
  name over their head, dressed up (the editor's profile menu has "Change who you are": the mirror's questions anywhere): body, skin and accent
  colors, a shape (normal, tall, short, wide, tiny, big), a hat (cap, beanie, tophat, crown, cowboy, party, halo, horns,
  bunny, helmet, chef), a face (eyes, smile, visor, none: the person has a real one, eyes that follow and blink, brows, a mouth), hair (short, long, ponytail, curly, spiky, bun) and clothes colors (top, bottom, shoes) and up to three extras (glasses, shades, scarf, backpack, cape,
  bowtie, wings, tail), the eyes' color and one of twelve accessories in a color of its own (headphones, goggles, monocle, mustache, eyepatch, flower, antenna, medal, bell, jetpack, bandana, earrings: small meshes on the head, face, neck or back of any body). Other players see them, and a player's tag carries their main color and accessory icon. Or a model, by a community model's asset id (its animations named wave, dance... play the
  emotes). Signed-in players keep their look in every game; guests get a random fun one.
- **Islanders:** an AI friend (`type: "friend"`) with `shape.look` (a look: `what`, `name`, colors) wears that body, a toaster or a rubber duck, like a player's; its creature body is hidden. It takes the same name tag.
- **Who's here** (Tab, or 👥): everyone in the room, friends first, the host marked; + Friend (a request; friends once
  both ask), Mute (their chat and emotes stop showing for you), 👁 Watch.
- **Spectate:** watch another player over their shoulder (◀ ▶ or the arrow keys cycle, Esc stops). Games use it when
  someone is out or waiting (`game.presence.spectate()`).

**`config.presence`** (`false` turns all of it off):

| key | what it does | default |
|---|---|---|
| `tags` | name tags | `true` |
| `size` | how big tags are (2 = twice as big) | `1` |
| `max` | how many tags at once | 10 (6 on phones) |
| `distance`, `npcDistance` | how far tags show (meters) for players, and for NPCs, pets and AI friends | `70`, `28` |
| `colors` | name colors by kind: `{ player, friend, ai, npc, pet, me, thing }` (any CSS color) | white, light blue, lilac, yellow, pink |
| `occlude` | tags behind walls: `"dim"` (or `true`) fades them, `"hide"` hides them | off |
| `self` | your own tag in third person | `false` |
| `npcs` | tags on NPCs, pets and AI friends | `true` |
| `bubbles`, `chat`, `emotes`, `looks`, `list`, `spectate`, `customize` | each part (`false` turns it off) | `true` |

An entity gets a tag when it is an AI friend, a pet (a creature with a name, or one following someone), or has a `name`
and is a creature, `tag: "npc"`, `data.npc: true` or `data.nametag` (a string shows that text instead). `data.nametag:
false` keeps one untagged. Scripts tag anything with `game.presence.tag(thing, 'text', { color, kind })`.

**Examples in words:**
- "Show everyone's name in big letters" → `{ "op": "config", "patch": { "presence": { "size": 2 } } }`.
- "Make NPC names green" → `{ "op": "config", "patch": { "presence": { "colors": { "npc": "#22c55e" } } } }`.
- "Hide names behind walls (a hide and seek game)" → `{ "presence": { "occlude": "hide" } }`; "no name tags at all" →
  `{ "presence": { "tags": false } }`.
- "The shopkeeper should have a name over his head" → give the thing a `name` and `"tag": "npc"` (or `data.nametag`).
- "A dance party where everyone emotes" → a script: `game.presence.emote('dance', 'all')` (on a key, a timer or when a
  song starts): every player, AI friend and pet in the room dances.
- "When you're out, watch the others" → in the game's elimination code: `game.presence.spectate('next')`; back in play:
  `game.presence.spectate(null)`.
