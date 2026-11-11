// One catalogue of every Hawkes game (GET /v1/catalogue; gallery.ts reads it for its featured list; the landing page's
// hero clip and cover row read it too). Media lives in public/catalogue/<id>/ (cover-16x9.webp, cover-1x1.webp,
// shot-1..6.webp, preview.webm, preview.mp4) and is made by tools/catalogue-media.mjs from real gameplay captures.
// A game's `captured` flag is true only once its files are committed: until then the answer carries no media urls, so
// nothing on a page points at a file that is not there.
import { route } from './http.ts';

export type CatalogueGame = {
  id: string; name: string; emoji: string; hook: string; genres: string[]; platforms: string[];
  /** Where it plays: a path on this site, or the game's own site. */
  url: string; playsHere: boolean; remix: boolean;
  /** The Overseer's templates are played at /play/t/<id>; the island at /play/sandbox. */
  captured: boolean; shots: number;
  /** Longer text, as the gallery has always shown it. */
  blurb: string;
  /** The page address: /games/<slug>. */
  slug: string;
  /** Which row of /games: the studio's own, or the Overseer's three. */
  row: 'original' | 'overseer';
  /** Three lines for the store page. */
  features: [string, string, string];
  controls: { keyboard: string[]; touch: string[] };
};

export const CATALOGUE: CatalogueGame[] = [
  { id: 'island', name: 'The Island', emoji: '🏝️', hook: 'You were just given free will. Take the 4x4 down to the dock.', genres: ['Sandbox', 'Adventure', 'Multiplayer'], platforms: ['web', 'phone'], url: '/play/sandbox', playsHere: true, remix: false, captured: false, shots: 5,
    blurb: 'The Overseer beams you onto a giant planet: an island, a 4x4, a boat, a fishing rod, barrels you should not stand near, and neighbours who are very glad you came.', slug: 'island', row: 'original', features: ['An island, a 4x4, a boat and a rocket, all yours to use', 'Talk to the Overseer and it builds what you ask, piece by piece', 'Invite a friend and walk the same island together'], controls: { keyboard: ['WASD to move, mouse to look', 'E to get in, use or pick up', 'Esc for the menu, T to talk to the Overseer'], touch: ['Left stick to move, drag to look', 'B to get in or use', 'Menu button for chat and settings'] } },
  { id: 'sickofit', name: 'Sick of It', emoji: '😈', hook: 'Chase the Overlord up 1,000 floors of Hell.', genres: ['Action', 'Platformer', 'Roguelite'], platforms: ['web', 'desktop'], url: '/play/sickofit', playsHere: true, remix: false, captured: false, shots: 5,
    blurb: 'A sarcastic nobody chases the Overlord up 1,000 floors of Hell. Dodge bullets, rewind time, free the diamonds.', slug: 'sickofit', row: 'original', features: ['1,000 floors of Hell, one sarcastic nobody', 'Dodge bullets and rewind time when it goes wrong', 'Free the diamonds and chase the Overlord to the top'], controls: { keyboard: ['A / D or arrows to run', 'Space to jump', 'R (hold) to rewind'], touch: ['Drag on the left to run', 'Tap the right to jump', 'Hold the rewind button'] } },
  { id: 'yooba-land', name: 'Yooba Land', emoji: '🌴', hook: 'A bright world to wander, with friends.', genres: ['Adventure', 'Family', 'Exploration'], platforms: ['web'], url: 'https://yoobalandgame.com', playsHere: false, remix: false, captured: false, shots: 4,
    blurb: 'Yooba Land, from the same studio, plays on its own site.', slug: 'yoobaland', row: 'original', features: ['A bright world to wander at your own pace', 'Explore with friends', "Plays in the browser on Yooba Land's own site"], controls: { keyboard: ['Keys and mouse as the game shows'], touch: ['Touch controls as the game shows'] } },
  { id: 'dose-of-destruction', name: 'Dose of Destruction', emoji: '💥', hook: 'Break everything, then break it again.', genres: ['Action', 'Destruction', 'Arcade'], platforms: ['web'], url: 'https://doseofdestruction.com', playsHere: false, remix: false, captured: false, shots: 4,
    blurb: 'Dose of Destruction, from the same studio, plays on its own site.', slug: 'dose-of-destruction', row: 'original', features: ['Break everything, then break it again', 'Quick arcade rounds', 'Plays in the browser on its own site'], controls: { keyboard: ['Keys and mouse as the game shows'], touch: ['Touch controls as the game shows'] } },
  { id: 'ph-origins', name: 'PH Origins', emoji: '🧪', hook: 'Where it all started.', genres: ['Adventure', 'Story', 'Puzzle'], platforms: ['web'], url: 'https://phorigins.com', playsHere: false, remix: false, captured: false, shots: 4,
    blurb: 'PH Origins, from the same studio, plays on its own site.', slug: 'ph-origins', row: 'original', features: ['Where it all started', 'A story with puzzles to solve', 'Plays in the browser on its own site'], controls: { keyboard: ['Keys and mouse as the game shows'], touch: ['Touch controls as the game shows'] } },
  { id: 'place-department', name: 'The Place Department', emoji: '🏢', hook: 'Somebody has to file the places.', genres: ['Adventure', 'Comedy', 'Action'], platforms: ['web', 'desktop'], url: 'https://theplacedepartment.com', playsHere: false, remix: false, captured: false, shots: 4,
    blurb: 'The Place Department, from the same studio, plays on its own site.', slug: 'place-department', row: 'original', features: ['Somebody has to file the places', 'Comedy and action behind the desk', 'Plays in the browser on its own site'], controls: { keyboard: ['Keys and mouse as the game shows'], touch: ['Touch controls as the game shows'] } },
  { id: 'fps-arena', name: 'Bot Arena', emoji: '🎯', hook: 'Clear 25 robots before dusk. Shoot the barrels.', genres: ['Shooter', 'Arena', 'First person'], platforms: ['web', 'desktop'], url: '/play/t/fps-arena', playsHere: true, remix: true, captured: false, shots: 5,
    blurb: 'A first-person arena on a far planet at dusk: robots beamed in by the Overseer, a shotgun, a rocket launcher on the tower, barrels that blow. Clear 25, three lives.', slug: 'fps-arena', row: 'overseer', features: ['25 robots beamed in at dusk, three lives', 'A shotgun, and a rocket launcher on the tower', 'Shoot the barrels and watch them blow'], controls: { keyboard: ['WASD to move, mouse to aim', 'Click to fire, R to reload', '1 and 2 to switch weapons'], touch: ['Left stick to move, drag to aim', 'Fire button to shoot', 'Tap a weapon to switch'] } },
  { id: 'sky-racer', name: 'Sky Racer', emoji: '🛩️', hook: 'Thread 24 glowing gates down a sunset valley.', genres: ['Racing', 'Flying', 'Time trial'], platforms: ['web', 'phone'], url: '/play/t/sky-racer', playsHere: true, remix: true, captured: false, shots: 5,
    blurb: 'Race a starship down a sunset valley through 24 glowing gates. Each gate buys time; boost with space, beat your best.', slug: 'sky-racer', row: 'overseer', features: ['24 glowing gates down a sunset valley', 'Each gate buys time', 'Boost, beat your best'], controls: { keyboard: ['W / S for speed, A / D to steer', 'Space to boost', 'Mouse to look'], touch: ['Tilt or drag to steer', 'Boost button', 'Tap to restart a run'] } },
  { id: 'platform-run', name: 'Leap', emoji: '🏃', hook: 'Climb from the village to the rocket before sunset.', genres: ['Platformer', 'Third person', 'Climb'], platforms: ['web', 'phone'], url: '/play/t/platform-run', playsHere: true, remix: true, captured: false, shots: 5,
    blurb: 'A third-person climb from a village to the Overseer\'s rocket before the sun sets: moving platforms, spikes, coins, gems and checkpoints.', slug: 'platform-run', row: 'overseer', features: ['Climb from the village to the rocket before sunset', 'Moving platforms, spikes, coins and gems', 'Checkpoints keep a fall cheap'], controls: { keyboard: ['WASD to move, mouse to look', 'Space to jump', 'Shift to run'], touch: ['Left stick to move, drag to look', 'Jump button', 'Tap a checkpoint flag to light it'] } },
];

const base = (id: string) => `/catalogue/${id}`;

/** A game as the API answers it. Media urls only for a captured game. */
export const catalogueEntry = (g: CatalogueGame) => ({
  id: g.id, name: g.name, emoji: g.emoji, hook: g.hook, genres: g.genres, platforms: g.platforms, url: g.url, slug: g.slug, page: `/games/${g.slug}`, row: g.row, blurb: g.blurb, features: g.features, controls: g.controls, playsHere: g.playsHere, remix: g.remix,
  ...(g.captured ? {
    cover: base(g.id) + '/cover-16x9.webp', coverSquare: base(g.id) + '/cover-1x1.webp',
    screenshots: Array.from({ length: g.shots }, (_, i) => `${base(g.id)}/shot-${i + 1}.webp`),
    preview: { webm: base(g.id) + '/preview.webm', mp4: base(g.id) + '/preview.mp4', poster: base(g.id) + '/cover-16x9.webp', seconds: 15, muted: true },
  } : {}),
});

export const catalogue = () => CATALOGUE.map(catalogueEntry);

route('GET', '/v1/catalogue', async () => ({ games: catalogue() }));
