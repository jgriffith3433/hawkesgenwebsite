// The spawn wheel's model: everything a player can bring into the world, three layers deep (type -> category -> asset),
// built from the kind registry (H.kinds: every module's kinds, their hotbar and codex), Living things' species, the
// tools, world actions (terrain, water, weather, disasters), effects, the game's own assets (H.assets) and the community
// library (GET /v1/community: ids, thumbnails). No UI here: spawn.js spawns, spawn-ui.js draws the wheel and the sheet.
//
//   H.spawn.types()                       [{ id, name, icon, count }] (Recent and Favorites first when there are some)
//   H.spawn.categories(type)              [{ id, name, icon, count, library }]
//   H.spawn.items(type, category)         the assets: [{ id, name, icon, thumb, type, cat, words, source, ... }]
//   H.spawn.load(type, category)          the same, with the community library's things (a Promise)
//   H.spawn.search('cow')                 every match, best first (H.spawn.searchAll adds the library: a Promise)
//   H.spawn.place(item, { count, yaw })   where things land: in front of the player, on the ground or the water
//   H.spawn.recent / favorites            per player (this device)
/* global HawkesPlay, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const W = () => H.world;
  const S = (H.spawn = H.spawn || {});
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const cap = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
  const r2 = (n) => Math.round(n * 100) / 100;
  const norm = (w) => (H.assets && H.assets.norm ? H.assets.norm(w) : String(w || '').toLowerCase().trim());

  // ------------------------------------------------------------------ layer 1: types
  const TYPES = [
    { id: 'vehicles', name: 'Vehicles', icon: '🚗' },
    { id: 'living', name: 'Animals and people', icon: '🐄' },
    { id: 'things', name: 'Things', icon: '📦' },
    { id: 'nature', name: 'Nature', icon: '🌲' },
    { id: 'buildings', name: 'Buildings and homes', icon: '🏠' },
    { id: 'tools', name: 'Tools', icon: '🛠' },
    { id: 'world', name: 'World', icon: '🌍' },
    { id: 'effects', name: 'Effects', icon: '✨' },
    { id: 'kits', name: 'Play kits', icon: '🎲' },
    { id: 'game', name: 'This game', icon: '🎮' },
  ];
  const PSEUDO = { recent: { id: 'recent', name: 'Recent', icon: '🕘' }, favorites: { id: 'favorites', name: 'Favorites', icon: '★' } };

  // ------------------------------------------------------------------ layer 2: where each kind goes
  // Known kinds by name; a kind from a new module goes by its codex group (a type whose words match), its group the
  // category. [type, category id, category name]
  const KIND_PLACE = {
    car: ['vehicles', 'road', 'On the road'], truck: ['vehicles', 'road', 'On the road'], motorbike: ['vehicles', 'road', 'On the road'], bicycle: ['vehicles', 'road', 'On the road'],
    boat: ['vehicles', 'water', 'On the water'], submarine: ['vehicles', 'water', 'On the water'],
    airplane: ['vehicles', 'air', 'In the air'], helicopter: ['vehicles', 'air', 'In the air'], rocket: ['vehicles', 'air', 'In the air'], spaceship: ['vehicles', 'air', 'In the air'],
    herd: ['living', 'herds', 'Herds'], friend: ['living', 'people', 'People and robots'],
    box: ['things', 'shapes', 'Shapes'], sphere: ['things', 'shapes', 'Shapes'], cylinder: ['things', 'shapes', 'Shapes'], cone: ['things', 'shapes', 'Shapes'], capsule: ['things', 'shapes', 'Shapes'], torus: ['things', 'shapes', 'Shapes'], plane: ['things', 'shapes', 'Shapes'],
    barrel: ['things', 'mayhem', 'Mayhem'], crate: ['things', 'mayhem', 'Mayhem'],
    text: ['things', 'signs', 'Signs and lights'], light: ['things', 'signs', 'Signs and lights'], mirror: ['things', 'signs', 'Signs and lights'],
    spawn: ['things', 'game', 'Game pieces'], trigger: ['things', 'game', 'Game pieces'], waypoint: ['things', 'game', 'Game pieces'], zone: ['things', 'game', 'Game pieces'],
    chair: ['things', 'furniture', 'Furniture'], sofa: ['things', 'furniture', 'Furniture'], bed: ['things', 'furniture', 'Furniture'], table: ['things', 'furniture', 'Furniture'], desk: ['things', 'furniture', 'Furniture'], shelf: ['things', 'furniture', 'Furniture'], rug: ['things', 'furniture', 'Furniture'], cupboard: ['things', 'furniture', 'Furniture'], lamp: ['things', 'furniture', 'Furniture'], clock: ['things', 'furniture', 'Furniture'], piano: ['things', 'furniture', 'Furniture'],
    fridge: ['things', 'kitchen', 'Kitchen and bathroom'], oven: ['things', 'kitchen', 'Kitchen and bathroom'], sink: ['things', 'kitchen', 'Kitchen and bathroom'], bathtub: ['things', 'kitchen', 'Kitchen and bathroom'], shower: ['things', 'kitchen', 'Kitchen and bathroom'], toilet: ['things', 'kitchen', 'Kitchen and bathroom'],
    tv: ['things', 'screens', 'Screens and media'], computer: ['things', 'screens', 'Screens and media'], projector: ['things', 'screens', 'Screens and media'], cctv: ['things', 'screens', 'Screens and media'], radio: ['things', 'screens', 'Screens and media'], remote: ['things', 'screens', 'Screens and media'], phone: ['things', 'screens', 'Screens and media'],
    plant: ['nature', 'plants', 'Trees and plants'],
    house: ['buildings', 'houses', 'Houses and rooms'], room: ['buildings', 'houses', 'Houses and rooms'], wall: ['buildings', 'walls', 'Walls and doors'], door: ['buildings', 'walls', 'Walls and doors'], switch: ['buildings', 'walls', 'Walls and doors'],
    water: ['world', 'water', 'Water'],
  };
  // Kinds the wheel doesn't offer as such: they need an asset (the game's own and the library's come as those),
  // they're another word for one that is, or they're offered another way (animals by species, tools as pickups).
  const KIND_ICON = { car: '🚗', truck: '🛻', motorbike: '🏍', bicycle: '🚲', boat: '🚤', submarine: '⚓', airplane: '✈', helicopter: '🚁', rocket: '🚀', spaceship: '🛸', table: '🍽', desk: '🖥', shelf: '📚', plant: '🪴', rug: '🟫', fridge: '🧊', cupboard: '🗄', switch: '🔘', sink: '🚰', bathtub: '🛁', shower: '🚿', toilet: '🚽', oven: '🍳', clock: '🕰', piano: '🎹', computer: '💻', projector: '📽', cctv: '📹', radio: '📻', remote: '🎛', phone: '📱', wall: '🧱', cone: '🔺', capsule: '💊', torus: '⭕', plane: '▭', mirror: '🪞', trigger: '▢' };
  const CAT_ICON = { 'kits:play': '🎲', 'vehicles:road': '🚙', 'vehicles:water': '🚤', 'vehicles:air': '✈', 'vehicles:models': '◆', 'living:farm': '🐄', 'living:pets': '🐕', 'living:wild': '🦁', 'living:birds': '🦜', 'living:water': '🐟', 'living:people': '🧍', 'living:strange': '🦖', 'living:herds': '🐑', 'things:shapes': '🔷', 'things:mayhem': '🛢', 'things:furniture': '🛋', 'things:kitchen': '🛁', 'things:screens': '📺', 'things:signs': '💡', 'things:game': '🏁', 'nature:plants': '🌳', 'nature:rocks': '🪨', 'buildings:houses': '🏠', 'buildings:walls': '🚪', 'tools:mayhem': '🚀', 'tools:weapons': '🔫', 'tools:outdoors': '🎣', 'world:terrain': '⛰', 'world:land': '🏝', 'world:water': '🌊', 'world:weather': '⛈', 'world:disasters': '🌪', 'world:skies': '🌅', 'effects:boom': '💥', 'effects:sparkle': '🎆', 'effects:time': '🐢', 'effects:music': '♫', 'effects:sounds': '♪', 'game:models': '◆', 'game:pictures': '🖼', 'game:sounds': '♪', 'game:videos': '▶' };
  S.CAT_ICON = CAT_ICON;
  const SKIP = new Set(['model', 'sprite', 'video', 'vehicle', 'critter', 'creature', 'tool-pickup']);
  const GROUP_TYPE = [[/vehicle/i, 'vehicles'], [/living|animal|creature|people|person/i, 'living'], [/nature|plant|tree|rock/i, 'nature'], [/home|house|building|room/i, 'buildings'], [/tool|weapon/i, 'tools'], [/world|terrain|water|weather|sky/i, 'world'], [/effect|particle|fx/i, 'effects']];
  const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'more';
  function placeOfKind(k) {
    if (KIND_PLACE[k.name]) return KIND_PLACE[k.name];
    const g = (k.codex && k.codex.group) || '';
    const t = (GROUP_TYPE.find(([re]) => re.test(g)) || [null, 'things'])[1];
    return [t, slug(g || 'more'), g || 'More things'];
  }

  // Animals by species (Living things): categories of their own.
  const SPECIES_CAT = {
    farm: ['Farm animals', ['cow', 'pig', 'sheep', 'horse', 'chicken', 'llama', 'alpaca']],
    pets: ['Pets', ['dog', 'cat', 'rabbit', 'hamster']],
    wild: ['Wild animals', ['deer', 'wolf', 'bear', 'elephant', 'lion', 'tiger', 'zebra', 'giraffe', 'panda', 'monkey', 'moose', 'camel', 'kangaroo', 'raccoon', 'squirrel', 'mouse', 'rat']],
    birds: ['Birds', ['bird', 'penguin', 'ostrich', 'parrot', 'owl', 'eagle']],
    water: ['In the water', ['fish', 'turtle', 'frog']],
    people: ['People and robots', ['person', 'robot']],
    strange: ['Strange creatures', ['dinosaur', 'slime']],
  };
  const SPECIES_ICON = { cow: '🐄', pig: '🐖', sheep: '🐑', horse: '🐎', chicken: '🐔', llama: '🦙', alpaca: '🦙', dog: '🐕', cat: '🐈', rabbit: '🐇', hamster: '🐹', deer: '🦌', wolf: '🐺', bear: '🐻', elephant: '🐘', lion: '🦁', tiger: '🐅', zebra: '🦓', giraffe: '🦒', panda: '🐼', monkey: '🐒', moose: '🫎', camel: '🐪', kangaroo: '🦘', raccoon: '🦝', squirrel: '🐿', mouse: '🐁', rat: '🐀', bird: '🐦', penguin: '🐧', ostrich: '🐦', parrot: '🦜', owl: '🦉', eagle: '🦅', fish: '🐟', turtle: '🐢', frog: '🐸', person: '🧍', robot: '🤖', dinosaur: '🦖', slime: '🟢' };
  const SWIMS = new Set(['fish', 'turtle', 'frog', 'penguin']);

  // Tools as pickups on a pad (walk into it to hold it).
  const TOOL_PLACE = {
    'rocket-launcher': 'mayhem', grenade: 'mayhem', 'sticky-bomb': 'mayhem', 'spawn-gun': 'mayhem', 'gravity-gun': 'mayhem', lasso: 'mayhem', flamethrower: 'mayhem', matches: 'mayhem',
    blaster: 'weapons', rifle: 'weapons', shotgun: 'weapons',
    shovel: 'outdoors', bucket: 'outdoors', rod: 'outdoors', ball: 'outdoors',
  };
  const TOOL_CATS = { mayhem: 'Mayhem tools', weapons: 'Weapons', outdoors: 'Outdoors', more: 'More tools' };
  const TOOL_ICON = { 'rocket-launcher': '🚀', grenade: '💣', 'sticky-bomb': '🧨', 'spawn-gun': '✨', 'gravity-gun': '🌀', lasso: '➰', flamethrower: '🔥', matches: '🔥', blaster: '🔫', rifle: '🔫', shotgun: '🔫', shovel: '⛏', bucket: '🪣', rod: '🎣', ball: '⚽' };
  // Tools that are another name for one already listed, or only make sense handed over by something else.
  const TOOL_SKIP = new Set(['launcher', 'fishing-rod', 'detonator', 'remote', 'phone']);

  // Nature that needs no art: stand-in shapes, or the game's model for the word as soon as it has one.
  const NATURE = [
    ['plants', 'tree', 'Tree', '🌳', { type: 'cone', shape: { radius: 1.1, height: 3.6 }, material: { color: '#3f8a3a' }, physics: 'static' }],
    ['plants', 'pine', 'Pine tree', '🌲', { type: 'cone', shape: { radius: 0.8, height: 4.5 }, material: { color: '#2f6b38' }, physics: 'static' }],
    ['plants', 'bush', 'Bush', '🌿', { type: 'sphere', shape: { radius: 0.7 }, material: { color: '#4f9a42' }, physics: 'static', transform: { scale: [1.3, 0.8, 1.3] } }],
    ['plants', 'flower', 'Flowers', '🌼', { type: 'cylinder', shape: { radius: 0.35, height: 0.3 }, material: { color: '#f4c430' }, physics: 'static' }],
    ['plants', 'log', 'Log', '🪵', { type: 'cylinder', shape: { radius: 0.3, height: 2.4 }, material: { color: '#7a5230' }, physics: 'dynamic', transform: { rotation: [0, 0, 90] } }],
    ['rocks', 'rock', 'Rock', '🪨', { type: 'sphere', shape: { radius: 0.5 }, material: { color: '#8a8f99' }, physics: 'dynamic', transform: { scale: [1.2, 0.8, 1] } }],
    ['rocks', 'boulder', 'Boulder', '🪨', { type: 'sphere', shape: { radius: 1.4 }, material: { color: '#767b85' }, physics: 'static', transform: { scale: [1.2, 0.85, 1] } }],
    ['rocks', 'stone pillar', 'Stone pillar', '🗿', { type: 'cylinder', shape: { radius: 0.6, height: 3 }, material: { color: '#9aa0aa' }, physics: 'static' }],
  ];
  const NATURE_CATS = { plants: 'Trees and plants', rocks: 'Rocks' };

  // World: the ground, water, weather and disasters. `build: true` items change the world itself (saved, undoable),
  // so they're only offered while building; disasters and weather happen for everyone while playing too.
  const TERRAIN_ADD = [['mountain', 'Mountain', '⛰', { radius: 70, height: 55 }], ['hill', 'Hill', '🏞', { radius: 30, height: 10 }], ['volcano', 'Volcano', '🌋', { radius: 50, height: 40 }], ['plateau', 'Plateau', '🟫', { radius: 25, height: 8 }], ['crater', 'Crater', '🕳', { radius: 14, depth: 6 }], ['hole', 'Giant hole', '🕳', { radius: 8, depth: 14 }], ['lake', 'Lake', '🏞', { radius: 22, depth: 4 }]];
  const TERRAIN_WORLD = [['hills', 'Rolling hills', '🌄'], ['island', 'An island', '🏝'], ['mountains', 'Mountain range', '🏔'], ['canyon', 'Canyon', '🏜'], ['desert', 'Desert dunes', '🐪'], ['craters', 'Moon craters', '🌑'], ['flat', 'Flat ground', '▭']];
  const WEATHER = [['rain', 'Rain', '🌧'], ['storm', 'Storm', '⛈'], ['snow', 'Snow', '❄'], ['drizzle', 'Drizzle', '🌦'], ['clear', 'Clear skies', '☀']];
  const DISASTERS = [['tornado', 'Tornado', '🌪'], ['meteor-shower', 'Meteor shower', '☄'], ['earthquake', 'Earthquake', '🫨'], ['flood', 'Flood', '🌊'], ['volcano', 'Erupting volcano', '🌋'], ['blizzard', 'Blizzard', '🌨'], ['zombie-night', 'Zombie night', '🧟']];
  const EFFECTS = [
    ['boom', 'explosion', 'Explosion', '💥', { radius: 5 }], ['boom', 'big explosion', 'Big explosion', '☢', { radius: 11, force: 40 }], ['boom', 'fireball', 'Fireball', '🔥', { radius: 4, fire: true }],
    ['sparkle', 'fireworks', 'Fireworks', '🎆', {}], ['sparkle', 'confetti', 'Confetti', '🎉', {}], ['sparkle', 'sparks', 'Sparks', '✨', {}], ['sparkle', 'smoke', 'Smoke', '💨', {}],
    ['time', 'slow motion', 'Slow motion', '🐢', { seconds: 3 }],
  ];
  const EFFECT_CATS = { boom: 'Explosions', sparkle: 'Sparkles and smoke', time: 'Time' };

  // ------------------------------------------------------------------ the community library: where its shelves go
  // (kind, category) -> [type, category id, category name]. A shelf with the same id as a local category joins it
  // (library rocks sit with the stand-in rocks).
  const LIB_MODEL = { props: ['things', 'props', 'Props'], nature: ['nature', 'plants', 'Trees and plants'], rocks: ['nature', 'rocks', 'Rocks'], buildings: ['buildings', 'buildings', 'Buildings'], furniture: ['things', 'furniture', 'Furniture'], vehicles: ['vehicles', 'models', 'Vehicle models'], animals: ['living', 'models', 'Animal models'], creatures: ['living', 'models', 'Animal models'], characters: ['living', 'people', 'People and robots'], weapons: ['things', 'weapons', 'Weapons (props)'] };
  function libPlace(kind, category) {
    const c = category || '';
    if (kind === 'model') return LIB_MODEL[c] || ['things', slug(c || 'models'), c ? cap(c.replace(/-/g, ' ')) : 'Models'];
    if (kind === 'texture') return ['buildings', `walls-${slug(c || 'more')}`, `${c ? cap(c.replace(/-/g, ' ')) : 'Textured'} walls`];
    if (kind === 'sky') return ['world', 'skies', 'Skies'];
    if (kind === 'sprite' || kind === 'image') return ['things', 'pictures', 'Pictures'];
    if (kind === 'music') return ['effects', 'music', 'Music'];
    if (kind === 'ambience') return ['effects', 'ambience', 'Ambience'];
    if (kind === 'sfx' || kind === 'voice') return ['effects', 'sounds', 'Sounds'];
    if (kind === 'video') return ['things', 'screens', 'Screens and media'];
    return ['things', slug(kind), cap(kind)];
  }
  const LIB_ICON = { model: '◆', texture: '▦', sky: '🌅', sprite: '🖼', image: '🖼', music: '♫', ambience: '≈', sfx: '♪', voice: '❝', video: '▶' };

  // ------------------------------------------------------------------ the world's settings
  const cfg = () => { try { return H.lib.effectiveConfig() || {}; } catch { return {}; } };
  /** What config.spawn allows: { play (spawning while playing), max (×N at most), types (only these), hide }. */
  function settings() {
    const c = cfg().spawn;
    if (c === true) return { play: true, max: 10, types: null, off: false };
    if (c === false) return { play: false, max: 10, types: null, off: true };
    const o = c && typeof c === 'object' ? c : {};
    return { play: Boolean(o.play ?? o.runtime ?? false), max: Math.max(1, Math.min(50, Number(o.max) || 10)), types: Array.isArray(o.types) ? o.types.map(String) : null, off: o.off === true };
  }
  S.settings = settings;
  /** Can this player spawn now? Building always can; playing when the game allows it (config.spawn). */
  S.allowed = () => {
    if (!W()) return false;
    if (H.mode === 'build') return true;
    const s = settings();
    return s.play && !s.off;
  };
  S.building = () => H.mode === 'build';
  /** The editor (signed in, with the game): community things can be put in the game through it. */
  S.inEditor = () => Boolean(window.HawkesBuild) && window.parent !== window;

  // ------------------------------------------------------------------ layer 3: the things, from the registries
  let localCache = null, localKey = '';
  function hasModelFor(word) { try { return H.assets && H.assets.pick(word, { kind: 'model' }); } catch { return null; } }
  /** A spec for a word: the game's own model for it when there is one, else the stand-in. */
  function byWord(word, standIn, o = {}) {
    const id = hasModelFor(word);
    if (id) return { type: 'model', name: o.name || cap(word), shape: { asset: id, size: o.size || 1.6, word }, physics: (standIn && standIn.physics) || 'static' };
    return { ...clone(standIn), name: o.name || cap(word) };
  }
  function addItem(list, it) { if (!list.some((x) => x.id === it.id)) list.push(it); }
  function local() {
    const kinds = H.kinds.list();
    const assets = H.assets ? H.assets.list() : [];
    const key = `${kinds.length}|${H.tools.list().length}|${assets.length}|${H.living && H.living.species ? H.living.species.list().length : 0}|${(H.bundle && H.bundle.assets) ? Object.keys(H.bundle.assets).length : 0}`;
    if (localCache && key === localKey) return localCache;
    const out = [];
    // Kinds: their hotbar entries (the editor's own presets), else their codex example, else the plain kind.
    for (const k of kinds) {
      if (SKIP.has(k.name) || (k.editor && k.editor.spawn === false)) continue;
      const [type, cat, catName] = placeOfKind(k);
      const word = String((k.editor && k.editor.word) || k.name).replace(/^(a|an|the) /, '');
      const hot = (k.editor && k.editor.hotbar) || [];
      if (hot.length) {
        for (const h of hot) addItem(out, { id: `kind:${k.name}:${slug(h.label)}`, type, cat, catName, name: h.label, icon: h.icon || '▣', words: [h.label, word, k.name], source: 'kind', kind: k.name, make: (yaw) => h.make(yaw || 0), floats: k.name === 'boat' || k.name === 'submarine' });
        continue;
      }
      const ex = k.codex && k.codex.spec;
      if (!k.maker && !ex) continue;
      addItem(out, { id: `kind:${k.name}`, type, cat, catName, name: cap(word), icon: KIND_ICON[k.name] || (TYPES.find((t) => t.id === type) || {}).icon || '▣', words: [word, k.name], source: 'kind', kind: k.name, make: () => { const s = ex ? clone(ex) : { type: k.name }; delete s.transform; delete s.id; if (!s.name) s.name = cap(word); return s; }, floats: k.name === 'boat' || k.name === 'submarine' });
    }
    // Play kits (abilities module: H.kits): ready-made bits of play, a few things with their abilities.
    if (H.kits) for (const k of H.kits.items()) addItem(out, k);
    // Animals and people: every species Living things knows (and the other words it draws).
    if (H.living && H.living.species && H.kinds.has('creature')) {
      const names = [...H.living.species.list(), ...(H.living.species.looks ? H.living.species.looks() : [])];
      for (const n of names) {
        const cat = Object.entries(SPECIES_CAT).find(([, [, l]]) => l.includes(n));
        const [catId, catName] = cat ? [cat[0], cat[1][0]] : ['more', 'More animals'];
        addItem(out, { id: `species:${n}`, type: 'living', cat: catId, catName, name: cap(n), icon: SPECIES_ICON[n] || '🐾', words: [n], source: 'species', make: () => ({ type: 'creature', name: cap(n), shape: { species: n } }), floats: SWIMS.has(n) && n !== 'penguin', swims: SWIMS.has(n) });
      }
    }
    // Tools, each on a pad.
    if (H.kinds.has('tool-pickup')) {
      for (const t of H.tools.list()) {
        if (TOOL_SKIP.has(t.name)) continue;
        const cat = TOOL_PLACE[t.name] || 'more';
        const title = String(t.title || cap(t.name)).split(':')[0];
        addItem(out, { id: `tool:${t.name}`, type: 'tools', cat, catName: TOOL_CATS[cat], name: title, icon: TOOL_ICON[t.name] || '🛠', words: [t.name.replace(/-/g, ' '), title], source: 'tool', make: () => ({ type: 'tool-pickup', name: title, shape: { tool: t.name } }) });
      }
    }
    // Nature.
    for (const [cat, word, name, icon, standIn] of NATURE) addItem(out, { id: `nature:${slug(word)}`, type: 'nature', cat, catName: NATURE_CATS[cat], name, icon, words: [word, name], source: 'standin', make: () => byWord(word, standIn, { name }) });
    // The world: terrain (building), water, weather, disasters.
    if (H.features.has('terrain')) {
      for (const [t, name, icon, o] of TERRAIN_ADD) addItem(out, { id: `terrain:${t}`, type: 'world', cat: 'terrain', catName: 'Terrain', name: `${name} here`, icon, words: [t, name, 'terrain'], source: 'world', build: true, world: { terrainAdd: t, ...o } });
      for (const [shape, name, icon] of TERRAIN_WORLD) addItem(out, { id: `land:${shape}`, type: 'world', cat: 'land', catName: 'The whole world', name, icon, words: [shape, name, 'terrain', 'world'], source: 'world', build: true, world: { terrain: shape } });
    }
    if (H.features.has('water')) addItem(out, { id: 'world:sea', type: 'world', cat: 'water', catName: 'Water', name: 'The sea', icon: '🌊', words: ['sea', 'ocean'], source: 'world', build: true, world: { water: { level: -0.6 } } });
    if (H.features.has('water') || H.features.has('weather')) for (const [w, name, icon] of WEATHER) addItem(out, { id: `weather:${w}`, type: 'world', cat: 'weather', catName: 'Weather', name, icon, words: [w, name, 'weather'], source: 'world', world: { weather: w } });
    if (H.events && H.events.perform) for (const [d, name, icon] of DISASTERS) {
      if (d === 'flood' && !H.features.has('water')) continue;
      addItem(out, { id: `disaster:${d}`, type: 'world', cat: 'disasters', catName: 'Disasters', name, icon, words: [d.replace(/-/g, ' '), name, 'disaster'], source: 'world', world: { disaster: d } });
    }
    // Effects.
    for (const [cat, word, name, icon, o] of EFFECTS) {
      if (cat === 'boom' && !(H.mayhem && H.mayhem.explode)) continue;
      addItem(out, { id: `fx:${slug(word)}`, type: 'effects', cat, catName: EFFECT_CATS[cat], name, icon, words: [word, name], source: 'effect', effect: { name: word, ...o } });
    }
    // The game's own assets (models, pictures, sounds, videos), by what they are.
    const AS = { model: ['models', 'Models', '◆', 'mesh'], image: ['pictures', 'Pictures', '🖼', 'image'], sound: ['sounds', 'Sounds', '♪', 'audio'], video: ['videos', 'Videos', '▶', 'video'] };
    for (const a of assets) {
      const m = AS[a.type];
      if (!m) continue;
      const word = a.words && a.words[0] ? a.words[0] : norm(a.name);
      addItem(out, { id: `asset:${a.id || a.name}`, type: 'game', cat: m[0], catName: m[1], name: a.title || cap(word), icon: m[2], thumb: a.type === 'image' ? a.url : null, words: [...(a.words || []), a.title || '', a.name], source: 'game', asset: { name: a.name, id: a.id, kind: m[3], title: a.title || cap(word) } });
    }
    localCache = out; localKey = key;
    return out;
  }
  /** Things from the community library, as wheel items (from the API's rows). */
  function libItem(row) {
    const [type, cat, catName] = libPlace(row.kind, row.category);
    return { id: `lib:${row.id}`, type, cat, catName, name: row.title, icon: LIB_ICON[row.kind] || '◆', thumb: row.thumb || null, words: [row.title, ...(row.tags || []), row.category || ''], source: 'library', lib: { id: row.id, kind: row.kind, title: row.title, category: row.category || null, thumb: row.thumb || null, tags: row.tags || [] }, build: true };
  }
  S.libItem = libItem;
  S.libPlace = libPlace;

  // ------------------------------------------------------------------ the community library (cached)
  const lib = { shelves: null, items: new Map(), failed: 0, base: '' };
  S.library = lib;
  /** Fetch for the library (tests and the guest page swap it). */
  S.fetchJson = async (url) => { const r = await fetch(url, { credentials: 'omit' }); if (!r.ok) throw new Error(`${r.status}`); return r.json(); };
  const libOn = () => S.inEditor() && H.mode === 'build' && Date.now() - lib.failed > 30000;
  async function loadShelves() {
    if (lib.shelves || !libOn()) return lib.shelves || [];
    // (The shared kits too, once: they join 🎲 Play kits > Shared kits.)
    if (!lib.kits && H.kits && H.kits.add) { lib.kits = true; S.fetchJson(`${lib.base}/v1/community/kits?full=1&limit=40`).then((r) => { for (const k of (r && r.kits) || []) H.kits.add(k); }).catch(() => { lib.kits = false; }); }
    try { const r = await S.fetchJson(`${lib.base}/v1/community/categories`); lib.shelves = (r.kinds || []).flatMap((k) => (k.categories && k.categories.length ? k.categories : [{ category: '', count: k.count }]).map((c) => ({ kind: k.kind, category: c.category, count: c.count }))); }
    catch { lib.failed = Date.now(); lib.shelves = null; return []; }
    return lib.shelves;
  }
  async function loadShelf(kind, category) {
    const key = `${kind}|${category}`;
    if (lib.items.has(key)) return lib.items.get(key);
    try {
      const r = await S.fetchJson(`${lib.base}/v1/community?${new URLSearchParams({ kind, exact: '1', limit: '60', ...(category ? { category } : {}) })}`);
      const items = (r.items || []).map(libItem);
      lib.items.set(key, items);
      return items;
    } catch { lib.failed = Date.now(); return []; }
  }
  S.loadShelves = loadShelves;

  // ------------------------------------------------------------------ the layers
  const usable = (it) => (!it.build || H.mode === 'build') && (it.source !== 'library' || libOn());
  function visibleTypes() { const s = settings(); return TYPES.filter((t) => !s.types || s.types.includes(t.id) || H.mode === 'build'); }
  /** Layer 1: the types with something in them (Recent and Favorites first). */
  S.types = () => {
    const all = local().filter(usable);
    const shelves = libOn() && lib.shelves ? lib.shelves : [];
    const out = [];
    const fav = S.favorites.list().filter(usable), rec = S.recent.list().filter(usable);
    if (fav.length) out.push({ ...PSEUDO.favorites, count: fav.length });
    if (rec.length) out.push({ ...PSEUDO.recent, count: rec.length });
    for (const t of visibleTypes()) {
      const n = all.filter((i) => i.type === t.id).length + shelves.filter((s) => libPlace(s.kind, s.category)[0] === t.id).reduce((a, s) => a + s.count, 0);
      if (n) out.push({ ...t, count: n });
    }
    return out;
  };
  /** Layer 2: a type's categories (local ones, and library shelves; a shelf with a local category's id joins it). */
  S.categories = (type) => {
    if (type === 'recent' || type === 'favorites') return [];
    const cats = new Map();
    for (const i of local()) if (i.type === type && usable(i)) { const c = cats.get(i.cat) || { id: i.cat, name: i.catName || cap(i.cat), icon: CAT_ICON[`${type}:${i.cat}`] || i.icon, count: 0, library: false }; c.count++; cats.set(i.cat, c); }
    for (const s of (libOn() && lib.shelves) || []) {
      const [t, id, name] = libPlace(s.kind, s.category);
      if (t !== type) continue;
      const c = cats.get(id) || { id, name, icon: CAT_ICON[`${type}:${id}`] || LIB_ICON[s.kind] || '◆', count: 0, library: true };
      c.count += s.count; c.shelves = [...(c.shelves || []), [s.kind, s.category]];
      cats.set(id, c);
    }
    return [...cats.values()];
  };
  /** Layer 3 now (local things, and library things already loaded). */
  S.items = (type, cat) => {
    if (type === 'recent') return S.recent.list().filter(usable);
    if (type === 'favorites') return S.favorites.list().filter(usable);
    const out = local().filter((i) => i.type === type && i.cat === cat && usable(i));
    for (const [key, items] of lib.items) { void key; for (const i of items) if (i.type === type && i.cat === cat && usable(i) && !out.some((x) => x.id === i.id)) out.push(i); }
    return out;
  };
  /** Layer 3 with the library: fetches the shelves that belong to the category. */
  S.load = async (type, cat) => {
    if (libOn()) {
      await loadShelves();
      const c = S.categories(type).find((x) => x.id === cat);
      for (const [kind, category] of (c && c.shelves) || []) await loadShelf(kind, category);
    }
    return S.items(type, cat);
  };
  S.find = (id) => local().find((i) => i.id === id) || [...lib.items.values()].flat().find((i) => i.id === id) || S.recent.list().find((i) => i.id === id) || S.favorites.list().find((i) => i.id === id) || null;
  S.all = () => local().filter(usable);
  /** The type's and category's names, for the breadcrumb. */
  S.typeOf = (id) => TYPES.find((t) => t.id === id) || PSEUDO[id] || null;
  S.TYPES = TYPES;

  // ------------------------------------------------------------------ search ("cow", "4x4", "stone wall")
  const tokens = (s) => norm(s).split(/\s+/).filter(Boolean);
  /** How well an item matches the words (0: not at all). Whole words beat prefixes; the name beats other words. */
  function score(it, q) {
    const ws = tokens(q);
    if (!ws.length) return 0;
    const name = tokens(it.name);
    const words = it.words.flatMap(tokens);
    const cat = tokens(it.catName || '');
    let s = 0;
    for (const w of ws) {
      if (name.includes(w)) s += 4;
      else if (words.includes(w)) s += 3;
      else if (name.some((t) => t.startsWith(w)) || words.some((t) => t.startsWith(w))) s += 2;
      else if (cat.includes(w) || cat.some((t) => t.startsWith(w))) s += 1;
      else return 0; // every word has to match something
    }
    if (norm(it.name) === norm(q)) s += 3;
    if (it.source === 'library') s -= 0.5; // free stand-ins first, the same thing from the library right after
    return s;
  }
  S.score = score;
  /** Every match, best first (local things and library things already loaded). */
  S.search = (q, o = {}) => {
    const pool = [...local(), ...[...lib.items.values()].flat(), ...(o.extra || [])].filter(usable);
    const seen = new Set();
    return pool.map((it) => ({ it, s: score(it, q) })).filter((x) => x.s > 0 && !seen.has(x.it.id) && seen.add(x.it.id)).sort((a, b) => b.s - a.s || a.it.name.localeCompare(b.it.name)).slice(0, o.limit || 60).map((x) => x.it);
  };
  /** Search with the library too (a Promise): the API's matches join the local ones. */
  S.searchAll = async (q, o = {}) => {
    let extra = [];
    if (libOn() && norm(q).length >= 2) {
      try { const r = await S.fetchJson(`${lib.base}/v1/community?${new URLSearchParams({ q, limit: '40' })}`); extra = (r.items || []).map(libItem); }
      catch { lib.failed = Date.now(); }
    }
    return S.search(q, { ...o, extra });
  };

  // ------------------------------------------------------------------ recents and favorites (per player, this device)
  // Kept as small snapshots (the id, the name, the icon, a library row), so a library thing comes back without a fetch.
  const snap = (it) => ({ id: it.id, type: it.type, cat: it.cat, catName: it.catName, name: it.name, icon: it.icon, thumb: it.thumb || null, words: it.words || [], source: it.source, lib: it.lib || null, build: Boolean(it.build), asset: it.asset || null });
  const mem = {};
  const KEY = 'hawkes.spawn.v1';
  const store = {
    read() { try { const v = JSON.parse(localStorage.getItem(KEY)); if (v && typeof v === 'object') return v; } catch { /* no storage (a sandboxed frame) */ } return mem.v || {}; },
    write(v) { mem.v = v; try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* memory only */ } },
  };
  S.store = store;
  /** A stored snapshot back as a full item: the live one when it exists (local things change with the game). */
  const revive = (s) => { if (!s || !s.id) return null; const live = local().find((i) => i.id === s.id); if (live) return live; if (s.source === 'library' && s.lib) return libItem(s.lib); if (s.source === 'game' && s.asset) return { ...s }; return null; };
  function listOf(name, max) {
    return {
      list: () => (store.read()[name] || []).map(revive).filter(Boolean).slice(0, max),
      has: (it) => (store.read()[name] || []).some((s) => s.id === (it && it.id)),
      add(it) { const v = store.read(); v[name] = [snap(it), ...(v[name] || []).filter((s) => s.id !== it.id)].slice(0, max); store.write(v); },
      remove(it) { const v = store.read(); v[name] = (v[name] || []).filter((s) => s.id !== (it && it.id)); store.write(v); },
      clear() { const v = store.read(); v[name] = []; store.write(v); },
    };
  }
  S.recent = listOf('recent', 12);
  S.favorites = listOf('favorites', 24);
  S.toggleFavorite = (it) => { if (S.favorites.has(it)) { S.favorites.remove(it); return false; } S.favorites.add(it); return true; };

  // ------------------------------------------------------------------ where things land
  /** How big a spec is (meters): [half width, height above its middle (lift), half depth]. A rough box for spacing. */
  function sizeOf(spec) {
    let lift = 0.5;
    try { lift = Number(H.kinds.lift(spec)) || 0.5; } catch { /* a kind without lift */ }
    if (spec && spec.lift !== undefined) lift = Number(spec.lift) || lift;
    const sh = (spec && spec.shape) || {};
    let half = lift;
    if (Array.isArray(sh.size)) half = Math.max(sh.size[0], sh.size[2] ?? sh.size[0]) / 2;
    else if (typeof sh.size === 'number') half = sh.size / 2;
    else if (sh.radius) half = Number(sh.radius);
    const big = { car: 2.3, truck: 2.6, boat: 3, submarine: 4, airplane: 6, helicopter: 5, rocket: 4, spaceship: 6, house: 6, room: 4, bed: 1.2, sofa: 1.2, piano: 1, herd: 4, water: 4, bicycle: 1, motorbike: 1.2 };
    if (spec && big[spec.type]) half = Math.max(half, big[spec.type]);
    const sc = spec && spec.transform && spec.transform.scale;
    if (Array.isArray(sc)) half *= Math.max(sc[0], sc[2]);
    return { half: Math.max(0.3, half), lift };
  }
  S.sizeOf = sizeOf;
  /** Offsets for n things around a point, spaced by their size: a tidy grid (seeded, the same every time). */
  function spread(n, spacing) {
    if (n <= 1) return [[0, 0]];
    const cols = Math.ceil(Math.sqrt(n));
    const out = [];
    for (let i = 0; i < n; i++) {
      const r = Math.floor(i / cols), c = i % cols;
      out.push([r2((c - (cols - 1) / 2) * spacing), r2((r - (Math.ceil(n / cols) - 1) / 2) * spacing)]);
    }
    return out;
  }
  S.spread = spread;
  /** The ground under (x, z): the terrain, or the top of things that stay put (not the player, not what's moving). */
  function groundAt(x, z, fromY = 60) {
    let t = null;
    if (H.terrain && typeof H.terrain.heightAt === 'function') { try { t = H.terrain.heightAt(x, z); } catch { t = null; } }
    let y = null;
    const w = W();
    if (w && w.scene && typeof BABYLON !== 'undefined') {
      const ray = new BABYLON.Ray(new BABYLON.Vector3(x, fromY, z), new BABYLON.Vector3(0, -1, 0), fromY + 200);
      const hit = w.scene.pickWithRay(ray, (m) => { const en = H.entityOf(m); return Boolean(en && en.alive && en.physics !== 'dynamic' && en.physics !== 'none' && en.physics !== 'trigger' && !en.isPlayer && !en.remotePlayer && !en.spawnGhost && m.isEnabled() && !(m.metadata && (m.metadata.decor || m.metadata.spawnGhost))); });
      if (hit && hit.hit) y = hit.pickedPoint.y;
    }
    if (t !== null && t !== undefined && isFinite(t)) return y === null ? t : Math.max(t, y);
    return y;
  }
  S.groundAt = groundAt;
  function waterAt(x, z) { if (!H.water || typeof H.water.surfaceAt !== 'function') return null; try { const s = H.water.surfaceAt(x, z); return typeof s === 'number' && isFinite(s) ? s : null; } catch { return null; } }
  /** Where the player is and which way they face (flat): { x, y, z, dx, dz, yaw }. */
  function viewer() {
    const w = W();
    const p = w && w.player;
    const cam = w && w.scene && w.scene.activeCamera;
    let dx = 0, dz = 1;
    if (cam && cam.getDirection && typeof BABYLON !== 'undefined') { const d = cam.getDirection(BABYLON.Axis.Z); const l = Math.hypot(d.x, d.z); if (l > 1e-3) { dx = d.x / l; dz = d.z / l; } }
    else if (p && p.forward) { const l = Math.hypot(p.forward.x, p.forward.z) || 1; dx = p.forward.x / l; dz = p.forward.z / l; }
    const at = p ? [p.x, p.bottom ?? p.y, p.z] : cam ? [cam.position.x, cam.position.y - 1.6, cam.position.z] : [0, 0, 0];
    return { x: at[0], y: at[1], z: at[2], dx, dz, yaw: Math.atan2(dx, dz) };
  }
  S.viewer = viewer;
  /**
   * Where a spawn lands: `count` positions in front of the player (far enough for its size), each on the ground
   * (terrain or what stays put), or on the water for things that float (boats, fish) where there's water over the
   * ground. Returns { points: [[x, y, z]...], center, yaw (degrees, facing the player), onWater, half, lift }.
   * o.from / o.dir (tests), o.distance, o.count.
   */
  S.place = (spec, o = {}) => {
    const v = o.from ? { x: o.from[0], y: o.from[1], z: o.from[2], dx: (o.dir || [0, 1])[0], dz: (o.dir || [0, 1])[1] } : viewer();
    const n = Math.max(1, Math.floor(o.count || 1));
    const { half, lift } = sizeOf(spec);
    const spacing = half * 2 + 0.6;
    const offs = spread(n, spacing);
    const reach = n > 1 ? Math.sqrt(n) * spacing / 2 : 0;
    // Far enough that its near side is a few meters away (a 4x4 doesn't land on your toes or fill the view).
    const dist = o.distance ?? Math.min(40, Math.max(3, half * 2 + 3 + reach));
    const cx = v.x + v.dx * dist, cz = v.z + v.dz * dist;
    // Rows face the player: offsets turn with the view.
    const rx = v.dz, rz = -v.dx;
    const floats = Boolean(o.floats);
    let onWater = false;
    const points = offs.map(([a, b]) => {
      const x = cx + rx * a + v.dx * b, z = cz + rz * a + v.dz * b;
      const g = groundAt(x, z, Math.max(v.y + 30, 60));
      const s = waterAt(x, z);
      let base = g === null ? v.y : g;
      if (s !== null && s > base + 0.3) { onWater = true; if (floats) base = s; }
      return [r2(x), r2(base + lift + 0.05), r2(z)];
    });
    // Degrees around y: `away` faces where the player looks (a car ready to drive off), `toward` faces the player.
    const away = Math.round(((Math.atan2(v.dx, v.dz) * 180 / Math.PI) + 360) % 360);
    const toward = (away + 180) % 360;
    return { points, center: [r2(cx), points[0][1], r2(cz)], away, toward, onWater, half, lift, distance: r2(dist) };
  };
})();
