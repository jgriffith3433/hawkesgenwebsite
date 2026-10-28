// What a game may ask the editor (docs/engine-modules.md, "What a game may ask the editor").
// Game scripts run in the same window as the engine (runtime.js), so anything the frame posts to the editor is only a
// request, never a decision: spending and acting on the account are the editor's. This file is the editor's door:
// an allowlist of message types, a rate limit on the ones that act by themselves, and a gate that keeps at most one
// generation card open. No DOM in here, so the tests drive it directly (test/engine/bridge.test.ts).

/** Every type the editor answers; anything else is ignored. */
export const ALLOWED = new Set([
  'analytics', 'analytics-activity', 'overseer-lines', 'overseer-memory', 'overseer-seen', 'ready', 'started', 'error', 'log',
  'chat-line', 'chat-status', 'overseer-say', 'ops', 'save', 'resync', 'context', 'ask', 'focus-chat', 'generate', 'open-code',
  'net', 'mode', 'menu', 'card', 'selected', 'library', 'spawn-community', 'basics', 'words', 'share-open', 'share-media', 'kit-share',
]);

/** The ones that act on their own because the person is building: messages allowed a second (the excess is dropped). */
export const LIMITS = { ops: 30, 'spawn-community': 2, 'share-open': 2 };

export function createBridge({ run, warn = (t) => console.warn(t), now = () => Date.now() }) {
  const stamps = { ops: [], 'spawn-community': [], 'share-open': [] };
  const warned = new Set();
  let card = false;
  const drop = (type, why) => { if (!warned.has(type)) { warned.add(type); warn(`A game message was dropped (${type}: ${why}). Spending and acting on the account are the editor's decision.`); } };
  return {
    /** The generation card is open (or not). While it is, 'generate' requests from the frame are dropped. */
    get cardOpen() { return card; },
    closeCard() { card = false; },
    /** One message from the frame (already checked to come from the frame and to carry source 'hawkes-play'). */
    handle(m) {
      const type = m && typeof m.type === 'string' ? m.type : '';
      if (!ALLOWED.has(type)) return undefined;
      const limit = LIMITS[type];
      if (limit) {
        const t = now();
        const recent = stamps[type].filter((s) => t - s < 1000);
        if (recent.length >= limit) { stamps[type] = recent; drop(type, `more than ${limit} a second`); return undefined; }
        recent.push(t);
        stamps[type] = recent;
      }
      if (type === 'generate') {
        if (card) return undefined;
        card = true;
      }
      return run(m);
    },
  };
}

/** The links a game or its chat may offer a person. A game's words are data: only a path on this site (one '/', never
 *  '//' or '/\\', which a browser reads as another host) or an https page of ours is a link; anything else (another
 *  site, javascript:, data:) is shown as plain text. `origins` adds this page's own origin (the beta host). Returns the
 *  link to use, or null. The game side has the same rule (play/modules/overseer/chat.js `safeHref`). */
export const OWN_ORIGINS = ['https://hawkesgen.ai', 'https://www.hawkesgen.ai'];
export function safeHref(href, origins = []) {
  const s = String(href ?? '').trim();
  if (!s || /[\u0000-\u001f\u007f\\]/.test(s)) return null;
  if (s[0] === '/') return s[1] === '/' ? null : s;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' && [...OWN_ORIGINS, ...origins].includes(u.origin) ? u.href : null;
  } catch { return null; }
}
