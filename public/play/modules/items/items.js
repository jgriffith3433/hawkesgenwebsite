// Items and money (config.items; J, 2026-10-27: "players can literally do anything"): a bag for every player, money
// (coins: an item like any other), items that do something when used (heal, run faster, jump higher, a tool in hand, an
// event for a script), things to pick up, shops that sell and buy, doors that need a key, a crafting bench. 🎒 (or I)
// opens the bag. The host keeps every bag (online: asks go through it), so prices and stock are the same for everyone.
// The rules' give / take / has (modules/events) use these bags.
/* global HawkesPlay */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const W = () => H.world;
  const G = () => H.game;
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const lower = (s) => String(s || '').trim().toLowerCase();
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  // Items every game knows (a game's config.items.defs adds to them or changes them).
  const BUILT_IN = {
    coins: { icon: '🪙', about: 'money' },
    gem: { icon: '💎', about: 'worth a lot' },
    key: { icon: '🗝️', about: 'opens a locked door' },
    'health potion': { icon: '🧪', about: 'heals 40', use: { heal: 40 }, price: 15 },
    'speed potion': { icon: '⚡', about: 'run faster for 15 s', use: { speed: 1.7, seconds: 15 }, price: 20 },
    'jump potion': { icon: '🦘', about: 'jump higher for 15 s', use: { jump: 2.2, seconds: 15 }, price: 20 },
    food: { icon: '🍎', about: 'heals 15', use: { heal: 15 }, price: 5 },
    wood: { icon: '🪵', about: 'for building and crafting' },
    stone: { icon: '🪨', about: 'for building and crafting' },
    'rocket launcher': { icon: '🚀', about: 'a weapon', use: { tool: 'rocket-launcher' }, consume: false, price: 120 },
  };
  const bags = {}; // player id -> { item: count }
  const stock = {}; // shop key -> { item: count left }
  const boosts = []; // { kind, k, until }

  const cfg = () => { const c = W() && W().graph && W().graph.config && W().graph.config.items; return c && typeof c === 'object' ? c : {}; };
  const currency = () => lower(cfg().currency || 'coins');
  function def(name) {
    const n = lower(name), own = cfg().defs && typeof cfg().defs === 'object' ? cfg().defs : {};
    const o = Object.entries(own).find(([k]) => lower(k) === n);
    return { ...(BUILT_IN[n] || {}), ...(o ? o[1] : {}), name: n };
  }
  const online = () => Boolean(H.sync && H.sync.online);
  const host = () => !online() || H.sync.isHost;
  const me = () => (online() ? H.sync.me : 'me');
  const bagOf = (id) => (bags[id] || (bags[id] = {}));

  // ------------------------------------------------------------------ the host's books
  function add(id, item, n) {
    const b = bagOf(id), k = lower(item);
    if (!k || !Number.isFinite(n)) return 0;
    b[k] = Math.max(0, (b[k] || 0) + Math.floor(n));
    if (!b[k]) delete b[k];
    ui.dirty = true;
    return b[k] || 0;
  }
  const count = (id, item) => (bags[id] && bags[id][lower(item)]) || 0;
  function apply(d) {
    if (!d) return;
    const id = d.who || me();
    if (d.op === 'give') {
      const total = add(id, d.item, num(d.n, 1));
      tell('item', { item: lower(d.item), count: num(d.n, 1), total, by: d.why || null, quiet: Boolean(d.quiet) }, id);
    } else if (d.op === 'take') add(id, d.item, -Math.abs(num(d.n, 1)));
    else if (d.op === 'buy') buy(id, d);
    else if (d.op === 'sell') sell(id, d);
    else if (d.op === 'craft') craft(id, d.make);
  }
  // Results go back to the one who asked (and its effects run there).
  const told = H.sync && H.sync.action ? H.sync.action('items:told', (d, o) => { if (!d || (online() && d.to !== me())) return; void o; onTold(d); }) : null;
  function tell(kind, data, to) { const d = { kind, data, to: to || me() }; if (told && online()) told(d); else onTold(d); }
  function onTold(d) {
    const g = G();
    if (!g) return;
    if (d.kind === 'item') { g.emit('item', d.data); if (d.data.count > 0 && !d.data.quiet) g.ui.message(`+${d.data.count} ${d.data.item}`, 1.2); }
    else if (d.kind === 'buy') { g.emit('buy', d.data); g.ui.message(`Bought ${d.data.item} for ${d.data.price} ${currency()}`, 1.6); }
    else if (d.kind === 'sell') { g.emit('sell', d.data); g.ui.message(`Sold ${d.data.item} for ${d.data.price} ${currency()}`, 1.6); }
    else if (d.kind === 'craft') { g.emit('craft', d.data); g.ui.message(`Made ${d.data.count} ${d.data.item}`, 1.6); }
    else if (d.kind === 'no') g.ui.message(d.data.why, 1.6);
    ui.dirty = true;
  }
  const ask = H.sync && H.sync.action ? H.sync.action('items:ask', (d, o) => { if (o.authoritative) apply(d); }) : null;
  function request(d) { const x = { ...d, who: d.who || me() }; if (ask) ask(x); else apply(x); }

  // ------------------------------------------------------------------ shops
  function listOf(v) {
    if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? { item: lower(x), price: num(def(x).price, 10) } : { item: lower(x.item || x.name), price: Math.max(0, num(x.price, num(def(x.item || x.name).price, 10))), stock: x.stock }));
    return String(v || '').split(',').map((s) => s.trim()).filter(Boolean).map((s) => { const [n, p] = s.split(':'); return { item: lower(n), price: Math.max(0, num(p, num(def(n).price, 10))) }; });
  }
  function shopOf(id) { const e = [...W().entities].find((x) => x.sceneId === id || x._shopKey === id); return e && e._shop ? e : null; }
  function buy(id, d) {
    const shop = shopOf(d.shop), cur = currency();
    const offer = shop && shop._shop.sells.find((x) => x.item === lower(d.item));
    if (!offer) return;
    const left = stock[shop._shopKey] && stock[shop._shopKey][offer.item];
    if (left !== undefined && left <= 0) { tell('no', { why: `${offer.item}: sold out` }, id); return; }
    if (count(id, cur) < offer.price) { tell('no', { why: `Not enough ${cur} (${offer.price} needed)` }, id); return; }
    add(id, cur, -offer.price);
    add(id, offer.item, 1);
    if (left !== undefined) stock[shop._shopKey][offer.item] = left - 1;
    tell('buy', { item: offer.item, price: offer.price, shop: shop.name || null }, id);
  }
  function sell(id, d) {
    const shop = shopOf(d.shop), cur = currency();
    const offer = shop && shop._shop.buys.find((x) => x.item === lower(d.item));
    if (!offer || count(id, offer.item) < 1) return;
    add(id, offer.item, -1);
    add(id, cur, offer.price);
    tell('sell', { item: offer.item, price: offer.price }, id);
  }
  function recipes() {
    const r = Array.isArray(cfg().recipes) ? cfg().recipes : [];
    return r.map((x) => ({ make: lower(x.make || x.item), count: Math.max(1, num(x.count, 1)), from: Object.fromEntries(Object.entries(x.from || {}).map(([k, v]) => [lower(k), Math.max(1, num(v, 1))])) })).filter((x) => x.make);
  }
  function craft(id, make) {
    const r = recipes().find((x) => x.make === lower(make));
    if (!r) return;
    if (!Object.entries(r.from).every(([k, n]) => count(id, k) >= n)) { tell('no', { why: `Not enough to make ${r.make}` }, id); return; }
    for (const [k, n] of Object.entries(r.from)) add(id, k, -n);
    add(id, r.make, r.count);
    tell('craft', { item: r.make, count: r.count }, id);
  }

  // ------------------------------------------------------------------ using an item (on the one who uses it)
  function use(item) {
    const d = def(item), u = d.use, g = G(), p = W().player;
    if (!u || !p || count(me(), d.name) < 1) return false;
    if (u.heal) p.health = Math.min(100, (p.health || 0) + num(u.heal, 20));
    if (u.speed) boost('speed', num(u.speed, 1.5), num(u.seconds, 10));
    if (u.jump) boost('jump', num(u.jump, 2), num(u.seconds, 10));
    if (u.tool) { if (H.mayhem && H.mayhem.giveTool) H.mayhem.giveTool(String(u.tool)); else p.tool = String(u.tool); }
    if (u.emit) g.emit(String(u.emit), { item: d.name });
    if (d.consume !== false) request({ op: 'take', item: d.name, n: 1 });
    g.emit('use', { item: d.name });
    if (g.burst) g.burst([p.x, p.y + 0.5, p.z], { color: '#a7f3d0', count: 12, speed: 2 });
    ui.dirty = true;
    return true;
  }
  function boost(kind, k, seconds) {
    const p = W().player;
    const was = boosts.find((b) => b.kind === kind);
    if (was) { was.until = W().time + seconds; return; }
    if (kind === 'speed') p.speed *= k; else p.jumpHeight *= k;
    boosts.push({ kind, k, until: W().time + seconds });
  }
  function runBoosts() {
    const w = W(), p = w && w.player;
    for (let i = boosts.length - 1; i >= 0; i--) {
      const b = boosts[i];
      if (p && w.time < b.until) continue;
      if (p) { if (b.kind === 'speed') p.speed /= b.k; else p.jumpHeight /= b.k; }
      boosts.splice(i, 1);
    }
  }

  // ------------------------------------------------------------------ abilities
  const near = (e, p, r = 2.6) => Math.hypot(e.x - p.x, e.z - p.z) < r + Math.max(e.half[0], e.half[2]);
  H.behavior('item', {
    title: 'An item to pick up', group: 'Items', icon: '🎁',
    says: (o) => `${o.count > 1 ? `${o.count} ` : ''}${o.item}: walk into it to pick it up`,
    defaults: { item: 'coins', count: 1, respawn: 0, spin: true },
    settings: [{ key: 'item', label: 'What', type: 'text' }, { key: 'count', label: 'How many', type: 'number', min: 1, max: 1000 }, { key: 'respawn', label: 'Comes back after', type: 'number', min: 0, max: 600, unit: 's' }, { key: 'spin', label: 'Spins', type: 'bool' }],
    start(e) { if (e.physics === 'none') e.physics = 'trigger'; else if (e.physics !== 'dynamic') e.ghost = true; },
    update(e, dt, o, s) {
      if (o.spin !== false && e.physics !== 'dynamic') e.node.rotation.y += dt * 2;
      if (s.gone && W().time > s.back) { s.gone = false; e.visible = true; }
    },
    hit(e, other, o, s, g) {
      if (other !== g.player || s.gone) return;
      request({ op: 'give', item: o.item || 'coins', n: Math.max(1, num(o.count, 1)), why: e.name || null });
      g.emit('pickup', { item: lower(o.item || 'coins'), thing: e });
      if (g.sound) g.sound('coin');
      if (num(o.respawn, 0) > 0) { s.gone = true; s.back = W().time + num(o.respawn, 0); e.visible = false; }
      else e.destroy();
    },
  });
  H.behavior('shop', {
    title: 'A shop', group: 'Items', icon: '🛒',
    says: (o) => `a shop: E to buy${o.sells ? ` (${String(Array.isArray(o.sells) ? o.sells.map((x) => x.item || x).join(', ') : o.sells)})` : ''}`,
    defaults: { sells: 'health potion:15, speed potion:20, key:30', buys: '', name: '' },
    settings: [{ key: 'name', label: 'Name', type: 'text' }, { key: 'sells', label: 'Sells (item:price, ...)', type: 'text' }, { key: 'buys', label: 'Buys (item:price, ...)', type: 'text' }],
    start(e, o) {
      e._shopKey = e.sceneId || `shop-${e.name || ''}-${Math.round(e.x)}-${Math.round(e.z)}`;
      e._shop = { sells: listOf(o.sells), buys: listOf(o.buys), name: String(o.name || e.name || 'Shop') };
      for (const x of e._shop.sells) if (x.stock !== undefined && host()) { stock[e._shopKey] = stock[e._shopKey] || {}; if (stock[e._shopKey][x.item] === undefined) stock[e._shopKey][x.item] = Math.max(0, num(x.stock, 0)); }
    },
  });
  H.behavior('locked', {
    title: 'Locked: needs an item', group: 'Items', icon: '🔒',
    says: (o) => `locked: opens with ${o.needs}${o.keep ? '' : ' (used up)'}`,
    defaults: { needs: 'key', keep: false, signal: '', move: 3, axis: 'y' },
    settings: [{ key: 'needs', label: 'Opens with', type: 'text' }, { key: 'keep', label: 'Keep the item', type: 'bool' }, { key: 'signal', label: 'Sends a signal', type: 'text' }, { key: 'move', label: 'Slides', type: 'number', min: 0, max: 20, unit: 'm' }, { key: 'axis', label: 'Which way', type: 'choice', options: ['y', 'x', 'z'] }],
    start(e, o, s) { s.home = e.position; s.open = 0; s.want = 0; e._locked = { o, s }; },
    update(e, dt, o, s) {
      if (s.want === s.open) return;
      s.open += Math.sign(s.want - s.open) * Math.min(Math.abs(s.want - s.open), dt * 1.5);
      const m = num(o.move, 3) * s.open, ax = { x: 0, y: 1, z: 2 }[o.axis] ?? 1, p = s.home.slice();
      p[ax] += m;
      e.position = p;
    },
  });
  function unlock(e) {
    const { o, s } = e._locked;
    if (s.want) return;
    const need = lower(o.needs || 'key');
    if (count(me(), need) < 1 && !(G().events && G().events.has && (() => { try { return G().events.has(need); } catch { return false; } })())) { G().ui.message(`Locked: it needs ${need === 'key' ? 'a key' : need}`, 1.6); return; }
    if (!o.keep) request({ op: 'take', item: need, n: 1 });
    s.want = 1;
    if (o.signal && H.signals) H.signals.set(String(o.signal), true);
    G().emit('unlock', { thing: e, item: need });
    if (G().sound) G().sound('unlock');
  }
  H.behavior('bench', {
    title: 'A crafting bench', group: 'Items', icon: '🛠',
    says: () => 'E to make things from what you carry (config.items.recipes)',
    defaults: {},
    start(e) { e._bench = true; },
  });
  if (H.use && H.use.register) H.use.register('items', {
    build: false,
    near(p) {
      for (const e of W().entities) {
        if (!e.alive || !e.visible) continue;
        if (e._shop && near(e, p)) return { label: `Shop: ${e._shop.name}`, act: () => ui.openShop(e), priority: 6 };
        if (e._locked && !e._locked.s.want && near(e, p, 2)) return { label: `Unlock (${e._locked.o.needs || 'key'})`, act: () => unlock(e), priority: 6 };
        if (e._bench && near(e, p)) return { label: 'Craft', act: () => ui.openBench(), priority: 5 };
      }
      return null;
    },
  });

  // ------------------------------------------------------------------ the bag and the shop on screen
  const ui = {
    el: null, mode: null, shop: null, dirty: true, open: false,
    make() {
      const css = document.createElement('style');
      css.textContent = `
        .it-btn[hidden], .it-panel[hidden] { display: none !important; }
        .it-btn { position: fixed; right: 14px; bottom: max(210px, calc(env(safe-area-inset-bottom) + 200px)); z-index: 6; min-height: 44px; min-width: 44px; padding: 8px 12px; border-radius: 999px; border: 1px solid rgba(255,255,255,.25); background: rgba(10,14,24,.82); color: #fff; font: 600 13px/1 system-ui, sans-serif; cursor: pointer; }
        .it-panel { position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 60; width: min(420px, calc(100vw - 24px)); max-height: min(560px, calc(100vh - 40px)); overflow: auto; background: rgba(10,14,24,.96); border: 1px solid rgba(255,255,255,.16); border-radius: 16px; padding: 14px; color: #e8eef7; font: 500 13px/1.35 system-ui, sans-serif; display: grid; gap: 10px; }
        .it-panel h3 { margin: 0; display: flex; justify-content: space-between; align-items: center; font: 700 15px/1.2 system-ui, sans-serif; }
        .it-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(118px, 1fr)); gap: 8px; }
        .it-cell { border: 1px solid rgba(255,255,255,.14); border-radius: 12px; padding: 8px; display: grid; gap: 4px; background: rgba(255,255,255,.04); }
        .it-cell b { font-size: 22px; line-height: 1; }
        .it-cell small { opacity: .7; }
        .it-panel button { min-height: 40px; border-radius: 9px; border: 1px solid rgba(255,255,255,.2); background: rgba(255,255,255,.08); color: inherit; font: inherit; cursor: pointer; padding: 6px 10px; }
        .it-panel button.go { background: #2563eb; border-color: #2563eb; }
        .it-panel button:disabled { opacity: .45; cursor: default; }`;
      document.head.appendChild(css);
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'it-btn'; btn.title = 'Bag (I)';
      const panel = document.createElement('div');
      panel.className = 'it-panel'; panel.hidden = true;
      for (const el of [btn, panel]) { el.addEventListener('pointerdown', (e) => e.stopPropagation()); document.body.appendChild(el); }
      btn.onclick = () => this.toggle('bag');
      panel.onclick = (e) => {
        const b = e.target.closest && e.target.closest('button');
        if (!b) return;
        if (b.dataset.close) this.close();
        else if (b.dataset.use) use(b.dataset.use);
        else if (b.dataset.buy) request({ op: 'buy', shop: this.shop._shopKey, item: b.dataset.buy });
        else if (b.dataset.sell) request({ op: 'sell', shop: this.shop._shopKey, item: b.dataset.sell });
        else if (b.dataset.craft) request({ op: 'craft', make: b.dataset.craft });
        this.dirty = true;
      };
      this.el = { btn, panel };
    },
    toggle(mode) { if (this.open && this.mode === mode) this.close(); else { this.open = true; this.mode = mode; this.dirty = true; this.render(); } },
    close() { this.open = false; this.shop = null; this.render(); },
    openShop(e) { this.shop = e; this.toggle('shop'); },
    openBench() { this.toggle('bench'); },
    render() {
      const show = Boolean(W() && H.mode !== 'build' && (Object.keys(bagOf(me())).length || this.open || cfg().start));
      if (!this.el) { if (!show) return; this.make(); }
      const cur = currency(), money = count(me(), cur), mine = bagOf(me());
      this.el.btn.hidden = !show;
      this.el.btn.textContent = `🎒 ${def(cur).icon || ''} ${money}`;
      this.el.panel.hidden = !this.open;
      if (!this.open || !this.dirty) return;
      this.dirty = false;
      const head = (t) => `<h3><span>${t}</span><span>${def(cur).icon || ''} ${money} <button type="button" data-close="1">✕</button></span></h3>`;
      let h = '';
      if (this.mode === 'shop' && this.shop && this.shop.alive) {
        const s = this.shop._shop, st = stock[this.shop._shopKey] || {};
        h = head(esc(s.name)) + `<div class="it-grid">${s.sells.map((x) => `<div class="it-cell"><b>${def(x.item).icon || '📦'}</b>${esc(x.item)}<small>${esc(def(x.item).about || '')}${st[x.item] !== undefined ? ` · ${st[x.item]} left` : ''}</small><button type="button" class="go" data-buy="${esc(x.item)}" ${money < x.price || st[x.item] === 0 ? 'disabled' : ''}>Buy · ${x.price}</button></div>`).join('')}</div>`;
        if (s.buys.length) h += `<h3><span>They buy</span></h3><div class="it-grid">${s.buys.map((x) => `<div class="it-cell"><b>${def(x.item).icon || '📦'}</b>${esc(x.item)} <small>you have ${count(me(), x.item)}</small><button type="button" data-sell="${esc(x.item)}" ${count(me(), x.item) ? '' : 'disabled'}>Sell · ${x.price}</button></div>`).join('')}</div>`;
      } else if (this.mode === 'bench') {
        const rs = recipes();
        h = head('Crafting') + (rs.length ? `<div class="it-grid">${rs.map((r) => { const ok = Object.entries(r.from).every(([k, n]) => count(me(), k) >= n); return `<div class="it-cell"><b>${def(r.make).icon || '📦'}</b>${r.count} ${esc(r.make)}<small>${Object.entries(r.from).map(([k, n]) => `${n} ${esc(k)}`).join(' + ')}</small><button type="button" class="go" data-craft="${esc(r.make)}" ${ok ? '' : 'disabled'}>Make</button></div>`; }).join('')}</div>` : '<div>Nothing to make here yet.</div>');
      } else {
        const items = Object.entries(mine).filter(([k]) => k !== cur);
        h = head('Your bag') + (items.length ? `<div class="it-grid">${items.map(([k, n]) => { const d = def(k); return `<div class="it-cell"><b>${d.icon || '📦'}</b>${esc(k)} ×${n}<small>${esc(d.about || '')}</small>${d.use ? `<button type="button" data-use="${esc(k)}">Use</button>` : ''}</div>`; }).join('')}</div>` : '<div>Nothing yet. Pick things up, buy them in shops, make them at a bench.</div>');
      }
      this.el.panel.innerHTML = h;
    },
  };

  // ------------------------------------------------------------------ every world, every frame, sharing
  H.hooks.world.push({
    enter() {
      for (const k of Object.keys(bags)) delete bags[k];
      for (const k of Object.keys(stock)) delete stock[k];
      boosts.length = 0; ui.open = false; ui.dirty = true;
      const start = cfg().start;
      if (start && typeof start === 'object') for (const [k, n] of Object.entries(start)) add(me(), k, num(n, 0));
    },
  });
  let t = 0;
  H.hooks.frame.push((dt) => {
    if (!W()) return;
    runBoosts();
    const g = G();
    if (g && g.input && g.input.pressed('i') && H.mode !== 'build') ui.toggle('bag');
    if (ui.open && g && g.input && g.input.pressed('escape')) ui.close();
    if (ui.open && ui.mode === 'shop' && ui.shop && W().player && !near(ui.shop, W().player, 5)) ui.close();
    t -= dt;
    if (t <= 0 || ui.dirty) { t = 0.4; ui.render(); }
  });
  if (H.sync && H.sync.state) H.sync.state('items', { rate: 2, get: () => ({ b: bags, s: stock }), set: (st) => { if (!st || host()) return; if (st.b) { for (const k of Object.keys(bags)) delete bags[k]; Object.assign(bags, st.b); } if (st.s) Object.assign(stock, st.s); ui.dirty = true; } });

  const api = {
    /** Gives the player (or `who`: a player's id) items. */
    give: (item, n = 1, who) => request({ op: 'give', item: String(item), n: Math.floor(num(n, 1)), who }),
    take: (item, n = 1, who) => request({ op: 'take', item: String(item), n: Math.floor(num(n, 1)), who }),
    has: (item, n = 1, who) => count(who || me(), item) >= n,
    count: (item, who) => count(who || me(), item),
    get bag() { return { ...bagOf(me()) }; },
    get money() { return count(me(), currency()); },
    get currency() { return currency(); },
    use: (item) => use(item),
    buy: (shop, item) => request({ op: 'buy', shop: shop && (shop._shopKey || shop.sceneId || shop), item }),
    sell: (shop, item) => request({ op: 'sell', shop: shop && (shop._shopKey || shop.sceneId || shop), item }),
    craft: (make) => request({ op: 'craft', make }),
    unlock: (thing) => thing && thing._locked && unlock(thing),
    open: (mode = 'bag') => ui.toggle(mode),
    about: (item) => { const d = def(item); return { name: d.name, icon: d.icon || '📦', about: d.about || '', price: d.price ?? null, usable: Boolean(d.use) }; },
    _: { bags, apply, ui },
  };
  H.items = api;
  H.hooks.game.push((game) => { game.items = api; });
})();
