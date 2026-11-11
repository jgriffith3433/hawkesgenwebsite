## Lighting: a real light stack (`config.lighting`)

`"lighting": true` (or `{ "hour": 16.9 }`) lights a world like a game, not a flat scene: a low, raking sun with cascaded
soft shadows, the sky reflected in metal, wet sand and paint, filmic (ACES) tone, bloom on whatever glows (beams,
beacons, lamps, lore glints) and a colour grade for the hour: dawn warm gold, noon neutral, dusk orange-magenta, night
moonlit blue. It follows the world's clock (`config.time`) when the clock changes the light; when it does not (the
island's clock only runs the islanders' day) the light is held at `hour`, a golden late afternoon by default.

It follows the player's **Graphics** setting: High on a computer has 4 shadow cascades, softest filtering and
ambient occlusion; Auto on a phone has 2 cascades, half-resolution bloom and no occlusion; Low cuts the shadows' reach
and map further and turns bloom off. Tone and grade stay on in every tier.

Nothing here changes how a world plays: no physics, no HUD. A world that does not ask for it keeps the engine's plain look.
Settings: `hour` (the held hour, 0-24), `shadows: false` (leave the engine's shadows), `ssao: false`, `grade: false`.
