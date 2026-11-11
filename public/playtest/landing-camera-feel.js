// The `landing-camera-feel` scenario: a fall over 1.5 m onto sand and onto the pier shows dust in the surface colour,
// a squash or knee bend, a landing sound from that surface's step set, and a camera dip that settles within 0.3 s;
// then a walk along a building wall and under the pier logs 0 camera-in-geometry frames. Real input for the walk;
// named shortcuts only for the account gate and the measured drops (lift, fall is the game's). Options: touch (true:
// ?touch=1, phone look-drag must not fight recenter), walkSec (seconds of the wall/pier walk, default 120).
export const LANDING_CAMERA_FEEL = {
  id: 'landing-camera-feel',
  title: 'Landing juice and camera: dust, squash, surface land sound and a dip under 0.3 s; 0 camera-in-geometry on a wall-and-pier walk',
  seconds: 360,
  tags: ['full'],
  starts: ['sandbox'],
  description: 'veil, intro, mirror, then a named drop over 1.5 m onto sand and onto the wooden pier (land-sand, land-wood: dust colour must differ, squash/knee bend from P.motion landDepth, surface sound, dipMs ≤ 300); then a real walk along a wall and under the pier for walkSec seconds (default 120) with camera-in-geometry at 0 (camera-clear). Run once at 1280x720 and again with touch:true at 390x844 (look-drag must not fight recenter). Options: touch (true: ?touch=1), walkSec, watch, at ("sandbox"), name, what',
};

const HP = () => window.HawkesPlay;
const W = () => HP() && HP().world;
const G = () => HP() && HP().game;
const J = () => HP() && HP().juice;

function closeGates(t) {
  if (window.HawkesGuest && typeof window.HawkesGuest.playtestContinue === 'function') {
    window.HawkesGuest.playtestContinue();
    t.event('setup-shortcut', 'account sheet closed so landing feel can begin (playtest cannot Google-sign-up)');
  } else if (window.HawkesGuest) {
    window.HawkesGuest.accountFirst = false;
    t.event('setup-shortcut', 'account gate lifted so landing feel can begin');
  }
  const mx = document.querySelector('.mr .mr-x');
  if (mx) mx.click();
}

/** Place the player at world (x,z) on the ground, facing +yaw, third-person camera behind. */
function putAt(x, z, yaw) {
  const p = W().player, g = G();
  const y = (g.terrain && g.terrain.heightAt ? g.terrain.heightAt(x, z) : 1) + 1.1;
  const local = g.planet && g.planet.round && g.planet.toLocal ? g.planet.toLocal([x, y, z]) : [x, y, z];
  const at = Array.isArray(local) ? local : [local.x, local.y, local.z];
  p.position = at; p.velocity = [0, 0, 0];
  try { if (p.node && p.node.rotation) p.node.rotation.y = yaw; } catch { /* fine */ }
  try { if (g.camera) { g.camera.yaw = yaw; g.camera.pitch = 0.32; g.camera.idleSince = performance.now(); } } catch { /* fine */ }
}

/** Drop from `height` m above the feet; the fall and landing are the game's. Returns the land info when it fires. */
async function dropLand(t, height, label) {
  const p = W().player;
  const juice = J();
  const before = juice.feel.lands || 0;
  const bursts0 = juice.fx ? juice.fx.bursts : 0;
  const steps0 = juice.sound ? juice.sound.steps : 0;
  const y0 = p.y;
  t.event('setup-shortcut', `the player lifted ${height} m for a ${label} landing (the fall is the game's)`);
  p.position = [p.x, p.y + height, p.z];
  p.velocity = [0, 0, 0];
  let land = null;
  await t.until(() => {
    if ((juice.feel.lands || 0) > before) { land = juice.feel.lastLand; return true; }
    return Boolean(p.grounded && p.y < y0 + 0.5 && (juice.feel.lands || 0) > before);
  }, 9000, `a landing on ${label}`);
  // Wait for the dip spring to settle (≤0.3 s).
  const t0 = performance.now();
  await t.until(() => {
    const L = juice.feel.lastLand;
    if (L && L.dipMs != null) { land = L; return true; }
    return performance.now() - t0 > 450;
  }, 800, 'the camera dip to settle').catch(() => {});
  land = juice.feel.lastLand || land;
  const dipMs = land && land.dipMs != null ? land.dipMs : (juice.feel.settleMs || 0);
  const surface = land && land.surface;
  const color = land && land.color;
  const dusted = Boolean(land && land.dust) || (juice.fx && juice.fx.bursts > bursts0);
  const sounded = Boolean(land && land.sound) || (juice.sound && juice.sound.steps > steps0);
  // Squash / knee bend: read P.motion().landDepth (person or model) while the land window is open. No height shortcut.
  let squash = false, depth = null, landT = null;
  try {
    const P = HP().presence;
    await t.until(() => {
      const m = P && P.motion && P.motion();
      if (!m) return false;
      landT = m.landT; depth = m.landDepth;
      if (m.take === 'land') { squash = true; return true; }
      if (Number.isFinite(m.landDepth) && m.landDepth < 0.95 && (m.landing || (m.landT != null && m.landT < 0.35))) {
        squash = true; return true;
      }
      return false;
    }, 400, `a squash / knee bend on ${label}`).catch(() => {});
  } catch { /* fine */ }
  t.event(`land-${label}`, `height=${(land && land.height || height).toFixed(2)} surface=${surface || '?'} color=${(color || []).map((c) => (+c).toFixed(2)).join(',') || '?'} dust=${dusted} sound=${sounded} squash=${squash} depth=${depth != null ? (+depth).toFixed(2) : '?'} landT=${landT != null ? (+landT).toFixed(2) : '?'} dipMs=${Math.round(dipMs)}`);
  if (!dusted) t.problem('bug', `${label}: no dust puff on a ${(land && land.height || height).toFixed(1)} m landing`);
  if (!sounded) t.problem('bug', `${label}: no landing sound on a landing over 0.5 m`);
  if (dipMs > 300) t.problem('bug', `${label}: camera dip settled in ${Math.round(dipMs)} ms (need ≤ 300)`);
  if (!squash) t.problem('bug', `${label}: no squash / knee bend on the body (depth ${depth != null ? (+depth).toFixed(2) : 'unread'})`);
  return { land, surface, color, dusted, sounded, dipMs, squash };
}

async function walkAlong(t, helpers, secs, label) {
  const { setKeys, lookAt, camYaw } = helpers;
  const stats = () => window.hawkesCameraStats || { frames: 0, inGeometry: 0 };
  const start = stats();
  const t0 = performance.now();
  let flip = 1;
  while (performance.now() - t0 < secs * 1000) {
    const p = W().player;
    if (!p) break;
    // Keep third person and nudge along +x then −x so the camera scrapes walls and the pier underside.
    try {
      const yaw = camYaw() + flip * 0.015;
      await lookAt(t, yaw).catch(() => {});
    } catch { /* fine */ }
    const yaw = camYaw(), s = Math.sin(yaw), c = Math.cos(yaw);
    const wx = flip, wz = 0.15;
    const ax = (wx * c - wz * s), ay = (wx * s + wz * c);
    const len = Math.hypot(ax, ay) || 1;
    setKeys({ w: ay / len > 0.2, s: ay / len < -0.2, d: ax / len > 0.2, a: ax / len < -0.2 });
    if ((performance.now() - t0) % 8000 < 90) flip *= -1;
    await t.wait(80);
  }
  setKeys({});
  const end = stats();
  const frames = end.frames - start.frames;
  const inside = end.inGeometry - start.inGeometry;
  t.event('camera-clear', `${label}: ${inside} camera-in-geometry frames over ${frames} frames (${secs}s)`);
  t.metric('cameraInGeometry', inside);
  t.metric('cameraFrames', frames);
  if (inside > 0) t.problem('bug', `${label}: camera was inside geometry for ${inside} frame(s)`);
  return inside;
}

export async function runLandingCameraFeel(t, helpers) {
  const { setKeys, lookAt, camYaw, holdMouse, HOOKS, options } = helpers;
  await t.until(() => W() && W().player && G() && J() && J().feel, 60000, 'the island and juice');
  closeGates(t);
  await t.wait(400);
  await holdMouse(t, 120);
  await t.wait(200);
  try { if (G().camera && G().camera.mode !== 'third') G().player && G().player.view && (G().camera.follow ? null : null); } catch { /* fine */ }
  // Prefer third person for collision checks.
  try {
    const p = W().player;
    if (p && typeof p.setView === 'function') p.setView('third');
    else if (G().camera && G().camera.mode !== undefined) { /* engine sets from config.player.view */ }
  } catch { /* fine */ }
  t.progress(0.1);

  // ---- 1. Sand landing (≥1.5 m): beach sand east of the dock crest (atBeach x~58; stay on sand, not the dirt path).
  HOOKS.atBeach(t);
  await t.wait(500);
  putAt(62, 2.5, Math.PI / 2);
  await t.wait(400);
  t.scene('Landing: before sand drop');
  const sand = await dropLand(t, 2.2, 'sand');
  if (sand.surface !== 'sand') t.problem('bug', `sand drop read surface "${sand.surface || '?'}" (wanted sand)`);
  else t.event('dust-colour', `sand puff colour ${(sand.color || []).map((c) => c.toFixed(2)).join(',') || 'default'}`);
  t.scene('Landing: sand');
  t.progress(0.25);

  // ---- 2. Pier (wood) landing
  putAt(72, -0.2, Math.PI / 2);
  await t.wait(500);
  t.scene('Landing: before pier drop');
  const wood = await dropLand(t, 2.2, 'wood');
  if (wood.surface !== 'wood') t.problem('bug', `pier drop read surface "${wood.surface || '?'}" (wanted wood)`);
  else t.event('dust-colour', `wood puff colour ${(wood.color || []).map((c) => c.toFixed(2)).join(',') || 'default'}`);
  if (sand.surface === wood.surface) {
    t.problem('bug', `sand and pier landings used the same surface "${sand.surface}" (need sand vs wood)`);
  } else {
    t.event('land-surfaces-differ', `sand=${sand.surface || '?'} wood=${wood.surface || '?'}`);
  }
  // Dust colours must differ between sand and wood (SURFACE_DUST).
  const sc = sand.color || [], wc = wood.color || [];
  if (sc.length === 3 && wc.length === 3) {
    const same = Math.hypot(sc[0] - wc[0], sc[1] - wc[1], sc[2] - wc[2]) < 0.05;
    if (same) t.problem('bug', `sand and wood dust colours match (${sc.join(',')})`);
    else t.event('dust-colours-differ', `sand=${sc.map((c) => c.toFixed(2)).join(',')} wood=${wc.map((c) => c.toFixed(2)).join(',')}`);
  }
  t.scene('Landing: pier');
  t.progress(0.4);

  // ---- 3. Camera clear: walk a wall, then under the pier (walkSec default 120 for the acceptance criterion).
  const walkSec = Math.max(20, Number(options && options.walkSec) || 120);
  async function cameraWalk(tag) {
    window.hawkesCameraStats = { frames: 0, inGeometry: 0, last: null };
    putAt(12, 4, 0);
    await t.wait(300);
    t.scene(`Camera: along the buildings (${tag})`);
    await walkAlong(t, helpers, Math.min(walkSec * 0.45, walkSec), `buildings-${tag}`);
    putAt(68, -0.2, Math.PI / 2);
    await t.wait(300);
    t.scene(`Camera: under the pier (${tag})`);
    await walkAlong(t, helpers, Math.max(20, walkSec * 0.55), `pier-${tag}`);
    const total = window.hawkesCameraStats || { inGeometry: 0, frames: 0 };
    t.event('camera-in-geometry-total', `${tag}: ${total.inGeometry} / ${total.frames}`);
    if (total.inGeometry > 0) t.problem('bug', `${tag}: camera-in-geometry counter ended at ${total.inGeometry} (need 0)`);
    return total;
  }
  await cameraWalk(options && options.touch ? 'touch' : 'desktop');
  t.progress(0.85);

  // Phone: look-drag must not be fought by recenter (idleSince refreshes while look input is held).
  if (options && options.touch) {
    const cam = G().camera;
    if (cam) {
      cam.idleSince = performance.now() - 5000;
      try {
        const input = G().input;
        if (input && input.mouse) { input.mouse.dx = 12; input.mouse.dy = 0; }
      } catch { /* fine */ }
      await t.wait(80);
      // One camera update frame consumes mouse.dx and should refresh idleSince.
      const idleFresh = cam.idleSince && (performance.now() - cam.idleSince) < 500;
      t.event('look-drag-idle', idleFresh ? 'recenter deferred while look-dragging' : 'idleSince not refreshed');
      if (!idleFresh) t.problem('bug', 'touch look-drag did not refresh camera idleSince (recenter may fight the drag)');
    }
  }
  t.scene('Camera: walk done');
  t.progress(1);
}
