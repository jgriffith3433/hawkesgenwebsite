// Ground-finish numbers (no Babylon, no page): how far a prop's base may sit from the ground, which things tilt,
// which sink, and the shared pivot-offset table. finish.js and the world audit both use these so the playtest's
// 5 cm rule matches what the engine settles to.
(function (root, factory) {
  const api = factory();
  root.HawkesFinishMath = api;
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
    // ESM `createRequire` of a .js under "type":"module" can yield an empty namespace; keep a named export too.
    try { module.exports.default = api; } catch { /* fine */ }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // How close a settled base must sit: float at most FLOAT_M above, sink at most SINK_M (large things dig a little).
  const FLOAT_M = 0.05; // 5 cm — Jaycee's standing rule / acceptance
  const CONTACT_M = 0.01; // sit a hair above so the mesh does not z-fight the ground
  const LARGE_SINK_M = 0.04; // rocks, buildings: bury the base edge a few cm
  const TILT_MAX_DEG = 15;
  const SMALL_FOOT_M = 2.5; // footprint or height under this: may tilt to the slope
  const LARGE_FOOT_M = 3.5; // wider/taller: sink instead of tilt

  // Per-model extras (asset id or file name): sink adds under the measured bottom; lift raises. Used when a model's
  // drawn bounds leave empty space under the visible base (roots, shadow casters) or bury it.
  const PIVOT = {
    // Digs stay within FLOAT_M (5 cm) so the world-quality 5 cm rule and settle agree (Jaycee: nothing sunk > 5 cm).
    'a_3360deb351df9daa': { sink: 0.05 }, // oak
    'a_384334cd70168ed9': { sink: 0.05 }, // pine
    'a_04e385dd742d5a28': { sink: 0.04 }, // bush
    'a_19aebee77f37565e': { sink: 0.05 }, // rocks
    'a_dc56946e844c7904': { sink: 0.05 }, // boulder
    'oak-tree.glb': { sink: 0.05 },
    'pine-tree.glb': { sink: 0.05 },
    'bush.glb': { sink: 0.04 },
    'rock.glb': { sink: 0.05 },
    'boulder.glb': { sink: 0.05 },
  };

  /** Look up a pivot row by asset id or name (case-insensitive file). */
  function pivotOf(asset) {
    if (!asset) return null;
    const s = String(asset);
    if (PIVOT[s]) return PIVOT[s];
    const low = s.toLowerCase();
    for (const k of Object.keys(PIVOT)) if (k.toLowerCase() === low) return PIVOT[k];
    const base = low.split('/').pop();
    for (const k of Object.keys(PIVOT)) if (k.toLowerCase() === base) return PIVOT[k];
    return null;
  }

  /** How much to bury the measured bottom (m). Never more than FLOAT_M so the 5 cm playtest rule holds. */
  function sinkOf(half, asset) {
    const foot = Math.max(half[0] || 0, half[2] || 0) * 2;
    const tall = (half[1] || 0) * 2;
    const large = foot >= LARGE_FOOT_M || tall >= LARGE_FOOT_M;
    const row = pivotOf(asset);
    const extra = row && Number(row.sink) || 0;
    const lift = row && Number(row.lift) || 0;
    const raw = (large ? LARGE_SINK_M : 0) + extra;
    return { sink: Math.min(FLOAT_M, raw), lift, tilt: !large && foot < SMALL_FOOT_M && tall < SMALL_FOOT_M };
  }

  /** Target world Y for the entity's position so its drawn bottom sits on `groundY` (plus contact / sink / lift). */
  function targetY(groundY, bottom, y, sinkInfo) {
    const wantBottom = groundY + CONTACT_M - (sinkInfo.sink || 0) + (sinkInfo.lift || 0);
    return y + (wantBottom - bottom);
  }

  /** Cap a unit normal's tilt from up to `maxDeg` degrees; returns a unit [nx,ny,nz]. */
  function clampTilt(nx, ny, nz, maxDeg = TILT_MAX_DEG) {
    const n = [nx, ny, nz];
    const len = Math.hypot(n[0], n[1], n[2]) || 1;
    n[0] /= len; n[1] /= len; n[2] /= len;
    const max = Math.cos((Math.max(0, maxDeg) * Math.PI) / 180);
    if (n[1] >= max) return n;
    // Pull toward up until the angle is maxDeg.
    const flat = Math.hypot(n[0], n[2]) || 1e-9;
    const wantFlat = Math.sin((maxDeg * Math.PI) / 180);
    const k = wantFlat / flat;
    const out = [n[0] * k, Math.cos((maxDeg * Math.PI) / 180), n[2] * k];
    const L = Math.hypot(out[0], out[1], out[2]) || 1;
    return [out[0] / L, out[1] / L, out[2] / L];
  }

  /** Pitch (x) and roll (z) degrees from a unit ground normal, keeping yaw. */
  function tiltDegrees(nx, ny, nz, maxDeg = TILT_MAX_DEG) {
    const n = clampTilt(nx, ny, nz, maxDeg);
    const pitch = Math.atan2(n[2], n[1]) * (180 / Math.PI);
    const roll = -Math.atan2(n[0], n[1]) * (180 / Math.PI);
    return { pitch, roll, normal: n };
  }

  /** Gap of a base over (+) or under (−) the ground, after settle rules (for the audit). */
  function gapOf(bottom, groundY) {
    return bottom - groundY;
  }

  /** True when a gap fails the 5 cm rule (float > FLOAT_M or sink deeper than FLOAT_M without being a deliberate large sink). */
  function badGap(gap, allowedSink = FLOAT_M) {
    if (gap > FLOAT_M) return 'floating';
    if (gap < -allowedSink) return 'sunk';
    return null;
  }

  return {
    FLOAT_M, CONTACT_M, LARGE_SINK_M, TILT_MAX_DEG, SMALL_FOOT_M, LARGE_FOOT_M, PIVOT,
    pivotOf, sinkOf, targetY, clampTilt, tiltDegrees, gapOf, badGap,
  };
});
