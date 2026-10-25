// Presence, part 1c: the registry of Gen-made models, one row per "What are you?" type (presence-core.js WHATS).
// DATA, not code: presence-models.js reads it. A row with no `asset` (or `url`) is a type whose model has not been made yet:
// it keeps its procedural body (presence-bodies.js, presence-person.js, presence-things.js, living/species.js). Dropping a
// model in is filling a row in; docs/characters.md "Gen models" has the fields and the steps.
//
//   asset     a community/library asset id (a_...), loaded from P.modelUrl(asset); or `url` for a file at an address
//   lods      Gen's summary of the asset's levels of detail (bundle `assets[name].lods`: { kind: 'mesh', tris, tex, levels: [{ tris, tex, url }] });
//             without it the one file is both the near and the far model, `low` (an address) may name a far file
//   h         real height in meters (feet on the ground), default WHATS h; the model is scaled to it, never to 1.8 m
//   form      biped | quadruped | bird | swimmer | roller | thing | legless: how it moves when the GLB has no clip for it
//   yaw       turn in radians so the model's front looks along +z of the body; Babylon loads a glTF facing -z, so the default is pi
//   head      the head's width in meters (hats and glasses are scaled to it); default a share of h by form (HEAD_SHARE)
//   anchors   where things are worn: head (the top of the head, where a hat sits), face (between the eyes, front of the face),
//             neck (a scarf's ring, a bow tie), back (a backpack, wings), rump (the tail). Each { node, at, rot, scale }: a node of
//             the model by name (a bone's or any part's; a skinned model's joints are nodes) and/or an offset `at` [x, y, z] in the
//             model's own units from that node (from the model's origin when there is no node), `rot` [x, y, z] radians to
//             straighten a bone's axes (+y up, +z the way the face looks), `scale` a multiplier on this anchor's size.
//             Left out, an anchor comes from the model's bounding box and its form.
//   clips     { idle, walk, run, jump, fall, swim, sit, sleep, wave, dance, ... }: the GLB animation names to play for each. Left out,
//             a clip is found by a word in its name (idle, walk, run, jump, fall, swim...). A role with no clip moves procedurally.
//   stride    meters per second at which the walk and run clips look right { walk: 1.6, run: 4.5 } (their speed follows the body's)
//   parts     named nodes moved procedurally when no clip drives them: [{ node, role, axis, amp, ph }], role leg | arm | tail | ear |
//             wing | fin | head | wheel (a wheel rolls with the distance, `radius` in meters)
//   radius    a roller's radius in meters (default half the height)
/* global HawkesPlay */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const P = (H.presence = H.presence || {});
  const row = (form) => ({ asset: null, url: null, lods: null, form });
  // Gen-made models (the pilot): files in public/play/models, made through Hawkes Gen (docs/characters.md "Gen models"). The front of each file is +z.
  const lods = (tris, low, url) => ({ kind: 'mesh', tris, tex: 1024, levels: [{ tris: low, tex: 1024, url }] });
  P.modelRegistry = {
    // people and machines
    person: { ...row('biped'), url: '/play/models/person.glb', lods: lods(7600, 2279, '/play/models/person-low.glb'), h: 1.8, head: 0.85, clips: { walk: 'ArmR', run: 'ArmR2', idle: 'Head', jump: 'LegRTip' }, anchors: { head: { at: [0, 0.99, 0] }, face: { at: [0, 0.78, 0.24] }, neck: { at: [0, 0.52, 0] }, back: { at: [0, 0.4, -0.14] }, rump: { at: [0, 0.22, -0.12] } } }, robot: row('biped'), tvbot: row('biped'), rollbot: row('roller'),
    // animals
    dog: { ...row('quadruped'), url: '/play/models/dog.glb', lods: lods(7600, 2280, '/play/models/dog-low.glb'), h: 0.95, head: 0.4, clips: { walk: 'ArmR', run: 'ArmR2', idle: 'Head', jump: 'LegBRTip' }, anchors: { head: { at: [0, 0.92, 0.13] }, face: { at: [0, 0.7, 0.4] }, neck: { at: [0, 0.5, 0.25] }, back: { at: [0, 0.62, -0.2] }, rump: { at: [0, 0.55, -0.45] } } }, cat: row('quadruped'), fox: row('quadruped'), pig: row('quadruped'), bear: row('quadruped'),
    rabbit: row('quadruped'), cow: row('quadruped'), sheep: row('quadruped'), horse: row('quadruped'),
    penguin: row('bird'), chicken: row('bird'), dinosaur: row('biped'), fish: row('swimmer'),
    // things
    shoe: { ...row('thing'), url: '/play/models/shoe.glb', lods: lods(7595, 2275, '/play/models/shoe-low.glb'), h: 0.5, head: 0.34, anchors: { head: { at: [0, 0.44, 0.05] }, face: { at: [0, 0.36, 0.36] }, neck: { at: [0, 0.3, 0.2] }, back: { at: [0, 0.4, -0.3] }, rump: { at: [0, 0.2, -0.5] } } }, toaster: row('thing'), cactus: row('thing'), cone: row('thing'), teapot: row('thing'),
    banana: row('thing'), mushroom: row('thing'), potato: row('thing'), duck: row('legless'),
  };
  // Gen-made hats (docs/characters.md "Gen hats"): files in public/play/models, made through Hawkes Gen (prop3d steps), about 1.3k triangles each,
  // base at y = 0, front +z. `width` is the body of the hat in head units (the unit head is 0.43 wide), `sink` how far it sits into the head,
  // `tint` whether the look's accent colours it (the model is white where it should take the pick), `flat` a colour for a hat whose bake failed.
  // A hat with no row (halo, horns, bunny) keeps its procedural shape.
  const hat = (kind, o) => ({ url: `/play/models/hat-${kind}.glb`, ...o });
  P.hatRegistry = {
    cap: hat('cap', { width: 0.46, sink: 0.04, tint: true }),
    beanie: hat('beanie', { width: 0.44, sink: 0.1, tint: true }),
    tophat: hat('tophat', { width: 0.58 }),
    crown: hat('crown', { width: 0.44, flat: '#facc15' }),
    cowboy: hat('cowboy', { width: 0.78 }),
    party: hat('party', { width: 0.3, tint: true }),
    helmet: hat('helmet', { width: 0.5, sink: 0.15, tint: 'body' }),
    chef: hat('chef', { width: 0.46 }),
  };
})();
