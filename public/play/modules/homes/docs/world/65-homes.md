## Homes: houses, furniture that works, screens and media

A whole furnished house is **one thing**: `{ "type": "house" }`. Its walls (doors and windows cut in), floors, stairs,
roof, a light and a switch in every room and the furniture are made for you, and they move with it. Players walk in
through the front door. Everything is made of shapes, so it works with no art; a model asset named after a piece of
furniture (`sofa.glb`, `fridge.glb`, ...) or given as `shape.model` replaces its look, and `<style>_wall.png`,
`<style>_floor.png`, `<style>_roof.png` (or `shape.textures`) cover a house.

**Using things:** players look at a thing and press **E** (on a phone: **B**, or tap the prompt). The prompt says what E
does ("Sit", "Open the fridge", "Next channel"). Chairs, sofas, toilets and pianos sit you down, beds and bathtubs lie
you down (space, E or walking gets you up). Doors, fridges and cupboards open; lamps, switches, taps, showers, ovens,
TVs and radios turn on and off. What one player does, everyone in the game sees (an open door is open for all).

### House (`house`)

Its position is the middle of its footprint at ground level; the front door is on its -z side (turn it with rotation).
Rooms are 5 m squares (`shape.size`), floors are 3 m high, stairs join the floors.

| shape | what | default |
|---|---|---|
| `rooms` | a number, or a list of room kinds: `living`, `kitchen`, `bedroom`, `bathroom`, `dining`, `office`, `music`, `kids`, `studio`, `garage`, `hall` (plain words work: "living room", "study", "bath"); or objects `{ "type": "bedroom", "name": "Mia's room", "tv": "cartoons", "furnish": false }` | 4 |
| `floors` | 1 to 4 | 1 (2 for more than 4 rooms) |
| `style` | `cozy`, `modern`, `cabin`, `brick`, `beach`, `castle`, `pastel` | `cozy` |
| `tv` | the living room TV's channels: `"cartoons"` or a list (see Screens) | the usual shows |
| `roof` | `gable`, `flat` or `false` | by style |
| `furnish` | `false`: empty rooms (still lights and doors) | true |
| `colors` | `{ "ext", "int", "floor", "roof", "trim", "door", "sofa", "bed" }` | the style's |
| `textures` | `{ "wall", "inside", "floor", "roof" }` texture assets | `<style>_wall.png`... if they exist |
| `size`, `width`, `depth`, `height` | a room's size and a floor's height, meters | 5, 5, 5, 3 |
| `security` | a camera over the front door; its picture is on the office computer | true |
| `show` | the name of the live show a `studio` room films (every TV in the game gets it as a channel) | Hawkes News Live |
| `shower` | bathrooms get a shower too | false |

What each room gets: **living** sofa, TV (on, with a remote on the coffee table), lamp, bookshelf, plant, clock, radio,
rug; **kitchen** fridge full of food, cupboards, sink, oven, table and chairs; **bedroom** bed, bedside lamp, wardrobe;
**bathroom** bathtub (with a rubber duck), toilet, sink; **dining** table and four chairs; **office** desk, computer
(showing the front door camera), phone, chair, shelf; **music** piano, sofa, radio; **kids** small bed, balls, toys;
**studio** a news desk, a host, studio lights and a camera that broadcasts to every TV; **garage**, **hall** nearly empty.

`{ "type": "room", "shape": { "type": "kitchen", "size": [6, 4] } }` is one room on its own (a door on its -z side,
`roof: false` leaves it open-topped). `{ "type": "wall", "shape": { "length": 6, "height": 2.8, "openings": [{ "type":
"door", "at": -1.5 }, { "type": "window", "at": 1.2, "width": 1.2 }] } }` is a wall (position: the middle of its bottom
edge; it runs along its own x); doors in it get a working door. In the editor, **V** draws walls (V at the start, V at
the end; it keeps going; X stops), **N** cuts a door where you look at a wall, **M** a window.

### Furniture (stands on the floor: its position is the floor point under it; its front faces +z)

| type | what it does | shape / data |
|---|---|---|
| `chair` | sit | `height` |
| `sofa` | sit (one place per seat) | `seats` 1-4 (1 is an armchair) |
| `bed` | lie down; lying a while you sleep (`game.on('sleep')`) | `size`: `single` / `double`; material.color is the blanket |
| `table`, `desk` | tables (a coffee table: `size [1.1, 0.42, 0.6]`) | `size [w, h, d]`, `round` |
| `shelf` | a bookshelf | `size`, `books: false` |
| `plant`, `rug` | cozy things (rug: `size [w, d]`, `round`; position y 0.006) | |
| `door` | opens and closes; closed it's solid | `width`, `height`, `hinge` left/right, `auto` (opens as you come), `data.locked` |
| `fridge` | opens; food inside you eat or drink (`game.on('eat', d => d.item)`); refills when empty | `data.items`: milk, juice, soda, water, apple, orange, cheese, eggs, cake, pizza, sandwich, icecream, carrot, banana, bread (or any name) |
| `cupboard` | a wardrobe or cabinet that opens; can hold `data.items` | `size [w, h, d]` |
| `lamp` | a light: floor lamp, `table: true`, `ceiling: true` (hung from `height`) | `light: { color, intensity, range }`, `on` |
| `switch` | on a wall (position: its center, ~1.2 m up): turns the lamps of its room, or `data.controls: [ids]`, or the lamps within 9 m | `data.controls`, `data.room` |
| `sink` | the tap runs water and fills the basin | `size`, `sound` (asset) |
| `bathtub` | run the bath (it fills; floating things bob), lie in it | `sound` |
| `shower` | water on and off; standing under it, `game.on('shower')` | `sound` |
| `toilet` | sit, or flush (everyone hears) | `sound` (default flush.mp3 if the game has it) |
| `oven` | on and off: it glows and its rings go red | |
| `clock` | on a wall (position: its center): the real time; E says it | `digital`, `size`, `timezone` ("Asia/Tokyo") |
| `piano` | sit at it and play: keys A W S E D F T G Y H U J K O L P (white and black keys from middle C), everyone hears | `voice`: piano, organ, synth, bell; `sound`: a middle-C sample asset |

### Screens and media

| type | what | shape |
|---|---|---|
| `tv` | E turns it on, E again: next channel, E at its base: off. Stands on the floor (or `wall: true`, its middle at `height`) | `channels`, `width` (1.2), `on`, `start` |
| `computer` | a monitor, keyboard and mouse; put it on a desk (y = 0.75). Same channels; `desktop` shows its desktop (`data.lines` are typed on it) | `channels` |
| `projector` | throws a big picture `throw` meters ahead (a movie night) | `channels`, `throw` (4), `width` (2.6), `lift` |
| `cctv` | a camera (position: its center; turn it with rotation, `pitch` degrees down). Screens show its picture; `data.show` names the show it films, and every TV gets that channel | `pitch`, `fov`, `data.show` |
| `radio` | E: on, next station, off. Stations are music assets; until they exist it plays tunes of its own | `stations`, `volume` |
| `remote` | lies on a table; E picks it up (the `remote` tool) | |
| `phone` | lies on a table showing the time; E picks it up (the `phone` tool: its screen shows every camera and show) | |

**Channels** (`shape.channels`, a list; each one is any of these):
- a built-in show, drawn live with no art: `"cartoons"`, `"news"`, `"nature"`, `"sports"`, `"weather"`, `"music"`,
  `"cooking"`, `"desktop"`, `"clock"`, `"bars"`, `"static"`. When the game has a video asset of that name
  (`cartoons.mp4`) the video plays instead.
- a video asset: `"my-show.mp4"` or `{ "asset": "my-show.mp4", "title": "My show" }` (a test card until it's made; a
  `video` asset is made by asking for one: ~40 credits)
- a camera in the world: `{ "camera": "<its id, name or show>" }`, or just the show's name (`"Cooking with Bob"`)
- words: `{ "text": "Welcome home!" }`; a picture: `{ "image": "poster.png" }`

**A TV show inside the game:** a `cctv` with `data.show: "Cooking with Bob"` pointed at a kitchen set with a host is a
live show; every TV gets the channel "Cooking with Bob" (a house's `studio` room is exactly this).

### In words: what to make

- "build me a two-storey house with a living room, a TV playing cartoons, a kitchen and a bedroom" →
  create `{ "type": "house", "name": "House", "transform": { "position": [x, 0, z] }, "shape": { "rooms": ["living",
  "kitchen", "bedroom", "bathroom"], "floors": 2, "tv": ["cartoons", "news", "nature"] } }` 12+ m in front of the player.
- "a cabin with three bedrooms" → `{ "type": "house", "shape": { "style": "cabin", "rooms": ["living", "kitchen",
  "bedroom", "bedroom", "bedroom", "bathroom"] } }` (2 floors by itself).
- "a modern flat-roofed house, empty, I'll furnish it" → `"style": "modern", "furnish": false`.
- "put a TV on that wall showing the news" → a `tv` with `"wall": true, "height": 1.5, "channels": ["news"]`, its back
  against the wall, facing into the room.
- "make a TV show": a room (or a `studio` room in the house) with a `cctv` whose `data.show` is the show's name; TVs
  pick it up. "Make it a real video" → also ask for a `video` asset with that name and add it to the TV's channels.
- "a security camera on the door and show it on my computer" → a `cctv` over the door, and the computer's channels
  `["desktop", { "camera": "<the cctv's id>" }]`.
- "a cozy bedroom" → `{ "type": "room", "shape": { "type": "bedroom" } }`; "add a sofa here" → a `sofa` at the
  point they look at (y = the floor's height), turned to face them.
- "a fridge full of pizza and ice cream" → `{ "type": "fridge", "data": { "items": ["pizza", "icecream", "soda"] } }`.
- "let me play the piano" → a `piano`; "make the radio play jazz" → a `music` asset `jazz.mp3` and the radio's
  `"stations": ["jazz.mp3"]`.
- "lock the front door" → a house's pieces aren't separate things in scene.json, so a script does it:
  `game.homes.find(game.entity('house'), 'front-door').data.locked = true` (API.md, "Homes"). Or make the house with
  `"doors": false` and add `door` things of your own.
