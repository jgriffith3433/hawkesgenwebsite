# Finish (ground contact)

Every placed thing on a world with terrain is finished after load: its drawn base sits on the ground (not its pivot),
small props tip with the slope up to 15°, large rocks and buildings sink a few centimetres so no base edge shows air,
and on a phone a soft blob contact shadow sits under nearby props and characters. Imported models whose faces wind
inward are flipped so backface culling never shows the inside.

Scene authors do not opt in: `H.finish` runs on every world. Mark a thing to leave alone with `"data": { "finish": false }`
(or a pier post / pad / zone the module already skips). Per-model dig amounts live in `finish-math.js` `PIVOT` (asset id
or file name → `{ sink, lift }`).

Decals and coplanar floors (pier deck, helipad, hangar pad markings) use a material `zOffset` so they do not flicker
against the surface under them.
