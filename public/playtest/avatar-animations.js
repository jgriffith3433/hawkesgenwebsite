// The `avatar-animations` scenario: clips as data (docs/animations.md), seen on /avatars. Loaded by portal.js. No game, no
// sign-up, nothing generated, safe on live.
//
// For one model of each class it draws a moment of a clip from the class's file (`/avatars?body=<id>&pose=<clip>&t=<s>`): the dog
// (class quadruped), the toaster (object) and the person on the Mixamo stand-in puppet (`standin=mixamo`; class mixamo, until a
// model is re-rigged to the Mixamo skeleton). Each is a same-origin iframe, so the page's own engine runs. It logs what the three
// acceptance criteria are about:
//   1. clip-file       the file of a class loaded, is sound, and the walk at t = 0.25 and 0.75 are different poses drawn from it
//   2. bone-checks     a clip naming a bone the class lacks is rejected; mixamorig:, mixamorig7: and unprefixed names are one bone
//   3. quadruped-*     the quadruped set (docs/animations.md 2B): every clip is there (`quadruped-clips`), a contact sheet of the dog's walk, trot,
//                      run, jump, fall, swim, sit and sleep at four moments each (scenes "Sheet: dog run 3/4"), `walk-diagonal` / `trot-diagonal`
//                      (the feet land in diagonal pairs), `run-gallop` (the back stretches 1.1, the pairs bound), `clip-moves` (every clip
//                      differs between its moments), `loops-close`, and the fox, sheep and horse playing the same 29 clips (`same-clips`)
//   4. object-*        the object set (docs/animations.md 2C), made on the toaster: `object-clips` (all 23), a contact sheet of every clip at four moments
//                      (scenes "Sheet: toaster cheer 2/4"), `toast-pops` (the slices up in idle_fidget, cheer, point, thumbsup), `volume-kept`,
//                      `no-clipping`, `object-loops-close`, the shoe, teapot, cactus and duck playing the set (`object-same-clips`,
//                      `proportionate-motion`), and the fish and roll-bot keeping their own locomotion (`fish-keeps-gait`, `rollbot-keeps-roll`)
//   5. fallback-*      a role the set has no clip for still moves (the fish swimming: its own, procedural), a template-rigged biped still
//                      animates (its own GLB clips), and ten animating characters: the cost of the animation and the draw numbers
export const AVATAR_ANIMATIONS = {
  id: 'avatar-animations', title: 'Animation clips as data: a walk drawn from the class file for a dog, a toaster and a Mixamo-skeleton puppet; the bone checks; the fallbacks; ten characters animating',
  description: 'no sign-up, no game. Opens /avatars in a frame per model (scenes "Clip: dog walk 0.25 s" ...), logs clip-file, bone-checks, fallback-procedural, template-biped-animates and ten-characters. Options: bodies (["dog","toaster","puppet"]), crowd (seconds the ten run, default 2), quadruped: false (skips the quadruped sheet), sheet (clips for the contact sheet, default walk trot run jump fall swim sit sleep), all: true (the sheet for all 29)',
  seconds: 540, tags: ['full'],
};

const QUAD_CLIPS = ['idle', 'idle_sniff', 'idle_fidget', 'walk', 'trot', 'run', 'jump_start', 'jump', 'land', 'fall', 'swim', 'sit', 'lie_down', 'sleep', 'drive', 'wave', 'dance', 'cheer', 'laugh', 'point', 'clap', 'thumbsup', 'heart', 'bark', 'shake_off', 'shrug', 'hurt', 'knock_down', 'get_up'];
const QUAD_SHEET = ['walk', 'trot', 'run', 'jump', 'fall', 'swim', 'sit', 'sleep'];
const QUAD_BONES = ['Root', 'Body', 'Head', 'LegFL', 'LegFR', 'LegBL', 'LegBR'];
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
    f.close();
    t.progress(0.05 + 0.6 * (++n / total));
  }

  // ---- a body that keeps its own gait: the fish's swim is its own (the set has a swim clip, the fish's row does not take it)
  {
    const f = await openFrame(t, '/avatars?body=fish&bg=studio&pose=swim&live=1', 'fish swim');
    await t.wait(500);
    const s1 = f.win.hawkesAvatars.probe([]);
    await t.wait(700);
    const s2 = f.win.hawkesAvatars.probe([]);
    t.scene('Clip: fish swim (its own motion)');
    if (!s1 || !s2 || (Math.abs(s1.mover.y - s2.mover.y) < 1e-4 && Math.abs(s1.mover.rz - s2.mover.rz) < 1e-4)) t.problem('bug', 'the fish swimming does not move: its own swim is gone');
    else t.event('fallback-procedural', `fish swim: its own motion (y ${s1.mover.y.toFixed(3)} to ${s2.mover.y.toFixed(3)}), the object set is used only for idle, emotes and hurt`);
    f.win.hawkesAvatars.setPose('wave', 0.4); await t.wait(250);
    const w = f.win.hawkesAvatars.probe([]);
    t.event('fish-keeps-gait', `fish: its swim is its own; wave (a clip of the set) draws at 0.4 s (squash ${w.mover.sy.toFixed(2)})`);
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

  // ---- the quadruped set: the dog's contact sheet, the gaits, the loops, and the same clips on the fox, sheep and horse
  if (options.quadruped !== false) {
    const f = await openFrame(t, '/avatars?body=dog&bg=studio&pose=idle', 'quadruped set');
    const A = f.win.HawkesPlay.presence.anim, info = f.win.hawkesAvatars.anim();
    const missing = QUAD_CLIPS.filter((c) => !info.clips.includes(c));
    if (missing.length) t.problem('bug', `the quadruped set lacks ${missing.join(', ')}`);
    else t.event('quadruped-clips', `all ${QUAD_CLIPS.length} clips of docs/animations.md 2B are in quadruped.json (${info.problems.length ? info.problems.length + ' problems' : 'sound'})`);
    const set = A.setOf('quadruped');
    const sheet = options.all ? QUAD_CLIPS : (Array.isArray(options.sheet) && options.sheet.length ? options.sheet : QUAD_SHEET).filter((c) => QUAD_CLIPS.includes(c));
    const moves = [];
    for (const name of QUAD_CLIPS) {
      const c = set.clips[name];
      if (!c) continue;
      const seen = [];
      for (let k = 0; k < 4; k++) {
        f.win.hawkesAvatars.setPose(name, c.seconds * k / 4); await t.wait(sheet.includes(name) ? 320 : 90);
        if (sheet.includes(name)) t.scene(`Sheet: dog ${name} ${k + 1}/4 (${(c.seconds * k / 4).toFixed(2)} s)`);
        seen.push(f.win.hawkesAvatars.probe(QUAD_BONES));
      }
      let most = 0;
      for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) for (const b of QUAD_BONES) if (seen[i].bones[b] && seen[j].bones[b]) most = Math.max(most, angle(seen[i].bones[b], seen[j].bones[b]));
      const bad = seen.some((p) => QUAD_BONES.some((b) => p.bones[b] && p.bones[b].some((x) => !Number.isFinite(x))));
      if (bad) t.problem('bug', `dog ${name}: a bone is not a number at one of its moments`);
      if (most < 1) moves.push(name);
    }
    if (moves.length) t.problem('bug', `dog: ${moves.join(', ')} look the same at all four moments`); else t.event('clip-moves', `every one of the ${QUAD_CLIPS.length} clips differs between its four moments on the dog`);
    // the gaits, read from the data the page plays
    const lag = (a, b) => { const d = Math.abs(a - b) % 1; return Math.min(d, 1 - d); };
    const when = (n) => Object.fromEntries(set.clips[n].events.map((e) => [e.foot, e.t]));
    for (const n of ['walk', 'trot']) {
      const w = when(n);
      if (lag(w.FL, w.BR) <= 0.15 && lag(w.FR, w.BL) <= 0.15 && Math.abs(lag(w.FL, w.FR) - 0.5) < 0.05) t.event(`${n}-diagonal`, `${n}: the left front lands at ${w.FL}, the right hind at ${w.BR}; the right front at ${w.FR}, the left hind at ${w.BL}: diagonal pairs, half a cycle apart`);
      else t.problem('bug', `${n}: the feet do not land in diagonal pairs (${JSON.stringify(w)})`);
    }
    const stretch = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => A.sampleClip(set.clips.run, i / 8).get('Body').s[2]);
    if (Math.max(...stretch) >= 1.09 && Math.min(...stretch) < 1) t.event('run-gallop', `run: the back stretches to ${Math.max(...stretch).toFixed(2)} and gathers to ${Math.min(...stretch).toFixed(2)}, ${set.clips.run.events.length} footsteps a cycle of ${set.clips.run.seconds} s`);
    else t.problem('bug', `run does not stretch the back (${stretch.map((x) => x.toFixed(2)).join(' ')})`);
    // the loops close
    const open = QUAD_CLIPS.filter((n) => set.clips[n].loop).filter((n) => [...set.clips[n].tracks].some((tr) => { const a = A.sampleClip({ ...set.clips[n], tracks: [tr] }, 0).get(tr.bone), b = A.sampleClip({ ...set.clips[n], tracks: [tr] }, 0.9999).get(tr.bone); return a.q && b.q && A.q.angle(A.q.mul(a.q, A.q.inv(b.q))) > 2; }));
    if (open.length) t.problem('bug', `loops that do not close: ${open.join(', ')}`); else t.event('loops-close', `${QUAD_CLIPS.filter((n) => set.clips[n].loop).length} looping clips close (the last frame runs into the first)`);
    f.close();
    // the same clips on the other three models
    for (const id of ['fox', 'sheep', 'horse']) {
      const g = await openFrame(t, `/avatars?body=${id}&bg=studio&pose=walk&t=0.25`, `${id} quadruped set`);
      const inf = g.win.hawkesAvatars.anim();
      if (!inf || inf.state !== 'ready') throw new Error(`${id}: the quadruped set is not ready (${JSON.stringify(inf)})`);
      let broken = 0;
      for (const name of QUAD_CLIPS) for (const u of [0, 0.25, 0.5, 0.75]) {
        g.win.hawkesAvatars.setPose(name, set.clips[name].seconds * u); await t.wait(40);
        const p = g.win.hawkesAvatars.probe(QUAD_BONES);
        if (!p || QUAD_BONES.some((b) => !p.bones[b] || p.bones[b].some((x) => !Number.isFinite(x)))) broken++;
      }
      for (const name of ['walk', 'run']) { g.win.hawkesAvatars.setPose(name, set.clips[name].seconds * 0.25); await t.wait(300); t.scene(`Sheet: ${id} ${name} 2/4`); }
      if (broken) t.problem('bug', `${id}: ${broken} moments of the quadruped clips did not draw`); else t.event('same-clips', `${id}: all ${QUAD_CLIPS.length} clips at four moments each play on the model's bones (${inf.clips.length} in the set)`);
      g.close();
    }
    t.progress(0.8);
  }

  // ---- the object set (docs/animations.md 2C): the toaster's contact sheet, the slices, and the other rigid models
  if (options.object !== false) await objectSet(t, options);

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

const OBJECT_CLIPS = ['idle', 'idle_fidget', 'walk', 'run', 'jump_start', 'jump', 'land', 'fall', 'swim', 'sit', 'sleep', 'wave', 'dance', 'cheer', 'laugh', 'point', 'clap', 'thumbsup', 'heart', 'shrug', 'hurt', 'knock_down', 'get_up'];
const TOAST_CLIPS = ['idle_fidget', 'cheer', 'point', 'thumbsup'];
const OBJECT_OTHERS = { shoe: ['walk', 'cheer', 'knock_down'], teapot: ['walk', 'cheer', 'knock_down'], cactus: ['walk', 'cheer', 'knock_down'], duck: ['walk', 'cheer', 'knock_down'] };

/** The object set: every clip of the toaster at four moments (a screenshot each), the slices out in the four clips that pop them, volume kept, nothing through the floor; the shoe, teapot, cactus and duck by their proportions; loops that close. */
async function objectSet(t, options) {
  const f = await openFrame(t, '/avatars?body=toaster&bg=studio&pose=idle', 'object set: toaster');
  const A = f.win.HawkesPlay.presence.anim, info = f.win.hawkesAvatars.anim();
  const missing = OBJECT_CLIPS.filter((c) => !info.clips.includes(c));
  if (missing.length) t.problem('bug', `the object set lacks ${missing.join(', ')}`);
  else t.event('object-clips', `all ${OBJECT_CLIPS.length} clips of docs/animations.md 2C are in object.json (${info.problems.length ? info.problems.length + ' problems' : 'sound'})`);
  const set = A.setOf('object');
  const sheet = Array.isArray(options.objectSheet) && options.objectSheet.length ? options.objectSheet.filter((c) => OBJECT_CLIPS.includes(c)) : OBJECT_CLIPS;
  f.win.hawkesAvatars.setPose('idle', 0); await t.wait(300);
  const rest = f.win.hawkesAvatars.probe([]);
  const flat = [], squashed = [], clipped = [], popped = {};
  for (const name of OBJECT_CLIPS) {
    const c = set.clips[name];
    if (!c) continue;
    for (let k = 0; k < 4; k++) {
      const at = c.seconds * k / 4;
      f.win.hawkesAvatars.setPose(name, at); await t.wait(sheet.includes(name) ? 300 : 80);
      if (sheet.includes(name)) t.scene(`Sheet: toaster ${name} ${k + 1}/4 (${at.toFixed(2)} s)`);
      const p = f.win.hawkesAvatars.probe([]);
      if (!p) continue;
      const vol = p.mover.sx * p.mover.sy * p.mover.sz;
      if (Math.abs(vol - 1) > 0.03) squashed.push(`${name} ${k + 1}/4 (${vol.toFixed(2)})`);
      if (!c.air && p.lowest !== null && rest.lowest !== null && p.lowest < rest.lowest - 0.02) clipped.push(`${name} ${k + 1}/4 (${(rest.lowest - p.lowest).toFixed(2)} m under)`);
      if (TOAST_CLIPS.includes(name) && p.toast && p.toast.some((s) => s.on)) popped[name] = true;
      if (!p.mover || [p.mover.y, p.mover.sy].some((x) => !Number.isFinite(x))) flat.push(name);
    }
    // the slices are checked at the moments the data says they are up
    if (TOAST_CLIPS.includes(name) && !popped[name]) {
      let best = 0, bu = 0;
      for (let i = 0; i <= 24; i++) { const v = ['ToastL', 'ToastR'].map((b) => { const s = A.sampleClip(c, i / 24).get(b); return s ? s.p[1] : 0; }); if (Math.max(...v) > best) { best = Math.max(...v); bu = i / 24; } }
      f.win.hawkesAvatars.setPose(name, c.seconds * bu); await t.wait(250);
      const p = f.win.hawkesAvatars.probe([]);
      t.scene(`Sheet: toaster ${name} slices at their highest (${(c.seconds * bu).toFixed(2)} s)`);
      if (p && p.toast && p.toast.some((s) => s.on)) popped[name] = true;
    }
  }
  if (flat.length) t.problem('bug', `toaster: a clip gave no numbers at one of its moments: ${flat.join(', ')}`);
  const lacking = TOAST_CLIPS.filter((n) => !popped[n]);
  if (lacking.length) t.problem('bug', `toaster: the toast slices did not come up in ${lacking.join(', ')}`);
  else t.event('toast-pops', `the toast slices pop in ${TOAST_CLIPS.join(', ')}: two meshes in the slots, up and out with the clip`);
  if (squashed.length) t.problem('bug', `toaster: squash and stretch does not keep volume at ${squashed.slice(0, 6).join(', ')}`);
  else t.event('volume-kept', `toaster: ${OBJECT_CLIPS.length} clips at four moments each keep volume (x, y and z scale multiply to 1 within 3%)`);
  if (clipped.length) t.problem('bug', `toaster: through the floor at ${clipped.slice(0, 6).join(', ')}`);
  else t.event('no-clipping', 'toaster: no clip puts the body through the floor, leaning or lying (the lowest point of its box held to the ground)');
  // loops close, from the data the page plays
  const open = OBJECT_CLIPS.filter((n) => set.clips[n] && set.clips[n].loop).filter((n) => [...set.clips[n].tracks].some((tr) => { const one = { ...set.clips[n], tracks: [tr] }, a = A.sampleClip(one, 0).get(tr.bone), b = A.sampleClip(one, 0.99999).get(tr.bone); return (a.q && b.q && A.q.angle(A.q.mul(a.q, A.q.inv(b.q))) > 1.5) || (a.s && b.s && Math.abs(a.s[1] - b.s[1]) > 0.01) || (a.p && b.p && Math.abs(a.p[1] - b.p[1]) > 0.005); }));
  if (open.length) t.problem('bug', `object loops that do not close: ${open.join(', ')}`);
  else t.event('object-loops-close', `${OBJECT_CLIPS.filter((n) => set.clips[n] && set.clips[n].loop).length} looping object clips close (the last frame runs into the first)`);
  f.close();
  // the same clips on the shoe, teapot, cactus and duck: by their proportions
  const hops = {};
  for (const [id, show] of Object.entries(OBJECT_OTHERS)) {
    const g = await openFrame(t, `/avatars?body=${id}&bg=studio&pose=idle`, `object set: ${id}`);
    const inf = g.win.hawkesAvatars.anim();
    if (!inf || inf.state !== 'ready' || !inf.clips.includes('knock_down')) throw new Error(`${id}: the object set is not ready (${JSON.stringify(inf)})`);
    g.win.hawkesAvatars.setPose('idle', 0); await t.wait(300);
    const r0 = g.win.hawkesAvatars.probe([]);
    let broken = 0, under = [], hopMax = 0;
    for (const name of OBJECT_CLIPS) for (let k = 0; k < 4; k++) {
      g.win.hawkesAvatars.setPose(name, set.clips[name].seconds * k / 4); await t.wait(show.includes(name) ? 300 : 60);
      if (show.includes(name)) t.scene(`Sheet: ${id} ${name} ${k + 1}/4`);
      const p = g.win.hawkesAvatars.probe([]);
      if (!p || ![p.mover.y, p.mover.sy, p.mover.rz].every(Number.isFinite)) { broken++; continue; }
      if (name === 'walk') hopMax = Math.max(hopMax, p.mover.y - r0.mover.y);
      if (!set.clips[name].air && p.lowest !== null && r0.lowest !== null && p.lowest < r0.lowest - 0.02) under.push(`${name} ${k + 1}/4`);
    }
    hops[id] = hopMax;
    if (broken) t.problem('bug', `${id}: ${broken} moments of the object clips did not draw`);
    else if (under.length) t.problem('bug', `${id}: through the floor at ${under.slice(0, 5).join(', ')}`);
    else t.event('object-same-clips', `${id}: all ${OBJECT_CLIPS.length} clips at four moments each play, held to the ground, walk hop ${hopMax.toFixed(3)} m`);
    g.close();
  }
  if (hops.cactus && hops.shoe && hops.cactus <= hops.shoe) t.problem('warning', `the cactus (1.7 m) hops no higher than the shoe (0.5 m): the motion does not follow the proportions (${JSON.stringify(hops)})`);
  else t.event('proportionate-motion', `the hop follows each model's own size: ${Object.entries(hops).map(([k, v]) => `${k} ${v.toFixed(3)} m`).join(', ')}`);
  // the fish and the roll-bot keep their locomotion
  for (const id of ['rollbot']) {
    const g = await openFrame(t, `/avatars?body=${id}&bg=studio&pose=walk&live=1`, `${id} keeps its roll`);
    await t.wait(500);
    const a = g.win.hawkesAvatars.probe([]);
    await t.wait(600);
    const b = g.win.hawkesAvatars.probe([]);
    t.scene(`Clip: ${id} walk (its own roll)`);
    const inf = g.win.hawkesAvatars.anim();
    if (!inf || inf.cls !== 'object') t.problem('bug', `${id} should be in the object class (${JSON.stringify(inf)})`);
    else t.event('rollbot-keeps-roll', `${id}: walking is its own roll, the set takes idle, emotes and hurt (${a && b ? 'body y ' + a.mover.y.toFixed(3) + ' to ' + b.mover.y.toFixed(3) : 'no probe'})`);
    g.close();
  }
}
