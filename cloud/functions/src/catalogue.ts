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
};

export const CATALOGUE: CatalogueGame[] = [
  { id: 'island', name: 'The Island', emoji: '🏝️', hook: 'You were just given free will. Take the 4x4 down to the dock.', genres: ['Sandbox', 'Adventure', 'Multiplayer'], platforms: ['web', 'phone'], url: '/play/sandbox', playsHere: true, remix: false, captured: false, shots: 5,
    blurb: 'The Overseer beams you onto a giant planet: an island, a 4x4, a boat, a fishing rod, barrels you should not stand near, and neighbours who are very glad you came.' },
  { id: 'sickofit', name: 'Sick of It', emoji: '😈', hook: 'Chase the Overlord up 1,000 floors of Hell.', genres: ['Action', 'Platformer', 'Roguelite'], platforms: ['web', 'desktop'], url: '/play/sickofit', playsHere: true, remix: false, captured: false, shots: 5,
    blurb: 'A sarcastic nobody chases the Overlord up 1,000 floors of Hell. Dodge bullets, rewind time, free the diamonds.' },
  { id: 'yooba-land', name: 'Yooba Land', emoji: '🌴', hook: 'A bright world to wander, with friends.', genres: ['Adventure', 'Family', 'Exploration'], platforms: ['web'], url: 'https://yoobalandgame.com', playsHere: false, remix: false, captured: false, shots: 4,
    blurb: 'Yooba Land, from the same studio, plays on its own site.' },
  { id: 'dose-of-destruction', name: 'Dose of Destruction', emoji: '💥', hook: 'Break everything, then break it again.', genres: ['Action', 'Destruction', 'Arcade'], platforms: ['web'], url: 'https://doseofdestruction.com', playsHere: false, remix: false, captured: false, shots: 4,
    blurb: 'Dose of Destruction, from the same studio, plays on its own site.' },
  { id: 'ph-origins', name: 'PH Origins', emoji: '🧪', hook: 'Where it all started.', genres: ['Adventure', 'Story', 'Puzzle'], platforms: ['web'], url: 'https://phorigins.com', playsHere: false, remix: false, captured: false, shots: 4,
    blurb: 'PH Origins, from the same studio, plays on its own site.' },
  { id: 'place-department', name: 'The Place Department', emoji: '🏢', hook: 'Somebody has to file the places.', genres: ['Adventure', 'Comedy', 'Action'], platforms: ['web', 'desktop'], url: 'https://theplacedepartment.com', playsHere: false, remix: false, captured: false, shots: 4,
    blurb: 'The Place Department, from the same studio, plays on its own site.' },
  { id: 'fps-arena', name: 'Bot Arena', emoji: '🎯', hook: 'Clear 25 robots before dusk. Shoot the barrels.', genres: ['Shooter', 'Arena', 'First person'], platforms: ['web', 'desktop'], url: '/play/t/fps-arena', playsHere: true, remix: true, captured: false, shots: 5,
    blurb: 'A first-person arena on a far planet at dusk: robots beamed in by the Overseer, a shotgun, a rocket launcher on the tower, barrels that blow. Clear 25, three lives.' },
  { id: 'sky-racer', name: 'Sky Racer', emoji: '🛩️', hook: 'Thread 24 glowing gates down a sunset valley.', genres: ['Racing', 'Flying', 'Time trial'], platforms: ['web', 'phone'], url: '/play/t/sky-racer', playsHere: true, remix: true, captured: false, shots: 5,
    blurb: 'Race a starship down a sunset valley through 24 glowing gates. Each gate buys time; boost with space, beat your best.' },
  { id: 'platform-run', name: 'Leap', emoji: '🏃', hook: 'Climb from the village to the rocket before sunset.', genres: ['Platformer', 'Third person', 'Climb'], platforms: ['web', 'phone'], url: '/play/t/platform-run', playsHere: true, remix: true, captured: false, shots: 5,
    blurb: 'A third-person climb from a village to the Overseer\'s rocket before the sun sets: moving platforms, spikes, coins, gems and checkpoints.' },
];

const base = (id: string) => `/catalogue/${id}`;

/** A game as the API answers it. Media urls only for a captured game. */
export const catalogueEntry = (g: CatalogueGame) => ({
  id: g.id, name: g.name, emoji: g.emoji, hook: g.hook, genres: g.genres, platforms: g.platforms, url: g.url, playsHere: g.playsHere, remix: g.remix,
  ...(g.captured ? {
    cover: base(g.id) + '/cover-16x9.webp', coverSquare: base(g.id) + '/cover-1x1.webp',
    screenshots: Array.from({ length: g.shots }, (_, i) => `${base(g.id)}/shot-${i + 1}.webp`),
    preview: { webm: base(g.id) + '/preview.webm', mp4: base(g.id) + '/preview.mp4', poster: base(g.id) + '/cover-16x9.webp', seconds: 15, muted: true },
  } : {}),
});

export const catalogue = () => CATALOGUE.map(catalogueEntry);

route('GET', '/v1/catalogue', async () => ({ games: catalogue() }));
