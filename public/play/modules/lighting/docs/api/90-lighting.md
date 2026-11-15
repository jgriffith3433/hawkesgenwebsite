## Lighting: `H.lighting`, `window.__look`

`H.lighting.setHour(h)` stops the world's clock at an hour (a number or a word: "dawn", "noon", "dusk", "night") and lets
it change the light; `H.lighting.release()` gives the clock back. `H.lighting.tier` is `desktop`, `tablet`, `phone` or
`low` (the Graphics setting on this device: `H.setQuality` retiers it live), `H.lighting.state()` everything below plus
what is built. `window.__look` is `{ tier, tonemap ("ACES"), bloom, ssao, cascades, grade ("dawn" | "noon" | "dusk" |
"night") }`, what the island-look playtest reads. `H.lightingCore` is the pure part (tiers, grades, exposure by hour).

Meshes that should cast a soft shadow go through `H.world.shadows.addShadowCaster(mesh)` as before: it is the cascaded
generator now, and a mesh needs `receiveShadows = true` to take one. A mesh with an emissive material shines into the
bloom without any call.
