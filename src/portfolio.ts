// "Built with Hawkes Gen": our live games and what Gen made for them. Only what we can show; counts are from the
// games' own asset folders (Dose Of Destruction: AllTheCharacters, AllTheMaps).

export type PortfolioItem = { project: string; title: string; genre: string; url: string; description: string; tools: string[] };

const ITEMS: PortfolioItem[] = [
  { project: 'doseofdestruction', title: 'Dose Of Destruction', genre: 'Platform fighter', url: 'https://doseofdestruction.com', description: '33 fighters with 2,219 animation clips, 9 stages, character voices and music.', tools: ['image.edit', 'video.i2v', 'image.cutout', 'audio.voice', 'audio.music'] },
  { project: 'phorigins', title: 'PH Origins', genre: '3D story game', url: 'https://phorigins.com', description: 'Voiced dialogue, sound effects and tileable PBR materials.', tools: ['audio.voice', 'audio.sfx', 'texture.maps'] },
  { project: 'sickofit', title: 'Sick Of It', genre: 'Arcade climber', url: 'https://hawkesgames.com/play/sickofit', description: 'Enemy art, character voices and sound effects, generated from the build tools and the Unity editor.', tools: ['image.paint', 'audio.voice', 'audio.sfx'] },
];

export function getPortfolio() {
  return { title: 'Built with Hawkes Gen', items: ITEMS };
}
