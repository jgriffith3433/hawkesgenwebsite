## HUD layout (`H.hudLayout`)

The HUD sits in named zones: top-left the quest banner (`.tour-track`, `.tour-stuck`, `.qs-btn`, `.qs-track`), top-right
the action row (`.gs-acts`), the right side panel (`.mr`, the mirror's questions, or anything with `data-hud-panel`) and the
chat at the bottom. When a side panel opens, the action row moves to its left and the quest banner's width ends before it;
closing puts them back with a transition. It reacts to a panel being added or removed, to the panel's size and to
`resize`: no timers.

On a phone (width under 760 px, or height under 500 px — the short-landscape cut used by the landing sky) the action
row folds into one 44 px menu button (`.gs-acts .more`); tapping it opens the intents as a list. The mirror is a bottom
sheet in portrait, or a narrow side sheet above the touch cluster in short landscape, so the quest button and the move
stick stay free. `body.hl-compact` is set while that fold is on.

```js
HawkesPlay.hudLayout.reserved();  // pixels kept free on the right now (0 with no panel, or a bottom sheet on a phone)
HawkesPlay.hudLayout.compact(390, 844);  // true on a phone fold
HawkesPlay.hudLayout.sheet(844, 390);    // 'side' | 'bottom' | null
document.body.classList.contains('hl-panel');  // a side panel is open; the CSS variable --hl-panel holds the pixels
document.body.classList.contains('hl-compact'); // phone fold is on
```

A module with its own side panel sets `data-hud-panel` on it (position: fixed, `right` set) and nothing else.
