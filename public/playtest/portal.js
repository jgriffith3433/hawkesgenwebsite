// Studio's playtest scenarios for the portal (contract v1: hawkesstudio/docs/playtest.md). Loaded by a tiny loader on
// the landing page and by play/guest.js on /play/sandbox, only for a browser under automation (navigator.webdriver), a
// `?playtest=` URL or a run already under way (sessionStorage), so a visitor never fetches it.
//
// `sandbox-first-minutes` plays the way a new player does, with real input (keys, clicks and the mouse into the game's
// own input layer; no teleporting): the landing page's Play click > the click-to-enter veil > the Overseer's intro (watch,
// then skip) > the mirror's three questions (a body, a look, a name) > the account sheet (a throwaway sign-up) > Pip's
// tour: walk to the 4x4, drive to the dock, take the rod off the pier and fish. Each stage is a `scene()` (a screenshot)
// and an `event()`; a stage that doesn't happen ends the run as stuck/error naming the stage.
//
// The page changes once (the Play click leaves the landing page for /play/sandbox): the run is kept in sessionStorage and
// the sandbox page carries it on, replaying the events so far, so one report covers the whole path.
//
// `island-race` plays the same way up to the account, then the Ridge Run: into the 4x4, through the start gate (the
// countdown and the clock), every gate in order by steering with the keys, the finish and the best, then once more with the
// ghost of the best run beside you. Options: laps (default 1: a named shortcut for the world's three), touch (the phone
// controls: /play/sandbox?touch=1), signup (as above), ghost: false (one run), watch.
//
// Options: { to: 'veil'|'intro'|'mirror'|'sheet'|'drive'|'fish' (stop after; default 'fish'), signup: false (never sign up;
//   always so on live), fish: 'strict' (a fishing failure fails the run; otherwise it is a warning), watch: seconds of the
//   intro to watch before skipping (default 8), at: 'sandbox' (start on /play/sandbox instead of clicking Play) }.
import { installPlaytest } from './hawkes-playtest.js';
import { SITE_LAYOUT, runSiteLayout } from './site-layout.js';
import { AVATAR_ANIMATIONS, runAvatarAnimations } from './avatar-animations.js';
import { COMMUNITY_LIBRARY, runCommunityLibrary } from './community-library.js';
import { STORE_PAGES, runStorePages } from './store-pages.js';
import { PROFILE_PAGE, runProfilePage } from './profile-page.js';
import { SICKOFIT_PAGE, runSickofitPage } from './sickofit-page.js';
import { LOADING_WRAPPER, runLoadingWrapper } from './loading-wrapper.js';
import { WORLD_REPORT, runWorldReport } from './world-report.js';
import { SERVER_LIMITS, runServerLimits } from './server-limits.js';
import { CHARACTER_MOTION, runCharacterMotion } from './character-motion.js';
import { WORLD_QUALITY, runWorldQuality } from './world-quality.js';
import { PHONE_HUD_LAYOUT, runPhoneHudLayout } from './phone-hud-layout.js';
import { GAME_MENU, runGameMenu } from './game-menu.js';
import { runHudOverlap } from './hud-overlap.js';
import { ISLAND_SOUNDSCAPE, runIslandSoundscape } from './island-soundscape.js';
import { ISLAND_MUSIC, runIslandMusic } from './island-music.js';
import { ISLAND_MIX, runIslandMix } from './island-mix.js';
import { OVERSEER_SOUND, runOverseerSound } from './overseer-sound.js';
import { ISLAND_LOOK, runIslandLook } from './island-look.js';
import { ISLAND_WIND, runIslandWind } from './island-wind.js';
import { ISLAND_WATER, runIslandWater } from './island-water.js';
import { ISLAND_ROUTINES, runIslandRoutines } from './island-routines.js';
import { ISLAND_ALIVE, runIslandAlive } from './island-alive.js';
import { LANDING_CAMERA_FEEL, runLandingCameraFeel } from './landing-camera-feel.js';
import { FIRST_LOAD, markPlayClick, runFirstLoad } from './first-load.js';

const KEY = 'hg_playtest_run';
const STAGES = ['landing', 'veil', 'intro', 'firstvisit', 'mirror', 'sheet', 'drive', 'fish', 'chapter', 'presence', 'observatory', 'wardrobe', 'race', 'board', 'journal', 'faces', 'alive', 'touch', 'phoneperf', 'feel', 'blast', 'leave', 'back', 'introc', 'arrivals', 'back2', 'asks', 'answer', 'progress', 'models', 'wish', 'toeditor', 'editor', 'react', 'motion', 'mirrorlayout', 'hudoverlap', 'soundscape', 'music', 'mix', 'ovsound', 'look', 'wind', 'water', 'routines', 'islandalive', 'firstload', 'gamemenu', 'landcam'];
// A scenario that is not simply the stages in order names its own (presence-who: the account, then the shared-world stage).
const ORDERS = { 'chapter-one-finale': ['landing', 'veil', 'intro', 'mirror', 'sheet', 'finale'], 'character-motion': ['landing', 'veil', 'intro', 'motion'], 'landing-camera-feel': ['landing', 'veil', 'intro', 'mirror', 'landcam'], 'island-soundscape': ['landing', 'veil', 'intro', 'mirror', 'soundscape'], 'island-music': ['landing', 'veil', 'intro', 'mirror', 'music'], 'island-mix': ['landing', 'veil', 'intro', 'mirror', 'mix'], 'overseer-sound': ['landing', 'veil', 'ovsound'], 'island-look': ['landing', 'veil', 'intro', 'mirror', 'look'], 'island-wind': ['landing', 'veil', 'intro', 'mirror', 'wind'], 'island-water': ['landing', 'veil', 'intro', 'mirror', 'water'], 'island-routines': ['landing', 'veil', 'intro', 'mirror', 'routines'], 'island-alive': ['landing', 'veil', 'intro', 'mirror', 'islandalive'], 'overseer-personality': ['landing', 'veil', 'intro', 'mirror', 'sheet', 'react'], 'overseer-first-visit': ['landing', 'veil', 'firstvisit'], 'overseer-ask': ['landing', 'veil', 'intro', 'mirror', 'sheet', 'answer'], 'gen-models-all': ['landing', 'veil', 'intro', 'mirror', 'sheet', 'models'], 'sandbox-daily-wish': ['landing', 'veil', 'intro', 'mirror', 'sheet', 'wish'], 'gen-hats': ['landing', 'veil', 'intro', 'mirror', 'sheet', 'hats'], 'gen-models-pilot': ['landing', 'veil', 'intro', 'mirror', 'sheet', 'models'], 'sandbox-progress': ['landing', 'veil', 'intro', 'mirror', 'sheet', 'progress'], 'observatory-wardrobe': ['landing', 'veil', 'intro', 'mirror', 'sheet', 'wardrobe'], 'sandbox-observatory': ['landing', 'veil', 'intro', 'mirror', 'sheet', 'observatory'], 'sandbox-travel-board': ['landing', 'veil', 'intro', 'mirror', 'sheet', 'board'], 'presence-who': ['landing', 'veil', 'intro', 'mirror', 'sheet', 'presence'], 'island-race': ['landing', 'veil', 'intro', 'mirror', 'sheet', 'race'], 'vehicle-feel': ['landing', 'veil', 'intro', 'mirror', 'sheet', 'feel'], 'rocket-blast-feel': ['landing', 'veil', 'intro', 'mirror', 'sheet', 'blast'], 'island-journal': ['landing', 'veil', 'intro', 'mirror', 'sheet', 'journal'], 'phone-performance': ['landing', 'veil', 'intro', 'mirror', 'sheet', 'phoneperf'], 'touch-controls': ['landing', 'veil', 'intro', 'mirror', 'sheet', 'touch'], 'faces-and-emotes': ['landing', 'veil', 'intro', 'mirror', 'sheet', 'faces'], 'ask-the-overseer': ['landing', 'veil', 'intro', 'mirror', 'sheet', 'asks'], 'editor-bridge': ['landing', 'veil', 'intro', 'mirror', 'sheet', 'toeditor', 'editor'], 'overseer-alive': ['landing', 'veil', 'intro', 'mirror', 'sheet', 'alive'], 'sandbox-return': ['landing', 'veil', 'intro', 'mirror', 'sheet', 'drive', 'leave', 'back'], 'mirror-panel-layout': ['landing', 'veil', 'intro', 'mirrorlayout'], 'hud-overlap': ['landing', 'veil', 'intro', 'hudoverlap'], 'island-arrivals': ['landing', 'veil', 'introc', 'mirror', 'sheet', 'arrivals', 'leave', 'back2'], 'game-menu': ['landing', 'veil', 'intro', 'mirror', 'gamemenu'] };
const SCENARIOS = [
  FIRST_LOAD, // Play click to the first frame and the first input, bytes before it, a clean WebGL console (first-load.js)
  LOADING_WRAPPER, // the loading wrapper on /play/sickofit (loading-wrapper.js)
  SICKOFIT_PAGE, // Sick of It's page before play (sickofit-page.js)
  SITE_LAYOUT, // the landing page at three sizes (site-layout.js)
  PHONE_HUD_LAYOUT, // phone HUD fold + mirror sheet at 390x844 and 844x390 (phone-hud-layout.js)
  GAME_MENU, // one Esc / one tap game menu with settings (game-menu.js)
  AVATAR_ANIMATIONS, // clips as data on /avatars (avatar-animations.js)
  STORE_PAGES, // the games page and store pages (store-pages.js)
  COMMUNITY_LIBRARY, // the library: cards, loading, empty, 390px, no timer fetch (community-library.js)
  PROFILE_PAGE, // the profile page: avatar, worlds, plan, empty states (profile-page.js)
  WORLD_REPORT, // report a world from its pause menu; a closed world loads nothing (world-report.js)
  SERVER_LIMITS, // sign-ins off the event loop, one play per reloads, the connection cap (server-limits.js)
  CHARACTER_MOTION, // jumps onto slopes and a walk to a run, traced frame by frame (character-motion.js)
  ISLAND_MUSIC, // area music, stingers, ducking (island-music.js)
  ISLAND_MIX, // the mix: buses, voice ducking, 3D placement, reverb zones, sliders, -16 LUFS (island-mix.js)
  OVERSEER_SOUND, // Overseer sound identity: treated voice, three motifs, beam hum rise (overseer-sound.js)
  ISLAND_WATER, // the sea: waves, foam, depth colour, floating props within 10 cm, the phone tier (island-water.js)
  ISLAND_WIND, // the wind and wildlife: gusts, gulls that scatter, fireflies at night, the phone tier (island-wind.js)
  ISLAND_LOOK, // the light stack: cascaded shadows, ACES, bloom, four grades, phone fps (island-look.js)
  ISLAND_SOUNDSCAPE, // ambience beds, footsteps by surface, interaction SFX, mute (island-soundscape.js)
  LANDING_CAMERA_FEEL, // landing dust/squash/sound/dip + camera-in-geometry walk (landing-camera-feel.js)
  ISLAND_ALIVE, // barks within 6 m, no 10 s of quiet on a beach-path-pier walk (island-alive.js)
  ISLAND_ROUTINES, // clock-driven islander spots, face the player, no clip (island-routines.js)
  WORLD_QUALITY, // quality rules 1 to 4 on a world: ground contact, backwards words, z-fighting, inside out (world-quality.js)
  {
    id: 'overseer-first-visit', title: 'The Overseer\'s first-visit introduction: the player moves within 5 s, captioned voiced lines, a tap or key skips it, a guest ends at the mirror; a return skips it', seconds: 90, tags: ['full'], starts: ['sandbox'],
    description: 'options: touch (true: ?touch=1 and at: "sandbox"; the stick and a tap), skipAfter (seconds before the skip, 8.5). Landing, Play click, the click-to-enter veil, then the first move (first-move: real W or stick input, within 5000 ms of intro-start; control-given), each line captioned with the Overseer\'s name in the letterbox bar or on a phone plate (intro-caption, clear of the controls) and voiced (intro-voice), one key or tap skipping the rest (skip-control-back: control and the camera behind the player), a guest then at the mirror with no first-thing card (mirror-open-after-intro, no-ask-card); signed in, the card that starts building (build-prompt-shown, build-prompt-used). The old scenario watched to the end with no key pressed: the Overseer\'s lines (overseer-said, greeting-lines needs three or more), then the card that starts building (build-prompt-shown) and a real click on it opens the chat to the Overseer (build-prompt-used); the intro\'s flag is kept and the intro is no longer wanted (return-skips-intro). Sign-in and credits are not touched. Never signs up.',
  },
  { id: 'smoke', title: 'Landing, Play click, the veil, the intro skipped', seconds: 50, tags: ['smoke'], description: 'options: none' },
  {
    id: 'overseer-ask', title: 'Ask the Overseer: an answer shows in the chat within 90 s; a failed or silent ask is a plain message with Retry and no spinner; the next ask works at once', seconds: 480, tags: ['full'],
    starts: ['sandbox'],
    description: 'the first-minutes path to the account sheet (a browser already signed in to Google: the sheet is Google only), then a question typed in the chat (answer-shown, work-ended), one ask answered 503 by a named shortcut (failure-plain-message, retry-shown, no-spinner), one ask the server never hears of (a named shortcut: the page is told 200 and nothing ever comes back) that must end in a plain message with Retry within 75 s, nothing spinning (silent-ask-ends; J 2026-11-10: "it just thinks forever"), and a real click on Retry (next-ask-immediate, retry-answered). Every answer must come within 90 s (answer-time), or the run fails. First, a build request ("add a red cube") must add a new thing to the world (world-changed), not only a chat message. Options: watch (seconds of intro to watch), name, what',
  },
  {
    id: 'sandbox-first-minutes', title: 'Play /play/sandbox as a new player: veil, intro, mirror, sign-up, drive to the dock, fish', seconds: 210, tags: ['full'],
    starts: ['sandbox'],
    description: 'options: to (veil, intro, mirror, sheet, drive, fish), signup (false: never sign up; always off on live), fish ("strict": a fishing failure fails the run), watch (seconds of intro to watch), at ("sandbox")',
  },
  {
    id: 'sandbox-pier-marker', title: 'Pip shows the pier: cinematic fly to the rod, glowing marker from the beach, pickup clears it', seconds: 180, tags: ['full'],
    starts: ['sandbox'],
    description: 'veil, intro, mirror, then a named setup shortcut lifts the account gate (Google-only sign-up cannot finish a throwaway account); Pip\'s pier beat plays: one short line, the camera flies from Pip along Gravel Road and holds on the rod (pier-cinematic, scene Pier: cinematic hold), the glowing marker stays on (rod-marker on); from the beach the marker is visible (scene Pier: marker from beach, and with touch:1 the phone frame); walking out the pier and picking up the rod clears the marker with a sound and burst (rod-marker off, pier-show cleared). Options: touch (true: ?touch=1), watch',
  },
  {
    id: 'island-race', title: 'The Ridge Run: through the start gate, the countdown, every gate in order, the finish and best time, then the ghost of the best run', seconds: 330, tags: ['full'],
    starts: ['sandbox'],
    description: 'options: laps (default 1; the world has 3), touch (true: the phone controls, ?touch=1, and the frame rate is measured), ghost (false: one run only), signup (false: stop at the account sheet; always on live), watch (seconds of intro to watch), name, what',
  },
  {
    id: 'vehicle-feel', title: 'Game feel in the 4x4: the view widens, the body leans, dust, the engine climbs, the handbrake drift squeals, a landing dips the view; then the effects by surface (road dust, sand plume and tracks, grass bits, shallows spray), headlights at dusk, and the helicopter\'s downwash over grass and sea', seconds: 480, tags: ['full'],
    starts: ['sandbox'],
    description: 'the first-minutes path to the account sheet, then the 4x4 driven with real keys or, with touch: true, the stick (straight, bends, handbrake) and one named jump shortcut, then across road, sand, shallows and meadow (surface-switch, wheel-effect, tracks-on-sand, tracks-faded, surfaces-driven; surfaceDriveFps) with the headlights at dusk (headlights-on, brake-lights, a named clock shortcut) and, on a computer, the helicopter low over grass and sea (rotor-blur, downwash-ring-grass, spray-disc-sea); logs fov-widened, engine-pitch, dust, body-roll, drift-squeal, landing and the frame rate (driveFps). Options: touch (true: the phone controls, ?touch=1, and under 30 fps is a problem), signup (false: stop at the account sheet; always on live), watch',
  },
  {
    id: 'rocket-blast-feel', title: 'Game feel of the rocket launcher: recoil and muzzle flash, a smoke trail, hit-stop, shake, a shockwave, debris and embers, and ten barrels that explode in a rolling chain (30 fps on the phone tier)', seconds: 300, tags: ['full'],
    starts: ['sandbox'],
    description: 'the first-minutes path to the account sheet, then the rocket launcher fired with a real click at the fuel barrels on the beach (five more spawned beside them by one named shortcut, so ten), walking closer and firing again until they go; logs launcher-recoil, rocket-trail, blast-effects (hit-stop, shake, shockwave, debris, embers), chain-rolling (the gaps between the ten explosions: not all at once) and chain-fps (metric chainFps, chainWorstFrameMs). Options: touch (true: the phone controls, ?touch=1, and under 30 fps is a problem), signup (false: stop at the account sheet; always on live), watch',
  },
  {
    id: 'phone-performance', title: 'Phone performance: driving and ten exploding barrels on the island hold 30 fps with touch controls, no long freeze, and the stick and buttons answer throughout', seconds: 300, tags: ['full'],
    starts: ['sandbox'],
    description: 'opens /play/sandbox?touch=1, plays the first minutes to the account sheet, then with touch pointers only: the stick walks to the 4x4, B gets in, the stick steers and A brakes while frames are counted (driveFps, driveWorstFrameMs, driveFreezes; the 4x4 must move and turn: touch-steer-responds, touch-brake-responds); then the rocket launcher is put in hand and five more barrels spawned (one named setup-shortcut), the drag turns the camera to the barrels, the stick walks near, FIRE is tapped until the chain goes (touch-fire-responds) while frames are counted (blastFps, blastWorstFrameMs, blastFreezes). Under 30 fps average, or any frame over 500 ms, is an error. Run at 390x844 (and 844x390). Options: signup (false: stop at the account sheet; always on live)',
  },
  {
    id: 'touch-controls', title: 'Every tour action with touch alone (stick, look drag, jump, B, steer, brake, fish, tools, spawn wheel, helicopter and rocket flight, Stuck?, hide the HUD): no overlaps, buttons 48 px or more, inside the safe area', seconds: 420, tags: ['full'],
    starts: ['sandbox'],
    description: 'opens /play/sandbox?touch=1 (the phone controls), plays the first minutes to the account sheet, then uses only pointer events of type touch on the stick, the buttons and the game; at every step H.touchLayout.audit() measures the real page and logs a touch-audit event (a failing audit is an error). Run it at 390x844 and again at 844x390: the browser\'s size is what is judged, the other orientation by the layout math. The helicopter and rocket are reached by named setup shortcuts. options as sandbox-first-minutes (the defaults here: at "sandbox", touch true)',
  },
  {
    id: 'editor-bridge', title: 'What a game may ask the editor: 50 generate messages show one priced card and make nothing until Make it; ask messages only fill the chat box; building and saving still work; Overseer lines with foreign links are plain text; a game script cannot fetch an outside site (the page\'s policy); the editor opens the share window for a game', seconds: 300, tags: ['full'],
    starts: ['sandbox'],
    description: 'the first-minutes path through the throwaway sign-up (never on live), then Build: a new game in the editor (/app/g/<id>). A game script is stood in for by 50 generate and 50 ask messages delivered to the editor as from its frame (a named setup-shortcut: the frame is sandboxed, so the page cannot run code in it). Logs gen-card-shown (one card, the price and balance on it), no-generate-request (nothing sent to /generate by the 50), gen-card-made (after a real click on Make it: exactly one request), ask-filled-chat and no-ai-request, ops-and-save-work (a world edit reaches /scene and Save /save), foreign-links-plain and own-link-kept (Overseer lines whose link is another site, javascript:, //host, a backslash or data: show no link; a path on this site stays one), fetch-blocked (a script file sent into the real sandboxed frame fetches https://example.com: the page\'s Content-Security-Policy refuses it and the frame reports the violation, which the browser also logs in the console), share-window-opened and share-media-delivered (the game cannot open the share window itself: the editor opens /share/new and carries the photo; the window is a hidden-frame stand-in). options as sandbox-first-minutes',
  },
  {
    id: 'ask-the-overseer', title: 'After the sign-up: the Overseer says the real balance, offers three priced asks to tap, and an empty balance gets Get credits', seconds: 200, tags: ['full'],
    starts: ['sandbox'],
    description: 'the first-minutes path through the throwaway sign-up (never on live), then, in the chat with no reload: the Overseer\'s line carries the balance /v1/users/me reports; three example asks are offered, each with its price (the quote) and a Send; nothing is spent before a click; a real click sends one. The empty balance is a named setup shortcut (the game told the balance is 0): the Overseer says so with a Get credits link and no request is made. options as sandbox-first-minutes',
  },
  {
    id: 'hud-overlap', title: 'No HUD control overlaps another, leaves the screen or is too small to tap, with the mirror panel and the Overseer chat opened and closed', seconds: 120, tags: ['full'],
    starts: ['sandbox'],
    description: 'the intro is skipped, then at each step (mirror open, mirror closed, chat open, chat closed) every visible HUD control (buttons, links, inputs) is measured after the open/close transition ends (transitionend, no polling) and a screenshot is taken. Events hud-no-overlap, hud-in-viewport and hud-tap-targets pass or fail per step; a failure names the two controls (or the one). Runs itself at 1280x720, 390x844 and 844x390 (an iframe of each size, a screenshot per step)',
  },
  {
    id: 'mirror-panel-layout', title: 'The HUD makes room for the mirror panel: the quest banner and the action row stay whole beside it, and glide back when it closes', seconds: 120, tags: ['full'],
    starts: ['sandbox'],
    description: 'the landing page, the veil and the intro (skipped), then the mirror opens by itself: with it open the quest banner, its buttons and the top-right actions (Save this world, Build your own, Copy invite link...) are measured whole, on screen, clear of the panel and not covered; a screenshot; the mirror is closed with Esc and they must be back where they were, moving there by a transition (a mid-way sample), not a jump. Screenshots at the window size (1280x720 and 1440x900 are the sizes to run). No timers in the page: the layout reacts to the panel and to resize only',
  },
  {
    id: 'sandbox-progress', title: 'Progress: points in the HUD for driving, a level with the Overseer\'s moment, the unlocks in the wardrobe and on the tool belt, kept after a return', seconds: 300, tags: ['full'],
    starts: ['sandbox'],
    description: 'the first-minutes path to the account sheet, then real input: walk to the 4x4, E, W held (points for the first drive and the meters in the HUD); the points of a few quests are earned by a named setup shortcut (the same table), a level-up gives goggles and a color (the wardrobe) and at level 4 the grenades (the tool belt), each with the Overseer\'s moment; the Overseer\'s memory re-read from the device (a named shortcut) shows them kept. options as sandbox-first-minutes',
  },
  {
    id: 'sandbox-daily-wish', title: 'The daily wish: one wish a day in the HUD and spoken once, points and a line when done, a streak across days that resets quietly after a missed one', seconds: 240, tags: ['full'],
    starts: ['sandbox'],
    description: 'the first-minutes path to the account sheet, then the Overseer\'s wish for today (the same for everyone: chosen by the UTC date): it is in the HUD and was spoken once (wish-hud, wish-spoken); finishing it is a named setup shortcut (the events that wish names are fed to the game), then the points and the Overseer\'s short line (wish-done, overseer-said) and the streak at 1. Days passing is a named setup shortcut (the wish\'s clock moved one day, then three): the next day shows the streak at 2 once the wish is done; after the skipped days the streak is gone from the HUD with nothing said about it (streak-reset-quiet) and the next wish begins it again at 1. options as sandbox-first-minutes',
  },
  {
    id: 'island-journal', title: 'The journal: opened from its button (desktop, or the phone at 390x844), the eight quests, the neighbours met, four lore items found on the island and read in it, and kept after a return', seconds: 300, tags: ['full'],
    starts: ['sandbox'],
    description: 'the first-minutes path to the account sheet, then the journal with real input (a click on the book button, walking to the lamp, the beach chair, the faded drawing and the scratched rock, E at each); the return is the Overseer\'s memory read back from this device (a named setup shortcut). options as sandbox-first-minutes, plus touch (true: the phone controls, ?touch=1)',
  },
  {
    id: 'sandbox-chapter-one', title: 'Chapter One "What Are You?": the eight quests to the launch pad, the lit bay and the two closing lines', seconds: 420, tags: ['full'],
    starts: ['sandbox'],
    description: 'the first-minutes path, then quests 6 (walk up to Dolores) and 8 (Rolo\'s rocket) with real input; quests 4, 5 and 7 are named setup shortcuts (the quest line advanced); options as sandbox-first-minutes, plus rocket ("shortcut": skip the climb)',
  },
  {
    id: 'chapter-one-finale', title: 'The end of Chapter One: the hangar opens, the islanders gather and speak, the Overseer pays off its first words, the player lights the sky, the title and the tease', seconds: 300, tags: ['full'],
    starts: ['sandbox'],
    description: 'the first-minutes path to the account sheet, then the quest line to the rocket quest\'s end and docking (named setup shortcuts), then the finale (src/overseer-games/finale.js): doors open (finale-doors-open), the voiced lines with captions (finale-line, clip), control back and the player\'s own act (finale-input, a tap on the big button with touch: true), the title (finale-title), the tease (finale-tease) and control back within 2 s (finale-control-returned); with touch: true (390x844) the non-playable shots are skipped with one tap (finale-skip). Option skip (true: tap-skip the shots on any device)',
  },
  {
    id: 'sandbox-observatory', title: 'Docking, the lift to the Observatory: the first arrival (windows, music, the pearl, a gift by name), the quick return, and the way back to the bay', seconds: 330, tags: ['full'],
    starts: ['sandbox'],
    description: 'the first-minutes path to the sign-up sheet, then the Observatory with real input (E at the lift, walking in the room, E again); docking itself is a named setup shortcut (the rocket put on the pad, the player beside the lift); options as sandbox-first-minutes, plus again (false: skip the quick return)',
  },
  {
    id: 'observatory-wardrobe', title: 'The Observatory mirror and wardrobe: redo the three questions at the mirror, browse and wear what you own with a live preview, ask the Overseer for more (the price shown first); kept and sent to the room; with touch too', seconds: 420, tags: ['full'],
    starts: ['sandbox'],
    description: 'the first-minutes path to the sign-up sheet, then docking (a named setup shortcut) and the lift; in the room, a named walk to the mirror, then E ("Change who you are") and the three questions answered again (the look and name change); a named walk to the wardrobe, E, the panel (the accessories and colors owned, every button 48 px or more, the price of a message to the Overseer), a different accessory and color tapped on (the look changes at once; the account holds it: look-kept), Put it back, Done. options as sandbox-first-minutes, plus touch (true: ?touch=1, taps as touch pointers)',
  },
  {
    id: 'sandbox-travel-board', title: 'The Observatory travel board: three featured games as planets with live counts; beam down into each with your character and name, and Return to the Observatory from its pause menu', seconds: 600, tags: ['full'],
    starts: ['sandbox'],
    description: 'the first-minutes path to the sign-up sheet, then docking (a named setup shortcut) and the lift; at the board it checks the three planets and their live counts, stands under each (a named setup shortcut: the walk across the room) and presses E; the Overseer speaks, the screen fades and the game page opens (a page change: the run crosses it) where it checks the character and name arrived, presses Esc twice, clicks Return to the Observatory and checks it stands at the board again; for all three games. options as sandbox-first-minutes, plus games (a list of ids to visit; default all three)',
  },
  {
    id: 'island-arrivals', title: 'Things arrive in a beam: the island cascades in after the intro on a first visit, undo of a delete beams the thing back, a player who joins is beamed in with their name; on a second visit everything is just there', seconds: 330, tags: ['full'],
    starts: ['sandbox'],
    description: 'first visit: veil, intro (skipped after a few seconds), then the six main things (Pip, the hut, the 4x4, the boat, the helicopter, the rocket) are watched beaming in one after another (cascade-beam events); the mirror and the throwaway sign-up; then building (Tab), a delete (named setup shortcut) and Ctrl+Z (real keys): undo-beam; a second player joining (named setup shortcut: presence.standIn with joined) is beamed in with its name, seen from the first player (joined-beam, joined-name). Then /play/sandbox is opened again with the same storage: no cascade, everything is there at once (just-there). Options: watch.',
  },
  {
    id: 'island-invite', title: 'Invite a friend: the button and pause menu give a link; the friend arrives beside the inviter, who sees the beam, the name and an Overseer line; a closed island says so kindly and offers their own', seconds: 240, tags: ['full'],
    starts: ['sandbox'],
    description: 'the first-minutes path to the account sheet (a throwaway sign-up, never on live), then the Invite button (a real click: the link, its ?invite= and ?ref=), the pause menu (Esc twice) offering it too, the invitation read back (open); the friend is a named setup-shortcut socket in the room (the friend\'s own page, its mirror and sheet, is covered by the engine and relay tests), and the inviter must show the beam (joined), the name over the newcomer and the Overseer\'s "Someone is coming."; then the friend\'s page is opened on an island nobody is on (closed): the message and "Start my own island" (a real click). Full and expired links are the tests\' (test/invite.test.ts).',
  },
  {
    id: 'island-invite-friend', title: 'The friend\'s browser: opens an invitation signed out (no cookie, a second browser context), is beamed in beside the inviter, or is told kindly that the island is closed, full or out of date', seconds: 150, tags: ['full'],
    description: 'Run in its OWN browser context, at the same time as island-invite with {"friend":"browser"} (which publishes the link in its invite-link event). options: link (the invitation address; the path and query are opened on this origin), expect ("open" by default; "closed", "full" or "expired" check the friendly card instead), name (the mirror name), what. Signed out: it opens the link, checks the invitation was read (no 401), plays the short intro and the mirror with real input, and must be beamed in next to the inviter (friend-beamed, within 6 m, the Overseer\'s "<name> is here. Go to them."). With expect set it checks the card\'s reason and clicks Start my own island.',
  },
  {
    id: 'share-moment', title: 'Share this moment: a big explosion offers a chip (not in the first minute of the tour), one tap keeps the last 8 s, a guest is taken to the sign-up sheet and comes back to the same moment, and the link opens a page with the character, the Overseer\'s line and a card image', seconds: 420, tags: ['full'],
    starts: ['sandbox'],
    description: 'the first-minutes path to the account sheet (a throwaway sign-up, never on live), then Share this moment (modules/share/moments.js): the rocket launcher in hand (named setup-shortcut) and a blast at fuel barrels with real input within the first minute of the tour: no chip (chip-held-back); after the minute another blast: the chip appears (chip-shown); the player is signed out first (a named setup-shortcut: a guest) and taps the chip (a real click): the account sheet opens for it (sheet-for-share), signs back in with the throwaway account, closes, and the chip is the same moment still (same-moment) and becomes the link (share-link). The link\'s page (share-page) has the character\'s name and the Overseer\'s line and its Open Graph card has an image that loads (og-image); the page is shown in a frame for the screenshot.',
  },
  {
    id: 'sandbox-return', title: 'A second visit: no intro and no mirror, beamed in and welcomed back by name, the tour where it stopped', seconds: 330, tags: ['full'],
    starts: ['sandbox'],
    description: 'the first visit as a new player (veil, intro, mirror, account sheet with a throwaway sign-up, then driving to the dock: the tour is on its second step), in that order; then the page is opened again as a returning player would (the same browser storage). It checks that the intro and the mirror do not play, that the player is beamed in and the Overseer says "Welcome back, <name>", and that Pip\'s tour is on the step it was left on (not the first). Never on live (no sign-up there). options as sandbox-first-minutes',
  },
  {
    id: 'overseer-personality', title: 'The Overseer\'s personality while you build: a thinking line that changes while it works, then varied in-character lines for what it built, what failed and a quiet moment, never the same twice in a row', seconds: 240, tags: ['full'],
    starts: ['sandbox'],
    description: 'the first-minutes path to the account sheet, then the Overseer\'s reactions (modules/overseer/reactions.js): the line pools are counted (reaction-variants: build, fail and idle each ten or more); a request is started the way asking does (a named setup shortcut, since asking spends credits and sign-in is Google only) and the work pill\'s headline is watched for several seconds (thinking-shown: it changes, never the same twice in a row); the request ends well three times and fails three times (reaction-build, reaction-fail, each spoken in the chat); the idle wait is shortened by a named shortcut and two idle lines are heard. no-repeat checks that no line of a kind equals the one before it. options as sandbox-first-minutes',
  },
  {
    id: 'overseer-alive', title: 'The Overseer is alive: halo and rings answer its voice, the emitter flares before a beam, the bay turns to a question, the hum rises as the player climbs, and the frame cost is unchanged', seconds: 240, tags: ['full'],
    starts: ['sandbox'],
    description: 'the first-minutes path to the account sheet, then the sky is watched (a screenshot each): quiet, a spoken line (halo brighter, rings quicker, for the length of the line), a message to the Overseer typed in the chat (the bay turns), a beam (the emitter flares, the shaft opens a moment later), and the hum on the ground (silent) and at four heights (rising). Named setup shortcuts: the Overseer is asked for a line, the beam is sent, the player is held at each height. Logs overseer-presence samples and perf-compare (draw calls and frame ms quiet vs. active). options as sandbox-first-minutes',
  },
  {
    id: 'faces-and-emotes', title: 'Faces and emotes: the character blinks, looks at the Overseer when it speaks, changes expression on a hard landing and an explosion; the six emotes from the radial wheel (desktop or touch), seen by another player', seconds: 240, tags: ['full'],
    starts: ['sandbox'],
    description: 'the first-minutes path to the island (a throwaway sign-up, never on live), then: blinks counted over a few seconds; the Overseer asked to say a line (named setup shortcut) and the gaze checked; a drop from height (named setup shortcut: the player lifted, the fall and landing are the game\'s) and a blast beside the player (named setup shortcut) with the face read each time; then the emote wheel opened from its button and the six emotes (wave, laugh, cheer, shrug, dance, point) clicked, each checked on the player and on a stand-in second player (presence.standIn; the remote emote handed to the same handler a real peer\'s message uses). options as sandbox-first-minutes, plus touch (true: ?touch=1, taps as touch pointers)',
  },
  {
    id: 'gen-hats', title: 'The Gen hats: each hat in the mirror is a Gen model on the head of the person, a dog and a shoe, moving with the head, recoloured by the colour pick, within the triangle budget', seconds: 300, tags: ['full'],
    starts: ['sandbox'],
    description: 'the first-minutes path to the island (a throwaway sign-up, never on live), then for each hat with a model in the registry (HawkesPlay.presence.hatRegistry) on each of person, dog and shoe (the look changed through presence.setLook, as the mirror does): the Gen model is worn (not the procedural hat), parented to the head anchor, at most 1.8k triangles; a real walk and jump with the hat staying on the head; the colour pick (accent) changing the colour of a tinted hat. A hat with no model yet is logged as procedural.',
  },
  {
    id: 'gen-models-pilot', title: 'The pilot Gen models: person, dog and shoe as the character, at real height, walking, running, jumping and emoting, each in a top hat and a cap', seconds: 330, tags: ['full'],
    starts: ['sandbox'],
    description: 'the first-minutes path to the island (a throwaway sign-up, never on live), then for each of person, dog, shoe (the look changed through presence.setLook, as the mirror does) and each of tophat and cap: the Gen model is on the rig (not the procedural body), its height matches the registry row, the hat anchor sits at the top of the model, the near level is within 8,000 triangles and there is a low level; then real keys walk, run (shift), jump and an emote with the hat on, a screenshot each. A failed load is the procedural body (reported). options as sandbox-first-minutes',
  },
  {
    id: 'gen-models-all', title: 'Every Gen model (all 26 types): real height, hat on the head, walk/run/jump/emote, and the procedural fallback listed', seconds: 900, tags: ['full'],
    starts: ['sandbox'],
    description: 'as gen-models-pilot, but for every type of the registry (a row with no model is reported as the procedural body, not a failure); then ten different models put in view at once (setup shortcut, presence.standIn) with the crowd tools read for draw calls, triangles and fps. options as sandbox-first-minutes',
  },
  {
    id: 'presence-who', title: 'A shared world: who is there (list, marker or edge arrow), tap a name to beam next to them, mute, an abusive name replaced', seconds: 230, tags: ['full'],
    starts: ['sandbox'],
    description: 'Plays the first minutes to the island (a throwaway sign-up, never on live), then puts two stand-in players in the room (a second browser is not needed: presence.standIn, one far ahead, one behind with an abusive name) and plays the shared-world part with real clicks. options: signup (false: never sign up; always off on live), name, what',
  },
];

const onSandbox = () => /^\/play\/sandbox\/?$/.test(location.pathname);
const onGame = () => /^\/play\/t\/[a-z0-9-]+\/?$/.test(location.pathname) && /[?&]from=observatory\b/.test(location.search);
const onEditor = () => /^\/app\/g\/g_[0-9a-f]+\/?$/.test(location.pathname);
const isLive = () => /^(www\.)?hawkesgen\.ai$/.test(location.hostname);
const HP = () => window.HawkesPlay;
const W = () => HP() && HP().world;
const G = () => HP() && HP().game;
const $ = (s, r = document) => r.querySelector(s);
const rand = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join('');
const readRun = () => { try { return JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch { return null; } };
const writeRun = (r) => { try { r ? sessionStorage.setItem(KEY, JSON.stringify(r)) : sessionStorage.removeItem(KEY); } catch { /* private mode: the run just can't cross the page */ } };

// ---------------------------------------------------------------------------------------------- real input
const down = new Set();
const keyEv = (type, key) => window.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, cancelable: true }));
function setKeys(want) { // { w: true, a: false... }: presses and releases to match
  for (const k of ['w', 'a', 's', 'd']) {
    if (want[k] && !down.has(k)) { down.add(k); keyEv('keydown', k); }
    if (!want[k] && down.has(k)) { down.delete(k); keyEv('keyup', k); }
  }
}
const releaseAll = () => { setKeys({}); for (const k of [...down]) { down.delete(k); keyEv('keyup', k); } };
async function tap(t, key, ms = 90) { keyEv('keydown', key); await t.wait(ms); keyEv('keyup', key); }
const canvas = () => $('canvas#c, canvas') || document.querySelector('canvas');
function pointer(type, target, o = {}) {
  target.dispatchEvent(new PointerEvent(type, { pointerType: 'mouse', pointerId: 1, isPrimary: true, bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: innerWidth / 2, clientY: innerHeight / 2, ...o }));
}
async function holdMouse(t, ms) { pointer('pointerdown', canvas()); await t.wait(ms); pointer('pointerup', window); }
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const camYaw = () => { try { const y = W().camera.yawNow(); return Number.isFinite(y) ? y : 0; } catch { return 0; } };

/** Turns the camera to `yaw` (radians from +z toward +x) by dragging with the right button, as a player does. The first
 *  drags learn which way the mouse turns it. */
async function lookAt(t, yaw) {
  let sign = 1, last = null, tries = 0;
  while (Math.abs(wrap(yaw - camYaw())) > 0.35) {
    if (++tries > 40) throw new Error('timed out turning the camera');
    const err = wrap(yaw - camYaw());
    if (last !== null && Math.abs(err) > Math.abs(last) + 0.02) sign = -sign; // it got worse: the other way
    last = err;
    const c = canvas();
    pointer('pointerdown', c, { button: 2, buttons: 2 });
    c.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'mouse', pointerId: 1, bubbles: true, buttons: 2, movementX: Math.sign(err) * sign * Math.min(120, Math.abs(err) * 160), movementY: 0 }));
    await t.wait(120);
    pointer('pointerup', window, { button: 2 });
    await t.wait(120);
  }
}

/** Walks (W/A/S/D relative to the camera, like a player) until within `near` metres of a thing. */
async function walkTo(t, id, near, timeoutMs, what) {
  const t0 = performance.now();
  for (;;) {
    const p = W() && W().player, g = W() && W().byId.get(id);
    if (!p || !g) throw new Error(`timed out waiting for ${what} to exist`);
    const dx = g.x - p.x, dz = g.z - p.z, d = Math.hypot(dx, dz);
    if (d <= near) break;
    if (performance.now() - t0 > timeoutMs) throw new Error(`timed out walking to ${what} (${Math.round(d)} m away after ${Math.round(timeoutMs / 1000)} s)`);
    const yaw = camYaw(), s = Math.sin(yaw), c = Math.cos(yaw);
    const ax = (dx * c - dz * s) / d, ay = (dx * s + dz * c) / d; // the inverse of game.input.direction()
    setKeys({ w: ay > 0.38, s: ay < -0.38, d: ax > 0.38, a: ax < -0.38 });
    await t.wait(80);
  }
  setKeys({});
}

// ---------------------------------------------------------------------------------------------- playtest hooks
/** The playtest-only hooks (docs: AGENTS.md "Playtest hooks"; `window.hawkesPlaytest.hooks`). Each one calls the engine's own
 *  path and leaves its own events to fire (`explosion`, the vehicle's `enter`, `docked-pad`, `catch`), so what a scenario
 *  checks afterwards is the game's. They exist only here, in the script a browser under automation loads (never a visitor),
 *  and they refuse on live (`isLive`): a named `setup-shortcut` event says what was done. Every one fails with a message
 *  that says what was missing, so the stage that breaks is named. */
const HOOKS = {
  /** A blast at the player's feet or `ahead` metres in front of the camera (default 6): the engine's own mayhem.explode, so the
   *  physics 'explosion' event and game.on('explosion') fire as for a rocket. Big by the share module's rule (radius 8). */
  explode(t, o = {}) {
    HOOKS.allowed('explode');
    const P = W() && W().player;
    if (!P || !G() || !G().mayhem || !G().mayhem.explode) throw new Error('hook explode: the island or the mayhem module is not ready');
    const yaw = camYaw(), d = o.ahead ?? 6;
    const at = [P.x + Math.sin(yaw) * d, P.y, P.z + Math.cos(yaw) * d];
    G().mayhem.explode(at, { radius: o.radius ?? 8, force: o.force ?? 24, damage: o.damage ?? 30, fire: false });
    t.event('setup-shortcut', `a blast set off ${d} m ahead of the player (the engine's own explosion)`);
  },
  /** Gets the player into a vehicle by id (the engine's own enter, as E does): waits for it to be there, then for the drive. */
  async enterVehicle(t, id, o = {}) {
    HOOKS.allowed('enterVehicle');
    const V = HP() && HP().vehicles;
    await t.until(() => W() && W().player && W().byId.get(id) && V && V.enter, 30000, `hook enterVehicle: the vehicle "${id}" to exist`);
    if (G().player.controller === 'drive' && V.current && V.current.sceneId === id) return;
    V.enter(W().byId.get(id), o);
    await t.until(() => G().player.controller === 'drive', 8000, `hook enterVehicle: the player to be driving the "${id}"`);
    t.event('setup-shortcut', `the player put in the ${id} by the engine's own enter (E did not reach it)`);
  },
  /** Docks the rocket by the game's own dock path (waits for the hangar). */
  async dock(t, id = 'rocket') {
    HOOKS.allowed('dock');
    await t.until(() => HP().overseer && HP().overseer.dockShip && G() && G().entity(id) && W().player, 30000, 'hook dock: the hangar and the rocket to exist');
    dockRocket(t);
    await t.until(() => HP().overseer.observatory && HP().overseer.observatory.state === 'bay', 10000, 'hook dock: the bay (the player on foot beside the pad)');
  },
  /** A fish caught: water.fish.give (the log, the card and the 'catch' event, as a landed fish does). */
  catchFish(t, species = 'trout') {
    HOOKS.allowed('catchFish');
    const f = G() && G().water && G().water.fish && G().water.fish.give(species, {});
    if (!f) throw new Error(`hook catchFish: no fish "${species}" in this world`);
    t.event('setup-shortcut', `a ${species} counted as caught (water.fish.give: the engine's catch event)`);
    return f;
  },
  /** Puts the player on the beach facing the pier end (for the rod marker screenshot). Uses the world's own settle path. */
  atBeach(t) {
    HOOKS.allowed('atBeach');
    const p = W() && W().player, g = G();
    if (!p || !g) throw new Error('hook atBeach: the island is not ready');
    const rod = W().byId.get('rod');
    const x = 58, z = -2;
    const y = (g.terrain && g.terrain.heightAt ? g.terrain.heightAt(x, z) : 1) + 1;
    const local = g.planet && g.planet.round && g.planet.toLocal ? g.planet.toLocal([x, y, z]) : [x, y, z];
    const at = Array.isArray(local) ? local : [local.x, local.y, local.z];
    p.position = at; p.velocity = [0, 0, 0];
    if (rod) {
      const yaw = Math.atan2(rod.x - p.x, rod.z - p.z);
      try { if (p.node && p.node.rotation) p.node.rotation.y = yaw; } catch { /* fine */ }
      try { if (g.camera && g.camera.yaw !== undefined) g.camera.yaw = yaw; } catch { /* fine */ }
    }
    t.event('setup-shortcut', 'the player put on the beach facing the pier end (marker screenshot)');
  },
  allowed(name) { if (isLive()) throw new Error(`hook ${name}: playtest hooks are never available on the live site`); },
  names: ['explode', 'enterVehicle', 'dock', 'catchFish', 'atBeach'],
};
if (!isLive()) { window.hawkesPlaytestHooks = HOOKS; if (window.hawkesPlaytest) window.hawkesPlaytest.hooks = HOOKS; }

// ---------------------------------------------------------------------------------------------- the stages
/** One stage's timeout or failure carries its name, so the review reads which part of the path broke. */
const stageError = (name, e) => new Error(`stage "${name}": ${e && e.message ? e.message : e}`);

async function stageLanding(t, ctx) {
  t.scene('Landing');
  await t.until(() => document.readyState === 'complete' && $('[data-play-now]'), 20000, 'the landing page and its Play now button');
  t.event('landing-loaded');
  t.progress(0.04);
  if (ctx.options.link) { // the friend's browser: straight to the invitation, signed out, on this origin
    const there = new URL(ctx.options.link, location.origin);
    t.event('friend-opens', `${there.pathname}?invite=… (no cookie, no account)`);
    writeRun({ ...ctx.saved(), landed: true });
    location.href = there.pathname + there.search;
    await t.wait(30000);
    throw new Error('the invitation page did not open');
  }
  if (ctx.options.at === 'sandbox') { t.event('start-at', 'sandbox: skipped the Play click (named shortcut)'); writeRun({ ...ctx.saved(), landed: true }); location.href = ctx.options.touch ? '/play/sandbox?touch=1' : '/play/sandbox'; await t.wait(30000); return; }
  await t.wait(1500);
  t.event('play-click', 'Play now (the hero button)');
  if (ctx.id === 'first-load') markPlayClick();
  writeRun({ ...ctx.saved(), landed: true });
  $('[data-play-now]').click(); // enter.js fades the page, then opens /play/sandbox
  await t.wait(25000);
  throw new Error('timed out: the Play click did not leave the landing page');
}

async function stageVeil(t, ctx) {
  t.scene('Sandbox loading');
  await t.until(() => W() && W().player && W().player.alive, 90000, 'the island to load (world and player)');
  t.event('world-ready');
  t.scene('Sandbox: world ready');
  t.progress(0.14);
  // Where sound is already allowed there is no veil: the intro just starts.
  const veil = await t.until(() => $('.hp-enter button') || (G() && G().overseer && G().overseer.introPlaying), 12000, 'the click-to-enter veil or the intro').then(() => $('.hp-enter button'), () => null);
  if (!veil) { t.event('veil-skipped', 'sound already allowed; the intro went on'); return; }
  t.scene('Entry veil');
  t.event('veil-shown', 'Enter');
  await t.wait(1200);
  veil.click();
  t.event('veil-passed', 'clicked Enter');
  await t.until(() => !$('.hp-enter'), 8000, 'the veil to fade after Enter (the sound did not unlock?)');
}

/** What the page fetched so far: Babylon, the loaders and Havok's wasm come from our own /vendor, nothing from a CDN. */
function checkSelfHosted(t) {
  const urls = performance.getEntriesByType('resource');
  const cdn = urls.filter((e) => /^https?:\/\/(cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|unpkg\.com)\//.test(e.name));
  if (cdn.length) t.problem('error', `loaded from a CDN: ${cdn.map((e) => e.name).join(', ')}`);
  else t.event('no-cdn-loads', `${urls.length} requests, none to jsdelivr, cdnjs or unpkg`);
  const own = urls.filter((e) => e.name.includes('/vendor/'));
  const bytes = own.reduce((n, e) => n + (e.transferSize || 0), 0);
  const need = ['babylon.js', 'babylonjs.loaders.min.js', 'HavokPhysics_umd.js', 'HavokPhysics.wasm'];
  const missing = need.filter((n) => !own.some((e) => e.name.includes(`/${n}`)));
  if (missing.length) t.problem('error', `not fetched from /vendor: ${missing.join(', ')}`);
  else t.event('engine-self-hosted', `${own.length} files from /vendor, ${Math.round(bytes / 1024)} KB over the wire (${own.filter((e) => e.transferSize === 0).length} from cache)`);
  t.metric('vendorKB', Math.round(bytes / 1024));
  // Models, textures and sounds: from Gen's CDN when it has them backed up, else through this site (/play-asset, /v1/community).
  const fromCdn = urls.filter((e) => /^https:\/\/cdn\.hawkesgen\.ai\/sha256\//.test(e.name));
  const viaSite = urls.filter((e) => /\/(play-asset\/|v1\/community\/a_)/.test(e.name));
  t.event('asset-sources', `${fromCdn.length} files from cdn.hawkesgen.ai, ${viaSite.length} through the site (not backed up yet, or Gen's CDN is off)`);
  t.metric('assetsFromCdn', fromCdn.length);
  t.metric('assetsViaSite', viaSite.length);
}

/** Where the player sits on the canvas during the intro look (Babylon project), or null. */
function introPlayerScreen() {
  const w = W(), p = w && w.player, sc = w && w.scene, cam = sc && sc.activeCamera, B = window.BABYLON;
  if (!p || !sc || !cam || !B) return null;
  try {
    const eng = sc.getEngine();
    const rw = eng.getRenderWidth(), rh = eng.getRenderHeight();
    const v = B.Vector3.Project(new B.Vector3(p.x, p.bottom + 0.95, p.z), B.Matrix.Identity(), sc.getTransformMatrix(), cam.viewport.toGlobal(rw, rh));
    return { x: v.x, y: v.y, w: rw, h: rh };
  } catch { return null; }
}

/** On a tall phone: character not pinned to an edge, mirror slab hidden for the look, Skip clear of the feet. */
function checkIntroPortraitFrame(t) {
  if (typeof window === 'undefined' || window.innerHeight <= window.innerWidth) return;
  const scr = introPlayerScreen();
  if (scr && scr.w > 0 && scr.h > 0) {
    const nx = scr.x / scr.w, ny = scr.y / scr.h;
    t.event('intro-portrait-frame', `player at ${(nx * 100).toFixed(0)}% x, ${(ny * 100).toFixed(0)}% y`);
    if (nx < 0.18 || nx > 0.82) t.problem('error', `quality.clipping: intro portrait pins the player to the ${nx < 0.5 ? 'left' : 'right'} edge (${(nx * 100).toFixed(0)}%)`);
    if (ny < 0.12 || ny > 0.78) t.problem('error', `intro portrait places the player too near the ${ny < 0.5 ? 'top' : 'bottom'} (${(ny * 100).toFixed(0)}%); subject should sit in the upper-middle`);
    else t.event('intro-subject-centred', `upper-middle at ${(ny * 100).toFixed(0)}% y`);
  } else t.event('intro-portrait-frame', 'no screen projection yet');
  const mir = W() && [...W().entities].find((e) => e && e.alive && e.kind === 'mirror' && e.node);
  if (mir) {
    const on = mir.node.isEnabled ? mir.node.isEnabled() : true;
    if (on) t.problem('error', 'intro portrait still shows the mirror slab during the sky look');
    else t.event('intro-mirror-hidden', 'mirror off for the look-up');
  }
  const skip = document.querySelector('.ov-skip');
  if (skip && scr) {
    const r = skip.getBoundingClientRect();
    if (r.width && r.top < scr.y + 24) t.problem('error', 'Skip sits on the player during the intro look');
    else if (r.width) t.event('intro-skip-clear', 'Skip clear of the subject');
  }
  t.scene('Intro: portrait framing');
}

async function stageIntro(t, ctx) {
  const g = () => G() && G().overseer;
  const started = await t.until(() => g() && g().introPlaying, 25000, 'the Overseer\'s intro to start').then(() => true, () => false);
  if (!started) {
    if ($('.mr')) { t.event('intro-not-played', 'the mirror was already open'); return; }
    throw new Error('timed out waiting for the Overseer\'s intro to start');
  }
  t.scene('Intro');
  t.event('intro-start');
  // A beat into the look-up: portrait framing (character centred, mirror hidden, Skip clear) before any skip.
  await t.wait(1200);
  if (g() && g().introPlaying) checkIntroPortraitFrame(t);
  const heard = [];
  const hear = () => { for (const p of document.querySelectorAll('.hc-log p.overseer')) { const l = p.textContent.replace(/\s+/g, ' ').trim(); if (l && !heard.includes(l)) { heard.push(l); t.event('overseer-said', l); } } };
  checkSelfHosted(t);
  t.progress(0.2);
  const watch = Number(ctx.options.watch ?? 8);
  await t.until(() => { hear(); return !g().introPlaying; }, watch * 1000, 'the intro to run').then(() => t.event('intro-ended', 'watched to the end'), async () => {
    t.event('intro-watched', `${watch} s`);
    await tap(t, 'Enter'); // any key skips (a moment after it starts)
    await t.until(() => !g().introPlaying, 6000, 'the intro to stop after a key');
    t.event('intro-skipped', 'a key press');
  });
  t.progress(0.3);
}

/** The Overseer's first-visit introduction, watched to the end with real input: at least three spoken lines, then the
 *  prompt that starts building (a chat card; a real click opens the chat to the Overseer), and the intro's flag kept so a
 *  return skips it (the second page load itself is `sandbox-return`'s). */
/** One-shot samples (8, 15 and 25 s after the stage starts; no polling) of whether the canvas is presenting: the engine's
 *  frame counter, the camera's position, the canvas's computed style and size, the GL context, the loading cover and the
 *  Skip pill. They are metrics and a log line each, so a black screen in a run says where the picture stopped. */
function sampleCanvas(t) {
  const t0 = performance.now();
  const take = (label) => {
    try {
      const H = HP(), w = H && H.world, scene = w && w.scene, eng = scene && scene.getEngine && scene.getEngine();
      const cv = document.getElementById('stage');
      const cs = cv ? getComputedStyle(cv) : null;
      const r = cv ? cv.getBoundingClientRect() : null;
      const cam = scene && scene.activeCamera;
      const gl = eng && eng._gl;
      const lost = gl && gl.isContextLost ? gl.isContextLost() : null;
      const cover = document.getElementById('loading');
      const info = {
        at: `${((performance.now() - t0) / 1000).toFixed(1)}s`,
        frameId: scene && Number.isFinite(scene.getFrameId && scene.getFrameId()) ? scene.getFrameId() : eng && eng.frameId,
        ready: scene && scene.isReady ? scene.isReady() : null,
        camera: cam && cam.position ? [cam.position.x, cam.position.y, cam.position.z].map((v) => Math.round(v * 10) / 10) : null,
        canvas: cs ? { display: cs.display, opacity: cs.opacity, visibility: cs.visibility, w: Math.round(r.width), h: Math.round(r.height), attr: [cv.width, cv.height] } : null,
        contextLost: lost,
        cover: cover ? (cover.hidden ? 'hidden' : cover.classList.contains('fade') ? 'fading' : 'shown') : 'none',
        skip: Boolean(document.querySelector('.ov-skip')),
        bars: Boolean(document.querySelector('.ov-bars')),
        introPlaying: Boolean(G() && G().overseer && G().overseer.introPlaying),
      };
      t.event('canvas-' + label, JSON.stringify(info));
      if (t.metric) {
        if (Number.isFinite(info.frameId)) t.metric('frameId' + label, info.frameId);
        if (info.canvas) t.metric('canvasOpacity' + label, Number(info.canvas.opacity));
        if (lost !== null) t.metric('contextLost' + label, lost ? 1 : 0);
      }
    } catch (e) { t.event('canvas-' + label, 'sample failed: ' + (e && e.message)); }
  };
  for (const s of [8, 15, 25]) setTimeout(() => take(s + 's'), s * 1000);
}

async function stageFirstVisit(t, ctx) {
  sampleCanvas(t);
  const g = () => G() && G().overseer;
  const seen = [];
  const touch = Boolean(HP().touchUi) || Boolean(ctx.options.touch);
  await t.until(() => G() && G().on, 20000, 'the game events').catch(() => {});
  let prompted = false;
  G().on('intro', (d) => { if (d && d.state === 'prompt') prompted = true; });
  const speech = [];
  G().on('overseer-speech', (d) => { if (d && d.state === 'start') speech.push(d); });
  const said = () => [...document.querySelectorAll('.hc-log p.overseer')].map((p) => p.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const started = await t.until(() => g() && g().introPlaying, 25000, 'the Overseer\'s intro to start').then(() => true, () => false);
  if (!started) throw new Error('timed out waiting for the Overseer\'s intro to start (first visit)');
  t.event('intro-start');
  t.scene('First visit: the Overseer appears');
  const t0 = performance.now();
  const sec = () => ((performance.now() - t0) / 1000).toFixed(1);
  const p = () => W() && W().player;
  const start = { x: p().x, z: p().z };
  // Portrait framing while the sky look still holds (before the first move).
  await t.wait(1100);
  if (g() && g().introPlaying) checkIntroPortraitFrame(t);

  // 1. The first move: real input (the stick, or W), as soon as the player has control; it must show within 5 s of the intro's start.
  await t.until(() => p() && p().controls !== false, 8000, 'the player to be given control during the intro').catch((e) => t.problem('error', e.message));
  t.event('control-given', `${sec()} s after the intro started`);
  let stick = null;
  if (touch) { stick = stickHold(); stick.set(0, 1); } else setKeys({ w: true });
  let moved = false;
  await t.until(() => { moved = Math.hypot(p().x - start.x, p().z - start.z) > 0.3; return moved; }, 5000, 'the player to move').catch(() => {});
  const ms = Math.round(performance.now() - t0);
  if (moved && ms <= 5000) t.event('first-move', `${ms} ms after the intro started (${touch ? 'the stick' : 'W'})`);
  else t.problem('error', `the first move came ${moved ? ms + ' ms' : 'never'} after the intro started; it must be within 5000 ms`);
  t.metric && t.metric('firstMoveMs', ms);
  t.scene('First visit: walking under the beam');

  // 2. Each line: a caption naming the Overseer on a dark plate (or in the letterbox bar if a shot still uses one), clear of the controls; and its voice.
  const rect = (el) => el.getBoundingClientRect();
  const hit = (a, b) => !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
  const caps = new Set();
  let capProblems = 0, shots = 0;
  const watch = () => {
    for (const l of said()) if (!seen.includes(l)) { seen.push(l); t.event('overseer-said', l); }
    const el = document.querySelector('.ov-cap.on');
    if (el) {
      const name = (el.querySelector('b') || {}).textContent || '', line = (el.querySelector('span') || {}).textContent || '';
      if (line && !caps.has(line)) {
        caps.add(line);
        const r = rect(el.querySelector('.in')), plate = el.classList.contains('plate');
        const bars = document.querySelector('.ov-bars'), bar = bars && bars.lastElementChild ? rect(bars.lastElementChild) : null;
        const inBar = !plate && bar && r.top >= bar.top - 1 && r.bottom <= bar.bottom + 1;
        const where = plate ? 'a dark plate' : inBar ? 'the letterbox bar' : 'OUTSIDE the letterbox bar';
        t.event('intro-caption', `${name}: "${line}" in ${where}`);
        if (!/overseer/i.test(name)) { capProblems++; t.problem('error', `a caption without the Overseer's name: "${line}"`); }
        if (!plate && !inBar) { capProblems++; t.problem('error', `the caption "${line}" is not inside the letterbox bar`); }
        if (touch) {
          if (!plate) { capProblems++; t.problem('error', 'on a phone the caption must sit on a dark plate'); }
          if (r.height > 0 && parseFloat(getComputedStyle(el.querySelector('span')).fontSize) < 16) { capProblems++; t.problem('error', 'the caption is under 16 px on a phone'); }
          for (const c of document.querySelectorAll('#touch .pad, #touch .a, #touch .b, #touch button, .tl-zone button')) { const cr = rect(c); if (cr.width && hit(r, cr)) { capProblems++; t.problem('error', `the caption overlaps a control (${c.className || c.id})`); break; } }
        }
        if (!shots) { shots++; t.scene(`First visit: caption "${line}"`); }
      }
    }
  };
  // Walk on (a thumb or a key held) while the lines play, until the skip point.
  const skipAfter = Number(ctx.options.skipAfter || 8.5);
  await t.until(() => { watch(); return (performance.now() - t0) / 1000 >= skipAfter || !g().introPlaying; }, 20000, 'the intro lines');
  const voiced = speech.filter((d) => d.voiced);
  t.event('intro-voice', `${voiced.length} of ${speech.length} lines voiced so far`);
  if (speech.length && !voiced.length) t.problem('error', 'none of the intro lines had a voice clip playing');

  // 3. One key or tap skips the rest: control back within 0.5 s, the camera behind the player.
  if (g().introPlaying) {
    if (stick) stick.release(); else setKeys({});
    const ts = performance.now();
    if (touch) { const c = canvas(), id = ++touchId, x = innerWidth * 0.5, y = innerHeight * 0.25; touchEv('pointerdown', c, x, y, id); touchEv('pointerup', c, x, y, id); }
    else await tap(t, 'Enter');
    await t.until(() => !g().introPlaying, 2000, 'the intro to end after the skip');
    await t.wait(450);
    const back = performance.now() - ts;
    const delta = Math.abs(wrap(camYaw() - p().node.rotation.y));
    t.event('skip-control-back', `${Math.round(back)} ms after the ${touch ? 'tap' : 'key'}; controls ${p().controls !== false}; camera ${delta.toFixed(2)} rad off behind the player`);
    t.scene('First visit: after the skip');
    if (p().controls === false && !(G().mirror && G().mirror.pending)) t.problem('error', 'control did not come back after the skip');
    if (delta > 0.35) t.problem('error', `the camera is not behind the player after the skip (${delta.toFixed(2)} rad off)`);
  } else t.event('skip-not-needed', 'the intro had ended before the skip point');
  watch();
  if (seen.length >= 3) t.event('greeting-lines', `${seen.length} lines in character`);
  else t.problem('error', `the Overseer said ${seen.length} lines in the intro; at least 3 are expected: ${JSON.stringify(seen)}`);

  // 4. As a guest: the mirror is the next thing, and no "Ask for your first thing" card is on screen.
  const guest = Boolean(window.HawkesGuest);
  if (guest) {
    await t.until(() => G().mirror && G().mirror.isOpen, 6000, 'the mirror to open after the intro').then(() => t.event('mirror-open-after-intro', 'the questions are on screen'), (e) => t.problem('error', e.message));
    const card = [...document.querySelectorAll('.hc-card .act')].find((b) => /first thing/i.test(b.textContent));
    if (card) t.problem('error', 'a guest sees the "Ask for your first thing" card'); else t.event('no-ask-card', 'no first-thing card for a guest');
    t.scene('First visit: the mirror');
  } else {
    const card = await t.until(() => [...document.querySelectorAll('.hc-card .act')].find((b) => /first thing/i.test(b.textContent)), 8000, 'the prompt that starts building').catch((e) => { t.problem('error', e.message); return null; });
    if (card) {
      t.scene('First visit: the prompt to build');
      t.event('build-prompt-shown', card.textContent.trim());
      card.click();
      const open = await t.until(() => document.querySelector('.hc-form.on'), 5000, 'the chat to open for the first ask').then(() => true, (e) => { t.problem('error', e.message); return false; });
      if (open) t.event('build-prompt-used', 'the chat is open to the Overseer');
      if (!prompted) t.problem('error', 'the intro never said it had prompted');
    }
  }
  // A return skips it: the intro's flag is kept, so a second visit does not want it.
  let flag = false; try { flag = Boolean(localStorage.getItem('hg_overseer_intro')); } catch { /* sandboxed */ }
  const wants = Boolean(g().introWanted && g().introWanted());
  if (flag && !wants) t.event('return-skips-intro', 'the flag is kept and the intro no longer wanted');
  else t.problem('error', `a return would play the intro again (flag ${flag}, wanted ${wants})`);
  t.progress(1);
}

async function stageMirror(t, ctx) {
  await t.until(() => $('.mr .mr-q'), 40000, 'the mirror to open after the intro');
  const question = () => ($('.mr .mr-q') || {}).textContent || '';
  t.scene('Mirror: what are you');
  t.event('mirror-open', question());
  await t.wait(1200);
  const want = ctx.options.what || 'toaster';
  const card = $(`.mr [data-what="${want}"]`) || $('.mr [data-what]');
  if (!card) throw new Error('the mirror shows no body to choose');
  const chosen = card.dataset.what;
  card.click();
  t.event('mirror-answer', `what: ${chosen}`);
  await t.wait(1000);
  const next = async (from) => { $('.mr [data-a="next"]').click(); await t.until(() => question() !== from, 8000, `the mirror to leave "${from}"`); };
  await next(question());
  t.scene('Mirror: how do you look');
  t.event('mirror-step', question());
  await t.wait(600);
  const dice = $('.mr [data-a="randomLook"]');
  if (dice) { dice.click(); t.event('mirror-answer', 'look: surprise me'); await t.wait(1000); }
  await next(question());
  t.scene('Mirror: what are you called');
  t.event('mirror-step', question());
  const name = await t.until(() => $('.mr .mr-name:not(.mr-model)'), 8000, 'the name field').then(() => $('.mr .mr-name:not(.mr-model)'));
  const who = ctx.options.name || `Tester ${rand(3)}`;
  name.focus();
  name.value = who;
  name.dispatchEvent(new Event('input', { bubbles: true }));
  t.event('mirror-answer', `name: ${who}`);
  await t.wait(1200);
  name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); // Enter in the field is "That's me"
  await t.until(() => !$('.mr'), 10000, 'the mirror to close after the last answer');
  t.event('mirror-done', `${chosen}, ${who}`);
  startFirstMinutes(t, ctx);
  t.progress(0.45);
}

/** The HUD beside the mirror panel (modules/hudlayout): measured with the panel open, then closed. */
async function stageMirrorLayout(t) {
  await t.until(() => $('.mr .mr-q'), 40000, 'the mirror to open after the intro');
  await t.wait(900); // the panel slides in (0.35 s) and the 0.3 s HUD transition settles
  const vw = window.innerWidth, vh = window.innerHeight;
  const visible = (el) => {
    if (!el || el.closest('[hidden], .hp-enter')) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.05) return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  };
  const pieces = () => {
    const out = [];
    const add = (name, el) => { if (visible(el)) out.push({ name, r: el.getBoundingClientRect(), el }); };
    document.querySelectorAll('.gs-acts button:not(.more), .jr-btn').forEach((b) => {
      const lbl = (b.getAttribute('aria-label') || b.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24);
      add('action: ' + lbl, b);
    });
    document.querySelectorAll('.hc-card, .hc-card .act, .tour-track, .tour-stuck, .qs-btn, .qs-track').forEach((b) => {
      const cls = (b.className || '').toString().trim().split(/\s+/)[0] || b.tagName.toLowerCase();
      add('quest: ' + cls + ' ' + (b.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24), b);
    });
    return out;
  };
  const check = (label) => {
    const panel = $('.mr');
    const pr = panel ? panel.getBoundingClientRect() : null;
    const list = pieces();
    const bad = [];
    for (const { name, r, el } of list) {
      if (r.left < -1 || r.top < -1 || r.right > vw + 1 || r.bottom > vh + 1) bad.push(`${name} is off screen (${Math.round(r.left)}-${Math.round(r.right)})`);
      if (pr && r.right > pr.left - 2 && r.left < pr.right && r.bottom > pr.top && r.top < pr.bottom) bad.push(`${name} runs under the panel (${Math.round(r.right)} > ${Math.round(pr.left)})`);
      const mx = Math.min(Math.max(r.left + r.width / 2, 0), vw - 1), my = Math.min(Math.max(r.top + r.height / 2, 0), vh - 1);
      const top = document.elementFromPoint(mx, my);
      if (top && !(el === top || el.contains(top) || top.contains(el))) bad.push(`${name} is covered by ${top.className || top.tagName}`);
    }
    return { list, bad, pr };
  };
  const open = check('open');
  t.scene(`Mirror open at ${vw}x${vh}`);
  t.event('hud-measured-open', `${vw}x${vh}: ${open.list.length} pieces, panel ${open.pr ? Math.round(open.pr.left) : '-'}..${open.pr ? Math.round(open.pr.right) : '-'}`);
  const acts = open.list.filter((p) => p.name.startsWith('action:'));
  const expectActs = (HP() && HP().hudLayout && HP().hudLayout.compact(vw, vh)) ? 1 : 4;
  if (acts.length < expectActs) t.problem('error', `expected all ${expectActs} top-right actions beside the panel, found ${acts.length} (${acts.map((p) => p.name).join(', ')})`);
  else t.event('actions-whole', acts.map((p) => p.name.replace('action: ', '')).join(', '));
  const banner = open.list.filter((p) => p.name.startsWith('quest:'));
  if (!banner.length) t.problem('error', 'no quest/prompt banner on screen with the mirror open');
  else t.event('banner-whole', banner.map((p) => p.name).join(' | '));
  const orangeBtn = $('.hc-card .act');
  if (orangeBtn && visible(orangeBtn)) {
    const br = orangeBtn.getBoundingClientRect();
    const cx = Math.round(br.left + br.width / 2), cy = Math.round(br.top + br.height / 2);
    const hit = document.elementFromPoint(cx, cy);
    if (hit && (hit === orangeBtn || orangeBtn.contains(hit)) && (!open.pr || br.right <= open.pr.left - 2)) {
      t.event('quest-button-clickable', `"${orangeBtn.textContent.trim()}" at ${Math.round(br.left)}..${Math.round(br.right)} (panel starts at ${open.pr ? Math.round(open.pr.left) : '-'})`);
    } else {
      t.problem('error', `quest banner orange button is not clear and clickable (${Math.round(br.left)}..${Math.round(br.right)}, panel ${open.pr ? Math.round(open.pr.left) : '-'})`);
    }
  } else {
    t.problem('error', 'the quest banner orange button (.hc-card .act) is not visible with the mirror open');
  }
  const hl = HP() && HP().hudLayout;
  if (hl && hl.compute && hl.zones) {
    const r1280 = hl.compute(1280, 1280 - 16 - 400, 400);
    const r1440 = hl.compute(1440, 1440 - 16 - 400, 400);
    if (r1280 === 428 && r1440 === 428 && hl.zones.quest && hl.zones.actions && hl.zones.panel && hl.zones.chat) {
      t.event('layout-zones-and-sizes', `zones=${Object.keys(hl.zones).join(',')}; 1280x720 reserve=${r1280}px, 1440x900 reserve=${r1440}px`);
    } else {
      t.problem('error', `hudLayout zones/compute mismatch: 1280=${r1280}, 1440=${r1440}`);
    }
  }
  for (const b of open.bad) t.problem('error', b);
  if (!open.bad.length) t.event('hud-clear-of-panel', 'nothing runs under the panel');
  const first = acts[0];
  // Measure .gs-acts itself — not first.el.parentElement (.jr-btn's parent is #ui, full viewport = 1280→1280).
  const actsRow = document.querySelector('.gs-acts');
  const chatEl = $('.hc-chat');
  const openRight = actsRow ? actsRow.getBoundingClientRect().right : (first ? first.r.right : 0);
  const openChatRight = chatEl && visible(chatEl) ? chatEl.getBoundingClientRect().right : 0;
  const dur = actsRow ? parseFloat(getComputedStyle(actsRow).transitionDuration) : 0;
  const chatDur = chatEl ? parseFloat(getComputedStyle(chatEl).transitionDuration) : 0;
  if (actsRow && !(dur > 0)) t.problem('error', 'the action row has no transition: it would jump');
  else if (chatEl && !(chatDur > 0)) t.problem('error', 'the banner/chat zone has no transition: it would jump');
  else t.event('transition-set', `actions ${dur}s, banner ${chatDur}s`);
  // Close the mirror and watch both the action row and the banner glide back.
  const x = $('.mr .mr-x');
  if (x) x.click(); // the panel's own Close
  await t.wait(110);
  const mid = actsRow ? actsRow.getBoundingClientRect().right : 0;
  const midChat = chatEl && visible(chatEl) ? chatEl.getBoundingClientRect().right : 0;
  await t.until(() => !$('.mr'), 10000, 'the mirror to close');
  await t.wait(700);
  const closed = actsRow ? actsRow.getBoundingClientRect().right : 0;
  const closedChat = chatEl && visible(chatEl) ? chatEl.getBoundingClientRect().right : 0;
  t.scene(`Mirror closed at ${vw}x${vh}`);
  if (actsRow || first) {
    if (closed > openRight + 40) t.event('hud-back', `actions moved from ${Math.round(openRight)} to ${Math.round(closed)}, banner from ${Math.round(openChatRight)} to ${Math.round(closedChat)}`);
    else t.problem('error', `the action row did not move back (${Math.round(openRight)} -> ${Math.round(closed)})`);
    if (mid > openRight + 1 && mid < closed - 1) t.event('hud-glides', `actions mid-way at ${Math.round(mid)}, banner mid-way at ${Math.round(midChat)}`);
    else t.problem('warn', `no mid-way sample of the move back (${Math.round(openRight)} / ${Math.round(mid)} / ${Math.round(closed)})`);
  }
  const after = check('closed');
  for (const b of after.bad) t.problem('error', b);
  t.progress(0.6);
}

/** hud-overlap: every visible HUD control measured at each step, after the transition (no timers: transitionend). */
async function stageHudOverlap(t) {
  const vw = window.innerWidth, vh = window.innerHeight;
  const size = `${vw}x${vh}`;
  const settle = () => new Promise((res) => {
    let done = false;
    const end = () => { if (done) return; done = true; document.removeEventListener('transitionend', onEnd, true); res(); };
    const onEnd = () => requestAnimationFrame(() => requestAnimationFrame(end));
    document.addEventListener('transitionend', onEnd, true);
    setTimeout(end, 900); // a layout with nothing moving never fires transitionend
  });
  const label = (el) => {
    const txt = (el.getAttribute('aria-label') || el.textContent || el.placeholder || el.title || '').trim().replace(/\s+/g, ' ').slice(0, 24);
    return `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/)[0] : ''} "${txt}"`;
  };
  const controls = () => {
    const out = [];
    document.querySelectorAll('button, a[href], input, select, textarea, [role=button]').forEach((el) => {
      if (el.closest('[hidden], .hp-enter') || el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) return;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) out.push({ name: label(el), el, r });
    });
    return out;
  };
  const measure = async (step, open) => {
    await settle();
    t.scene(`HUD ${step} at ${size}`);
    const list = controls();
    const off = [], small = [], overlap = [];
    for (const c of list) {
      const r = c.r;
      if (r.left < -1 || r.top < -1 || r.right > vw + 1 || r.bottom > vh + 1) off.push(c.name);
      if (r.width < 44 || r.height < 44) small.push(`${c.name} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
      const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
      if (w > 1 && h > 1) overlap.push(`${a.name} overlaps ${b.name}`);
    }
    // The panel and the quest banner are not controls themselves: the panel against the banner counts too.
    const panel = $('.mr, [data-hud-panel]');
    if (panel) {
      const pr = panel.getBoundingClientRect();
      document.querySelectorAll('.tour-track, .tour-stuck, .qs-btn, .qs-track, .hc-card, .gs-acts, .jr-btn').forEach((b) => {
        if (b.closest('[hidden], .hp-enter') || (b.offsetParent === null && getComputedStyle(b).position !== 'fixed')) return;
        const cs = getComputedStyle(b);
        if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return;
        const r = b.getBoundingClientRect();
        if (r.width > 0 && r.right > pr.left + 1 && r.left < pr.right - 1 && r.bottom > pr.top + 1 && r.top < pr.bottom - 1) overlap.push(`${label(b)} overlaps the panel ${label(panel)}`);
      });
    }
    const tag = `${step} ${size}`;
    t.event('hud-measured', `${tag}: ${list.length} controls${open ? ' (' + open + ')' : ''}`);
    if (overlap.length) for (const o of overlap) t.problem('error', `hud-no-overlap failed at ${tag}: ${o}`);
    else t.event('hud-no-overlap', tag);
    if (off.length) for (const o of off) t.problem('error', `hud-in-viewport failed at ${tag}: ${o} is outside the screen`);
    else t.event('hud-in-viewport', tag);
    if (small.length) for (const o of small) t.problem('error', `hud-tap-targets failed at ${tag}: ${o} is under 44px`);
    else t.event('hud-tap-targets', tag);
  };
  await t.until(() => $('.mr .mr-q'), 40000, 'the mirror to open after the intro');
  await measure('mirror open', 'panel');
  const x = $('.mr .mr-x');
  if (x) x.click();
  await t.until(() => !$('.mr'), 10000, 'the mirror to close');
  await measure('mirror closed');
  const HP = window.HawkesPlay;
  if (HP && HP.chat && HP.chat.open()) {
    await t.until(() => $('.hc-chat form.on, .hc-chat .on'), 5000, 'the chat input to open');
    await measure('chat open', 'chat');
    const input = $('.hc-chat input');
    if (input) input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await measure('chat closed');
  } else {
    t.problem('warn', 'the Overseer chat could not be opened: its steps were not measured');
  }
  t.progress(0.6);
}

async function stageSheet(t, ctx) {
  // A browser Studio signed in beforehand (its beta test sign-in, cloud/functions/src/testsignin.ts) never sees the sheet:
  // the island just carries on, so there is nothing to wait for.
  const signedIn = await fetch('/v1/users/me?soft=1', { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : {})).then((d) => d.user || null).catch(() => null);
  if (signedIn) {
    t.event('signed-in', 'this browser was signed in before the run: no account sheet');
    t.progress(0.6);
    return;
  }
  await t.until(() => $('#gsEmail') || $('#gsGoogle'), 20000, 'the account sheet to open after the mirror');
  t.scene('Account sheet');
  t.event('sheet-shown', ($('#gsTitle') || {}).textContent || '');
  await t.wait(1500);
  if (ctx.options.signup === false || isLive()) {
    t.event('signup-skipped', isLive() ? 'live site: a playtest never signs up' : 'signup: false');
    t.finish('done');
    return 'stop';
  }
  // Signing in is Google only on the cloud portal (no email and password form): a playtest cannot make a throwaway
  // account there, so the run ends at the sheet. (A browser the runner signed in beforehand never sees the sheet.)
  if (!$('#gsEmail')) {
    t.event('signup-unavailable', 'the sheet has only Continue with Google: a playtest cannot make a throwaway account');
    t.problem('warning', 'sign-up is Google only: the stages after the account sheet need a browser already signed in');
    t.finish('done');
    return 'stop';
  }
  const health = await fetch('/v1/health').then((r) => r.json()).catch(() => ({}));
  if (health.mail) throw new Error('this server sends mail (PORTAL_MAIL is on): refusing to sign up a throwaway account here');
  t.event('mail-off', 'the server reports mail: false, so no email goes out');
  const swap = $('#gsSwap [data-swap]');
  if (swap && /create/i.test(swap.textContent)) swap.click();
  const email = `playtest-${Date.now().toString(36)}${rand(5)}@example.com`; // example.com is reserved: it can never be real mail
  const set = (id, v) => { const el = $(id); el.focus(); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
  set('#gsEmail', email);
  await t.wait(500);
  const password = `Pt-${rand(14)}`;
  ctx.account = { email, password }; // (share-moment signs back in with it)
  set('#gsPw', password);
  t.event('signup-submit', `throwaway ${email.replace(/^[^@]+/, 'playtest-…')}`);
  await t.wait(800);
  $('#gsGo').click();
  // Closed on success; on failure the sheet shows why.
  await t.until(() => !$('#gsEmail') || ($('#gsErr') && !$('#gsErr').hidden && $('#gsErr').textContent.trim()), 25000, 'the sign-up to answer');
  if ($('#gsEmail')) throw new Error(`the sign-up was refused: ${$('#gsErr').textContent.trim().slice(0, 160)}`);
  t.event('signup-ok', 'the account was made; the island carries on');
  t.progress(0.6);
}

async function stageAsks(t) {
  const me = () => fetch('/v1/users/me', { credentials: 'same-origin' }).then((r) => r.json()).then((d) => d.user);
  const lines = () => [...document.querySelectorAll('.hc-log p')];
  const sends = () => lines().filter((p) => p.classList.contains('sys') && /credits/.test(p.textContent) && p.querySelector('.act'));
  const before = await me();
  t.scene('After sign-up: the Overseer\'s line');
  const told = await t.until(() => lines().map((p) => p.textContent).find((x) => /you have [\d,]+ credits/.test(x)), 30000, 'the Overseer to tell the balance after the sign-up');
  const said = Number(/you have ([\d,]+) credits/.exec(told)[1].replace(/,/g, ''));
  if (said !== Number(before.credits)) t.problem('error', `the Overseer said ${said} credits but /v1/users/me says ${before.credits}`);
  else t.event('balance-told', `the Overseer said ${said} credits; the account has ${before.credits}`);
  t.progress(0.7);
  await t.until(() => sends().length >= 3, 30000, 'the three example asks');
  t.scene('Three asks to tap');
  for (const p of sends()) t.event('ask-offered', p.textContent.replace(/\s+/g, ' ').trim());
  if (!sends().every((p) => /\d+ credits/.test(p.textContent))) t.problem('error', 'an example ask has no price');
  await t.wait(1500);
  const idle = await me();
  if (idle.credits !== before.credits) t.problem('error', `credits changed (${before.credits} > ${idle.credits}) before any ask was sent`);
  else t.event('nothing-charged', 'no credits taken before a click');
  // A real click on the first Send.
  const first = sends()[0];
  const label = first.textContent.replace(/\s+/g, ' ').trim();
  first.querySelector('.act').click();
  t.event('ask-tapped', label);
  await t.until(() => lines().some((p) => /Sent|thinking/i.test(p.textContent)) || document.querySelector('.hc-status'), 15000, 'the tapped ask to go out').catch(() => {});
  t.scene('An ask sent');
  await t.wait(2500);
  // The empty balance (named setup shortcut: the game is told the balance is 0).
  t.event('setup-shortcut', 'the game told the balance is 0');
  const calls = [];
  const realFetch = window.fetch;
  window.fetch = function (u, o) { if (/\/v1\/games\/[^/]+\/ai$/.test(String(u)) && o && o.method === 'POST') calls.push(String(u)); return realFetch.apply(this, arguments); };
  window.HawkesGuest.pretendCredits(0);
  const msg = await t.until(() => lines().find((p) => /gone quiet/.test(p.textContent) && p.querySelector('a.act[href*="credits"]')), 15000, 'the Overseer\'s out-of-credits line with Get credits');
  t.scene('Out of credits');
  t.event('get-credits-shown', msg.textContent.replace(/\s+/g, ' ').trim());
  window.fetch = realFetch;
  if (calls.length) t.problem('error', 'a request to the Overseer was made with an empty balance');
  else t.event('no-failed-request', 'nothing was sent to the Overseer');
  t.progress(1);
}

/** The Overseer answers, and a failed ask is a plain message with Retry (never an endless spinner), after which the next ask works at once.
 *  Needs a signed-in browser: on beta Studio signs one in first (testSignIn); elsewhere the sheet is Google only and
 *  stageSheet ends the run `done` with a warning. */
async function stageAnswer(t) {
  const lines = () => [...document.querySelectorAll('.hc-log p.overseer')].map((p) => p.textContent.replace(/\s+/g, ' ').trim());
  const retryBtn = () => [...document.querySelectorAll('.hc-card .act')].find((b) => /^retry$/i.test(b.textContent.trim()));
  const status = () => { const s = document.querySelector('.hc-status'); return s && !s.hidden ? s.textContent.trim() : ''; };
  const working = () => Boolean(HP().work && HP().work.active);
  // Every ask the page sends, with the status it got (the second part checks the next ask is not "still working").
  const seen = [];
  const realFetch = window.fetch;
  let failNext = false, silentNext = false;
  const ANSWER_MS = 90000;
  window.fetch = function (u, o) {
    if (/\/v1\/games\/[^/]+\/ai$/.test(String(u)) && o && o.method === 'POST') {
      if (silentNext) { silentNext = false; seen.push(200); return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })); }
      if (failNext) { failNext = false; seen.push(503); return Promise.resolve(new Response(JSON.stringify({ error: 'Gen is down' }), { status: 503, headers: { 'Content-Type': 'application/json' } })); }
      const m = /\/v1\/games\/([^/]+)\/ai$/.exec(String(u)); if (m) gameId = m[1];
      return realFetch.apply(this, arguments).then((r) => { seen.push(r.status); return r; });
    }
    return realFetch.apply(this, arguments);
  };
  // What the game's feed says while an ask runs (the Overseer's beats, its heartbeat with Gen's job status, thinking,
  // chat), read on a stream of the playtest's own: when an ask hangs, the run says where it stood.
  let gameId = null, feedLog = [], feedEs = null, feedT0 = Date.now();
  const feedNote = (name, d) => { if (feedLog.length < 400) feedLog.push(`${Math.round((Date.now() - feedT0) / 1000)}s ${name}${d}`); };
  const openFeed = async () => {
    if (feedEs || !gameId || typeof EventSource === 'undefined') return;
    const path = `/v1/games/${gameId}/live`;
    const u = await realFetch(`/v1/stream-link?path=${encodeURIComponent(path)}`, { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : null)).then((d) => (d && d.url) || path, () => path);
    feedEs = new EventSource(u, { withCredentials: u.startsWith('/') });
    feedEs.addEventListener('overseer', (e) => { let d = {}; try { d = JSON.parse(e.data); } catch { /* fine */ } feedNote('overseer', ` ${d.k}${d.k === 'alive' ? ` ${d.status} chars=${d.chars}` : d.k === 'op' ? ` ${d.op} ${d.id}` : d.k === 'end' ? ` ok=${d.ok} ops=${d.ops}` : ''}`); });
    feedEs.addEventListener('thinking', (e) => feedNote('thinking', ` ${String(e.data).slice(0, 60)}`));
    feedEs.addEventListener('chat', (e) => { let m = {}; try { m = JSON.parse(e.data); } catch { /* fine */ } feedNote('chat', ` ${m.role}: ${String(m.text || '').slice(0, 80)}`); });
    feedEs.addEventListener('hello', (e) => feedNote('hello', ` ${String(e.data).slice(0, 60)}`));
    feedEs.onerror = () => feedNote('stream', ' error');
  };
  const feedDump = (label) => {
    const lines = feedLog.splice(0);
    t.event('feed', `${label}: ${lines.length ? lines.join(' · ') : 'nothing on the feed'}`.slice(0, 1800));
  };
  const OFFER = /^Here is what I can do/;
  const ask = async (text) => {
    const input = await t.until(() => document.querySelector('.hc-form input'), 30000, 'the chat input');
    keyEv('keydown', 'Enter'); await t.wait(200);
    input.value = text;
    input.form && input.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    t.event('asked', text);
  };
  try {
    await t.until(() => W() && W().player && G() && HP().chat, 60000, 'the island and its chat');
    await t.wait(3000);
    // 1. A real question gets an answer in the chat.
    const before = new Set(lines());
    await ask('What can you build for me here?');
    await t.until(() => status() || working(), 20000, 'the Overseer to start working').catch(() => t.problem('warning', 'no work indicator or status appeared after the ask'));
    t.scene('Asked: the Overseer works');
    const askedAt = Date.now();
    await t.until(() => lines().some((x) => !before.has(x)) || retryBtn(), ANSWER_MS, 'an answer or a plain failure in the chat')
      .catch(() => { throw new Error(`the Overseer did not answer within ${ANSWER_MS / 1000} s (it "thinks forever")`); });
    t.event('answer-time', `${Math.round((Date.now() - askedAt) / 1000)} s to the first answer`);
    if (retryBtn() && !lines().some((x) => !before.has(x) && !/couldn.t|lost|stopped|wrong|busy|taking too long/i.test(x))) t.problem('error', 'the first ask failed: ' + lines().filter((x) => !before.has(x)).join(' | ').slice(0, 200));
    else t.event('answer-shown', lines().filter((x) => !before.has(x)).join(' | ').slice(0, 160));
    t.scene('The Overseer answered');
    await t.until(() => !working(), 90000, 'the work indicator to end after the answer');
    t.event('work-ended', 'the work indicator is gone');
    t.progress(0.4);
    // 1b. A build request really changes the game (J, 2026-11-06: every build ended "I couldn't finish that"): a red cube
    // must be a new thing in the world, not just a message in the chat.
    const ids = () => new Set(Object.keys((W() && W().graph && W().graph.entities) || {}).concat([...W().entities].map((e) => e.id).filter(Boolean)));
    const thingsBefore = ids();
    const beforeB = new Set(lines());
    await openFeed().catch((x) => feedNote('stream', ` not opened: ${x.message}`));
    feedLog = []; feedT0 = Date.now();
    await ask('Add a red cube right in front of me.');
    t.scene('Asked: add a red cube');
    // (The example-asks offer is not an answer: only the Overseer's reply to this, or a failure, counts.)
    const fresh = () => lines().filter((x) => !beforeB.has(x) && !OFFER.test(x));
    await t.until(() => fresh().length || retryBtn(), ANSWER_MS, 'an answer to the build request')
      .catch(() => { feedDump('build ask'); throw new Error(`the build request got no answer within ${ANSWER_MS / 1000} s (it "thinks forever")`); });
    const said = fresh().join(' | ');
    if (retryBtn()) t.problem('error', `the build request failed instead of building: ${said.slice(0, 200)}`);
    await t.until(() => !working(), 90000, 'the work indicator to end after the build').catch((x) => { feedDump('build ask'); throw x; });
    feedDump('build ask');
    await t.wait(1500);
    const added = [...ids()].filter((x) => !thingsBefore.has(x));
    if (!added.length) t.problem('error', `the build request was answered ("${said.slice(0, 120)}") but the game has no new thing`);
    else t.event('world-changed', `new things: ${added.slice(0, 5).join(', ')}`);
    t.scene('The red cube is in the world');
    t.progress(0.5);
    // 2. A failed ask: a plain message and Retry, nothing spinning. (Named setup shortcut: this one request is answered 503.)
    await t.wait(2000);
    const before2 = new Set(lines());
    t.event('setup-shortcut', 'the next ask is answered 503 by the page itself (Gen failing)');
    failNext = true;
    await ask('Add a small lantern near me.');
    const retry = await t.until(retryBtn, 20000, 'a Retry button after the failed ask');
    const msg = lines().filter((x) => !before2.has(x)).join(' | ');
    if (!msg) t.problem('error', 'the failed ask said nothing');
    else if (/503|Gen is down|undefined|\[object/.test(msg)) t.problem('error', `the failure shows a raw error: ${msg.slice(0, 160)}`);
    else t.event('failure-plain-message', msg.slice(0, 160));
    t.event('retry-shown', retry.textContent.trim());
    t.scene('A failed ask: a plain message and Retry');
    await t.wait(1500);
    if (working() || status()) t.problem('error', 'the work indicator or status is still spinning after the failure');
    else t.event('no-spinner', 'the work indicator and status ended');
    // 2b. A silent ask (J, 2026-11-10: "it just thinks forever"): the page is told 200 but the server never heard it, so
    // nothing ever comes back (named setup shortcut). The island must stop waiting by itself: a plain message with Retry
    // within 75 s, and nothing left spinning.
    await t.wait(1500);
    const beforeS = new Set(lines());
    const retriesBefore = document.querySelectorAll('.hc-card .act').length;
    t.event('setup-shortcut', 'the next ask is answered 200 by the page itself and never reaches the server');
    silentNext = true;
    const silentAt = Date.now();
    await ask('Paint the sky purple.');
    await t.until(() => lines().some((x) => !beforeS.has(x)) && document.querySelectorAll('.hc-card .act').length > retriesBefore, 75000, 'the silent ask to end in a plain message with Retry')
      .catch(() => { throw new Error('a silent ask kept waiting past 75 s: the Overseer would "think forever"'); });
    await t.wait(1500);
    if (working() || status()) t.problem('error', 'the work indicator or status is still on after the silent ask ended');
    t.event('silent-ask-ends', `${Math.round((Date.now() - silentAt) / 1000)} s: ${lines().filter((x) => !beforeS.has(x)).join(' | ').slice(0, 140)}`);
    t.scene('A silent ask: it stopped waiting and said so');
    // 3. Retry with a real click: it goes through at once (not "still working"), and is answered.
    const n = seen.length;
    const before3 = new Set(lines());
    retry.click();
    t.event('retry-clicked', 'a real click');
    await t.until(() => seen.length > n, 20000, 'the retried ask to reach the server');
    if (seen[n] !== 200) t.problem('error', `the ask after a failure answered ${seen[n]} (expected 200: no "still working")`);
    else t.event('next-ask-immediate', 'the ask after the failure was accepted at once');
    await t.until(() => lines().some((x) => !before3.has(x)), ANSWER_MS, 'an answer to the retried ask')
      .catch(() => { throw new Error(`the retried ask got no answer within ${ANSWER_MS / 1000} s`); });
    t.event('retry-answered', lines().filter((x) => !before3.has(x)).join(' | ').slice(0, 160));
    t.scene('Retried: answered');
    t.progress(1);
  } finally { window.fetch = realFetch; if (feedEs) feedEs.close(); }
}

/** Build: a new game of the signed-up account, and the editor opens on it (the run crosses the page in sessionStorage). */
async function stageToEditor(t, ctx) {
  const r = await fetch('/v1/games', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Bridge check', template: 'blank' }) });
  const g = await r.json();
  if (!r.ok || !g.id) throw new Error(`a game could not be made: ${g.error || r.status}`);
  t.event('editor-opening', `a new game, ${g.id}`);
  await t.wait(1500);
  writeRun({ ...ctx.saved(), leg: 'editor' });
  location.href = `/app/g/${g.id}`;
  await t.wait(30000);
  throw new Error('the editor did not open');
}

/** In the editor. The game frame is sandboxed, so a game script is stood in for by messages delivered to the editor's
 *  own listener as from the frame (named setup shortcut); everything after is what the editor does. */
async function stageEditor(t) {
  // The frame is read each time it is used (the editor may swap it for a fresh one), and the stage waits for the draft
  // game inside it to say it is ready: the engine can take a minute to start on a loaded server.
  let frameReady = false;
  const onReady = (e) => { if (e.data && e.data.source === 'hawkes-play' && e.data.type === 'ready') frameReady = true; };
  window.addEventListener('message', onReady);
  const frame = { get contentWindow() { const f = document.getElementById('stage'); return f && f.contentWindow; } };
  await t.until(() => frame.contentWindow, 30000, 'the game frame'); // (until() resolves with no value)
  await t.until(() => document.getElementById('chatInput') && document.getElementById('genCard'), 30000, 'the editor');
  await t.until(() => frameReady, 60000, 'the game to start in its frame').catch(() => t.problem('warning', 'the game in the frame did not say it was ready within 60 s; going on'));
  window.removeEventListener('message', onReady);
  await t.wait(4000); // (the world is loaded)
  t.scene('The editor');
  const calls = [];
  const realFetch = window.fetch;
  window.fetch = function (u, o) { if (o && o.method === 'POST') calls.push(String(u)); return realFetch.apply(this, arguments); };
  const fromFrame = (m) => window.dispatchEvent(new MessageEvent('message', { data: { source: 'hawkes-play', ...m }, source: frame.contentWindow }));
  const count = (re) => calls.filter((u) => re.test(u)).length;
  const toStage = (m) => frame.contentWindow.postMessage(m, '*');
  const me = await fetch('/v1/users/me', { credentials: 'same-origin' }).then((r) => r.json()).then((d) => d.user);
  try {
    t.event('setup-shortcut', 'a game script stood in for: 50 generate and 50 ask messages delivered as from the frame');
    for (let i = 0; i < 50; i++) fromFrame({ type: 'generate', kind: 'sfx', prompt: `a cannon boom ${i}`, name: `boom-${i}` });
    const card = document.getElementById('genCard');
    await t.until(() => !card.hidden && /credits/.test(document.getElementById('genCardPrice').textContent), 15000, 'the priced card');
    t.scene('One card, priced');
    t.event('gen-card-shown', `${document.getElementById('genCardKind').textContent}: "${document.getElementById('genCardWhat').textContent}" for ${document.getElementById('genCardPrice').textContent}; ${document.getElementById('genCardBalance').textContent}`);
    if (document.getElementById('genCardWhat').textContent !== 'a cannon boom 0') t.problem('error', 'the card is not for the first request');
    await t.wait(1500);
    if (count(/\/generate$/)) t.problem('error', `${count(/\/generate$/)} request(s) to /generate before any click`);
    else t.event('no-generate-request', 'the 50 messages started nothing');
    const after = await fetch('/v1/users/me', { credentials: 'same-origin' }).then((r) => r.json()).then((d) => d.user);
    if (after.credits !== me.credits) t.problem('error', `credits changed (${me.credits} > ${after.credits}) with no click`);
    // The person says yes: a real click.
    document.getElementById('genCardYes').click();
    await t.until(() => card.hidden, 15000, 'the card to close after Make it');
    await t.wait(1500);
    if (count(/\/generate$/) === 1) t.event('gen-card-made', 'one request to /generate, after the click on Make it');
    else t.problem('error', `${count(/\/generate$/)} requests to /generate after one click`);
    // Ask: the chat box is filled and nothing is spent.
    for (let i = 0; i < 50; i++) fromFrame({ type: 'ask', text: `build me ${i} castles` });
    const input = document.getElementById('chatInput');
    await t.until(() => input.value === 'build me 49 castles', 10000, 'the chat box to hold the ask');
    t.scene('The ask waits in the chat box');
    await t.wait(1500);
    if (count(/\/ai$/)) t.problem('error', `${count(/\/ai$/)} request(s) to /ai without the person sending`);
    else t.event('no-ai-request', 'the 50 asks only filled the chat box');
    t.event('ask-filled-chat', `"${input.value}" waits for Enter`);
    input.value = '';
    // Building and saving go on.
    fromFrame({ type: 'ops', ops: [{ op: 'create', entity: { id: 'bridge-crate', type: 'box', name: 'Crate', transform: { position: [0, 1, 4] } } }], seq: 1 });
    await t.until(() => count(/\/scene$/) >= 1, 10000, 'the world edit to reach /scene');
    fromFrame({ type: 'save' });
    await t.until(() => count(/\/save$/) >= 1, 10000, 'Save to reach /save');
    t.event('ops-and-save-work', 'a world edit reached /scene and Save reached /save');
    t.scene('Building and saving still work');

    // A link in the Overseer's chat is a link only when it is ours; anything else is plain text (editor-bridge.js safeHref).
    const log = document.getElementById('chatLog');
    const linksOf = () => [...log.querySelectorAll('a.sugg-link')].map((a) => a.getAttribute('href'));
    for (const [label, href] of [['Win a prize', 'https://evil.example/win'], ['Click me', 'javascript:alert(1)'], ['Protocol-less', '//evil.example/x'], ['Backslash', '/\\evil.example/x'], ['Data', 'data:text/html,hi']]) {
      fromFrame({ type: 'chat-line', kind: 'overseer', text: `Look: ${label}`, action: { label, href } });
      await t.wait(300);
    }
    const evil = linksOf().filter((h) => /evil\.example|javascript:|^data:/.test(String(h)));
    t.scene('Overseer lines with foreign links: plain text');
    if (evil.length) t.problem('error', `a foreign link was made clickable: ${evil.join(', ')}`);
    else t.event('foreign-links-plain', 'five Overseer lines with another site, javascript:, //host, a backslash and data: links show no link');
    fromFrame({ type: 'chat-line', kind: 'overseer', text: 'Get credits here', action: { label: 'Get credits', href: '/credits' } });
    await t.until(() => linksOf().includes('/credits'), 5000, 'our own link to stay a link');
    t.event('own-link-kept', 'a path on this site is still a link');

    // The game's page has a Content-Security-Policy: a script the game runs cannot fetch an outside site. The probe is a
    // real script sent into the sandboxed frame (the editor's hot reload), so the frame itself is what refuses; the browser
    // logs the refusal in the console and the frame reports it.
    const probe = "var post=function(o){parent.postMessage(Object.assign({source:'hawkes-play',type:'log',probe:'csp'},o),'*')};"
      + "document.addEventListener('securitypolicyviolation',function(e){console.error('csp-probe: refused '+e.blockedURI+' by '+e.violatedDirective);post({blocked:e.blockedURI,directive:e.violatedDirective})});"
      + "fetch('https://example.com/probe').then(function(){post({allowed:true})},function(err){post({failed:String(err)})});";
    const seen = [];
    const onProbe = (e) => { if (e.data && e.data.probe === 'csp') seen.push(e.data); };
    window.addEventListener('message', onProbe);
    t.event('setup-shortcut', 'a game script stood in for: a script file sent into the frame (hot reload) that fetches https://example.com');
    toStage({ type: 'files', files: { 'scripts/csp-probe.js': probe } });
    await t.until(() => seen.length, 15000, 'the probe script to report');
    await t.wait(800);
    window.removeEventListener('message', onProbe);
    toStage({ type: 'files', files: { 'scripts/csp-probe.js': null } });
    const hit = seen.find((x) => x.blocked);
    if (seen.some((x) => x.allowed)) t.problem('error', 'a game script fetched https://example.com: the page has no policy against it');
    else if (!hit) t.problem('warning', `the fetch failed (${seen.map((x) => x.failed).join('; ')}) but the frame reported no policy violation`);
    else t.event('fetch-blocked', `fetch(https://example.com) refused by the page's policy: ${hit.directive}, and the console says so`);
    t.scene('A game script cannot reach another site');

    // Sharing: the game is sandboxed and cannot open the share window itself, so the editor opens it and carries the media.
    const holder = document.createElement('iframe');
    holder.style.display = 'none';
    document.body.appendChild(holder);
    const popup = holder.contentWindow;
    const got = [];
    popup.addEventListener('message', (e) => got.push(e.data));
    const realOpen = window.open;
    const opened = [];
    window.open = function (u) { opened.push(String(u)); return popup; };
    try {
      t.event('setup-shortcut', 'the share window stood in for by a hidden frame (a script cannot be given a real click)');
      fromFrame({ type: 'share-open', id: 'pt1' });
      if (!opened.some((u) => u === '/share/new')) t.problem('error', 'the editor did not open /share/new when the game asked');
      else t.event('share-window-opened', 'the editor opened /share/new for the game');
      const blob = new Blob(['photo'], { type: 'image/jpeg' });
      fromFrame({ type: 'share-media', id: 'pt1', payload: { source: 'hawkes-share', type: 'media', kind: 'photo', blob, mime: 'image/jpeg', title: 'Playtest', filename: 'p.jpg' } });
      window.dispatchEvent(new MessageEvent('message', { data: { source: 'hawkes-share', type: 'ready' }, source: popup, origin: location.origin }));
      await t.until(() => got.some((m) => m && m.type === 'media' && m.blob instanceof Blob), 5000, 'the photo to reach the share window');
      t.event('share-media-delivered', 'the photo reached the share window through the editor');
    } finally { window.open = realOpen; holder.remove(); }
  } finally { window.fetch = realFetch; }
  t.progress(1);
}

/** Pip's pier directions as an in-engine beat: cinematic to the rod, glowing marker from the beach, pickup clears it. */
async function stagePier(t, ctx) {
  await t.until(() => W() && W().player && G(), 60000, 'the island to be ready');
  // Google-only sign-up: close the forced account sheet and let Pip's tour (and the pier show) begin.
  await t.until(() => $('#gsGoogle') || (window.HawkesGuest && !window.HawkesGuest.accountFirst) || (G().events && G().events.quests && G().events.quests.state('tour') === 'active'), 25000, 'the account sheet or an already-open tour').catch(() => {});
  if (window.HawkesGuest && typeof window.HawkesGuest.playtestContinue === 'function') {
    window.HawkesGuest.playtestContinue();
    t.event('setup-shortcut', 'account sheet closed and gate lifted so Pip\'s tour can begin (playtest cannot Google-sign-up)');
  } else if (window.HawkesGuest) {
    window.HawkesGuest.accountFirst = false;
    t.event('setup-shortcut', 'account gate lifted so Pip\'s tour can begin (playtest cannot Google-sign-up)');
  }
  const q = () => G() && G().events && G().events.quests;
  const step = () => (q() && q().state('tour') === 'active' ? q().step('tour') : null);
  const markOn = () => Boolean(window.__islandRodMark && window.__islandRodMark.on);
  const cin = () => G() && G().cinematic && G().cinematic.isPlaying;
  // Wait for Pip to start the tour and the pier show (or force it if the tour is already on).
  await t.until(() => step() === 'drive' || step() === 'rod' || window.__islandPierShown, 90000, 'Pip\'s tour or pier show to start');
  t.event('tour-start', `step: ${step() || 'pending'}`);
  if (!window.__islandPierShown && typeof window.__islandShowPier === 'function') {
    t.event('setup-shortcut', 'pier show started by hand (tour began without the first-visit beat)');
    window.__islandShowPier();
  }
  await t.until(() => window.__islandPierShown || cin() || markOn(), 20000, 'the pier cinematic or rod marker');
  t.event('pier-show-start', 'Pip\'s pier directions began');
  t.progress(0.35);
  // During the fly-over: wait until the camera is holding on the rod (late in the shot) or the shot ends.
  if (cin()) {
    t.event('pier-cinematic', 'camera flying from Pip along Gravel Road to the rod');
    await t.wait(6000); // into the hold on the rod (~6.8 s of an 8 s path)
    if (cin()) t.scene('Pier: cinematic hold');
    await t.until(() => !cin(), 15000, 'the pier cinematic to end');
    t.event('pier-cinematic-done', 'camera returned after the rod hold');
  } else {
    t.event('pier-cinematic-skipped-or-done', window.__islandPierShown ? 'already shown' : 'no cinematic');
    t.scene('Pier: after show');
  }
  await t.until(() => markOn(), 8000, 'the glowing rod marker to be on');
  t.event('rod-marker-on', 'pulsing light and shimmer on the fishing rod');
  t.progress(0.55);
  // From the beach: the marker must lead the player without reading text.
  HOOKS.atBeach(t);
  await t.wait(800);
  t.scene(ctx.options.touch || (window.innerWidth < 600) ? 'Pier: marker from beach (phone)' : 'Pier: marker from beach');
  t.event('marker-from-beach', markOn() ? 'glowing marker visible from the beach' : 'marker missing');
  if (!markOn()) throw new Error('the rod marker was not on when viewed from the beach');
  t.progress(0.7);
  // Walk the pier and pick up the rod: marker clears with sound and burst.
  if (G().player && G().player.controller === 'drive') { await tap(t, 'e'); await t.wait(700); }
  await walkTo(t, 'rod', 0.7, 60000, 'the fishing rod at the end of the pier');
  await t.until(() => !markOn() || (HP().tools && HP().tools.held && HP().tools.held.name === 'rod'), 10000, 'the rod to be picked up and the marker to clear');
  if (markOn()) throw new Error('the rod marker stayed on after picking up the rod');
  t.event('rod-marker-off', 'pickup cleared the marker with a chime and burst');
  t.event('pier-show-cleared', 'acceptance: cinematic, beach marker, pickup clear');
  t.scene('Pier: marker cleared');
  t.progress(1);
  await t.wait(1200);
}


// ---------------------------------------------------------------------------------------------- the first minute after the mirror
/** The clock starts when the mirror closes: ms to the first move, to being in the 4x4 and to the first success (the pier
 *  reached, or the first fish: the game's own 'celebration' event), each logged once with a metric. Also, the beacon on the 4x4. */
function startFirstMinutes(t, ctx) {
  if (ctx.fm) return;
  const fm = (ctx.fm = { t0: performance.now(), x: null, z: null, move: null, in4x4: null, success: null, catchMs: null, celebrations: [], texts: 0 });
  const ms = () => Math.round(performance.now() - fm.t0);
  const note = (key, label, detail) => { if (fm[key] !== null) return; fm[key] = ms(); t.event(label, `${fm[key]} ms after the mirror closed${detail ? ' (' + detail + ')' : ''}`); t.metric && t.metric(label + 'Ms', fm[key]); };
  const wire = () => {
    if (!G() || !G().on) return setTimeout(wire, 300);
    G().on('celebration', (d) => {
      fm.celebrations.push(d);
      const voiced = Boolean(window.__playtestVoiced);
      t.event('celebration', `${d.step}: particles ${d.particles}, sounds ${d.sounds.join('+') || 'none'}, camera ${d.camera}`);
      if (d.step === 'drive') note('success', 'first-success', 'the 4x4 reached the pier');
      if (d.step === 'fish') { if (fm.catchMs === null) { fm.catchMs = ms(); t.metric && t.metric('firstCatchMs', fm.catchMs); } note('success', 'first-success', 'the first catch'); }
      if (!d.particles) t.problem('error', `the ${d.step} celebration made no particles`);
      if (!d.sounds.includes('ui-quest')) t.problem('error', `the ${d.step} celebration played no ui-quest sound`);
      if (d.step === 'fish' && !d.sounds.includes('fish-catch')) t.problem('error', 'the first catch played no fish-catch sound');
      void voiced;
    });
    G().on('overseer-speech', (d) => { if (d && d.state === 'start' && d.voiced) { window.__playtestVoiced = true; t.event('voiced-line', `${d.text || d.line || 'the Overseer'}`); } });
  };
  wire();
  const tick = setInterval(() => {
    const p = W() && W().player;
    if (!p) return;
    if (fm.x === null) { fm.x = p.x; fm.z = p.z; }
    if (fm.move === null && Math.hypot(p.x - fm.x, p.z - fm.z) > 0.5 && p.controls !== false) note('move', 'first-move', 'real input');
    if (fm.in4x4 === null && G() && G().player && G().player.controller === 'drive') note('in4x4', 'reached-4x4', 'in the seat');
    if (fm.success !== null && fm.catchMs !== null) clearInterval(tick);
  }, 100);
  fm.stop = () => clearInterval(tick);
}
/** Is the world point on screen? (the scene's active camera, projected) */
function onScreen(pos) {
  try {
    const B = window.BABYLON, sc = HP().world.scene, cam = sc.activeCamera, e = sc.getEngine();
    const w = e.getRenderWidth(), h = e.getRenderHeight();
    const v = B.Vector3.Project(new B.Vector3(pos[0], pos[1], pos[2]), B.Matrix.Identity(), sc.getTransformMatrix(), cam.viewport.toGlobal(w, h));
    const cw = innerWidth / w, ch = innerHeight / h;
    const x = v.x * cw, y = v.y * ch;
    return { on: v.z > 0 && v.z < 1 && x > 0 && x < innerWidth && y > 0 && y < innerHeight, x: Math.round(x), y: Math.round(y) };
  } catch { return null; }
}
const visibleTextLines = () => {
  const out = [];
  for (const el of document.querySelectorAll('.tour-track:not([hidden]), .ov-cap.on, .hc-cap, .ui-bubble, .say-bubble')) {
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    if (r.width > 4 && r.height > 4 && cs.display !== 'none' && cs.visibility !== 'hidden' && (el.textContent || '').trim()) out.push((el.textContent || '').replace(/\s+/g, ' ').trim());
  }
  return out;
};
/** Walk to a thing: the keys, or on a phone the stick (touch), as a player does. */
async function goTo(t, ctx, id, near, ms, what) {
  if (!(ctx.options.touch || HP().touchUi)) return walkTo(t, id, near, ms, what);
  const t0 = performance.now(); let s = null;
  try {
    for (;;) {
      const p = W().player, g = W().byId.get(id);
      if (!p || !g) throw new Error(`timed out waiting for ${what} to exist`);
      const dx = g.x - p.x, dz = g.z - p.z, d = Math.hypot(dx, dz);
      if (d <= near) return;
      if (performance.now() - t0 > ms) throw new Error(`timed out walking to ${what} with the stick (${Math.round(d)} m away)`);
      const yaw = camYaw(), sn = Math.sin(yaw), c = Math.cos(yaw);
      if (!s) s = stickHold();
      s.set((dx * c - dz * sn) / d, (dx * sn + dz * c) / d);
      await t.wait(80);
    }
  } finally { if (s) s.release(); }
}

async function stageDrive(t, ctx) {
  const q = () => G() && G().events && G().events.quests;
  const step = () => (q() && q().state('tour') === 'active' ? q().step('tour') : null);
  const touch = Boolean(ctx.options.touch || HP().touchUi);
  startFirstMinutes(t, ctx);
  const fm = ctx.fm;
  // The beacon: a soft light on the 4x4 as soon as the mirror is done, seen from where the player stands, with at most one line of text.
  await t.until(() => window.__islandJeepMark && window.__islandJeepMark.on, 20000, 'the beacon on the 4x4').then(() => {
    const j = W().byId.get('jeep');
    const sp = j ? onScreen([j.x, j.y + 6, j.z]) : null;
    t.scene(touch ? 'After the mirror: the beacon (phone)' : 'After the mirror: the beacon');
    t.event('beacon-on', `a column of light on the 4x4; its top ${sp ? (sp.on ? `on screen at ${sp.x},${sp.y}` : `off screen (${sp.x},${sp.y})`) : 'not measured'} at ${innerWidth}x${innerHeight}`);
    fm.beaconSeen = Boolean(sp && sp.on);
    const lines = visibleTextLines();
    t.event('text-lines', `${lines.length} on screen: ${JSON.stringify(lines)}`);
    if (lines.length > 1) t.problem('error', `after the mirror ${lines.length} lines of text are on screen (one short line at most): ${JSON.stringify(lines)}`);
  }, (e) => t.problem('error', e.message));
  t.scene('Island: the tour begins');
  await t.until(() => step() === 'drive' || step() === 'rod', 90000, 'Pip\'s tour to start (the "drive" step)');
  t.event('tour-start', `step: ${step()}`);
  // First visit: Pip's pier fly-over: a player may skip it with a key or a tap (as the intro), which a newcomer in a hurry does.
  const cin = () => G() && G().cinematic && G().cinematic.isPlaying;
  const skipShot = async () => {
    if (touch) { const c = canvas(), id = ++touchId, x = innerWidth * 0.5, y = innerHeight * 0.3; touchEv('pointerdown', c, x, y, id); touchEv('pointerup', c, x, y, id); }
    else await tap(t, 'Enter');
  };
  if (!cin() && !window.__islandPierShown) await t.wait(1500);
  if (cin()) {
    await t.wait(1500); t.scene('Island: the pier fly-over');
    await skipShot();
    t.event('pier-cinematic-skipped', `skipped with ${touch ? 'a tap' : 'a key'} after ${Math.round(performance.now() - fm.t0)} ms`);
    await t.until(() => !cin(), 5000, 'the pier cinematic to end after the skip').catch(() => {});
  }
  // The camera nudge toward the 4x4 (about 2 s): let it play out, or skip it.
  await t.wait(400);
  if (cin()) { await t.wait(900); const j = W().byId.get('jeep'); const sp = j ? onScreen([j.x, j.y + 6, j.z]) : null; if (sp && sp.on) fm.beaconSeen = true; t.scene('Island: the camera nudge to the 4x4'); t.event('camera-nudge', 'the camera turned toward the 4x4 and its light'); await t.until(() => !cin(), 4000, 'the nudge to end').catch(() => {}); }
  if (!fm.beaconSeen) t.problem('error', `the beacon was never on screen at ${innerWidth}x${innerHeight} (at the start or in the camera nudge)`);
  t.progress(0.65);
  const jeep = () => W().byId.get('jeep');
  const driving = () => G().player && G().player.controller === 'drive';
  if (step() === 'drive') {
    if (!driving()) {
      await goTo(t, ctx, 'jeep', 3.2, 40000, 'the 4x4');
      t.event('at-the-4x4');
      for (let i = 0; i < 4 && !driving(); i++) { if (touch) await tapButton(t, $('#touch .b')); else await tap(t, 'e'); await t.wait(700); }
      if (!driving()) {
        t.problem('warning', 'E did not get the player into the 4x4 (the jeep: ' + (jeep() ? Math.round(Math.hypot(jeep().x - W().player.x, jeep().z - W().player.z)) + ' m away' : 'missing') + '): the hook put them in');
        await HOOKS.enterVehicle(t, 'jeep');
      }
      if (!driving()) throw new Error('timed out getting into the 4x4 (E and hooks.enterVehicle)');
    }
    t.scene('Island: driving');
    t.event('drive-start', touch ? 'in the 4x4, the stick pushed forward' : 'in the 4x4, W held');
    let stick = null;
    if (touch) stick = stickHold(); else { keyEv('keydown', 'w'); down.add('w'); }
    // Steer to the dock by the 4x4's own heading. Which way D (or the stick's side) turns it is learned: if the error grows while steering, flip.
    let sign = 1, bad = 0, ref = null;
    const t0 = performance.now();
    try {
      while (step() === 'drive') {
        if (performance.now() - t0 > 70000) throw new Error('timed out driving to the dock (the "drive" step never passed)');
        const v = jeep().vehicle, dock = W().byId.get('dock');
        if (!v || !dock) throw new Error('timed out: the 4x4 or the dock is gone');
        const tx = dock.x - jeep().x, tz = dock.z - jeep().z;
        const err = Math.atan2(tx * v.right.x + tz * v.right.z, tx * v.fwd.x + tz * v.fwd.z); // + : the dock is to the right
        if (ref && performance.now() - ref.at > 700) { if (Math.abs(err) > Math.abs(ref.err) + 0.08) { if (++bad >= 2) { sign = -sign; bad = 0; } } else bad = 0; ref = null; }
        if (!ref && Math.abs(err) > 0.3) ref = { at: performance.now(), err };
        const steer = Math.abs(err) > 0.1 ? Math.sign(err) * sign : 0;
        if (stick) stick.set(steer, 1);
        else for (const [k, on] of [['d', steer > 0], ['a', steer < 0]]) { if (on && !down.has(k)) { down.add(k); keyEv('keydown', k); } if (!on && down.has(k)) { down.delete(k); keyEv('keyup', k); } }
        await t.wait(100);
      }
    } finally { if (stick) stick.release(); }
    releaseAll();
    t.event('dock-reached', 'the "drive" step passed');
    t.metric('driveSeconds', Math.round((performance.now() - t0) / 100) / 10);
  }
  t.scene('Island: at the dock');
  // The celebration: particles, the sounds, the camera move and the voiced line; the touch controls stay uncovered.
  await t.until(() => fm.celebrations.some((c) => c.step === 'drive'), 4000, 'the pier celebration').catch((e) => t.problem('error', e.message));
  await t.wait(500);
  t.scene(touch ? 'Pier reached: the celebration (phone)' : 'Pier reached: the celebration');
  celebrationClear(t, touch);
  if (fm.success === null) t.problem('error', 'no first success was logged after reaching the pier');
  else if (fm.success > 60000) t.problem('error', `first-success came ${fm.success} ms after the mirror closed (60000 ms or less is needed)`);
  else t.event('first-success-in-time', `${fm.success} ms (60000 or less)`);
  t.progress(0.75);
  await t.wait(2500); // Pip's line and the Overseer's
}
/** The celebration leaves the controls free: no overlay of ours sits over the stick, the buttons or the HUD zones. */
function celebrationClear(t, touch) {
  if (!touch) return;
  const hit = (a, b) => !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
  const over = [...document.querySelectorAll('.ov-cap.on .in, .ov-bars > *, .hc-cap, .tour-track:not([hidden])')].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 4 && r.height > 4);
  let bad = 0;
  for (const c of document.querySelectorAll('#touch .pad, #touch .a, #touch .b, #touch button')) { const cr = c.getBoundingClientRect(); if (cr.width && over.some((r) => hit(r, cr))) bad++; }
  t.event('celebration-controls-clear', bad ? `${bad} touch control(s) covered` : 'no touch control covered');
  if (bad) t.problem('error', `the celebration covers ${bad} touch control(s)`);
}

/** Shared world: two players in the room. The second is a stand-in (presence.standIn: a named setup shortcut, since one
 *  browser cannot be two players); everything else is what a player does: the 👥 button, a tap on a name, Mute, Report. */
async function stagePresence(t) {
  const P = () => HP().presence;
  const click = (el) => { el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' })); el.click(); };
  await t.until(() => W() && W().player && P() && P().standIn, 30000, 'the island with its presence module');
    const mira = P().standIn('Mira', { ahead: 45, color: '#f59e0b' });
  const rude = P().standIn('fuck you', { ahead: -50, color: '#ef4444' });
  if (!mira || !rude) throw new Error('could not put a second player in the room');
  t.event('second-player', 'Mira 45 m ahead; a player with an abusive name 50 m behind');
  await t.until(() => P().markers.length >= 2, 8000, 'a marker or an edge arrow for each other player');
  const mk = P().markers;
  t.event('markers', mk.map((m) => `${m.name}: ${m.mode}`).join(', '));
  t.scene('Shared world: markers');
  // The list: 👥 opens Who's here.
  const btn = $('#pr-hud [data-a=people]');
  if (!btn) throw new Error('timed out: the 👥 button is not on screen');
  click(btn);
  await t.until(() => $('.pr-panel:not([hidden]) .pr-row[data-id="' + mira + '"]'), 5000, "Who's here to list the other player");
  const rows = [...document.querySelectorAll('.pr-panel .pr-row .nm')].map((n) => n.textContent);
  t.event('people-listed', rows.join(' | '));
  if (rows.some((n) => /fuck/i.test(n))) throw new Error('the abusive name is shown in Who\'s here: ' + rows.join(' | '));
  t.event('name-replaced', 'the abusive name shows as a Player number');
  t.scene("Shared world: who's here");
  // Tap their name: beamed next to them.
  const p0 = { x: W().player.x, z: W().player.z };
  click($('.pr-panel .pr-row[data-id="' + mira + '"] .nm'));
  await t.until(() => P().lastGo && Math.hypot(W().player.x - [...W().entities].find((e) => e.netId === mira).x, W().player.z - [...W().entities].find((e) => e.netId === mira).z) < 5, 6000, 'the player to be beamed next to Mira');
  t.event('teleported', 'moved ' + Math.round(Math.hypot(W().player.x - p0.x, W().player.z - p0.z)) + ' m next to Mira');
  await t.until(() => W().scene.meshes.some((m) => /beam/.test(m.name) && m.isEnabled()), 3000, 'the beam').then(() => t.event('beam-seen'), () => t.problem('warning', 'no beam mesh was seen'));
  t.scene('Shared world: next to Mira');
  await t.wait(1600);
  // Mute her, report the other.
  click(btn);
  await t.until(() => $('.pr-panel:not([hidden]) .pr-row[data-id="' + mira + '"] [data-a=mute]'), 5000, "Who's here again");
  click($('.pr-panel .pr-row[data-id="' + mira + '"] [data-a=mute]'));
  await t.until(() => P().muted(mira), 3000, 'Mira to be muted');
  t.event('muted', 'Mira');
  click($('.pr-panel .pr-row[data-id="' + rude + '"] [data-a=report]'));
  await t.until(() => P().reported(rude), 3000, 'the other player to be reported');
  t.event('reported', 'the player with the replaced name');
  t.scene('Shared world: muted and reported');
  P().mute(mira, false);
  P().removeStandIns();
  t.progress(1);
  await t.wait(1500);
}

/** The Overseer is alive (overseer.js presence): its halo and rings answer a spoken line, a typed message turns its bay, a beam
 *  is preceded by a flare, and a hum rises as the player climbs (silent on the ground). Draw calls and frame time are compared
 *  quiet and active. Named setup shortcuts: a line is asked of the Overseer, a beam is sent, the player is held at each height. */
async function stageReact(t) {
  const R = () => HP().reactions;
  const heard = [];
  releaseAll();
  await t.until(() => W() && W().player && W().player.alive && R() && HP().work, 60000, 'the Overseer\'s reactions');
  if (G().player.controller === 'drive') { await tap(t, 'e'); await t.wait(900); }
  G().on('reaction', (d) => { heard.push(d); t.event(`reaction-${d.kind}`, d.text); t.event('overseer-said', d.text); });
  const n = (k) => R().POOLS[k].length;
  t.event('reaction-variants', `build ${n('build')}, fail ${n('fail')}, idle ${n('idle')}, thinking ${n('think')}`);
  for (const k of ['build', 'fail', 'idle']) if (n(k) < 10) t.problem('error', `only ${n(k)} ${k} variants`);
  await t.wait(5000);
  // 1. Thinking: a request begins as asking does; the pill's headline is watched.
  t.event('setup-shortcut', 'a request started as asking does (H.work.begin): asking spends credits, and sign-in is Google only');
  HP().work.begin({ text: 'a lighthouse on the point' });
  const heads = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 14000) {
    const st = HP().work.state();
    const h = st && st.headline;
    if (h && heads[heads.length - 1] !== h) heads.push(h);
    if (heads.length === 2) t.scene('Overseer: thinking');
    await t.wait(300);
  }
  t.event('thinking-shown', `${heads.length} headlines while it worked: ${heads.join(' | ')}`);
  if (heads.length < 3) t.problem('error', `the thinking line changed only ${heads.length} times in 14 s`);
  const dup = heads.some((h, i) => i && h === heads[i - 1]);
  if (dup) t.problem('error', 'the same thinking line twice in a row');
  // 2. Built, failed, built...: each ends the request the way the server's events do.
  const finish = async (ok, kind) => {
    const before = heard.length;
    HP().work.begin({ text: 'another try' });
    await t.wait(1200);
    t.event('setup-shortcut', `the request ends ${ok ? 'well' : 'badly'} (the server\'s end event)`);
    HP().work.handle(ok ? { k: 'beat', title: 'Raising it', n: 1 } : { k: 'plan', beats: [] });
    if (ok) HP().work.handle({ k: 'op' });
    HP().work.handle({ k: 'end', ok, why: ok ? undefined : 'It would not come down.' });
    await t.until(() => heard.length > before && heard[heard.length - 1].kind === kind, 60000, `the Overseer\'s ${kind} line`);
    if (kind === 'build') t.scene('Overseer: built');
    if (kind === 'fail') t.scene('Overseer: failed');
    await t.wait(2500);
  };
  HP().work.handle({ k: 'end', ok: true });
  await t.wait(2500);
  for (let i = 0; i < 3; i++) { await finish(true, 'build'); await finish(false, 'fail'); }
  // 3. Idle: the quiet wait shortened.
  t.event('setup-shortcut', 'the idle wait shortened to 8 s (it is 75 s)');
  R().IDLE_AFTER = 8; R().IDLE_GAP = 8;
  await t.until(() => heard.filter((x) => x.kind === 'idle').length >= 2, 90000, 'two idle lines');
  t.scene('Overseer: idle');
  R().IDLE_AFTER = 75; R().IDLE_GAP = 120;
  // 4. Never the same line twice in a row.
  const bad = [];
  for (const k of ['build', 'fail', 'idle']) {
    const l = heard.filter((x) => x.kind === k);
    t.event('reaction-count', `${k}: ${l.length} lines, ${new Set(l.map((x) => x.text)).size} different`);
    l.forEach((x, i) => { if (i && x.text === l[i - 1].text) bad.push(x.text); });
  }
  if (heard.some((x, i) => i && x.text === heard[i - 1].text)) bad.push('(two in a row)');
  if (bad.length) t.problem('error', `a line repeated: ${bad.join(' | ')}`);
  else t.event('no-repeat', `${heard.length} reactions, none the same as the one before`);
}

async function stageAlive(t) {
  const O = () => G().overseer.presence();
  const mon = () => { try { return HP().monitor && HP().monitor.sample ? HP().monitor.sample() : null; } catch { return null; } };
  const log = (what) => { const p = O(); t.event('overseer-presence', `${what}: speaking ${p.speaking}, halo ${p.halo && p.halo.alpha}, rings x${p.rings && p.rings.speed}, flare ${p.flare}, turn ${p.turn}, idle ${p.idle}, hum ${p.hum.level} at ${p.hum.altitude} m`); return p; };
  releaseAll();
  await t.until(() => W() && W().player && W().player.alive && G() && G().overseer && G().overseer.presence, 60000, 'the Overseer with its presence');
  if (G().player.controller === 'drive') { await tap(t, 'e'); await t.wait(900); }
  HP().speech.clear && HP().speech.clear();
  if (HP().monitor && HP().monitor.probe) HP().monitor.probe(true); // (the monitor's counters, without its panel: draw calls and frame ms)
  await t.wait(4000);
  // 1. quiet, on the ground: the hum is silent.
  const calm = log('quiet, on the ground');
  if (calm.hum.level !== 0) t.problem('error', `the hum is not silent on the ground (${calm.hum.level})`);
  else t.event('hum-silent-on-ground', 'level 0');
  t.scene('Overseer: quiet');
  await t.wait(1500);
  const m0 = mon();
  // 2. it speaks: halo and rings, for the length of the line.
  t.event('setup-shortcut', 'the Overseer asked to say a line');
  HP().speech.say({ text: 'I see you. Look up, if you like. I am not going anywhere, and neither are you.', priority: 'important' });
  await t.until(() => O().speaking > 0.8, 6000, 'the halo and rings to answer the Overseer\'s voice');
  const talk = log('speaking');
  t.scene('Overseer: speaking');
  await t.wait(1500);
  const m1 = mon();
  t.metric('haloAlphaQuiet', calm.halo.alpha); t.metric('haloAlphaSpeaking', talk.halo.alpha);
  if (talk.halo.alpha <= calm.halo.alpha + 0.1) t.problem('error', `the halo did not brighten while it spoke (${calm.halo.alpha} then ${talk.halo.alpha})`);
  else t.event('halo-brighter', `alpha ${calm.halo.alpha} quiet, ${talk.halo.alpha} speaking (+${Math.round((talk.halo.alpha - calm.halo.alpha) * 1000) / 1000})`);
  if (talk.rings.speed < 2) t.problem('error', `the rings did not quicken while it spoke (x${talk.rings.speed})`);
  else t.event('rings-quicker', `x${talk.rings.speed}`);
  await t.until(() => !HP().speech.current, 25000, 'the line to end');
  await t.until(() => O().speaking < 0.2, 8000, 'the halo and rings to settle after the line');
  const after = O();
  if (after.halo.alpha > talk.halo.alpha - 0.1) t.problem('error', `the halo did not fall back after the line (${talk.halo.alpha} then ${after.halo.alpha})`);
  else t.event('halo-settled', `alpha ${talk.halo.alpha} speaking, ${after.halo.alpha} after`);
  t.event('settled-after-line', `halo ${after.halo.alpha}`);
  // 3. a message typed in the chat: the bay turns toward the player.
  const input = document.querySelector('.hc-form input');
  if (input) {
    keyEv('keydown', 'Enter'); await t.wait(200);
    input.value = 'Are you there?';
    input.form && input.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    t.event('asked', 'typed in the chat: Are you there?');
  } else { t.event('setup-shortcut', 'the chat is not on screen: asked by the game event'); G().emit('asked', { chars: 14 }); }
  await t.until(() => O().attending, 3000, 'the Overseer to attend');
  await t.wait(3500);
  const turned = log('after the question');
  t.event('bay-turning', `turn ${turned.turn} rad (seen only while the ship is drawn in the sky)`);
  t.scene('Overseer: turned to the question');
  // 4. a beam: the emitter flares first, then the shaft opens.
  await t.wait(15000);
  t.event('setup-shortcut', 'a beam sent to a spot ahead of the player');
  const p = W().player;
  const b = G().overseer.beam([p.x + 6, p.bottom !== undefined ? p.bottom : p.y, p.z], { radius: 2.5, seconds: 2.4 });
  const f0 = log('beam asked');
  if (!b) t.problem('error', 'the beam could not be sent');
  else if (f0.flare < 0.4) t.problem('error', `the emitter did not flare before the beam (${f0.flare})`);
  else t.event('emitter-flare', `flare ${f0.flare}, shaft still closed: ${b.t < 0}`);
  t.scene('Overseer: the emitter flares');
  await t.wait(1400);
  t.scene('Overseer: the beam');
  await t.wait(2000);
  const m2 = mon();
  // 5. the hum: silent on the ground, rising as the player climbs (held at each height).
  t.event('setup-shortcut', 'the player held at 300, 1200 and 3000 m above where they stand (a climb, without flying there)');
  const base = W().player.y;
  const levels = [calm.hum.level];
  for (const up of [300, 1200, 3000]) {
    const until = performance.now() + 5000;
    while (performance.now() < until) { W().player.y = base + up; if (W().player.body && W().player.body.setLinearVelocity) try { W().player.body.setLinearVelocity(new (window.BABYLON.Vector3)(0, 0, 0)); } catch { /* fine */ } await t.wait(100); }
    const h = log(`held ${up} m up`);
    levels.push(h.hum.level);
    t.scene(`Overseer: hum at ${up} m`);
  }
  if (!(levels[1] > levels[0] && levels[2] > levels[1] && levels[3] > levels[2])) t.problem('error', `the hum did not rise with the climb (${levels.join(' < ')})`);
  else t.event('hum-rises', levels.join(' < '));
  const heard = O().hum.playing;
  t.event('hum-audio', heard ? 'the hum is playing' : 'the hum level rose, but no sound was running to hear it');
  W().player.y = base; await t.wait(6000);
  if (O().hum.level > 0.02) t.problem('warning', `the hum was still ${O().hum.level} after coming back down`);
  else t.event('hum-silent-again', 'back on the ground');
  // 6. the cost: draw calls and frame time, quiet against speaking (and beaming), against a 3 percent budget.
  const pc = O().cost;
  if (pc) t.event('presence-cost', `game.overseer.presence().cost: ${pc.drawCalls} draw calls, ${pc.frameMs} ms a frame, ${pc.fps} fps`);
  if (m0 && m1 && m2 && m0.drawCalls && m0.frameMs && m1.frameMs) {
    const d = (a, b) => Math.round((b - a) / a * 1000) / 10;
    const dc = d(m0.drawCalls, m1.drawCalls), fm = d(m0.frameMs, m1.frameMs);
    t.metric('drawCallsQuiet', m0.drawCalls); t.metric('drawCallsSpeaking', m1.drawCalls); t.metric('drawCallsBeaming', m2.drawCalls);
    t.metric('frameMsQuiet', m0.frameMs); t.metric('frameMsSpeaking', m1.frameMs);
    t.event('perf-compare', `draw calls ${m0.drawCalls} quiet, ${m1.drawCalls} speaking, ${m2.drawCalls} beaming (${dc}% speaking); frame ${m0.frameMs.toFixed(2)} ms quiet, ${m1.frameMs.toFixed(2)} ms speaking (${fm}%)`);
    // Draw calls are exact; frame time is noisy on a real device, so it gets 3 percent or 1 ms, whichever is more.
    if (dc > 3) t.problem('error', `speaking costs ${dc}% more draw calls than quiet (budget 3%)`);
    else t.event('perf-budget-draws', `${dc}% against 3%`);
    if (fm > 3 && m1.frameMs - m0.frameMs > 1) t.problem('warning', `speaking costs ${fm}% more frame time (${m0.frameMs.toFixed(2)} > ${m1.frameMs.toFixed(2)} ms; budget 3%)`);
    else t.event('perf-budget-frame', `${fm}% (${(m1.frameMs - m0.frameMs).toFixed(2)} ms) against 3%`);
  } else t.problem('error', 'the monitor gave no draw-call and frame-time numbers (perf-compare could not be made)');
  if (HP().monitor && HP().monitor.probe) HP().monitor.probe(false);
  t.progress(1);
}

/** Faces and emotes (docs/characters.md, presence-core.js feel / mood / gazeTarget): blink, gaze at the Overseer while it speaks, a
 *  hard landing and an explosion change the face, six emotes from the radial wheel, seen by a second player. Named setup
 *  shortcuts: the Overseer is asked for a line, the player is lifted so the fall is real, the blast is set off, the second player
 *  is a stand-in and its emote goes to the handler a peer's message would. */
async function stageFaces(t, ctx) {
  const P = () => HP().presence;
  const touch = Boolean(ctx.options.touch);
  const hit = (el) => { el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: touch ? 'touch' : 'mouse' })); el.click(); };
  releaseAll();
  await t.until(() => W() && W().player && W().player.alive && P() && P().face && P().face(), 60000, 'the player\'s body with its face');
  if (G().player.controller === 'drive') { await tap(t, 'e'); await t.wait(900); }
  // 1. it blinks
  const b0 = P().face().blinks;
  await t.until(() => P().face().blinks > b0, 12000, 'the character to blink');
  t.event('blinked', `${P().face().blinks - b0} blink${P().face().blinks - b0 > 1 ? 's' : ''}`);
  t.scene('Face: blinking');
  // 2. it looks at the Overseer when it speaks
  t.event('setup-shortcut', 'the Overseer asked to say a line');
  HP().speech.say({ text: 'Hello again. Look up, if you like.', priority: 'important' });
  await t.until(() => P().face().gaze === 'overseer', 6000, 'the character to look at the Overseer while it speaks');
  t.event('looked-at-overseer', 'gaze: overseer');
  t.scene('Face: looking at the Overseer');
  await t.until(() => !HP().speech.busy, 20000, 'the Overseer to finish').catch(() => {});
  // 3. a hard landing
  const p = W().player;
  t.event('setup-shortcut', 'the player lifted 30 m (the fall and the landing are the game\'s)');
  p.position = [p.x, p.y + 30, p.z]; p.velocity = [0, 0, 0];
  let seen = '';
  await t.until(() => { const m = P().face().mood; if (m) seen = m; return Boolean(m); }, 9000, 'a face for the hard landing');
  t.event('landing-face', seen);
  t.scene('Face: hard landing (' + seen + ')');
  await t.until(() => !P().face().mood, 5000, 'the face to settle').catch(() => {});
  await t.wait(600);
  // 4. an explosion
  t.event('setup-shortcut', 'a blast set off beside the player');
  HP().physics.explode([W().player.x + 3, W().player.y, W().player.z], { radius: 5, force: 6, damage: 0 });
  seen = '';
  await t.until(() => { const m = P().face().mood; if (m) seen = m; return Boolean(m); }, 4000, 'a face for the explosion');
  t.event('explosion-face', seen);
  t.scene('Face: explosion (' + seen + ')');
  await t.wait(2200);
  // 5. the emote wheel, the six emotes, and another player seeing them
  const mira = P().standIn('Mira', { ahead: 6, color: '#f59e0b' });
  if (!mira) throw new Error('could not put a second player in the room');
  const theirs = () => [...W().entities].find((e) => e.netId === mira);
  const emoteOf = (e) => { const f = P().face(e); return f && f.emote; };
  const openBtn = $('#pr-hud [data-a=emote]');
  if (!openBtn) throw new Error('timed out: the emote button is not on screen');
  const SIX = ['wave', 'laugh', 'cheer', 'shrug', 'dance', 'point'];
  for (const name of SIX) {
    if (!$('.pr-wheel:not([hidden])')) { hit(openBtn); await t.until(() => $('.pr-wheel:not([hidden])'), 4000, 'the emote wheel to open'); }
    if (name === 'wave') { t.event('wheel-open', [...document.querySelectorAll('.pr-wheel button.em')].map((b) => b.dataset.emote).join(', ')); t.scene('Emote wheel' + (touch ? ' (touch)' : '')); }
    const btn = $('.pr-wheel button.em[data-emote="' + name + '"]');
    if (!btn) throw new Error('timed out: the emote wheel has no ' + name);
    hit(btn);
    await t.until(() => emoteOf() === name, 4000, 'your ' + name);
    // what a peer's message does on this screen
    P()._internal.onEmote({ w: mira, e: name }, null);
    await t.until(() => theirs() && emoteOf(theirs()) === name, 4000, 'the other player to be seen doing ' + name);
    t.event('emote', `${name}: mine and the other player's`);
    if (name === 'wave' || name === 'shrug') t.scene('Emote: ' + name);
    await t.wait(900);
    P().stopEmote(); const th = theirs(); if (th && P()._internal.rigs.get(th)) P()._internal.rigs.get(th).emote = null;
  }
  P().removeStandIns();
  t.progress(1);
  await t.wait(800);
}

async function stageFish(t, ctx) {
  const q = () => G().events.quests;
  const step = () => (q().state('tour') === 'active' ? q().step('tour') : null);
  const strict = ctx.options.fish === 'strict';
  const touch = Boolean(ctx.options.touch || HP().touchUi);
  startFirstMinutes(t, ctx);
  const fm = ctx.fm;
  const press0 = () => (touch ? (() => { const c = canvas(), id = ++touchId; touchEv('pointerdown', c, innerWidth / 2, innerHeight * 0.4, id); return () => touchEv('pointerup', c, innerWidth / 2, innerHeight * 0.4, id); })() : (pointer('pointerdown', canvas()), () => pointer('pointerup', window)));
  try {
    if (G().player.controller === 'drive') { if (touch) await tapButton(t, $('#touch .b')); else await tap(t, 'e'); await t.wait(900); }
    t.scene('Island: the pier');
    await t.until(() => step() === 'rod' || step() === 'fish', 8000, 'the tour to ask for the rod');
    if (step() === 'rod') {
      await goTo(t, ctx, 'rod', 0.7, 45000, 'the fishing rod at the end of the pier');
      await t.until(() => step() !== 'rod', 8000, 'the rod to be picked up');
      t.event('rod-picked-up');
    }
    t.progress(0.85);
    await t.wait(1200);
    const heldRod = () => { try { const h = HP().tools.held; return h && h.name === 'rod'; } catch { return false; } };
    if (touch) { for (let i = 0; i < 5 && !heldRod(); i++) { const b = $('.mh-touch button'); if (!b) break; await tapButton(t, b); await t.wait(300); } }
    else for (const k of ['1', '2', '3', '4']) { if (heldRod()) break; await tap(t, k); await t.wait(250); }
    if (!heldRod()) throw new Error('timed out: the rod is not in hand after picking it up');
    if (touch) { await dragLook(t, -160); } else await lookAt(t, Math.PI / 2); // out to sea, east
    t.scene('Island: fishing');
    // The rod's documented hook (game.water.fish.assist, docs/api/60-water.md): every cast is a first cast, so the bite comes
    // in 2.5 to 4.5 s, as a new player's first does; the casting, hooking and reeling below are still real input.
    try { G().water.fish.assist(true); t.event('setup-shortcut', 'fishing assist on: a quick, common first bite'); } catch { /* the player's own first-catch help applies */ }
    const biting = () => { try { return G().water.fish.phase() === 'bite'; } catch { return false; } };
    for (let cast = 1; cast <= 4 && step() === 'fish'; cast++) {
      { const up = press0(); await t.wait(900 + cast * 150); up(); }
      t.event('cast', `cast ${cast}`);
      const bitten = await t.until(() => biting() || step() !== 'fish', 22000, 'a bite').then(() => biting(), () => false);
      if (!bitten) { t.event('no-bite', `cast ${cast}`); continue; }
      t.event('bite');
      { const up = press0(); await t.wait(90); up(); } // hook it
      const reel = press0(); // and reel while held
      await t.until(() => step() !== 'fish', 14000, 'the fish to be landed').then(() => 0, () => 0);
      reel();
    }
    if (step() === 'fish') throw new Error('timed out: no fish was caught in four casts');
    t.event('fish-caught', 'the "fish" step passed');
    await t.until(() => fm.celebrations.some((c) => c.step === 'fish'), 4000, 'the first-catch celebration').catch((e) => t.problem('error', e.message));
    await t.wait(400);
    t.scene(touch ? 'First catch: the celebration (phone)' : 'First catch: the celebration');
    celebrationClear(t, touch);
    const cel = fm.celebrations.find((c) => c.step === 'fish');
    if (cel) t.event('first-catch-celebration', `particles ${cel.particles}, sounds ${cel.sounds.join('+')}, camera ${cel.camera}, voiced line ${window.__playtestVoiced ? 'yes' : 'NO'}`);
    if (!window.__playtestVoiced) t.problem('error', 'no voiced Pip or Overseer line played in the first minutes');
    t.scene('Island: a fish caught');
    t.progress(1);
    await t.wait(2500);
  } catch (e) {
    if (strict) throw e;
    t.problem('warning', `fishing did not complete: ${e.message}`);
    t.event('fish-incomplete', e.message);
  } finally { pointer('pointerup', window); if (fm && fm.stop) fm.stop(); }
}

// ---------------------------------------------------------------------------------------------- the Ridge Run
/** Steers the 4x4 at a point (engine numbers) with the keys, as a careful driver: turn by the heading error (the 4x4's own
 *  right/forward: a target on the right = D), throttle when it is roughly ahead, brake for a sharp bend, and back out for a
 *  moment when it has stopped against something. Checked against the island's course by a keyboard bot (the engine test
 *  rig): a lap of the Ridge Run in about 30 s. `then` is the point after the target: near the target it aims between. */
const steer = { last: null, slow: 0, back: 0 };
function steerAt(jeep, target, then) {
  const v = jeep.vehicle, now = performance.now();
  const spd = steer.last ? Math.hypot(jeep.x - steer.last[0], jeep.z - steer.last[1]) / Math.max(0.02, (now - steer.last[2]) / 1000) : 0;
  const dt = steer.last ? (now - steer.last[2]) / 1000 : 0.1;
  steer.last = [jeep.x, jeep.z, now];
  let aim = target;
  if (then && Math.hypot(target[0] - jeep.x, target[2] - jeep.z) < 16) aim = [(target[0] * 2 + then[0]) / 3, target[1], (target[2] * 2 + then[2]) / 3];
  const tx = aim[0] - jeep.x, tz = aim[2] - jeep.z;
  const err = Math.atan2(tx * v.right.x + tz * v.right.z, tx * v.fwd.x + tz * v.fwd.z); // + : the target is to the right
  if (spd < 1) steer.slow += dt; else if (spd > 3) steer.slow = 0;
  const keys = { w: false, s: false, a: false, d: false };
  if (steer.back > 0) { steer.back -= dt; keys.s = true; keys[err > 0 ? 'a' : 'd'] = true; }
  else if (steer.slow > 2) { steer.slow = 0; steer.back = 1.4; }
  else {
    if (Math.abs(err) < 0.5 || spd < 5) keys.w = true; else if (Math.abs(err) > 1.0 && spd > 8) keys.s = true;
    if (Math.abs(err) > 0.07) keys[err > 0 ? 'd' : 'a'] = true;
  }
  setKeys(keys);
  return { err, dist: Math.hypot(target[0] - jeep.x, target[2] - jeep.z), spd };
}

async function stageRace(t, ctx) {
  const race = () => G() && G().race;
  await t.until(() => race() && race().courses && race().courses.length && G().vehicles, 90000, 'the island\'s race courses');
  const laps = Math.max(1, Number(ctx.options.laps ?? 1));
  race().setLaps('ridge', laps);
  const course = race().courses.find((c) => c.id === 'ridge');
  const g0 = course.gates[0];
  t.event('race-ready', `${course.name}: ${laps} lap${laps > 1 ? 's' : ''}, ${course.gates.length} gates${ctx.options.touch ? ', touch controls' : ''}`);
  t.progress(0.62);
  await t.wait(2500);
  const jeep = () => W().byId.get('jeep');
  const driving = () => G().player && G().player.controller === 'drive';
  const seen = [];
  G().on('race', (d) => { seen.push(d); if (d.state === 'gate') t.event('gate', `${d.index} of ${d.of}${d.delta !== null && d.delta !== undefined ? ` (${d.delta > 0 ? '+' : ''}${(d.delta / 1000).toFixed(2)} s)` : ''}`); else if (d.state === 'lap') t.event('lap', `${d.lap} of ${d.laps}`); else if (d.state === 'go') t.event('go', d.ghost ? 'with the ghost' : 'no ghost yet'); else if (d.state === 'countdown') t.event('countdown', String(d.n)); });
  if (!driving()) {
    await walkTo(t, 'jeep', 3.2, 60000, 'the 4x4');
    for (let i = 0; i < 4 && !driving(); i++) { await tap(t, 'e'); await t.wait(700); }
    if (!driving()) {
    t.problem('warning', 'E did not get the player into the 4x4 (the jeep: ' + (jeep() ? Math.round(Math.hypot(jeep().x - W().player.x, jeep().z - W().player.z)) + ' m away' : 'missing') + '): the hook put them in');
    await HOOKS.enterVehicle(t, 'jeep');
  }
  if (!driving()) throw new Error('timed out getting into the 4x4 (E and hooks.enterVehicle)');
  }
  t.event('in-the-4x4');
  const local = (x, y, z) => G().planet.toLocal([x, y, z]);
  const planetOf = (e) => { const q = G().planet.toPlanet([e.x, e.y, e.z]); return { x: q[0], z: q[2] }; };
  // The start gate faces the way its course runs; the run in is from behind it.
  const dir = (() => { const n = course.gates.length, a = course.gates[n - 1], b = course.gates[1], dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1; return { x: dx / l, z: dz / l }; })();

  const oneRun = async (label) => {
    const before = seen.length;
    let t0 = performance.now();
    // 1) to the start gate, from behind
    t.scene(`Race: to the start gate${label}`);
    while (race().state.phase === 'idle') {
      if (performance.now() - t0 > 90000) throw new Error('timed out driving through the start gate (no countdown began)');
      const j = jeep(), p = planetOf(j);
      const s = (p.x - g0.x) * dir.x + (p.z - g0.z) * dir.z;
      const lat = (p.x - g0.x) * -dir.z + (p.z - g0.z) * dir.x;
      // Behind and lined up: straight at the gate; else the point 30 m behind it first.
      const lined = s < -6 && Math.abs(lat) < 8 ? g0 : { x: g0.x - dir.x * 30, y: g0.y, z: g0.z - dir.z * 30 };
      const tg = local(lined.x, lined.y ?? g0.y, lined.z);
      steerAt(j, tg, null);
      await t.wait(80);
    }
    t.event('countdown-started', 'through the start gate');
    t.scene(`Race: countdown${label}`);
    setKeys({});
    await t.until(() => race().state.phase === 'running', 8000, 'GO after the countdown');
    t.scene(`Race: GO${label}`);
    t.event('race-go', `lit gates ahead; ${label ? 'ghost' : 'no ghost'}`);
    t.progress(0.7);
    // 2) the gates in order
    let frames = 0, last = performance.now(), worst = 0;
    const raf = () => { const n = performance.now(); frames++; worst = Math.max(worst, n - last); last = n; if (race().state.phase === 'running') requestAnimationFrame(raf); };
    requestAnimationFrame(raf);
    const tRun = performance.now();
    let shot = 0, ghostSeen = false;
    t0 = performance.now();
    while (race().state.phase === 'running') {
      if (performance.now() - t0 > 160000) throw new Error(`timed out on the course (checkpoint ${race().state.checkpoint} of ${race().state.of})`);
      const st = race().state, gate = course.gates[st.next], j = jeep();
      if (!j || !gate) break;
      const nx = course.gates[(st.next + 1) % course.gates.length];
      steerAt(j, local(gate.x, gate.y, gate.z), local(nx.x, nx.y, nx.z));
      if (st.checkpoint >= 2 && !shot) { shot = 1; t.scene(`Race: gates lit in order${label}`); }
      if (label && !ghostSeen && [...W().entities].some((e) => e.tag === 'race-ghost' && e.alive && e.visible !== false)) { ghostSeen = true; t.event('ghost-running', 'the ghost of the best run is on the course'); t.scene('Race: the ghost beside you'); }
      await t.wait(80);
    }
    releaseAll();
    const secs = (performance.now() - tRun) / 1000;
    t.metric(`raceFps${label ? 'Ghost' : ''}`, Math.round(frames / secs));
    t.metric(`raceWorstFrameMs${label ? 'Ghost' : ''}`, Math.round(worst));
    const fin = seen.slice(before).find((d) => d.state === 'finish');
    if (!fin) {
      const gone = seen.slice(before).find((d) => d.state === 'abort');
      throw new Error(gone ? `the race was called off (${gone.why})` : 'the run ended with no finish');
    }
    t.scene(`Race: finish${label}`);
    t.event('race-finish', `${(fin.ms / 1000).toFixed(2)} s${fin.isBest ? ', new best' : ''}${fin.previous ? ` (before: ${(fin.previous / 1000).toFixed(2)} s)` : ''}${fin.beatGhost ? ', beat the ghost' : ''}`);
    await t.wait(2200);
    return fin;
  };

  const first = await oneRun('');
  if (!first.isBest) t.problem('warning', 'the first finish was not reported as the best time');
  t.event('best-kept', `best ${(race().best('ridge') / 1000).toFixed(2)} s`);
  t.progress(0.85);
  if (ctx.options.ghost === false) { t.progress(1); return; }
  await t.until(() => race().state.phase === 'idle', 6000, 'the start gate to listen again');
  await t.wait(2500);
  const second = await oneRun(' (second run)');
  t.event('race-compare', `${(first.ms / 1000).toFixed(2)} s then ${(second.ms / 1000).toFixed(2)} s${second.beatGhost ? ' - beat the ghost' : ''}`);
  t.progress(1);
}

/** Chapter One's last quests. Setup shortcuts (named in the timeline): quests 4, 5 and 7 are advanced through the quest line;
 *  quests 6 and 8 are played with real input: walk up to Dolores, then fill and fly Rolo's rocket. */
async function stageChapter(t, ctx) {
  const q = () => G().events.quests;
  const step = () => (q().state('tour') === 'active' ? q().step('tour') : null);
  const seen = [];
  G().on('tour', (d) => { seen.push(d.step); t.event('quest-done', d.step); });
  G().on('beat', (d) => t.event('islander-line', `${d.who}: ${d.text}`));
  const voiced = { clip: 0, babble: 0 }; // each line a character spoke: a recorded clip (runtime.js speakRecorded) or the babble
  G().on('voiced', (d) => { if (d && d.kind === 'clip') { voiced.clip++; t.event('voice-clip', `${d.who}: ${d.url}`); } else if (d && d.kind === 'babble') { voiced.babble++; t.event('voice-babble', `${d.who}`); } });
  G().on('bay-lit', () => t.event('bay-lit', 'the Overseer\'s bay is lit on the sphere'));
  const shortcut = async (until, why) => {
    for (let i = 0; i < 9 && step() && step() !== until; i++) { t.event('setup-shortcut', `${why}: passed "${step()}"`); q().advance('tour'); await t.wait(1500); }
  };
  releaseAll();
  if (G().player.controller === 'drive') { await tap(t, 'e'); await t.wait(900); }
  await shortcut('hill', 'quests 2 to 5 (the tour so far)');
  if (step() !== 'hill') throw new Error(`the quest line is on "${step()}", not the hill`);
  t.scene('Quest 6: up the hill');
  await walkTo(t, 'dolores', 3.2, 70000, 'Dolores on the hill');
  await t.until(() => step() !== 'hill', 12000, 'Dolores to say hello (the hill quest)');
  t.event('hill-hello', 'Dolores greeted the player; quest 6 passed');
  t.scene('Quest 6: Dolores says hello');
  await t.wait(3500);
  await shortcut('launch', 'quest 7 (the helicopter flight)');
  if (step() !== 'launch') throw new Error(`the quest line is on "${step()}", not the launch pad`);
  t.scene('Quest 8: Rolo\'s rocket');
  await t.wait(2500);
  await walkTo(t, 'rocket', 4.5, 80000, 'Rolo\'s rocket on the launch pad');
  const riding = () => { try { const r = HP().vehicles && HP().vehicles.current; return Boolean(r && r.alive); } catch { return false; } };
  for (let i = 0; i < 4 && !riding(); i++) { await tap(t, 'e'); await t.wait(900); } // (the first E fills the tank, the next gets in)
  t.event(riding() ? 'rocket-boarded' : 'rocket-not-boarded');
  if (riding() && ctx.options.rocket !== 'shortcut') {
    keyEv('keydown', ' ');
    t.scene('Quest 8: the burn');
    await t.until(() => step() !== 'launch', 60000, 'the rocket to carry the player up until the planet is whole').catch(() => {});
    keyEv('keyup', ' ');
  }
  if (step() === 'launch') { t.problem('warning', 'the climb did not reach the planet in time; the last step was passed by a setup shortcut'); t.event('setup-shortcut', 'planet whole (sandbox-planet)'); G().emit('sandbox-planet', { height: 1000, mine: true }); }
  await t.until(() => q().state('tour') === 'done', 15000, 'the chapter to end');
  t.scene('Chapter One: the lit bay');
  await t.wait(7000); // Pip's "Huh. That's new." and the Overseer's closing line
  t.event('chapter-end', 'quests done: ' + seen.join(', '));
  t.metric('linesRecorded', voiced.clip); t.metric('linesTextOnly', voiced.babble);
  t.event('voices-recorded', `${voiced.clip} recorded clip(s), ${voiced.babble} babbled (text only) of ${voiced.clip + voiced.babble} spoken character lines`);
  t.progress(1);
}

/** The end of Chapter One (src/overseer-games/finale.js). Setup shortcuts, named: the quest line passed to its end and the rocket
 *  docked by the game's own dock path. Everything after is the game's own sequence; the player's act is real input (E, or a
 *  touch pointer on the big button). With touch (or skip) the non-playable shots are skipped with one tap each. */
async function stageFinale(t, ctx) {
  const F = () => window.__island && window.__island.finale;
  const touch = Boolean(ctx.options.touch || HP().touchUi);
  const skip = touch || ctx.options.skip === true;
  const mark = {};
  const at = (n) => { mark[n] = performance.now(); };
  for (const n of ['finale-start', 'finale-doors-open', 'finale-control', 'finale-input', 'finale-title', 'finale-tease', 'finale-control-returned', 'chapter-one-complete', 'finale-skip']) {
    G().on(n, (d) => { at(n); t.event(n, JSON.stringify(d || {}).slice(0, 160)); });
  }
  const lines = [];
  G().on('finale-line', (d) => { lines.push(d); t.event('finale-line', `${d.who}: ${d.text} [${d.clip ? 'recorded clip' : 'NO clip'}]`); if (!d.clip) t.problem('error', `no recording for the finale line "${d.text}"`); });
  releaseAll();
  await t.until(() => W() && W().player && W().player.alive && F() && HP().overseer && HP().overseer.dockShip, 60000, 'the world and the finale');
  if (G().player.controller === 'drive') { await tap(t, 'e'); await t.wait(900); }
  const q = () => G().events.quests;
  for (let i = 0; i < 10 && q().state('tour') === 'active'; i++) { t.event('setup-shortcut', `the quest line passed "${q().step('tour')}" (the rocket quest's end)`); q().advance('tour'); await t.wait(700); }
  await t.until(() => window.__islandPlayed && window.__islandPlayed.has('launch'), 15000, "the rocket quest's moment");
  await t.wait(5000);
  dockRocket(t);
  await t.until(() => F().state.running, 12000, 'the finale to begin after docking');
  const tapShot = async (why) => {
    await t.until(() => G().cinematic && G().cinematic.playing, 10000, 'a shot to be playing').catch(() => {});
    t.scene(`Finale: ${why}`);
    await t.wait(touch ? 2500 : 4000);
    if (skip && G().cinematic && G().cinematic.playing) {
      const up = press(canvas()); await t.wait(90); up();
      t.event('shot-skipped-by-tap', why);
    }
  };
  await t.until(() => mark['finale-doors-open'], 10000, 'the hangar doors to open');
  t.scene('Finale: the doors open');
  await tapShot('the doors, light spilling out');
  await t.until(() => !(G().cinematic && G().cinematic.playing) || mark['finale-control'], 40000, 'the doors shot to end').catch(() => {});
  if (!mark['finale-control']) { await t.wait(1800); await tapShot('the islanders gather'); }
  await t.until(() => mark['finale-control'], 60000, 'control to come back for the player\'s act');
  const ctrl = W().player.controls !== false;
  t.event('control-mid-sequence', `controls ${ctrl ? 'free' : 'LOCKED'} before the finale act`);
  if (!ctrl) t.problem('error', 'the player had no control at the finale act');
  t.scene('Finale: the player\'s turn');
  await t.until(() => $('.fn-act') && !$('.fn-act').hidden, 8000, 'the big action button');
  const r = $('.fn-act').getBoundingClientRect();
  t.event('act-button', `${Math.round(r.width)}x${Math.round(r.height)} px at ${Math.round(r.left)},${Math.round(r.top)} in ${innerWidth}x${innerHeight}`);
  if (r.height < 48 || r.width < 120) t.problem('error', 'the finale button is too small to tap');
  await t.wait(2500);
  if (touch) await tapButton(t, $('.fn-act')); else await tap(t, 'e');
  await t.until(() => mark['finale-input'], 6000, 'the finale input to be logged');
  t.scene('Finale: the sky lit');
  await t.wait(touch ? 2500 : 5000);
  if (skip && G().cinematic && G().cinematic.playing) { const up = press(canvas()); await t.wait(90); up(); t.event('shot-skipped-by-tap', 'fireworks'); }
  await t.until(() => mark['finale-title'], 20000, 'the Chapter One complete title');
  await t.wait(1800);
  t.scene('Finale: Chapter One complete');
  await t.until(() => mark['finale-tease'], 12000, 'the tease');
  await t.wait(3200);
  t.scene('Finale: the tease on the horizon');
  await t.until(() => mark['finale-control-returned'], 15000, 'control to come back after the tease');
  const gap = Math.round(mark['finale-control-returned'] - mark['finale-tease']);
  t.event('control-returned', `${Math.round(performance.now() - mark['finale-control-returned'])} ms ago; the tease began ${gap} ms before`);
  t.metric('teaseToControlMs', gap);
  const ok = W().player.controls !== false && !(G().cinematic && G().cinematic.playing);
  if (!ok) t.problem('error', 'control did not come back after the finale');
  const spoken = new Set(lines.map((l) => l.who));
  t.event('voiced-lines', `${lines.length} lines (${[...spoken].join(', ')})`);
  if (lines.length < 4) t.problem('error', `only ${lines.length} voiced finale lines`);
  if (!lines.some((l) => /free will/.test(l.text) && /shoe/.test(l.text))) t.problem('error', 'the Overseer never paid off the opening hook');
  t.metric('finaleLines', lines.length);
  await t.wait(2000);
  t.scene('Back with control, the chapter done');
  t.progress(1);
}

/** Docking, as a named setup shortcut: the game's own dock path (H.overseer.dockShip: the rocket settles on the pad, the Docked
 *  moment and `docked-pad` as a flown ship's), then the player on foot beside it. Walking from there is real input. */
function dockRocket(t) {
  const O = HP().overseer, rocket = G().entity('rocket');
  if (!rocket || !O.dockShip || !O.dockShip(rocket, true)) throw new Error('the rocket could not be docked (no rocket or no hangar)');
  t.event('setup-shortcut', 'docked: the rocket settled on the pad by the game\'s own dock path, the player on foot beside it');
}
/** The text of the lift's prompt on screen ("E Take the lift up to the Observatory"), or ''. */
const liftPrompt = () => (([...document.querySelectorAll('.hp-use button')].map((b) => b.textContent).find((x) => /lift/i.test(x))) || '').trim();
/** From beside the rocket to the lift with the keys: face the lift and hold W until the prompt shows (a named shortcut only
 *  if that does not work in 12 s: the player is put at the lift). */
async function walkToLift(t, OB) {
  const t0 = performance.now();
  while (!liftPrompt() && performance.now() - t0 < 12000 && OB().state === 'bay') {
    const p = W().player, l = OB().lift;
    await lookAt(t, Math.atan2(l[0] - p.position[0], l[2] - p.position[2]));
    setKeys({ w: true }); await t.wait(400);
  }
  setKeys({});
  if (!liftPrompt() && OB().state === 'bay') {
    t.event('setup-shortcut', 'the walk to the lift (the keys did not reach it in 12 s): the player put beside it');
    const l = OB().lift; W().player.position = [l[0], l[1] + 1.2, l[2] - 1]; await t.wait(800);
  }
}

/** The Observatory's mirror and wardrobe (touch: true taps with touch pointers, on the context button and the panel). Docking is
 *  a named setup shortcut, as in stageObservatory; the rest is played: E (or a tap) at the lift, a named walk to the mirror, E
 *  ("Change who you are") and the three questions answered again, a named walk to the wardrobe, E, the panel (every accessory
 *  and color owned, the price of asking), wearing a different accessory and color (the look changes at once, is saved to the
 *  account, and is what the room is sent), "Put it back", and Done. */
async function stageWardrobe(t, ctx) {
  const OB = () => HP().overseer && HP().overseer.observatory;
  const PR = () => HP().presence;
  const touch = Boolean(ctx.options.touch);
  const hit = async (el) => { if (touch) await tapButton(t, el); else { el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' })); el.click(); } };
  const useBtn = (label) => [...document.querySelectorAll('.hp-use button')].find((b) => b.textContent.includes(label));
  const useAt = async (label, state) => { // E, or a tap on the context button, until the state is reached
    for (let i = 0; i < 5 && !state(); i++) { const b = useBtn(label); if (touch && b) await tapButton(t, b); else await tap(t, 'e'); await t.wait(700); }
  };
  G().on('wardrobe', (d) => { if (['open', 'wear', 'keep', 'restore', 'price', 'close', 'ask'].includes(d.state)) t.event(`wardrobe-${d.state}`, [d.accessory, d.color, d.credits].filter((x) => x != null).join(' ')); });
  releaseAll();
  await t.until(() => W() && W().player && W().player.alive && OB() && OB().on, 60000, 'the Overseer\'s hangar and lift');
  if (G().player.controller === 'drive') { await tap(t, 'e'); await t.wait(900); }
  await HOOKS.dock(t);
  await t.wait(2500);
  await walkToLift(t, OB);
  await useAt('lift up', () => OB().state !== 'bay');
  await t.until(() => OB().state === 'inside', 15000, 'the lift to reach the Observatory');
  t.scene('The Observatory');
  await t.until(() => OB().gift || !OB().first, 60000, 'the gift');
  if (OB().scene) { t.event('setup-shortcut', 'the first-arrival scene skipped (the gift is still given)'); OB().skip(); }
  await t.wait(1500);
  // 1. The mirror: it is in the room, E at it, the three questions again.
  if (!OB().mirror) throw new Error('the Observatory has no mirror');
  const look0 = { ...PR().look };
  const m = OB().mirror.at;
  t.event('setup-shortcut', 'the walk across the room to the mirror');
  W().player.position = [m[0], m[1] - 1.8, m[2]]; // (the mirror module stands them in front of the glass)
  await t.wait(800);
  await useAt('Change who you are', () => $('.mr .mr-q'));
  await t.until(() => $('.mr .mr-q'), 10000, 'the mirror to open in the Observatory');
  t.scene('Observatory mirror: what are you' + (touch ? ' (touch)' : ''));
  t.event('observatory-mirror-open', ($('.mr .mr-q') || {}).textContent || '');
  await t.wait(1200);
  const question = () => ($('.mr .mr-q') || {}).textContent || '';
  const card = $('.mr [data-what="cactus"]') || $('.mr [data-what]');
  const chosen = card.dataset.what;
  await hit(card);
  t.event('mirror-answer', `what: ${chosen}`);
  await t.wait(900);
  const next = async (from) => { await hit($('.mr [data-a="next"]')); await t.until(() => question() !== from, 8000, `the mirror to leave "${from}"`); };
  await next(question());
  const dice = $('.mr [data-a="randomLook"]');
  if (dice) { await hit(dice); t.event('mirror-answer', 'look: surprise me'); await t.wait(900); }
  await next(question());
  const field = await t.until(() => $('.mr .mr-name:not(.mr-model)'), 8000, 'the name field').then(() => $('.mr .mr-name:not(.mr-model)'));
  const who = `Redo ${rand(3)}`;
  field.focus(); field.value = who; field.dispatchEvent(new Event('input', { bubbles: true }));
  await t.wait(900);
  field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await t.until(() => !$('.mr'), 10000, 'the mirror to close');
  const now = PR().look;
  t.event('observatory-mirror-redone', `${look0.what || '?'} "${look0.name || ''}" -> ${now.what} "${now.name}"`);
  if (now.what !== chosen || now.name !== who) t.problem('error', `the mirror's answers did not become the look (${now.what}, ${now.name})`);
  await t.wait(1500);
  // 2. The wardrobe.
  const w = OB().wardrobe;
  if (!w) throw new Error('the Observatory has no wardrobe');
  t.event('setup-shortcut', 'the walk across the room to the wardrobe');
  W().player.position = [w[0], w[1] + 0.4, w[2]];
  await t.wait(800);
  await useAt('Open the wardrobe', () => HP().wardrobe && HP().wardrobe.isOpen);
  await t.until(() => $('.ow'), 10000, 'the wardrobe panel');
  t.scene('Observatory wardrobe' + (touch ? ' (touch)' : ''));
  const mine = HP().wardrobe.owned();
  t.event('wardrobe-owned', `${mine.acc.length} accessories (${mine.acc.join(', ')}), ${mine.col.length} colors`);
  if (mine.acc.length < 2) t.problem('error', 'the wardrobe holds nothing but "none": the first gift should be there');
  // every button is a comfortable target
  const small = [...document.querySelectorAll('.ow button')].filter((b) => { const r = b.getBoundingClientRect(); return r.width < 47.5 || r.height < 47.5; });
  t.event('wardrobe-targets', small.length ? `${small.length} buttons under 48 px` : 'every button is 48 px or more');
  if (small.length) t.problem('error', `${small.length} wardrobe buttons are under 48 px`);
  await t.until(() => HP().wardrobe.price !== undefined || !HP().assistant, 8000, 'the price of asking').catch(() => {});
  const price = HP().wardrobe.price;
  t.event('wardrobe-price', price ? `a message costs ${price.credits} credits` : 'no price shown (no account on this page)');
  await t.wait(800);
  const before = PR().look.accessory;
  const other = [...document.querySelectorAll('.ow [data-acc]')].find((b) => b.dataset.acc !== before && b.dataset.acc !== 'none') || [...document.querySelectorAll('.ow [data-acc]')].find((b) => b.dataset.acc !== before);
  await hit(other);
  await t.wait(700);
  const swatch = [...document.querySelectorAll('.ow [data-col]')].find((b) => b.dataset.col !== String(PR().look.accessoryColor).toLowerCase());
  if (swatch) { await hit(swatch); await t.wait(700); }
  const worn = { ...PR().look };
  t.event('wardrobe-worn', `${worn.accessory} in ${worn.accessoryColor} (it was ${before})`);
  if (worn.accessory !== other.dataset.acc) t.problem('error', `tapping ${other.dataset.acc} did not put it on (${worn.accessory})`);
  t.scene('Observatory wardrobe: the live preview');
  await t.wait(1500);
  // kept: the look saved to the account (what the room is sent is the same look: presence.setLook saves and resends together)
  await t.wait(1500);
  const saved = await fetch('/v1/users/me/avatar', { credentials: 'include' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const sv = saved && (saved.avatar || saved);
  if (sv && sv.accessory) {
    t.event('look-kept', `the account holds ${sv.accessory} in ${sv.accessoryColor}`);
    if (sv.accessory !== worn.accessory) t.problem('error', `the account has ${sv.accessory}, the player wears ${worn.accessory}`);
  } else t.event('look-kept', 'no account answer (a guest page keeps it on this device)');
  await hit($('.ow [data-a="restore"]'));
  await t.wait(600);
  t.event('wardrobe-restored', `back to ${PR().look.accessory}`);
  await hit($('.ow [data-a="done"]'));
  await t.until(() => !$('.ow'), 6000, 'the wardrobe to close');
  if (W().player.controls === false) throw new Error('the player was left without controls after the wardrobe');
  t.scene('Back in the room');
  await t.wait(1500);
  t.event('wardrobe-done', touch ? 'with touch' : 'with the keyboard and mouse');
  t.progress(1);
}

/** The Observatory. Docking itself is a named setup shortcut (the rocket put on the pad, the player on foot beside the lift);
 *  the rest is played: E at the lift, the first arrival, walking in the room, E at the lift down, and later the quick return. */
async function stageObservatory(t, ctx) {
  const OB = () => HP().overseer && HP().overseer.observatory;
  const seen = [];
  G().on('observatory', (d) => { seen.push(d.state); t.event(`observatory-${d.state}`, d.first ? 'the first time' : 'a return'); });
  G().on('observatory-gift', (d) => t.event('observatory-gift', `${d.label} (${d.gift})`));
  releaseAll();
  await t.until(() => W() && W().player && W().player.alive && OB() && OB().on, 60000, 'the Overseer\'s hangar and lift to exist');
  if (G().player.controller === 'drive') { await tap(t, 'e'); await t.wait(900); }
  const toBay = () => HOOKS.dock(t);
  await toBay();
  await t.wait(2500);
  await walkToLift(t, OB);
  t.scene('The hangar: the lift');
  const prompt = liftPrompt();
  t.event('lift-prompt', prompt || 'NO prompt');
  if (!prompt) t.problem('error', 'standing at the lift, no "Take the lift up" prompt is on screen');
  const t0 = performance.now();
  for (let i = 0; i < 4 && OB().state === 'bay'; i++) { await tap(t, 'e'); await t.wait(700); }
  if (OB().state !== 'bay') t.event('lift-riding', `${OB().state} after E`);
  await t.until(() => OB().state === 'inside', 15000, 'the lift to reach the Observatory');
  t.event('observatory-reached', `${Math.round(performance.now() - t0)} ms after E`);
  t.scene('The Observatory: arrival');
  t.event('observatory-music', OB().music ? 'the music bed is playing' : 'no music bed');
  await t.wait(9000);
  t.scene('The Observatory: the pearl and the windows');
  t.event('observatory-pearl', 'the Overseer\'s light-form at ' + OB().pearl.map((x) => Math.round(x)).join(', '));
  // Look round for a while, as a player does: a short walk forward and back.
  setKeys({ w: true }); await t.wait(1600); setKeys({ s: true }); await t.wait(1600); setKeys({});
  await t.until(() => OB().gift || !OB().first, 45000, 'the gift');
  t.event('observatory-gift-given', `the gift: ${OB().gift}`);
  try { const log = HP().speech && HP().speech.log; if (log) for (const l of log.slice(-8)) t.event('overseer-said', String(l.text || l).slice(0, 200)); } catch { /* no log */ }
  t.scene('The Observatory: the gift');
  await t.until(() => !OB().scene, 45000, 'the first-arrival scene to end');
  await t.wait(2000);
  t.scene('The Observatory: the question left open');
  // The way down: E at the lift.
  const l = OB().liftRoom;
  W().player.position = [l[0], l[1] + 0.4, l[2] - 1];
  t.event('setup-shortcut', 'the walk across the room to the lift down: the player put beside it');
  await t.wait(500);
  const t1 = performance.now();
  for (let i = 0; i < 4 && OB().state === 'inside'; i++) { await tap(t, 'e'); await t.wait(700); }
  await t.until(() => OB().state === 'bay', 15000, 'the lift down to the bay');
  const rocket = G().entity('rocket');
  t.event('back-in-bay', `${Math.round(performance.now() - t1)} ms; the rocket ${rocket && rocket.alive ? 'is there' : 'is missing'}; controls ${W().player.controls === false ? 'LOCKED' : 'free'}`);
  if (W().player.controls === false) throw new Error('the player was left without controls after the lift down');
  t.scene('Back in the bay, beside the rocket');
  await t.wait(2500);
  if (ctx.options.again !== false) {
    await toBay();
    await t.wait(1500);
    const t2 = performance.now();
    const say0 = (HP().speech && HP().speech.log ? HP().speech.log.length : 0);
    for (let i = 0; i < 4 && OB().state === 'bay'; i++) { await tap(t, 'e'); await t.wait(700); }
    await t.until(() => OB().state === 'inside' && !OB().scene, 12000, 'the quick return');
    await t.until(() => (HP().speech && HP().speech.log ? HP().speech.log.length : 1) > say0 || performance.now() - t2 > 9000, 10000, 'its short line').catch(() => {});
    const ms = Math.round(performance.now() - t2);
    t.event('observatory-return', `${ms} ms from E to the room and its line (${ms < 10000 ? 'under' : 'OVER'} 10 s)`);
    t.scene('The Observatory: a quick return');
    if (ms >= 10000) t.problem('error', `the quick return took ${ms} ms`);
    await t.wait(2500);
    OB().leave();
    await t.until(() => OB().state === 'bay', 15000, 'the lift down again');
    t.event('back-in-bay', 'the second time');
  }
  t.event('observatory-done', seen.join(', '));
  t.progress(1);
}

/** The journal: open it from its button, find lore with E on the island, read it in the journal, and see it kept after a return. */
async function stageJournal(t, ctx) {
  const J = () => window.__island && window.__island.journal;
  const shown = () => { const el = $('.jr'); return Boolean(el && !el.hidden); };
  const summary = () => { const m = J().model(); return `quests ${m.done}/8, met ${m.cast.filter((c) => c.met).length}/6, lore ${m.lore.filter((l) => l.found).length}/12`; };
  G().on('lore-found', (d) => t.event('lore-found', `${d.n}. ${d.title}`));
  releaseAll();
  await t.until(() => J() && $('.jr-btn'), 20000, 'the journal button');
  const vw = window.innerWidth;
  t.event('viewport', `${vw}x${window.innerHeight}`);
  $('.jr-btn').click();
  await t.until(shown, 5000, 'the journal to open');
  const html = $('.jr').innerHTML;
  const eight = (html.match(/class="jr-q /g) || []).length;
  t.event('journal-opened', `${summary()}; ${eight} quests listed; the panel is ${Math.round($('.jr').getBoundingClientRect().width)} px wide and ends ${Math.round(window.innerHeight - $('.jr').getBoundingClientRect().bottom)} px above the bottom`);
  if (eight !== 8) t.problem('error', `the journal lists ${eight} quests, not 8`);
  t.scene('Journal: opened');
  await t.wait(1500);
  keyEv('keydown', 'Escape'); keyEv('keyup', 'Escape');
  await t.until(() => !shown(), 4000, 'Esc to close the journal');
  t.event('journal-closed');
  // Lore on the island: walk to each and press E.
  const before = J().model().lore.filter((l) => l.found).length;
  for (const [id, name] of [['lore_chair', 'the beach chair'], ['lamp_a', 'the dock lamp'], ['lore_drawing', 'the faded drawing'], ['lore_rock', 'the scratched rock']]) {
    try {
      await walkTo(t, id, 1.9, 70000, name);
      await t.wait(400);
      await tap(t, 'e');
      await t.wait(900);
      t.scene(`Lore: ${name}`);
    } catch (e) { t.problem('warning', `could not walk to ${name}: ${e.message}`); }
  }
  let found = J().model().lore.filter((l) => l.found).length - before;
  if (found < 4) {
    for (const id of ['chair', 'lamp', 'drawing', 'tally']) if (!J().model().lore.find((l) => l.id === id).found) { t.event('setup-shortcut', `found ${id} (could not be reached on foot in time)`); J().find(id); }
    found = J().model().lore.filter((l) => l.found).length - before;
  }
  t.event('lore-found-total', `${found} found by walking and E`);
  $('.jr-btn').click();
  await t.until(shown, 5000, 'the journal to open again');
  const text = $('.jr').innerHTML;
  const withText = J().model().lore.filter((l) => l.found && text.includes(l.title)).length;
  t.event('journal-lore', `${summary()}; ${withText} found items are in the journal with their text`);
  t.scene('Journal: lore found');
  if (withText < 4) t.problem('error', `only ${withText} found lore items show in the journal`);
  await t.wait(1500);
  $('.jr-x').click();
  await t.until(() => !shown(), 4000, 'the journal to close');
  // After a return: the Overseer's memory read back from this device (a named shortcut: the page itself is not reloaded).
  const mem = HP().memory;
  const had = mem.journal.get();
  t.event('setup-shortcut', 'return: the Overseer\'s memory re-read from the device');
  mem.reload();
  const back = mem.journal.get();
  t.event('kept-after-return', `lore ${back.lore.length} (had ${had.lore.length}), neighbours met ${back.met.length} (had ${had.met.length})`);
  if (back.lore.length < had.lore.length || back.met.length < had.met.length) t.problem('error', 'the journal lost something on a return');
  J().open('playtest');
  await t.wait(800);
  t.scene('Journal: after a return');
  J().close();
  t.event('journal-done', summary());
  t.progress(1);
}

/** Progress (docs/story.md, "Progress"): drive (real input) and see points in the HUD, reach a level (quests earned by a named
 *  shortcut), hear the Overseer's moment, find the unlocks in the wardrobe and on the tool belt, and see them kept after a return. */
async function stageProgress(t, ctx) {
  const PG = () => HP().progress;
  const hud = () => $('.pg-hud');
  const hudText = () => { const h = hud(); return h && !h.hidden ? h.textContent.replace(/\s+/g, ' ').trim() : ''; };
  G().on('progress', (d) => { if (d.state === 'earn') t.event('points-earned', `+${d.pts} ${d.label}; ${d.total} total, level ${d.level}`); else if (d.state === 'level') t.event('level-up', `level ${d.level}: ${d.unlocks.join(', ')}`); else if (d.state === 'unlock') t.event('unlock', `${d.key} (${d.label})`); else if (d.state === 'moment') t.event('overseer-moment', d.text); });
  G().on('overseer-line', (d) => t.event('overseer-said', d.text));
  releaseAll();
  await t.until(() => W() && W().player && W().player.alive && PG() && PG().state.loaded, 60000, 'progress to load');
  await t.until(() => hudText(), 20000, 'the progress HUD');
  t.event('hud-visible', hudText());
  t.scene('Progress: the HUD');
  // Real input: into the 4x4, forward for a while (the first drive, then the meters).
  const before = PG().state.pts;
  const jeep = () => W().byId.get('jeep');
  const driving = () => G().player && G().player.controller === 'drive';
  // Pip comes over after the sign-up and offers the tour in a modal card; while it is open E never reaches the 4x4: close it like a player (Not now).
  const closeCard = () => { const qs = G().events && G().events.quests; if (qs && qs.close) qs.close(); document.querySelectorAll('.qs-panel').forEach((n) => n.remove()); };
  // The layout, as the player sees it: Pip's card (if it is up) with Accept / Not now whole on the screen, and no two top-left cards overlapping.
  const layoutCheck = (label) => {
    const TLY = HP().touchLayout, c = TLY && TLY.hudCheck ? TLY.hudCheck() : null;
    if (!c) { t.problem('error', 'H.touchLayout.hudCheck is missing'); return; }
    if (c.card) t.event('quest-card-fits', `${c.w}x${c.h}: card ${c.card.w}x${c.card.h} at ${c.card.x},${c.card.y}; ${c.card.buttons.map((b) => `${b.label} ${b.visible ? 'visible' : 'CUT OFF'}`).join(', ')}`);
    t.event('hud-no-overlap', `${label} ${c.text}`);
    if (!c.ok) t.problem('error', `layout (${label}): ${c.problems.join('; ')}`);
  };
  await t.wait(1500);
  layoutCheck('with Pip\'s card');
  if (!driving()) {
    closeCard();
    await t.wait(300);
    layoutCheck('cards and Quests button');
    await walkTo(t, 'jeep', 3.2, 40000, 'the 4x4');
    for (let i = 0; i < 4 && !driving(); i++) { closeCard(); await tap(t, 'e'); await t.wait(700); }
  }
  if (!driving()) {
    t.problem('warning', 'E did not get the player into the 4x4 (the jeep: ' + (jeep() ? Math.round(Math.hypot(jeep().x - W().player.x, jeep().z - W().player.z)) + ' m away' : 'missing') + '): the hook put them in');
    await HOOKS.enterVehicle(t, 'jeep');
  }
  if (!driving()) throw new Error('timed out getting into the 4x4 (E and hooks.enterVehicle)');
  keyEv('keydown', 'w'); down.add('w');
  await t.until(() => PG().state.pts > before, 20000, 'points for the first drive');
  await t.wait(6000);
  releaseAll();
  t.event('driving-earned', `${PG().state.pts - before} points; HUD: ${hudText()}`);
  t.scene('Progress: points after driving');
  if (!(PG().state.pts > before)) t.problem('error', 'driving earned nothing');
  await tap(t, 'e'); await t.wait(900);
  // A level: quests done are earned by a named shortcut (the quest line itself is another scenario's).
  const lvl0 = PG().state.level;
  t.event('setup-shortcut', 'quests done: the points of a few quests, earned through the same table');
  // The HUD must move in the frame of the award, with a count-up (not all at once), and the level's line must not wait.
  const hudPts = () => (PG().hud || {}).shown;
  const shownBefore = hudPts(), t0 = performance.now();
  let gotQ = 0;
  while (!gotQ) { gotQ = PG().earn('quest'); if (!gotQ) await t.wait(300); }
  const shownNow = hudPts(), ms = Math.round(performance.now() - t0);
  t.event('hud-updated', `+${gotQ}: HUD ${shownBefore} -> ${shownNow} of ${PG().state.pts} in the same call (${ms} ms incl. waiting to count)`);
  if (!(shownNow > shownBefore)) t.problem('error', 'the HUD did not move in the frame of the award');
  await t.wait(120);
  const mid = hudPts();
  await t.wait(700);
  t.event('hud-count-up', `${shownNow} -> ${mid} -> ${hudPts()} (target ${PG().state.pts}); flashes ${(PG().hud || {}).flashes}`);
  if (hudPts() !== PG().state.pts) t.problem('error', 'the HUD count-up did not reach the points earned');
  const lvlAt = performance.now();
  while (PG().state.level < 2) { if (!PG().earn('quest')) await t.wait(300); }
  const speaking = HP().speech && HP().speech.busy;
  t.event('level-moment-timing', `level ${PG().state.level} reached; moments waiting ${PG().waiting}${PG().waiting ? ' (another line was speaking)' : ' (said at once)'}; ${Math.round(performance.now() - lvlAt)} ms`);
  layoutCheck('level pill and wish note after a level-up');
  await t.until(() => PG().waiting === 0, 40000, 'the Overseer\'s moment');
  t.event('level-reached', `level ${lvl0} -> ${PG().state.level}; HUD: ${hudText()}`);
  t.scene('Progress: level up');
  await t.wait(1500);
  const wardrobe = () => HP().memory.wardrobe.get();
  if (!wardrobe().acc.includes('goggles')) t.problem('error', 'the goggles are not in the wardrobe after level 2');
  t.event('wardrobe-has', `accessories ${wardrobe().acc.join(', ')}; colors ${wardrobe().col.join(', ')}`);
  // The tool belt: level 4 gives the grenades.
  while (PG().state.level < 4) { if (!PG().earn('quest')) await t.wait(300); }
  await t.until(() => PG().waiting === 0, 40000, 'the second moment');
  await t.until(() => HP().mayhem && HP().mayhem.belt.includes('grenade'), 10000, 'the grenades on the tool belt');
  t.event('belt-has', HP().mayhem.belt.join(', '));
  t.scene('Progress: the tool belt');
  // Kept after a return: the memory re-read from this device (a named shortcut: the page is not reloaded).
  const pts = PG().state.pts;
  t.event('setup-shortcut', 'return: the Overseer\'s memory re-read from the device');
  HP().memory.reload();
  HP().memory.progress.get();
  const kept = HP().memory.progress.get();
  t.event('kept-after-return', `${kept.p} points (had ${pts}); wardrobe ${wardrobe().acc.length} accessories`);
  if (kept.p < pts || !wardrobe().acc.includes('goggles')) t.problem('error', 'progress or its unlocks were lost on a return');
  t.progress(1);
}

/** The daily wish (docs/story.md, "The daily wish"): today's wish in the HUD, spoken once; done (a named shortcut: its own events are fed); points and a line; the streak over days that pass (a named shortcut: the wish's clock) and its quiet reset. */
async function stageWish(t, ctx) {
  const WS = () => HP().wish;
  const WC = () => HP().wishCore;
  const hud = () => { const h = $('.wh-hud'); return h && !h.hidden ? h.textContent.replace(/\s+/g, ' ').trim() : ''; };
  const said = [];
  G().on('wish', (d) => {
    if (d.state === 'offer') t.event('wish-spoken', d.text);
    else if (d.state === 'line') { said.push(d.text); t.event('overseer-said', d.text); }
    else if (d.state === 'progress') t.event('wish-progress', `${d.n} / ${d.of}`);
    else if (d.state === 'done') t.event('wish-done', `${d.id}: +${d.pts} points, streak ${d.streak}${d.gift ? `, gift ${d.gift}` : ''}`);
    else if (d.state === 'day') t.event('wish-new-day', d.id);
  });
  G().on('progress', (d) => { if (d.state === 'earn' && d.id === 'wish') t.event('points-earned', `+${d.pts} ${d.label}; ${d.total} total`); });
  releaseAll();
  await t.until(() => W() && W().player && W().player.alive && WS() && WS().state.loaded && WS().state.wish, 60000, 'the daily wish to load');
  await t.until(() => hud(), 30000, 'the wish in the HUD');
  const day0 = WC().dayKey(Date.now());
  const own = WC().wishFor(day0);
  t.event('wish-hud', `${WC().dayKey(WS().clock.now())}: ${hud()}`);
  if (WS().state.wish !== own.id && WS().state.wish !== WC().INSTEAD[own.needs]) t.problem('error', `the HUD shows ${WS().state.wish}, not the wish of ${day0} (${own.id})`);
  t.event('same-for-everyone', `${day0} -> ${own.id} (a pure function of the UTC date)`);
  await t.until(() => WS().record().said === 1, 30000, 'the Overseer to speak the wish');
  t.scene('Daily wish: in the HUD');
  const finish = async (label) => {
    const w = WC().byId(WS().state.wish);
    t.event('setup-shortcut', `${label}: the events of "${w.hud}" fed to the game`);
    for (const e of WC().eventsFor(w)) WS().feed(e);
    await t.until(() => WS().state.done, 8000, 'the wish to be done');
  };
  const pts0 = HP().progress.state.pts;
  await finish('wish done');
  await t.until(() => WS().waiting === 0, 40000, 'the Overseer\'s line');
  t.event('wish-points', `${HP().progress.state.pts - pts0} points; HUD: ${hud()}`);
  if (!(HP().progress.state.pts > pts0)) t.problem('error', 'finishing the wish earned nothing');
  t.scene('Daily wish: done');
  if (WS().state.streak !== 1) t.problem('error', `the streak is ${WS().state.streak} after the first wish`);
  const day = (n) => Date.now() + n * 86400000;
  const pass = async (n, label) => {
    t.event('setup-shortcut', `${label}: the wish's clock moved to ${WC().dayKey(day(n))}`);
    WS().clock.now = () => day(n);
    await t.until(() => WS().state.day === WC().dayKey(day(n)), 15000, 'the new day');
    await t.until(() => hud(), 8000, 'the new wish in the HUD');
  };
  await pass(1, 'one day passes');
  t.event('wish-hud', `${WS().state.day}: ${hud()}`);
  if (WS().state.streak !== 1) t.problem('error', `yesterday's streak should still show, it shows ${WS().state.streak}`);
  await finish('the second day\'s wish done');
  await t.until(() => WS().state.streak === 2, 8000, 'the streak at 2');
  t.event('streak-counted', `${WS().state.streak} days in a row; HUD: ${hud()}`);
  t.scene('Daily wish: a streak of two');
  await t.until(() => WS().waiting === 0, 40000, 'the Overseer\'s line');
  said.length = 0;
  await pass(4, 'three days pass with no wish done');
  await t.wait(2500);
  const bad = said.filter((x) => /streak|miss|lost|reset|broke|days/i.test(x));
  t.event('streak-reset-quiet', `streak ${WS().state.streak}; HUD: ${hud()}; said since: ${said.length ? said.join(' | ') : 'nothing'}`);
  if (WS().state.streak !== 0 || /in a row/.test(hud()) || bad.length) t.problem('error', `a missed day should reset the streak quietly (streak ${WS().state.streak}, said: ${bad.join(' | ')})`);
  t.scene('Daily wish: after a missed day');
  await finish('the new wish done');
  await t.until(() => WS().state.streak === 1, 8000, 'the streak to begin again at 1');
  t.event('streak-begins-again', `${WS().state.streak} day in a row (best ${WS().state.best})`);
  t.progress(1);
}

const GAMES = [['fps-arena', 'Bot Arena'], ['sky-racer', 'Sky Racer'], ['platform-run', 'Leap']];
/** The travel board (docs/story.md, "The travel board"). On the sandbox: dock (a named shortcut), the lift, the board's three
 *  planets and their live counts, then E under the next game. On the game's page (stageGame) and back again, three times. */
async function stageBoard(t, ctx) {
  const OB = () => HP().overseer && HP().overseer.observatory;
  const games = Array.isArray(ctx.options.games) && ctx.options.games.length ? GAMES.filter((g) => ctx.options.games.includes(g[0])) : GAMES;
  G() && G().on('observatory', (d) => { if (['travel', 'beam-down', 'return', 'enter', 'ready'].includes(d.state)) t.event(`observatory-${d.state}`, d.name || d.game || ''); });
  releaseAll();
  await t.until(() => W() && W().player && W().player.alive && OB() && OB().on, 60000, 'the Overseer\'s hangar and the Observatory to exist');
  const visit = ctx.visit || 0;
  if (ctx.leg === 'back') {
    await t.until(() => OB().state === 'inside' && !OB().traveling, 40000, 'the beam back into the Observatory');
    const b = OB().board[1], p = W().player.position;
    const d = Math.hypot(p[0] - b.at[0], p[2] - b.at[2]);
    t.event('returned-to-board', `${Math.round(d)} m from the middle planet; controls ${W().player.controls === false ? 'LOCKED' : 'free'}`);
    await t.until(() => W().player.controls !== false, 8000, 'the controls to come back');
    if (d > 12) t.problem('error', `back from ${games[visit - 1] ? games[visit - 1][1] : 'the game'} but ${Math.round(d)} m from the board`);
    t.scene(`Back at the board${games[visit - 1] ? ` from ${games[visit - 1][1]}` : ''}`);
    await t.wait(2500);
    if (visit >= games.length) { t.event('board-done', `${games.length} games visited and returned from`); t.progress(1); return; }
  } else {
    if (G().player.controller === 'drive') { await tap(t, 'e'); await t.wait(900); }
    await HOOKS.dock(t);
    await t.wait(2500);
    await walkToLift(t, OB);
    for (let i = 0; i < 4 && OB().state === 'bay'; i++) { await tap(t, 'e'); await t.wait(700); }
    await t.until(() => OB().state === 'inside', 15000, 'the lift to reach the Observatory');
    if (OB().scene) { t.event('setup-shortcut', 'the first-arrival scene skipped (its own scenario plays it)'); OB().skip(); }
    await t.wait(1500);
  }
  // The board.
  await t.until(() => OB().board.length === 3 && OB().board.every((b) => b.count !== null), 25000, 'the board\'s live counts').catch(() => t.problem('warning', 'the planets showed no live counts'));
  const board = OB().board;
  t.event('board-listed', board.map((b) => `${b.name}: ${b.count === null ? '?' : b.count} playing`).join('; '));
  if (board.length !== 3) throw new Error(`the board lists ${board.length} planets, not 3`);
  const [id, name] = games[visit];
  const target = board.find((b) => b.id === id);
  const look = HP().presence && HP().presence.look;
  ctx.name = look && look.name; ctx.what = look && look.what; ctx.visit = visit + 1;
  t.event('setup-shortcut', `walked across the room: standing under ${name}`);
  W().player.position = [target.at[0], target.at[1] + 0.5, target.at[2]];
  await t.wait(1200);
  t.scene(`The travel board: ${name}`);
  G().on('observatory', (d) => { if (d.state === 'beam-down') writeRun({ ...ctx.saved(), leg: 'game', visit: visit + 1 }); });
  for (let i = 0; i < 5 && !OB().traveling; i++) { await tap(t, 'e'); await t.wait(700); }
  await t.until(() => OB().traveling, 5000, `E under ${name} to start the trip`);
  t.event('travel-chosen', `${name} (${(target.count === null ? '?' : target.count)} playing)`);
  await t.wait(2200);
  t.scene(`Beamed away to ${name}`);
  await t.wait(30000); // (the page changes; this never finishes)
  throw new Error(`the beam-down to ${name} did not open the game`);
}

/** On a featured game's page: the character arrived, then Esc twice and Return to the Observatory. */
async function stageGame(t, ctx) {
  const tpl = location.pathname.split('/')[3];
  const [, name] = GAMES.find((g) => g[0] === tpl) || [tpl, tpl];
  await t.until(() => W() && W().player && W().player.alive, 60000, `${name} to start`);
  t.event('game-opened', `${name} (/play/t/${tpl})`);
  await t.until(() => { const l = HP().presence && HP().presence.look; return l && (!ctx.name || l.name === ctx.name); }, 25000, 'the character\'s name to arrive').catch(() => {});
  const look = HP().presence && HP().presence.look;
  const okName = !ctx.name || (look && look.name === ctx.name);
  const okWhat = !ctx.what || (look && look.what === ctx.what);
  t.event('character-arrived', `name "${look && look.name}" (sent "${ctx.name || ''}"), body ${look && look.what} (sent ${ctx.what || '?'})`);
  if (!okName || !okWhat) t.problem('error', `the character did not arrive in ${name}: ${look && look.name}/${look && look.what}, expected ${ctx.name}/${ctx.what}`);
  await t.wait(3500);
  t.scene(`${name}: beamed down`);
  await t.wait(2500);
  const esc = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  esc();
  await t.until(() => [...document.querySelectorAll('.gm-btn, .ui-menu-items button')].some((b) => /Return to the Observatory/.test(b.textContent)), 5000, 'the game menu (Esc once)');
  t.scene(`${name}: the pause menu`);
  t.event('pause-menu', 'Esc opened it, with Return to the Observatory');
  await t.wait(800);
  writeRun({ ...ctx.saved(), leg: 'back', visit: ctx.visit });
  [...document.querySelectorAll('.gm-btn, .ui-menu-items button')].find((b) => /Return to the Observatory/.test(b.textContent)).click();
  t.event('return-chosen', name);
  await t.wait(30000);
  throw new Error(`Return to the Observatory did not leave ${name}`);
}

// ---------------------------------------------------------------------------------------------- a second visit
/** The end of the first visit: what is true now is written down, and the island is opened again (the page changes). */
async function stageLeave(t, ctx) {
  const q = G().events.quests;
  const look = HP().presence && HP().presence.look;
  ctx.name = look && look.name;
  ctx.tour = q.state('tour') === 'active' ? q.step('tour') : q.state('tour');
  t.event('first-visit-done', `intro, mirror, account and tour all played; named "${ctx.name || ''}"; the tour is on "${ctx.tour}"`);
  if (ctx.tour === 'drive' || !ctx.tour) t.problem('error', 'the tour did not move past the first step on the first visit');
  await t.wait(4000); // (the record and the island are saved)
  t.scene('Leaving the island');
  writeRun({ ...ctx.saved(), leg: 'return' });
  t.event('second-visit', 'opening /play/sandbox again, same storage');
  location.href = '/play/sandbox';
  await t.wait(30000);
  throw new Error('the island did not reopen');
}

/** The second visit: nothing of the beginning plays, the Overseer welcomes the player by name, the tour is where it was. */
async function stageBack(t, ctx) {
  let intro = false;
  await stageVeil(t, ctx);
  await t.until(() => G() && G().on, 20000, 'the game events').catch(() => {});
  G().on('intro', (d) => { if (d && d.state === 'start') intro = true; });
  const q = () => G().events && G().events.quests;
  t.event('returned', `${location.pathname}; intro wanted: ${Boolean(HP().overseer && HP().overseer.introWanted && HP().overseer.introWanted())}`);
  t.scene('Second visit: beamed in');
  const name = ctx.name || '';
  const said = await t.until(() => document.body.innerText.includes(name ? `Welcome back, ${name}` : 'Welcome back'), 30000, 'the Overseer to welcome the player back by name').then(() => true, (e) => { t.problem('error', e.message); return false; });
  if (said) t.event('welcomed-back', name ? `by name: ${name}` : 'no name given');
  t.scene('Second visit: welcomed back');
  // The tour picks up on the step it was left on.
  await t.until(() => q() && q().state('tour') === 'active' && q().step('tour') === ctx.tour, 60000, `the tour to resume on "${ctx.tour}"`).then(
    () => t.event('tour-resumed', `on "${q().step('tour')}" (left on "${ctx.tour}")`),
    (e) => t.problem('error', `${e.message}; it is ${q() ? q().state('tour') + ' ' + q().step('tour') : 'missing'}`));
  await t.wait(6000);
  if (intro || (HP().overseer && HP().overseer.introPlaying)) t.problem('error', 'the Overseer\'s intro played again on the second visit');
  const m = G().mirror;
  if (m && (m.isOpen || m.pending)) t.problem('error', 'the mirror opened again on the second visit');
  else t.event('beginning-skipped', 'no intro, no mirror, no account sheet');
  if ($('#gsEmail') || $('#gsGoogle')) t.problem('error', 'the account sheet opened for a player who is signed in');
  t.scene('Second visit: the tour where it stopped');
  t.progress(1);
}

// ---------------------------------------------------------------------------------------------- things arriving in a beam
const ARRIVAL_IDS = ['pip', 'hut', 'jeep', 'boat', 'heli', 'rocket'];
/** The intro, then the first-visit cascade: the island's main things beam in one after another (arrive.js cascade). */
async function stageIntroCascade(t, ctx) {
  await t.until(() => G() && G().on, 25000, 'the game events');
  const seen = [];
  ctx.cascade = seen;
  G().on('cascade', (d) => { seen.push(d.id); t.event('cascade-beam', `${d.name} (${d.index + 1} of ${d.total}), ${seen.length} beamed so far`); if (seen.length === 1) t.scene('Island: the first beam'); });
  await stageIntro(t, ctx);
  ctx.cascadeMirrorClosed = false;
  G().on('mirror', (m) => { if (m && (m.state === 'done' || m.state === 'skip')) ctx.cascadeMirrorClosed = true; });
  G().on('cascadeDone', (d) => { ctx.cascadeDone = d; });
  t.event('cascade-waiting', 'the intro is over; the island waits for the mirror to close');
}

/** After the mirror and the sign-up sheet: the cascade began only once the mirror was closed, and every main thing beamed in. */
async function stageCascadeCheck(t, ctx) {
  const seen = ctx.cascade || [];
  const phone = HP().device && HP().device.tier === 'phone';
  if (phone) { t.event('cascade-skipped', 'a phone: the island just appears'); return; }
  if (!ctx.cascadeMirrorClosed && seen.length) t.problem('error', `the island began beaming in (${seen.join(', ')}) before the mirror was closed`);
  await t.until(() => ctx.cascadeDone || (seen.length >= ARRIVAL_IDS.length && HP().arrive.waiting === 0), 30000, 'every main thing to have been beamed in');
  const missing = ARRIVAL_IDS.filter((id) => !seen.includes(id));
  if (missing.length) t.problem('error', `not beamed in: ${missing.join(', ')}`);
  if (!ctx.cascadeDone) t.problem('error', 'the island never said its cascade was done');
  t.event('cascade-done', `${seen.join(', ')}, in that order, after the mirror closed`);
  await t.wait(1500);
  const hidden = ARRIVAL_IDS.filter((id) => { const e = W().byId.get(id); return !e || !e.node.isEnabled(); });
  if (hidden.length) t.problem('error', `still hidden after the cascade: ${hidden.join(', ')}`);
  t.scene('Island: all there');
}

/** Undo of a delete beams the thing back; a second player who joins is beamed in with their name. Named setup shortcuts: the
 *  delete itself, and the second player (no second browser: presence.standIn with the same arrival net.js gives a joiner). */
async function stageArrivals(t, ctx) {
  const OV = () => HP().overseer;
  await t.until(() => W() && W().player && OV(), 30000, 'the island');
  await stageCascadeCheck(t, ctx);
  // Undo.
  await tap(t, 'Tab');
  if (HP().mode !== 'build') { HP().setMode && HP().setMode('build'); t.event('setup-shortcut', 'building switched on directly (Tab did not)'); }
  if (!window.HawkesBuild || HP().mode !== 'build') t.problem('warning', 'building is not available on this page: the undo is not played');
  else {
    const id = 'hut';
    window.HawkesBuild.edit([{ op: 'delete', id }], { label: 'removing the hut' });
    t.event('setup-shortcut', 'the hut deleted while building');
    await t.until(() => !W().byId.get(id), 3000, 'the hut to be gone');
    t.scene('Undo: the hut is gone');
    await t.wait(1500);
    const before = OV().beams;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    await t.wait(90);
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'z', ctrlKey: true, bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control', bubbles: true }));
    await t.until(() => W().byId.get(id), 4000, 'Ctrl+Z to bring the hut back');
    await t.until(() => OV().beams > before || W().scene.meshes.some((m) => /beam/.test(m.name) && m.isEnabled()), 2500, 'a beam over the hut').then(
      () => t.event('undo-beam', 'Ctrl+Z brought the hut back in a beam'), (e) => t.problem('error', e.message));
    t.scene('Undo: the hut beamed back');
    await t.until(() => !W().scene.meshes.some((m) => /beam/.test(m.name) && m.isEnabled()), 6000, 'the beam to end').catch(() => {});
  }
  await tap(t, 'Tab'); // back to playing
  if (HP().mode === 'build') HP().setMode && HP().setMode('play');
  // A second player joins.
  await t.until(() => HP().presence && HP().presence.standIn, 20000, 'the presence module');
  const joinedEv = [];
  G().on('joined', (d) => joinedEv.push(d));
  const id = HP().presence.standIn('Mira', { ahead: 10, color: '#f59e0b', joined: true });
  if (!id) throw new Error('could not put a second player in the room');
  t.event('setup-shortcut', 'Mira joins the room (a stand-in; no second browser)');
  await t.until(() => joinedEv.length, 3000, 'the joiner to be beamed in');
  await t.until(() => W().scene.meshes.some((m) => /beam/.test(m.name) && m.isEnabled()), 2500, 'the beam over the joiner').then(
    () => t.event('joined-beam', 'a beam over the new player'), (e) => t.problem('error', e.message));
  const av = [...W().entities].find((e) => e.netId === id);
  const tag = av && av.node.getChildren().some((c) => /Mira/.test(c.name || '') || (c.metadata && c.metadata.decor));
  t.event('joined-name', `${joinedEv[0].name}${tag ? '' : ' (no name plate found)'}`);
  if (!joinedEv.some((j) => j.name === 'Mira')) t.problem('error', 'the joiner arrived without a name');
  t.scene('A second player joins');
  await t.wait(2500);
  t.scene('The second player stands there');
  HP().presence.removeStandIns();
  t.progress(1);
}

/** The second visit: nothing beams in, the six main things are simply there. */
async function stageBack2(t, ctx) {
  await stageVeil(t, ctx);
  await t.until(() => G() && G().on, 20000, 'the game events');
  const seen = [];
  G().on('cascade', (d) => seen.push(d.id));
  await t.until(() => W() && W().player, 30000, 'the island');
  t.scene('Second visit: the island');
  await t.wait(6000);
  if (seen.length || HP().arrive.waiting) t.problem('error', `the island cascaded in again on the second visit (${seen.join(', ')})`);
  const missing = ARRIVAL_IDS.filter((id) => { const e = W().byId.get(id); return !e || !e.node.isEnabled(); });
  if (missing.length) t.problem('error', `not there on the second visit: ${missing.join(', ')}`);
  else t.event('just-there', 'no cascade; Pip, the hut, the 4x4, the boat, the helicopter and the rocket are all there');
  t.scene('Second visit: everything is there');
  t.progress(1);
}

// ---------------------------------------------------------------------------------------------- touch controls
/** Every tour action with touch alone (the phone controls: ?touch=1): pointer events of type "touch" on the stick, the buttons
 *  and the canvas, as a thumb does. At each step the real page is measured (H.touchLayout.audit(): controls that overlap,
 *  buttons under 48 px, anything outside the safe area) and the result is logged as a `touch-audit` event; a failing audit is an
 *  error problem. The page is judged at the size the browser has (390x844 and 844x390 are two runs); the other orientation is
 *  checked by the layout's own math. Named setup shortcuts: the player put beside the helicopter and the rocket. */
let touchId = 100;
const touchEv = (type, target, x, y, id) => target.dispatchEvent(new PointerEvent(type, { pointerType: 'touch', pointerId: id, isPrimary: true, bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y }));
const centre = (el) => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
/** Presses a screen button and returns the release. */
function press(el) { const id = ++touchId, [x, y] = centre(el); touchEv('pointerdown', el, x, y, id); return () => { touchEv('pointerup', el, x, y, id); }; }
async function tapButton(t, el, ms = 120) { const up = press(el); await t.wait(ms); up(); }
/** The stick: hold it pushed to (ax, ay) in -1..1 (ay > 0 is forward). Returns { set, release }. */
function stickHold() {
  const pad = $('#touch .pad');
  if (!pad) throw new Error('timed out: the stick is not on screen');
  const id = ++touchId, r = pad.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, m = r.width / 2;
  touchEv('pointerdown', pad, cx, cy, id);
  return { set(ax, ay) { touchEv('pointermove', pad, cx + ax * m, cy - ay * m, id); }, release() { touchEv('pointerup', pad, cx, cy, id); } };
}
async function dragLook(t, dx) { // a thumb drag on the game
  const c = canvas(), id = ++touchId, x0 = innerWidth * 0.55, y0 = innerHeight * 0.3;
  touchEv('pointerdown', c, x0, y0, id);
  for (let i = 1; i <= 6; i++) { touchEv('pointermove', c, x0 + (dx * i) / 6, y0, id); await t.wait(30); }
  touchEv('pointerup', c, x0 + dx, y0, id);
}
async function stageTouch(t, ctx) {
  const TL = () => HP().touchLayout;
  const problems = new Set();
  const audit = (label) => {
    const a = TL().audit();
    t.event('touch-audit', `${label}: ${a.text}`);
    for (const p of [...a.overlaps.map((x) => `overlap ${x}`), ...a.small.map((x) => `under 48px ${x}`), ...a.outside.map((x) => `outside the safe area ${x}`)]) {
      const k = `${label}: ${p}`;
      if (!problems.has(k)) { problems.add(k); t.problem('error', `touch layout, ${label}: ${p}`); }
    }
    return a;
  };
  releaseAll();
  await t.until(() => W() && W().player && W().player.alive && HP().touchLayout, 60000, 'the island and its touch layout');
  if (!HP().touchUi) throw new Error('the phone controls are not on (open /play/sandbox?touch=1)');
  await t.until(() => $('#touch .pad') && $('#touch .a') && $('#tl-hide'), 15000, 'the stick, the buttons and the HUD toggle');
  const vw = innerWidth, vh = innerHeight;
  const ins = TL().insets();
  t.event('viewport', `${vw}x${vh}, safe-area insets t${ins.t} r${ins.r} b${ins.b} l${ins.l}`);
  // The other orientation, by the layout's own math.
  const other = TL().compute({ w: vh, h: vw, top: ins.l, right: ins.t, bottom: ins.r, left: ins.b });
  const bad = TL().zoneOverlaps(other);
  t.event('layout-math', `${vh}x${vw}: ${bad.length ? `zones overlap: ${bad.join(', ')}` : 'no zone overlaps'}; buttons ${TL().K.BTN}px`);
  if (bad.length) t.problem('error', `touch layout at ${vh}x${vw}: zones overlap (${bad.join(', ')})`);
  t.scene('Touch: on foot');
  await t.wait(1500);
  audit('on foot');
  t.progress(0.1);

  // walk (the stick), look (a drag), jump
  const p0 = { x: W().player.x, z: W().player.z };
  let st = stickHold(); st.set(0, 1); await t.wait(1500); st.release();
  const moved = Math.hypot(W().player.x - p0.x, W().player.z - p0.z);
  t.event('touch-walk', `${moved.toFixed(1)} m with the stick`);
  if (moved < 1) t.problem('error', 'the stick did not walk the player');
  const yaw0 = camYaw();
  await dragLook(t, 220);
  t.event('touch-look', `the camera turned ${Math.abs(wrap(camYaw() - yaw0)).toFixed(2)} rad with a drag`);
  if (Math.abs(wrap(camYaw() - yaw0)) < 0.05) t.problem('error', 'a drag on the game did not turn the camera');
  const y0 = W().player.y;
  const upJump = press($('#touch .a')); let high = 0; for (let i = 0; i < 12; i++) { await t.wait(60); high = Math.max(high, W().player.y - y0); } upJump();
  t.event('touch-jump', `${high.toFixed(2)} m up`);

  // the HUD toggle and the chat
  await tapButton(t, $('#tl-hide'));
  await t.wait(300);
  t.scene('Touch: HUD hidden');
  t.event('hud-hidden', `body.tl-hud-off: ${document.body.classList.contains('tl-hud-off')}`);
  if (!document.body.classList.contains('tl-hud-off')) t.problem('error', 'the HUD button did not hide the HUD');
  audit('HUD hidden');
  await tapButton(t, $('#tl-hide'));
  await t.wait(300);
  const chatBtn = $('.pr-hud [data-a=chat]');
  if (chatBtn) { chatBtn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' })); chatBtn.click(); await t.wait(500); t.scene('Touch: chat open'); audit('chat open'); chatBtn.click(); await t.wait(300); }
  else t.event('touch-chat-missing', 'no chat button on screen');
  t.progress(0.25);

  // drive: the stick to the 4x4, B to get in, the stick steers, A is the handbrake, the buttons
  const q = () => G().events && G().events.quests;
  const step = () => (q() && q().state('tour') === 'active' ? q().step('tour') : null);
  const driving = () => G().player && G().player.controller === 'drive';
  if (!driving()) {
    const jeep0 = W().byId.get('jeep');
    for (let guard = 0; guard < 600; guard++) {
      const p = W().player, d = Math.hypot(jeep0.x - p.x, jeep0.z - p.z);
      if (d <= 3.2) break;
      if (guard === 599) throw new Error('timed out walking to the 4x4 with the stick');
      const dx = jeep0.x - p.x, dz = jeep0.z - p.z, yaw = camYaw(), s = Math.sin(yaw), c = Math.cos(yaw);
      if (!st.live) { st = stickHold(); st.live = true; }
      st.set((dx * c - dz * s) / d, (dx * s + dz * c) / d);
      await t.wait(80);
    }
    if (st.live) { st.release(); st.live = false; }
    for (let i = 0; i < 4 && !driving(); i++) { await tapButton(t, $('#touch .b')); await t.wait(700); }
    if (!driving()) throw new Error('timed out getting into the 4x4 with B');
  }
  t.event('touch-enter-vehicle', 'B got into the 4x4');
  await t.wait(1200);
  t.scene('Touch: in the 4x4');
  await t.until(() => $('#veh-touch button'), 5000, 'the vehicle buttons');
  audit('driving');
  const labels = [...document.querySelectorAll('#veh-touch button')].map((b) => b.getAttribute('aria-label') || b.textContent.trim().slice(0, 8));
  t.event('vehicle-buttons', labels.join(', '));
  for (const b of document.querySelectorAll('#veh-touch button')) { await tapButton(t, b, 80); }
  t.event('touch-vehicle-buttons', 'every vehicle button tapped (boost, horn, view, lights, flip)');
  const dockStart = performance.now();
  st = stickHold(); st.live = true;
  let sign = 1, ref = null, bad2 = 0;
  const jeep = W().byId.get('jeep'), dock = W().byId.get('dock');
  while (step() === 'drive' && performance.now() - dockStart < 75000) {
    const v = jeep.vehicle;
    const tx = dock.x - jeep.x, tz = dock.z - jeep.z;
    const err = Math.atan2(tx * v.right.x + tz * v.right.z, tx * v.fwd.x + tz * v.fwd.z);
    if (ref && performance.now() - ref.at > 700) { if (Math.abs(err) > Math.abs(ref.err) + 0.08) { if (++bad2 >= 2) { sign = -sign; bad2 = 0; } } else bad2 = 0; ref = null; }
    if (!ref && Math.abs(err) > 0.3) ref = { at: performance.now(), err };
    st.set(Math.abs(err) > 0.1 ? Math.sign(err) * sign : 0, 1); // steer with the stick
    await t.wait(100);
  }
  const brake = press($('#touch .a')); // brake / handbrake
  st.set(0, 0); await t.wait(900);
  const speed = jeep.vehicle && jeep.vehicle.speed !== undefined ? jeep.vehicle.speed : null;
  brake(); st.release(); st.live = false;
  t.event('touch-steer-brake', `${step() === 'drive' ? 'did not reach' : 'reached'} the dock with the stick; handbrake held${speed !== null ? `, speed after ${Number(speed).toFixed(1)}` : ''}`);
  if (step() === 'drive') t.problem('warning', 'the 4x4 did not reach the dock with the stick in time');
  await tapButton(t, $('#touch .b')); await t.wait(900);
  t.progress(0.5);

  // fish: walk to the rod, then the fish button (hold to cast, tap to hook, hold to reel)
  try {
    await t.until(() => step() === 'rod' || step() === 'fish', 8000, 'the tour to ask for the rod');
    if (step() === 'rod') {
      const rod = W().byId.get('rod');
      st = stickHold();
      for (let guard = 0; guard < 700 && step() === 'rod'; guard++) {
        const p = W().player, dx = rod.x - p.x, dz = rod.z - p.z, d = Math.hypot(dx, dz), yaw = camYaw(), s = Math.sin(yaw), c = Math.cos(yaw);
        if (d <= 0.7) break;
        st.set((dx * c - dz * s) / d, (dx * s + dz * c) / d);
        await t.wait(80);
      }
      st.release();
      await t.until(() => step() !== 'rod', 8000, 'the rod to be picked up');
    }
    await t.until(() => $('.water-use'), 8000, 'the fish button');
    t.scene('Touch: fishing');
    audit('fishing');
    try { G().water.fish.assist(true); } catch { /* the first-catch help applies */ }
    const biting = () => { try { return G().water.fish.phase() === 'bite'; } catch { return false; } };
    for (let cast = 1; cast <= 4 && step() === 'fish'; cast++) {
      const up = press($('.water-use')); await t.wait(900 + cast * 150); up(); // hold to cast
      t.event('touch-cast', `cast ${cast}`);
      const bitten = await t.until(() => biting() || step() !== 'fish', 22000, 'a bite').then(() => biting(), () => false);
      if (!bitten) continue;
      await tapButton(t, $('.water-use'), 90); // hook it
      const reel = press($('.water-use')); // and reel while held
      await t.until(() => step() !== 'fish', 14000, 'the fish to be landed').then(() => 0, () => 0);
      reel();
    }
    t.event('touch-fish', step() === 'fish' ? 'no fish landed in four casts' : 'a fish caught with the button');
    if (step() === 'fish') t.problem('warning', 'no fish was caught with the touch buttons');
  } catch (e) { t.problem('warning', `touch fishing did not complete: ${e.message}`); }
  t.progress(0.65);

  // tools: switch and fire, if a tool is in hand
  const next = $('.mh-next:not([hidden])'), fire = $('.mh-fire:not([hidden])');
  if (next && next.offsetParent !== null) { await tapButton(t, next); t.event('touch-switch-tool', 'the next-tool button tapped'); }
  const fire2 = $('.mh-fire:not([hidden])');
  if (fire2 && fire2.offsetParent !== null) { audit('tool in hand'); await tapButton(t, fire2, 200); t.event('touch-fire', 'FIRE tapped'); }
  else t.event('touch-fire-skipped', 'no mayhem tool in hand on this path (the rocket launcher is found up the beach)');
  void fire;

  // the spawn wheel
  const ctl = $('.ct-btn');
  if (ctl && ctl.offsetParent !== null) {
    audit('controls button');
    await tapButton(t, ctl); await t.wait(400);
    const sp = $('.ct-panel [data-act="Spawn"]');
    t.event('touch-controls', sp ? 'Controls opened with a Spawn button' : 'Controls opened without a Spawn button');
    if (sp) await tapButton(t, sp);
    await t.wait(600);
    const sheet = $('.sw-sheet:not([hidden]), .sw-wheel:not([hidden])');
    t.event('touch-spawn-wheel', sheet ? 'the spawn wheel opened by touch' : 'the spawn button did not open the wheel');
    if (!sheet) t.problem('error', 'the spawn button did not open the spawn wheel');
    t.scene('Touch: spawn wheel');
    const close = $('.sw-head button[data-a=close], .sw-head button:last-child');
    if (close) { await tapButton(t, close); await t.wait(400); }
  } else t.event('touch-spawn-skipped', 'no Controls button on screen');

  // helicopter and rocket flight: the player put beside each (named shortcut), B to board, A for thrust, the buttons, B out
  for (const [id, name] of [['heli', 'helicopter'], ['rocket', 'rocket']]) {
    const e = W().byId.get(id);
    if (!e) { t.event('touch-flight-skipped', `no ${name} in this world`); continue; }
    if (driving()) { await tapButton(t, $('#touch .b')); await t.wait(800); }
    t.event('setup-shortcut', `the player put beside the ${name} (the walk to it is the drive step's)`);
    W().player.position = [e.x + 3.5, e.y + 1, e.z];
    await t.wait(1500);
    for (let i = 0; i < 4 && !driving(); i++) { await tapButton(t, $('#touch .b')); await t.wait(800); }
    if (!driving()) { t.problem('warning', `could not board the ${name} with B`); continue; }
    await t.until(() => $('#veh-touch button'), 5000, 'the flight buttons');
    const up = press($('#touch .a')); await t.wait(2500);
    t.scene(`Touch: flying the ${name}`);
    audit(`flying the ${name}`);
    await tapButton(t, [...document.querySelectorAll('#veh-touch button')].find((b) => /Down/.test(b.getAttribute('aria-label') || '')) || $('#veh-touch button'), 400);
    up();
    t.event('touch-flight', `${name}: thrust with A, the down button tapped, ${(W().byId.get(id).y).toFixed(0)} m up`);
    await tapButton(t, $('#touch .b')); await t.wait(1500);
  }

  // Stuck?
  const stuck = $('.tour-stuck');
  if (stuck && stuck.offsetParent !== null) {
    audit('tour tracker');
    let rescued = false; G().on('rescue', () => { rescued = true; });
    await tapButton(t, stuck); await t.wait(1500);
    t.event('touch-stuck', rescued ? 'Stuck? sent the player back' : 'Stuck? tapped (no rescue event)');
  } else t.event('touch-stuck-skipped', 'the Stuck? button is not showing (the tour is over)');
  releaseAll();
  const final = audit('end');
  t.event('touch-haptics', `${HP().haptic.sent} buzzes sent of ${HP().haptic.asked} asked (${navigator.vibrate ? 'this browser vibrates' : 'no vibration API here'})`);
  t.progress(1);
  void final;
}

async function stageHats(t, ctx) {
  const P = () => HP().presence;
  releaseAll();
  await t.until(() => W() && W().player && W().player.alive && P() && P().hats, 60000, 'the player\'s body');
  if (G().player.controller === 'drive') { await tap(t, 'e'); await t.wait(900); }
  const rigOf = () => P()._internal.rigs.get(W().player);
  const all = P().core.LOOK.hats.filter((h) => h !== 'none'), made = Object.keys(P().hatRegistry || {});
  for (const hat of all) if (!made.includes(hat)) t.event('hat-procedural', `${hat}: no Gen model yet, the procedural hat stays`);
  for (const id of ['person', 'dog', 'shoe']) {
    for (const hat of made) {
      t.event('setup-shortcut', `the look changed to ${id} with a ${hat} (presence.setLook, as the mirror's answer does)`);
      P().setLook({ what: id, hat, accent: '#ffffff' });
      await t.until(() => { const r = rigOf(); return r && r.pm && r.pm.state !== 'loading'; }, 30000, `the ${id} model to load`);
      await P().models.ready(rigOf());
      await P().hats.ready(rigOf());
      await t.wait(400);
      const rig = rigOf(), st = P().hats.stats(rig);
      if (!st) { t.problem('error', `${hat} on ${id}: the Gen hat is not worn (the procedural hat shows)`); continue; }
      if (st.tris > 1800) t.problem('error', `${hat}: ${st.tris} triangles is over the hat budget`);
      if (rig.hatModel.holder.parent !== rig.neck) t.problem('error', `${hat} on ${id}: not parented to the head anchor`);
      t.event('hat-on', `${hat} on ${id}: Gen model, ${st.tris} triangles, on the head anchor`);
      t.scene(`Hat: ${hat} on ${id}`);
      if (id !== 'person' && hat !== made[0]) continue;
      // real keys: walk and jump, the hat staying on the head
      const y0 = () => { rig.hatModel.holder.computeWorldMatrix(true); rig.neck.computeWorldMatrix(true); return rig.hatModel.holder.getAbsolutePosition().subtract(rig.neck.getAbsolutePosition()).length(); };
      const d0 = y0();
      setKeys({ w: true }); await t.wait(1500); await tap(t, ' ', 120); await t.wait(300); const d1 = y0(); setKeys({}); await t.wait(900);
      if (Math.abs(d1 - d0) > 0.02) t.problem('error', `${hat} on ${id}: slid off the head (${d0.toFixed(3)} then ${d1.toFixed(3)})`);
      t.event('hat-follows', `${hat} on ${id}: walked and jumped, the hat stayed on the head`);
    }
  }
  // the colour pick: a tinted hat changes colour
  for (const hat of made) {
    P().setLook({ what: 'person', hat, accent: '#ffffff' }); await t.wait(500);
    let rig = rigOf(); const c0 = rig.hatModel && rig.hatModel.mats[0] && (rig.hatModel.mats[0].albedoColor || rig.hatModel.mats[0].diffuseColor).toHexString();
    P().setLook({ what: 'person', hat, accent: '#e11d48' }); await t.wait(500);
    rig = rigOf(); const m = rig.hatModel && rig.hatModel.mats[0], c1 = m && (m.albedoColor || m.diffuseColor).toHexString();
    const tinted = !!(rig.hatModel && rig.hatModel.tinted);
    t.event('hat-color', `${hat}: ${c0} then ${c1}${tinted ? ' (tinted by the pick)' : ' (its own colours)'}`);
    t.scene(`Hat colour: ${hat}`);
    if (tinted && c0 === c1) t.problem('error', `${hat}: the colour pick did not change the hat`);
  }
  t.progress(1);
}

async function stageModels(t, ctx) {
  const P = () => HP().presence;
  releaseAll();
  await t.until(() => W() && W().player && W().player.alive && P() && P().models, 60000, 'the player\'s body');
  if (G().player.controller === 'drive') { await tap(t, 'e'); await t.wait(900); }
  const rigOf = () => P()._internal.rigs.get(W().player);
  const ALL = (ctx && ctx.options && ctx.options.all) || /gen-models-all/.test(String(location.search) + String(sessionStorage.getItem(KEY)));
  const ids = ALL ? Object.keys(P().models.registry ? P().models.registry() : P().modelRegistry) : ['person', 'dog', 'shoe'];
  for (const id of ids) {
    const rw = P().models.entry(id);
    if (!rw || (!rw.url && !rw.asset)) { t.event('model-missing', `${id}: no Gen model, the procedural body stays`); continue; }
    for (const hat of ['tophat', 'cap']) {
      t.event('setup-shortcut', `the look changed to ${id} with a ${hat} (presence.setLook, as the mirror's answer does)`);
      P().setLook({ what: id, hat });
      await t.until(() => { const r = rigOf(); return r && r.pm && r.pm.state !== 'loading'; }, 30000, `the ${id} model to load`);
      await P().models.ready(rigOf());
      const rig = rigOf(), st = P().models.stats(rig), row = P().models.entry(id);
      if (!rig.pm || !rig.pm.on) { t.problem('error', `${id}: the Gen model is not on the rig (state ${rig.pm && rig.pm.state}); the procedural body shows`); continue; }
      // the body alone: the model's own roots, not the holder (hats, glasses and packs hang under the holder's anchors and would be measured as body)
      const box = { min: { y: Infinity }, max: { y: -Infinity } };
      for (const r of rig.pm.levels.near.roots) { r.computeWorldMatrix(true); const b = r.getHierarchyBoundingVectors(true); box.min.y = Math.min(box.min.y, b.min.y); box.max.y = Math.max(box.max.y, b.max.y); }
      const height = box.max.y - box.min.y;
      const headTop = rig.pm.anchors.head.node.getAbsolutePosition().y - box.min.y;
      t.event('model-on', `${id} (${hat}): ${st.nearTris} triangles near (budget ${st.budget}), low level ${rig.pm.urls.low ? 'yes' : 'NO'}, height ${height.toFixed(2)} m of ${row.h}, head anchor ${headTop.toFixed(2)} m up, clips ${st.clips.join('/') || 'none'}, missing ${st.missing.join(',') || 'none'}`);
      if (st.over) t.problem('error', `${id}: ${st.nearTris} triangles is over the ${st.budget} budget`);
      if (!rig.pm.urls.low) t.problem('error', `${id}: no low level`);
      if (Math.abs(height - row.h) > row.h * 0.1) t.problem('error', `${id}: ${height.toFixed(2)} m tall, the row says ${row.h}`);
      if (headTop < height * 0.8 || headTop > height * 1.1) t.problem('error', `${id}: the hat anchor is at ${headTop.toFixed(2)} of ${height.toFixed(2)} m`);
      t.scene(`Model: ${id} in a ${hat}`);
      if (hat !== 'tophat') continue;
      // real keys: walk, run, jump, then an emote, the hat staying on
      setKeys({ w: true }); await t.wait(1800); t.scene(`Model: ${id} walking`);
      keyEv('keydown', 'Shift'); await t.wait(1500); t.scene(`Model: ${id} running`);
      keyEv('keyup', 'Shift'); setKeys({});
      await tap(t, ' ', 120); await t.wait(350); t.scene(`Model: ${id} jumping`); await t.wait(1200);
      P().emote('wave'); await t.wait(900); t.scene(`Model: ${id} waving`); P().stopEmote();
      t.event('model-moves', `${id}: walked, ran, jumped and waved with the ${hat} on`);
    }
  }
  if (ALL) {
    // ten different Gen models in view at once (stand-in players with other looks: the same path a real second player's look takes), the crowd tools read
    releaseAll();
    const ten = ['cat', 'fox', 'pig', 'bear', 'rabbit', 'cow', 'sheep', 'horse', 'robot', 'duck'];
    t.event('setup-shortcut', 'ten stand-in players put ahead of the player, each with another look (presence.standIn and the look their presence state carries)');
    ten.forEach((id, n) => {
      const cid = P().standIn(`Model ${n + 1}`, { ahead: 6 + n * 1.6, side: (n % 2 ? 1 : -1) * (2 + (n % 5)), color: '#f59e0b' });
      if (cid) P()._internal.peerInfo.set(cid, { look: { what: id, name: id } });
    });
    await t.wait(6000);
    const crowd = P().crowd(), m = HP().monitor && HP().monitor.sample ? HP().monitor.sample() : null;
    const loaded = [...P()._internal.rigs.values()].filter((r) => r.pm && r.pm.on).length;
    t.event('crowd-ten', `${crowd.bodies} bodies in the crowd (${crowd.full} in full of ${crowd.cap}), ${loaded} Gen models on rigs${m ? `, ${m.drawCalls} draw calls, ${m.triangles} triangles, ${m.fps} fps, textures ${m.textureMB} of ${m.textureBudgetMB} MB` : ''}`);
    if (m && m.textureBudgetMB && m.textureMB > m.textureBudgetMB) t.problem('error', `ten models: ${m.textureMB} MB of textures is over the ${m.textureBudgetMB} MB budget`);
    if (crowd.cap && crowd.full > crowd.cap) t.problem('error', `ten models: ${crowd.full} bodies in full is over the cap of ${crowd.cap}`);
    t.scene('Ten different Gen models in view');
    P().removeStandIns();
  }
  t.progress(1);
}

// `vehicle-feel`: the same way in to the account, then the 4x4 driven for the game-feel pass (vehicles-feel.js): the view
// widens, the body leans, dust is kicked, the engine climbs with speed, the handbrake squeals, and a landing dips the view
// with dust and a thud. Real keys; the jump is one named shortcut (a push upward at speed). touch: true is the phone: the
// frame rate while driving is measured and under 30 is a problem.
async function stageFeel(t, ctx) {
  await t.until(() => G() && G().vehicles && W().byId.get('jeep'), 90000, 'the island and its 4x4');
  await t.wait(1500);
  const jeep = () => W().byId.get('jeep');
  const driving = () => G().player && G().player.controller === 'drive';
  const touch = Boolean(ctx.options.touch || HP().touchUi);
  if (!driving()) {
    await goTo(t, ctx, 'jeep', 3.2, 60000, 'the 4x4');
    for (let i = 0; i < 4 && !driving(); i++) { if (touch && $('#touch .b')) await tapButton(t, $('#touch .b')); else await tap(t, 'e'); await t.wait(700); }
    if (!driving()) {
    t.problem('warning', 'E did not get the player into the 4x4 (the jeep: ' + (jeep() ? Math.round(Math.hypot(jeep().x - W().player.x, jeep().z - W().player.z)) + ' m away' : 'missing') + '): the hook put them in');
    await HOOKS.enterVehicle(t, 'jeep');
  }
  if (!driving()) throw new Error('timed out getting into the 4x4 (E and hooks.enterVehicle)');
  }
  // The pedals: the keys, or on a phone the stick (a: -1 left .. 1 right, f: -1 back .. 1 forward).
  let pad = null;
  const dr = (a, f) => { if (touch) { if (!pad) pad = stickHold(); pad.set(a, f); } else setKeys({ w: f > 0, s: f < 0, d: a > 0, a: a < 0 }); };
  const undrive = () => { if (pad) { pad.release(); pad = null; } releaseAll(); };
  const F = () => HP().vehicles.feel;
  if (!F()) throw new Error('the vehicles feel layer is not loaded');
  const cam = () => W().scene.activeCamera;
  t.event('in-the-4x4');
  await t.wait(800);
  const idle = F().sample(), fov0 = cam().fov;
  t.event('feel-idle', `view ${fov0.toFixed(3)} rad, engine note ${idle.rpm === null || idle.rpm === undefined ? '-' : idle.rpm.toFixed(2)}`);
  t.scene('4x4: standing');
  t.progress(0.65);
  // fps while driving (the phone tier must hold 30)
  let frames = 0, running = true;
  const t0 = performance.now();
  const raf = () => { frames++; if (running) requestAnimationFrame(raf); };
  requestAnimationFrame(raf);
  // 1) straight ahead: speed, view, engine
  const seen = { fov: 0, rpm: 0, roll: 0, skid: 0, speed: 0 };
  const peek = () => { const s = F().sample(), j = jeep(); seen.fov = Math.max(seen.fov, s.fov); seen.rpm = Math.max(seen.rpm, s.rpm || 0); seen.roll = Math.max(seen.roll, Math.abs(s.roll)); seen.skid = Math.max(seen.skid, s.skid); seen.speed = Math.max(seen.speed, j ? j.speed : 0); return s; };
  const puffs0 = F().sample().puffs;
  dr(0, 1);
  const marks = [];
  for (let i = 0; i < 9; i++) {
    await t.wait(500);
    const s = peek();
    if (i === 1 || i === 8) marks.push({ speed: jeep().speed, fov: cam().fov - fov0, rpm: s.rpm || 0, back: s.camBack });
    if (i === 8) t.scene('4x4: at speed');
  }
  if (marks.length === 2) t.event('speed-feel', `at ${marks[0].speed.toFixed(0)} m/s the view is ${marks[0].fov.toFixed(3)} rad wider and the engine ${marks[0].rpm.toFixed(2)}; at ${marks[1].speed.toFixed(0)} m/s ${marks[1].fov.toFixed(3)} rad and ${marks[1].rpm.toFixed(2)}, the camera ${marks[1].back.toFixed(2)} m farther back`);
  t.event('fov-widened', `${seen.fov.toFixed(3)} rad at ${seen.speed.toFixed(0)} m/s`);
  t.event('engine-pitch', `note ${idle.rpm === null || idle.rpm === undefined ? '0' : idle.rpm.toFixed(2)} standing, ${seen.rpm.toFixed(2)} at speed`);
  t.event('dust', `${F().sample().puffs - puffs0} puffs kicked up on the way`);
  // 2) weave: the body leans
  for (let i = 0; i < 4; i++) {
    dr(i % 2 === 0 ? 1 : -1, 1);
    await t.wait(700);
    peek();
    if (i === 1) t.scene('4x4: leaning in a bend');
  }
  t.event('body-roll', `leaned up to ${(seen.roll * 57.3).toFixed(1)} degrees in the bends`);
  // 3) the handbrake: a drift (a phone has no handbrake: a hard turn at speed)
  dr(-1, 1);
  if (!touch) keyEv('keydown', ' ');
  for (let i = 0; i < 6; i++) { await t.wait(250); peek(); }
  if (!touch) keyEv('keyup', ' ');
  dr(0, 1);
  t.event('drift-squeal', `tire squeal up to ${seen.skid.toFixed(2)}`);
  t.scene('4x4: drifting');
  // 4) a jump: a push upward at speed (named shortcut), then the landing
  await t.wait(900);
  const before = F().sample(), sounds0 = HP().juice && HP().juice.sound ? HP().juice.sound.played : 0;
  const v = jeep().vehicle;
  v.vel.y += 9;
  t.event('setup-shortcut', 'the 4x4 given an upward push at speed to jump (no ramp on the island is reliable)');
  let dip = 0;
  for (let i = 0; i < 24; i++) { await t.wait(100); dip = Math.min(dip, F().sample().dip); if (i === 3) t.scene('4x4: in the air'); }
  const after = F().sample();
  dr(0, 0);
  const sounds = (HP().juice && HP().juice.sound ? HP().juice.sound.played : 0) - sounds0;
  if (after.landed > before.landed) t.event('landing', `camera dip ${dip.toFixed(3)} m, ${after.puffs - before.puffs} puffs of dust, ${sounds} sounds`);
  else t.problem('warning', 'the 4x4 did not land from the jump in time');
  t.scene('4x4: landed');
  running = false;
  const fps = Math.round(frames / ((performance.now() - t0) / 1000));
  t.metric('driveFps', fps);
  t.event('drive-fps', `${fps} fps while driving${touch ? ' (phone controls)' : ''}`);
  if (touch && fps < 30) t.problem('error', `the phone tier held ${fps} fps while driving (30 needed)`);
  t.progress(0.72);
  undrive();
  await driveSurfaces(t, ctx, { jeep, driving, touch, dr, undrive });
  if (!touch) await flyOver(t, ctx, { jeep, driving });
  t.progress(1);
}

// ---- surface effects (vehicles-vfx.js): the 4x4 across road, sand, shallows and meadow, the headlights at dusk, then the helicopter low over grass and sea
/** The nearest point (engine numbers) round (x, z) where the ground is what `want` says: 'road' (painted dirt), 'sand' (dry),
 *  'shallows' (a little under the sea), 'grass' (meadow), 'sea' (anywhere the water is deeper than 1 m). Scans rings, 6 to 140 m. */
function findGround(x, z, want, from = 6) {
  const T = HP().terrain, Wt = HP().water;
  if (!T || !T.heightAt || !T.materialAt) return null;
  const lvl = (px, pz) => { try { const y = Wt && Wt.surfaceAt ? Wt.surfaceAt(px, pz) : null; return y === null || y === undefined ? null : y; } catch { return null; } };
  for (let r = from; r <= 140; r += 6) {
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2 + r * 0.7, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      const h = T.heightAt(px, pz), m = T.materialAt(px, pz), w = lvl(px, pz);
      if (h === null || h === undefined) continue;
      const ok = want === 'road' ? m === 'dirt' && h > 0.5 && w === null
        : want === 'sand' ? m === 'sand' && h > (w === null ? 0.3 : w + 0.6)
        : want === 'shallows' ? w !== null && h < w - 0.15 && h > w - 1.0
        : want === 'sea' ? w !== null && h < w - 1.0
        : m === 'grass' && h > 1 && w === null;
      if (ok) return [px, h, pz];
    }
  }
  return null;
}
async function driveSurfaces(t, ctx, { jeep, driving, touch, dr, undrive }) {
  const F = () => HP().vehicles.feel, VF = () => HP().vehicles.vfx;
  if (!VF()) throw new Error('the vehicles surface effects (vehicles-vfx.js) are not loaded');
  const kindOf = { road: 'dust', sand: 'sand', grass: 'grass', shallows: 'spray' };
  const seen = new Set(), logged = new Set();
  const note = () => { for (const sw of VF().sample().switches) { const k = `${sw.t}`; if (!logged.has(k)) { logged.add(k); t.event('surface-switch', `${sw.from || 'start'} -> ${sw.ground}: ${sw.effect} (${sw.speed} m/s)`); seen.add(sw.ground); } } };
  let frames = 0, running = true;
  const t0 = performance.now();
  const raf = () => { frames++; if (running) requestAnimationFrame(raf); };
  requestAnimationFrame(raf);
  let pad = null;
  const drive = (a, f) => { if (touch) { if (!pad) pad = stickHold(); pad.set(a, f); } else setKeys({ w: f > 0, s: f < 0, d: a > 0, a: a < 0 }); };
  const leg = async (want, ms) => {
    const j = jeep();
    const g = findGround(j.x, j.z, want);
    if (!g) { t.problem('error', `no ${want} ground found within 140 m of the 4x4`); return false; }
    const e0 = VF().sample().emitted[kindOf[want]];
    const tl = performance.now();
    steer.last = null; steer.slow = 0; steer.back = 0;
    let got = false;
    for (;;) {
      const j2 = jeep(), s = VF().sample();
      const r = steerAt(j2, g);
      // steerAt sets the keys; a phone says the same on the stick
      if (touch) { const d = down.has('d') ? 1 : down.has('a') ? -1 : 0, f = down.has('w') ? 1 : down.has('s') ? -1 : 0; setKeys({}); drive(d, f); }
      note();
      if (s.surface === want && VF().sample().emitted[kindOf[want]] - e0 > 8) { got = true; if (r.dist < 12 || performance.now() - tl > 3500) break; }
      if (r.dist < 4) break;
      if (performance.now() - tl > ms) break;
      await t.wait(100);
    }
    note();
    if (!got) t.problem('error', `driving toward ${want} ground for ${Math.round((performance.now() - tl) / 1000)} s never showed its ${kindOf[want]} effect (on ${VF().sample().surface})`);
    else t.event('wheel-effect', `${kindOf[want]} on the ${want}: ${VF().sample().emitted[kindOf[want]] - e0} particles, ${Math.round(jeep().speed)} m/s`);
    return got;
  };
  try {
    await leg('road', 22000); t.scene('4x4: pale dust on the road');
    await leg('sand', 30000); t.scene('4x4: a sand plume and tracks on the beach');
    const tr = VF().sample().tracks;
    if (tr.written > 3) t.event('tracks-on-sand', `${tr.written} track quads laid (${tr.live} showing, at most ${tr.cap})`); else t.problem('error', `the 4x4 left ${tr.written} tracks on the beach`);
    await t.wait(1200); t.scene('4x4: tracks on the sand');
    await leg('shallows', 30000); t.scene('4x4: spray and a wake in the shallows');
    await leg('grass', 40000); t.scene('4x4: grass and dirt bits on the meadow');
  } finally { running = false; }
  note();
  const fps = Math.round(frames / ((performance.now() - t0) / 1000));
  t.metric('surfaceDriveFps', fps);
  const need = ['road', 'sand', 'shallows', 'grass'].filter((k) => !seen.has(k));
  t.event('surfaces-driven', `${[...seen].join(', ')}: ${JSON.stringify(VF().sample().emitted)}; ${fps} fps over ${Math.round((performance.now() - t0) / 1000)} s${touch ? ' (phone controls)' : ''}`);
  if (need.length) t.problem('error', `the 4x4 never switched effect on: ${need.join(', ')}`);
  if (touch && fps < 30) t.problem('error', `the phone tier held ${fps} fps over the four surfaces (30 needed)`);
  // Headlights at dusk (the clock moved: a named shortcut), the road ahead lit.
  const day0 = HP().sky.day;
  const lt = HP().lighting;
  if (lt && lt.setHour) {
    lt.setHour(20.4);
    t.event('setup-shortcut', 'the world clock set to dusk (H.lighting.setHour) so the lights can come on by themselves');
    await t.until(() => { const l = VF().sample().lights; return l && l.on; }, 8000, 'the headlights to switch on at dusk').catch((e) => t.problem('error', e.message));
    drive(0, 1);
    await t.wait(1600);
    const l = VF().sample().lights;
    const v = jeep().vehicle;
    t.event('headlights-on', `day ${HP().sky.day.toFixed(2)} (was ${day0.toFixed(2)}): lamp on ${l && l.on}, spot light ${v.light ? `range ${Math.round(v.light.range)} m, intensity ${v.light.intensity}` : 'missing'}, ${l && l.cone ? 'soft cone' : 'no cone (phone: no volumetric)'}, ${l ? l.flares : 0} lens flares`);
    if (!v.light) t.problem('error', 'the headlight did not light the road ahead (no spot light)');
    t.scene('4x4: headlights at dusk');
    drive(0, -1); await t.wait(900);
    const b = VF().sample().lights;
    t.event('brake-lights', `brake lights ${b && b.brake ? 'on' : 'not seen'} under the brakes`);
    t.scene('4x4: brake lights');
    drive(0, 0);
  } else t.problem('warning', 'no H.lighting.setHour: the dusk headlights were not checked');
  if (pad) { pad.release(); pad = null; }
  undrive();
  // Tracks fade: wait with the car still. The last mark is at most 30 s old when it is gone.
  const t1 = performance.now();
  await t.until(() => VF().sample().tracks.live === 0, 34000, 'the tyre tracks to fade out').catch((e) => t.problem('error', e.message));
  t.event('tracks-faded', `${Math.round((performance.now() - t1) / 1000)} s after the car stopped, ${VF().sample().tracks.live} tracks left`);
  if (lt && lt.release) lt.release();
}

async function flyOver(t, ctx, { jeep, driving }) {
  const VF = () => HP().vehicles.vfx;
  const heli = () => W().byId.get('heli');
  if (!heli()) { t.problem('warning', 'no helicopter in this world'); return; }
  releaseAll();
  const flying = () => G().player && G().player.controller === 'drive' && HP().vehicles.current && HP().vehicles.current.vehicle === heli().vehicle;
  if (driving()) { await tap(t, 'e'); await t.wait(900); }
  await goTo(t, ctx, 'heli', 3.5, 70000, 'the helicopter');
  for (let i = 0; i < 4 && !flying(); i++) { await tap(t, 'e'); await t.wait(800); }
  if (!flying()) { t.problem('warning', 'E did not put the player in the helicopter: the hook did'); await HOOKS.enterVehicle(t, 'heli'); }
  if (!flying()) throw new Error('timed out getting into the helicopter');
  t.event('in-the-helicopter');
  const hk = (k, on) => { if (on && !down.has(k)) { down.add(k); keyEv('keydown', k); } if (!on && down.has(k)) { down.delete(k); keyEv('keyup', k); } };
  keyEv('keydown', ' '); down.add(' ');
  await t.wait(3500);
  t.scene('Helicopter: rotor blur, lifting off');
  const bl = VF().sample().rotorBlur;
  t.event('rotor-blur', `the rotor disc at ${bl.toFixed(2)} opacity`);
  if (bl < 0.05) t.problem('error', 'no rotor blur disc while the rotor turns');
  // Fly at a point keeping 3 to 6 m up: space climbs, C descends, W tips it forward, A / D turn.
  const hover = async (want, label) => {
    const h = heli(), g = findGround(h.x, h.z, want, 10);
    if (!g) { t.problem('error', `no ${want} ground found for the helicopter`); return; }
    const t0 = performance.now();
    let ok = false, still = 0;
    while (performance.now() - t0 < 45000) {
      const h2 = heli(), v = h2.vehicle, s = VF().sample();
      const tx = g[0] - h2.x, tz = g[2] - h2.z, dist = Math.hypot(tx, tz);
      const err = Math.atan2(tx * v.right.x + tz * v.right.z, tx * v.fwd.x + tz * v.fwd.z);
      const alt = s.wash && s.wash.alt !== undefined && s.wash.mine !== false ? s.wash.alt : 9;
      hk('w', dist > 7 && Math.abs(err) < 0.7);
      hk('d', err > 0.12); hk('a', err < -0.12);
      // altitude: climb under 3 m, sink over 6 m (a wash reports only under 8 m: no report means high)
      if (!s.wash || !s.wash.ring || alt > 6) { hk(' ', false); hk('c', true); } else if (alt < 3) { hk('c', false); hk(' ', true); }
      if (s.wash && s.wash.ring && s.wash.alt < 7 && s.wash.ground === (want === 'grass' ? 'grass' : 'shallows') && dist < 12) { still += 0.1; if (still > 1.5) { ok = true; break; } } else still = 0;
      await t.wait(100);
    }
    for (const k of ['w', 'a', 'd', 'c', ' ']) hk(k, false);
    const s = VF().sample();
    if (ok) {
      t.event(want === 'grass' ? 'downwash-ring-grass' : 'spray-disc-sea', `${label}: ring ${s.wash.radius} m wide at ${s.wash.alt} m up, strength ${s.wash.strength}${s.wash.spray ? ', spray disc' : ''}; ${JSON.stringify(VF().sample().emitted)}`);
      t.scene(`Helicopter: ${label}`);
      await t.wait(900);
    } else t.problem('error', `the helicopter never showed its ${label} (${JSON.stringify(s.wash)})`);
  };
  await hover('grass', 'a downwash ring over grass');
  await hover('sea', 'a spray disc over the sea');
  t.event('washes', `${VF().washes().length} wash(es) told to the grass this frame`);
  releaseAll();
}

// `rocket-blast-feel`: the same way in to the account, then the rocket launcher at the fuel barrels (mayhem-feel.js): the
// launcher kicks and flashes, the rocket leaves a trail, the blast shakes, stops time for a beat, throws a ring, debris and
// embers, and ten barrels go off one after another. Real input (walking, a click); the launcher in hand and five more
// barrels beside the five on the beach are one named shortcut. touch: true is the phone: the frame rate through the chain
// is measured and under 30 is a problem.
/** The layers of the last blast (mayhem-vfx.js `sample()`), one event each, and the smoke column still there later. */
function blastLayers(t, label) {
  const V = G() && G().mayhem && G().mayhem.vfx, s = V && V.sample();
  if (!s || !s.ready) { t.problem('error', 'the layered blast (mayhem-vfx.js) was not ready: the flipbooks were not drawn'); return; }
  const L = (s.last && s.last.layers) || {};
  t.event('blast-layer-fireball', `${label}: ${s.fire} flipbook fireball particles in all (the last blast ${L.fireball || 0}), ${s.sheet} px sheets, ${s.tier} tier`);
  t.event('blast-layer-smoke', `${label}: ${s.smoke} column particles fed; ${s.smokeAlive} smoke particles still alive`);
  t.event('blast-layer-shockwave', `${label}: ${s.shock} ground rings, ${s.dust} dust particles${L.dust ? ' (' + L.dust.surface + ')' : ''}`);
  t.event('blast-layer-sparks', `${label}: ${s.sparks} sparks with trails`);
  t.event('blast-layer-flash', `${label}: ${s.flash} flashes, the longest lit ${s.flashFrames} frames`);
  t.event('blast-layer-scorch', `${label}: ${s.scorch} scorch marks put down, ${s.scorchLive} on the ground now (fading over 60 s)`);
  t.event('blast-layer-ripple', `${label}: ${s.ripple} heat ripples${s.tier === 'desktop' ? '' : ' (none off desktop High, as designed)'}`);
  if (!s.fire || !s.smoke || !s.sparks || !s.flash || !s.scorch) t.problem('error', `a blast layer was missing (${JSON.stringify({ fire: s.fire, smoke: s.smoke, sparks: s.sparks, flash: s.flash, scorch: s.scorch })})`);
  if (s.flash && s.flashFrames < 3) t.problem('warning', `the flash lit only ${s.flashFrames} frame(s)`);
  if (s.tier === 'phone' && s.ripple) t.problem('error', 'a heat ripple was drawn on the phone tier');
  if (s.tier === 'phone' && s.sheet !== 512) t.problem('error', `the phone read ${s.sheet} px flipbooks (512 needed)`);
}

async function stageBlast(t, ctx) {
  if (ctx.options.touch) return stagePhonePerf(t, ctx); // the phone: touch pointers only (the stick, a thumb drag, FIRE)
  await t.until(() => G() && G().mayhem && G().mayhem.feel && W().byId.get('barrel_1'), 90000, 'the island, its barrels and the game feel layer');
  await t.wait(1500);
  const P = () => W().player;
  const barrels = () => [...W().entities].filter((e) => e.data && (e.data.barrel || e.data.explosive) && !e._exploded);
  const b1 = W().byId.get('barrel_1');
  // Setup (named shortcut): the launcher in hand; five more barrels beside the five on the beach.
  G().mayhem.spawnMany('barrel', 5, { at: [b1.x + 2.6, b1.y, b1.z], pattern: 'line', spacing: 1.3 });
  P().tool = 'rocket-launcher';
  t.event('setup-shortcut', 'the rocket launcher put in hand and five more fuel barrels spawned beside the five on the beach, so ten in all');
  await t.wait(1200);
  const total = barrels().length;
  t.event('barrels-ready', `${total} barrels, ${HP().device ? HP().device.tier : '?'} tier${ctx.options.touch ? ', touch controls' : ''}`);
  t.progress(0.65);
  await walkTo(t, 'barrel_1', 9, 60000, 'the fuel barrels');
  const F = () => G().mayhem.feel;
  const J = () => (HP().juice && HP().juice.feel) || {};
  const booms = [];
  G().on('explosion', (d) => booms.push({ t: performance.now(), r: d.radius }));
  let tries = 0;
  const fire = async () => {
    const p = W().byId.get('barrel_1');
    await lookAt(t, Math.atan2(p.x - P().x, p.z - P().z));
    F().reset();
    const s0 = { hit: J().hitstops || 0, slow: J().slowmos || 0 };
    // fps through the shot and the chain
    let frames = 0, worst = 0, running = true, last = performance.now();
    const t0 = last;
    const raf = (n) => { frames++; worst = Math.max(worst, n - last); last = n; if (running) requestAnimationFrame(raf); };
    requestAnimationFrame(raf);
    await holdMouse(t, 160);
    t.event('rocket-fired', `shot ${tries + 1}`);
    await t.wait(90);
    t.scene('Launcher: muzzle flash and smoke');
    const kick = F().sample();
    t.event('launcher-recoil', `${kick.muzzle} muzzle flash with puff and backblast, the model and the view kicked back`);
    await t.wait(260);
    t.scene('Rocket: the trail');
    const first = booms.length;
    await t.until(() => booms.length > first || performance.now() - t0 > 6000, 8000, 'the rocket to land');
    if (booms.length === first) { running = false; return false; }
    t.event('rocket-trail', 'flame fading into smoke behind the rocket (until it lands)');
    await t.wait(350);
    t.scene('Blast: shockwave, debris and the chain starting');
    await t.wait(500);
    t.scene('Blast: the chain rolling');
    await t.wait(1100);
    t.scene('Blast: embers and smoke');
    await t.wait(2600);
    t.scene('Blast: the smoke column 5 s on');
    const V = G().mayhem.vfx, alive = V ? V.sample().smokeAlive : 0;
    t.event('smoke-5s', `${alive} smoke particles still in the sky about 5 s after the first blast`);
    if (alive < 10) t.problem('error', `the smoke column is gone after 5 s (${alive} particles)`);
    running = false;
    const s = F().sample(), fps = Math.round(frames / ((performance.now() - t0) / 1000));
    const mine = booms.slice(first);
    const at0 = mine.length ? mine[0].t : 0;
    const gaps = mine.slice(1).map((b, i) => Math.round(b.t - mine[i].t));
    t.event('blast-effects', `${J().hitstops - s0.hit} hit-stop, ${J().slowmos - s0.slow} slow motion, shockwave rings and debris with every blast, ${s.embers} embers bursts, ${s.layers} boom sounds in three layers, at most ${s.maxLive} effects alive (cap ${s.cap})`);
    t.event('chain-rolling', `${mine.length} explosions over ${Math.round((mine.length ? mine[mine.length - 1].t - at0 : 0))} ms; gaps ms: ${gaps.join(', ')}`);
    if (mine.length < Math.min(8, total)) t.problem('warning', `only ${mine.length} of ${total} barrels went off in the chain`);
    if (mine.length > 3 && mine[mine.length - 1].t - at0 < 700) t.problem('error', 'the barrels went off almost all at once (no visible chain)');
    blastLayers(t, 'desktop');
    t.metric('chainFps', fps);
    t.metric('chainWorstFrameMs', Math.round(worst));
    t.event('chain-fps', `${fps} fps through the shot and the ${mine.length}-barrel chain (worst frame ${Math.round(worst)} ms)${ctx.options.touch ? ', phone controls' : ''}`);
    if (ctx.options.touch && fps < 30) t.problem('error', `the phone tier held ${fps} fps through the chain (30 needed)`);
    return mine.length >= 2;
  };
  while (tries < 4) {
    if (await fire()) break;
    tries++;
    await walkTo(t, 'barrel_1', Math.max(3.5, 9 - tries * 1.8), 20000, 'the fuel barrels');
  }
  releaseAll();
  if (tries >= 4 && !booms.length) throw new Error('the rockets never landed');
  // Rolo's rocket: put in it (a named shortcut), a burn with Space: the exhaust flame, the pad dust, the trail up the climb
  const rk = W().byId.get('rocket');
  if (rk && G().mayhem.vfx) {
    await HOOKS.enterVehicle(t, 'rocket').catch((e) => t.problem('warning', String(e && e.message || e)));
    const v0 = G().mayhem.vfx.sample(), y0 = rk.y;
    keyEv('keydown', ' ');
    await t.wait(1200); t.scene('Rocket: the exhaust flame and the pad dust');
    await t.wait(4500); t.scene('Rocket: the trail up the climb');
    const v1 = G().mayhem.vfx.sample();
    keyEv('keyup', ' ');
    t.event('rocket-exhaust', `${v1.exhaust - v0.exhaust} exhaust flame particles`);
    t.event('rocket-pad-dust', `${v1.padDust - v0.padDust} dust particles thrown from the pad`);
    t.event('rocket-smoke-trail', `${v1.trail - v0.trail} trail particles over a climb of ${Math.round(rk.y - y0)} m`);
    if (v1.exhaust - v0.exhaust < 5) t.problem('error', 'the rocket showed no exhaust flame');
    if (v1.trail - v0.trail < 5) t.problem('error', 'the rocket left no smoke trail');
  }
  t.progress(1);
}

// ---------------------------------------------------------------------------------------------- phone performance
/** Counts frames from now: stop() gives the average fps, the worst frame and how many frames took over 500 ms (a freeze). */
function frameMeter() {
  let frames = 0, worst = 0, freezes = 0, hitches = 0, running = true, last = performance.now();
  const t0 = last;
  const raf = (n) => { frames++; const d = n - last; worst = Math.max(worst, d); if (d > 500) freezes++; if (d > 100) hitches++; last = n; if (running) requestAnimationFrame(raf); };
  requestAnimationFrame(raf);
  return { stop() { running = false; return { fps: Math.round(frames / ((performance.now() - t0) / 1000)), worst: Math.round(worst), freezes, hitches }; } };
}
/** `phone-performance`: the phone controls only (pointer events of type touch). Driving, then the rocket launcher at ten barrels,
 *  each with the frame rate, the worst frame and the freezes measured, and proof that the stick and buttons answered. */
async function stagePhonePerf(t, ctx) {
  await t.until(() => G() && G().vehicles && G().mayhem && W().byId.get('jeep') && W().byId.get('barrel_1') && HP().touchLayout, 90000, 'the island, its 4x4, barrels and touch layout');
  if (!HP().touchUi) throw new Error('the phone controls are not on (open /play/sandbox?touch=1)');
  await t.until(() => $('#touch .pad') && $('#touch .a') && $('#touch .b'), 15000, 'the stick and the buttons');
  await t.wait(1500);
  releaseAll();
  const driving = () => G().player && G().player.controller === 'drive';
  const P = () => W().player;
  t.event('phone-ready', `${HP().device ? HP().device.tier : '?'} tier, ${innerWidth}x${innerHeight}, touch controls`);
  // walk with the stick toward a thing, as a thumb does
  const stickTo = async (id, near, ms, what) => {
    const g = W().byId.get(id), t0 = performance.now(); let s = null;
    try {
      for (;;) {
        const dx = g.x - P().x, dz = g.z - P().z, d = Math.hypot(dx, dz);
        if (d <= near) return;
        if (performance.now() - t0 > ms) throw new Error(`timed out walking to ${what} with the stick`);
        const yaw = camYaw(), sn = Math.sin(yaw), c = Math.cos(yaw);
        if (!s) s = stickHold();
        s.set((dx * c - dz * sn) / d, (dx * sn + dz * c) / d);
        await t.wait(80);
      }
    } finally { if (s) s.release(); }
  };
  // 1) driving
  await stickTo('jeep', 3.2, 60000, 'the 4x4');
  for (let i = 0; i < 4 && !driving(); i++) { await tapButton(t, $('#touch .b')); await t.wait(700); }
  if (!driving()) throw new Error('timed out getting into the 4x4 with B');
  await t.wait(1200);
  t.scene('Phone: in the 4x4');
  const jeep = W().byId.get('jeep');
  const head = () => Math.atan2(jeep.vehicle.fwd.x, jeep.vehicle.fwd.z);
  const m1 = frameMeter();
  const st = stickHold();
  const a0 = { x: jeep.x, z: jeep.z };
  st.set(0, 1); await t.wait(3000);
  const moved = Math.hypot(jeep.x - a0.x, jeep.z - a0.z);
  t.scene('Phone: driving');
  let turned = 0;
  for (let i = 0; i < 5; i++) { const h = head(); st.set(i % 2 ? -1 : 1, 1); await t.wait(900); turned = Math.max(turned, Math.abs(wrap(head() - h))); if (i === 2) t.scene('Phone: steering'); }
  const brake = press($('#touch .a')); st.set(0, 0);
  const sp0 = jeep.vehicle.speed || 0; await t.wait(1500);
  const sp1 = jeep.vehicle.speed || 0; brake(); st.release();
  await t.wait(1500);
  const d = m1.stop();
  t.event('touch-steer-responds', `the stick drove the 4x4 ${moved.toFixed(1)} m and turned it up to ${turned.toFixed(2)} rad`);
  if (moved < 3) t.problem('error', `the stick did not drive the 4x4 (${moved.toFixed(1)} m in 3 s)`);
  if (turned < 0.15) t.problem('error', `the stick did not steer the 4x4 (${turned.toFixed(2)} rad)`);
  t.event('touch-brake-responds', `A held: speed ${Number(sp0).toFixed(1)} to ${Number(sp1).toFixed(1)}`);
  if (sp0 > 4 && sp1 > sp0 * 0.9) t.problem('error', 'the brake button did not slow the 4x4');
  t.metric('driveFps', d.fps); t.metric('driveWorstFrameMs', d.worst); t.metric('driveFreezes', d.freezes);
  t.event('drive-fps', `${d.fps} fps driving with touch (worst frame ${d.worst} ms, ${d.freezes} freezes over 500 ms)`);
  if (d.fps < 30) t.problem('error', `the phone held ${d.fps} fps while driving (30 needed)`);
  if (d.freezes) t.problem('error', `${d.freezes} freeze(s) over 500 ms while driving (worst ${d.worst} ms)`);
  // 2) the barrels
  await tapButton(t, $('#touch .b')); await t.wait(1200);
  const barrels = () => [...W().entities].filter((e) => e.data && (e.data.barrel || e.data.explosive) && !e._exploded);
  const b1 = W().byId.get('barrel_1');
  G().mayhem.spawnMany('barrel', 5, { at: [b1.x + 2.6, b1.y, b1.z], pattern: 'line', spacing: 1.3 });
  P().tool = 'rocket-launcher';
  t.event('setup-shortcut', 'the rocket launcher put in hand and five more fuel barrels spawned beside the five on the beach, so ten in all');
  await t.wait(1200);
  const total = barrels().length;
  await stickTo('barrel_1', 9, 60000, 'the fuel barrels');
  const booms = [];
  G().on('explosion', () => booms.push(performance.now()));
  await t.until(() => $('.mh-fire:not([hidden])'), 8000, 'the FIRE button');
  let result = null;
  for (let tries = 0; tries < 4 && !result; tries++) {
    // turn to the barrels with a thumb drag (the first drags learn which way it turns)
    let sign = 1, last = null;
    for (let k = 0; k < 30; k++) {
      const p = W().byId.get('barrel_1'), err = wrap(Math.atan2(p.x - P().x, p.z - P().z) - camYaw());
      if (Math.abs(err) < 0.3) break;
      if (last !== null && Math.abs(err) > Math.abs(last) + 0.02) sign = -sign;
      last = err;
      await dragLook(t, Math.sign(err) * sign * Math.min(160, Math.abs(err) * 140 + 30)); await t.wait(100);
    }
    const m2 = frameMeter(), first = booms.length;
    await tapButton(t, $('.mh-fire:not([hidden])'), 200);
    t.event('touch-fire-tapped', `FIRE tapped, shot ${tries + 1}`);
    await t.until(() => booms.length > first, 7000, 'the rocket to land').catch(() => {});
    await t.wait(5500);
    const r = m2.stop();
    if (booms.length > first) result = { ...r, n: booms.length - first };
    else { t.problem('warning', `shot ${tries + 1} did not land`); await stickTo('barrel_1', Math.max(3.5, 9 - (tries + 1) * 1.8), 20000, 'the fuel barrels'); }
  }
  if (!result) throw new Error('FIRE never sent a rocket that landed');
  t.scene('Phone: the chain');
  t.event('touch-fire-responds', `FIRE tapped with a thumb: ${result.n} explosions of ${total} barrels`);
  t.metric('blastFps', result.fps); t.metric('blastWorstFrameMs', result.worst); t.metric('blastFreezes', result.freezes);
  t.event('blast-fps', `${result.fps} fps through the shot and the chain with touch (worst frame ${result.worst} ms, ${result.freezes} freezes over 500 ms)`);
  t.metric('blastHitchesOver100ms', result.hitches);
  if (result.hitches) t.problem('error', `${result.hitches} frame(s) over 100 ms in the 5-barrel chain on the phone (worst ${result.worst} ms)`);
  blastLayers(t, 'phone');
  if (result.fps < 30) t.problem('error', `the phone held ${result.fps} fps through the explosions (30 needed)`);
  if (result.freezes) t.problem('error', `${result.freezes} freeze(s) over 500 ms in the explosions (worst ${result.worst} ms)`);
  releaseAll();
}

const RUN = {
  models: stageModels,
  hats: stageHats,
  landing: stageLanding, veil: stageVeil, intro: stageIntro, firstvisit: stageFirstVisit, mirror: stageMirror, mirrorlayout: stageMirrorLayout, hudoverlap: stageHudOverlap, sheet: stageSheet, asks: stageAsks, answer: stageAnswer, toeditor: stageToEditor, editor: stageEditor, pier: stagePier, drive: stageDrive, fish: stageFish, chapter: stageChapter, presence: stagePresence, introc: stageIntroCascade, arrivals: stageArrivals, back2: stageBack2, observatory: stageObservatory, finale: stageFinale, wardrobe: stageWardrobe, race: stageRace, feel: stageFeel, blast: stageBlast, board: stageBoard, game: stageGame, journal: stageJournal, faces: stageFaces, progress: stageProgress, wish: stageWish, react: stageReact, alive: stageAlive, touch: stageTouch, phoneperf: stagePhonePerf, motion: runCharacterMotion, soundscape: (t, ctx) => runIslandSoundscape(t, { setKeys, lookAt, camYaw, holdMouse, walkTo, tap, HOOKS, releaseAll, options: ctx && ctx.options }), wind: (t, ctx) => runIslandWind(t, { setKeys, lookAt, camYaw, holdMouse, walkTo, tap, HOOKS, releaseAll, stickHold, tapButton, $, options: ctx && ctx.options }), look: (t, ctx) => runIslandLook(t, { setKeys, lookAt, camYaw, holdMouse, walkTo, tap, HOOKS, releaseAll, stickHold, tapButton, $, options: ctx && ctx.options }), music: (t, ctx) => runIslandMusic(t, { setKeys, lookAt, camYaw, holdMouse, walkTo, tap, HOOKS, releaseAll, options: ctx && ctx.options }), islandalive: (t, ctx) => runIslandAlive(t, { setKeys, lookAt, camYaw, releaseAll, stickHold, dragLook, options: ctx && ctx.options }), routines: (t, ctx) => runIslandRoutines(t, { setKeys, lookAt, camYaw, holdMouse, walkTo, tap, HOOKS, releaseAll, options: ctx && ctx.options }), landcam: (t, ctx) => runLandingCameraFeel(t, { setKeys, lookAt, camYaw, holdMouse, walkTo, tap, HOOKS, releaseAll, options: ctx && ctx.options }), leave: stageLeave, back: stageBack,
  mix: (t, ctx) => runIslandMix(t, { setKeys, lookAt, camYaw, releaseAll, HOOKS, touchEv, tapButton, stickHold, options: ctx && ctx.options }),
  ovsound: (t, ctx) => runOverseerSound(t, { setKeys, lookAt, camYaw, releaseAll, HOOKS, touchEv, options: ctx && ctx.options }),
};
STAGES.push('pier');
ORDERS['sandbox-pier-marker'] = ['landing', 'veil', 'intro', 'mirror', 'pier'];
RUN.gamemenu = (t, ctx) => runGameMenu(t, ctx);
// Island invitations (island-invite): after the sheet, the inviter's stage, then the friend's page on a closed island.
STAGES.push('invite', 'gone', 'own');
ORDERS['island-invite'] = ['landing', 'veil', 'intro', 'mirror', 'sheet', 'invite', 'gone', 'own'];
RUN.invite = stageInvite;
RUN.gone = stageGone;
RUN.own = stageOwn;
// The friend's own browser (island-invite-friend): signed out, from the invitation link.
STAGES.push('fcheck', 'farrive');
ORDERS['island-invite-friend'] = ['landing', 'fcheck', 'veil', 'intro', 'mirror', 'farrive'];
/** The page after the link: the island, or the card that says why not. */
async function stageFriendCheck(t, ctx) {
  const expect = ctx.options.expect || 'open';
  await t.until(() => (W() && W().player) || $('[data-invite]'), 90000, 'the island or the invitation card');
  const box = $('[data-invite]');
  if (expect === 'open') {
    if (box) throw new Error(`the invitation did not open: ${box.dataset.invite}: ${(box.querySelector('p') || {}).textContent}`);
    t.event('invite-read', 'the invitation answered open to a signed-out visitor');
    return;
  }
  t.event('invite-gone', `${box ? box.dataset.invite : 'no card'}: ${box ? (box.querySelector('p') || {}).textContent : ''}`);
  t.scene('Invitation: ' + expect);
  if (!box || box.dataset.invite !== expect) throw new Error(`expected a ${expect} invitation, got ${box ? box.dataset.invite : 'the island'}`);
  const own = box.querySelector('[data-own]');
  if (!own) throw new Error('no way to start their own island');
  t.event('own-island-offered', `"${own.textContent}"`);
  writeRun({ ...ctx.saved(), leg: 'own' });
  own.click();
  await t.until(() => W() && W().player && !/[?&]invite=/.test(location.search) && !$('[data-invite]'), 60000, 'their own island');
  t.event('own-island', `${location.pathname}: their own island loads`);
  t.finish('done');
  return 'stop';
}
/** Beamed in beside the inviter, who is on the other browser. */
async function stageFriendArrive(t, ctx) {
  const host = () => { const N = window.HawkesNet; const peers = N && N.peers && N.peers(); return peers && N.host ? peers.get(N.host) : null; };
  await t.until(() => { const h = host(); return h && h.state && h.state.p && W() && W().player; }, 60000, 'the inviter to be in the room');
  t.event('inviter-found', 'the island room has the inviter in it');
  const p = W().player;
  await t.until(() => { const h = host().state.p; return Math.hypot(p.x - h[0], p.z - h[2]) < 6; }, 15000, 'the friend to be beamed in beside the inviter');
  const h = host().state.p;
  t.event('friend-beamed', `${Math.round(Math.hypot(p.x - h[0], p.z - h[2]) * 10) / 10} m from the inviter`);
  t.scene('Friend: beside the inviter');
  await t.until(() => /is here\. Go to them\.|Someone is here\. Go to them\./.test(document.body.innerText), 15000, 'the Overseer to send the friend to them').then(
    () => t.event('overseer-line', 'the friend hears: Go to them.'), (e) => t.problem('error', e.message));
  t.progress(1);
}
RUN.fcheck = stageFriendCheck;
RUN.farrive = stageFriendArrive;
// Share this moment (share-moment): after the sheet, the blast stage's rocket at fresh barrels, the chip, the tap, the link.
STAGES.push('moment');
ORDERS['share-moment'] = ['landing', 'veil', 'intro', 'mirror', 'sheet', 'moment'];
RUN.moment = stageMoment;
RUN.firstload = (t, ctx) => runFirstLoad(t, ctx, { W, G, HP, setKeys, stickHold, tap, isLive });
/** The stages a page that follows a leg change carries on with (the first-minutes ones are already done). */
const legSeq = (id, prior) => (id === 'editor-bridge' && prior && prior.leg === 'editor' ? ['editor'] : id === 'island-invite' && prior && (prior.leg === 'gone' || prior.leg === 'own') ? [prior.leg] : null);

ORDERS['first-load'] = ['landing', 'veil', 'firstload'];
const ENDS = { 'chapter-one-finale': 'finale', 'first-load': 'firstload', 'hud-overlap': 'hudoverlap', 'mirror-panel-layout': 'mirrorlayout', 'character-motion': 'motion', 'landing-camera-feel': 'landcam', 'island-soundscape': 'soundscape', 'island-music': 'music', 'island-look': 'look', 'island-wind': 'wind', 'island-water': 'water', 'island-mix': 'mix', 'overseer-sound': 'ovsound', 'island-routines': 'routines', 'island-alive': 'islandalive', 'overseer-personality': 'react', 'overseer-first-visit': 'firstvisit', 'island-invite-friend': 'farrive', 'sandbox-daily-wish': 'wish', 'island-invite': 'own', 'share-moment': 'moment', 'sandbox-progress': 'progress', smoke: 'intro', 'sandbox-first-minutes': 'fish', 'sandbox-pier-marker': 'pier', 'sandbox-chapter-one': 'chapter', 'presence-who': 'presence', 'sandbox-observatory': 'observatory', 'observatory-wardrobe': 'wardrobe', 'island-race': 'race', 'vehicle-feel': 'feel', 'rocket-blast-feel': 'blast', 'sandbox-travel-board': 'board', 'island-journal': 'journal', 'ask-the-overseer': 'asks', 'overseer-ask': 'answer', 'editor-bridge': 'editor', 'faces-and-emotes': 'faces', 'overseer-alive': 'alive', 'touch-controls': 'touch', 'phone-performance': 'phoneperf', 'sandbox-return': 'back', 'island-arrivals': 'back2', 'gen-models-pilot': 'models', 'gen-models-all': 'models', 'gen-hats': 'hats' };


// ---------------------------------------------------------------------------------------------- share-moment
/** A big blast with the rocket launcher at three fresh barrels ten metres ahead (real input: the camera turned, the click). */
async function blastAhead(t, booms) {
  const P = W().player;
  const yaw = camYaw();
  G().mayhem.spawnMany('barrel', 3, { at: [P.x + Math.sin(yaw) * 10, P.y, P.z + Math.cos(yaw) * 10], pattern: 'line', spacing: 1.3 });
  await t.wait(700);
  const n = booms.length;
  await holdMouse(t, 160);
  // The rocket's flight is the engine's own; when none lands in 8 s, the hook fires the engine's explosion at the player's side.
  const landed = await t.until(() => booms.length > n, 8000, 'the rocket to land').then(() => true, () => false);
  if (!landed) {
    t.event('rocket-no-boom', 'no explosion from the rocket in 8 s: the playtest hook sets one off');
    HOOKS.explode(t, { ahead: 10 });
    await t.until(() => booms.length > n, 4000, 'the explosion event (stage "blast": hooks.explode fired, the engine emitted none)');
  }
}
/** The chip after a big explosion; a guest taps it, signs in on the sheet and comes back to the same moment, and the link opens a page. */
async function stageMoment(t, ctx) {
  await t.until(() => G() && G().mayhem && W() && W().player && HP().share && HP().share.moments, 90000, 'the island and the share module');
  await t.wait(1500);
  const Mo = () => HP().share.moments;
  const states = [];
  G().on('moment', (d) => states.push(d));
  const booms = [];
  G().on('explosion', (d) => booms.push(d));
  W().player.tool = 'rocket-launcher';
  t.event('setup-shortcut', 'the rocket launcher put in hand (the tour gives it at the barrels)');
  // 1. Inside the tour's first minute: a big blast, and no chip.
  const age = Mo().tourAge();
  if (age !== null && age < 50000) {
    await blastAhead(t, booms);
    await t.wait(1500);
    if (Mo().visible) t.problem('error', 'the chip appeared in the first minute of the tour');
    else t.event('chip-held-back', `a rocket blast ${Math.round(age / 1000)} s into the tour: no chip`);
    t.scene('First minute: no chip');
  } else t.event('chip-held-back-skipped', age === null ? 'the tour has not begun on this page' : `already ${Math.round(age / 1000)} s into the tour`);
  // 2. Past the minute (and the quiet after the last chip): wait it out.
  await t.until(() => { const a = Mo().tourAge(); return a === null || a > 62000; }, 90000, 'the first minute of the tour to pass');
  // The player is a guest now (NAMED SHORTCUT: signed out, the page unchanged; the island stays as it is).
  await fetch('/v1/users/logout', { method: 'POST', credentials: 'same-origin' });
  const user = await fetch('/v1/users/me', { credentials: 'same-origin' }).then((r) => r.json()).then((d) => d.user).catch(() => null);
  t.event('setup-shortcut', `signed out, as a guest${user ? ' (still signed in: the sign-out did not take)' : ''}`);
  await blastAhead(t, booms);
  await t.until(() => Mo().visible, 6000, 'the Share this moment chip');
  const first = Mo().state();
  t.scene('Share this moment: the chip');
  t.event('chip-shown', `${first.kind}: "${first.caption}", ${(document.querySelector('.sh-moment') || {}).textContent || ''}`.replace(/\s+/g, ' '));
  // 3. One tap: the guest gets the sheet.
  document.querySelector('.sh-moment [data-a="keep"]').click();
  t.event('chip-tapped', 'one tap on the chip');
  await t.until(() => $('#gsEmail') || $('#gsGoogle'), 40000, 'the account sheet to open for the moment');
  t.scene('The sign-up sheet, from the moment');
  t.event('sheet-for-share', ($('#gsTitle') || {}).textContent || '');
  if (!$('#gsEmail')) throw new Error('the sheet is Google only: a playtest cannot sign back in with a throwaway account');
  if (!ctx.account) throw new Error('no throwaway account from the sheet stage');
  const set = (id, v) => { const el = $(id); el.focus(); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
  const swap = $('#gsSwap [data-swap]');
  if (swap && /sign in/i.test(swap.textContent)) swap.click();
  set('#gsEmail', ctx.account.email);
  set('#gsPw', ctx.account.password);
  await t.wait(600);
  $('#gsGo').click();
  await t.until(() => !$('#gsEmail') || ($('#gsErr') && !$('#gsErr').hidden && $('#gsErr').textContent.trim()), 25000, 'the sign-in to answer');
  if ($('#gsEmail')) throw new Error(`the sign-in was refused: ${$('#gsErr').textContent.trim().slice(0, 160)}`);
  t.event('signed-in', 'the sheet closed; the island carries on');
  // 4. The same moment, and the link.
  const done = await t.until(() => states.find((s) => s.state === 'link') || (states.find((s) => s.state === 'failed') && 'failed'), 90000, 'the share link');
  if (done === 'failed') throw new Error(`the moment did not become a link: ${(states.find((s) => s.state === 'failed') || {}).reason}`);
  if (done.kind !== first.kind || done.caption !== first.caption) t.problem('error', `the moment changed over the sheet (${first.kind} > ${done.kind})`);
  else t.event('same-moment', `${done.kind}: "${done.caption}" is still the moment after the sheet`);
  t.event('share-link', `${done.url} (${done.media})`);
  t.scene('Share this moment: the link');
  // 5. The page and its card.
  const html = await fetch(done.url, { credentials: 'omit' }).then((r) => r.text());
  const name = (((HP().presence || {}).look || {}).name || '');
  const hasCaption = html.includes(first.caption.replace(/'/g, '&#39;')) || html.includes(first.caption);
  const hasName = !name || html.includes(name);
  const og = /<meta property="og:image" content="([^"]+)"/.exec(html);
  if (!hasCaption || !hasName) t.problem('error', `the share page misses ${!hasName ? 'the character name' : 'the Overseer\'s line'}`);
  else t.event('share-page', `shows ${name ? `"${name}" and ` : ''}the Overseer's line, in the sky with the ship (${html.includes('sh-pearl') ? 'pearl' : 'no pearl'})`);
  if (!og) t.problem('error', 'the share page has no og:image');
  else {
    const img = await fetch(og[1], { credentials: 'omit' });
    if (!img.ok || !/^image\//.test(img.headers.get('content-type') || '')) t.problem('error', `the card image does not load (${img.status})`);
    else t.event('og-image', `${og[1]} loads (${img.headers.get('content-type')})`);
  }
  const frame = document.createElement('iframe');
  frame.src = new URL(done.url).pathname;
  frame.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;border:0;z-index:2147483000;background:#fff';
  document.body.appendChild(frame);
  await new Promise((res) => { frame.onload = res; setTimeout(res, 8000); });
  await t.wait(1500);
  t.scene('The share page');
  frame.remove();
  t.progress(1);
}

// ---------------------------------------------------------------------------------------------- island-invite
/** The inviter: the Invite button gives a link, the pause menu offers it too, the island's room opens, a friend arrives. */
async function stageInvite(t, ctx) {
  await t.until(() => W() && W().player && $('.gs-acts [data-intent="invite"]'), 40000, 'the Invite button');
  const btn = $('.gs-acts [data-intent="invite"]');
  t.event('invite-button', `"${btn.textContent}" among the buttons top right`);
  if (!/Copy invite link/.test(btn.textContent)) t.problem('error', 'the button does not say Copy invite link');
  t.scene('Island: the Invite button');
  const joined = [];
  G().on('joined', (d) => { joined.push(d); });
  btn.click();
  await t.until(() => $('[data-invite="link"] input'), 15000, 'the invitation link');
  const link = new URL($('[data-invite="link"] input').value);
  const token = link.searchParams.get('invite') || '';
  const room = (() => { try { return JSON.parse(atob(token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/'))).r; } catch (e) { return ''; } })();
  t.event('invite-link', `${link.pathname}?invite=… for room ${room}${link.searchParams.get('ref') ? ' and ?ref=' + link.searchParams.get('ref') : ' (a guest: no referral code)'}`);
  if (link.pathname !== '/play/sandbox' || !room) t.problem('error', 'the invitation link does not open the island');
  t.scene('Island: the invitation link');
  // The game menu offers it too (one Esc).
  await tap(t, 'Escape');
  await t.until(() => /Invite a friend/.test(($('.gm-panel, .ui-menu') || {}).textContent || ''), 5000, 'the game menu with Invite a friend').then(
    () => { t.event('pause-menu-invite', 'Esc: Paused > Resume, Invite a friend, Change my look'); t.scene('Island: the pause menu'); const r = [...document.querySelectorAll('.gm-btn, .ui-menu .ui-btn')].find((b) => /Resume/.test(b.textContent)); if (r) r.click(); },
    (e) => t.problem('error', e.message));
  const st = await fetch(`/v1/island-invite/${token}`).then((r) => r.json());
  t.event('invite-status', `${st.state}${st.name ? ' (' + st.name + ')' : ''}`);
  if (st.state !== 'open') t.problem('error', `the invitation reads "${st.state}" while the inviter is on the island`);
  // The friend. NAMED SHORTCUT: their page (loading, short intro, mirror, sheet) is another browser; here it is a socket in the room,
  // as that page opens after the mirror (join=1), standing where the inviter is.
  // friend: "browser": no shortcut. The invitation is published (the event, window.hawkesInvite, the page title) for a second
  // browser context, which plays island-invite-friend with this link; the run waits for it to arrive (up to friendWait seconds).
  const real = ctx.options.friend === 'browser';
  let ws = null;
  let beat = null;
  if (real) {
    window.hawkesInvite = { link: link.href, room, token };
    t.event('friend-link', `waiting for a second browser to open ${link.origin}${link.pathname}?invite=… (play island-invite-friend with {"link": the invite-link above})`);
  } else {
    const via = (window.HawkesNet && window.HawkesNet.via) || { kind: 'site' };
    const near = () => { const p = W().player; return { t: 'me', at: Date.now(), s: { p: [p.x + 1.6, p.y, p.z + 1], y: 0, pi: 0, f: 0 } }; };
    if (via.kind === 'hawkesnet') {
      // The island's room is on Hawkes Net (src/hnet.ts): the friend joins it the way a page does, a ticket from this site.
      t.event('setup-shortcut', `the friend is a Hawkes Net player in the island room named Visitor (over ${via.transport}; their page is a second browser)`);
      const mod = await import('/play/hawkes-net.mjs');
      const ask = async () => { const r = await fetch('/v1/net/ticket', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ play: 't/sandbox', room, name: 'Visitor', join: true, sdk: mod.VERSION }) }); const j = await r.json(); if (!r.ok) throw Object.assign(new Error(j.error || `ticket ${r.status}`), { status: r.status }); return j; };
      const first = await ask();
      let used = false;
      const friend = await mod.join(first.room, { project: 'hawkesgenwebsite', transport: 'auto', leaveOnHide: false, log: false, ticket: async () => (used ? ask() : ((used = true), first)), onRaw: () => {} });
      beat = setInterval(() => friend.raw.send({ ...near(), at: friend.now() }), 100);
      ws = { close: () => void friend.leave('done') };
    } else {
      t.event('setup-shortcut', 'the friend is a socket in the island room named Visitor (their page is a second browser)');
      const sock = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/v1/ws?play=t/sandbox&room=${room}&name=Visitor&join=1&v=2`);
      ws = sock;
      sock.onmessage = (e) => { if (beat || !/"hello"/.test(e.data)) return; beat = setInterval(() => { if (sock.readyState === 1) sock.send(JSON.stringify(near())); }, 100); };
      await t.until(() => sock.readyState === 1, 8000, 'the friend to join the room');
    }
  }
  const wait = real ? Number(ctx.options.friendWait || 150) * 1000 : 0;
  await t.until(() => /Someone is coming\./.test(document.body.innerText), 15000 + wait, 'the Overseer to say someone is coming').then(
    () => t.event('overseer-line', '"Someone is coming." in the chat'), (e) => t.problem('error', e.message));
  await t.until(() => joined.length, 20000 + wait, 'the newcomer to be beamed in').then(
    () => { t.event('beam-seen', `joined: ${joined[0].name}`); t.scene('Island: someone is coming down the beam'); }, (e) => t.problem('error', e.message));
  const who = real ? ((joined[0] && joined[0].name) || '') : 'Visitor';
  await t.until(() => (who ? document.body.innerText.includes(`${who} is here.`) : /\S+ is here\./.test(document.body.innerText)), 15000, 'the Overseer to name the friend').then(
    () => t.event('friend-named', `${who || 'the friend'}, in the chat and over the newcomer`), (e) => t.problem('error', e.message));
  await t.until(() => { const w = $('[data-invite="welcome"]'); return w && /joined your island/.test(w.textContent); }, 10000, 'the welcome card for the newcomer').then(
    () => t.event('welcome-moment', `a card on screen: "${$('[data-invite="welcome"] b').textContent}"`), (e) => t.problem('error', e.message));
  await t.wait(1500);
  t.scene('Island: the friend beside the inviter');
  clearInterval(beat);
  if (ws) ws.close();
  // The friend's page on an island nobody is on any more: a new invitation (no one in its room) is closed.
  const fresh = await fetch('/v1/island-invite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"name":"Playtest"}' }).then((r) => r.json());
  writeRun({ ...ctx.saved(), leg: 'gone' });
  t.event('friend-page', 'opening an invitation to an island nobody is on');
  // The link names the portal's PUBLIC_URL; the browser stays on the origin the run is on (a preview or local server), where the
  // friend's cold page is as open as the inviter's: another host would be a different server (or Studio's login gate: 401).
  const there = new URL(fresh.link);
  location.href = there.pathname + there.search;
  await t.wait(30000);
  throw new Error('the invitation page did not open');
}

/** The friend's page on a closed island: the reason in plain words, and a way to start their own. */
async function stageGone(t, ctx) {
  await t.until(() => $('[data-invite]'), 30000, 'the closed-island message');
  const box = $('[data-invite]');
  t.event('invite-gone', `${box.dataset.invite}: ${(box.querySelector('p') || {}).textContent}`);
  t.scene('Invitation: the island is closed');
  if (box.dataset.invite !== 'closed') t.problem('error', `expected a closed island, got ${box.dataset.invite}`);
  const own = box.querySelector('[data-own]');
  if (!own) throw new Error('no way to start their own island');
  t.event('own-island-offered', `"${own.textContent}"`);
  writeRun({ ...ctx.saved(), leg: 'own' });
  own.click();
  await t.wait(30000);
  throw new Error('their own island did not open');
}

/** Their own island, after "Start my own island": no invitation in the address, the game is there. */
async function stageOwn(t, ctx) {
  await t.until(() => W() && W().player, 40000, 'their own island');
  if (/[?&]invite=/.test(location.search) || $('[data-invite]')) t.problem('error', 'the invitation is still on the page');
  t.event('own-island', `${location.pathname}${location.search}: their own island loads`);
  t.scene('Their own island');
  t.progress(1);
}

// ---------------------------------------------------------------------------------------------- the contract
let api = null;
let resumed = null;
export function install() {
  if (api) return api;
  const saved0 = readRun();
  api = installPlaytest({
    product: 'hawkesgenwebsite',
    scenarios: SCENARIOS,
    stallSeconds: 120,
    isReady: () => (onEditor() ? document.readyState === 'complete' : onSandbox() || onGame() ? Boolean(W() && W().player) || document.readyState === 'complete' : document.readyState === 'complete'),
    async start(id, options, t) {
      if (id === SITE_LAYOUT.id) return runSiteLayout(t, options);
      if (id === PHONE_HUD_LAYOUT.id) return runPhoneHudLayout(t, options);
      if (id === 'hud-overlap') return runHudOverlap(t, options);
      if (id === LOADING_WRAPPER.id) return runLoadingWrapper(t, options);
      if (id === SICKOFIT_PAGE.id) return runSickofitPage(t, options);
      if (id === AVATAR_ANIMATIONS.id) return runAvatarAnimations(t, options);
      if (id === STORE_PAGES.id) return runStorePages(t, options);
      if (id === COMMUNITY_LIBRARY.id) return runCommunityLibrary(t, options);
      if (id === PROFILE_PAGE.id) return runProfilePage(t, options);
      if (id === WORLD_REPORT.id) return runWorldReport(t, options);
      if (id === SERVER_LIMITS.id) return runServerLimits(t, options);
      if (id === WORLD_QUALITY.id) return runWorldQuality(t, options);
      if (id === 'observatory-wardrobe' && options.touch) options = { at: 'sandbox', ...options }; // (touch: straight to the island with the phone controls)
      if ((id === 'vehicle-feel' || id === 'rocket-blast-feel' || id === 'sandbox-first-minutes') && options.touch) options = { at: 'sandbox', ...options };
      if (id === CHARACTER_MOTION.id) options = { at: 'sandbox', ...options }; // (straight to the island; touch: true adds the phone controls)
      if (id === 'touch-controls' || id === 'phone-performance') options = { at: 'sandbox', touch: true, ...options }; // (the phone controls, straight to the island)
      const events = [];
      // Everything the run says is kept, so the page that follows can carry the whole report.
      const ev = t.event.bind(t);
      const sc = t.scene.bind(t);
      t.event = (type, detail) => { events.push(['e', type, detail]); ev(type, detail); };
      t.scene = (name) => { events.push(['s', name]); sc(name); };
      const ctx = {
        id,
        options,
        saved: () => ({ id, options: { ...options, resumed: undefined }, events, name: ctx.name, what: ctx.what, visit: ctx.visit, tour: ctx.tour }),
        leg: options.resumed && options.resumed.leg,
        visit: (options.resumed && options.resumed.visit) || 0,
        name: options.resumed && options.resumed.name,
        what: options.resumed && options.resumed.what,
        tour: options.resumed && options.resumed.tour,
      };
      const prior = options.resumed;
      if (prior) { // the landing page's part of the run, replayed
        for (const [k, a, b] of prior.events) { if (k === 's') sc(a); else ev(a, b); events.push([k, a, b]); }
        ev('page-changed', prior.leg ? `${prior.leg === 'game' ? 'the Observatory' : 'the game'} > ${location.pathname}` : 'landing page > /play/sandbox');
      }
      const to = STAGES.indexOf(options.to && STAGES.includes(options.to) ? options.to : ENDS[id]);
      const from = prior || onSandbox() ? 1 : 0;
      t.event('plan', `${id}: ${STAGES[from]} to ${STAGES[to]}${isLive() ? ' (live: no sign-up)' : ''}`);
      let named = '';
      try {
        const seq = legSeq(id, prior) || (id === 'island-arrivals' && prior && prior.leg === 'return' ? ['back2'] : id === 'sandbox-return' && prior && prior.leg === 'return' ? ['back'] : id === 'sandbox-travel-board' && prior && prior.leg === 'game' ? ['game'] : id === 'sandbox-travel-board' && prior && prior.leg === 'back' ? ['board'] : ORDERS[id] ? ORDERS[id].slice(ORDERS[id].indexOf(STAGES[from])) : STAGES.slice(from, to + 1).filter((s) => s !== 'firstvisit')); // firstvisit is only for overseer-first-visit's own order: 'intro' already watched or skipped the intro
        for (const stage of seq) {
          named = stage;
          if ((await RUN[named](t, ctx)) === 'stop') return;
          t.event('stage-done', named);
        }
      } catch (e) {
        throw stageError(named, e);
      } finally { releaseAll(); }
      t.finish('done');
    },
    stop() { releaseAll(); writeRun(null); },
  });
  // The page after the Play click carries the run on (and a runner's own start() of the same run doesn't restart it).
  if (saved0 && (onSandbox() || onGame() || onEditor())) {
    const start = api.start.bind(api);
    const go = () => (onEditor() || Boolean(W() && W().player) || document.readyState === 'complete' ? (resumed = start(saved0.id, { ...saved0.options, resumed: saved0 })) : setTimeout(go, 250));
    api.start = (id, o) => (resumed && id === saved0.id ? resumed : start(id, o));
    writeRun(null);
    go();
  }
  return api;
}
install();
