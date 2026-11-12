// The journal (docs/story.md sections 5 and 7; the Overseer docs, "The journal"): a panel in the game with Chapter One's eight
// quests (done or not; every one can be skipped), the neighbours met (name, what they are, a line about them) and the lore
// found on the island (twelve titles; eight can be found in Chapter One, the rest wait, listed as not yet found).
// Opened by the small book button (top right, clear of the sticks and buttons at the bottom), N, or the pause menu's Journal.
// Neighbours met and lore found are kept with H.memory (the account when signed in, this device otherwise) and survive a return.
// Lore is never about why the Overseer does anything: each is a few lines in the voice of whoever left it.
(function () {
  const H = window.HawkesPlay;
  const KEEP = window.__islandJournal = window.__islandJournal || { quests: {}, met: new Set(), lore: new Set() }; // (fallbacks where there is no memory)
  const mem = () => (H && H.memory && H.memory.journal ? H.memory.journal : null);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const funnel = (name, props) => { try { if (window.hgFunnel) window.hgFunnel(name, props); else if (H && H.track) H.track(name, props); } catch { /* never break the game */ } };

  // ------------------------------------------------------------------ Chapter One (docs/story.md section 5)
  // `by`: the tour step (or event) that finishes it. Every quest can be skipped: nothing here locks anything.
  const QUESTS = [
    { id: 'mirror', n: 1, title: 'Who are you?', text: 'Answer what you are, how you look, and what you are called.' },
    { id: 'drive', n: 2, title: 'A drive to the dock', text: 'Take the 4x4 down the path.' },
    { id: 'fish', n: 3, title: 'The sea gives', text: 'Catch a fish at the end of the pier.' },
    { id: 'boom', n: 4, title: 'Barrel and goodbye', text: 'Blow up the fuel barrels on the beach.' },
    { id: 'ask', n: 5, title: 'Ask', text: 'Ask the Overseer for anything.' },
    { id: 'hill', n: 6, title: 'Up the hill', text: 'Walk up to Dolores and say hello.' },
    { id: 'fly', n: 7, title: 'Way up', text: 'Take the helicopter up until the island is a speck.' },
    { id: 'launch', n: 8, title: 'The launch pad', text: "Finish Rolo's rocket and go up until the planet is whole." },
  ];
  const STEP_QUEST = { drive: 'drive', fish: 'fish', boom: 'boom', ask: 'ask', hill: 'hill', fly: 'fly', launch: 'launch' };
  game.on('tour', (d) => { const id = d && STEP_QUEST[d.step]; if (id) KEEP.quests[id] = true; });
  game.on('mirror', (d) => { if (d && d.state === 'done') KEEP.quests.mirror = true; else if (d && d.state === 'skip') KEEP.quests.mirror = 'skipped'; });
  /** One line per quest: done, skipped, now (the first not done) or to do. */
  function questList() {
    let now = true;
    return QUESTS.map((q) => {
      const v = KEEP.quests[q.id];
      const state = v === 'skipped' ? 'skipped' : v ? 'done' : now ? 'now' : 'todo';
      if (!v) now = false;
      return { ...q, state, skippable: true };
    });
  }

  // ------------------------------------------------------------------ the neighbours (docs/story.md section 3)
  const CAST = [
    { id: 'pip', name: 'Pip', what: 'A person, and the island\'s guide', line: 'Wants to try everything, with company. Has never once checked the wind before a BOOM.' },
    { id: 'bobbin', name: 'Admiral Bobbin', what: 'A rubber duck, harbourmaster of a harbour with one boat', line: 'Very small, very proud. Takes any wave personally.' },
    { id: 'ember', name: 'Mrs Ember', what: 'A toaster who runs the post and the weather', line: 'Every forecast she gives is right, and she apologises for it each time.' },
    { id: 'rolo', name: 'Rolo', what: 'A roll-bot, the island\'s only fixer', line: 'Will not ask for help, ever, and is always halfway under something.' },
    { id: 'dolores', name: 'Dolores', what: 'A cactus who lives on the hill', line: 'Is not lonely. Remembers every detail of your day anyway.' },
    { id: 'channel', name: 'Channel', what: 'A TV robot, the island\'s one reporter', line: 'Reports everything as breaking news, naps included. Ratings: record.' },
  ];

  // ------------------------------------------------------------------ the lore (docs/story.md section 7: the twelve titles)
  // `at`: where it lies, [x, z] on the island (null: not on the island yet). `text`: a few lines in the voice of whoever left it.
  const LORE = [
    { id: 'logbook', n: 1, title: 'The Logbook, With Pages Missing', by: 'Admiral Bobbin', at: [62.5, 5.6], text: ['Ships commanded: one. Ships commanded, again: one.', 'Three pages are gone from the middle. The cut is clean along the spine. A gull has no scissors. Do not tell the gull I said so.'] },
    { id: 'planks', n: 2, title: 'Hand-Cut Planks', by: 'the pier', at: [68, 0], text: ['Every joint cut by hand, and every one fits.', 'Whoever made them had a hand a little bigger than yours. The third plank sticks.'] },
    { id: 'letter', n: 3, title: 'A Letter With No Sender', by: 'Mrs Ember', at: [-12.5, 17], text: ['No name on the back, dear. No address. A stamp I have never seen, on paper like the rest.', 'I did not read it twice. Sorry.'] },
    { id: 'lamp', n: 4, title: 'The Lamp That Was Already Lit', by: 'Admiral Bobbin', at: [61, -2.4], text: ['Dock lamp, north side. Lit when I woke. Lit all night.', 'I have checked the oil twice. It is never low. A harbourmaster checks.'] },
    { id: 'receipt', n: 5, title: "Rolo's Receipt for a Door", by: 'Rolo', at: [-38, -22], text: ['REPAIR SLIP. one door. work: done. cost: three wobbles. date: a small tuesday.', 'signed: r. it is my writing. i do not remember the door. that is fine.'] },
    { id: 'tally', n: 6, title: "Dolores's Tally of Turns", by: 'Dolores', at: [40.5, 28], text: ['Scratched into the rock, in fives: the rings, turning. The marks go back further than I have been here.', 'I was not counting. It is just a rock.'] },
    { id: 'chair', n: 9, title: 'The Beach Chair Facing Away From the Sea', by: 'Channel', at: [53, -5], text: ['Breaking: one chair. It faces the land, not the sea.', 'The seat is warm. It is always warm. Source of the warmth: unconfirmed. Ratings: record.'] },
    { id: 'drawing', n: 10, title: "Pip's First Drawing", by: 'Pip', at: [48.4, -15.4], text: ['A barrel with a face! Is that mine? I think it is mine!', 'It is very faded. Older than me, I think. I would remember drawing it. Hello, Barrel.'] },
    { id: 'file', n: 7, title: "Channel's Dead-End File", by: 'Channel', at: null, text: ['Breaking: a tape of the "Who Was Here?" series. Every episode ends mid-sentence.', 'Source of the cut: unconfirmed. Ratings: still climbing.'] },
    { id: 'tag', n: 8, title: 'A Fish Tag in an Unknown Number', by: 'the first fish', at: null, text: ['A small silver tag, no name, no number that means anything to anyone here.', 'It was inside a fish. The fish did not put it there.'] },
    { id: 'mirror2', n: 11, title: 'The Cracked Mirror', by: 'the hangar', at: null, text: ['A standing mirror, cracked once down the middle. The hangar keeps it.', 'Nobody can say who stood in it. The glass does not answer.'] },
    { id: 'page', n: 12, title: 'The Blank Page', by: 'the last page of the logbook', at: null, text: ['The last page of the logbook. Blank, until someone writes on it.', 'Then the island remembers what was written. That is all it says for now.'] },
  ].sort((a, b) => a.n - b.n);
  for (const l of LORE) l.art = `/play/journal/${l.id}.webp`; // the painted page (hawkes.library.json "journal-paintings")

  // ------------------------------------------------------------------ what is kept
  const kept = () => {
    const j = mem();
    if (j) { const g = j.get(); return { met: new Set([...g.met, ...KEEP.met]), lore: new Set([...g.lore, ...KEEP.lore]) }; }
    return { met: KEEP.met, lore: KEEP.lore };
  };
  function meet(id) {
    if (!CAST.some((c) => c.id === id) || kept().met.has(id)) return false;
    KEEP.met.add(id);
    const j = mem(); if (j) j.meet(id);
    game.emit('met', { id });
    return true;
  }
  function find(id, say) {
    const l = LORE.find((x) => x.id === id);
    if (!l) return false;
    const fresh = !kept().lore.has(id);
    KEEP.lore.add(id);
    const j = mem(); if (j) j.find(id);
    // A first pickup plays as a memory on the spot (memories.js); the words live in the journal. A pickup again does nothing loud.
    const thingOf = loreThing(id);
    const M = window.__island && window.__island.memories;
    const spot = l.at || (thingOf ? [thingOf.x, thingOf.z] : null);
    let remembered = false;
    if (fresh && M && spot && !M.active()) remembered = M.play(id, spot, () => { const b = game.ui.el('journal-btn'); if (b) b.classList.add('new'); });
    // (Objects with no memory yet are read out over the thing, a line at a time, as before.)
    const holdFor = (line) => Math.min(7, 2.5 + line.length / 18);
    let at = 0;
    if (fresh && !remembered && thingOf && thingOf.say) for (const line of l.text) { game.after(at, () => { if (thingOf.alive) thingOf.say(line, holdFor(line)); }); at += holdFor(line) + 0.3; }
    if (fresh) {
      funnel('sandbox_lore_found', { id, n: l.n, found: kept().lore.size });
      game.emit('lore-found', { id, n: l.n, title: l.title });
      if (!(H && H.lib && H.lib.siteSound && H.lib.siteSound('lore-glint', { volume: 0.6 })) && game.hasAsset && game.hasAsset('confirm.mp3')) game.sound('confirm.mp3', { volume: 0.4 });
      // The Overseer noticed: a thin beam on what was found.
      try { if (thingOf && H && H.overseer && H.overseer.beam) H.overseer.beam(thingOf, { radius: 0.8, seconds: 1.4 }); } catch { /* fine */ }
      const p = game.player;
      if (p) game.burst([p.x, p.y + 1.5, p.z], { color: '#e5d9b8', count: 18, speed: 3, size: 0.16 });
      refresh();
    }
    return fresh;
  }
  // The thing in the world each piece of lore is (sandbox.ts), so it can be seen and heard there.
  const LORE_THING = { logbook: 'logbook', lamp: 'lamp_a', tally: 'lore_rock', receipt: 'lore_slip', chair: 'lore_chair', drawing: 'lore_drawing' };
  function loreThing(id) {
    const e = game.find ? game.find(LORE_THING[id] || `lore_${id}`) : null;
    return e && e.alive ? e : null;
  }
  // What hasn't been found yet glints now and then, so it is found by looking, not by reading a list (quality rule 6).
  game.every(2.5, () => {
    if (game.mode !== 'play') return;
    const p = game.player;
    if (!p) return;
    const k = kept().lore;
    for (const l of LORE) {
      if (!l.at || k.has(l.id)) continue;
      const e = loreThing(l.id);
      if (!e || Math.hypot(e.x - p.x, e.z - p.z) > 40) continue;
      game.burst([e.x, e.y + 0.4, e.z], { color: '#fff2b0', count: 5, speed: 0.8, size: 0.09 });
    }
  });
  game.on('islander', (d) => { if (d && d.id) { meet(d.id); } });
  game.on('notice', (d) => { if (d && (d.id === 'planks' || d.id === 'logbook')) find(d.id); });
  game.every(1, () => {
    const p = game.player, pip = (game.all('Pip') || [])[0];
    if (!p || !pip || game.mode !== 'play' || (game.mirror && game.mirror.pending)) return;
    if (Math.hypot(pip.x - p.x, pip.z - p.z) < 9) meet('pip');
  });

  // E near the rest of the objects on the island (the planks and the logbook are the Chapter One notices, in sandbox.js).
  if (H && H.use && H.use.register) {
    const READ = { letter: 'Read the letter', lamp: 'Look at the lamp', receipt: 'Read the slip', tally: 'Read the scratches', chair: 'Look at the chair', drawing: 'Look at the drawing' };
    H.use.register('island:lore', {
      near(p) {
        if (game.mode !== 'play') return null;
        let best = null;
        for (const id of Object.keys(READ)) {
          const l = LORE.find((x) => x.id === id);
          const d = Math.hypot(p.x - l.at[0], p.z - l.at[1]);
          if (d < (id === 'letter' ? 1.8 : 2.4) && (!best || d < best.d)) best = { id, d, l };
        }
        return best ? { label: READ[best.id], priority: best.id === 'letter' ? 7 : 3, distance: best.d, act: () => find(best.id) } : null;
      },
    });
  }

  // ------------------------------------------------------------------ the panel
  const model = () => {
    const k = kept();
    return {
      quests: questList(),
      done: questList().filter((q) => q.state === 'done' || q.state === 'skipped').length,
      cast: CAST.map((c) => ({ ...c, met: k.met.has(c.id) })),
      finale: Boolean(window.__island && window.__island.finale && window.__island.finale.isDone()),
      lore: LORE.map((l) => ({ id: l.id, n: l.n, title: l.title, by: l.by, found: k.lore.has(l.id), here: Boolean(l.at), art: l.art, text: k.lore.has(l.id) ? l.text : null })),
    };
  };
  function html(m) {
    const ico = { done: '✓', skipped: '↷', now: '▸', todo: '·' };
    const qs = m.quests.map((q) => `<li class="jr-q ${q.state}"><b>${ico[q.state]}</b><span><i>${q.n}. ${esc(q.title)}</i> ${esc(q.text)}${q.state === 'skipped' ? ' (skipped)' : ''} <em>skippable</em></span></li>`).join('');
    const cs = m.cast.map((c) => (c.met ? `<li class="jr-c"><i>${esc(c.name)}</i> <em>${esc(c.what)}</em><span>${esc(c.line)}</span></li>` : `<li class="jr-c unmet"><i>?</i> <em>Not met yet</em></li>`)).join('');
    const found = m.lore.filter((l) => l.found).length;
    const ls = m.lore.map((l) => `<li class="jr-pg ${l.found ? 'found' : 'unfound'}" data-n="${l.n}"><div class="jr-art"><img src="${esc(l.art)}" alt="" loading="lazy" draggable="false" onerror="this.style.visibility='hidden'"></div>`
      + (l.found ? `<i>${esc(l.title)}</i> <em>${esc(l.by)}</em><span>${l.text.map(esc).join(' ')}</span>` : `<i>? ${l.n}.</i> <em>Not yet found${l.here ? '' : '. It is not on this island yet.'}</em>`) + '</li>').join('');
    return `<div class="jr-head"><b>Journal</b><button type="button" class="jr-x" aria-label="Close the journal">×</button></div><div class="jr-body">`
      + `<h4>Chapter One: What Are You? <small>${m.done} of 8</small></h4><ul>${qs}</ul>${m.finale ? '<button type="button" class="jr-replay">▶ Replay the end of Chapter One</button>' : ''}`
      + `<h4>Neighbours met <small>${m.cast.filter((c) => c.met).length} of ${m.cast.length}</small></h4><ul>${cs}</ul>`
      + `<h4>Painted pages <small>${found} of ${m.lore.length} found</small><small class="jr-count">1 / ${m.lore.length}</small></h4><ul class="jr-pages">${ls}</ul></div>`;
  }
  if (typeof document !== 'undefined' && !document.getElementById('journal-style')) {
    const st = document.createElement('style');
    st.id = 'journal-style';
    st.textContent = [
      '.jr-btn{position:fixed;right:max(12px,env(safe-area-inset-right));top:max(60px,calc(env(safe-area-inset-top) + 52px));z-index:25;width:44px;height:44px;border-radius:12px;border:1px solid rgba(255,255,255,.3);background:rgba(10,14,24,.7);color:#fff;font:600 22px system-ui,sans-serif;cursor:pointer;pointer-events:auto;backdrop-filter:blur(4px)}',
      '.jr-btn.new::after{content:"";position:absolute;right:5px;top:5px;width:9px;height:9px;border-radius:50%;background:#ffd84a}',
      '.jr-btn[hidden],.jr[hidden]{display:none}',
      // (the bottom 150px stay clear: the phone's stick and buttons)
      '.jr{position:fixed;left:50%;transform:translateX(-50%);top:max(10px,env(safe-area-inset-top));z-index:60;width:min(520px,calc(100vw - 20px));max-height:calc(100vh - 160px - env(safe-area-inset-top));max-height:calc(100dvh - 160px - env(safe-area-inset-top));display:flex;flex-direction:column;box-sizing:border-box;border-radius:14px;background:rgba(14,18,30,.94);border:1px solid rgba(229,217,184,.5);color:#eef2ff;font:500 14px/1.35 system-ui,sans-serif;pointer-events:auto}',
      '.jr-head{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-bottom:1px solid rgba(255,255,255,.14);font-size:16px;color:#e5d9b8}',
      '.jr-x{background:none;border:0;color:#fff;font-size:26px;line-height:1;cursor:pointer;width:40px;height:36px}',
      '.jr-body{overflow-y:auto;padding:4px 14px 12px;-webkit-overflow-scrolling:touch}',
      '.jr h4{margin:12px 0 4px;font:800 11px system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#ffd84a}.jr h4 small{color:#9fb0d0;font-weight:600;margin-left:6px}',
      '.jr ul{list-style:none;margin:0;padding:0}.jr li{padding:5px 0;border-bottom:1px solid rgba(255,255,255,.07)}',
      '.jr i{font-style:normal;font-weight:700}.jr em{font-style:normal;color:#9fb0d0;font-size:12px}',
      '.jr-q{display:flex;gap:8px}.jr-q b{width:14px;flex:none;color:#7ee0a0}.jr-q.todo b,.jr-q.todo{color:#8a97b5}.jr-q.now b{color:#ffd84a}.jr-q span{flex:1}',
      '.jr-replay{margin:8px 0 2px;min-height:44px;padding:8px 14px;border-radius:10px;border:1px solid rgba(255,216,74,.6);background:rgba(255,216,74,.12);color:#ffd84a;font:700 14px system-ui,sans-serif;cursor:pointer}',
      '.jr-pages{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;gap:10px;-webkit-overflow-scrolling:touch;touch-action:pan-x pan-y;scrollbar-width:none}.jr-pages::-webkit-scrollbar{display:none}',
      '.jr li.jr-pg{flex:0 0 100%;box-sizing:border-box;scroll-snap-align:center;border:1px solid rgba(229,217,184,.35);border-radius:10px;padding:8px;background:rgba(40,28,14,.5)}',
      '.jr-art{aspect-ratio:4/3;border-radius:6px;overflow:hidden;background:#2a2014;margin-bottom:6px}.jr-art img{width:100%;height:100%;object-fit:cover;display:block;filter:sepia(.25)}',
      '.jr-pg.unfound .jr-art img{filter:blur(7px) grayscale(1) brightness(.5)}.jr-pg span{display:block;color:#f1e6c8;font-size:15px;line-height:1.4}',
      '.jr-c span,.jr-l span{display:block;color:#dbe7ff}.jr li.unmet,.jr li.unfound{color:#7d8aa8}',
    ].join('\n');
    document.head.appendChild(st);
  }
  let paused = false;
  const panel = () => game.ui.el('journal');
  function refresh() {
    const el = panel();
    if (el && !el.hidden) { el.innerHTML = html(model()); wire(el); }
    const b = game.ui.el('journal-btn');
    if (b && el && el.hidden) b.classList.add('new');
  }
  function wire(el) {
    const x = el.querySelector && el.querySelector('.jr-x'); if (x) x.onclick = close;
    const pg = el.querySelector && el.querySelector('.jr-pages');
    if (pg) pg.addEventListener('scroll', () => {
      const n = Math.round(pg.scrollLeft / Math.max(1, pg.clientWidth + 10)) + 1;
      const c = el.querySelector('.jr-count'); if (c) c.textContent = `${n} / ${pg.children.length}`;
      if (pg._n !== n) { pg._n = n; game.emit('journal-page', { n, of: pg.children.length }); }
    }, { passive: true });
    const rp = el.querySelector && el.querySelector('.jr-replay');
    if (rp) rp.onclick = () => { close(); game.after(0.3, () => { const F = window.__island && window.__island.finale; if (F) F.replay(); }); };
  }
  function open(from) {
    const m = model();
    let el = panel();
    if (!el) { el = game.ui.html('journal', '', { class: 'jr' }); el.removeAttribute('style'); }
    el.innerHTML = html(m);
    el.hidden = false;
    wire(el);
    const b = game.ui.el('journal-btn'); if (b) b.classList.remove('new');
    try { if (H && H.lib && H.lib.siteSound) H.lib.siteSound('page-turn', { volume: 0.5 }); } catch { /* quiet */ }
    if (!paused && !game.paused) { paused = true; try { game.pause(); } catch { paused = false; } }
    funnel('sandbox_journal_open', { from: from || 'button', quests: m.done, met: m.cast.filter((c) => c.met).length, lore: m.lore.filter((l) => l.found).length });
    game.emit('journal', { open: true, from: from || 'button' });
    return m;
  }
  function close() {
    const el = panel();
    if (el) el.hidden = true;
    if (paused) { paused = false; try { game.resume(); } catch { /* fine */ } }
    game.emit('journal', { open: false });
  }
  const isOpen = () => { const el = panel(); return Boolean(el && !el.hidden); };
  function button() {
    game.ui.remove('journal-btn');
    game.ui.button('journal-btn', '📖', () => (isOpen() ? close() : open('button')));
    const b = game.ui.el('journal-btn');
    b.removeAttribute('style'); b.className = 'jr-btn'; b.setAttribute('aria-label', 'Journal');
  }
  button();
  if (typeof window !== 'undefined' && window.addEventListener) {
    if (window.__islandJournalKeys) { try { window.removeEventListener('keydown', window.__islandJournalKeys, true); window.removeEventListener('message', window.__islandJournalMsg); } catch { /* fine */ } }
    window.__islandJournalKeys = (e) => {
      const t = e.target && e.target.tagName;
      if (t === 'INPUT' || t === 'TEXTAREA') return;
      if (e.key === 'Escape' && isOpen()) { e.stopPropagation(); close(); }
      else if ((e.key === 'n' || e.key === 'N') && !e.ctrlKey && !e.metaKey && game.mode === 'play') { e.stopPropagation(); isOpen() ? close() : open('key'); }
    };
    // (The editor's pause menu: Journal.)
    window.__islandJournalMsg = (e) => { const d = e.data || {}; if (d.type === 'journal' && e.source === window.parent) (isOpen() ? close() : open('menu')); };
    window.addEventListener('keydown', window.__islandJournalKeys, true);
    window.addEventListener('message', window.__islandJournalMsg);
  }

  window.__island = Object.assign(window.__island || {}, { journal: { open, close, isOpen, model, find, meet, LORE, CAST, QUESTS } });
})();
