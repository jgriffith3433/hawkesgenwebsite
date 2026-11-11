## Wind and wildlife
`config.wind` (`true` or `{ dir: [x, z], gusts: false, grass: false, petals: false, palms: false }`) makes the world move on its own:
trees, palms, bushes and grass sway with a breath that is always there and with gusts that cross the world with the wind
(`dir` is where it blows to). Grass and wildflowers grow round the player on the meadow and the road verges (`grass` layer
only), shrink to nothing at their reach and are pushed aside where the player and vehicles pass. Petals and leaves lift in
the gusts (not on a phone). The scatter's trees and bushes sway by themselves; any mesh a script makes can too with
`H.wind.mark(mesh, 'tree' | 'bush' | 'palm' | 'grass')` (a standard or PBR material; the lean grows from its lowest point to its top).

`config.wildlife` (`true` or `{ gulls: [x, z], clearing: [x, z, radius], pier: [x, z], gullsOn / butterflies / fireflies / fish: false }`,
needs `config.wind`): gulls circle at `gulls` (a flock with a flap-and-glide cycle) and scatter when a vehicle, a running
player or an explosion comes near, then settle again; butterflies fly in the `clearing` by day and fireflies by night (the
world's clock: none are drawn by day); a fish jumps off the `pier` now and then with a splash.

Both follow the Graphics setting: desktop draws full grass and 12 gulls; a phone 30 percent of the grass, 6 gulls, no petals.
