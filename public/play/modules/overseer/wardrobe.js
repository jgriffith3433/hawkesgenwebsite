// The wardrobe (docs/story.md, "The Observatory"): in the Observatory, E at the wardrobe shows a panel of everything the
// player owns to wear (the accessories and colors they were given: the first gift, one every third visit, what the Overseer
// made when asked, and what they already wear), with a live preview: the camera comes round the front of them and each tap
// is their look at once (H.presence.setLook: saved to the account, sent to the room, so others see it as it happens).
// Under the grid, "Ask the Overseer for something new": the price of a message first (H.assistant.quote), then the same paid
// message the chat sends (H.assistant.ask). Big tap targets, a bottom sheet on phones; Esc or Done closes it.
//
//   H.wardrobe   { open(), close(), isOpen, owned() { acc, col }, wear({ accessory, accessoryColor }), restore(), ask(text), price }
//   game.on('wardrobe', ({ state: 'open' | 'wear' | 'keep' | 'restore' | 'price' | 'ask' | 'close', ... }))
/* global HawkesPlay */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  if (!H || H.wardrobe) return;
  const M = () => H.observatoryMath;
  const PC = () => (H.presence && H.presence.core) || null;
  const emit = (d) => { try { if (H.game && H.game.emit) H.game.emit('wardrobe', d); } catch (err) { H.report(err, 'wardrobe'); } };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  let el = null, st = null; // st: { before (the look when opened), frame (the camera), price, askText, busy }
  const look = () => (H.presence && H.presence.look) || {};
  const own = () => (H.memory && H.memory.wardrobe ? H.memory.wardrobe.get() : { acc: [], col: [] });
  const owned = () => M().owned(own(), look());

  const CSS = `
.ow{position:fixed;z-index:8;right:16px;top:50%;transform:translateY(-50%);width:min(340px,92vw);max-height:84vh;overflow:auto;background:rgba(8,14,26,.9);color:#eaf7ff;border:1px solid #3b6a8a;border-radius:14px;padding:14px 14px 12px;font:500 15px/1.35 system-ui,sans-serif;box-shadow:0 8px 40px #0008;-webkit-overflow-scrolling:touch}
.ow h2{margin:0 0 2px;font-size:20px;letter-spacing:.02em}.ow .sub{margin:0 0 10px;color:#9fc7de;font-size:14px}
.ow h4{margin:12px 0 6px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#8fd8ff}
.ow .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(88px,1fr));gap:8px}
.ow button{font:inherit;color:inherit;cursor:pointer;min-height:48px;border-radius:10px;border:1px solid #3b6a8a;background:#12263a;padding:6px 8px;touch-action:manipulation}
.ow button:hover{background:#18354f}.ow button.on{border-color:#ffd84a;background:#2a3a1e;box-shadow:0 0 0 1px #ffd84a inset}
.ow .tile{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;min-height:64px}.ow .tile .ic{font-size:24px;line-height:1}.ow .tile .lb{font-size:12px}
.ow .sw{display:flex;flex-wrap:wrap;gap:8px}.ow .sw button{width:48px;height:48px;min-height:48px;border-radius:50%;padding:0;border:2px solid #fff3}.ow .sw button.on{border-color:#ffd84a;box-shadow:0 0 0 3px #ffd84a66}
.ow .more{margin:8px 0 0;color:#8fb3c7;font-size:13px}
.ow .row{display:flex;gap:8px;margin-top:10px}.ow .row button{flex:1}.ow .go{background:#1e6a3a;border-color:#55d68a}.ow .go:hover{background:#25804a}
.ow input{width:100%;box-sizing:border-box;min-height:48px;border-radius:10px;border:1px solid #3b6a8a;background:#0b1624;color:#eaf7ff;padding:6px 10px;font:inherit}
.ow .price{margin:6px 0 0;font-size:14px;color:#cfe8f7}.ow .note{margin:6px 0 0;font-size:13px;color:#ffd9a0}
.ow .x{position:absolute;right:8px;top:8px;width:48px;min-height:48px;font-size:22px;background:none;border:0}
@media (max-width:700px){.ow{right:0;left:0;top:auto;bottom:0;transform:none;width:auto;max-height:46vh;border-radius:14px 14px 0 0;padding-bottom:calc(12px + env(safe-area-inset-bottom))}}
`;

  function accList() {
    const C = PC();
    const all = C ? C.ACCESSORIES : [];
    const mine = owned().acc;
    return { all, mine: all.filter((a) => mine.includes(a.id)), locked: all.filter((a) => !mine.includes(a.id)).length };
  }

  function draw() {
    if (!el) return;
    const lk = look();
    const { mine, locked } = accList();
    const cols = owned().col;
    const wear = lk.accessory || 'none';
    const c = String(lk.accessoryColor || '').toLowerCase();
    const p = st.price;
    const priceLine = p === undefined ? '' : p === null
      ? '<p class="note">Asking needs an account. Sign in and I can make you something.</p>'
      : `<p class="price">A message to me costs <b>${p.credits}</b> credits${p.balance != null ? ` (you have ${Number(p.balance).toLocaleString()})` : ''}. Whatever I offer to make shows its own price before it runs.</p>`;
    el.innerHTML = `
      <button type="button" class="x" data-a="done" aria-label="Done">×</button>
      <h2>Wardrobe</h2><p class="sub">${esc(M().WARDROBE_LINES.open)}</p>
      <h4>Wear</h4>
      <div class="grid">${mine.map((a) => `<button type="button" class="tile ${wear === a.id ? 'on' : ''}" data-acc="${a.id}" aria-pressed="${wear === a.id}"><span class="ic">${a.icon}</span><span class="lb">${esc(a.label)}</span></button>`).join('')}</div>
      ${locked ? `<p class="more">${locked} more to find. The Overseer gives one now and then, and will make you something if you ask.</p>` : ''}
      <h4>Color</h4>
      <div class="sw">${cols.map((h) => `<button type="button" class="${c === h ? 'on' : ''}" data-col="${h}" style="background:${h}" aria-label="Color ${h}" aria-pressed="${c === h}"></button>`).join('')}</div>
      <div class="row"><button type="button" data-a="restore">Put it back</button><button type="button" class="go" data-a="done">Done</button></div>
      <h4>Ask the Overseer for something new</h4>
      <input type="text" maxlength="100" data-in="ask" placeholder="a hat made of clouds" value="${esc(st.askText)}" aria-label="What to ask for">
      ${priceLine}
      <div class="row"><button type="button" data-a="ask" ${st.busy || p === null ? 'disabled' : ''}>${st.busy ? 'Asking…' : 'Ask'}</button></div>`;
    const inp = el.querySelector('[data-in="ask"]');
    if (inp) inp.oninput = () => { st.askText = inp.value; };
  }

  function wear(part) {
    if (!st) return false;
    const owns = owned();
    const next = {};
    if (part.accessory !== undefined) { if (!owns.acc.includes(part.accessory)) return false; next.accessory = part.accessory; const a = PC() && PC().ACCESSORY.get(part.accessory); if (a && part.accessoryColor === undefined && (!look().accessoryColor || look().accessory !== part.accessory)) next.accessoryColor = owns.col.includes(a.color) ? a.color : look().accessoryColor; }
    if (part.accessoryColor !== undefined) { const h = String(part.accessoryColor).toLowerCase(); if (!owns.col.includes(h)) return false; next.accessoryColor = h; }
    if (!Object.keys(next).length) return false;
    H.presence.setLook(next);
    if (st.frame) setTimeout(() => { if (st && st.frame) st.frame.again(); }, 150);
    draw();
    emit({ state: 'wear', accessory: look().accessory, color: look().accessoryColor });
    return true;
  }
  function restore() {
    if (!st) return false;
    const b = st.before;
    H.presence.setLook({ accessory: b.accessory || 'none', accessoryColor: b.accessoryColor });
    draw();
    emit({ state: 'restore', accessory: look().accessory });
    return true;
  }

  /** Asks the Overseer for something new: the same paid message as the chat. Resolves true when sent. */
  async function ask(text) {
    const msg = M().requestText(text);
    if (!st || !msg) return false;
    if (!H.assistant) {
      // (No account on this page: the chat is the way; open it.)
      if (H.chat && H.chat.open) H.chat.open();
      if (H.chat) H.chat.line({ kind: 'sys', text: 'Type what you would like to the Overseer here. It will say what it costs.' });
      return false;
    }
    st.busy = true; draw();
    try {
      await H.assistant.ask(msg);
      emit({ state: 'ask', text: String(text).slice(0, 100), credits: st.price ? st.price.credits : null });
      if (H.chat) H.chat.line({ kind: 'overseer', text: M().WARDROBE_LINES.sent });
      st.askText = '';
      return true;
    } catch (x) {
      if (H.chat) H.chat.line({ kind: 'sys', text: (x && x.message) || 'That did not go through. Nothing was charged.' });
      return false;
    } finally { if (st) { st.busy = false; draw(); } }
  }
  async function loadPrice() {
    const mine = st;
    if (!H.assistant) { st.price = undefined; return; }
    try { const q = await H.assistant.quote(); if (st === mine) { st.price = q; draw(); emit({ state: 'price', credits: q.credits, balance: q.balance }); } }
    catch { if (st === mine) { st.price = undefined; draw(); } }
  }

  function open() {
    if (st || typeof document === 'undefined') return false;
    const w = H.world, p = w && w.player;
    if (!p || !p.alive || !H.presence || !H.presence.setLook) return false;
    if (!document.getElementById('ow-style')) { const s = document.createElement('style'); s.id = 'ow-style'; s.textContent = CSS; document.head.appendChild(s); }
    st = { before: { ...look() }, frame: null, price: undefined, askText: '', busy: false, controls: p.controls };
    p.controls = false;
    try { if (H.game && H.game.input && H.game.input.release) H.game.input.release(); } catch { /* fine */ }
    try { if (H.mirror && H.mirror.frame) st.frame = H.mirror.frame(p); } catch (err) { H.report(err, 'wardrobe'); }
    el = document.createElement('div');
    el.className = 'ow';
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Wardrobe');
    for (const ev of ['keydown', 'keyup', 'pointerdown', 'wheel', 'mousedown', 'touchstart']) el.addEventListener(ev, (x) => { x.stopPropagation(); if (ev === 'keydown' && x.key === 'Escape') close(); });
    el.onclick = (ev) => {
      const t = ev.target.closest('button');
      if (!t || t.disabled) return;
      const d = t.dataset;
      if (d.acc) wear({ accessory: d.acc });
      else if (d.col) wear({ accessoryColor: d.col });
      else if (d.a === 'restore') restore();
      else if (d.a === 'done') close(true);
      else if (d.a === 'ask') ask(st.askText);
    };
    document.body.appendChild(el);
    draw();
    emit({ state: 'open', owned: owned().acc.length });
    loadPrice();
    return true;
  }
  function close(kept) {
    if (!st) return false;
    const s = st, p = H.world && H.world.player;
    st = null;
    if (el) { el.remove(); el = null; }
    if (s.frame) s.frame.end();
    if (p && p.alive) p.controls = s.controls !== false;
    if (kept && H.presence) {
      const changed = look().accessory !== s.before.accessory || look().accessoryColor !== s.before.accessoryColor;
      if (changed) emit({ state: 'keep', accessory: look().accessory, color: look().accessoryColor });
    }
    emit({ state: 'close' });
    return true;
  }
  // Esc closes it (the panel stops its own keys; this is for a press with focus elsewhere).
  window.addEventListener('keydown', (e) => { if (st && e.key === 'Escape') close(); });

  H.wardrobe = {
    open, close, wear, restore, ask,
    get isOpen() { return Boolean(st); },
    get price() { return st ? st.price : undefined; },
    owned,
  };
})();
