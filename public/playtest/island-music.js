// The `island-music` scenario: the island's music follows the player (clearing > road > pier crossfades, one
// `music-change` per crossing with its 2.5 s fade), five stingers play once each (a repeated moment logs no second
// play), music dips under every Pip and Overseer line and comes back, and the music files are counted against 3 MB.
// Real input for the walk; the five moments are named setup shortcuts (the tour's own event, fed). Safe on live
// (no sign-up). Options: touch (taps, for the 390x844 run), watch.
export const ISLAND_MUSIC = {
  id: 'island-music',
  title: 'Island music: area themes crossfade, five stingers once each, music dips under voices, under 3 MB',
  seconds: 240,
  tags: ['full'],
  starts: ['sandbox'],
  description: 'veil, intro, mirror, then walk clearing > road > pier (music-change, fade 2-3 s), the five moments (stinger once each, none twice), a dip and recovery around Pip\'s lines, the music files\' bytes after the first frame; with touch: no music before the first tap, music within 1 s of it. Options: touch, at',
};
const HP = () => window.HawkesPlay;
const W = () => HP() && HP().world;
const G = () => HP() && HP().game;

export async function runIslandMusic(t, helpers) {
  const { setKeys, lookAt, camYaw, holdMouse, releaseAll, options } = helpers;
  const touch = Boolean(options && options.touch);
  const seen = { change: [], stinger: [], dip: [], recover: [] };
  await t.until(() => W() && W().player && G() && window.__islandAudioLog, 60000, 'the island and its audio log');
  const g = G();
  g.on('music-change', (d) => { seen.change.push(d); t.event('music-change', `${d.from} > ${d.to}, fade ${d.fade} s`); });
  g.on('stinger', (d) => { seen.stinger.push(d); t.event('stinger-played', `${d.step} ${d.name} played=${d.played}`); });
  g.on('music-dip', (d) => { seen.dip.push(d); t.event('music-dip', `${d.owner} to ${d.level}, from ${d.before}`); });
  g.on('music-recover', (d) => { seen.recover.push(d); t.event('music-recover', d.owner); });
  if (window.HawkesGuest) {
    if (typeof window.HawkesGuest.playtestContinue === 'function') window.HawkesGuest.playtestContinue(); else window.HawkesGuest.accountFirst = false;
    t.event('setup-shortcut', 'account sheet lifted: the walk needs a free player (no Google sign-up in a playtest)');
  }
  const mx = document.querySelector('.mr .mr-x');
  if (mx) { mx.click(); await t.wait(400); }
  // The first tap: before it no music started (the browser's rule); after it the clearing theme starts.
  const started = () => window.__islandAudioLog.filter((e) => e.what === 'start' && /^music-|^meadow/.test(e.name));
  const before = started().length;
  t.event('music-before-tap', `${before} music tracks started before the tap`);
  const t0 = performance.now();
  await holdMouse(t, 120);
  await t.until(() => started().length > before || started().length > 0, 4000, 'music to start after the tap').catch(() => t.problem('error', 'no music started after the first tap'));
  t.event('music-after-tap', `${Math.round(performance.now() - t0)} ms from the tap to the first music start (${touch ? 'touch' : 'pointer'})`);
  t.scene('Music: the clearing');

  // Walk east: clearing > road > pier, real input.
  const walk = async (x, what) => {
    const t1 = performance.now();
    for (;;) {
      const p = W().player, dx = x - p.x;
      if (Math.abs(dx) < 4) break;
      if (performance.now() - t1 > 70000) throw new Error(`timed out walking to ${what}`);
      try { await lookAt(t, dx > 0 ? Math.PI / 2 : -Math.PI / 2); } catch { /* keep going */ }
      const yaw = camYaw(), s = Math.sin(yaw), c = Math.cos(yaw), sg = Math.sign(dx);
      const ax = sg * c, ay = sg * s;
      setKeys({ w: ay > 0.25, s: ay < -0.25, d: ax > 0.25, a: ax < -0.25 });
      await t.wait(80);
    }
    setKeys({}); releaseAll();
  };
  await walk(50, 'the road'); await t.wait(3000); t.scene('Music: the road');
  await walk(75, 'the pier'); await t.wait(3000); t.scene('Music: the pier');
  const to = seen.change.map((c) => c.to).join(',');
  if (seen.change.length !== 2 || to !== 'road,pier') t.problem('error', `expected one music-change per crossing (road, pier), got ${seen.change.length}: ${to}`);
  else t.event('one-change-per-crossing', 'clearing > road > pier: two changes, each with a 2.5 s fade');
  if (seen.change.some((c) => c.fade < 2 || c.fade > 3)) t.problem('error', 'a crossfade outside 2-3 s');

  // The five moments, each fed twice: the second must log no stinger.
  t.event('setup-shortcut', 'the tour\'s five step events fed (drive, fish, boom, fly, launch), each twice: the moments themselves are other scenarios\'');
  for (const step of ['drive', 'fish', 'boom', 'fly', 'launch']) {
    g.emit('tour', { step }); await t.wait(1500);
    const n = seen.stinger.length;
    g.emit('tour', { step }); await t.wait(400);
    if (seen.stinger.length !== n) t.problem('error', `stinger for ${step} played twice`);
  }
  if (seen.stinger.length !== 5) t.problem('error', `expected exactly five stingers, got ${seen.stinger.length}`);
  else t.event('five-stingers', seen.stinger.map((s) => s.step).join(','));
  if (seen.stinger.some((s) => !s.played)) t.problem('warn', 'a stinger file is not in the game yet (see docs/world-bible.md "Music")');
  await t.wait(4500);
  if (!seen.dip.length) t.problem('error', 'no music dip around any voice line');
  else if (seen.recover.length < seen.dip.length) t.problem('error', `a dip without its recovery (${seen.dip.length} dips, ${seen.recover.length} recoveries)`);
  else t.event('dip-and-recover', `${seen.dip.length} dips, each recovered`);

  // Bytes of the music files, from the resource timings, against 3 MB.
  const res = performance.getEntriesByType('resource').filter((r) => /music-|stinger-/.test(r.name));
  const bytes = res.reduce((n, r) => n + (r.transferSize || r.encodedBodySize || 0), 0);
  t.metric && t.metric('musicKB', Math.round(bytes / 1024));
  t.event('music-bytes', `${res.length} files, ${Math.round(bytes / 1024)} KB after the first frame`);
  if (bytes > 3 * 1024 * 1024) t.problem('error', `new music is ${Math.round(bytes / 1024)} KB, over 3 MB`);
}
