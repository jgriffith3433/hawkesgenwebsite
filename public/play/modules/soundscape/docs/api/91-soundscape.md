## Soundscape
`H.soundscape`: ambience beds (inland, beach, pier) crossfaded by player x on the frame hook, footsteps by surface from
`step-<sand|grass|wood|stone>-1..3` (never the same twice in a row, pitch varied), and `ui(name)` sounds (`pickup`, `place`,
`build`, `panel`, `quest`, `send`) on game events: `pickup`/`spawn`/`quest`/`asked`, plus `workStart` → build,
`mirror`/`spawn-wheel` open → panel. Files: `public/play/audio/sfx/` and its `index.json`.
Ambience uses `H.audio.ambience` (its own bus, 4 dB under a voice); everything else the master, so mute and volume apply. A hidden page suspends the context.

### Hours and weather (`weather.js`, `H.weather`, `window.__weather`)
Four time-of-day beds (`tod-dawn`, `tod-day`, `tod-dusk`, `tod-night`) crossfade by `H.sky.clock` over at least 30 s,
under the area beds. A rain shower (60-120 s, random every few minutes, or `H.weather.force({ seconds, lightning })`;
`clear()`, `strike()`) darkens the sky (`H.sky.set('weather')`), drops rain round the camera with splashes and rings on the
sea, wets materials, flashes lightning and plays `thunder-1..3` late by distance. Rain sound follows what is over the player:
`rain-ground` (open), `rain-wood` (the pier, a hut), `rain-metal` (the hangar roof). A phone plays two beds at most
(`S.mask` ducks the area beds) and lighter rain. Events `soundscape` (`bed-change`, `beds`, `rain-start`, `rain-surface`,
`lightning`, `thunder`, `rain-stop`); `window.__weather` reads state and `log`.
