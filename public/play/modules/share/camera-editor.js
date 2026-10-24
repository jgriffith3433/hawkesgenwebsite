// The camera-path editor (building only: loaded in the editor's sandbox). A "🎥 Shots" button opens it: fly where the
// shot should go and press "+ Key here" at each place (the camera's position, and whatever it looks at); or point at a
// thing and make an orbit around it. Preview plays it, Record plays and records it to a clip, Save keeps it in the
// game (scene.json config.cinematics.<name>), so scripts can play it (game.cinematic.play('intro')) and "Play at start"
// plays it when the game starts. Keys show in the world as glowing dots on a line while the panel is open.
/* global HawkesPlay, BABYLON, HawkesShareMath */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = BABYLON;
  const M = window.HawkesShareMath;
  const S = H.share;
  const W = () => H.world;
  const st = { open: false, name: 'intro', type: 'path', keys: [], seconds: 0, ease: 'smooth', letterbox: true, autoplay: false, title: '', target: '', degrees: 360, radius: 0, height: 0, marks: [], line: null, seq: 2000000 };

  const css = document.createElement('style');
  css.textContent = `
    .ce { position: fixed; left: 12px; top: 200px; z-index: 6; font: 500 12px/1.3 system-ui, sans-serif; color: #e8eef7; }
    .ce[hidden] { display: none; }
    .ce > button.ce-open { background: rgba(14,18,28,.82); color: #e8eef7; border: 1px solid rgba(255,255,255,.18); border-radius: 10px; padding: 7px 11px; cursor: pointer; font: inherit; }
    .ce .ce-panel { margin-top: 6px; background: rgba(14,18,28,.92); border: 1px solid rgba(255,255,255,.14); border-radius: 12px; padding: 10px; width: 236px; display: grid; gap: 8px; max-height: calc(100vh - 270px); overflow: auto; }
    .ce .ce-panel[hidden] { display: none; }
    .ce .ce-row { display: flex; gap: 4px; flex-wrap: wrap; align-items: center; }
    .ce button.b { flex: 1; min-width: 40px; background: rgba(255,255,255,.08); color: inherit; border: 1px solid transparent; border-radius: 8px; padding: 6px 6px; cursor: pointer; font: inherit; }
    .ce button.b:hover { border-color: #4a9eff; }
    .ce button.b.on { border-color: #4a9eff; background: rgba(74,158,255,.22); }
    .ce button.hot { background: #4a9eff; color: #fff; }
    .ce input[type=text], .ce input[type=number], .ce select { background: #1b2232; color: inherit; border: 1px solid rgba(255,255,255,.18); border-radius: 6px; padding: 5px 6px; font: inherit; min-width: 0; }
    .ce label { display: grid; grid-template-columns: 70px 1fr; align-items: center; gap: 6px; }
    .ce .ce-keys { display: grid; gap: 3px; max-height: 150px; overflow: auto; }
    .ce .ce-key { display: flex; align-items: center; gap: 6px; padding: 3px 6px; border-radius: 6px; background: rgba(255,255,255,.05); font: 11px ui-monospace, monospace; }
    .ce .ce-key span { flex: 1; }
    .ce .ce-key button { background: none; border: 0; color: #fca5a5; cursor: pointer; font-size: 13px; }
    .ce .ce-note { opacity: .7; font-size: 11px; line-height: 1.35; }
    .ce .ce-check { display: flex; gap: 6px; align-items: center; }`;
  document.head.appendChild(css);

  const el = document.createElement('div');
  el.className = 'ce';
  el.hidden = true;
  el.innerHTML = '<button class="ce-open" type="button" title="Camera shots: intros, cut-scenes, trailer shots">🎥 Shots</button><div class="ce-panel" hidden></div>';
  document.body.appendChild(el);
  const panel = el.querySelector('.ce-panel');
  el.querySelector('.ce-open').onclick = (e) => { e.stopPropagation(); st.open = !st.open; if (st.open) load(st.name); render(); };
  el.addEventListener('pointerdown', (e) => e.stopPropagation());
  el.addEventListener('keydown', (e) => e.stopPropagation());

  const shots = () => { try { const c = H.lib.effectiveConfig().cinematics; return c && typeof c === 'object' ? c : {}; } catch { return {}; } };
  const r2 = (n) => Math.round(n * 100) / 100;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /** Loads a saved shot into the panel (or starts a new one with that name). */
  function load(name) {
    const s = shots()[name];
    st.name = name;
    st.keys = []; st.target = ''; st.title = ''; st.seconds = 0; st.autoplay = false; st.letterbox = true; st.ease = 'smooth';
    if (!s) { st.type = 'path'; return; }
    st.type = s.type === 'orbit' ? 'orbit' : 'path';
    st.keys = Array.isArray(s.keys) ? s.keys.map((k) => ({ pos: M.v3(k.pos || k.position), look: M.v3(k.look || k.lookAt || k.target), ...(k.fov ? { fov: k.fov } : {}) })) : [];
    st.seconds = Number(s.seconds) || 0;
    st.ease = s.ease || 'smooth';
    st.letterbox = s.letterbox !== false;
    st.autoplay = Boolean(s.autoplay);
    st.title = s.title || '';
    st.target = typeof s.target === 'string' ? s.target : '';
    st.degrees = Number(s.degrees) || 360;
    st.radius = Number(s.radius) || 0;
    st.height = Number(s.height) || 0;
  }
  /** The shot as it's saved in config.cinematics. */
  function spec() {
    const base = { ...(st.letterbox ? {} : { letterbox: false }), ...(st.autoplay ? { autoplay: true } : {}), ...(st.title ? { title: st.title } : {}) };
    if (st.type === 'orbit') return { type: 'orbit', target: st.target, seconds: st.seconds || 10, degrees: st.degrees, ...(st.radius ? { radius: r2(st.radius) } : {}), ...(st.height ? { height: r2(st.height) } : {}), ...base };
    return { type: 'path', keys: st.keys.map((k) => ({ pos: k.pos.map(r2), look: k.look.map(r2), ...(k.fov ? { fov: k.fov } : {}) })), ...(st.seconds ? { seconds: st.seconds } : {}), ...(st.ease !== 'smooth' ? { ease: st.ease } : {}), ...base };
  }

  function render() {
    el.hidden = H.mode !== 'build' || !W() || S.settings().off;
    panel.hidden = !st.open;
    marks();
    if (!st.open) return;
    const names = Object.keys(shots());
    const dur = st.type === 'path' && st.keys.length > 1 ? M.normalizePath(spec()).duration : st.seconds || 10;
    panel.innerHTML = `
      <div class="ce-row"><select class="ce-pick" style="flex:1">${[...new Set([...names, st.name])].map((n) => `<option ${n === st.name ? 'selected' : ''}>${esc(n)}</option>`).join('')}<option value="__new">+ New shot…</option></select></div>
      <div class="ce-row"><button type="button" class="b ${st.type === 'path' ? 'on' : ''}" data-type="path">Path</button><button type="button" class="b ${st.type === 'orbit' ? 'on' : ''}" data-type="orbit">Orbit</button></div>
      ${st.type === 'path' ? `
        <button type="button" class="b hot" data-a="key">+ Key here</button>
        <div class="ce-keys">${st.keys.map((k, i) => `<div class="ce-key"><span>${i + 1} · ${k.pos.map((n) => n.toFixed(1)).join(', ')}</span><button type="button" data-del="${i}" title="Remove">✕</button></div>`).join('') || '<div class="ce-note">Fly to where the shot starts and press "+ Key here". Then the next place, and the next. The camera looks at what\'s in the middle of your view.</div>'}</div>
        <label>Length <input type="number" min="0" step="0.5" value="${st.seconds || ''}" placeholder="${dur.toFixed(1)} s" data-f="seconds"></label>
        <label>Motion <select data-f="ease">${[['smooth', 'Smooth'], ['inOut', 'Ease in and out'], ['linear', 'Steady'], ['out', 'Slow down'], ['in', 'Speed up']].map(([v, t]) => `<option value="${v}" ${st.ease === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>`
      : `
        <button type="button" class="b hot" data-a="aim">◎ Orbit what I'm looking at</button>
        <div class="ce-note">${st.target ? `Around <b>${esc(st.target)}</b>${st.radius ? `, ${st.radius.toFixed(0)} m out` : ''}.` : 'Look at a thing (a volcano, a house, a car) and press the button.'}</div>
        <label>Length <input type="number" min="1" step="0.5" value="${st.seconds || 10}" data-f="seconds"></label>
        <label>Turn <input type="number" min="15" max="1080" step="15" value="${st.degrees}" data-f="degrees"></label>`}
      <label>Title <input type="text" maxlength="60" value="${esc(st.title)}" placeholder="words on screen (optional)" data-f="title"></label>
      <label class="ce-check"><input type="checkbox" data-f="letterbox" ${st.letterbox ? 'checked' : ''}> Letterbox bars</label>
      <label class="ce-check"><input type="checkbox" data-f="autoplay" ${st.autoplay ? 'checked' : ''}> Play when the game starts</label>
      <div class="ce-row"><button type="button" class="b" data-a="preview">▶ Preview</button>${S.canRecord() ? '<button type="button" class="b" data-a="record">● Record</button>' : ''}</div>
      <div class="ce-row"><button type="button" class="b hot" data-a="save">Save "${esc(st.name)}"</button><button type="button" class="b" data-a="delete" title="Delete this shot from the game">🗑</button></div>
      <div class="ce-note">Scripts play it with <code>game.cinematic.play('${esc(st.name)}')</code>. The assistant can make shots too: "an orbit around the volcano when the game starts".</div>`;
    panel.querySelector('.ce-pick').onchange = (e) => {
      let v = e.target.value;
      if (v === '__new') { v = (prompt('A name for the shot (intro, volcano, chase...)') || '').trim().replace(/[^\w -]/g, '').slice(0, 40); if (!v) { render(); return; } }
      load(v); render();
    };
    panel.querySelectorAll('[data-type]').forEach((b) => { b.onclick = () => { st.type = b.dataset.type; render(); }; });
    panel.querySelectorAll('[data-del]').forEach((b) => { b.onclick = () => { st.keys.splice(Number(b.dataset.del), 1); render(); }; });
    panel.querySelectorAll('[data-f]').forEach((i) => {
      i.onchange = () => {
        const f = i.dataset.f;
        if (i.type === 'checkbox') st[f] = i.checked;
        else if (i.type === 'number') st[f] = Math.max(0, Number(i.value) || 0);
        else st[f] = i.value;
        render();
      };
    });
    const act = (a, fn) => { const b = panel.querySelector(`[data-a="${a}"]`); if (b) b.onclick = fn; };
    act('key', addKey);
    act('aim', aim);
    act('preview', () => preview(false));
    act('record', () => preview(true));
    act('save', save);
    act('delete', remove);
  }

  function addKey() {
    const v = S.viewPose(120);
    if (!v) return;
    st.keys.push({ pos: v.pos, look: v.look });
    toast(`Key ${st.keys.length}`);
    render();
  }
  function aim() {
    const w = W();
    const cam = w && w.scene && w.scene.activeCamera;
    if (!cam) return;
    const hit = w.scene.pickWithRay(cam.getForwardRay(400), (m) => m.isPickable && !(m.metadata && m.metadata.decor));
    const e = hit && hit.hit ? H.entityOf(hit.pickedMesh) : null;
    if (!e) { toast('Look at a thing first'); return; }
    st.target = e.name || e.sceneId;
    const p = [cam.globalPosition.x, cam.globalPosition.y, cam.globalPosition.z];
    st.radius = Math.max(3, Math.hypot(p[0] - e.x, p[2] - e.z));
    st.height = Math.max(0.5, p[1] - e.y);
    toast(`Orbiting ${st.target}`);
    render();
  }
  function preview(record) {
    const s = spec();
    if (s.type === 'path' && s.keys.length < 2) { toast('Two keys at least'); return; }
    if (s.type === 'orbit' && !s.target) { toast('Pick a thing to orbit first'); return; }
    S.cinematic[record ? 'record' : 'play']({ ...s, name: st.name, autoplay: false, skippable: !record }).catch((e) => toast(e.message));
  }
  function send(ops, label) {
    if (window.HawkesBuild && window.HawkesBuild.edit) window.HawkesBuild.edit(ops, { label });
    else { H.applyOps(ops, { local: true }); H.post({ type: 'ops', ops, seq: ++st.seq }); }
  }
  function save() {
    const s = spec();
    if (s.type === 'path' && s.keys.length < 2) { toast('Two keys at least'); return; }
    if (s.type === 'orbit' && !s.target) { toast('Pick a thing to orbit first'); return; }
    // Only one shot plays at the start.
    const others = st.autoplay ? Object.entries(shots()).filter(([n, v]) => n !== st.name && v && v.autoplay).map(([n]) => n) : [];
    const ops = [{ op: 'config', patch: { cinematics: { [st.name]: null } } }, { op: 'config', patch: { cinematics: { [st.name]: s } } }];
    for (const n of others) ops.push({ op: 'config', patch: { cinematics: { [n]: { autoplay: null } } } });
    send(ops, `saving the shot "${st.name}"`);
    toast(`Saved "${st.name}"`);
    render();
  }
  function remove() {
    if (!shots()[st.name]) { load('intro'); render(); return; }
    if (!confirm(`Delete the shot "${st.name}"?`)) return;
    send([{ op: 'config', patch: { cinematics: { [st.name]: null } } }], `deleting the shot "${st.name}"`);
    load(Object.keys(shots())[0] || 'intro');
    render();
  }
  function toast(t) { S.toast(t, 1.6); }

  // The keys in the world: a dot at each, a line along the path.
  function marks() {
    const w = W();
    for (const m of st.marks) m.dispose();
    st.marks = [];
    if (st.line) { st.line.dispose(); st.line = null; }
    if (!st.open || !w || !w.scene || H.mode !== 'build' || st.type !== 'path' || !st.keys.length) return;
    const scene = w.scene;
    const mat = new B.StandardMaterial('ce-mark', scene);
    mat.emissiveColor = new B.Color3(0.42, 0.94, 1); mat.disableLighting = true;
    st.keys.forEach((k, i) => {
      const s = B.MeshBuilder.CreateSphere(`ce-key-${i}`, { diameter: 0.45, segments: 8 }, scene);
      s.position.set(k.pos[0], k.pos[1], k.pos[2]); s.material = mat; s.isPickable = false; s.metadata = { decor: true, share: true };
      st.marks.push(s);
      const aimLine = B.MeshBuilder.CreateLines(`ce-aim-${i}`, { points: [new B.Vector3(...k.pos), new B.Vector3(...M.lerp3(k.pos, k.look, Math.min(1, 3 / Math.max(0.1, M.dist(k.pos, k.look)))))] }, scene);
      aimLine.color = new B.Color3(1, 0.8, 0.3); aimLine.isPickable = false; aimLine.metadata = { decor: true, share: true };
      st.marks.push(aimLine);
    });
    st.marks.push(mat);
    if (st.keys.length > 1) {
      const path = M.normalizePath(spec());
      const pts = [];
      const n = Math.min(200, Math.max(16, st.keys.length * 20));
      for (let i = 0; i <= n; i++) pts.push(new B.Vector3(...M.samplePath(path, (path.duration * i) / n).pos));
      st.line = B.MeshBuilder.CreateLines('ce-path', { points: pts }, scene);
      st.line.color = new B.Color3(0.42, 0.94, 1); st.line.isPickable = false; st.line.metadata = { decor: true, share: true };
    }
  }

  H.hooks.world.push({ enter() { st.marks = []; st.line = null; render(); }, leave() { st.marks = []; st.line = null; } });
  // Building <-> playing switches without a new world in some paths: keep the button's visibility right.
  let lastMode = H.mode;
  let shown = true;
  H.hooks.frame.push(() => {
    if (H.mode !== lastMode) { lastMode = H.mode; render(); }
    // The dots and lines stay out of the picture while a shot plays (previews and recordings).
    const want = !(S.cinematic && S.cinematic.isPlaying) && !(S.photo && S.photo.on);
    if (want !== shown) { shown = want; for (const m of [...st.marks, st.line]) if (m && m.setEnabled) m.setEnabled(want); }
  });
})();
