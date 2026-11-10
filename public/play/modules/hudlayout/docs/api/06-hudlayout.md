## HUD layout (`H.hudLayout`)

The HUD sits in named zones: top-left the quest banner (`.tour-track`, `.tour-stuck`, `.qs-btn`, `.qs-track`), top-right
the action row (`.gs-acts`), the right side panel (`.mr`, the mirror's questions, or anything with `data-hud-panel`) and the
chat at the bottom. When a side panel opens, the action row moves to its left and the quest banner's width ends before it;
closing puts them back with a transition. It reacts to a panel being added or removed, to the panel's size and to
`resize`: no timers.

```js
HawkesPlay.hudLayout.reserved();  // pixels kept free on the right now (0 with no panel, or a bottom sheet on a phone)
document.body.classList.contains('hl-panel');  // a side panel is open; the CSS variable --hl-panel holds the pixels
```

A module with its own side panel sets `data-hud-panel` on it (position: fixed, `right` set) and nothing else.
