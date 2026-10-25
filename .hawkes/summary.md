# Restyle /community in the landing identity

**Changed** (`public/community.html`, `public/community.js` only; no server, API or data changes):
- Same light tokens as the landing page: white cards with the landing shadow, section-label eyebrow, Inter headings, mono counts.
- Header "Everything the Overseer has kept." with a plain lede and the counts. Each shelf has a heading in the Overseer's voice plus one plain line saying what is on it (kind, file type). Empty and error states speak in its voice and say what is actually wrong.
- Cards are bigger (220 px min), with a kind badge on the thumbnail and a larger play button for sounds.
- Detail panel is larger; the model is live in 3D (mid-level LOD, auto-rotating, drag/zoom). Sounds get their own player: big play/pause, waveform bars that fill, time, seek slider, loop for music/ambience.
- "Use in a game" is the big primary action: signed in, it picks one of your games and adds the thing (`POST /v1/games/:id/community`), then links to the game; signed out it goes to /app. Download stays secondary.
- Unchanged: search, kinds, categories, sort, show more, likes display, deep links `?kind=&category=&q=&sort=&open=`. At 390 px the shelves wrap, the grid is two columns and the panel is a bottom sheet.

**Checked:** typecheck (includes `node --check public/community.js`), community tests. I did not open it in a browser (not allowed here), so 390/1440 px is by CSS only: please have it playtested.

**Not done:** no playtest scenario (the other agents are editing `public/playtest/portal.js`; adding one there risks a conflict), so `.hawkes/scenario.txt` is not written. The 3D "live" view is in the panel, not on every card. No GPU work, so no estimate needed.

**Test note:** the full `npm test` has two failures in the Observatory engine tests (`test/engine/observatory.test.ts`), which I did not touch; they come from beta as it was.
