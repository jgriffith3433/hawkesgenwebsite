## Wind and wildlife: `H.wind`, `H.wildlife`, `window.__wind`, `window.__wildlife`
`H.wind.gustHere()` (0 to 1: how hard the gust is where the player stands), `H.wind.onGust(fn)` (called with
`{ state: 'gust', n, strength, dir, seconds }` as each gust starts; `game.on('wind', fn)` hears the same), `H.wind.gustNow()`,
`H.wind.mark(mesh, kind)`, `H.wind.state()`. The gust sound (a filtered breath on the ambience bus) follows `gustHere()`, so a
gust is heard as it reaches you. `window.__wind` is `{ on, tier, gusts, live, strength, here, dir, grass (clumps drawn),
flowers, grassDensity, grassReach, petals, palms, pushers, last, heard }`.
`game.on('wildlife', fn)`: `{ state: 'scatter', cause: 'vehicle' | 'player' | 'explosion', count, dist, ms }`, `{ state: 'settle' }`,
`{ state: 'fish', n, x, z }`. `window.__wildlife` is `{ tier, hour, night, gulls, gullsCircling, gullsScattered, scatterCount,
scatters, last, butterflies, fireflies, fishJumps, minGullClearance, minFlyClearance, insideGeometry }`.
`H.windCore` is the pure part (tiers, gusts, the meadow's cells, the clock's night, the flock's step).
