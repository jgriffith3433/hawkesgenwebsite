// The showcase's poses (see avatars.js). idle, walk, run and the emotes are the game's own; these four are laid over the same
// joints after presence.js animate(), because the bodies have no jump, fall, swim or drive of their own yet.
/* eslint-disable */
// ------------------------------------------------------------------ the poses
// idle, walk and run are the game's own (speed through animate); the emotes too (rig.emote). jump, fall, swim and drive are
// approximations laid over the same joints, because the bodies have no such poses yet (docs/characters.md: the target).
export const POSES = ['idle', 'walk', 'run', 'jump', 'fall', 'swim', 'drive'];
const tuck = (rig, hips, arms) => {
  const lv = rig.lv;
  if (lv) { for (const h of lv.hips || []) h.n.rotation.x = hips; for (const a of lv.arms || []) a.n.rotation.x = arms; }
  else { rig.hipL.rotation.x = hips; rig.hipR.rotation.x = hips; }
};
export function overlay(rig, pose, t) {
  const pz = rig.pose;
  if (pose === 'jump') {
    const T = 1.3, u = (t % T) / T;
    if (u < 0.12) { const k = u / 0.12; pz.scaling.set(1 + 0.1 * k, 1 - 0.16 * k, 1 + 0.1 * k); pz.position.y = 0; tuck(rig, 0.5 * k, 0); }
    else if (u < 0.78) { const a = (u - 0.12) / 0.66; pz.position.y = 4 * a * (1 - a) * 0.95; const s = 1 + 0.12 * Math.sin(a * Math.PI); pz.scaling.set(1 / Math.sqrt(s), s, 1 / Math.sqrt(s)); tuck(rig, -0.6, -2.4); rig.shL.rotation.z = 0.5; rig.shR.rotation.z = -0.5; }
    else { const k = (u - 0.78) / 0.22; const sq = 0.82 + 0.18 * Math.min(1, k * 1.2) + Math.sin(k * Math.PI) * 0.04; pz.position.y = 0; pz.scaling.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq)); tuck(rig, 0.3 * (1 - k), -0.4 * (1 - k)); }
  } else if (pose === 'fall') {
    pz.position.y = 0.7 + Math.sin(t * 2.2) * 0.1; pz.rotation.x = 0.14; pz.rotation.z = Math.sin(t * 1.6) * 0.12;
    tuck(rig, Math.sin(t * 9) * 0.7, -2.5 + Math.sin(t * 8) * 0.25); rig.shL.rotation.z = 0.7; rig.shR.rotation.z = -0.7;
  } else if (pose === 'swim') {
    pz.rotation.x = 1.2; pz.position.y = -0.05 + Math.sin(t * 2) * 0.05; pz.position.z = 0;
    tuck(rig, Math.sin(t * 8) * 0.35, 0);
    rig.shL.rotation.set(-2.6 + Math.sin(t * 3.4) * 0.8, 0, 0.3); rig.shR.rotation.set(-2.6 - Math.sin(t * 3.4) * 0.8, 0, -0.3);
  } else if (pose === 'drive') {
    pz.position.y = -0.4; tuck(rig, -1.5, -1.3); rig.shL.rotation.z = 0.12; rig.shR.rotation.z = -0.12;
    pz.rotation.y = Math.sin(t * 0.9) * 0.12; rig.neck.rotation.y = Math.sin(t * 0.9) * 0.2;
  }
}

