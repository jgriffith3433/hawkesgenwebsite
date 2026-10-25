// The `avatar-animations` scenario: clips as data (docs/animations.md), seen on /avatars. Loaded by portal.js. No game, no
// sign-up, nothing generated, safe on live.
//
// For one model of each class it draws a moment of a clip from the class's file (`/avatars?body=<id>&pose=<clip>&t=<s>`): the dog
// (class quadruped), the toaster (object) and the person on the Mixamo stand-in puppet (`standin=mixamo`; class mixamo, until a
// model is re-rigged to the Mixamo skeleton). Each is a same-origin iframe, so the page's own engine runs. It logs what the three
// acceptance criteria are about:
//   1. clip-file       the file of a class loaded, is sound, and the walk at t = 0.25 and 0.75 are different poses drawn from it
//   2. bone-checks     a clip naming a bone the class lacks is rejected; mixamorig:, mixamorig7: and unprefixed names are one bone
//   3. fallback-*      a role the set has no clip for still moves (the toaster swimming: procedural), a template-rigged biped still
//                      animates (its own GLB clips), and ten animating characters: the cost of the animation and the draw numbers
export const AVATAR_ANIMATIONS = {
  id: 'avatar-animations', title: 'Animation clips as data: a walk drawn from the class file for a dog, a toaster and a Mixamo-skeleton puppet; the bone checks; the fallbacks; ten characters animating',
  description: 'no sign-up, no game. Opens /avatars in a frame per model (scenes "Clip: dog walk 0.25 s" ...), logs clip-file, bone-checks, fallback-procedural, template-biped-animates and ten-characters. Options: bodies (["dog","toaster","puppet"]), crowd (seconds the ten run, default 2)',
  seconds: 150, tags: ['full'],
};

const MODELS = {
  dog: { url: '/avatars?body=dog&bg=studio', cls: 'quadruped', bones: ['LegFL', 'LegFR', 'Body'] },
  toaster: { url: '/avatars?body=toaster&bg=studio', cls: 'object', bones: [] },
  puppet: { url: '/avatars?body=person&standin=mixamo&bg=studio', cls: 'mixamo', bones: ['mixamorig:LeftUpLeg', 'mixamorig:RightUpLeg', 'mixamorig:LeftArm'] },
};
const angle = (a, b) => { const d = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]); return 2 * Math.acos(Math.min(1, d)) * 180 / Math.PI; };

export async function runAvatarAnimations(t, options = {}) {
  const ids = (Array.isArray(options.bodies) && options.bodies.length ? options.bodies : Object.keys(MODELS)).filter((id) => MODELS[id]);
  const seconds = Math.max(1, Math.min(6, Number(options.crowd) || 2));
  t.event('plan', `avatar-animations: ${ids.join(', ')}`);
  t.progress(0.02);
  let n = 0;
  const total = ids.length + 3;
  for (const id of ids) {
    const m = MODELS[id];
    const f = await openFrame(t, `${m.url}&pose=walk&t=0.25`, `${id} walk`);
    const a = await look(t, f, `Clip: ${id} walk 0.25 s`, m.bones);
    const info = f.win.hawkesAvatars.anim();
    if (!info || info.state !== 'ready' || !info.clips.includes('walk') || !info.clips.includes('idle')) throw new Error(`${id}: the ${m.cls} set is not ready (${JSON.stringify(info)})`);
    if (info.problems.length) t.problem('bug', `${m.cls}.json: ${info.problems.join('; ')}`);
    t.event('clip-file', `${id}: class ${info.cls}, clips ${info.clips.join(', ')}, ${info.problems.length ? info.problems.length + ' problems' : 'sound'}`);
    f.win.hawkesAvatars.setPose('walk', 0.75);
    const b = await look(t, f, `Clip: ${id} walk 0.75 s`, m.bones);
    const moved = m.bones.length ? Math.max(...m.bones.map((k) => (a.bones[k] && b.bones[k] ? angle(a.bones[k], b.bones[k]) : 0))) : 0;
    const hop = Math.abs(a.mover.y - b.mover.y), roll = Math.abs(a.mover.rz - b.mover.rz) * 180 / Math.PI;
    if ((m.bones.length && moved < 5) || (!m.bones.length && hop < 0.01 && roll < 3)) t.problem('bug', `${id}: walk at 0.25 s and 0.75 s are the same pose (bone ${moved.toFixed(1)} deg, hop ${hop.toFixed(3)}, roll ${roll.toFixed(1)})`);
    else t.event('clip-moments', `${id}: walk 0.25 s and 0.75 s differ (${m.bones.length ? `${moved.toFixed(0)} degrees on a bone` : `hop ${hop.toFixed(2)} m, roll ${roll.toFixed(0)} degrees`}), drawn from ${m.cls}.json`);
    // another moment of the same time is the same picture: a clip is a function of time
    f.win.hawkesAvatars.setPose('walk', 0.25);
    await t.wait(150);
    const a2 = f.win.hawkesAvatars.probe(m.bones);
    const same = m.bones.length ? Math.max(...m.bones.map((k) => (a.bones[k] && a2.bones[k] ? angle(a.bones[k], a2.bones[k]) : 0))) < 0.5 : Math.abs(a.mover.y - a2.mover.y) < 1e-3;
    if (!same) t.problem('bug', `${id}: walk at 0.25 s drawn twice gives two poses`);
    if (id === 'toaster') { // a role the set lacks (swim): the procedural motion moves it
      f.win.hawkesAvatars.setPose('swim', 0.3); await t.wait(200);
      t.scene('Clip: toaster swim (no clip in the set: procedural)');
      const s1 = f.win.hawkesAvatars.probe([]);
      f.win.hawkesAvatars.setPose('swim', 0.9); await t.wait(200);
      const s2 = f.win.hawkesAvatars.probe([]);
      const info2 = f.win.hawkesAvatars.anim();
      if (Math.abs(s1.mover.y - s2.mover.y) < 1e-4 && Math.abs(s1.mover.rz - s2.mover.rz) < 1e-4) t.problem('bug', 'the toaster swimming does not move: no procedural fallback');
      else t.event('fallback-procedural', `toaster swim: the set has ${info2.clips.includes('swim') ? 'a' : 'no'} swim clip, the body still moves (y ${s1.mover.y.toFixed(3)} to ${s2.mover.y.toFixed(3)})`);
    }
    f.close();
    t.progress(0.05 + 0.6 * (++n / total));
  }

  // ---- bone checks, in the page's own engine
  {
    const f = await openFrame(t, '/avatars?body=dog&bg=studio', 'bone checks');
    const A = f.win.HawkesPlay.presence.anim;
    const good = await (await fetch('/play/anim/quadruped.json')).json();
    const bad = JSON.parse(JSON.stringify(good)); bad.clips.walk.tracks.Tail = { rot: [[0, 0, 0, 0], [0.5, 0, 10, 0]] };
    const p = A.validate('quadruped', bad);
    if (!p.length || !/no bone "Tail"/.test(p.join())) t.problem('bug', `a clip naming a Tail bone was not rejected (${JSON.stringify(p)})`);
    else t.event('bone-checks', `rejected: ${p[0]}`);
    const names = ['mixamorig:LeftUpLeg', 'mixamorig7:LeftUpLeg', 'mixamorig_LeftUpLeg', 'LeftUpLeg'].map(A.norm);
    if (new Set(names).size !== 1) t.problem('bug', `the prefixes are not one bone: ${names.join(', ')}`);
    else t.event('prefixes-match', 'mixamorig:, mixamorig7:, mixamorig_ and unprefixed LeftUpLeg are one bone');
    f.close();
    t.progress(0.05 + 0.6 * (++n / total));
  }

  // ---- a template-rigged biped (the person, no stand-in) still animates by its own clips: the Mixamo set does not fit it
  {
    const f = await openFrame(t, '/avatars?body=robot&bg=studio&pose=walk&live=1', 'template biped');
    await t.wait(600);
    const info = f.win.hawkesAvatars.anim();
    const q0 = f.win.hawkesAvatars.probe(['LegL', 'ArmR', 'LegR']);
    await t.wait(450);
    const q1 = f.win.hawkesAvatars.probe(['LegL', 'ArmR', 'LegR']);
    t.scene('Clip: robot walk (template rig: its own clips)');
    const moved = ['LegL', 'ArmR', 'LegR'].reduce((m, k) => Math.max(m, q0 && q1 && q0.bones[k] && q1.bones[k] ? angle(q0.bones[k], q1.bones[k]) : 0), 0);
    if (!info || info.state !== 'unfit') t.problem('bug', `the template-rigged robot should not take the Mixamo set (${JSON.stringify(info)})`);
    if (moved < 3) t.problem('bug', `the template-rigged robot walks without moving a limb (${moved.toFixed(1)} degrees)`);
    else t.event('template-biped-animates', `robot (11-joint template rig): set "${info && info.state}", its own walk clip moves a limb ${moved.toFixed(0)} degrees`);
    f.close();
    t.progress(0.05 + 0.6 * (++n / total));
  }

  // ---- ten characters animating
  {
    const f = await openFrame(t, MODELS.dog.url + '&pose=walk&live=1', 'ten characters');
    const r = await f.win.hawkesAvatars.crowd(10, seconds);
    t.scene('Clip: ten dogs walking');
    if (!r) throw new Error('the page could not make ten characters');
    t.event('ten-characters', `${r.n} dogs walking from ${r.animated} animated sets: animation ${r.animateMs.toFixed(2)} ms a frame (CPU), ${r.fps.toFixed(0)} fps, ${r.draws} draws, ${r.triangles} triangles, tier ${r.tier}`);
    t.metric && t.metric('tenAnimateMs', r.animateMs);
    if (r.animated < r.n) t.problem('bug', `only ${r.animated} of ${r.n} characters play the data set`);
    if (r.animateMs > 8) t.problem('bug', `ten characters cost ${r.animateMs.toFixed(1)} ms a frame to animate: over the 8 ms the phone tier can spare`);
    else if (r.fps && r.fps < 20) t.problem('warning', `${r.fps.toFixed(0)} fps with ten animating characters in this browser (tier ${r.tier})`);
    f.close();
    t.progress(1);
  }
  t.finish('done');
}

/** An iframe over the page showing `url`, resolved when the avatar page says it is final. */
async function openFrame(t, url, label) {
  document.getElementById('pt-avatar-stage')?.remove();
  const stage = document.createElement('div');
  stage.id = 'pt-avatar-stage';
  stage.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:#14151c';
  const cap = document.createElement('div');
  cap.style.cssText = 'position:absolute;left:0;right:0;top:0;height:22px;font:12px/22px ui-monospace,monospace;color:#9aa3b2;text-align:center';
  cap.textContent = label;
  const frame = document.createElement('iframe');
  frame.title = label;
  frame.style.cssText = `position:absolute;left:0;top:24px;width:${innerWidth}px;height:${innerHeight - 24}px;border:0;background:#fff`;
  stage.append(cap, frame);
  document.body.appendChild(stage);
  await new Promise((res, rej) => { frame.onload = res; frame.onerror = () => rej(new Error(`${label}: the page did not load`)); frame.src = url; });
  const win = frame.contentWindow;
  await t.until(() => win.document.body.dataset.ready === 'true' || win.document.body.dataset.ready === 'error', 40000, `${label} to be ready`);
  if (win.document.body.dataset.ready === 'error') throw new Error(`${label}: the avatar page could not start (WebGL?)`);
  await t.until(() => win.hawkesAvatars, 10000, 'the avatar window');
  await t.wait(400);
  return { win, close: () => stage.remove() };
}
async function look(t, f, scene, bones) {
  await t.wait(350);
  t.scene(scene);
  return f.win.hawkesAvatars.probe(bones);
}
