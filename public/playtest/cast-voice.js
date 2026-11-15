// The `cast-voice` scenario (docs/story.md "Voices"; public/play/audio/voice/cast.json): the six islanders each have their own
// saved designed voice, their 48 key lines are the re-acted opus/webm clips (same keys), measured at -16 LUFS, and captions
// carry the speaker's name in their colour. Real input for the walk and taps; the clips are played through the engine's own
// path (`__islanders.bark` / `say`), the loudness of each clip is measured by decoding it (K-weighted, ungated approximation).
// Options: touch (true: ?touch=1, taps as touch pointers; the first voiced line must play within 1 s of its trigger).
export const CAST_VOICE = {
  id: 'cast-voice',
  title: 'Cast voices: six distinct saved voices, 48 re-acted clips at -16 LUFS, captions in the speaker\'s colour, light on a phone',
  seconds: 240,
  tags: ['full'],
  starts: ['sandbox'],
  description: 'veil, intro, mirror, then the cast config is read (cast-voice: one line per character with its saved voice id; six different ids), every re-acted clip in index.json `webm` is fetched and measured (clip-loudness per line, -16 LUFS +/- 1; webm-bytes: new voice files under 4 MB), an islander is walked up to and its first voiced line must start within 1 s of the trigger (first-voice-ms), and the chat captions show the speaker\'s name in the cast colour (caption-colour). Options: touch, watch',
};
const HP = () => window.HawkesPlay;
const G = () => HP() && HP().game;
const W = () => HP() && HP().world;

async function lufsOf(buf) {
  // BS.1770 K-weighting approximated by an offline high-shelf + high-pass, then mean square over the clip.
  const ch = buf.numberOfChannels, len = buf.length, ctx = new OfflineAudioContext(1, len, buf.sampleRate);
  const src = ctx.createBufferSource(); src.buffer = buf;
  const shelf = ctx.createBiquadFilter(); shelf.type = 'highshelf'; shelf.frequency.value = 1500; shelf.gain.value = 4;
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 38; hp.Q.value = 0.5;
  src.connect(shelf).connect(hp).connect(ctx.destination); src.start();
  const out = (await ctx.startRendering()).getChannelData(0);
  let s = 0, n = 0;
  const gate = 1e-4; // skip near-silence so pauses do not drag the figure down
  for (let i = 0; i < out.length; i++) { const v = out[i] * out[i]; if (v > gate * gate) { s += v; n++; } }
  void ch;
  return n ? -0.691 + 10 * Math.log10(s / n) : -99;
}

export async function runCastVoice(t, helpers) {
  const { setKeys, lookAt, releaseAll, touchEv, options } = helpers;
  const touch = Boolean(options && options.touch) || Boolean(HP() && HP().touchUi);
  await t.until(() => W() && W().player && G() && window.__islanders, 60000, 'the island and the islanders');
  if (window.HawkesGuest) {
    if (typeof window.HawkesGuest.playtestContinue === 'function') window.HawkesGuest.playtestContinue(); else window.HawkesGuest.accountFirst = false;
    t.event('setup-shortcut', 'account sheet lifted: the cast needs a free player (no Google sign-up in a playtest)');
  }
  const mx = document.querySelector('.mr .mr-x');
  if (mx) { mx.click(); await t.wait(400); }

  // ---- 1. The cast: six voices, six different ids.
  const cast = await (await fetch('/play/audio/voice/cast.json')).json();
  const ids = new Set();
  for (const [k, v] of Object.entries(cast.voices)) {
    const lines = cast.lines.filter((l) => l.speaker === k).length;
    ids.add(v.voiceId);
    t.event('cast-voice', `${v.name}: voice ${v.voiceId}, ${lines} re-acted lines, caption colour ${v.color}`);
  }
  if (Object.keys(cast.voices).length !== 6 || ids.size !== 6) t.problem('error', `the cast has ${ids.size} different voice ids for ${Object.keys(cast.voices).length} characters (6 needed)`);
  t.progress(0.15);

  // ---- 2. The clips: every key plays from a webm, measured.
  const index = await (await fetch('/play/audio/voice/index.json')).json();
  const webm = new Set(index.webm || []);
  const keys = cast.lines.map((l) => l.key);
  const missing = keys.filter((k) => !webm.has(k));
  if (missing.length) t.problem('error', `${missing.length} of ${keys.length} key lines are not re-recorded as webm: ${missing.slice(0, 5).join(', ')}`);
  let bytes = 0, bad = 0, ok = 0;
  const ac = new (window.AudioContext || window.webkitAudioContext)();
  for (const k of keys.filter((x) => webm.has(x))) {
    const r = await fetch(`/play/audio/voice/${k}.webm`);
    const ab = await r.arrayBuffer(); bytes += ab.byteLength;
    try {
      const l = await lufsOf(await ac.decodeAudioData(ab.slice(0)));
      const line = cast.lines.find((x) => x.key === k);
      const within = Math.abs(l + 16) <= 1;
      t.event('clip-loudness', `${k} (${cast.voices[line.speaker].voiceId}): ${l.toFixed(1)} LUFS${within ? '' : ' OUT OF RANGE'}`);
      if (within) ok++; else bad++;
    } catch (e) { bad++; t.problem('error', `${k}.webm did not decode: ${e && e.message}`); }
  }
  ac.close && ac.close();
  t.metric && t.metric('voiceBytes', bytes);
  t.event('webm-bytes', `${keys.length} clips, ${(bytes / 1024 / 1024).toFixed(2)} MB, ${ok} at -16 +/- 1 LUFS`);
  if (bytes > 4 * 1024 * 1024) t.problem('error', `new voice files total ${(bytes / 1024 / 1024).toFixed(2)} MB (limit 4 MB)`);
  if (bad) t.problem('error', `${bad} clips are not within -16 +/- 1 LUFS`);
  t.progress(0.5);

  // ---- 3. First voiced line within 1 s of its trigger, and the caption's colour.
  const canvas = document.querySelector('canvas#c, canvas');
  if (touch) { const x = innerWidth / 2, y = innerHeight * 0.3; touchEv('pointerdown', canvas, x, y, 9200); await t.wait(80); touchEv('pointerup', canvas, x, y, 9200); }
  const heardLog = [];
  G().on('voiced', (e) => heardLog.push({ at: performance.now(), ...e }));
  const order = ['pip', 'bobbin', 'ember', 'rolo', 'dolores', 'channel'];
  const pick = order.map((id) => ({ id, e: G().find(id) })).filter((x) => x.e && x.e.alive && x.id !== 'pip')
    .sort((a, b) => Math.hypot(a.e.x - W().player.x, a.e.z - W().player.z) - Math.hypot(b.e.x - W().player.x, b.e.z - W().player.z))[0];
  if (!pick) throw new Error('timed out waiting for an islander');
  const t1 = performance.now();
  while (Math.hypot(pick.e.x - W().player.x, pick.e.z - W().player.z) > 7) {
    if (performance.now() - t1 > 60000) throw new Error('timed out walking to an islander');
    try { await lookAt(t, Math.atan2(pick.e.x - W().player.x, pick.e.z - W().player.z)); } catch { /* keep walking */ }
    if (touch && helpers.stickHold) { const s = helpers.stickHold(); s.set(0, 1); await t.wait(400); s.release(); } else { setKeys({ w: true }); await t.wait(150); }
  }
  setKeys({}); releaseAll();
  const trig = performance.now();
  window.__islanders.bark(pick.id) || window.__islanders.say(pick.id);
  await t.until(() => heardLog.some((h) => h.at >= trig && h.kind === 'clip'), 4000, 'a recorded clip to start').catch(() => {});
  const h = heardLog.find((x) => x.at >= trig && x.kind === 'clip');
  const ms = h ? Math.round(h.at - trig) : null;
  t.metric && ms !== null && t.metric('firstVoiceMs', ms);
  t.event('first-voice-ms', h ? `${pick.id}: ${ms} ms from trigger to a playing clip (${h.url})` : `${pick.id}: no recorded clip played`);
  if (!h || ms > 1000) t.problem('error', h ? `the first voiced line took ${ms} ms (limit 1000)` : 'no recorded clip played for the first line');
  if (h && !/\.webm$/.test(h.url)) t.problem('error', `the first line played ${h.url}, not a re-acted webm`);
  await t.wait(1200);
  const tags = [...document.querySelectorAll('.hc-log b[data-cast], .hc-msgs b[data-cast]')];
  const colours = tags.slice(-6).map((b) => `${b.textContent}: ${getComputedStyle(b).color}`);
  t.event('caption-colour', tags.length ? colours.join('; ') : 'no coloured caption name seen in the chat');
  if (!tags.length) t.problem('error', 'no caption showed the speaker\'s name in their colour');
  t.scene('Cast voice: a caption in the speaker\'s colour');
  t.progress(1);
}
