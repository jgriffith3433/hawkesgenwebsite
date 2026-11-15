## Mix
`H.audio` buses: `background` (music), `ambience`, `voice`, `effects` (sfx), `ui`, then master -> makeup -> compressor ->
limiter -> a soft ceiling. `H.audio.media(el, { voice: true })` ducks the beds while it plays (`o.at`: a place or a function
giving one, heard from there; `o.ambience`, `o.ui`, `o.sfx` pick other buses). `H.audio.voiceDuck(owner, on)` ducks by hand
(music 8 dB, ambience 4 dB, 150 ms attack, 600 ms release). `H.audio.levels` reads the buses and the duck depth.
`H.audio.spatial(at, { ref, rolloff, max, muffle, who, bus })` places a sound (HRTF with inverse-distance rolloff and a distance
low-pass on a desktop; equal-power stereo on a phone): connect to `.input`, `.set(at)` moves it. `H.mix`: `zone`
(`open`, `hall`, `wood`, `room`), `lufs()`, `measure()`, `voices`, `probe(at)`. Event `mix-zone` {from, to}; `audio-unlock` {ms}.
`window.__mix` shows the buses, the zone and its blend, the duck depth, the placed voices and the loudness.
