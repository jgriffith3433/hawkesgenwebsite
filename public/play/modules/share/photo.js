// Photo mode (P, or the 📷 button): the game stops (or slows, or keeps going when friends are playing), a free camera
// flies anywhere (WASD + mouse, Q/E down and up, Shift faster; the touch stick and up/down buttons; a gamepad's sticks
// and triggers), and a panel sets the shot: field of view, tilt, depth of field, a look (vivid, noir, warm, cool,
// retro), a frame (letterbox, border, polaroid), the size (the screen or twice it). Space (or the button, or A) takes
// it: a PNG to download or share. Esc (or B) goes back to the game exactly as it was.
/* global HawkesPlay, BABYLON, HawkesShareMath */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const M = window.HawkesShareMath;
  const S = H.share;
  const RAD = Math.PI / 180;
  const W = () => H.world;

  const css = document.createElement('style');
  css.textContent = `
    .ph-panel { position: fixed; left: 50%; bottom: max(12px, env(safe-area-inset-bottom)); transform: translateX(-50%); z-index: 35; width: min(920px, calc(100vw - 24px)); box-sizing: border-box; padding: 10px 12px; border-radius: 14px; background: rgba(10,14,26,.84); backdrop-filter: blur(12px); box-shadow: inset 0 0 0 1px rgba(110,190,255,.3), 0 18px 50px rgba(0,0,0,.5); display: grid; gap: 8px; pointer-events: auto; }
    .ph-panel[hidden], .ph-show[hidden], .ph-sticks[hidden], .ph-frame[hidden] { display: none; }
    .ph-row { display: flex; flex-wrap: wrap; gap: 10px 16px; align-items: center; }
    .ph-group { display: flex; align-items: center; gap: 6px; font: 700 10.5px 'Orbitron', sans-serif; letter-spacing: .14em; text-transform: uppercase; color: rgba(170,215,255,.8); }
    .ph-chips { display: flex; flex-wrap: wrap; gap: 3px; padding: 3px; border-radius: 9px; background: rgba(255,255,255,.05); }
    .ph-chips button { font: 700 12px 'Rajdhani', sans-serif; letter-spacing: .06em; text-transform: uppercase; padding: 6px 9px; border: 0; border-radius: 7px; background: transparent; color: #a9c0dc; cursor: pointer; }
    .ph-chips button.on { background: linear-gradient(90deg, #4a9eff, #a855f7); color: #fff; }
    .ph-group input[type=range] { width: 110px; accent-color: #6cf0ff; }
    .ph-group output { font: 600 12px 'Rajdhani', sans-serif; color: #e8f4ff; min-width: 34px; letter-spacing: .04em; }
    .ph-shoot { margin-left: auto; display: flex; gap: 8px; }
    .ph-shoot button { font: 700 13px 'Rajdhani', sans-serif; letter-spacing: .1em; text-transform: uppercase; padding: 10px 16px; border-radius: 10px; border: 1px solid rgba(160,220,255,.3); background: rgba(255,255,255,.06); color: #fff; cursor: pointer; }
    .ph-shoot .ph-take { background: linear-gradient(90deg, #4a9eff, #a855f7); border: 0; padding: 10px 20px; }
    .ph-hint { font: 600 11px 'Rajdhani', sans-serif; letter-spacing: .14em; text-transform: uppercase; color: rgba(190,225,255,.6); }
    .ph-show { position: fixed; right: 14px; bottom: 14px; z-index: 35; width: 40px; height: 40px; border-radius: 50%; border: 1px solid rgba(160,220,255,.35); background: rgba(10,16,30,.45); color: #fff; cursor: pointer; pointer-events: auto; }
    .ph-frame { position: fixed; inset: 0; z-index: 29; pointer-events: none; box-sizing: border-box; }
    .ph-frame.border { border: 2.5vw solid #fff; }
    .ph-frame.polaroid { border: 3.5vw solid #f6f3ea; border-bottom-width: 12vw; }
    .ph-frame .ph-grid { position: absolute; inset: 0; background-image: linear-gradient(to right, rgba(255,255,255,.18) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,.18) 1px, transparent 1px); background-size: 33.333% 33.333%; background-position: -1px -1px; }
    .ph-look { position: fixed; inset: 0; z-index: 28; pointer-events: auto; cursor: grab; touch-action: none; }
    .ph-look:active { cursor: grabbing; }
    .ph-look[hidden] { display: none; }
    .ph-sticks { position: fixed; inset: 0; z-index: 34; pointer-events: none; }
    .ph-pad { position: fixed; left: max(20px, env(safe-area-inset-left)); bottom: var(--ph-above, 180px); width: 120px; height: 120px; border-radius: 50%; background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.3); pointer-events: auto; touch-action: none; }
    .ph-pad i { position: absolute; left: 36px; top: 36px; width: 48px; height: 48px; border-radius: 50%; background: rgba(255,255,255,.45); pointer-events: none; }
    .ph-ud { position: fixed; right: max(16px, env(safe-area-inset-right)); bottom: var(--ph-above, 190px); display: grid; gap: 10px; pointer-events: auto; }
    .ph-ud button { width: 56px; height: 56px; border-radius: 50%; border: 1px solid rgba(255,255,255,.4); background: rgba(10,12,20,.5); color: #fff; font: 20px system-ui; touch-action: none; }
    @media (max-width: 640px) { .ph-group input[type=range] { width: 80px; } .ph-hint { display: none; } .ph-panel { padding: 8px; gap: 6px; } }`;
  document.head.appendChild(css);

  const st = {
    on: false, panel: true, speed: 6, fov: 57, roll: 0, dof: false, focus: 0, look: 'none', frame: 'none', grid: false, size: 1, time: 'pause',
    pos: [0, 2, 0], yaw: 0, pitch: 0, ldx: 0, ldy: 0, keys: new Set(), stick: { x: 0, y: 0 }, ud: 0, focusAt: 0, shooting: false,
  };
  const FRAMES = [['none', 'None'], ['letterbox', 'Letterbox'], ['border', 'Border'], ['polaroid', 'Polaroid']];
  const LOOK_WORDS = { none: 'Natural', vivid: 'Vivid', noir: 'Noir', warm: 'Warm', cool: 'Cool', retro: 'Retro' };

  const panel = document.createElement('div');
  panel.className = 'ph-panel sh-keep';
  panel.hidden = true;
  document.body.appendChild(panel);
  const showBtn = document.createElement('button');
  showBtn.className = 'ph-show sh-keep'; showBtn.type = 'button'; showBtn.textContent = '◱'; showBtn.title = 'Show the photo panel (H)'; showBtn.hidden = true;
  document.body.appendChild(showBtn);
  const frameEl = document.createElement('div');
  frameEl.className = 'ph-frame sh-keep'; frameEl.hidden = true; frameEl.innerHTML = '<div class="ph-grid" hidden></div>';
  document.body.appendChild(frameEl);
  const sticks = document.createElement('div');
  sticks.className = 'ph-sticks sh-keep'; sticks.hidden = true;
  sticks.innerHTML = '<div class="ph-pad"><i></i></div><div class="ph-ud"><button type="button" data-ud="1" aria-label="Up">▲</button><button type="button" data-ud="-1" aria-label="Down">▼</button></div>';
  document.body.appendChild(sticks);
  // Looking: drag anywhere on the picture (a layer over the game, so nothing in the game gets clicked).
  const lookEl = document.createElement('div');
  lookEl.className = 'ph-look sh-keep'; lookEl.hidden = true;
  document.body.appendChild(lookEl);
  {
    let pid = null, lx = 0, ly = 0;
    lookEl.addEventListener('pointerdown', (e) => { e.stopPropagation(); pid = e.pointerId; lx = e.clientX; ly = e.clientY; try { lookEl.setPointerCapture(pid); } catch {} });
    lookEl.addEventListener('pointermove', (e) => { if (e.pointerId !== pid) return; st.ldx += e.clientX - lx; st.ldy += e.clientY - ly; lx = e.clientX; ly = e.clientY; });
    const end = (e) => { if (e.pointerId === pid) pid = null; };
    lookEl.addEventListener('pointerup', end); lookEl.addEventListener('pointercancel', end);
    lookEl.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  for (const el of [panel, showBtn, sticks]) { el.addEventListener('pointerdown', (e) => e.stopPropagation()); }
  showBtn.onclick = () => { st.panel = true; render(); };

  // The touch stick and the up/down buttons.
  {
    const pad = sticks.querySelector('.ph-pad'), knob = pad.querySelector('i');
    let pid = null;
    const move = (e) => {
      const r = pad.getBoundingClientRect();
      let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      const max = r.width / 2, d = Math.hypot(dx, dy);
      if (d > max) { dx = (dx / d) * max; dy = (dy / d) * max; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      st.stick.x = dx / max; st.stick.y = -dy / max;
    };
    pad.addEventListener('pointerdown', (e) => { pid = e.pointerId; try { pad.setPointerCapture(pid); } catch {} move(e); });
    pad.addEventListener('pointermove', (e) => { if (e.pointerId === pid) move(e); });
    const end = () => { pid = null; st.stick.x = 0; st.stick.y = 0; knob.style.transform = ''; };
    pad.addEventListener('pointerup', end); pad.addEventListener('pointercancel', end);
    for (const b of sticks.querySelectorAll('[data-ud]')) {
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); st.ud = Number(b.dataset.ud); });
      const up = () => { st.ud = 0; };
      b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('pointerleave', up);
    }
  }

  function chips(name, list, cur) {
    return `<div class="ph-chips" data-set="${name}">${list.map(([v, t]) => `<button type="button" data-v="${v}" class="${String(cur) === String(v) ? 'on' : ''}">${t}</button>`).join('')}</div>`;
  }
  function render() {
    panel.hidden = !st.on || !st.panel;
    showBtn.hidden = !st.on || st.panel;
    sticks.hidden = !st.on || !H.touchUi;
    lookEl.hidden = !st.on;
    frameEl.hidden = !st.on || (st.frame === 'none' && !st.grid);
    frameEl.className = `ph-frame sh-keep ${st.frame === 'border' || st.frame === 'polaroid' ? st.frame : ''}`;
    if (frameEl.firstChild) frameEl.firstChild.hidden = !st.grid;
    if (!st.panel) sticks.style.setProperty('--ph-above', '40px');
    if (!st.on || !st.panel) return;
    const hasDof = Boolean(W() && W().look);
    panel.innerHTML = `
      <div class="ph-row">
        <div class="ph-group">Time ${chips('time', [['pause', 'Stop'], ['slow', 'Slow'], ['live', 'Live']], st.time)}</div>
        <div class="ph-group">Look ${chips('look', S.LOOKS.map((l) => [l, LOOK_WORDS[l] || l]), st.look)}</div>
        <div class="ph-group">Frame ${chips('frame', FRAMES, st.frame)}</div>
      </div>
      <div class="ph-row">
        <label class="ph-group">Zoom <input type="range" min="15" max="110" step="1" value="${st.fov}" data-r="fov"><output>${st.fov}°</output></label>
        <label class="ph-group">Tilt <input type="range" min="-35" max="35" step="1" value="${st.roll}" data-r="roll"><output>${st.roll}°</output></label>
        ${hasDof ? `<div class="ph-group">Blur ${chips('dof', [['off', 'Off'], ['on', 'On']], st.dof ? 'on' : 'off')}</div>${st.dof ? `<label class="ph-group">Focus <input type="range" min="0" max="80" step="0.5" value="${st.focus}" data-r="focus"><output>${st.focus ? `${st.focus} m` : 'auto'}</output></label>` : ''}` : ''}
        <div class="ph-group">Grid ${chips('grid', [['off', 'Off'], ['on', 'On']], st.grid ? 'on' : 'off')}</div>
        <div class="ph-group">Size ${chips('size', [[1, '1×'], [2, '2×']], st.size)}</div>
        <div class="ph-shoot"><button type="button" data-a="exit">Back</button><button type="button" class="ph-take" data-a="take">📷 Take</button></div>
      </div>
      <div class="ph-hint">${H.touchUi ? 'Stick moves · ▲▼ up and down · drag looks' : 'WASD move · Q/E down/up · Shift faster · mouse or drag looks · wheel zooms · Z/X tilt · Space takes it · H hides this · Esc goes back'}</div>`;
    panel.querySelectorAll('[data-set]').forEach((g) => g.querySelectorAll('button').forEach((b) => { b.onclick = () => set(g.dataset.set, b.dataset.v); }));
    panel.querySelectorAll('[data-r]').forEach((r) => { r.oninput = () => { set(r.dataset.r, Number(r.value), true); r.nextElementSibling.textContent = r.dataset.r === 'focus' ? (st.focus ? `${st.focus} m` : 'auto') : `${r.value}°`; }; });
    panel.querySelector('[data-a="exit"]').onclick = () => exit();
    panel.querySelector('[data-a="take"]').onclick = () => take();
    // Phones: the stick and the up/down buttons sit just above the panel.
    requestAnimationFrame(() => { sticks.style.setProperty('--ph-above', `${Math.round((panel.hidden ? 0 : panel.offsetHeight) + 24)}px`); });
  }

  function set(k, v, quiet) {
    if (k === 'time') { st.time = v; applyTime(); }
    if (k === 'look') st.look = S.look(v);
    if (k === 'frame') { st.frame = v; S.letterbox(v === 'letterbox'); }
    if (k === 'grid') st.grid = v === 'on';
    if (k === 'size') st.size = Number(v) || 1;
    if (k === 'fov') st.fov = M.clamp(Number(v), 15, 110);
    if (k === 'roll') st.roll = M.clamp(Number(v), -35, 35);
    if (k === 'focus') st.focus = Number(v) || 0;
    if (k === 'dof') { st.dof = v === 'on'; applyDof(); }
    if (!quiet) render();
    else { frameEl.hidden = !st.on || (st.frame === 'none' && !st.grid); }
  }
  function applyTime() { S.timeScale('photo', st.time === 'pause' ? 0 : st.time === 'slow' ? 0.2 : null); }
  const dofSaved = { on: null };
  function applyDof() {
    const p = W() && W().look;
    if (!p) return;
    try {
      if (dofSaved.on === null) dofSaved.on = p.depthOfFieldEnabled;
      p.depthOfFieldEnabled = st.dof;
      if (st.dof) { p.depthOfFieldBlurLevel = 1; p.depthOfField.fStop = 1.4; p.depthOfField.focalLength = 50; }
    } catch (e) { st.dof = false; }
  }
  function focusNow(dt) {
    const p = W() && W().look;
    if (!st.dof || !p) return;
    let d = st.focus;
    if (!d) {
      // Autofocus: whatever is in the middle of the picture, checked a few times a second.
      st.focusAt -= dt;
      if (st.focusAt <= 0) {
        st.focusAt = 0.2;
        const v = S.viewPose(200);
        st.autoFocus = v ? Math.max(0.5, M.dist(v.pos, v.look)) : 10;
      }
      d = st.autoFocus || 10;
    }
    try { p.depthOfField.focusDistance = d * 1000; } catch {}
  }

  function enter() {
    const w = W();
    const s = S.settings();
    if (!w || st.on || s.off || !s.photo) return;
    if (S.cinematic && S.cinematic.playing) S.cinematic.stop();
    st.on = true;
    if (document.pointerLockElement) { try { document.exitPointerLock(); } catch {} }
    S.takeCamera('photo');
    const p = S.cameraPose();
    st.pos = p.pos; st.yaw = p.yaw; st.pitch = p.pitch; st.roll = 0; st.fov = Math.round(p.fov) || 57;
    st.time = S.together() ? 'live' : 'pause';
    applyTime();
    S.clean('photo', true);
    st.keys.clear();
    if (H.input && H.input.held) H.input.held.clear();
    st.panel = true;
    render();
    S.toast(H.touchUi ? 'Photo mode' : 'Photo mode · Space takes it · Esc goes back', 2.4);
  }
  function exit() {
    if (!st.on) return;
    st.on = false;
    S.timeScale('photo', null);
    S.look('none'); st.look = 'none';
    S.letterbox(false); st.frame = 'none';
    if (dofSaved.on !== null) { try { W().look.depthOfFieldEnabled = dofSaved.on; } catch {} dofSaved.on = null; }
    st.dof = false;
    S.clean('photo', false);
    S.releaseCamera('photo');
    S.closeReview();
    st.keys.clear();
    render();
  }

  async function take() {
    if (!st.on || st.shooting) return;
    st.shooting = true;
    try {
      const raw = await S.grab(st.size);
      if (!raw) { S.toast("This picture can't be saved (the browser refused)"); return; }
      S.flash();
      const pic = S.compose(raw, { frame: st.frame, caption: S.settings().caption });
      const blob = await S.toBlob(pic, 'image/png');
      if (!blob) { S.toast('Could not make the picture'); return; }
      try { if (H.game) H.game.emit('photo', { space: H.sky ? H.sky.space : 0, hour: H.sky ? H.sky.hour : null }); } catch { /* a listener's trouble is its own */ }
      S.review({ kind: 'photo', blob, mime: 'image/png', width: pic.width, height: pic.height });
    } finally { st.shooting = false; }
  }

  // Keys: while in photo mode they're ours (the game hears none of them).
  const typing = (e) => { const t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); };
  const keyOf = (e) => (e.key === ' ' ? 'space' : String(e.key || '').toLowerCase());
  window.addEventListener('keydown', (e) => {
    if (typing(e)) return;
    const k = keyOf(e);
    const s = S.settings();
    if (!st.on) {
      if (k === s.keys.photo && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat && W() && !s.off && s.photo && !S.reviewing) { e.preventDefault(); e.stopPropagation(); enter(); }
      return;
    }
    if (S.reviewing) { if (k === 'escape') { S.closeReview(); e.stopPropagation(); } return; }
    e.stopPropagation();
    if (['space', 'tab', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
    if (e.repeat) return;
    if (k === 'escape' || k === s.keys.photo) exit();
    else if (k === 'space' || k === 'enter') take();
    else if (k === 'h') { st.panel = !st.panel; render(); }
    st.keys.add(k);
  }, true);
  window.addEventListener('keyup', (e) => { if (st.on) { st.keys.delete(keyOf(e)); e.stopPropagation(); } }, true);
  window.addEventListener('blur', () => st.keys.clear());
  window.addEventListener('wheel', (e) => {
    if (!st.on || S.reviewing || (e.target && e.target.closest && e.target.closest('.ph-panel'))) return;
    set('fov', st.fov + Math.sign(e.deltaY) * 3, true);
    const r = panel.querySelector('[data-r="fov"]');
    if (r) { r.value = String(st.fov); r.nextElementSibling.textContent = `${st.fov}°`; }
  }, { passive: true, capture: true });

  // Gamepad: left stick moves, right stick looks, triggers down/up, A takes, B goes back, Y hides the panel.
  const pad = { a: false, b: false, y: false };
  function gamepad() {
    let gp = null;
    try { gp = [...(navigator.getGamepads ? navigator.getGamepads() : [])].find((g) => g && g.connected); } catch {}
    if (!gp) return null;
    const dz = (v) => (Math.abs(v) < 0.15 ? 0 : v);
    const btn = (i) => Boolean(gp.buttons[i] && gp.buttons[i].pressed);
    const out = { mx: dz(gp.axes[0] || 0), mz: -dz(gp.axes[1] || 0), lx: dz(gp.axes[2] || 0), ly: dz(gp.axes[3] || 0), up: (gp.buttons[7] ? gp.buttons[7].value : 0) - (gp.buttons[6] ? gp.buttons[6].value : 0), fast: btn(10) };
    const a = btn(0), b = btn(1), y = btn(3);
    if (a && !pad.a) take();
    if (b && !pad.b) exit();
    if (y && !pad.y) { st.panel = !st.panel; render(); }
    Object.assign(pad, { a, b, y });
    return out;
  }

  H.hooks.frame.push((elapsed) => {
    if (!st.on) return;
    if (!S.camera || S.cameraOwner !== 'photo') { st.on = false; render(); return; }
    const dt = Math.min(0.1, elapsed);
    const k = st.keys;
    const gp = gamepad();
    if (!S.reviewing) {
      const look = H.touchUi ? 0.25 : 0.18;
      st.yaw += st.ldx * look * RAD * (st.fov / 57);
      st.pitch = M.clamp(st.pitch + st.ldy * look * RAD * (st.fov / 57), -1.55, 1.55);
      if (gp) { st.yaw += gp.lx * 2.2 * dt; st.pitch = M.clamp(st.pitch + gp.ly * 1.6 * dt, -1.55, 1.55); }
      const inp = {
        x: (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0) + st.stick.x + (gp ? gp.mx : 0),
        z: (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0) + st.stick.y + (gp ? gp.mz : 0),
        y: (k.has('e') ? 1 : 0) - (k.has('q') ? 1 : 0) + st.ud + (gp ? gp.up : 0),
      };
      const speed = st.speed * (k.has('shift') || (gp && gp.fast) ? 4 : 1) * (k.has('control') || k.has('alt') ? 0.25 : 1);
      const next = M.flyStep({ pos: st.pos, yaw: st.yaw, pitch: st.pitch }, inp, speed, dt);
      st.pos = next.pos;
      if (k.has('z')) st.roll = M.clamp(st.roll - 30 * dt, -35, 35);
      if (k.has('x')) st.roll = M.clamp(st.roll + 30 * dt, -35, 35);
    }
    const cam = S.camera;
    cam.position.set(st.pos[0], st.pos[1], st.pos[2]);
    cam.rotation.set(st.pitch, st.yaw, st.roll * RAD);
    cam.fov = st.fov * RAD;
    focusNow(dt);
    st.ldx = 0; st.ldy = 0;
  });

  H.hooks.world.push({ leave() { if (st.on) { st.on = false; S.clean('photo', false); st.keys.clear(); render(); } dofSaved.on = null; } });

  S.photo = {
    enter, exit, take,
    toggle: () => (st.on ? exit() : enter()),
    get on() { return st.on; },
    /** The free camera now: { pos, yaw, pitch, roll, fov } (degrees for roll and fov). */
    get pose() { return { pos: st.pos.slice(), yaw: st.yaw, pitch: st.pitch, roll: st.roll, fov: st.fov }; },
    set(k, v) { set(k, v); },
  };
})();
