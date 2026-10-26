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
  const lods = (tris, low, url) => ({ kind: 'mesh', tris, tex: 1024, levels: [{ tris: low, tex: 1024, url }] });
  // The pilot's and the full set's models (docs/characters.md "Gen models"): every one is retopologised to 7,600 triangles near and 2,280 low (JPEG textures, 1024 px).
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
  const PERSON_MIXAMO = { ...row('biped'), url: '/play/models/person.glb', lods: lods(7600, 2280, '/play/models/person-low.glb'), h: 1.8, head: 1.04, rig: 'mixamo', anchors: { head: { node: 'mixamorig:Head', at: [0.0616, 1.5419, -0.0385], rot: [0.0999, -2.9231, 0.0506] }, face: { node: 'mixamorig:Head', at: [-0.1472, 0.6436, -0.7886], rot: [0.0999, -2.9231, 0.0506] }, neck: { node: 'mixamorig:Neck', at: [-0.0554, -0.1273, 0.1911], rot: [0.2243, 2.9323, 0.0249] }, back: { node: 'mixamorig:Spine2', at: [0.254, -0.2907, 0.6441], rot: [0.2588, -2.7481, 0.0037] }, rump: { node: 'mixamorig:Hips', at: [0.0239, 0.1467, 0.7213], rot: [0.2955, -3.0903, 0.015] } } };
  P.modelRegistry = {
    // people and machines
    // STOPGAP: the person shows the procedural vinyl toy (presence-person.js) because person.glb's baked atlas is fragmented (tiny strip charts
    // with white texels: the body looks speckled and shattered). To bring the Mixamo model back, change PERSON_USE_MODEL to true; remake the
    // bake in Gen first (docs/characters.md "Mixamo models"). The files and the row below stay.
    person: PERSON_USE_MODEL ? PERSON_MIXAMO : row('biped'),
    robot: { ...row('biped'), ...mdl('robot'), h: 1.8, head: 0.95, rig: 'mixamo', anchors: { head: { node: 'mixamorig:Head', at: [0.015, 1.1176, -0.1419], rot: [0.2552, 3.0125, 0.0058] }, face: { node: 'mixamorig:Head', at: [0.0702, 0.2547, -0.6], rot: [0.2552, 3.0125, 0.0058] }, neck: { node: 'mixamorig:Neck', at: [-0.0578, -0.3254, 0.2862], rot: [0.249, 2.9367, -0.0153] }, back: { node: 'mixamorig:Spine2', at: [0.0361, -0.3783, 0.8001], rot: [0.306, -3.0669, 0.0223] }, rump: { node: 'mixamorig:Hips', at: [-0.0038, -0.1402, 0.8423], rot: [0.2001, -3.1308, 0.0021] } } },
tvbot: { ...row('biped'), ...mdl('tvbot'), h: 1.75, head: 0.91, rig: 'mixamo', anchors: { head: { node: 'mixamorig:Head', at: [-0.0752, 1.6039, -0.2261], rot: [0.2333, -2.8447, 0.007] }, face: { node: 'mixamorig:Head', at: [-0.2296, 0.6732, -0.7119], rot: [0.2333, -2.8447, 0.007] }, neck: { node: 'mixamorig:Neck', at: [-0.0381, 0.0423, 0.1801], rot: [0.1441, 3.0379, 0.001] }, back: { node: 'mixamorig:Spine2', at: [-0.1312, -0.0896, -0.771], rot: [0.2703, 0.1993, 0.0093] }, rump: { node: 'mixamorig:Hips', at: [-0.0524, 0.1624, 0.8733], rot: [0.3258, 3.1093, -0.0103] } } },
    rollbot: { ...row('legless'), rig: 'object', keepGait: true, ...mdl('rollbot'), h: 1.35, head: 0.6, anchors: A([0, 0.88, 0], [0, 0.72, 0.2], [0, 0.6, 0], [0, 0.4, -0.2], [0, 0.2, -0.2]) },
    // animals: Gen drew most of them as upright vinyl toys, so they are bipeds; the sheep, the horse, the fox (and the pilot's dog) are on four legs
    dog: { ...row('quadruped'), stride: quadStride(0.95), url: '/play/models/dog.glb', lods: lods(7600, 2280, '/play/models/dog-low.glb'), h: 0.95, head: 0.4, clips: { walk: 'ArmR', run: 'ArmR2', idle: 'Head', jump: 'LegBRTip' }, anchors: { head: { at: [0, 0.92, 0.13] }, face: { at: [0, 0.7, 0.4] }, neck: { at: [0, 0.5, 0.25] }, back: { at: [0, 0.62, -0.2] }, rump: { at: [0, 0.55, -0.45] } } },
    cat: { ...row('biped'), ...mdl('cat'), h: 0.8, head: 0.36, rig: 'mixamo', anchors: { head: { node: 'mixamorig:Head', at: [0.0589, 1.7764, 0.0969], rot: [-0.0868, 3.0597, 0.0325] }, face: { node: 'mixamorig:Head', at: [0.1015, 0.8138, -0.8358], rot: [-0.0868, 3.0597, 0.0325] }, neck: { node: 'mixamorig:Neck', at: [0.0116, -0.3909, -0.0425], rot: [0.0547, 2.9296, 0.0123] }, back: { node: 'mixamorig:Spine2', at: [0.6048, -0.6707, 0.2861], rot: [0.1342, -1.9489, 0.0554] }, rump: { node: 'mixamorig:Hips', at: [0.0246, 0.0126, 0.6683], rot: [0.1482, -3.0991, 0.0063] } } },
    fox: { ...row('quadruped'), stride: quadStride(1), ...mdl('fox'), h: 1, head: 0.45, clips: QUAD, anchors: A([0, 0.76, 0.22], [0, 0.58, 0.45], [0, 0.6, 0.1], [0, 0.5, -0.05], [0, 0.42, -0.35]) },
    pig: { ...row('biped'), ...mdl('pig'), h: 0.95, head: 0.52, rig: 'mixamo', anchors: { head: { node: 'mixamorig:Head', at: [0.5494, 0.9996, 0.1413], rot: [0.0154, 0.0162, -0.0341] }, face: { node: 'mixamorig:Head', at: [0.5294, 0.0544, 0.8721], rot: [0.0154, 0.0162, -0.0341] }, neck: { node: 'mixamorig:Neck', at: [0.4771, -0.9303, -0.0751], rot: [0.1238, 0.063, -0.0122] }, back: { node: 'mixamorig:Spine2', at: [0.6429, -1.1836, -0.8417], rot: [0.044, -0.1175, 0.0231] }, rump: { node: 'mixamorig:Hips', at: [-0.5001, 0.1415, 0.9849], rot: [0.1572, -3.1182, 0.0037] } } },
    bear: { ...row('biped'), ...mdl('bear'), h: 1.4, head: 0.66, rig: 'mixamo', anchors: { head: { node: 'mixamorig:Head', at: [-0.028, 1.5067, 0.1411], rot: [0.0206, -0.3424, -0.007] }, face: { node: 'mixamorig:Head', at: [-0.2934, 0.6313, 0.8676], rot: [0.0206, -0.3424, -0.007] }, neck: { node: 'mixamorig:Neck', at: [0.0298, -0.1203, -0.0466], rot: [0.1415, -3.068, -0.0255] }, back: { node: 'mixamorig:Spine2', at: [0.2031, -0.2518, -0.6135], rot: [0.1605, -0.3733, 0.0179] }, rump: { node: 'mixamorig:Hips', at: [0.1483, -0.0364, 0.7737], rot: [0.2714, -2.9549, 0.0506] } } },
    rabbit: { ...row('biped'), ...mdl('rabbit'), h: 0.8, head: 0.24, rig: 'mixamo', anchors: { head: { node: 'mixamorig:Head', at: [-0.0001, 2.1795, 0.2581], rot: [-0.1235, 2.9532, 0.0272] }, face: { node: 'mixamorig:Head', at: [0.145, 1.3796, -0.6346], rot: [-0.1235, 2.9532, 0.0272] }, neck: { node: 'mixamorig:Neck', at: [-0.0111, 0.7314, -0.0346], rot: [-0.1907, -2.9079, 0.012] }, back: { node: 'mixamorig:Spine2', at: [0.1899, 0.3376, 0.5492], rot: [0.0244, -2.8074, 0.0086] }, rump: { node: 'mixamorig:Hips', at: [0.2279, 0.2252, 0.617], rot: [0.1182, -2.8098, 0.0406] } } },
cow: { ...row('biped'), ...mdl('cow'), h: 1.5, head: 0.65, rig: 'mixamo', anchors: { head: { node: 'mixamorig:Head', at: [0.0363, 1.3327, 0.1656], rot: [-0.018, 0.1104, -0.0225] }, face: { node: 'mixamorig:Head', at: [0.104, 0.3717, 0.9759], rot: [-0.018, 0.1104, -0.0225] }, neck: { node: 'mixamorig:Neck', at: [-0.0035, -0.6864, 0.1753], rot: [-0.0539, 0.055, 0.005] }, back: { node: 'mixamorig:Spine2', at: [0.219, -1.0799, -0.6058], rot: [-0.0669, -0.2608, 0.0705] }, rump: { node: 'mixamorig:Hips', at: [0.0981, -0.0595, 0.7089], rot: [0.0848, -3.0201, 0.0103] } } },
    sheep: { ...row('quadruped'), stride: quadStride(1.1), ...mdl('sheep'), h: 1.1, head: 0.55, clips: QUAD, anchors: A([0, 0.95, 0.15], [0, 0.62, 0.46], [0, 0.55, 0.3], [0, 0.62, -0.1], [0, 0.55, -0.45]) },
    horse: { ...row('quadruped'), stride: quadStride(1.8), ...mdl('horse'), h: 1.8, head: 0.4, clips: QUAD, anchors: A([0.07, 0.9, 0.24], [0.07, 0.7, 0.47], [0, 0.7, 0.12], [0, 0.55, -0.05], [0, 0.5, -0.42]) },
    penguin: { ...row('bird'), ...mdl('penguin'), h: 1.1, head: 0.52, rig: 'mixamo', anchors: { head: { node: 'mixamorig:Head', at: [0.0138, 1.0408, -0.0813], rot: [-0.206, -0.0451, 0.0137] }, face: { node: 'mixamorig:Head', at: [-0.0154, 0.6013, 0.7483], rot: [-0.206, -0.0451, 0.0137] }, neck: { node: 'mixamorig:Neck', at: [0.0144, -0.1466, 0.1425], rot: [-0.2762, 0.148, -0.0147] }, back: { node: 'mixamorig:Spine2', at: [-0.0069, -0.5013, -0.7557], rot: [-0.177, 0.0078, 0.0045] }, rump: { node: 'mixamorig:Hips', at: [0.6191, 0.0059, -0.0235], rot: [0.0002, -1.5856, 0.0165] } } },
    chicken: { ...row('bird'), ...mdl('chicken'), h: 0.9, head: 0.36, rig: 'mixamo', anchors: { head: { node: 'mixamorig:Head', at: [0.1555, 0.8696, 0.0705], rot: [0.1609, 3.0746, 0.0903] }, face: { node: 'mixamorig:Head', at: [0.1513, 0.3368, -0.4632], rot: [0.1609, 3.0746, 0.0903] }, neck: { node: 'mixamorig:Neck', at: [0.0669, -0.0049, 0.2519], rot: [0.7123, 2.9871, -0.0089] }, back: { node: 'mixamorig:Spine2', at: [-0.2566, 0.1387, 0.8698], rot: [0.5428, 2.7451, -0.0211] }, rump: { node: 'mixamorig:Hips', at: [-0.0246, -0.0418, 1.1126], rot: [0.0912, 3.0519, -0.0082] } } },
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
