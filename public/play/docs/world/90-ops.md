## Changes (ops)

The editor and the assistant change the world with ops:

- `{ "op": "create", "entity": { "id": "lamp_2", "type": "light", ... } }` (an id is made from the name if missing)
- `{ "op": "update", "id": "crate_1", "patch": { "physics": "dynamic", "material": { "color": "#ff0000" } } }`
  (objects merge, lists and values replace, `null` removes a field)
- `{ "op": "replace", "entity": { ...the whole thing... } }`
- `{ "op": "delete", "id": "crate_1" }` (things whose `parent` it was go too)
- `{ "op": "config", "patch": { "background": "#101018", "fog": { "start": 20, "end": 80 } } }`
