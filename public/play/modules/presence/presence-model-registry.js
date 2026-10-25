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
  P.modelRegistry = {
    // people and machines
    person: row('biped'), robot: row('biped'), tvbot: row('biped'), rollbot: row('roller'),
    // animals
    dog: row('quadruped'), cat: row('quadruped'), fox: row('quadruped'), pig: row('quadruped'), bear: row('quadruped'),
    rabbit: row('quadruped'), cow: row('quadruped'), sheep: row('quadruped'), horse: row('quadruped'),
    penguin: row('bird'), chicken: row('bird'), dinosaur: row('biped'), fish: row('swimmer'),
    // things
    shoe: row('thing'), toaster: row('thing'), cactus: row('thing'), cone: row('thing'), teapot: row('thing'),
    banana: row('thing'), mushroom: row('thing'), potato: row('thing'), duck: row('legless'),
  };
})();
