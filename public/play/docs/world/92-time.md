## Time: rewind, reset, undo

While playing, every world can **rewind** (hold ◀◀ top left, Backspace, or D-pad left: the last 10 s play backwards,
and letting go carries on from there; broken things come back, things made since go) and **reset** (⟲,
Shift+Backspace, D-pad down: back to how the world loaded). Playing together, the host decides: the host's rewind takes
everyone's world back 10 s (players keep their places) and anyone else's button asks the host.

- `"config": { "rewind": false }` turns both off (a race, a timed or scored challenge where rewinding would cheat).
- "Let me undo the explosion" while playing: rewind. "Start the level over": reset (scripts: `game.resetWorld()`).
- While building, undo and redo (↶ ↷ at the top, Ctrl+Z / Ctrl+Shift+Z, D-pad left/right) take back the builder's own
  edits only: what someone else changed since is kept.
