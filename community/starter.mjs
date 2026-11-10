// The community starter pack: what Hawkes makes for every player to use, five in each category.
// A group is one kind and one category (`tag`: the shelf it sits on in the library, one word); each entry is
// [name, what it is, more search words]. tools/starter.mjs turns them into Gen jobs (filed in the starter project with
// labels pack, community, kind, tag, tags, name, item), and the portal lists whatever is finished (src/community.ts).
// Names are unique within a kind (the item key is kind/name). Add to this list freely: a run only makes what isn't made yet.

export const STARTER = [
  // ------------------------------------------------------------ 3D models (four views, high + low detail)
  { kind: 'model', tag: 'props', items: [
    ['Wooden crate', 'a sturdy wooden crate with iron corner brackets', 'box container wood'],
    ['Oil barrel', 'a red metal oil barrel with dented ribs', 'drum metal container'],
    ['Treasure chest', 'an old iron-banded wooden treasure chest, closed', 'loot box chest'],
    ['Brass lantern', 'a brass lantern with glass panes and a top ring handle, standing upright', 'lamp light'],
    ['Wooden barrel', 'a wooden barrel with metal hoops, standing upright', 'cask keg container'],
  ] },
  { kind: 'model', tag: 'nature', items: [
    ['Oak tree', 'a stylized leafy oak tree with a thick trunk', 'tree forest plant'],
    ['Pine tree', 'a tall stylized pine tree', 'tree conifer forest'],
    ['Bush', 'a round green leafy bush', 'shrub plant hedge'],
    ['Mushroom', 'a big red spotted toadstool mushroom', 'fungus forest'],
    ['Flower patch', 'a small clump of colorful wildflowers', 'plants garden'],
  ] },
  { kind: 'model', tag: 'rocks', items: [
    ['Boulder', 'a large rounded grey boulder', 'rock stone'],
    ['Rock cluster', 'a cluster of three jagged grey rocks', 'stones terrain'],
    ['Crystal cluster', 'a cluster of glowing blue crystals growing from a rock', 'gem magic cave'],
    ['Stone pillar', 'a weathered ancient stone pillar, slightly broken at the top', 'column ruin'],
    ['Log', 'a fallen mossy tree log', 'wood forest'],
  ] },
  { kind: 'model', tag: 'buildings', items: [
    ['Cottage', 'a small cozy cottage with a thatched roof', 'house home village'],
    ['Watchtower', 'a wooden watchtower on stilts with a roof', 'tower lookout'],
    ['Market stall', 'a wooden market stall with a striped cloth awning', 'shop booth'],
    ['Well', 'a round stone well with a little wooden roof and bucket', 'village water'],
    ['Sci-fi hut', 'a small futuristic dome habitat with a round door', 'base house space'],
  ] },
  { kind: 'model', tag: 'furniture', items: [
    ['Wooden chair', 'a simple wooden chair', 'seat'],
    ['Table', 'a sturdy wooden table', 'desk'],
    ['Bookshelf', 'a tall wooden bookshelf full of books', 'library shelf'],
    ['Bed', 'a single bed with a blanket and pillow', 'bedroom'],
    ['Sofa', 'a comfy two-seat sofa', 'couch living room'],
  ] },
  { kind: 'model', tag: 'scifi', items: [
    ['Sci-fi crate', 'a futuristic metal cargo crate with glowing cyan strips', 'box container space'],
    ['Robot', 'a small friendly boxy robot standing', 'bot droid'],
    ['Console', 'a sci-fi computer console with screens and buttons', 'terminal computer'],
    ['Energy core', 'a glowing energy reactor core in a metal frame', 'power battery'],
    ['Satellite dish', 'a sci-fi satellite dish on a base', 'antenna radar'],
  ] },
  { kind: 'model', tag: 'fantasy', items: [
    ['Magic staff', 'a wizard staff with a glowing gem on top', 'wand weapon magic'],
    ['Potion bottle', 'a round glass potion bottle with glowing pink liquid and a cork', 'flask magic'],
    ['Spell book', 'a thick old spell book with a gold clasp, closed', 'tome magic'],
    ['Cauldron', 'a black iron witch cauldron on three legs', 'pot magic'],
    ['Rune stone', 'a standing stone carved with glowing runes', 'magic monolith'],
  ] },
  { kind: 'model', tag: 'vehicles', items: [
    ['Car', 'a cute stylized compact car', 'auto drive'],
    ['Go-kart', 'a small racing go-kart', 'kart racing'],
    ['Hover bike', 'a futuristic hover bike with no wheels', 'bike scifi'],
    ['Rowboat', 'a small wooden rowboat', 'boat water'],
    ['Spaceship', 'a small stylized fighter spaceship', 'ship space jet'],
  ] },
  { kind: 'model', tag: 'food', items: [
    ['Apple', 'a shiny red apple', 'fruit'],
    ['Burger', 'a big cheeseburger', 'food snack'],
    ['Pizza', 'a whole pepperoni pizza', 'food'],
    ['Cake', 'a strawberry layer cake', 'dessert'],
    ['Donut', 'a pink frosted donut with sprinkles', 'doughnut dessert'],
  ] },
  { kind: 'model', tag: 'weapons', items: [
    ['Sword', 'a knight longsword', 'blade melee'],
    ['Shield', 'a round wooden shield with a metal rim', 'armor'],
    ['Bow', 'a wooden recurve bow', 'archery'],
    ['Blaster', 'a chunky sci-fi blaster pistol', 'gun laser'],
    ['Hammer', 'a heavy war hammer', 'mace melee'],
  ] },
  { kind: 'model', tag: 'toys', items: [
    ['Ball', 'a red and white beach ball', 'sphere bouncy'],
    ['Soccer ball', 'a classic black and white soccer ball', 'football sport ball'],
    ['Basketball', 'an orange basketball', 'sport ball'],
    ['Rubber duck', 'a yellow rubber duck', 'duck toy'],
    ['Toy blocks', 'a small stack of colorful wooden toy blocks', 'cubes'],
  ] },
  // What the engine and the story spawn by word (docs/story.md, the modules), so no game shows a stand-in shape.
  { kind: 'model', tag: 'story', items: [
    ['The Overseer', 'a huge smooth pearl-white ceramic sphere spaceship with slowly glowing rings of light around it, thin glowing seams and a bright light emitter at its lowest point, no trench, no dish, no guns', 'overseer mothership sphere ship ufo'],
    ['Rocket', 'a tall white and red rocket standing upright on its fins, ready to launch', 'spacecraft launch'],
    ['Launch pad', 'a round concrete rocket launch pad with a metal service tower', 'launchpad spaceport'],
    ['Space capsule', 'a cone-shaped space capsule with a round hatch and small windows', 'pod spacecraft'],
    ['Lunar lander', 'a four-legged lunar lander with gold foil and a ladder', 'lander spacecraft moon'],
  ] },
  { kind: 'model', tag: 'space', items: [
    ['Asteroid', 'a big lumpy grey asteroid covered in craters', 'space rock meteor'],
    ['Space station', 'a modular space station with solar panel wings', 'orbit station'],
    ['Satellite', 'a small satellite with two solar panels and an antenna', 'orbit probe'],
    ['Meteor', 'a glowing hot meteor rock with cracks of orange lava', 'meteorite fireball'],
    ['Alien plant', 'a strange glowing alien plant with purple bulbs', 'plant alien flora'],
  ] },
  { kind: 'model', tag: 'aircraft', items: [
    ['Helicopter', 'a small two-seat helicopter with a main rotor and a tail rotor', 'heli chopper aircraft'],
    ['Airplane', 'a small single-propeller airplane with high wings', 'plane aircraft propeller'],
    ['Jet', 'a sleek white private jet', 'plane aircraft jet'],
    ['Hot air balloon', 'a striped hot air balloon with a wicker basket', 'balloon aircraft'],
    ['Glider', 'a long-winged white glider plane', 'sailplane aircraft'],
  ] },
  { kind: 'model', tag: 'offroad', items: [
    ['4x4 truck', 'a rugged off-road 4x4 pickup truck with big knobby tires', 'truck jeep offroad car'],
    ['Motorbike', 'a dirt motorbike', 'motorcycle bike dirtbike'],
    ['Bicycle', 'a simple city bicycle', 'bike cycle'],
    ['Quad bike', 'a four-wheeled quad bike ATV', 'atv quad'],
    ['Tractor', 'a small red farm tractor', 'farm vehicle'],
  ] },
  { kind: 'model', tag: 'boats', items: [
    ['Speedboat', 'a white speedboat with a windshield', 'boat motorboat'],
    ['Submarine', 'a small yellow submarine with round portholes and a propeller', 'sub underwater'],
    ['Sailboat', 'a small sailboat with one white sail', 'boat sail yacht'],
    ['Jet ski', 'a jet ski personal watercraft', 'watercraft'],
    ['Canoe', 'a wooden canoe with a paddle inside', 'boat kayak'],
  ] },
  { kind: 'model', tag: 'tools', items: [
    ['Rocket launcher', 'a chunky green shoulder rocket launcher tube', 'bazooka weapon'],
    ['Grenade', 'a round green hand grenade with a pin', 'bomb explosive'],
    ['Spawn gun', 'a playful sci-fi ray gun with a glowing white beam emitter', 'ray gun spawner'],
    ['Gravity gun', 'a sci-fi gravity gun with orange claw prongs at the front', 'physics gun'],
    ['Lasso', 'a coiled rope lasso', 'rope'],
  ] },
  { kind: 'model', tag: 'gear', items: [
    ['Shovel', 'a garden shovel with a wooden handle', 'spade dig'],
    ['Water bucket', 'a metal bucket full of water', 'bucket pail'],
    ['Fishing rod', 'a fishing rod with a reel', 'rod pole fishing'],
    ['Flamethrower', 'a chunky flamethrower with a fuel tank', 'fire weapon'],
    ['Sticky bomb', 'a round sticky bomb with a blinking light', 'bomb explosive'],
  ] },
  { kind: 'model', tag: 'gadgets', items: [
    ['Detonator', 'a plunger-style detonator box', 'trigger explosive'],
    ['TV remote', 'a black TV remote control', 'remote control'],
    ['Phone', 'a modern smartphone', 'mobile cell'],
    ['Box of matches', 'a small open box of matches', 'matches fire'],
    ['Walkie-talkie', 'a yellow walkie-talkie radio', 'radio handheld'],
  ] },
  { kind: 'model', tag: 'mayhem', items: [
    ['Exploding barrel', 'a red barrel with a warning symbol for explosives', 'barrel explosive'],
    ['Traffic cone', 'an orange traffic cone with white stripes', 'cone road'],
    ['Propane tank', 'a white propane gas tank', 'gas tank explosive'],
    ['Glass vase', 'a tall blue glass vase', 'vase breakable'],
    ['Watermelon', 'a whole green watermelon', 'fruit melon'],
  ] },
  { kind: 'model', tag: 'kitchen', items: [
    ['Fridge', 'a white kitchen fridge with two doors', 'refrigerator'],
    ['Oven', 'a kitchen oven with a stovetop', 'stove cooker'],
    ['Kitchen sink', 'a kitchen sink in a counter with a tap', 'sink tap'],
    ['Kitchen counter', 'a kitchen counter with cupboard doors below', 'counter worktop'],
    ['Cupboard', 'a tall wooden cupboard with two doors', 'cabinet wardrobe'],
  ] },
  { kind: 'model', tag: 'bathroom', items: [
    ['Bathtub', 'a white bathtub with a tap', 'bath tub'],
    ['Toilet', 'a white toilet', 'loo wc'],
    ['Shower', 'a glass shower cubicle with a shower head', 'shower cabin'],
    ['Bathroom sink', 'a white bathroom sink on a pedestal', 'basin sink'],
    ['Mirror', 'a tall standing mirror with a wooden frame', 'looking glass'],
  ] },
  { kind: 'model', tag: 'electronics', items: [
    ['TV', 'a flat-screen television on a small stand', 'television screen'],
    ['Computer', 'a desktop computer with a monitor and keyboard', 'pc screen'],
    ['Radio', 'a retro radio with a speaker grille and knobs', 'speaker music'],
    ['Projector', 'a small video projector', 'cinema screen'],
    ['Security camera', 'a white wall-mounted security camera', 'cctv camera'],
  ] },
  { kind: 'model', tag: 'decor', items: [
    ['Lamp', 'a floor lamp with a fabric shade', 'light'],
    ['Rug', 'a rectangular patterned rug', 'carpet mat'],
    ['Clock', 'a round wall clock', 'time'],
    ['Picture frame', 'a framed painting of a landscape', 'picture painting'],
    ['Potted plant', 'a leafy green plant in a clay pot', 'plant houseplant'],
  ] },
  { kind: 'model', tag: 'fixtures', items: [
    ['Door', 'a wooden door in its frame', 'doorway'],
    ['Piano', 'an upright piano', 'instrument music'],
    ['Desk', 'a wooden desk with a drawer', 'table office'],
    ['Fireplace', 'a brick fireplace with a mantel', 'hearth fire'],
    ['Light switch', 'a white wall light switch on a small plate', 'switch'],
  ] },
  { kind: 'model', tag: 'outdoor', items: [
    ['Signpost', 'a wooden signpost with two arrow boards', 'sign'],
    ['Fence', 'a short section of white picket fence', 'picket'],
    ['Bench', 'a wooden park bench', 'seat park'],
    ['Street lamp', 'an old-fashioned street lamp post', 'lamppost light'],
    ['Mailbox', 'a red mailbox on a post', 'postbox'],
  ] },
  // The fishing catch (modules/water/fishing.js species), seen held up and in the catch log.
  { kind: 'model', tag: 'freshwater', items: [
    ['Minnow', 'a small silver minnow fish, side on', 'fish'],
    ['Perch', 'a striped green and yellow perch fish, side on', 'fish'],
    ['Bluegill', 'a bluegill sunfish, side on', 'fish sunfish'],
    ['Carp', 'a bronze carp fish, side on', 'fish'],
    ['Rainbow trout', 'a rainbow trout fish with a pink stripe, side on', 'fish trout'],
  ] },
  { kind: 'model', tag: 'lake', items: [
    ['Largemouth bass', 'a largemouth bass fish, side on', 'fish bass'],
    ['Catfish', 'a catfish with long whiskers, side on', 'fish'],
    ['Pike', 'a long green pike fish, side on', 'fish'],
    ['Koi', 'an orange and white koi fish, side on', 'fish'],
    ['Golden carp', 'a shining golden carp fish, side on', 'fish gold'],
  ] },
  { kind: 'model', tag: 'sea', items: [
    ['Sardine', 'a small silver sardine fish, side on', 'fish'],
    ['Mackerel', 'a striped blue mackerel fish, side on', 'fish'],
    ['Red snapper', 'a red snapper fish, side on', 'fish snapper'],
    ['Salmon', 'a silver salmon fish, side on', 'fish'],
    ['Bluefin tuna', 'a big bluefin tuna fish, side on', 'fish tuna'],
  ] },
  { kind: 'model', tag: 'catch', items: [
    ['Old Whiskers', 'a giant ancient catfish with very long whiskers, side on', 'fish catfish legendary'],
    ['Swordfish', 'a swordfish with a long bill, side on', 'fish'],
    ['Moonfish', 'a round silvery glowing moonfish, side on', 'fish legendary'],
    ['Old boot', 'an old soggy leather boot', 'junk shoe'],
    ['Tin can', 'a rusty dented tin can', 'junk can'],
  ] },

  // ------------------------------------------------------------ tiling textures
  { kind: 'texture', tag: 'stone', items: [
    ['Cobblestone', 'grey cobblestone street', 'road paving'],
    ['Stone bricks', 'castle stone brick wall', 'wall brick'],
    ['Slate tiles', 'dark slate floor tiles', 'floor tile'],
    ['Marble', 'white veined marble', 'floor polished'],
    ['Rough rock', 'rough grey cliff rock', 'cliff terrain'],
  ] },
  { kind: 'texture', tag: 'wood', items: [
    ['Wood planks', 'warm wooden floor planks', 'floor boards'],
    ['Old wood', 'weathered grey old wood boards', 'barn fence'],
    ['Bark', 'tree bark', 'tree'],
    ['Parquet', 'herringbone parquet floor', 'floor'],
    ['Crate wood', 'rough pine crate boards', 'pallet'],
  ] },
  { kind: 'texture', tag: 'ground', items: [
    ['Grass', 'lush green grass', 'lawn field'],
    ['Dirt', 'brown dirt ground with small pebbles', 'soil mud path'],
    ['Sand', 'rippled desert sand', 'beach desert'],
    ['Snow', 'fresh white snow', 'winter ice'],
    ['Lava', 'glowing cracked lava rock', 'magma fire'],
  ] },
  { kind: 'texture', tag: 'metal', items: [
    ['Steel plate', 'brushed steel plate with rivets', 'iron'],
    ['Diamond plate', 'diamond tread metal floor plate', 'floor industrial'],
    ['Rusty metal', 'rusty corroded metal', 'rust old'],
    ['Gold', 'polished hammered gold', 'treasure'],
    ['Copper', 'copper sheet with green patina', 'patina'],
  ] },
  { kind: 'texture', tag: 'scifi', items: [
    ['Sci-fi panels', 'futuristic grey hull panels with seams', 'spaceship hull'],
    ['Neon grid', 'black floor with a glowing cyan neon grid', 'tron floor'],
    ['Circuit board', 'green circuit board traces', 'tech computer'],
    ['Hex pattern', 'dark hexagon tech pattern with soft glow', 'honeycomb'],
    ['Carbon fiber', 'carbon fiber weave', 'tech'],
  ] },
  { kind: 'texture', tag: 'fabric', items: [
    ['Red carpet', 'plush red carpet', 'rug floor'],
    ['Denim', 'blue denim fabric', 'cloth jeans'],
    ['Checkered', 'red and white checkered picnic cloth', 'pattern tablecloth'],
    ['Leather', 'brown leather', 'hide'],
    ['Knit wool', 'cozy knitted wool', 'sweater'],
  ] },

  // ------------------------------------------------------------ skies (360° panoramas)
  { kind: 'sky', tag: 'day', items: [
    ['Sunny day', 'a bright blue sky with fluffy white clouds over green hills', 'clear blue'],
    ['Sunset', 'a warm orange and pink sunset sky over the sea', 'evening dusk'],
    ['Storm', 'a dark stormy sky with heavy clouds and distant lightning', 'rain thunder'],
    ['Overcast', 'a soft grey overcast sky over rolling fields', 'cloudy grey'],
    ['Desert dusk', 'a hazy golden dusk sky over desert dunes', 'desert evening'],
  ] },
  { kind: 'sky', tag: 'night', items: [
    ['Starry night', 'a deep blue night sky full of stars and a crescent moon', 'stars moon'],
    ['Deep space', 'outer space with colorful nebulas and distant stars', 'space nebula'],
    ['Aurora', 'green and purple northern lights over snowy mountains at night', 'northern lights snow'],
    ['Moonlit clouds', 'a full moon lighting silver clouds at night', 'moon clouds'],
    ['Alien world', 'an alien planet sky with two moons and a ringed planet', 'scifi planet moons'],
  ] },

  // ------------------------------------------------------------ sprites and icons (transparent)
  { kind: 'sprite', tag: 'icons', items: [
    ['Gold coin', 'a shiny gold coin game icon', 'money pickup'],
    ['Heart', 'a glossy red heart game icon', 'health life'],
    ['Key', 'a golden key game icon', 'unlock'],
    ['Gem', 'a sparkling blue gem game icon', 'diamond jewel'],
    ['Star', 'a shiny yellow star game icon', 'score bonus'],
  ] },
  { kind: 'sprite', tag: 'effects', items: [
    ['Explosion', 'a cartoon fiery explosion burst', 'boom blast'],
    ['Smoke puff', 'a soft grey cartoon smoke puff', 'dust cloud'],
    ['Sparkle', 'a bright magic sparkle burst', 'shine twinkle'],
    ['Lightning bolt', 'a glowing yellow lightning bolt', 'electric zap'],
    ['Fireball', 'a blazing fireball', 'fire magic'],
  ] },

  // ------------------------------------------------------------ music (loops)
  { kind: 'music', tag: 'action', items: [
    ['Battle drive', 'driving electronic action music with punchy drums, loopable', 'combat fight'],
    ['Chase', 'fast tense chase music with pulsing synths, loopable', 'race'],
    ['Arena rock', 'energetic rock with heavy guitars for a fight, loopable', 'rock'],
    ['Boss fight', 'epic orchestral boss battle music with choir, loopable', 'epic boss'],
    ['Speed run', 'upbeat drum and bass for racing, loopable', 'race fast'],
  ] },
  { kind: 'music', tag: 'calm', items: [
    ['Meadow', 'gentle acoustic guitar and flute exploration music, loopable', 'explore peaceful'],
    ['Lo-fi', 'relaxed lo-fi hip hop beat, loopable', 'chill'],
    ['Village', 'cozy folk village music with strings, loopable', 'town'],
    ['Ocean drift', 'calm ambient synth pads, loopable', 'ambient'],
    ['Piano', 'soft thoughtful piano, loopable', 'sad emotional'],
  ] },
  { kind: 'music', tag: 'spooky', items: [
    ['Haunted', 'creepy haunted house music with music box and drones, loopable', 'horror ghost'],
    ['Dungeon', 'dark dungeon ambience music with low strings, loopable', 'cave'],
    ['Tension', 'suspenseful stealth music, loopable', 'stealth sneaky'],
    ['Graveyard', 'spooky halloween music with organ, loopable', 'halloween'],
    ['Deep dark', 'ominous dark ambient soundtrack, loopable', 'ambient horror'],
  ] },
  { kind: 'music', tag: 'retro', items: [
    ['Chiptune hero', 'upbeat 8-bit chiptune adventure music, loopable', '8bit arcade'],
    ['Synthwave', 'retro 80s synthwave with driving bass, loopable', '80s neon'],
    ['Arcade', 'bouncy arcade game music, loopable', 'platformer'],
    ['Pixel castle', '16-bit style castle level music, loopable', '16bit'],
    ['Title theme', 'catchy retro game title screen theme, loopable', 'menu'],
  ] },
  { kind: 'music', tag: 'menu', items: [
    ['Main menu', 'inviting cinematic main menu music, loopable', 'title'],
    ['Victory', 'short triumphant victory fanfare', 'win'],
    ['Game over', 'short sad game over jingle', 'lose'],
    ['Shop', 'jazzy relaxed shop music, loopable', 'store'],
    ['Credits', 'warm uplifting credits music, loopable', 'ending'],
  ] },

  // ------------------------------------------------------------ ambience (loops)
  { kind: 'ambience', tag: 'nature', items: [
    ['Forest', 'forest ambience with birds and light wind, seamless loop', 'birds trees'],
    ['Rain', 'steady rain on leaves with soft thunder, seamless loop', 'weather storm'],
    ['Ocean waves', 'ocean waves on a beach with seagulls, seamless loop', 'beach sea'],
    ['Campfire', 'crackling campfire at night with crickets, seamless loop', 'fire night'],
    ['Wind', 'howling wind on a mountain, seamless loop', 'mountain snow'],
  ] },
  { kind: 'ambience', tag: 'places', items: [
    ['City', 'busy city street ambience with traffic and people, seamless loop', 'urban street'],
    ['Cave', 'dripping cave ambience with distant echoes, seamless loop', 'dungeon'],
    ['Spaceship', 'spaceship interior hum with soft beeps, seamless loop', 'scifi engine'],
    ['Tavern', 'busy medieval tavern chatter and clinks, seamless loop', 'inn crowd'],
    ['Factory', 'industrial factory machines, seamless loop', 'machines'],
  ] },

  // ------------------------------------------------------------ sound effects
  { kind: 'sfx', tag: 'weapons', items: [
    ['Laser shot', 'sci-fi laser blaster shot', 'gun pew'],
    ['Gunshot', 'punchy pistol gunshot', 'gun'],
    ['Sword swing', 'sword swinging whoosh', 'melee slash'],
    ['Bow shot', 'arrow released from a bow', 'arrow'],
    ['Reload', 'gun reload click and slide', 'gun ammo'],
  ] },
  { kind: 'sfx', tag: 'impacts', items: [
    ['Explosion', 'big explosion boom', 'blast'],
    ['Punch', 'heavy punch hit', 'hit fight'],
    ['Wood break', 'wooden crate smashing', 'crash'],
    ['Metal clang', 'metal clang hit', 'hit'],
    ['Glass shatter', 'glass shattering', 'break'],
  ] },
  { kind: 'sfx', tag: 'pickups', items: [
    ['Coin', 'bright coin pickup chime', 'collect money'],
    ['Power-up', 'rising magical power-up sound', 'upgrade'],
    ['Heal', 'soft sparkling heal sound', 'health'],
    ['Gem', 'crystal gem collect sound', 'collect'],
    ['Level up', 'triumphant level up jingle', 'win'],
  ] },
  { kind: 'sfx', tag: 'ui', items: [
    ['Click', 'clean UI button click', 'button'],
    ['Hover', 'soft UI hover tick', 'button'],
    ['Confirm', 'positive UI confirm chime', 'ok'],
    ['Error', 'short UI error buzz', 'wrong'],
    ['Menu open', 'futuristic menu open whoosh', 'whoosh'],
  ] },
  { kind: 'sfx', tag: 'movement', items: [
    ['Jump', 'cartoon jump boing', 'hop'],
    ['Footsteps', 'footsteps on gravel', 'walk'],
    ['Land', 'landing thud', 'fall'],
    ['Dash', 'quick dash whoosh', 'speed'],
    ['Splash', 'splash into water', 'water'],
  ] },
  { kind: 'sfx', tag: 'world', items: [
    ['Door open', 'creaky wooden door opening', 'door'],
    ['Switch', 'mechanical lever switch', 'button lever'],
    ['Alarm', 'sci-fi alarm siren', 'warning'],
    ['Teleport', 'sci-fi teleport warp', 'portal'],
    ['Magic spell', 'magic spell cast shimmer', 'magic'],
  ] },
  { kind: 'sfx', tag: 'creatures', items: [
    ['Monster growl', 'deep monster growl', 'roar enemy'],
    ['Robot beep', 'cute robot beeps', 'bot'],
    ['Slime', 'squishy slime squelch', 'goo'],
    ['Bird chirp', 'small bird chirping', 'bird'],
    ['Zombie groan', 'zombie groan', 'undead'],
  ] },
  // ------------------------------------------------------------ the Overseer's voice (docs/story.md: calm, vast, a little amused)
  // Spoken lines every game can use: the intro (overseer-intro: the words of the beginning, word for word) and the guide's
  // moments in the sandbox. One voice (OVERSEER_VOICE); what's in [brackets] is eleven_v3's delivery, not spoken.
  { kind: 'voice', tag: 'overseer', items: [
    ['Overseer intro', '[slowly, warmly, vast] I have given you the power of free will. [long pause] Do with it what you will.', 'overseer intro beginning free will'],
    ['Overseer you found your way', '[calm, approving] You found your way. Good.', 'overseer guide dock'],
    ['Overseer the sea gives', '[softly] The sea gives. [pause] Remember that.', 'overseer guide fish'],
    ['Overseer destruction', '[a little amused] Destruction is a kind of freedom too.', 'overseer guide explosion'],
    ['Overseer ask and I will send it', '[generous] Ask, [pause] and I will send it down.', 'overseer guide spawn'],
    ['Overseer your world', '[slowly, proud] That is your world. [pause] All of it.', 'overseer guide planet'],
    // The mirror (modules/mirror): who you are, right after the intro. "Done" is said after the caption's name.
    // (Made 2026-10-24; the sandbox uses them by id: src/overseer-games/sandbox.ts.)
    ['Overseer mirror open', '[warm, slow] Before you go anywhere: look. [pause] That is you. [amused] For now.', 'overseer mirror beginning'],
    ['Overseer mirror what', '[curious] First question. [pause] What are you?', 'overseer mirror what'],
    ['Overseer mirror look', '[warm] Now. [pause] How do you look?', 'overseer mirror look'],
    ['Overseer mirror name', '[gently] And what are you called?', 'overseer mirror name'],
    ['Overseer mirror view', '[calm] How will you see the world? [pause] Through your own eyes, or over your shoulder?', 'overseer mirror view'],
    ['Overseer mirror done', '[pleased] I will remember that. [pause] Go on, then.', 'overseer mirror done'],
    // What the Overseer says about what you chose at the mirror (presence-core.js WHATS lines, word for word).
    ['Overseer is person', '[amused] A person. Classic. Nobody will suspect a thing.', 'overseer mirror person'],
    ['Overseer is robot', '[amused] A robot. Beep. I will assume that means hello.', 'overseer mirror robot'],
    ['Overseer is tvbot', '[amused] A television with legs. Finally, something worth watching.', 'overseer mirror tvbot'],
    ['Overseer is rollbot', '[amused] A ball with ambitions. Roll with it.', 'overseer mirror rollbot'],
    ['Overseer is dog', '[warm, amused] Who is a good dog? You are. Obviously.', 'overseer mirror dog'],
    ['Overseer is cat', '[warm, amused] A cat. You were going to ignore me anyway.', 'overseer mirror cat'],
    ['Overseer is fox', '[warm, amused] A fox. Clever. Suspiciously clever.', 'overseer mirror fox'],
    ['Overseer is pig', '[warm, amused] A pig. Clean, clever, and deeply misunderstood.', 'overseer mirror pig'],
    ['Overseer is bear', '[warm, amused] A bear. Please do not eat Pip.', 'overseer mirror bear'],
    ['Overseer is rabbit', '[warm, amused] A bunny. Hop responsibly.', 'overseer mirror rabbit'],
    ['Overseer is penguin', '[warm, amused] A penguin. Dressed for a party that has not started yet.', 'overseer mirror penguin'],
    ['Overseer is chicken', '[warm, amused] A chicken. Brave of you, all things considered.', 'overseer mirror chicken'],
    ['Overseer is cow', '[warm, amused] A cow. Moo is a complete sentence.', 'overseer mirror cow'],
    ['Overseer is sheep', '[warm, amused] A sheep. Fluffy, and following no one.', 'overseer mirror sheep'],
    ['Overseer is horse', '[warm, amused] A horse. Neigh-ver change.', 'overseer mirror horse'],
    ['Overseer is dinosaur', '[warm, amused] A dinosaur. Extinction was only ever a rumor.', 'overseer mirror dinosaur'],
    ['Overseer is fish', '[warm, amused] A fish. On land. Bold. Very bold.', 'overseer mirror fish'],
    ['Overseer is shoe', '[dry, amused] A shoe. Bold. The universe has never seen a shoe with ambition.', 'overseer mirror shoe'],
    ['Overseer is toaster', '[dry, amused] A toaster. Warm, reliable, and never allowed near the bath.', 'overseer mirror toaster'],
    ['Overseer is cactus', '[dry, amused] A cactus. Hugs are off the table, then.', 'overseer mirror cactus'],
    ['Overseer is cone', '[dry, amused] A traffic cone. You will direct traffic. Or stand there. Either way.', 'overseer mirror cone'],
    ['Overseer is teapot', '[dry, amused] A teapot. Short and stout, I am told.', 'overseer mirror teapot'],
    ['Overseer is banana', '[dry, amused] A banana. Please, nobody slip.', 'overseer mirror banana'],
    ['Overseer is mushroom', '[dry, amused] A mushroom. A fun guy, I hear.', 'overseer mirror mushroom'],
    ['Overseer is potato', '[dry, amused] A potato. Humble. Versatile. Mashed, eventually.', 'overseer mirror potato'],
    ['Overseer is duck', '[dry, amused] A rubber duck. Squeak with purpose.', 'overseer mirror duck'],
    // The ship (modules/overseer/dock.js) and the sandbox's helicopter coming back.
    ['Overseer welcome aboard', '[warm, vast] Welcome aboard.', 'overseer dock ship'],
    ['Overseer a new one', '[generous] A new one, [pause] from me.', 'overseer guide helicopter'],
  ] },
];

/**
 * The pack's one look, in every picture's prompt and in what Claude picks against, so a game built from the pack looks
 * like one game. Change it only to change the whole pack (and remake it: tools/starter.mjs KEY_VERSION).
 */
export const STYLE = 'clean stylized 3D game art, bright readable colors, soft even lighting, simple shapes with crisp detail';

/**
 * The asset.make params for one starter thing. Pictures are made three times and Claude keeps the best (pickAt the
 * first step, against the brief and STYLE); a model only starts its 3D from the picked picture. Sounds are made once.
 */
/** The Overseer's voice (ElevenLabs "George": warm, mature, a storyteller), the voice lines' speaker. */
export const OVERSEER_VOICE = 'JBFqnCBsd6RMkjVDRZzb';

export function paramsFor(kind, what) {
  const steps = stepsFor(kind, what);
  const visual = ['model', 'texture', 'sprite'].includes(kind);
  if (!visual) return { steps };
  const pick = {
    model: 'the whole object alone, centered, straight front view, clean silhouette, no cut-off parts, no text, no extra objects, easy to turn into a 3D model',
    texture: 'tiles seamlessly with no visible seams, even lighting, no perspective, no text, reads clearly when repeated across a floor or wall',
    sprite: 'one clear subject, centered, readable at small sizes, no text, clean edges for a transparent cut-out',
  }[kind];
  return { steps, candidates: 3, pickAt: 1, pick, style: STYLE };
}

/** The Gen steps (asset.make) that make one starter thing. */
export function stepsFor(kind, what) {
  switch (kind) {
    case 'model': return [
      { tool: 'image.generate', params: { prompt: `${what}, single object, straight front view, centered, whole object in frame, plain flat light grey background, even light, no shadow, ${STYLE}`, width: 1024, height: 1024, count: 1 }, save: 'front' },
      { tool: 'image.remove-background', inputs: { image: '$prev' }, save: 'cutout' },
      { tool: 'image.viewsheet', inputs: { image: '$step2:cutout' }, params: { form: 'prop', cell: 1024, retries: 4, look: what }, save: 'views' },
      { tool: 'mesh.views3d', inputs: { front: '$step3:front', back: '$step3:back', left: '$step3:left', right: '$step3:right' }, params: { resolution: '1024' }, save: 'raw' },
      { tool: 'blender.character', inputs: { files: ['$step4:mesh'] }, params: { ops: [{ op: 'import', file: 0, clips: false }, { op: 'fix', shards: 0.02, holes: 24 }, { op: 'retopo', faces: 12000 }, { op: 'bake', size: 2048 }, { op: 'lod', levels: [0.15], compress: 'draco', textures: 'webp' }, { op: 'export', format: 'glb', title: 'high', compress: 'draco', textures: 'webp' }] }, save: 'model' },
    ];
    case 'texture': return [{ tool: 'image.generate', params: { prompt: `${what}, seamless tileable texture, top-down, flat even lighting, no shadows, ${STYLE}`, width: 1024, height: 1024, seamless: true, count: 1 }, save: 'texture' }];
    case 'sky': return [{ tool: 'image.panorama', params: { prompt: `${what}, ${STYLE}` }, save: 'sky' }];
    case 'sprite': return [
      { tool: 'image.generate', params: { prompt: `${what}, single subject, centered, plain flat background, ${STYLE}`, width: 1024, height: 1024, count: 1 }, save: 'front' },
      { tool: 'image.cutout', inputs: { image: '$prev' }, save: 'sprite' },
    ];
    case 'music': return [{ tool: 'audio.music', params: { prompt: what, seconds: /jingle|fanfare/.test(what) ? 12 : 60 }, save: 'music' }];
    case 'ambience': return [{ tool: 'audio.sfx', params: { text: what, duration: 20, loop: true, count: 1 }, save: 'ambience' }];
    case 'sfx': return [{ tool: 'audio.sfx', params: { text: what, duration: 2, loop: false, count: 1 }, save: 'sfx' }];
    case 'voice': return [{ tool: 'audio.voice', params: { text: what, voice: OVERSEER_VOICE, model: 'eleven_v3' }, save: 'voice' }];
    default: throw new Error(`no recipe for ${kind}`);
  }
}

export const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** Bump to remake the whole pack (a new look, a new recipe); the portal replaces each thing's row with its newest. */
export const KEY_VERSION = 'v3';
/** A kind remade on its own (models: v4, the fixed image-to-3D chain); keep cloud/functions/src/community.ts MIN_REV in step. */
export const KIND_VERSION = { model: 'v4' };
export const versionOf = (kind) => KIND_VERSION[kind] ?? KEY_VERSION;
/** Every thing in the pack, one entry each: { kind, tag, name, what, words, item } (item: the library row's `kind/slug`). */
export const packItems = () => STARTER.flatMap((g) => g.items.map(([name, what, words]) => ({ kind: g.kind, tag: g.tag, name, what, words, item: `${g.kind}/${slug(name)}` })));
/** Gen's job key for a thing: the same key hands back the same job while it is made or under way (never paid twice). */
export const keyOf = (it) => `starter/${it.kind}/${slug(it.name)}/${versionOf(it.kind)}`;
/** The labels the portal's starter sync reads (cloud/functions/src/community.ts syncStarterPack). */
export const labelsOf = (it) => ({ pack: 'starter', community: true, kind: it.kind, tag: it.tag, tags: [it.tag, ...it.words.split(/\s+/)].join(' '), name: it.name, item: slug(it.name), rev: versionOf(it.kind) });
