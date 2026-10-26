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
//   keepGait  true: the body keeps its own locomotion (the fish's swim, the roll-bot's roll) and takes the set only for idle, the emotes and
//             hurt (the fish and the roll-bot are `rig: 'object'` with it)
//   motion    { hop, sway } multipliers on the object set's hop and lean; left out they come from the model's proportions (presence-anim.js)
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
  const lods = (tris, low, url) => ({ kind: 'mesh', tris, tex: 1024, levels: [{ tris: low, tex: 512, url }] });
  // The pilot's and the full set's models (docs/characters.md "Gen models"): every one is retopologised to 7,600 triangles near (1024 px JPEG textures) and 2,280 low (its own 512 px bake: docs/characters.md "The remake").
  // person and robot are the first Mixamo-standard models (docs/characters.md "Mixamo models": mesh.rig, the full 52-bone skeleton; their clips come from public/play/anim/mixamo.json, their anchors hang on mixamorig: bones).
  // The other skinned ones came out of Gen's template rigs, whose clips are named after bones: `idle` Head, `walk` ArmR, `run` ArmR2, `jump` LegRTip2 (biped) or LegBRTip2 (quadruped template).
  // The things (and the roll-bot, the fish, the duck) are one rigid mesh: they move by their form, procedurally.
  const mdl = (id, tris = 7600, low = 2280) => ({ url: `/play/models/${id}.glb`, lods: lods(tris, low, `/play/models/${id}-low.glb`) });
  const BIPED = { idle: 'Head', walk: 'ArmR', run: 'ArmR2', jump: 'LegRTip2' };
  const QUAD = { idle: 'Head', walk: 'ArmR', run: 'ArmR2', jump: 'LegBRTip2' };
  // Metres a gait cycle covers on the quad template (public/play/anim/quadruped.json): its legs are rigid and swing about 20 degrees either
  // way, so a cycle is about a body height long for the walk (the default 1.6 m would slide the feet on the dog).
  const quadStride = (h) => ({ walk: +(h * 1.0).toFixed(2), trot: +(h * 2).toFixed(2), run: +(h * 3.4).toFixed(2) });
  // Anchors are offsets from the model's origin in its own units (the model is about 1 unit tall, feet on y = 0, the face toward +z): see the pictures in /avatars?compare=1.
  const A = (head, face, neck, back, rump) => ({ head: { at: head }, face: { at: face }, neck: { at: neck }, back: { at: back }, rump: { at: rump } });
  const PERSON_USE_MODEL = false;
  const PERSON_MIXAMO = { ...row('biped'), url: '/play/models/person.glb', lods: lods(7600, 2280, '/play/models/person-low.glb'), h: 1.8, head: 1.04, rig: 'mixamo', anchors: { head: { node: 'mixamorig:Head', at: [0.0391, 0.8651, 0.0151], rot: [-0.0108, -2.6468, 0.0371] }, face: { node: 'mixamorig:Head', at: [-0.2065, 0.414, -0.4045], rot: [-0.0108, -2.6468, 0.0371] }, neck: { node: 'mixamorig:Neck', at: [-0.0077, -0.0883, 0.0155], rot: [-0.0779, 3.0323, 0.0311] }, back: { node: 'mixamorig:Spine2', at: [0.2249, -0.2463, 0.019], rot: [0.0004, -1.626, 0.0101] }, rump: { node: 'mixamorig:Hips', at: [0.0057, -0.0129, 0.2277], rot: [0.0487, -3.0934, 0.0166] } } };
  P.modelRegistry = {
    // people and machines
    // The person is the procedural vinyl toy (presence-person.js) while PERSON_USE_MODEL is false: the remade person.glb's texture is a blocky
    // pink skin bake with no clothes (it reads as a faceted pink blob with one big eye in the intro and mirror). Set it true once the model is remade.
    person: PERSON_USE_MODEL ? PERSON_MIXAMO : row('biped'),
    robot: { ...row('biped'), ...mdl('robot'), h: 1.8, head: 0.95, rig: 'mixamo', anchors: { head: { node: 'mixamorig:Head', at: [0.0093, 0.6571, -0.007], rot: [0.019, -0.3771, 0.0012] }, face: { node: 'mixamorig:Head', at: [-0.1263, 0.2359, 0.3367], rot: [0.019, -0.3771, 0.0012] }, neck: { node: 'mixamorig:Neck', at: [-0.0167, -0.2108, 0.0301], rot: [-0.0252, 2.5868, -0.0277] }, back: { node: 'mixamorig:Spine2', at: [0.0017, -0.3261, -0.2474], rot: [0.0191, 0.042, 0.0205] }, rump: { node: 'mixamorig:Hips', at: [-0.0096, -0.1763, 0.2092], rot: [-0.0968, 3.1262, -0.0031] } } },
tvbot: { ...row('biped'), ...mdl('tvbot'), h: 1.75, head: 0.91, rig: 'mixamo', anchors: { head: { node: 'mixamorig:Head', at: [-0.0104, 0.8461, -0.0059], rot: [0.0356, -2.7148, 0.0032] }, face: { node: 'mixamorig:Head', at: [-0.1532, 0.4273, -0.3169], rot: [0.0356, -2.7148, 0.0032] }, neck: { node: 'mixamorig:Neck', at: [-0.0081, 0.0208, 0.0252], rot: [-0.0664, -3.0389, 0.0176] }, back: { node: 'mixamorig:Spine2', at: [0.0435, -0.1341, -0.2098], rot: [0.0122, -0.1502, 0.0129] }, rump: { node: 'mixamorig:Hips', at: [-0.016, -0.0425, 0.2144], rot: [0.027, 3.1113, -0.0055] } } },
    rollbot: { ...row('legless'), rig: 'object', keepGait: true, ...mdl('rollbot'), h: 1.35, head: 0.6, anchors: A([0, 0.88, 0], [0, 0.72, 0.2], [0, 0.6, 0], [0, 0.4, -0.2], [0, 0.2, -0.2]) },
    // animals: Gen drew most of them as upright vinyl toys, so they are bipeds; the sheep, the horse, the fox (and the pilot's dog) are on four legs
    dog: { ...row('quadruped'), stride: quadStride(0.95), url: '/play/models/dog.glb', lods: lods(7600, 2280, '/play/models/dog-low.glb'), h: 0.95, head: 0.4, clips: { walk: 'ArmR', run: 'ArmR2', idle: 'Head', jump: 'LegBRTip' }, anchors: { head: { at: [0, 0.92, 0.13] }, face: { at: [0, 0.7, 0.4] }, neck: { at: [0, 0.5, 0.25] }, back: { at: [0, 0.62, -0.2] }, rump: { at: [0, 0.55, -0.45] } } },
    cat: { ...row('biped'), ...mdl('cat'), h: 0.8, head: 0.36, rig: 'mixamo', anchors: { head: { node: 'mixamorig:Head', at: [0.0004, 0.838, 0.0655], rot: [-0.1311, 2.9892, -0.001] }, face: { node: 'mixamorig:Head', at: [0.0722, 0.3988, -0.3989], rot: [-0.1311, 2.9892, -0.001] }, neck: { node: 'mixamorig:Neck', at: [0.016, -0.1941, -0.0714], rot: [-0.0602, 3.0934, -0.0029] }, back: { node: 'mixamorig:Spine2', at: [0.3164, -0.358, 0.0773], rot: [0.0501, -1.7844, 0.0471] }, rump: { node: 'mixamorig:Hips', at: [0.045, -0.0231, 0.3167], rot: [0.0448, -3.0357, -0.0033] } } },
    fox: { ...row('quadruped'), stride: quadStride(1), ...mdl('fox'), h: 1, head: 0.45, clips: QUAD, anchors: A([0, 0.76, 0.22], [0, 0.58, 0.45], [0, 0.6, 0.1], [0, 0.5, -0.05], [0, 0.42, -0.35]) },
    pig: { ...row('biped'), ...mdl('pig'), h: 0.95, head: 0.52, rig: 'mixamo', anchors: { head: { node: 'mixamorig:Head', at: [0.2481, 0.7086, 0.0007], rot: [-0.1756, -0.1743, -0.0378] }, face: { node: 'mixamorig:Head', at: [0.1189, 0.1659, 0.5952], rot: [-0.1756, -0.1743, -0.0378] }, neck: { node: 'mixamorig:Neck', at: [0.1966, -0.6154, 0.0886], rot: [-0.0618, 0.1318, -0.0326] }, back: { node: 'mixamorig:Spine2', at: [0.2514, -0.8871, -0.5929], rot: [-0.0843, -0.0548, 0.0057] }, rump: { node: 'mixamorig:Hips', at: [-0.0807, -0.0454, 0.7078], rot: [-0.0731, -2.9446, 0] } } },
    bear: { ...row('biped'), ...mdl('bear'), h: 1.4, head: 0.66, rig: 'mixamo', anchors: { head: { node: 'mixamorig:Head', at: [-0.0068, 0.668, -0.0627], rot: [-0.2385, -0.2266, 0.0211] }, face: { node: 'mixamorig:Head', at: [-0.0929, 0.3842, 0.346], rot: [-0.2385, -0.2266, 0.0211] }, neck: { node: 'mixamorig:Neck', at: [0.0386, -0.0341, -0.0868], rot: [-0.0917, 2.9012, -0.0106] }, back: { node: 'mixamorig:Spine2', at: [0.0377, -0.1561, -0.2366], rot: [-0.0304, -0.2234, 0.0231] }, rump: { node: 'mixamorig:Hips', at: [0.039, -0.0864, 0.2317], rot: [0.0004, -2.9877, 0.0432] } } },
    rabbit: { ...row('biped'), ...mdl('rabbit'), h: 0.8, head: 0.24, rig: 'mixamo', anchors: { head: { node: 'mixamorig:Head', at: [-0.0009, 0.8126, 0.0331], rot: [-0.0421, 2.6195, 0.023] }, face: { node: 'mixamorig:Head', at: [0.1396, 0.4775, -0.2273], rot: [-0.0421, 2.6195, 0.023] }, neck: { node: 'mixamorig:Neck', at: [-0.0029, 0.2603, -0.0199], rot: [-0.1352, -2.8461, 0.0165] }, back: { node: 'mixamorig:Spine2', at: [0.1115, 0.1388, 0.1941], rot: [0.0816, -2.6367, 0.0281] }, rump: { node: 'mixamorig:Hips', at: [0.119, 0.1146, 0.2426], rot: [0.1564, -2.6914, 0.065] } } },
cow: { ...row('biped'), ...mdl('cow'), h: 1.5, head: 0.65, rig: 'mixamo', anchors: { head: { node: 'mixamorig:Head', at: [0.0222, 0.8136, 0.0565], rot: [-0.0798, 0.1151, -0.0277] }, face: { node: 'mixamorig:Head', at: [0.0655, 0.2688, 0.5727], rot: [-0.0798, 0.1151, -0.0277] }, neck: { node: 'mixamorig:Neck', at: [-0.0164, -0.392, 0.1302], rot: [-0.086, -0.0844, 0.0142] }, back: { node: 'mixamorig:Spine2', at: [0.1572, -0.6506, -0.3537], rot: [-0.1024, -0.3192, 0.0826] }, rump: { node: 'mixamorig:Hips', at: [0.0742, -0.0465, 0.4276], rot: [0.0323, -2.9824, 0.0229] } } },
    sheep: { ...row('quadruped'), stride: quadStride(1.1), ...mdl('sheep'), h: 1.1, head: 0.55, clips: QUAD, anchors: A([0, 0.95, 0.15], [0, 0.62, 0.46], [0, 0.55, 0.3], [0, 0.62, -0.1], [0, 0.55, -0.45]) },
    horse: { ...row('quadruped'), stride: quadStride(1.8), ...mdl('horse'), h: 1.8, head: 0.4, clips: QUAD, anchors: A([0.07, 0.9, 0.24], [0.07, 0.7, 0.47], [0, 0.7, 0.12], [0, 0.55, -0.05], [0, 0.5, -0.42]) },
    penguin: { ...row('bird'), ...mdl('penguin'), h: 1.1, head: 0.52, rig: 'mixamo', anchors: { head: { node: 'mixamorig:Head', at: [-0.033, 0.6511, 0.0282], rot: [-0.03, -0.0572, 0.0661] }, face: { node: 'mixamorig:Head', at: [-0.0351, 0.2831, 0.507], rot: [-0.03, -0.0572, 0.0661] }, neck: { node: 'mixamorig:Neck', at: [0.0003, -0.1324, 0.0115], rot: [-0.0465, 0.213, 0.0158] }, back: { node: 'mixamorig:Spine2', at: [0.0455, -0.24, -0.4614], rot: [0.0031, -0.066, 0.0539] }, rump: { node: 'mixamorig:Hips', at: [0.2508, 0.0804, -0.3222], rot: [0.1186, -0.6375, 0.0589] } } },
    chicken: { ...row('bird'), ...mdl('chicken'), h: 0.9, head: 0.36, rig: 'mixamo', anchors: { head: { node: 'mixamorig:Head', at: [0.1147, 0.692, 0.1421], rot: [0.1748, 2.8724, 0.146] }, face: { node: 'mixamorig:Head', at: [0.2017, 0.2675, -0.3563], rot: [0.1748, 2.8724, 0.146] }, neck: { node: 'mixamorig:Neck', at: [-0.0189, 0.0713, 0.2132], rot: [0.6877, 2.6395, -0.1754] }, back: { node: 'mixamorig:Spine2', at: [-0.1463, -0.0106, 0.738], rot: [0.317, 2.8299, -0.0418] }, rump: { node: 'mixamorig:Hips', at: [-0.5696, -0.3845, 0.1084], rot: [-0.3786, 1.6942, 0.0905] } } },
    dinosaur: { ...row('biped'), ...mdl('dinosaur'), h: 1.9, head: 0.6, clips: BIPED, anchors: A([0, 0.97, 0.1], [0, 0.84, 0.4], [0, 0.72, 0.12], [0, 0.55, -0.2], [0, 0.4, -0.4]) },
    // (the fish's concept was a three-quarter view: its body lies 31.3 degrees from +z, measured on the loaded file, so it is turned back by that, and its anchors are the same offsets turned the same way)
    fish: { ...row('swimmer'), rig: 'object', keepGait: true, ...mdl('fish'), h: 0.9, head: 0.4, yaw: -0.546, anchors: A([-0.145, 0.8, 0.239], [-0.234, 0.5, 0.385], [-0.104, 0.45, 0.171], [0.052, 0.7, -0.085], [0.234, 0.45, -0.385]) },
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
  // `tint` whether the look's accent colours it (the model is white where it should take the pick), `flat` a colour for a hat whose bake failed,
  // `plain` (with `tint`) drops a blotchy bake: white, then the pick (the beanie and the helmet).
  // halo, horns and bunny are built from geometry (tools/hat-glbs.mjs: a small cap with the ring on a post, the horns or the ears growing out of it), one
  // piece each, so `flat` colours them. A hat with no row keeps its procedural shape.
  const hat = (kind, o) => ({ url: `/play/models/hat-${kind}.glb`, ...o });
  P.hatRegistry = {
    cap: hat('cap', { width: 0.46, sink: 0.04, tint: true }),
    beanie: hat('beanie', { width: 0.44, sink: 0.1, tint: true, plain: true }),
    tophat: hat('tophat', { width: 0.58 }),
    crown: hat('crown', { width: 0.44, flat: '#facc15' }),
    cowboy: hat('cowboy', { width: 0.78 }),
    party: hat('party', { width: 0.3, tint: true }),
    helmet: hat('helmet', { width: 0.5, sink: 0.15, tint: 'body', plain: true }),
    chef: hat('chef', { width: 0.46 }),
    halo: hat('halo', { width: 0.44, sink: 0.02, flat: '#fde047' }),
    horns: hat('horns', { width: 0.46, sink: 0.03, flat: '#e5e7eb' }),
    bunny: hat('bunny', { width: 0.4, sink: 0.03, flat: '#ffffff' }),
  };
})();
