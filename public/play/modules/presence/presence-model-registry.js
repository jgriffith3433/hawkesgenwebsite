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
//   yaw       turn in radians so the model's front looks along +z of the body. Babylon's glTF loader keeps a file's +z front at +z (it
//             mirrors x), so a Gen-made model needs none: every row below has yaw 0 (J, 2026-10-25: with a turn of pi they were all
//             backwards). A row that names none gets 0 too; give pi to a file made facing -z
//   head      the head's width in meters (hats and glasses are scaled to it); default a share of h by form (HEAD_SHARE)
//   anchors   where things are worn: head (the top of the head, where a hat sits), face (between the eyes, front of the face),
//             neck (a scarf's ring, a bow tie), back (a backpack, wings), rump (the tail). Each { node, at, rot, scale }: a node of
//             the model by name (a bone's or any part's; a skinned model's joints are nodes) and/or an offset `at` [x, y, z] in the
//             model's own units from that node (from the model's origin when there is no node), `rot` [x, y, z] radians to
//             straighten a bone's axes (+y up, +z the way the face looks), `scale` a multiplier on this anchor's size.
//             Left out, an anchor comes from the model's bounding box and its form.
//   clips     { idle, walk, run, jump, fall, swim, sit, sleep, wave, dance, ... }: the GLB animation names to play for each. Left out,
//             a clip is found by a word in its name (idle, walk, run, jump, fall, swim...). A role with no clip moves procedurally.
//   rig       the animation set (docs/animations.md, presence-anim.js): mixamo | quadruped | object | none; default from `form`. `restFix`: false, or { LeftArm: [rx, ry, rz] } degrees, for a mixamo
//             model whose rest pose the measuring against Mixamo's T-pose gets wrong
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
  // The pilot's and the full set's models (docs/characters.md "Gen models"): every one is retopologised to 7,600 triangles near and 2,280 low (JPEG textures, 1024 px).
  // Skinned ones came out of Gen's template rigs, whose clips are named after bones: `idle` Head, `walk` ArmR, `run` ArmR2, `jump` LegRTip2 (biped) or LegBRTip2 (quadruped template).
  // The things (and the roll-bot, the fish, the duck) are one rigid mesh: they move by their form, procedurally.
  const mdl = (id, tris = 7600, low = 2280) => ({ url: `/play/models/${id}.glb`, lods: lods(tris, low, `/play/models/${id}-low.glb`) });
  const BIPED = { idle: 'Head', walk: 'ArmR', run: 'ArmR2', jump: 'LegRTip2' };
  const QUAD = { idle: 'Head', walk: 'ArmR', run: 'ArmR2', jump: 'LegBRTip2' };
  // Anchors are offsets from the model's origin in its own units (the model is about 1 unit tall, feet on y = 0, the face toward +z): see the pictures in /avatars?compare=1.
  const A = (head, face, neck, back, rump) => ({ head: { at: head }, face: { at: face }, neck: { at: neck }, back: { at: back }, rump: { at: rump } });
  P.modelRegistry = {
    // people and machines
    person: { ...row('biped'), url: '/play/models/person.glb', lods: lods(7600, 2279, '/play/models/person-low.glb'), h: 1.8, head: 0.85, clips: { walk: 'ArmR', run: 'ArmR2', idle: 'Head', jump: 'LegRTip' }, anchors: { head: { at: [0, 0.99, 0] }, face: { at: [0, 0.78, 0.24] }, neck: { at: [0, 0.52, 0] }, back: { at: [0, 0.4, -0.14] }, rump: { at: [0, 0.22, -0.12] } } },
    robot: { ...row('biped'), ...mdl('robot'), h: 1.8, head: 0.8, clips: BIPED, anchors: A([0, 0.99, 0], [0, 0.79, 0.2], [0, 0.62, 0], [0, 0.45, -0.18], [0, 0.3, -0.15]) },
    tvbot: { ...row('biped'), ...mdl('tvbot'), h: 1.75, head: 0.7, clips: BIPED, anchors: A([0, 0.86, 0], [0, 0.76, 0.2], [0, 0.66, 0], [0, 0.45, -0.17], [0, 0.3, -0.15]) },
    rollbot: { ...row('legless'), ...mdl('rollbot'), h: 1.35, head: 0.6, anchors: A([0, 0.88, 0], [0, 0.72, 0.2], [0, 0.6, 0], [0, 0.4, -0.2], [0, 0.2, -0.2]) },
    // animals: Gen drew most of them as upright vinyl toys, so they are bipeds; the sheep, the horse, the fox (and the pilot's dog) are on four legs
    dog: { ...row('quadruped'), url: '/play/models/dog.glb', lods: lods(7600, 2280, '/play/models/dog-low.glb'), h: 0.95, head: 0.4, clips: { walk: 'ArmR', run: 'ArmR2', idle: 'Head', jump: 'LegBRTip' }, anchors: { head: { at: [0, 0.92, 0.13] }, face: { at: [0, 0.7, 0.4] }, neck: { at: [0, 0.5, 0.25] }, back: { at: [0, 0.62, -0.2] }, rump: { at: [0, 0.55, -0.45] } } },
    cat: { ...row('biped'), ...mdl('cat'), h: 0.8, head: 0.36, clips: BIPED, anchors: A([0, 0.9, 0.02], [0, 0.76, 0.2], [0, 0.62, 0.02], [0, 0.4, -0.2], [0, 0.22, -0.25]) },
    fox: { ...row('quadruped'), ...mdl('fox'), h: 1, head: 0.45, clips: QUAD, anchors: A([0, 0.76, 0.22], [0, 0.58, 0.45], [0, 0.6, 0.1], [0, 0.5, -0.05], [0, 0.42, -0.35]) },
    pig: { ...row('biped'), ...mdl('pig'), h: 0.95, head: 0.52, clips: BIPED, anchors: A([0, 0.93, 0], [0, 0.74, 0.3], [0, 0.62, 0.1], [0, 0.4, -0.2], [0, 0.25, -0.28]) },
    bear: { ...row('biped'), ...mdl('bear'), h: 1.4, head: 0.56, clips: BIPED, anchors: A([0, 0.94, 0.02], [0, 0.77, 0.2], [0, 0.66, 0], [0, 0.45, -0.17], [0, 0.25, -0.18]) },
    rabbit: { ...row('biped'), ...mdl('rabbit'), h: 0.8, head: 0.24, clips: BIPED, anchors: A([0, 0.71, 0], [0, 0.57, 0.19], [0, 0.47, 0], [0, 0.3, -0.18], [0, 0.18, -0.2]) },
    cow: { ...row('biped'), ...mdl('cow'), h: 1.5, head: 0.65, clips: BIPED, anchors: A([0, 0.93, 0], [0, 0.75, 0.25], [0, 0.62, 0.05], [0, 0.4, -0.22], [0, 0.25, -0.25]) },
    sheep: { ...row('quadruped'), ...mdl('sheep'), h: 1.1, head: 0.55, clips: QUAD, anchors: A([0, 0.95, 0.15], [0, 0.62, 0.46], [0, 0.55, 0.3], [0, 0.62, -0.1], [0, 0.55, -0.45]) },
    horse: { ...row('quadruped'), ...mdl('horse'), h: 1.8, head: 0.4, clips: QUAD, anchors: A([0.07, 0.9, 0.24], [0.07, 0.7, 0.47], [0, 0.7, 0.12], [0, 0.55, -0.05], [0, 0.5, -0.42]) },
    penguin: { ...row('bird'), ...mdl('penguin'), h: 1.1, head: 0.55, clips: BIPED, anchors: A([0, 0.97, 0], [0, 0.8, 0.27], [0, 0.68, 0], [0, 0.45, -0.27], [0, 0.22, -0.25]) },
    chicken: { ...row('bird'), ...mdl('chicken'), h: 0.9, head: 0.45, clips: BIPED, anchors: A([0, 0.88, 0], [0, 0.72, 0.26], [0, 0.62, 0.1], [0, 0.45, -0.25], [0, 0.3, -0.28]) },
    dinosaur: { ...row('biped'), ...mdl('dinosaur'), h: 1.9, head: 0.6, clips: BIPED, anchors: A([0, 0.97, 0.1], [0, 0.84, 0.4], [0, 0.72, 0.12], [0, 0.55, -0.2], [0, 0.4, -0.4]) },
    // (the fish's concept was a three-quarter view: its body lies 31.3 degrees from +z, measured on the loaded file, so it is turned back by that, and its anchors are the same offsets turned the same way)
    fish: { ...row('swimmer'), ...mdl('fish'), h: 0.9, head: 0.4, yaw: -0.546, anchors: A([-0.145, 0.8, 0.239], [-0.234, 0.5, 0.385], [-0.104, 0.45, 0.171], [0.052, 0.7, -0.085], [0.234, 0.45, -0.385]) },
    // things
    shoe: { ...row('thing'), url: '/play/models/shoe.glb', lods: lods(7595, 2275, '/play/models/shoe-low.glb'), h: 0.5, head: 0.34, anchors: { head: { at: [0, 0.44, 0.05] }, face: { at: [0, 0.36, 0.36] }, neck: { at: [0, 0.3, 0.2] }, back: { at: [0, 0.4, -0.3] }, rump: { at: [0, 0.2, -0.5] } } },
    toaster: { ...row('thing'), ...mdl('toaster'), h: 1.15, head: 0.7, anchors: A([0, 0.9, 0], [0, 0.5, 0.26], [0, 0.7, 0.1], [0, 0.55, -0.26], [0, 0.3, -0.26]) },
    cactus: { ...row('thing'), ...mdl('cactus'), h: 1.7, head: 0.6, anchors: A([0, 0.95, 0], [0, 0.62, 0.24], [0, 0.45, 0.1], [0, 0.55, -0.24], [0, 0.1, -0.2]) },
    cone: { ...row('thing'), ...mdl('cone'), h: 1.4, head: 0.4, anchors: A([0, 0.97, 0], [0, 0.52, 0.17], [0, 0.7, 0.1], [0, 0.5, -0.2], [0, 0.1, -0.3]) },
    teapot: { ...row('thing'), ...mdl('teapot'), h: 1.05, head: 0.6, anchors: A([0, 0.87, 0], [0, 0.5, 0.3], [0, 0.62, 0.1], [0, 0.5, -0.3], [0, 0.2, -0.3]) },
    banana: { ...row('thing'), ...mdl('banana'), h: 1.6, head: 0.5, anchors: A([0, 0.99, 0], [0, 0.68, 0.17], [0, 0.6, 0], [0, 0.5, -0.17], [0, 0.15, -0.17]) },
    mushroom: { ...row('thing'), ...mdl('mushroom'), h: 1.35, head: 0.9, anchors: A([0, 0.98, 0], [0, 0.5, 0.25], [0, 0.38, 0.1], [0, 0.4, -0.25], [0, 0.2, -0.2]) },
    potato: { ...row('thing'), ...mdl('potato'), h: 1, head: 0.6, anchors: A([0, 0.98, 0], [0, 0.65, 0.3], [0, 0.45, 0.1], [0, 0.5, -0.28], [0, 0.2, -0.28]) },
    duck: { ...row('legless'), ...mdl('duck'), h: 0.95, head: 0.5, anchors: A([0, 0.86, 0.05], [0, 0.66, 0.45], [0, 0.5, 0.3], [0, 0.4, -0.35], [0, 0.3, -0.48]) },
  };
  // J, 2026-10-25: all the Gen-made models faced backwards with a turn of pi: they are not turned (yaw 0), said out loud in each row.
  for (const r of Object.values(P.modelRegistry)) if (!Number.isFinite(r.yaw)) r.yaw = 0; // (the fish names its own)
  // Gen-made hats (docs/characters.md "Gen hats"): files in public/play/models, made through Hawkes Gen (prop3d steps), about 1.3k triangles each,
  // base at y = 0, front +z. `width` is the body of the hat in head units (the unit head is 0.43 wide), `sink` how far it sits into the head,
  // `tint` whether the look's accent colours it (the model is white where it should take the pick), `flat` a colour for a hat whose bake failed.
  // halo, horns and bunny are built from geometry (tools/hat-glbs.mjs: a small cap with the ring on a post, the horns or the ears growing out of it), one
  // piece each, so `flat` colours them. A hat with no row keeps its procedural shape.
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
    halo: hat('halo', { width: 0.44, sink: 0.02, flat: '#fde047' }),
    horns: hat('horns', { width: 0.46, sink: 0.03, flat: '#e5e7eb' }),
    bunny: hat('bunny', { width: 0.4, sink: 0.03, flat: '#ffffff' }),
  };
})();
