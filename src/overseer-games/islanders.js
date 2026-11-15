// The islanders (docs/story.md "5b"): Admiral Bobbin (a rubber duck, the pier), Mrs Ember (a toaster, the mailbox), Rolo (a
// roll-bot, the rocket's pad), Dolores (a cactus, the hill) and Channel (a TV robot, the beach). Each is a `friend` in the
// world file that stays at its post and wears its body from the mirror's own set; here is how they talk. E (or the phone's
// button, H.use) near one says one short line in the chat window, text only. What they say depends on what the player has
// done, from what is true: this visit's deeds (a fish, a blast, a flight, a question to the Overseer, a drive) first, once each;
// the Overseer's memory (H.memory: counts from earlier visits, the name) after; their ordinary lines otherwise, never the same
// one twice in a row. They use the name the player chose and never say a word about what the mirror made them.
(function () {
  const H = window.HawkesPlay;
  const NEAR = 3.6; // meters: E reaches this far
  
  // ------------------------------------------------------------------ what the player has done (this visit)
  const did = (window.__islanderDid = window.__islanderDid || { fish: 0, boom: 0, high: 0, ask: 0, drive: 0, boat: 0, at: {} });
  const heard = (window.__islanderHeard = window.__islanderHeard || {}); // per islander: reactions already said, last line, rotation
  const log = (window.__islanderLog = window.__islanderLog || []);
  if (!window.__islanderListening) {
    window.__islanderListening = true;
    game.on('catch', (d) => { if (d && d.mine !== false) { did.fish++; did.at.fish = clock(); } });
    game.on('explosion', () => { did.boom++; did.at.boom = clock(); });
    game.on('sandbox-high', (d) => { if (d && d.mine !== false) did.high++; });
    game.on('asked', (d) => { if (!(d && d.skipped)) did.ask++; });
  }
  let driving = false;
  game.every(0.5, () => {
    const p = game.player;
    const now = Boolean(p && (p._vehRider || p.controller === 'drive'));
    if (now && !driving) { const v = p._vehRider; if (v && /boat/i.test(String(v.type || v.name || ''))) did.boat++; else { did.drive++; did.at.drive = clock(); } }
    driving = now;
  });

  /** What is true of the player now: the name they chose, this visit's deeds, and the Overseer's memory of earlier visits. */
  function facts() {
    const m = H && H.memory && H.memory.get ? H.memory.get() : null;
    const look = H && H.presence && H.presence.look;
    const n = (m && m.n) || {};
    const name = (look && look.name) || (m && m.name) || null;
    return { name, visits: (m && m.visits) || 1, before: { fish: n.fish || 0, boom: n.boom || 0, high: n.high || 0 }, did };
  }

  // ------------------------------------------------------------------ what each one says
  // react: { id, when(f), say(f) } in order; each said once (the first that is true and not yet said). base: the ordinary lines.
  // `hi` is the first thing said to someone new. Short, in voice, and nothing about what the player is.
  const nm = (f, pre = '', post = '') => (f.name ? `${pre}${f.name}${post}` : '');
  const CAST = {
    bobbin: {
      who: 'Admiral Bobbin', color: '#facc15',
      hi: (f) => `Admiral Bobbin, harbourmaster. ${f.name ? `Welcome to the harbour, ${f.name}.` : 'Welcome to the harbour.'} One boat. A fleet, in time.`,
      react: [
        { id: 'fish', when: (f) => f.did.fish > 0, say: (f) => `I saw that cast${nm(f, ', ')}. Form: good. Eight out of ten. The two is for the wind, which I take personally.` },
        { id: 'boat', when: (f) => f.did.boat > 0, say: () => 'You took the boat out. Then it is a fleet of two. I shall update the logbook. Same boat, longer name.' },
        { id: 'fish3', when: (f) => f.did.fish + f.before.fish >= 3, say: (f) => `Fish number ${f.did.fish + f.before.fish}. The harbour has never been so busy. Carry on.` },
        { id: 'back', when: (f) => f.visits > 1, say: (f) => `Back again${nm(f, ', ')}. Your berth was kept. It is also the pier. Both are true.` },
      ],
      base: ['Carry on. That is an order. It is also a suggestion.', 'My logbook lists every ship I have commanded. So far it is always the same boat.', 'A wave just looked at me. I took it personally.', 'Salute optional. Appreciated, though.', 'The pages near the middle of the logbook are missing. A gull, I expect.'],
    },
    ember: {
      who: 'Mrs Ember', color: '#fb923c',
      hi: (f) => `A letter came for you, dear. It says: for the new one. I have written ${f.name || 'your name'} on the front. It says: mind the third plank, it sticks. That is all. I did not read it twice. Sorry.`,
      react: [
        { id: 'boom', when: (f) => f.did.boom > 0, say: () => 'That was a loud one, dear. The chimney held. I did say there might be weather. Sorry.' },
        { id: 'fish', when: (f) => f.did.fish > 0, say: () => 'You caught a fish, dear. The pier told me. You should eat something. Sorry.' },
        { id: 'high', when: (f) => f.did.high > 0, say: (f) => `You went up high${nm(f, ', ')}. Cloud at the top, I think. I checked the forecast afterwards. It was right. Sorry.` },
        { id: 'back', when: (f) => f.visits > 1, say: (f) => `Back${nm(f, ', ')}. There is another letter. It is from the same paper. I will say no more. I have already said it. Sorry.` },
      ],
      base: ['Rain at four. Sorry.', "Dear, you've gone a funny colour. Eat something.", 'Every letter reaches someone. Even the ones nobody sent. I just have not found whose yet.', 'Sun until the wind turns. It will turn. Sorry.', 'I never read them. Not twice.'],
    },
    rolo: {
      who: 'Rolo', color: '#22d3ee',
      hi: () => 'huh. hi. the 4x4 is fine. mostly fine. flip it and i fix it.',
      react: [
        { id: 'drive', when: (f) => f.did.drive > 0, say: () => 'you drove it. good. one wobble, maybe two. that is fine.' },
        { id: 'boom', when: (f) => f.did.boom > 0, say: () => 'heard that. the pad is fine. it shook a small tuesday.' },
        { id: 'high', when: (f) => f.did.high > 0, say: (f) => `you went up${nm(f, ', ')}. saw it from under the rocket. it is built. i cannot say why. you can look.` },
        { id: 'back', when: (f) => f.visits > 1, say: (f) => `oh. hi${nm(f, ', ')}. still under here. that is fine.` },
      ],
      base: ["huh. that's fine. that's mostly fine.", 'estimate: three wobbles. maybe a small tuesday.', "i'm fine. just under here.", 'it will hold. it holds. probably it holds.', 'there is one thing i cannot fix. it is fine.'],
    },
    dolores: {
      who: 'Dolores', color: '#4ade80',
      hi: (f) => `I wasn't waiting. ${f.name ? `${f.name}, is it? ` : ''}The hill is just quiet. Stay.`,
      react: [
        { id: 'high', when: (f) => f.did.high > 0, say: () => 'You went up in the helicopter. I did not watch. You turned left at the top. Do not look at me like that.' },
        { id: 'fish', when: (f) => f.did.fish > 0, say: () => 'You caught a fish. A decent size. I do not care. It had a green back.' },
        { id: 'boom', when: (f) => f.did.boom > 0, say: () => 'Loud. Over by the beach, three seconds after the wind turned. I was not counting.' },
        { id: 'name', when: (f) => Boolean(f.name), say: (f) => `${f.name}. I have it. I do not care. I just keep it.` },
        { id: 'back', when: (f) => f.visits > 1, say: () => 'Oh. You again. I kept your spot. It was already there. Sit.' },
      ],
      base: ["I'm not lonely. The hill is just quiet. Stay.", 'The wind is from the east. Not that I checked.', 'I do not care who comes up here. You had a long walk, though.', 'People come, people go. I remember what they wore. Not that I care.'],
    },
    channel: {
      who: 'Channel', color: '#7dd3fc',
      hi: (f) => `Breaking: ${f.name ? f.name : 'a visitor'} has arrived on the beach. More on this as it happens. Ratings: record.`,
      react: [
        { id: 'boom', when: (f) => f.did.boom > 0, say: (f) => `Breaking: BOOM, live from the beach. Sources say it was ${f.name || 'you'}. Ratings: a record.` },
        { id: 'fish', when: (f) => f.did.fish > 0, say: () => 'Breaking: a fish. A real one. More on this as it happens. Nothing happens. Still a record.' },
        { id: 'high', when: (f) => f.did.high > 0, say: (f) => `Breaking: ${f.name || 'a local'} was seen leaving the island, upward. We cut to the sky. The sky is there.` },
        { id: 'booms', when: (f) => f.did.boom + f.before.boom >= 3, say: (f) => `Explosion number ${f.did.boom + f.before.boom} on this channel. Our best season. Stay tuned.` },
        { id: 'back', when: (f) => f.visits > 1, say: (f) => `Breaking: ${f.name || 'a regular'} returns. Viewers at home: one. Ratings: record.` },
      ],
      base: ['Breaking: the tide is in. More on this as it happens.', 'Breaking: a nap. Ratings: record.', 'Stay tuned. Or do not. Ratings are a record either way.', 'Breaking: the wind has changed. Details after the break. There is no break.'],
    },
  };
  const ids = Object.keys(CAST);

  /** The next line this one says to the player: this visit's news first, then memory, then the ordinary lines in rotation. */
  function line(id, first) {
    const c = CAST[id], f = facts();
    const st = (heard[id] = heard[id] || { said: [], last: -1, hello: false });
    if (first && !st.hello) { st.hello = true; return { topic: 'hello', text: c.hi(f) }; }
    st.hello = true;
    for (const r of c.react) {
      if (st.said.includes(r.id)) continue;
      let ok = false;
      try { ok = r.when(f); } catch { ok = false; }
      if (ok) { st.said.push(r.id); return { topic: r.id, text: r.say(f) }; }
    }
    st.last = (st.last + 1) % c.base.length;
    return { topic: 'base', text: c.base[st.last] };
  }

  /** A gesture with the line (arms and head only, never the feet: modules/presence/presence-alive.js): by the line's context, the
   *  character's own habit and the words' length. Returns the gesture's name, or null where the body cannot (a model without the cast's rig). */
  function gestureFor(e, ctx, text) {
    try { return H && H.presence && H.presence.alive && e ? H.presence.alive.gesture(e, ctx, Math.min(4.5, 1.4 + String(text).length / 30)) : null; } catch { return null; }
  }
  const SOUND_OF = { bobbin: 'duck-squeak', ember: 'toaster-pop', rolo: 'robot-chirp', dolores: 'cactus-rustle', channel: 'tv-blip' };
  const islander = (id) => { const e = game.find && game.find(id); return e && e.alive ? e : null; };
  function say(id, first) {
    const c = CAST[id], l = line(id, first);
    const entry = { id, who: c.who, topic: l.topic, text: l.text, t: Math.round(game.time * 10) / 10 };
    log.push(entry);
    if (log.length > 60) log.shift();
    if (H && H.chat && H.chat.line) H.chat.line({ kind: 'npc', who: c.who, text: l.text, color: c.color, keep: 14 });
    const e = islander(id), p = game.player;
    if (e && p && e.lookAt) { try { e.lookAt(p); } catch { /* it keeps looking where it was */ } }
    entry.gesture = gestureFor(e, l.topic === 'hello' ? 'first' : 'any', l.text);
    // Said over their head too, in their own voice (quality rule 6: a character speaks in the world, not only in a log).
    if (e && e.say) { try { e.say(l.text, Math.min(8, 2.5 + l.text.length / 18)); } catch { /* the chat line stands */ } }
    // And a sound of what they are (the site's own: runtime.js siteSound): Bobbin's horn when the harbour first greets you.
    const tag = id === 'bobbin' && first ? 'boat-horn' : SOUND_OF[id];
    try { if (tag && H && H.lib && H.lib.siteSound) { H.lib.siteSound(tag, { volume: 0.45, at: e || undefined }); if (id === 'ember' && /letter/i.test(l.text)) { H.lib.siteSound('mailbox-clank', { volume: 0.5, at: e || undefined }); game.after(0.7, () => H.lib.siteSound('letter-rustle', { volume: 0.6 })); } } } catch { /* words only */ }
    game.emit('islander', { id, who: c.who, topic: l.topic, text: l.text });
    return entry;
  }

  // ------------------------------------------------------------------ E (or the phone's button) near one
  const dist = (e, p) => Math.hypot(e.x - p.x, e.z - p.z);
  function nearest(p, reach) {
    let best = null, bd = reach;
    for (const id of ids) { const e = islander(id); if (!e) continue; const d = dist(e, p); if (d < bd) { bd = d; best = { id, d }; } }
    return best;
  }
  if (H && H.use && H.use.register) {
    H.use.register('island:talk', {
      near(p) {
        const n = game.mode === 'play' ? nearest(p, NEAR) : null;
        return n ? { label: `Talk to ${CAST[n.id].who}`, priority: 6, distance: n.d, act: () => say(n.id, false) } : null;
      },
    });
  }

  // ------------------------------------------------------------------ barks: they notice you as you pass
  // Within BARK_RANGE metres an islander turns (head and body) to the player and says one short bark in their own recorded
  // voice (public/play/audio/voice, matched by the words), captioned over their head and in the chat. Each has a pool by
  // context: `first` (the first meeting), `rod` (the rod in your hands), then the latest deed this visit (`drive`, `boom`
  // for the barrels, `fish`), else `any`. A bark is not said again within BARK_NO_REPEAT (5 minutes), and one islander
  // barks at most once in BARK_GAP. All the words are fixed (no name inside them) so each has its recording.
  const clock = () => game.time * 1000; // the game's own clock (ms), so a paused world waits
  const BARK_RANGE = 6; // meters
  const BARK_GAP = 60 * 1000;
  const BARK_NO_REPEAT = 5 * 60 * 1000;
  const BARKS = {
    bobbin: [
      ['first', 'Carry on. That is an order. It is also a suggestion.'],
      ['rod', 'That is a rod. Then you are one of mine. Cast from the very end.'],
      ['drive', 'Engine on the harbour road. A fleet, expanding.'],
      ['boom', 'That was not a gull. I am logging it anyway.'],
      ['fish', 'Fine cast. Eight out of ten. The two is for the wind, which I take personally.'],
      ['any', 'Salute optional. Appreciated, though.'],
      ['any', 'A wave just looked at me. I took it personally.'],
      ['any', 'Ships commanded: one. Ships commanded, again: one.'],
      ['any', 'Dock lamp, north side. Lit when I woke. Lit all night.'],
    ],
    ember: [
      ['first', 'A letter came for the new one, dear. It says: mind the third plank, it sticks. That is all. Sorry.'],
      ['rod', 'A rod, dear. The pier is that way. The third plank sticks. Sorry.'],
      ['drive', 'Mind the road, dear. It has been there longer than the signs. Sorry.'],
      ['boom', 'That was a loud one, dear. The chimney held. I did say there might be weather. Sorry.'],
      ['fish', 'You caught a fish, dear. The pier told me. You should eat something. Sorry.'],
      ['any', 'Rain at four. Sorry.'],
      ['any', "Dear, you've gone a funny colour. Eat something."],
      ['any', 'Sun until the wind turns. It will turn. Sorry.'],
      ['any', 'I never read them. Not twice.'],
    ],
    rolo: [
      ['first', 'huh. hi. the 4x4 is fine. mostly fine. flip it and i fix it.'],
      ['rod', 'huh. a rod. that is fine. do not hit the pier with it. mostly fine.'],
      ['drive', 'you drove it. good. one wobble, maybe two. that is fine.'],
      ['boom', 'heard that. the pad is fine. it shook a small tuesday.'],
      ['any', "huh. that's fine. that's mostly fine."],
      ['any', 'estimate: three wobbles. maybe a small tuesday.'],
      ['any', "i'm fine. just under here."],
      ['any', 'it will hold. it holds. probably it holds.'],
    ],
    dolores: [
      ['first', "I'm not lonely. The hill is just quiet. Stay."],
      ['rod', 'You have a rod. The sea is that way. I am not telling you anything.'],
      ['drive', 'I heard an engine. I did not look. It was a good engine.'],
      ['boom', 'Loud. Over by the beach, three seconds after the wind turned. I was not counting.'],
      ['fish', 'You caught a fish. A decent size. I do not care. It had a green back.'],
      ['any', 'The wind is from the east. Not that I checked.'],
      ['any', 'I do not care who comes up here. You had a long walk, though.'],
      ['any', 'People come, people go. I remember what they wore. Not that I care.'],
    ],
    channel: [
      ['first', 'Breaking: a visitor on the beach. More on this as it happens. Ratings: record.'],
      ['rod', 'Breaking: a rod, live on the beach. Sources say fishing. Ratings: record.'],
      ['drive', 'Breaking: a vehicle, in motion. Driver: you. Ratings: record.'],
      ['boom', 'Breaking: BOOM, live from the beach. Eyewitnesses: one. Ratings: record.'],
      ['fish', 'Breaking: a fish. A real one. More on this as it happens. Nothing happens. Still a record.'],
      ['any', 'Breaking: the tide is in. More on this as it happens.'],
      ['any', 'Breaking: a nap. Ratings: record.'],
      ['any', 'Stay tuned. Or do not. Ratings are a record either way.'],
      ['any', 'Breaking: the wind has changed. Details after the break. There is no break.'],
    ],
  };
  const barkLog = (window.__islanderBarks = window.__islanderBarks || []); // every bark: { id, ctx, text, clip, turned, dist, at }
  const barkState = (window.__islanderBarkState = window.__islanderBarkState || { met: {}, said: {}, last: {}, any: 0 });
  const wrapPi = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  const rodHeld = () => {
    const h = H && H.tools && H.tools.held;
    if (h && /rod/i.test(String(h.name || ''))) return true;
    const r = game.find && game.find('rod');
    return Boolean(did.rodTaken || (r && r.alive === false));
  };
  /** The contexts true now, most telling first, ending in `any`. */
  function contexts(id) {
    const out = [];
    if (!barkState.met[id]) out.push('first');
    if (rodHeld()) out.push('rod');
    const now = clock();
    const deeds = ['drive', 'boom', 'fish'].filter((k) => did.at && did.at[k] && now - did.at[k] < 4 * 60 * 1000).sort((a, b) => did.at[b] - did.at[a]);
    out.push(...deeds, 'any');
    return out;
  }
  /** The next bark for this islander: the first context with one not said in the last 5 minutes (null when all are). */
  function pickBark(id) {
    const now = clock(), pool = BARKS[id], said = (barkState.said[id] = barkState.said[id] || {});
    for (const ctx of contexts(id)) {
      const fresh = pool.filter(([c, text]) => c === ctx && !(said[text] && now - said[text] < BARK_NO_REPEAT));
      if (!fresh.length) continue;
      // The ordinary ones go round in order; a context's own line is the only one of its kind.
      const [c, text] = ctx === 'any' ? fresh[barkState.any++ % fresh.length] : fresh[0];
      return { ctx: c, text };
    }
    return null;
  }
  /** Is the islander's head where the player can see a caption over it (in the picture, above the thumbs' corners)? When the
   *  camera cannot be read (no scene yet), yes. */
  function seen(e) {
    try {
      if (window.__islanderBarkAnyView) return true; // (the engine tests have no picture to look at)
      const W = H && H.world, cam = W && W.scene && W.scene.activeCamera;
      if (!cam || !e.node || !e.node.getAbsolutePosition || !cam.getViewMatrix) return true;
      const a = e.node.getAbsolutePosition(), v = cam.getViewMatrix().m, pr = cam.getProjectionMatrix().m;
      const x = a.x, y = a.y + (e.half ? e.half[1] : 0.6) + 0.9, z = a.z;
      const vx = x * v[0] + y * v[4] + z * v[8] + v[12], vy = x * v[1] + y * v[5] + z * v[9] + v[13], vz = x * v[2] + y * v[6] + z * v[10] + v[14], vw = x * v[3] + y * v[7] + z * v[11] + v[15];
      const cx = vx * pr[0] + vy * pr[4] + vz * pr[8] + vw * pr[12], cy = vx * pr[1] + vy * pr[5] + vz * pr[9] + vw * pr[13], cw = vx * pr[3] + vy * pr[7] + vz * pr[11] + vw * pr[15];
      if (!(cw > 0.1)) return false;
      return Math.abs(cx / cw) < 0.7 && (cy / cw) < 0.85 && (cy / cw) > -0.25;
    } catch { return true; }
  }
  function bark(id) {
    const e = islander(id), p = game.player, c = CAST[id], b = pickBark(id);
    if (!e || !p || !b) return null;
    const now = clock();
    barkState.said[id][b.text] = now;
    barkState.last[id] = now;
    barkState.met[id] = true;
    (heard[id] = heard[id] || { said: [], last: -1, hello: false }).hello = true;
    // Turn to the player, head and body (the routine holds them there while the player is near).
    try { e.lookAt(p); } catch { /* the routine turns them */ }
    const gest = gestureFor(e, b.ctx, b.text);
    const want = Math.atan2(p.x - e.x, p.z - e.z);
    const turned = Boolean(e.node) && Math.abs(wrapPi((e.node.rotation.y || 0) - want)) < 0.5;
    if (H && H.chat && H.chat.line) H.chat.line({ kind: 'npc', who: c.who, text: b.text, color: c.color, keep: 14 });
    if (e.say) { try { e.say(b.text, Math.min(7, 2.5 + b.text.length / 18)); } catch { /* the chat line stands */ } }
    const clip = (H && H.lib && H.lib.recordedLine && H.lib.recordedLine(id, b.text)) || null;
    const d = Math.round(dist(e, p) * 10) / 10;
    const entry = { id, who: c.who, ctx: b.ctx, text: b.text, clip, turned, dist: d, at: now, gesture: gest };
    barkLog.push(entry);
    if (barkLog.length > 80) barkLog.shift();
    log.push({ id, who: c.who, topic: b.ctx === 'first' ? 'hello' : 'bark-' + b.ctx, text: b.text, t: Math.round(game.time * 10) / 10 });
    game.emit('bark', entry);
    game.emit('islander', { id, who: c.who, topic: 'bark', text: b.text });
    return entry;
  }
  game.every(0.5, () => {
    const p = game.player;
    if (!p || game.mode !== 'play' || (game.mirror && game.mirror.pending)) return;
    const now = clock();
    // One voice at a time: nobody barks within 3.5 s of another's.
    for (const k of Object.keys(barkState.last)) if (now - barkState.last[k] < 3500) return;
    for (const id of ids) {
      const e = islander(id);
      if (!e || dist(e, p) >= BARK_RANGE) continue;
      if (barkState.last[id] && now - barkState.last[id] < BARK_GAP) continue;
      if (!seen(e)) continue; // a caption nobody can see is no greeting: it waits until you look
      if (bark(id)) return;
    }
  });

  window.__islanders = { barks: barkLog, bark, BARKS, RANGE: BARK_RANGE, CAST: Object.fromEntries(ids.map((i) => [i, { who: CAST[i].who }])), say: (id) => say(id, false), facts, log };
})();
