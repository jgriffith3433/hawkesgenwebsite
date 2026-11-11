// The `first-load` scenario: how long a stranger waits from Play to moving, and whether the console stays clean on the way.
// From the landing page (a cold cache is the runner's fresh browser profile; the run reports how many requests came from
// the cache, so a warm one shows), a real click on Play now, then, on the play page: ms to the loading screen, ms to the
// island's first frame (`sandbox_first_frame`, guest.js's `hg-first-frame` mark), ms to the first accepted player input
// (real key or stick, the player moved), and the bytes and requests fetched before the first frame. Every console line that
// contains "WebGL", "GL_" or "WARNING" from the landing page to the end of the intro is listed, and each one is a problem.
// Loaded by portal.js. Reads only (no sign-up, no account, nothing saved): safe on live.
//
// The phone run (`first-load@live:phone`, Studio's twin of the desktop run) is 390x844 with touch; the brief's conditions for
// it are 4x CPU slowdown and 4G (9 Mbit/s, 85 ms). A page cannot set those: the runner does (CDP), and the run reports what the
// page itself can see (`navigator.connection`, a timed loop as `cpuProbeMs`) next to the numbers, so a throttled and an
// unthrottled run can be told apart. It reports its numbers however slow the page is (nothing here fails on time; a first
// frame that never comes is a problem with the numbers so far).
//
//   options { watch: 60 (seconds of intro to let play before a key skips it), touch (the phone controls: the stick) }

export const FIRST_LOAD = {
  id: 'first-load',
  title: 'First load: ms from the Play click to the loading screen, the island\'s first frame and the first accepted input, bytes and requests before the first frame, and no WebGL / GL_ / WARNING console line to the end of the intro',
  seconds: 150,
  tags: ['full', 'perf'],
  description: 'safe on live (reads only; never signs up). The landing page, a real click on Play now, the play page loading, the click-to-enter veil, real input (W, or the stick on a phone), the intro. Metrics: msToLoadingScreen, msToFirstFrame, msToFirstInput (and msToInputReady, before the scenario\'s own pause), bytesBeforeFirstFrame, requestsBeforeFirstFrame, cachedRequests, webglLines, cpuProbeMs. Every console line with WebGL, GL_ or WARNING (and any gl.getError code) from load to the end of the intro is a problem and is listed in the report. Options: watch (seconds of intro before a key skips it, 60), touch',
};

const KEY = 'hg_first_load';
const PATTERN = /WebGL|GL_|WARNING/;
const epoch = (t) => performance.timeOrigin + t;

/** Keeps every console line (and uncaught error) of this page with its time, from the moment this runs. Idempotent: guest.js's own shim (the play page, earlier still) fills the same list. */
export function captureConsole() {
  if (typeof window === 'undefined' || window.__hgConsole) return;
  const lines = window.__hgConsole = [];
  const keep = (level, text) => { try { lines.push([Math.round(performance.now()), level, String(text).slice(0, 400)]); } catch { /* never breaks the page */ } };
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    const orig = console[level];
    console[level] = function () { keep(level, [].map.call(arguments, (a) => (a && a.message) || (typeof a === 'object' ? (() => { try { return JSON.stringify(a); } catch { return String(a); } })() : a)).join(' ')); return orig.apply(this, arguments); };
  }
  window.addEventListener('error', (e) => keep('pageerror', e.message));
  window.addEventListener('unhandledrejection', (e) => keep('pageerror', (e.reason && e.reason.message) || e.reason));
}
captureConsole();

const read = () => { try { return JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch { return null; } };
const write = (v) => { try { sessionStorage.setItem(KEY, JSON.stringify(v)); } catch { /* private mode: the landing page's part is lost */ } };

/** The page's console so far, as { at: epoch ms, page, level, text }. */
const pageLines = (page) => (window.__hgConsole || []).map(([ms, level, text]) => ({ at: Math.round(epoch(ms)), page, level, text }));

/** A timed loop: how slow this page's CPU is right now (a 4x slowdown makes it about four times longer). */
function cpuProbe() {
  const t0 = performance.now();
  let x = 0;
  for (let i = 0; i < 4e6; i++) x = (x + i * 31) % 997;
  return Math.round(performance.now() - t0 + (x < 0 ? 1 : 0));
}

/** Called just before the real Play click on the landing page: the click's time and the landing page's own console. */
export function markPlayClick() {
  write({ click: Math.round(Date.now()), landing: pageLines('landing'), cpu: cpuProbe(), nav: connection() });
}

function connection() {
  const c = navigator.connection;
  return c ? { type: c.effectiveType, down: c.downlink, rtt: c.rtt } : null;
}

/** Texture and GL state, read once: any error code gl.getError() holds is a "GL_" line of its own. */
function glErrors(where) {
  const out = [];
  try {
    const gl = window.HawkesPlay && window.HawkesPlay.world && window.HawkesPlay.world.scene && window.HawkesPlay.world.scene.getEngine()._gl;
    if (!gl || !gl.getError) return out;
    const names = { [gl.INVALID_ENUM]: 'GL_INVALID_ENUM', [gl.INVALID_VALUE]: 'GL_INVALID_VALUE', [gl.INVALID_OPERATION]: 'GL_INVALID_OPERATION', [gl.INVALID_FRAMEBUFFER_OPERATION]: 'GL_INVALID_FRAMEBUFFER_OPERATION', [gl.OUT_OF_MEMORY]: 'GL_OUT_OF_MEMORY', [gl.CONTEXT_LOST_WEBGL]: 'GL_CONTEXT_LOST_WEBGL' };
    for (let i = 0; i < 8; i++) { const e = gl.getError(); if (!e) break; out.push({ at: Date.now(), page: 'play', level: 'getError', text: `${names[e] || `GL_ERROR_${e}`} (gl.getError, ${where})` }); }
  } catch { /* no engine yet */ }
  return out;
}

/** Bytes and requests fetched by the play page up to `until` (ms on this page's clock). */
function fetched(until) {
  const rows = performance.getEntriesByType('resource').filter((e) => e.responseEnd <= until);
  const nav = performance.getEntriesByType('navigation')[0];
  const all = nav ? [nav, ...rows] : rows;
  const bytes = all.reduce((n, e) => n + (e.transferSize || 0), 0);
  // A file from another address that does not share its sizes (no Timing-Allow-Origin) reports 0: counted apart.
  const unsized = all.filter((e) => !e.transferSize && !e.encodedBodySize && !e.decodedBodySize).length;
  const cached = all.filter((e) => !e.transferSize && e.decodedBodySize > 0).length;
  return { bytes, requests: all.length, unsized, cached };
}

/** The stage that follows the veil: the numbers, real input, the intro to its end, then the report. */
export async function runFirstLoad(t, ctx, h) {
  const { W, G, HP, setKeys, stickHold, tap, isLive } = h;
  const prior = read();
  if (!prior || !prior.click) t.problem('warning', 'no Play click was recorded on the landing page (opened at /play/sandbox directly?): the times run from the page\'s own start');
  const click = prior && prior.click ? prior.click : Math.round(epoch(0));
  const since = (ms) => Math.round(epoch(ms) - click);
  t.event('plan', `first-load${isLive() ? ' (live: reads only)' : ''}: ${HP() && HP().touchUi ? 'phone controls' : 'keyboard and mouse'}`);

  // 1. The loading screen and the first frame, from the marks the page made.
  const mark = (name) => { const m = performance.getEntriesByName(name)[0]; return m ? m.startTime : null; };
  const fcp = (performance.getEntriesByName('first-contentful-paint')[0] || {}).startTime;
  const loadingAt = mark('hg-loading-shown') ?? fcp ?? null;
  const frameWait = await t.until(() => mark('hg-first-frame') !== null, 120000, 'the island\'s first frame (sandbox_first_frame)').then(() => true, () => false);
  const frameAt = mark('hg-first-frame');
  if (loadingAt !== null) { t.metric('msToLoadingScreen', since(loadingAt)); t.event('loading-screen', `${since(loadingAt)} ms after the click`); }
  else t.problem('warning', 'the loading screen\'s mark never came (hg-loading-shown)');
  t.scene('First load: the island\'s first frame');
  if (frameWait && frameAt !== null) {
    t.metric('msToFirstFrame', since(frameAt));
    const f = fetched(frameAt);
    t.metric('bytesBeforeFirstFrame', f.bytes);
    t.metric('requestsBeforeFirstFrame', f.requests);
    t.metric('cachedRequests', f.cached);
    t.metric('unsizedRequests', f.unsized);
    t.event('first-frame', `${since(frameAt)} ms after the click; ${Math.round(f.bytes / 1024)} KB in ${f.requests} requests before it (${f.cached} from the cache, ${f.unsized} with no size)`);
    if (f.cached > 3) t.problem('warning', `the cache was not cold: ${f.cached} requests came from it, the numbers are warmer than a stranger's`);
  } else t.problem('error', 'the island never drew a first frame in 120 s (the numbers so far are in the report)');
  const net = connection();
  t.metric('cpuProbeMs', cpuProbe());
  t.event('conditions', `cpu probe ${prior && prior.cpu !== undefined ? `${prior.cpu} ms on the landing page, ` : ''}${cpuProbe()} ms now; connection ${JSON.stringify(net)}; ${innerWidth}x${innerHeight}${HP() && HP().touchUi ? ' touch' : ''}`);
  const gl = glErrors('first frame');

  // 2. The click-to-enter veil is the scenario's own pause (stageVeil clicked it); then the first input the game accepts.
  await t.until(() => W() && W().player && W().player.alive, 60000, 'the player');
  const p = () => W().player;
  const touch = Boolean(HP().touchUi) || Boolean(ctx.options.touch);
  const g = () => G() && G().overseer;
  await t.until(() => p().controls !== false, 30000, 'the player to be given control').then(() => {
    t.metric('msToInputReady', Math.round(performance.now() + performance.timeOrigin - click));
  }, () => t.problem('error', 'the player was never given control'));
  const start = { x: p().x, z: p().z };
  let stick = null;
  const inputAt = performance.now();
  if (touch) { try { stick = stickHold(); stick.set(0, 1); } catch (e) { t.problem('error', e.message); } } else setKeys({ w: true });
  const moved = await t.until(() => Math.hypot(p().x - start.x, p().z - start.z) > 0.3, 8000, 'the player to move on real input').then(() => true, () => false);
  const movedAt = performance.now();
  if (touch && stick) stick.release(); else setKeys({});
  if (moved) {
    t.metric('msToFirstInput', Math.round(epoch(movedAt) - click));
    t.metric('inputResponseMs', Math.round(movedAt - inputAt));
    t.event('first-input', `${Math.round(epoch(movedAt) - click)} ms after the click; the player moved ${Math.round(movedAt - inputAt)} ms after ${touch ? 'the stick' : 'W'}`);
  } else t.problem('error', 'the player did not move on real input within 8 s (first accepted input not seen)');
  t.scene('First load: moving');

  // 3. The intro to its end (a key skips it after `watch` seconds): the console is watched all the way.
  const watch = Number(ctx.options.watch ?? 60);
  if (g() && g().introPlaying) {
    await t.until(() => !g().introPlaying, watch * 1000, 'the intro to end').then(() => t.event('intro-ended', 'to its end'), async () => {
      await tap(t, 'Enter');
      await t.until(() => !g().introPlaying, 8000, 'the intro to stop after a key').catch((e) => t.problem('error', e.message));
      t.event('intro-skipped', `a key press after ${watch} s`);
    });
  } else t.event('intro-not-playing', 'no intro on this page (a return visit, or it ended already)');
  await t.wait(1500);
  t.scene('First load: the intro is over');
  gl.push(...glErrors('end of the intro'));

  // 4. The console, from the landing page to here.
  const lines = [...(prior ? prior.landing || [] : []), ...pageLines('play'), ...gl];
  const hits = lines.filter((l) => PATTERN.test(l.text));
  t.metric('webglLines', hits.length);
  t.metric('consoleLines', lines.length);
  t.metric('consoleErrors', lines.filter((l) => l.level === 'error' || l.level === 'pageerror').length);
  const seen = new Set();
  for (const l of hits) {
    const k = l.text.replace(/\d+/g, '#').slice(0, 160);
    if (seen.has(k)) continue;
    seen.add(k);
    const n = hits.filter((x) => x.text.replace(/\d+/g, '#').slice(0, 160) === k).length;
    t.event('console-line', `${l.page} ${l.level} +${Math.max(0, l.at - click)} ms${n > 1 ? ` (x${n})` : ''}: ${l.text}`);
    t.problem('error', `console line with WebGL, GL_ or WARNING (${l.page}, ${l.level}): ${l.text.slice(0, 200)}`);
  }
  if (!hits.length) t.event('console-clean', `${lines.length} console lines from load to the end of the intro; none with WebGL, GL_ or WARNING`);
  write(null);
  t.progress(1);
}
