// H.use: "E to ..." for everything a player can do with what's near them. Modules register what they offer (riding a
// horse, talking to a friend, getting into a car, sitting on a chair); every step the engine asks each one, picks one
// (the highest priority, then the nearest), shows it as one line near the bottom of the screen ("E Ride the horse";
// tapping it does it on phones) and does it when E is pressed. docs/engine-modules.md ("Use: E near things").
//
//   H.use.register('ride', {
//     near(player, ctx) { const h = horseNear(player); return h && { label: `Ride ${h.name}`, distance: d, act: () => ride(h) }; },
//   });
//
// An offer: { label, act, priority (0; higher wins: getting off what you're on uses 100), distance (meters; nearer
// wins at the same priority), key (another key that also does it, e.g. 't'), build: true (offered while building too),
// noKey: true (shown and tapped, but E doesn't do it: at a piano E is a note) }.
/* global HawkesPlay */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const defs = new Map();
  let current = null; // the offer shown now
  let shownKey = '';
  let el = null;

  function offers(p) {
    const out = [];
    const building = H.mode === 'build';
    for (const [name, def] of defs) {
      let o = null;
      try { o = def.near(p, { game: H.game, H, mode: H.mode }); } catch (err) { H.report(err, `use ${name}`); }
      if (!o || typeof o.act !== 'function' || (building && !o.build && !def.build)) continue;
      out.push({ name, label: String(o.label || name), act: o.act, priority: Number(o.priority) || 0, distance: Number.isFinite(Number(o.distance)) ? Number(o.distance) : 1e6, key: o.key ? String(o.key).toLowerCase() : null, noKey: Boolean(o.noKey) });
    }
    out.sort((a, b) => b.priority - a.priority || a.distance - b.distance);
    return out;
  }
  function player() { const w = H.world; const p = w && w.player; return p && p.alive && p.controls !== false ? p : null; }
  // (After doing it the line is drawn again, whatever is offered next: null, never '', which means "nothing offered"; with
  // '' a done "Get out of the submarine" stayed on screen when nothing else was near enough to take its place.)
  function run(o) { try { o.act(); } catch (err) { H.report(err, `use ${o.name}`); } current = null; shownKey = null; }

  // Every step: E (or an offer's own key) does it. One action per press.
  H.hooks.step.push(() => {
    const g = H.game, p = player();
    if (!g || !p || !defs.size) return;
    const input = g.input;
    const e = input.pressed('e');
    let other = null;
    if (!e) { for (const def of defs.values()) if (def.keys) for (const k of def.keys) if (input.pressed(k)) other = k; if (!other) return; }
    const list = offers(p);
    const pick = e ? list[0] : list.find((o) => o.key === other);
    if (pick && !(e && pick.noKey)) run(pick);
  });

  // The line on the screen, a few times a second.
  function ui() {
    if (el || typeof document === 'undefined' || !document.body) return el;
    const st = document.createElement('style');
    st.textContent = '.hp-use{position:fixed;left:50%;bottom:22%;transform:translateX(-50%);z-index:30;display:flex;gap:8px;pointer-events:none}.hp-use button{pointer-events:auto;font:600 15px system-ui,sans-serif;color:#fff;background:rgba(10,14,24,.72);border:1px solid rgba(255,255,255,.25);border-radius:12px;padding:9px 14px;cursor:pointer;backdrop-filter:blur(4px)}.hp-use kbd{display:inline-block;min-width:1.4em;margin-right:6px;padding:1px 6px;border-radius:6px;background:rgba(255,255,255,.18);font:700 13px system-ui}.hp-use:empty{display:none}';
    document.head.appendChild(st);
    el = document.createElement('div');
    el.className = 'hp-use';
    document.body.appendChild(el);
    return el;
  }
  let nextAt = 0;
  H.hooks.frame.push(() => {
    const now = performance.now();
    if (now < nextAt) return;
    nextAt = now + 150;
    const p = player();
    const best = p && defs.size ? offers(p)[0] || null : null;
    current = best;
    const key = best ? `${best.name}|${best.label}` : '';
    if (key === shownKey) return;
    shownKey = key;
    if (!ui()) return;
    el.innerHTML = '';
    if (!best) return;
    const b = document.createElement('button');
    b.innerHTML = '<kbd></kbd><span></span>';
    b.querySelector('kbd').textContent = best.noKey ? '' : 'E';
    if (best.noKey) b.querySelector('kbd').hidden = true;
    b.querySelector('span').textContent = best.label;
    b.onpointerdown = (ev) => { ev.preventDefault(); ev.stopPropagation(); const now2 = player() && offers(player())[0]; if (now2) run(now2); };
    el.appendChild(b);
  });
  H.hooks.world.push({ leave() { current = null; shownKey = ''; if (el) el.textContent = ''; } });

  H.use = {
    /** Offers something to do near the player: def.near(player, ctx) -> { label, act, priority, distance, key } or null.
     *  def.keys: other keys this can be done with (besides E), e.g. ['t']. def.build: offered while building too. */
    register(name, def) {
      if (!name || !def || typeof def.near !== 'function') throw new Error("H.use.register(name, { near(player) { return { label, act } } })");
      defs.set(String(name), { ...def, keys: def.keys ? [].concat(def.keys).map((k) => String(k).toLowerCase()) : null });
      return () => defs.delete(String(name));
    },
    unregister: (name) => defs.delete(String(name)),
    /** Everything on offer for the player now, best first. */
    offers: (p) => { const q = p || player(); return q ? offers(q) : []; },
    /** The offer on the screen now (or null). */
    get current() { return current; },
    /** Does the best thing on offer now (what E does). Returns its name, or null. */
    act() { const p = player(); const o = p && offers(p)[0]; if (!o) return null; run(o); return o.name; },
    list: () => [...defs.keys()],
  };
})();
