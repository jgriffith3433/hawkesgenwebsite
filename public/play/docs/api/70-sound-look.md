## Sound

`game.sound('jump.mp3', { volume: 1 })` plays once. `game.music('theme.mp3', { volume: 0.5 })` loops;
`game.stopMusic()`. Sound starts after the player's first click or key (browsers require it).

## Look and effects

`game.sky('#9fd3f0')` sets the sky color; `game.sky('sky.jpg')` puts a panorama image around the world.
`game.burst([x, y, z], { color: '#ffcc00', count: 30, size: 0.2, speed: 4 })` throws out sparks.

