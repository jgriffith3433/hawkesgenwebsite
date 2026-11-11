## Soundscape
`H.soundscape`: ambience beds (inland, beach, pier) crossfaded by player x on the frame hook, footsteps by surface from
`step-<sand|grass|wood|stone>-1..3` (never the same twice in a row, pitch varied), and `ui(name)` sounds (`pickup`, `place`,
`build`, `panel`, `quest`, `send`) on game events: `pickup`/`spawn`/`quest`/`asked`, plus `workStart` → build,
`mirror`/`spawn-wheel` open → panel. Files: `public/play/audio/sfx/` and its `index.json`.
Ambience uses `H.audio.ambience` (its own bus, 4 dB under a voice); everything else the master, so mute and volume apply. A hidden page suspends the context.
