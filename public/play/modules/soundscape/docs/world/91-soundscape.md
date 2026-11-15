## Soundscape
`H.soundscape`: ambience beds (inland, beach, pier) crossfaded by player x on the frame hook, footsteps by surface from
`step-<sand|grass|wood|stone>-1..3` (never the same twice in a row, pitch varied), and `ui(name)` sounds (`pickup`, `place`,
`build`, `panel`, `quest`, `send`) on game events: `pickup`/`spawn`/`quest`/`asked`, plus `workStart` → build,
`mirror`/`spawn-wheel` open → panel. Files: `public/play/audio/sfx/` and its `index.json`.
Ambience uses `H.audio.background`; everything else the master, so mute and volume apply. A hidden page suspends the context.

**Hours and weather.** Under those area beds, four time-of-day loops (dawn chorus, midday cicadas, dusk gulls and waves,
night crickets / frogs / owl) crossfade with the clock over 30 s or more. A rain shower rolls in every few minutes
(or on `H.weather.force`): rain particles, wet sheen, lightning with thunder late by distance, and rain that sounds like
open ground, pier boards or the hangar roof depending on what is over you. A phone keeps two beds at most. Playtest
`island-hours`; state on `window.__weather`.
