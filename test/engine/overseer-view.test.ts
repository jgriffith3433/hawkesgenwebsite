// The Overseer must be findable from spawn: about 15 degrees wide, ahead of where the start faces and low enough to be
// on screen without looking up; hazy by day but never lost against the sky; and still drawn when the far layer fails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, world } from './harness.ts';
import { TEMPLATES } from '../../src/templates.ts';
import { OVERSEER_GAMES } from '../../src/overseer-games/index.ts';

const H = await load();
const DEG = 180 / Math.PI;
const sceneOf = (id: string) => JSON.parse(TEMPLATES.find((t) => t.id === id)!.files('Mine')['scene.json']);

/** (No screen here, so the far layer is never placed for a view: the stand-in is the same picture, placed every frame.) */
const standIn = () => { H.world._sky.bg = { rtt: null, layer: null, add() {}, remove() {}, has() { return false; } }; H.tick(0.5); };
/** Where the ship is drawn as seen from the player's eye: bearing off the way they face, elevation, apparent diameter (degrees). */
function seen() {
  const O = H.overseer._;
  const cam = H.world.scene.activeCamera;
  const eye = cam.globalPosition;
  const hull = H.world.scene.getMeshByName('ov-hull-far');
  hull.computeWorldMatrix(true);
  const c = hull.getAbsolutePosition();
  const dx = c.x - eye.x, dy = c.y - eye.y, dz = c.z - eye.z;
  const dist = Math.hypot(dx, dy, dz);
  const yaw = H.world.camera.yaw;
  let bearing = Math.atan2(dx, dz) - yaw;
  bearing = Math.atan2(Math.sin(bearing), Math.cos(bearing));
  const r = H.overseer.radius * hull.scaling.x;
  return { bearing: bearing * DEG, elevation: Math.atan2(dy, Math.hypot(dx, dz)) * DEG, diameter: 2 * Math.asin(Math.min(1, r / dist)) * DEG, dist, enabled: hull.isEnabled(), reach: cam.maxZ, O };
}

for (const id of ['sandbox', 'planet', 'blank']) {
  test(`${id}: from spawn the Overseer is ahead, about 15 degrees wide and on screen without turning`, () => {
    world(H, sceneOf(id));
    H.tick(1);
    standIn();
    const v = seen();
    assert.ok(v.enabled, 'drawn');
    assert.ok(v.diameter > 12 && v.diameter < 18, `about 15 degrees wide (${v.diameter.toFixed(1)})`);
    assert.ok(Math.abs(v.bearing) < 25, `ahead of the start (${v.bearing.toFixed(1)} off)`);
    // The camera's vertical field is 1.0 rad (57 degrees) level at spawn: the whole disc fits inside, or all but its top edge.
    assert.ok(v.elevation - v.diameter / 2 > 3 && v.elevation < 28, `in view without looking up (${v.elevation.toFixed(1)})`);
  });
}

test('the featured games face the default Overseer', () => {
  for (const t of OVERSEER_GAMES) {
    world(H, JSON.parse(t.files('Mine')['scene.json']));
    H.tick(1);
    standIn();
    const v = seen();
    assert.ok(Math.abs(v.bearing) < 40, `${t.id}: ahead (${v.bearing.toFixed(1)})`);
  }
});

test('without a far layer a visible stand-in sphere is drawn, of the same size on screen', () => {
  world(H, sceneOf('planet'));
  H.tick(1);
  const O = H.overseer._;
  assert.equal(O.farOk(), true, 'a far layer to begin with');
  // A far layer that was made without its render target or layer (it failed) counts as none.
  const s = H.world._sky;
  const kept = s.bg;
  s.bg = { rtt: null, layer: null, add() {}, remove() {}, has() { return false; } };
  try {
    H.tick(0.5);
    assert.equal(O.farOk(), false);
    const w = seen();
    const v = { diameter: 2 * Math.asin(H.overseer.radius / Math.hypot(...H.overseer.position.map((x: number, i: number) => x - [H.world.camera.cam.globalPosition.x, H.world.camera.cam.globalPosition.y, H.world.camera.cam.globalPosition.z][i]))) * DEG, elevation: 0, bearing: 0 };
    assert.ok(w.enabled && w.dist < w.reach, `the hull is on, inside the camera reach (${w.dist.toFixed(0)} < ${w.reach})`);
    assert.ok(H.world.scene.getMeshByName('ov-halo').isEnabled(), 'and its halo');
    assert.ok(Math.abs(w.diameter - v.diameter) < 0.5, `same size on screen (${w.diameter.toFixed(1)} vs ${v.diameter.toFixed(1)})`);
  } finally { s.bg = kept; }
});

test('haze never takes it below a minimum contrast against the sky, and the halo pulses', () => {
  const O = H.overseer._;
  const B = H.B || (globalThis as any).BABYLON;
  const C = (r: number, g: number, b: number) => new B.Color3(r, g, b);
  assert.ok(O.HAZE_MAX <= 0.5);
  for (const hor of [C(0.62, 0.78, 0.92), C(0.9, 0.95, 1), C(0.2, 0.25, 0.4), C(0.95, 0.6, 0.35)]) {
    const seenColor = O.hullSeen(C(0.93, 0.945, 0.965), O.HAZE_MAX, 0, hor);
    assert.ok(Math.abs(O.lum(seenColor) - O.lum(hor)) >= 0 && Number.isFinite(O.lum(seenColor)));
  }
  world(H, sceneOf('planet'));
  standIn();
  H.game.sky.hour = 'noon';
  const halo = H.world.scene.getMeshByName('ov-halo');
  const sizes = new Set<number>();
  for (let i = 0; i < 20; i++) { H.tick(0.4); sizes.add(Math.round(halo.scaling.x * 1000)); }
  assert.ok(sizes.size > 5, 'the halo breathes');
  const hull = H.world.scene.getMeshByName('ov-hull-far').material;
  const hor = H.sky.horizon;
  const shown = O.lum(hull.emissiveColor) + O.lum(hull.diffuseColor) * 0.5;
  assert.ok(Math.abs(shown - O.lum(hor)) >= 0.05, `a daytime disc still differs from the sky (${shown.toFixed(2)} vs ${O.lum(hor).toFixed(2)})`);
});
