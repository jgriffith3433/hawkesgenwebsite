## HUD layout (`H.hudLayout`)

The HUD sits in named zones: top-left the quest banner (`#dl-stack`, `.tour-track`, `.tour-stuck`, `.qs-btn`, `.qs-track`, `.hc-card`), top-right
the action row (`.gs-acts`, `.jr-btn`), the right side panel (`.mr`, the mirror's questions, or anything with `data-hud-panel`), the
chat at the bottom (`.hc-chat`), and the game menu (`[data-game-menu]`, `modules/gamemenu`). When a side panel opens, the action row (including the Journal button) and the bottom chat card move to its left and the quest banner's width ends before it;
closing puts them back with a transition. Positions always track the length `--hl-panel` (registered with `@property`, 0 when closed) so opening and closing glide; do not gate `right`/`left`/`width` on `body.hl-panel` alone. It reacts to a panel being added or removed, to the panel's size and to
`resize`: no timers.

On a phone (width under 760 px, or height under 500 px — the short-landscape cut used by the landing sky) the action
row shows one ≥48 px menu button (`.gs-acts .more`); tapping it opens the game menu. The Journal button
(`.jr-btn`) is hidden on compact (the game menu and Controls still have Journal). The mirror is a bottom sheet in portrait, or a narrow
side sheet above the touch cluster in short landscape, so the quest button and the move stick stay free.
`body.hl-compact` is set while that fold is on.

```js
HawkesPlay.hudLayout.reserved();  // pixels kept free on the right now (0 with no panel, or a bottom sheet on a phone)
HawkesPlay.hudLayout.compact(390, 844);  // true on a phone fold
HawkesPlay.hudLayout.sheet(844, 390);    // 'side' | 'bottom' | null
document.body.classList.contains('hl-panel');  // a side panel is open; the CSS variable --hl-panel holds the pixels
document.body.classList.contains('hl-compact'); // phone fold is on
```

A module with its own side panel sets `data-hud-panel` on it (position: fixed, `right` set) and nothing else.
