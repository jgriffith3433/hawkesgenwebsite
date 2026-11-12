// Side favours (docs/story.md 5d): Bobbin, Mrs Ember and Rolo each ask for a short two-step favour after the pier
// quest, grown from their want and running joke. A voiced ask (E / the phone action button), world markers and a
// point for each step (drive, fish, carry, boom), then a voiced payoff with a reaction gesture and a gift into the
// wardrobe or tools. Journal lists them. Events: favour-ask, favour-step, favour-payoff, favour-gift. Playtest
// `side-stories`. Kept on this device in localStorage; wardrobe gifts also go through H.memory.wardrobe.
(function () {
  const H = window.HawkesPlay;
  const KEY = 'hg_island_favours';
  const NEAR = 3.8;
  const STORE = (window.__islandFavoursStore = window.__islandFavoursStore || load());
  const log = (window.__islandFavourLog = window.__islandFavourLog || []);
  const markState = (window.__islandFavourMark = window.__islandFavourMark || { light: null, glow: null, pulse: null, at: null, who: null });

  function load() {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
      const j = raw ? JSON.parse(raw) : null;
      if (j && typeof j === 'object') return { unlocked: Boolean(j.unlocked), done: Array.isArray(j.done) ? j.done.filter((x) => typeof x === 'string') : [], active: null };
    } catch { /* fresh */ }
    return { unlocked: false, done: [], active: null };
  }
  function save() {
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify({ unlocked: STORE.unlocked, done: STORE.done, active: STORE.active }));
    } catch { /* fine */ }
  }
  const push = (entry) => { log.push(entry); if (log.length > 40) log.shift(); };

  // ------------------------------------------------------------------ the three favours (BotW-style: verb you already have)
  // ask / payoff are fixed words so each has a recorded voice clip (public/play/audio/voice/<who>-<hash>).
  const FAVOURS = {
    bobbin: {
      who: 'Admiral Bobbin', color: '#facc15',
      title: 'A longer name for the fleet',
      journal: 'Bobbin updated the logbook. Same boat, longer name. He gave you a medal.',
      ask: 'The log needs a new name. Take the boat out, then catch me a fish. Salute optional.',
      payoff: 'Fleet of two. Logbook updated. Same boat, longer name. Carry on.',
      gesture: 'salute',
      gift: { kind: 'acc', id: 'medal', label: 'a harbour medal' },
      steps: [
        { id: 'boat', verb: 'drive', hint: 'the speedboat', at: () => spotOf('boat') || [73, -1.2, 4.4] },
        { id: 'fish', verb: 'fish', hint: 'the pier end', at: () => [86.5, 1.2, -0.4] },
      ],
    },
    ember: {
      who: 'Mrs Ember', color: '#fb923c',
      title: 'A letter for the beach',
      journal: 'Mrs Ember\'s letter reached the beach chair. Forecast: clear. She gave you a stamp-flower.',
      ask: 'A letter for the beach, dear. Carry it to the chair, then a small boom so he notices. Sorry.',
      payoff: 'It reached him. Forecast: clear. Sorry. Take this stamp.',
      gesture: 'wave',
      gift: { kind: 'acc', id: 'flower', label: 'a stamp-flower' },
      steps: [
        { id: 'carry', verb: 'carry', hint: 'the beach chair', at: () => {
          const letter = window.__favourLetter;
          if (letter && letter.alive !== false && !letter.held && !(STORE.active && STORE.active.carried)) {
            return [letter.x, letter.y + 0.5, letter.z];
          }
          return spotOf('lore_chair') || [53, 1, -5];
        } },
        { id: 'boom', verb: 'blast', hint: 'the fuel barrels', at: () => [50, 1, -18] },
      ],
    },
    rolo: {
      who: 'Rolo', color: '#22d3ee',
      title: 'Scrap for a small tuesday',
      journal: 'Rolo got his scrap. Estimate: two wobbles. He gave you an antenna and painted the 4x4.',
      ask: 'huh. need scrap. drive the 4x4 to the barrels. then blow them. estimate: two wobbles.',
      payoff: 'huh. that was a small tuesday. take this. mostly fine.',
      gesture: 'shrug',
      gift: { kind: 'acc', id: 'antenna', label: 'a spare antenna' },
      paint: '#22d3ee',
      steps: [
        { id: 'drive', verb: 'drive', hint: 'the barrels', at: () => [50, 1, -18] },
        { id: 'boom', verb: 'blast', hint: 'the fuel barrels', at: () => [50, 1, -18] },
      ],
    },
  };
  const ORDER = ['bobbin', 'ember', 'rolo'];

  function spotOf(id) {
    const e = game.find && game.find(id);
    return e && e.alive ? [e.x, e.y, e.z] : null;
  }
  function islander(id) {
    const e = game.find && game.find(id);
    return e && e.alive ? e : null;
  }
  function groundY(x, z, fallback = 1) {
    try { if (game.terrain && game.terrain.heightAt) return game.terrain.heightAt(x, z); } catch { /* fine */ }
    return fallback;
  }
  function dist(a, b) {
    return Math.hypot((a.x || a[0]) - (b.x || b[0]), (a.z || a[2]) - (b.z || b[2]));
  }

  // ------------------------------------------------------------------ unlock after the pier quest (tour step "fish")
  function pierDone() {
    try {
      if (window.__islandPlayed && window.__islandPlayed.has && window.__islandPlayed.has('fish')) return true;
      const j = window.__islandJournal;
      if (j && j.quests && j.quests.fish) return true;
      const q = game.events && game.events.quests;
      if (q && typeof q.state === 'function') {
        const st = q.state('tour');
        if (st === 'done') return true;
        if (st === 'active' && typeof q.step === 'function') {
          const step = q.step('tour');
          const after = ['boom', 'ask', 'hill', 'fly', 'launch'];
          if (after.includes(step)) return true;
        }
      }
    } catch { /* fine */ }
    return false;
  }
  function unlock(why) {
    if (STORE.unlocked) return false;
    STORE.unlocked = true;
    save();
    game.emit('favour-unlock', { why: why || 'pier' });
    return true;
  }
  game.on('tour', (d) => { if (d && d.step === 'fish') unlock('tour-fish'); });
  game.on('quest', (d) => {
    if (!d || d.id !== 'tour') return;
    if (d.state === 'done' || (d.state === 'step' && pierDone())) unlock('quest');
  });
  game.every(2, () => { if (!STORE.unlocked && pierDone()) unlock('sweep'); });

  // ------------------------------------------------------------------ speak / gesture / point
  function speak(id, text, ctx) {
    const f = FAVOURS[id], e = islander(id);
    if (H && H.chat && H.chat.line) H.chat.line({ kind: 'npc', who: f.who, text, color: f.color, keep: 14 });
    if (e && e.lookAt && game.player) { try { e.lookAt(game.player); } catch { /* fine */ } }
    if (e && e.say) { try { e.say(text, Math.min(8, 2.5 + text.length / 18)); } catch { /* chat stands */ } }
    let gest = null;
    try {
      if (H && H.presence && H.presence.alive && e) gest = H.presence.alive.gesture(e, ctx || 'any', Math.min(4.5, 1.4 + text.length / 30));
    } catch { /* fine */ }
    const clip = (H && H.lib && H.lib.recordedLine && H.lib.recordedLine(id, text)) || null;
    return { gest, clip };
  }
  function pointAt(id, at) {
    const e = islander(id);
    if (!e) return;
    try {
      if (at && e.lookAt) e.lookAt({ x: at[0], y: at[1], z: at[2], position: at });
      if (H && H.presence && H.presence.alive) H.presence.alive.gesture(e, 'point', 2.4);
    } catch { /* fine */ }
  }

  // ------------------------------------------------------------------ world marker (golden pulse, no text panel)
  function clearMark(why) {
    const B = window.BABYLON, sc = H && H.world && H.world.scene;
    if (markState.pulse) { try { if (sc) sc.onBeforeRenderObservable.remove(markState.pulse); } catch { /* fine */ } markState.pulse = null; }
    if (markState.light) { try { markState.light.dispose(); } catch { /* fine */ } markState.light = null; }
    if (markState.glow) { try { markState.glow.dispose(); } catch { /* fine */ } markState.glow = null; }
    markState.at = null;
    markState.who = null;
    game.emit('favour-marker', { state: 'off', why: why || 'clear' });
  }
  function setMark(at, who) {
    clearMark('replace');
    if (!at) return;
    const B = window.BABYLON, sc = H && H.world && H.world.scene;
    const y = (at[1] != null ? at[1] : groundY(at[0], at[2])) + 1.1;
    const pos = [at[0], y, at[2]];
    markState.at = pos;
    markState.who = who || null;
    if (!B || !sc) { game.emit('favour-marker', { state: 'on', visual: false, at: pos, who }); return; }
    try {
      const glow = B.MeshBuilder.CreateSphere('favour-mark-glow', { diameter: 0.55, segments: 12 }, sc);
      const mat = new B.StandardMaterial('favour-mark-glow', sc);
      mat.emissiveColor = new B.Color3(1, 0.84, 0.3);
      mat.diffuseColor = new B.Color3(1, 0.9, 0.4);
      mat.alpha = 0.7;
      mat.disableLighting = true;
      glow.material = mat;
      glow.position.set(pos[0], pos[1], pos[2]);
      glow.isPickable = false;
      glow.metadata = { decor: true };
      markState.glow = glow;
      const light = new B.PointLight('favour-mark-light', new B.Vector3(pos[0], pos[1] + 0.4, pos[2]), sc);
      light.diffuse = new B.Color3(1, 0.85, 0.35);
      light.intensity = 0.85;
      light.range = 10;
      markState.light = light;
      let t0 = performance.now();
      markState.pulse = sc.onBeforeRenderObservable.add(() => {
        const k = 0.5 + 0.5 * Math.sin((performance.now() - t0) / 420);
        if (markState.glow && markState.glow.material) {
          markState.glow.material.alpha = 0.4 + 0.45 * k;
          const s = 0.85 + 0.35 * k;
          markState.glow.scaling.set(s, s, s);
        }
        if (markState.light) markState.light.intensity = 0.55 + 0.55 * k;
      });
      game.emit('favour-marker', { state: 'on', visual: true, at: pos, who });
    } catch (err) {
      try { if (H && H.report) H.report(err, 'favour-marker'); } catch { /* fine */ }
      game.emit('favour-marker', { state: 'on', visual: false, at: pos, who });
    }
  }
  function markForActive() {
    const a = STORE.active;
    if (!a) { clearMark('idle'); return; }
    const f = FAVOURS[a.id];
    const step = f.steps[a.step];
    if (!step) { clearMark('done'); return; }
    let at = null;
    try { at = step.at(); } catch { at = null; }
    setMark(at, a.id);
    pointAt(a.id, at);
  }

  // ------------------------------------------------------------------ gifts
  function giveGift(id) {
    const f = FAVOURS[id], g = f.gift;
    let ok = false;
    if (g.kind === 'acc' && H && H.memory && H.memory.wardrobe) {
      ok = Boolean(H.memory.wardrobe.add({ acc: [g.id] }));
      // Wear it at once so the gift is visible on the player (Observatory gift path).
      try { if (ok && H.presence && H.presence.setLook) H.presence.setLook({ accessory: g.id }); } catch { /* wardrobe still owns it */ }
    } else if (g.kind === 'tool' && H && H.mayhem && H.mayhem.addToBelt) {
      ok = Boolean(H.mayhem.addToBelt(g.id));
    } else if (g.kind === 'col' && H && H.memory && H.memory.wardrobe) {
      ok = Boolean(H.memory.wardrobe.add({ col: [g.id] }));
    }
    if (f.paint) {
      const jeep = game.find && game.find('jeep');
      if (jeep) {
        try {
          jeep.color = f.paint;
          if (jeep.material) jeep.material.color = f.paint;
          if (jeep._mat && jeep._mat.diffuseColor && window.BABYLON) {
            const c = window.BABYLON.Color3.FromHexString(f.paint);
            jeep._mat.diffuseColor = c;
          }
          // Soft sparkle on the jeep so the paint reads as the gift moment.
          try { if (H && H.lib && H.lib.siteSound) H.lib.siteSound('ui-quest', { volume: 0.4, at: [jeep.x, jeep.y, jeep.z] }); } catch { /* fine */ }
          ok = true;
        } catch { /* wardrobe gift still counts */ }
      }
    }
    const entry = { id, who: f.who, gift: g, paint: f.paint || null, ok, t: Math.round(game.time * 10) / 10 };
    push({ kind: 'gift', ...entry });
    game.emit('favour-gift', entry);
    if (H && H.chat && H.chat.line) H.chat.line({ kind: 'system', text: `Gift: ${g.label}.`, keep: 8 });
    return entry;
  }

  // ------------------------------------------------------------------ start / advance / finish
  function statusOf(id) {
    if (STORE.done.includes(id)) return 'done';
    if (STORE.active && STORE.active.id === id) return 'active';
    if (!STORE.unlocked) return 'locked';
    return 'open';
  }
  function start(id, how) {
    const f = FAVOURS[id];
    if (!f || !STORE.unlocked || STORE.done.includes(id)) return null;
    if (STORE.active && STORE.active.id !== id) return null; // one at a time
    if (STORE.active && STORE.active.id === id) return STORE.active;
    // Ember's letter: a holdable prop by the mailbox for the carry step.
    if (id === 'ember') spawnLetter();
    STORE.active = { id, step: 0, startedAt: game.time, returnFor: false };
    save();
    const sp = speak(id, f.ask, 'first');
    const at = f.steps[0].at();
    pointAt(id, at);
    markForActive();
    // Hold them still while they ask (routines resume after).
    try { if (H && H.living && H.living.command) H.living.command(islander(id), 'stay'); } catch { /* fine */ }
    game.after(5, () => { try { if (H && H.living && H.living.command) H.living.command(islander(id), 'wander'); } catch { /* fine */ } });
    const entry = { id, who: f.who, text: f.ask, clip: sp.clip, gesture: sp.gest, how: how || 'use', step: 0, verb: f.steps[0].verb };
    push({ kind: 'ask', ...entry });
    game.emit('favour-ask', entry);
    game.emit('favour-step', { id, who: f.who, step: 0, verb: f.steps[0].verb, hint: f.steps[0].hint, of: 2 });
    return STORE.active;
  }
  function advance(id, stepId) {
    const a = STORE.active;
    if (!a || a.id !== id || a.returnFor) return false;
    const f = FAVOURS[id];
    const step = f.steps[a.step];
    if (!step || step.id !== stepId) return false;
    const next = a.step + 1;
    const entry = { id, who: f.who, step: a.step, verb: step.verb, next, of: 2 };
    push({ kind: 'step', ...entry });
    game.emit('favour-step', { ...entry, done: true });
    try { if (H && H.lib && H.lib.siteSound) H.lib.siteSound('ui-quest', { volume: 0.45 }); } catch { /* fine */ }
    // Ember's boom: Channel notices live (the joke lands on him).
    if (id === 'ember' && stepId === 'boom') channelNotices();
    if (next >= f.steps.length) return awaitReturn(id);
    STORE.active = { ...a, step: next };
    save();
    markForActive();
    game.emit('favour-step', { id, who: f.who, step: next, verb: f.steps[next].verb, hint: f.steps[next].hint, of: 2 });
    return true;
  }
  /** Both steps done: golden marker on the islander; payoff only when the player walks back. */
  function awaitReturn(id) {
    const f = FAVOURS[id];
    const e = islander(id);
    STORE.active = { id, step: f.steps.length, returnFor: true, startedAt: STORE.active && STORE.active.startedAt };
    save();
    const at = e ? [e.x, e.y + 1.2, e.z] : null;
    setMark(at, id);
    try { if (H && H.living && H.living.command && e) H.living.command(e, 'stay'); } catch { /* fine */ }
    game.emit('favour-return', { id, who: f.who });
    return true;
  }
  function finish(id) {
    const f = FAVOURS[id];
    STORE.active = null;
    if (!STORE.done.includes(id)) STORE.done.push(id);
    save();
    clearMark('payoff');
    const sp = speak(id, f.payoff, f.gesture);
    try {
      if (H && H.presence && H.presence.alive) H.presence.alive.gesture(islander(id), f.gesture, 3.2);
    } catch { /* fine */ }
    const gift = giveGift(id);
    // Meet them in the journal if not yet.
    try { if (window.__island && window.__island.journal && window.__island.journal.meet) window.__island.journal.meet(id); } catch { /* fine */ }
    const entry = { id, who: f.who, text: f.payoff, clip: sp.clip, gesture: f.gesture, gift: gift.gift, journal: f.journal };
    push({ kind: 'payoff', ...entry });
    game.emit('favour-payoff', entry);
    game.emit('favour', { id, state: 'done', gift: gift.gift });
    // Soft chime (site sound if present).
    try { if (H && H.lib && H.lib.siteSound) H.lib.siteSound('ui-quest', { volume: 0.55 }); } catch { /* fine */ }
    clearLetter();
    game.after(4, () => { try { if (H && H.living && H.living.command) H.living.command(islander(id), 'wander'); } catch { /* fine */ } });
    return entry;
  }
  function channelNotices() {
    const ch = islander('channel');
    const line = 'Breaking: a letter, then a boom. Sources say the post. Ratings: record.';
    if (ch && game.player) { try { ch.lookAt(game.player); } catch { /* fine */ } }
    if (H && H.chat && H.chat.line) H.chat.line({ kind: 'npc', who: 'Channel', text: line, color: '#7dd3fc', keep: 10 });
    if (ch && ch.say) { try { ch.say(line, 5); } catch { /* fine */ } }
    try { if (H && H.presence && H.presence.alive && ch) H.presence.alive.gesture(ch, 'explain', 2.8); } catch { /* fine */ }
    game.emit('favour-channel', { text: line });
  }

  // ------------------------------------------------------------------ Ember's letter (carry verb: real holdable)
  function spawnLetter() {
    clearLetter();
    const ember = islander('ember');
    const x = ember ? ember.x + 1.2 : -11.5;
    const z = ember ? ember.z + 0.8 : 16.5;
    const y = groundY(x, z) + 0.35;
    try {
      const spec = {
        id: 'favour_letter',
        type: 'box',
        name: 'Letter',
        shape: { size: [0.35, 0.08, 0.25] },
        material: { color: '#f5e6c8' },
        physics: 'dynamic',
        transform: { position: [x, y, z] },
        behaviors: [{ use: 'holdable', throw: 8 }],
        shadow: false,
      };
      let e = null;
      if (H && typeof H.fromSpec === 'function') {
        const old = game.find && game.find('favour_letter');
        if (old && old.destroy) try { old.destroy(); } catch { /* fine */ }
        e = H.fromSpec(spec);
        if (e) e.temporary = true;
      }
      if (e) {
        window.__favourLetter = e;
        // Marker sits on the letter first so the carry verb is obvious.
        setMark([x, y + 0.6, z], 'ember');
        game.emit('favour-letter', { state: 'spawned', at: [x, y, z], holdable: Boolean(e.behaviors && e.behaviors.some((b) => /holdable/i.test(String(b.name || b.use || '')))) });
      }
    } catch (err) {
      try { if (H && H.report) H.report(err, 'favour-letter'); } catch { /* fine */ }
    }
  }
  function clearLetter() {
    const e = window.__favourLetter;
    if (e && e.alive !== false) {
      try {
        if (typeof e.destroy === 'function') e.destroy();
        else if (typeof e.remove === 'function') e.remove();
        else if (e.node) e.node.dispose();
      } catch { /* fine */ }
    }
    window.__favourLetter = null;
  }
  function letterHeld() {
    const letter = window.__favourLetter;
    if (!letter || letter.alive === false) return false;
    if (letter.held) return true;
    try {
      if (H && H.abilities && H.abilities.holding === letter) return true;
    } catch { /* fine */ }
    return false;
  }
  function letterDelivered() {
    const letter = window.__favourLetter;
    const chair = spotOf('lore_chair') || [53, 1, -5];
    if (!letter || letter.alive === false) return false;
    // Real carry: must have been held, then the letter (or holder) is within 3.5 m of the chair.
    if (!letter.held && !STORE.active?.carried) return false;
    if (letter.held) STORE.active.carried = true;
    const nearChair = dist(letter, { x: chair[0], z: chair[2] }) < 3.5
      || (game.player && letter.held && dist(game.player, { x: chair[0], z: chair[2] }) < 3.5);
    return Boolean(nearChair && (STORE.active.carried || letter.held));
  }

  // ------------------------------------------------------------------ step detection (existing island verbs)
  const did = () => window.__islanderDid || {};
  game.on('catch', (d) => {
    if (!(d && d.mine !== false)) return;
    if (STORE.active && STORE.active.id === 'bobbin' && STORE.active.step === 1) advance('bobbin', 'fish');
  });
  game.on('explosion', () => {
    if (!STORE.active) return;
    if (STORE.active.id === 'ember' && STORE.active.step === 1) advance('ember', 'boom');
    if (STORE.active.id === 'rolo' && STORE.active.step === 1) advance('rolo', 'boom');
  });
  let boatBase = null, droveNearBarrels = false;
  game.every(0.45, () => {
    const p = game.player;
    if (!p || game.mode !== 'play') return;
    const a = STORE.active;
    if (!a) return;
    // Payoff: walk back to the islander (portrait framing).
    if (a.returnFor) {
      const e = islander(a.id);
      if (e && dist(e, p) < NEAR) finish(a.id);
      else if (e) setMark([e.x, e.y + 1.2, e.z], a.id);
      return;
    }
    // Bobbin step 0: take the boat out (enter boat and move ~12 m).
    if (a.id === 'bobbin' && a.step === 0) {
      const v = p._vehRider;
      const inBoat = Boolean(v && /boat/i.test(String(v.type || v.name || v.id || '')));
      if (inBoat) {
        if (!boatBase) boatBase = [p.x, p.z];
        else if (Math.hypot(p.x - boatBase[0], p.z - boatBase[1]) > 12) advance('bobbin', 'boat');
      } else boatBase = null;
    }
    // Ember step 0: pick up the letter (holdable), carry to the beach chair.
    if (a.id === 'ember' && a.step === 0) {
      if (letterHeld()) a.carried = true;
      if (letterDelivered()) advance('ember', 'carry');
    }
    // Rolo step 0: drive the 4x4 to within 14 m of the barrels.
    if (a.id === 'rolo' && a.step === 0) {
      const v = p._vehRider;
      const inJeep = Boolean(p.controller === 'drive' || (v && /truck|jeep|4x4/i.test(String(v.type || v.name || v.id || ''))));
      if (inJeep && dist(p, { x: 50, z: -18 }) < 14) {
        droveNearBarrels = true;
        advance('rolo', 'drive');
      }
    }
  });

  // ------------------------------------------------------------------ H.use: start or remind (phone action button)
  if (H && H.use && H.use.register) {
    H.use.register('island:favour', {
      near(p) {
        if (game.mode !== 'play') return null;
        let best = null, bd = NEAR;
        for (const id of ORDER) {
          const e = islander(id);
          if (!e) continue;
          const d = dist(e, p);
          if (d >= bd) continue;
          const st = statusOf(id);
          if (st === 'locked' || st === 'done') continue;
          bd = d;
          best = { id, d, st };
        }
        if (!best) return null;
        const f = FAVOURS[best.id];
        if (best.st === 'open') {
          return {
            label: `${f.who}'s favour`,
            priority: 8,
            distance: best.d,
            act: () => start(best.id, 'use'),
          };
        }
        // Active: remind + re-point (no text panel).
        return {
          label: `Remind ${f.who}`,
          priority: 7,
          distance: best.d,
          act: () => {
            const a = STORE.active;
            if (!a || a.id !== best.id) return;
            const step = f.steps[a.step];
            speak(best.id, f.ask, 'point');
            markForActive();
            game.emit('favour-remind', { id: best.id, step: a.step, verb: step.verb });
          },
        };
      },
    });
  }

  // ------------------------------------------------------------------ playtest / journal API
  function list() {
    return ORDER.map((id) => {
      const f = FAVOURS[id];
      return {
        id, who: f.who, title: f.title, journal: f.journal, gift: f.gift,
        status: statusOf(id),
        ask: f.ask, payoff: f.payoff,
        steps: f.steps.map((s) => ({ id: s.id, verb: s.verb, hint: s.hint })),
        activeStep: STORE.active && STORE.active.id === id ? STORE.active.step : null,
      };
    });
  }
  function forceUnlock() { return unlock('playtest'); }
  function forceStart(id) { forceUnlock(); return start(id, 'playtest'); }
  function forceAdvance(id, stepId) {
    if (!STORE.active || STORE.active.id !== id) forceStart(id);
    if (id === 'ember' && stepId === 'carry' && STORE.active) STORE.active.carried = true;
    // Walk steps until the named one (stops at returnFor after the last step).
    const f = FAVOURS[id];
    while (STORE.active && STORE.active.id === id && !STORE.active.returnFor) {
      const step = f.steps[STORE.active.step];
      if (!step) break;
      const sid = step.id;
      advance(id, sid);
      if (sid === stepId) break;
      if (!STORE.active || STORE.active.returnFor) break;
    }
    return STORE.active || { done: STORE.done.includes(id) };
  }
  /** Playtest: stand by the islander and complete the return payoff. */
  function forcePayoff(id) {
    if (!STORE.active || STORE.active.id !== id) {
      forceStart(id);
      for (const s of FAVOURS[id].steps) forceAdvance(id, s.id);
    }
    if (STORE.active && STORE.active.id === id && !STORE.active.returnFor) awaitReturn(id);
    return finish(id);
  }

  window.__islandFavours = {
    list, start, advance, finish, unlock: forceUnlock, forceStart, forceAdvance, forcePayoff, awaitReturn,
    statusOf, FAVOURS, STORE, log, markForActive, clearMark, pierDone, letterHeld, letterDelivered,
    marker: markState,
  };
  // Restore marker if a favour was mid-flight across a soft reload.
  if (STORE.active) game.after(1.2, markForActive);
})();
