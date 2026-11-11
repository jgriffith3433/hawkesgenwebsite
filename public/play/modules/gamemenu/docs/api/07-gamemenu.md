## Game menu (`H.gameMenu` / `game.menu`)

One Esc (or the phone HUD's ☰) opens and closes the game menu. Items: Resume, Settings, Journal, Controls, Invite a
friend, Change my look, Leave to Hawkes Games. Settings (master, music, effects, voice, captions on/off and size,
graphics Auto/Low/Medium/High, camera sensitivity, invert Y, first/third person) apply at once and persist per device
(`localStorage` `hg_game_settings`). The world pauses only when a guest is alone. Chat's ⚙ opens the Settings page.

```js
H.gameMenu.open();           // or open('settings') / open('controls')
H.gameMenu.close();
H.gameMenu.toggle();
H.gameMenu.settings;         // live prefs object
H.gameMenu.set({ effects: 0, graphics: 'low' });
game.on('menu', ({ open, page });
```
