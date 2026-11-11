# Finish

| Call | What |
|---|---|
| `H.finish.settle()` | Snap every eligible static / parked thing to the terrain from its true bounding-box bottom; returns `{ n }` |
| `H.finish.settleOne(e)` | Snap one entity; false if skipped |
| `H.finish.contactShadows()` | True when the phone tier has drawn blob contact shadows |
| `H.finish.phone()` | True on the phone device tier (or touch UI / low shadow budget) |
| `H.finish.fixMesh(mesh)` / `fixEntity(e)` | Flip inward-wound closed meshes; keep backface culling on |
| `H.finish.math` | The shared numbers (`FLOAT_M` 0.05, tilt cap, pivot table) also used by the world audit |

The world-quality playtest asks the audit with `{ strict: true, flicker: true, backfaces: true }` so a prop more than
5 cm off the ground, a flickering pixel at one of ten spots, or a back face from one of eight angles fails the run.
