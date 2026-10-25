// The Overseer's speech desk (J: "everything the Overseer says is a line in the one chat window and a voice clip when one
// exists. Make the experience good"). Every Overseer line, whoever asks (overseer.say / speak, the first-time lines, the
// mirror, the tour, talk, the sandbox's guest), goes through here, one at a time:
//
//   H.speech.say({ text, voice, priority, owner, seconds, action, keep, onEnd })   asks for a line; { id }
//       voice: a clip's name (overseer.js VOICES, or a game's own sound) or null; priority: 'low' | 'normal' | 'important'
//   H.speech.replay()           the last line said, again (the chat's ⟲ button)
//   H.speech.hold(owner, on)    only lines of `owner` are said while held (the intro keeps the desk to itself)
//   H.speech.clear(owner?)      drops what waits (and stops what is said) for the owner, or all
//   H.speech.settings           { captions, voice, music }: captions on/off, voice and music volume 0..1, kept per device
//   H.speech.set(part)          changes them (the chat's ⚙ panel and the editor's menu do)
//   H.speech.current, .busy, .waiting, .last, .log
//   H.speech.clip(text, name)   a line's words and its clip, so the assistant's reply that says the same words is spoken
//
// Rules: lines never overlap. A later line of the same or lower priority waits its turn (a low one gives up after 20 s,
// a normal one after 45 s). An important one (the answer to what you typed, the mirror's questions, the intro) cuts in
// gently: the voice fades under a quarter second, the words that were showing finish at once, then it speaks. A line is
// as long as its voice clip, else as long as it takes to read; its words type out over that time (chat.js `reveal`).
// Captions: with `captions` on every line is shown. Off, a line is hidden only while its voice is really being heard
// (a clip exists, the voice is up, sound is running): with sound off, muted or no clip, it is always shown.
(function () {
  'use strict';
  const H = window.HawkesPlay;
  if (!H || H.speech) return;
  const KEY = 'hg_overseer_speech';
  const PRI = { low: 0, normal: 1, important: 2 };
  const STALE = [20, 45, 90]; // seconds a line waits, by priority
  const GAP = 0.3; // seconds of quiet after a line, before the next (part of its slot)
  const FADE = 0.25; // an interrupted voice fades out this fast
  const MAX_WAIT = 8;

  const clamp01 = (v, d) => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : d; };
  const store = {
    get() { try { return window.localStorage.getItem(KEY); } catch { return null; } },
    set(v) { try { window.localStorage.setItem(KEY, v); } catch { /* a sandboxed page: the editor keeps it and tells us */ } },
  };
  const settings = { captions: true, voice: 1, music: 1 };
  function apply() {
    if (H.audio) { try { H.audio.voiceVolume = settings.voice; H.audio.musicVolume = settings.music; } catch { /* no audio */ } }
  }
  function load() {
    let m = {};
    try { m = JSON.parse(store.get() || '{}') || {}; } catch { m = {}; }
    settings.captions = m.captions !== false;
    settings.voice = clamp01(m.voice, 1);
    settings.music = clamp01(m.music, 1);
  }
  load();

  const desk = {
    clock: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000,
  };
  /** How long a line takes to read (and to say): about 2.4 s and a bit for each word. */
  const readFor = (text) => 1 + String(text).split(/\s+/).length * 0.3;

  const queue = []; // waiting items
  const holds = new Set();
  const clips = new Map(); // words -> clip name
  const log = []; // what was said, newest last (kept short): { id, text, voice, caption, priority, at, ended, interrupted }
  let cur = null; // the line being said: { item, startedAt, endsAt, audio, caption, voiced, rec, fading }
  let last = null; // the last item delivered (replay)
  let seq = 0;

  const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const emit = (ev, d) => { try { if (H.game) H.game.emit(ev, d); } catch (err) { H.report(err, 'speech'); } };

  /** Whether the voice would really be heard right now: a clip exists, the voice is up and sound runs. */
  function audible(item) {
    // (A voice playing on its own over several lines, the intro's: `external`.)
    if (item.external) return settings.voice > 0 && !(H.audio && H.audio.context && !H.audio.running);
    if (!item.voice || settings.voice <= 0) return false;
    if (!item.url) return false;
    if (typeof Audio === 'undefined') return false;
    if (H.audio && H.audio.context && !H.audio.running) return false;
    return true;
  }

  function show(item, secs) {
    if (!H.chat) return null;
    return H.chat.line({ ...item.m, text: item.text, kind: 'overseer', now: true, reveal: secs, keep: Math.max(14, Number(item.keep) || 0, secs + 6), action: item.action || item.m.action });
  }

  function begin(item) {
    const t = desk.clock();
    const url = item.voice && H.overseer && H.overseer.voiceUrl ? H.overseer.voiceUrl(item.voice) : null;
    item.url = url;
    const voiced = audible(item);
    const own = voiced && !item.external;
    // (The assistant's reply spoken by a clip has its words in the editor already: noCaption.)
    const caption = !item.noCaption && !(voiced && !settings.captions);
    const read = Math.max(Number(item.seconds) || 0, readFor(item.text));
    const rec = { id: item.id, text: item.text, voice: item.voice || null, caption, voiced, priority: item.pri, at: t, ended: null, interrupted: false, seconds: read };
    cur = { item, startedAt: t, endsAt: t + read + GAP, audio: null, caption, voiced, rec };
    last = item;
    log.push(rec);
    if (log.length > 40) log.shift();
    if (own && H.overseer && H.overseer.voice) {
      const a = H.overseer.voice(item.voice);
      if (a) {
        cur.audio = a;
        a.addEventListener('loadedmetadata', () => {
          if (cur && cur.audio === a && Number.isFinite(a.duration) && a.duration > 0) {
            const d = Math.max(a.duration + 0.2, 1);
            cur.endsAt = cur.startedAt + d + GAP; rec.seconds = d;
            if (cur.el && cur.el._retime) cur.el._retime(d);
          }
        });
        a.addEventListener('ended', () => { if (cur && cur.audio === a) cur.endsAt = Math.min(cur.endsAt, desk.clock() + GAP); pump(); });
        // A voice that won't play: the words carry it, as with no voice (and are shown).
        const fail = () => { if (cur && cur.audio === a) { cur.audio = null; cur.voiced = false; rec.voiced = false; if (!cur.caption) { cur.caption = true; rec.caption = true; cur.el = show(item, Math.max(0, cur.endsAt - desk.clock())); } } };
        a.addEventListener('error', fail);
        if (typeof a.volume === 'number' && !(H.audio && H.audio.voice)) a.volume = settings.voice;
        try { const pr = a.play(); if (pr && pr.catch) pr.catch(fail); } catch { fail(); }
        if (Number.isFinite(a.duration) && a.duration > 0) { cur.endsAt = t + Math.max(a.duration + 0.2, 1) + GAP; rec.seconds = cur.endsAt - t - GAP; }
      } else { cur.voiced = false; rec.voiced = false; cur.caption = true; rec.caption = true; }
    }
    if (item.noCaption && !voiced) cur.endsAt = t;
    if (cur.caption) cur.el = show(item, cur.endsAt - t);
    emit('overseer-speech', { state: 'start', id: item.id, text: item.text, voice: item.voice || null, caption: cur.caption, voiced: cur.voiced, priority: item.pri, seconds: rec.seconds });
  }

  function finish(why) {
    const c = cur;
    if (!c) return;
    cur = null;
    c.rec.ended = desk.clock();
    c.rec.interrupted = why === 'interrupted';
    if (c.el && c.el._finish) c.el._finish();
    const a = c.audio;
    if (a) {
      if (why === 'interrupted' || why === 'cleared') fadeOut(a); // (a clip that ended says nothing more)
    }
    emit('overseer-speech', { state: 'end', id: c.item.id, text: c.item.text, interrupted: why === 'interrupted', cleared: why === 'cleared' });
    try { if (c.item.onEnd) c.item.onEnd(why || 'ended'); } catch (err) { H.report(err, 'speech'); }
  }

  /** A voice fades out under a quarter second, then stops. */
  function fadeOut(a) {
    try {
      const v0 = typeof a.volume === 'number' ? a.volume : 1;
      let n = 0;
      const steps = 5;
      const iv = setInterval(() => {
        n++;
        try { if (!(H.audio && H.audio.voice)) a.volume = Math.max(0, v0 * (1 - n / steps)); } catch { /* fine */ }
        if (n >= steps) { clearInterval(iv); try { a.pause(); } catch { /* gone */ } }
      }, FADE * 1000 / steps);
      if (H.audio && H.audio.voice && H.audio.context) {
        const g = H.audio.voice.gain, ctx = H.audio.context;
        // (Gently down on the voice's own level; the next line brings it back to the player's setting.)
        g.cancelScheduledValues(ctx.currentTime); g.setTargetAtTime(0, ctx.currentTime, FADE / 3);
        setTimeout(() => { try { g.cancelScheduledValues(ctx.currentTime); g.value = settings.voice; } catch { /* fine */ } }, FADE * 1000 + 50);
      }
    } catch { try { a.pause(); } catch { /* gone */ } }
  }

  function allowed(item) { return !holds.size || holds.has(item.owner); }

  function pump() {
    const t = desk.clock();
    for (let i = queue.length - 1; i >= 0; i--) if (t - queue[i].at > STALE[queue[i].pri]) { const [d] = queue.splice(i, 1); try { if (d.onEnd) d.onEnd('dropped'); } catch { /* fine */ } }
    if (cur && t >= cur.endsAt) finish('ended');
    const ready = queue.filter(allowed);
    if (!ready.length) return;
    ready.sort((a, b) => b.pri - a.pri || a.at - b.at);
    const next = ready[0];
    if (cur) {
      // The important cut in, gently; the rest wait.
      if (next.pri > cur.item.pri) finish('interrupted'); else return;
    }
    queue.splice(queue.indexOf(next), 1);
    begin(next);
  }

  function say(o) {
    o = o || {};
    const text = String(o.text === undefined || o.text === null ? '' : o.text).trim().slice(0, 600);
    if (!text) return null;
    const key = norm(text);
    // The same words twice in a moment are said once (a line and its voice both asking).
    if (cur && norm(cur.item.text) === key && desk.clock() - cur.startedAt < 4) return { id: cur.item.id, duplicate: true };
    const dup = queue.find((q) => norm(q.text) === key);
    if (dup) { dup.pri = Math.max(dup.pri, PRI[o.priority] ?? 1); return { id: dup.id, duplicate: true }; }
    const pri = typeof o.priority === 'number' ? Math.max(0, Math.min(2, o.priority | 0)) : PRI[o.priority] ?? 1;
    if (o.voice && typeof o.voice === 'string') clips.set(key, o.voice);
    const item = { id: ++seq, noCaption: o.caption === false, external: Boolean(o.external), text, voice: o.voice || (clips.get(key) || null), pri, owner: o.owner || null, seconds: o.seconds, keep: o.keep, action: o.action || null, onEnd: o.onEnd || null, at: desk.clock(), m: o.m || {} };
    if (queue.length >= MAX_WAIT) {
      // Make room: the lowest, oldest goes (the new one may be it).
      const worst = queue.reduce((w, q) => (q.pri < w.pri || (q.pri === w.pri && q.at < w.at) ? q : w), queue[0]);
      if (worst.pri > pri) return null;
      queue.splice(queue.indexOf(worst), 1);
      try { if (worst.onEnd) worst.onEnd('dropped'); } catch { /* fine */ }
    }
    queue.push(item);
    pump();
    return { id: item.id };
  }

  function replay() {
    if (!last) return false;
    const l = last;
    say({ text: l.text, voice: l.voice, priority: 'important', owner: holds.size ? [...holds][0] : null, action: l.action, m: l.m, replay: true });
    return true;
  }

  function set(part) {
    part = part || {};
    if ('captions' in part) settings.captions = Boolean(part.captions);
    if ('voice' in part) settings.voice = clamp01(part.voice, settings.voice);
    if ('music' in part) settings.music = clamp01(part.music, settings.music);
    store.set(JSON.stringify(settings));
    apply();
    // The voice being said: louder or quieter at once; a caption that was hidden shows now (captions turned on).
    if (cur && cur.audio && !(H.audio && H.audio.voice)) { try { cur.audio.volume = settings.voice; } catch { /* fine */ } }
    if (cur && !cur.caption && (settings.captions || !audible(cur.item))) { cur.caption = true; cur.rec.caption = true; cur.el = show(cur.item, Math.max(0.5, cur.endsAt - desk.clock())); }
    emit('overseer-speech', { state: 'settings', ...settings });
    return { ...settings };
  }

  H.hooks.frame.push(() => { try { pump(); } catch (err) { H.report(err, 'speech'); } });
  // A tab in the background has no frames: a timer keeps the queue moving.
  const iv = setInterval(() => { try { pump(); } catch (err) { H.report(err, 'speech'); } }, 250);
  if (iv && iv.unref) iv.unref();

  // The editor's page: its settings (the frame has no storage), a replay, and the assistant's reply (spoken only if the
  // Overseer has a clip with those very words; the editor shows the caption itself).
  if (typeof window.addEventListener === 'function') {
    window.addEventListener('message', (e) => {
      const m = e.data || {};
      if (e.source !== window.parent) return;
      if (m.type === 'speech-settings') set(m);
      else if (m.type === 'speech-replay') replay();
      else if (m.type === 'assistant-reply') { const v = clips.get(norm(m.text)); if (v) say({ text: m.text, voice: v, priority: 'normal', owner: null, caption: false }); }
    });
  }
  H.hooks.world.push({
    enter() { apply(); },
    leave() { desk.clear(); },
  });

  desk.clear = (owner) => {
    for (let i = queue.length - 1; i >= 0; i--) if (!owner || queue[i].owner === owner) { const [d] = queue.splice(i, 1); try { if (d.onEnd) d.onEnd('cleared'); } catch { /* fine */ } }
    if (cur && (!owner || cur.item.owner === owner)) finish('cleared');
  };

  Object.assign(desk, {
    PRI, STALE, GAP, readFor,
    say, replay, set, pump,
    settings,
    reload: load,
    /** Forgets everything said and waiting (tests, a new world). */
    reset() { queue.length = 0; log.length = 0; holds.clear(); cur = null; last = null; },
    hold(owner, on = true) { if (on) holds.add(String(owner)); else holds.delete(String(owner)); pump(); return holds.size > 0; },
    clip(text, name) { if (text && name) clips.set(norm(text), name); },
    clips: (text) => clips.get(norm(text)) || null,
    log,
  });
  // (Live getters: Object.assign would copy what they say now.)
  Object.defineProperties(desk, {
    current: { get: () => (cur ? { id: cur.item.id, text: cur.item.text, voice: cur.item.voice, priority: cur.item.pri, caption: cur.caption, voiced: cur.voiced, endsAt: cur.endsAt } : null) },
    busy: { get: () => Boolean(cur) || queue.length > 0 },
    waiting: { get: () => queue.map((q) => q.text) },
    last: { get: () => (last ? { text: last.text, voice: last.voice } : null) },
  });
  H.speech = desk;
  apply();
})();
