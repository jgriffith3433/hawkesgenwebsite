// The `island-mix` scenario (docs/story.md "The mix"; public/play/modules/mix): the island's sound as a mastered mix.
//   1. the first tap unlocks the audio graph and it runs within 1 s (touch: a touch pointer; `audio-unlock`)
//   2. an islander's bark is placed in 3D (HRTF on a desktop, equal-power stereo on a phone): it pans left or right as the
//      camera turns, logged with its position (`voice-placed`, `pan-follows-turn`)
//   3. a voice line over a barrel blast: music down 8 dB and ambience 4 dB, back within 1 s of the line (`voice-duck`, `duck-recovered`)
//   4. the pier and the hangar each change the reverb zone (`zone-change`: open > wood > hall); the hangar is a named shortcut
//   5. the sliders: Effects 0 silences the effects bus and the voice still plays (`effects-slider`), music and voice drive theirs
//   6. the whole run is measured: integrated loudness at -16 LUFS +/- 2 and no clipped samples (`loudness`, `no-clipping`)
// Real input for the walk and the taps; named shortcuts only for the account gate, the blast (the engine's own explosion),
// standing under the pier and docking. Never starts a browser of its own. Options: touch (true: ?touch=1, taps as touch
// pointers, the phone's own checks), watch.
export const ISLAND_MIX = {
  id: 'island-mix',
  title: 'Island mix: voices cut through (music -8 dB, ambience -4 dB), sounds placed in 3D, reverb zones at the pier and the hangar, working sliders, -16 LUFS',
  seconds: 300,
  tags: ['full'],
  starts: ['sandbox'],
  description: 'veil, intro, mirror, then the first tap (audio-unlock within 1 s), an islander\'s bark placed in 3D and panning as the camera turns (voice-placed, pan-follows-turn), a voice over a barrel blast (voice-duck: music and ambience down, duck-recovered within 1 s), the pier and the hangar each changing the reverb zone (zone-change), the effects slider at 0 silencing the effects bus while the voice plays (effects-slider), and the run\'s loudness (loudness: -16 LUFS +/- 2, no-clipping). Options: touch (true: ?touch=1, taps as touch pointers; HRTF becomes stereo), watch',
};

const HP = () => window.HawkesPlay;
const W = () => HP() && HP().world;
const G = () => HP() && HP().game;
const MIX = () => window.__mix;
const db = (a, b) => 20 * Math.log10(Math.max(1e-6, a) / Math.max(1e-6, b));

export async function runIslandMix(t, helpers) {
  const { setKeys, lookAt, camYaw, releaseAll, HOOKS, touchEv, tapButton, options } = helpers;
  const touch = Boolean(options && options.touch) || Boolean(HP() && HP().touchUi);
  const canvas = () => document.querySelector('canvas#c, canvas');
  await t.until(() => W() && W().player && G() && HP().mix && window.__mix && window.__islanders, 60000, 'the island, the mix and the islanders');
  if (window.HawkesGuest) {
    if (typeof window.HawkesGuest.playtestContinue === 'function') window.HawkesGuest.playtestContinue(); else window.HawkesGuest.accountFirst = false;
    t.event('setup-shortcut', 'account sheet lifted: the mix needs a free player (no Google sign-up in a playtest)');
  }
  const mx = document.querySelector('.mr .mr-x');
  if (mx) { mx.click(); await t.wait(400); }
  const events = [];
  const g = G();
  g.on('mix-zone', (e) => { events.push(e); t.event('zone-change', `${e.from} > ${e.to} (wet ${e.wet}, tail ${e.tail} s) weights ${JSON.stringify(e.weights)}`); });
  g.on('music-dip', (d) => t.event('music-dip', `${d.owner}: music ${d.db ? '-' + d.db + ' dB' : d.level}, ambience ${d.ambienceDb ? '-' + d.ambienceDb + ' dB' : 'unchanged'}`));
  g.on('music-recover', (d) => t.event('music-recover', d.owner));

  // ---- 1. The first tap: audio starts within 1 s.
  const first = performance.now();
  if (touch) {
    const c = canvas(), id = 9100, x = innerWidth * 0.5, y = innerHeight * 0.3;
    touchEv('pointerdown', c, x, y, id); await t.wait(80); touchEv('pointerup', c, x, y, id);
    c.dispatchEvent(new Event('touchstart', { bubbles: true })); c.dispatchEvent(new Event('touchend', { bubbles: true }));
  } else {
    canvas().dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'mouse', pointerId: 1, isPrimary: true, bubbles: true, button: 0, buttons: 1, clientX: innerWidth / 2, clientY: innerHeight / 2 }));
    await t.wait(100);
    window.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'mouse', pointerId: 1, isPrimary: true, bubbles: true }));
  }
  await t.until(() => MIX().running, 4000, 'the audio graph to run after the first tap').catch(() => t.problem('error', 'the audio context was not running 4 s after the first tap'));
  const unlockMs = Math.round(performance.now() - first);
  t.metric && t.metric('audioUnlockMs', unlockMs);
  t.event('audio-unlock', `${unlockMs} ms from the first ${touch ? 'tap' : 'click'} to a running audio graph (the mix says ${MIX().unlock.ms} ms); ${MIX().model} placement`);
  if (unlockMs > 1000) t.problem('error', `audio took ${unlockMs} ms to start after the first ${touch ? 'tap' : 'click'} (limit 1000 ms)`);
  if (touch && MIX().model !== 'stereo') t.problem('error', `the phone uses ${MIX().model} placement; it should be stereo panning`);
  if (!touch && MIX().model !== 'hrtf') t.problem('warn', `desktop placement is ${MIX().model}, not HRTF`);
  const b0 = MIX().buses;
  t.event('buses', `music ${b0.music}, ambience ${b0.ambience}, voice ${b0.voice}, sfx ${b0.sfx}, ui ${b0.ui}`);
  if ([b0.music, b0.ambience, b0.voice, b0.sfx].some((v) => v === null)) t.problem('error', `a bus is missing: ${JSON.stringify(b0)}`);
  HP().mix.measure(); // the loudness run starts here
  const runStart = performance.now();
  t.scene('Mix: running');
  t.progress(0.1);

  // ---- 2. An islander's bark, placed in 3D, panning as the camera turns.
  // Stand near an islander (the beach path: a named walk would be long; the nearest one is walked to by the stick or keys).
  const ids = ['bobbin', 'ember', 'rolo', 'dolores', 'channel'];
  const who = ids.map((id) => ({ id, e: g.find(id) })).filter((x) => x.e && x.e.alive).sort((a, b) => Math.hypot(a.e.x - W().player.x, a.e.z - W().player.z) - Math.hypot(b.e.x - W().player.x, b.e.z - W().player.z))[0];
  if (!who) throw new Error('timed out waiting for an islander to talk to');
  const stick = touch ? helpers.stickHold : null;
  const near = async (e, d) => {
    const t1 = performance.now();
    for (;;) {
      const p = W().player, dx = e.x - p.x, dz = e.z - p.z, dist = Math.hypot(dx, dz);
      if (dist <= d) break;
      if (performance.now() - t1 > 60000) throw new Error('timed out walking to an islander');
      try { await lookAt(t, Math.atan2(dx, dz)); } catch { /* keep walking */ }
      if (touch && stick) { const s = stick(); s.set(0, 1); await t.wait(400); s.release(); } else { setKeys({ w: true }); await t.wait(150); }
    }
    setKeys({}); releaseAll();
  };
  await near(who.e, 7);
  // A line from them: their talk line through the engine's own voice path (recorded clip, placed at their head).
  const voiceAt = performance.now();
  const sayLine = () => { const rec = window.__islanders.bark(who.id) || window.__islanders.say(who.id); return rec; };
  const placed = () => MIX().voices.filter((v) => v.t >= voiceAt && v.who && v.who !== 'probe' && v.who !== 'juice');
  const turnTo = async (yaw) => { try { await lookAt(t, yaw); } catch { /* close enough */ } };
  const toward = Math.atan2(who.e.x - W().player.x, who.e.z - W().player.z);
  await turnTo(toward + 1.2); // the islander is to the right of the view
  const entry = sayLine();
  await t.until(() => placed().length > 0, 2500, 'the islander\'s voice to be placed').catch(() => {});
  let rec = placed().slice(-1)[0];
  if (!rec) {
    t.event('setup-shortcut', 'no recorded clip was placed: the islander\'s position played through the same placement (mix.probe)');
    rec = HP().mix.probe([who.e.x, who.e.y + 1.3, who.e.z], { who: who.id, seconds: 1.5 });
  }
  const panA = rec.pan;
  t.event('voice-placed', `${rec.who} at [${rec.at.join(', ')}], ${rec.dist} m, pan ${panA} (${rec.model})`);
  await t.wait(1400);
  await turnTo(toward - 1.2); // now to the left
  await t.wait(300);
  // The live source follows the camera: read its pan now, or place the same position again.
  const again = HP().mix.probe([who.e.x, who.e.y + 1.3, who.e.z], { who: who.id, seconds: 0.5 });
  t.event('pan-follows-turn', `before the turn pan ${panA}, after ${again.pan} (islander at [${again.at.join(', ')}], ${again.dist} m)`);
  if (!(Math.sign(panA) !== Math.sign(again.pan) && Math.abs(panA - again.pan) > 0.4)) t.problem('error', `the voice did not pan as the camera turned (${panA} then ${again.pan})`);
  t.scene('Mix: a bark placed in 3D');
  await t.wait(2500);
  t.progress(0.3);

  // ---- 3. A voice line over a barrel blast: the beds duck, then come back.
  await turnTo(toward);
  const level = () => { const l = MIX().levels; return { music: l.music, ambience: l.ambience }; };
  await t.until(() => MIX().levels.ducking.length === 0, 8000, 'the earlier voice to end').catch(() => {});
  await t.wait(1200);
  const rest = level();
  const heard = [];
  const dipSeen = new Promise((res) => g.on('music-dip', () => res(true)));
  // The line: Pip's (the engine's duck path, the same one every voice takes) with a recorded clip when there is one.
  const line = (() => { try { return window.__islanders.say(who.id) || null; } catch { return null; } })();
  await t.until(() => MIX().levels.ducking.length > 0, 3000, 'a voice to duck the beds').catch(async () => {
    t.event('setup-shortcut', 'the line had no recording to play: the voice duck asked directly (H.audio.voiceDuck), as a clip does');
    HP().audio.voiceDuck('playtest-line', true);
    setTimeout(() => HP().audio.voiceDuck('playtest-line', false), 3500);
  });
  await t.wait(650);
  HOOKS.explode(t, { ahead: 9 });
  await t.wait(400);
  const ducked = level();
  const musicDb = -db(ducked.music, rest.music), ambDb = -db(ducked.ambience, rest.ambience);
  t.event('voice-duck', `over a barrel blast: music down ${musicDb.toFixed(1)} dB (${rest.music} > ${ducked.music}), ambience down ${ambDb.toFixed(1)} dB (${rest.ambience} > ${ducked.ambience}); duck depth ${MIX().duckDb} dB`);
  t.metric && t.metric('duckMusicDb', Math.round(musicDb * 10) / 10);
  t.metric && t.metric('duckAmbienceDb', Math.round(ambDb * 10) / 10);
  if (musicDb < 6) t.problem('error', `the music ducked only ${musicDb.toFixed(1)} dB under a voice (needs 6 or more)`);
  if (ambDb < 3) t.problem('error', `the ambience ducked only ${ambDb.toFixed(1)} dB under a voice (needs about 4)`);
  t.scene('Mix: a voice over the blast');
  // The line ends (or the shortcut's does); then the beds are back within 1 s.
  await t.until(() => MIX().levels.ducking.length === 0, 12000, 'the voice to end').catch(() => {});
  const endAt = performance.now();
  await t.until(() => { const l = level(); return db(l.music, rest.music) > -1 && db(l.ambience, rest.ambience) > -1; }, 2500, 'the beds to come back').catch(() => {});
  const back = Math.round(performance.now() - endAt);
  t.event('duck-recovered', `${back} ms after the line ended: music ${level().music}, ambience ${level().ambience}`);
  t.metric && t.metric('duckRecoverMs', back);
  if (back > 1000) t.problem('error', `the beds took ${back} ms to come back after the line (limit 1000 ms)`);
  void heard; void dipSeen; void line;
  t.progress(0.5);

  // ---- 4. Spaces: the pier (a real walk onto it, then under it) and the hangar.
  const z0 = MIX().zone;
  const east = async (x) => {
    const t1 = performance.now();
    for (;;) {
      const p = W().player, dx = x - p.x;
      if (Math.abs(dx) < 3) break;
      if (performance.now() - t1 > 80000) throw new Error('timed out walking to the pier');
      try { await lookAt(t, dx > 0 ? Math.PI / 2 : -Math.PI / 2); } catch { /* keep going */ }
      if (touch && stick) { const s = stick(); s.set(0, 1); await t.wait(450); s.release(); } else { setKeys({ w: true }); await t.wait(150); }
    }
    setKeys({}); releaseAll();
  };
  await east(72);
  await t.until(() => MIX().zone === 'wood', 4000, 'the wooden echo on the pier').catch(() => t.problem('error', `walking onto the pier left the reverb in ${MIX().zone}`));
  t.scene('Mix: on the pier (wooden echo)');
  await t.wait(1500);
  // Under the deck: a named shortcut (swimming under it is not a thing the bot can steer).
  const pe = g.find('pier');
  if (pe) {
    const p = W().player;
    p.position = [pe.x, pe.y - 1.6, pe.z]; p.velocity = [0, 0, 0];
    t.event('setup-shortcut', 'the player put under the pier\'s deck (the underside echo)');
    await t.wait(800);
    t.event('zone-under-pier', `zone ${MIX().zone}, pier weight ${MIX().raw.pier.toFixed(2)}`);
    if (MIX().raw.pier < 0.95) t.problem('error', `under the pier the wooden zone is only ${MIX().raw.pier.toFixed(2)}`);
    // A clap of sound under the deck, to hear the echo in the capture.
    HP().mix.probe([pe.x, pe.y - 1.6, pe.z + 2], { who: 'echo-test', bus: HP().audio.effects, freq: 220, seconds: 0.25, gain: 0.3 });
    await t.wait(1800);
  }
  HOOKS.explode(t, { ahead: 5 }); await t.wait(2200); // a blast in the wooden room
  t.progress(0.65);
  try {
    await HOOKS.dock(t);
    await t.until(() => MIX().zone === 'hall', 6000, 'the hangar\'s hall reverb');
    t.scene('Mix: in the hangar (big hall)');
    await t.wait(1200);
    HOOKS.explode(t, { ahead: 5 }); await t.wait(3000); // a boom in the hall
  } catch (err) {
    t.problem('error', `the hangar did not change the reverb: ${err && err.message}`);
  }
  const zones = MIX().zoneChanges.map((c) => `${c.from}>${c.to}`);
  t.event('zones-seen', zones.join(', ') || 'none');
  for (const need of ['wood', 'hall']) if (!MIX().zoneChanges.some((c) => c.to === need)) t.problem('error', `no reverb zone change to "${need}" (${zones.join(', ') || 'none'})`);
  void z0;
  t.progress(0.8);

  // ---- 5. The sliders: effects 0 silences the effects bus, not the voice.
  const GM = HP().gameMenu;
  if (touch) {
    const btn = document.querySelector('[data-game-menu] .more, .gs-acts .more, #gm-open, .gm-open');
    if (btn) { await tapButton(t, btn); await t.wait(500); t.event('menu-tapped', 'the ☰ opened with a touch pointer'); }
  }
  GM.set({ effects: 0, voice: 1, music: 1, master: 1 });
  await t.wait(400);
  const A = HP().audio, lv = MIX().levels;
  t.event('effects-slider', `Effects 0: sfx bus ${lv.sfx}, voice bus ${lv.voice}, music bus ${lv.music}; effects setting ${lv.effectsSetting}`);
  if (lv.sfx !== 0) t.problem('error', `Effects 0 left the sfx bus at ${lv.sfx}`);
  if (!(lv.voice > 0.5)) t.problem('error', `Effects 0 silenced the voice bus (${lv.voice})`);
  const vAt = performance.now();
  try { window.__islanders.say(who.id); } catch { /* fine */ }
  await t.wait(600);
  t.event('voice-with-effects-off', `${MIX().voices.filter((v) => v.t >= vAt).length} voice(s) placed while Effects is 0; ducking ${MIX().levels.ducking.length}`);
  GM.set({ music: 0.4, voice: 0.5 });
  await t.wait(500);
  const l2 = MIX().levels;
  t.event('sliders-drive-buses', `music ${l2.musicSetting} > music bus ${l2.music}, voice ${l2.voiceSetting} > voice bus ${l2.voice}`);
  if (!(Math.abs(l2.voice - 0.5) < 0.02)) t.problem('error', `the voice slider (0.5) left the voice bus at ${l2.voice}`);
  if (touch) {
    const ranges = [...document.querySelectorAll('.gm-row input[type=range]')].filter((r) => /music|effects|voice/i.test(r.getAttribute('aria-label') || ''));
    const small = ranges.filter((r) => { const b = r.getBoundingClientRect(); return b.height < 44 || b.width < 120; });
    t.event('slider-size', `${ranges.length} sliders, ${small.length} under 44 px tall`);
    if (ranges.length && small.length) t.problem('error', `${small.length} volume sliders are smaller than a thumb`);
  }
  GM.set({ effects: 1, voice: 1, music: 1, master: 1 });
  await t.wait(600);

  // ---- 6. The run's loudness.
  const secs = (performance.now() - runStart) / 1000;
  if (secs < 120) { t.event('measuring', `${Math.round(120 - secs)} s more for a 2-minute capture`); HOOKS.explode(t, { ahead: 9 }); await t.wait((120 - secs) * 1000); }
  const m = MIX().lufs;
  t.metric && t.metric('lufsIntegrated', Math.round(m.integrated * 10) / 10);
  t.metric && t.metric('peakDb', m.peakDb);
  t.event('loudness', `${m.integrated.toFixed(1)} LUFS integrated over ${Math.round((performance.now() - runStart) / 1000)} s (short-term ${m.shortTerm.toFixed(1)}, makeup ${m.makeupDb} dB), peak ${m.peakDb} dBFS`);
  if (!Number.isFinite(m.integrated) || Math.abs(m.integrated + 16) > 2) t.problem('error', `integrated loudness ${Number.isFinite(m.integrated) ? m.integrated.toFixed(1) : 'none'} LUFS, wanted -16 +/- 2`);
  t.event('no-clipping', `${m.clipped} samples at or over 0.999 (peak ${m.peakDb} dBFS)`);
  if (m.clipped > 0) t.problem('error', `${m.clipped} clipped samples in the capture`);
  t.scene('Mix: measured');
  t.progress(1);
}
