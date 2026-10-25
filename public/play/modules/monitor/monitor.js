// The resource monitor: Ctrl+Shift+M in any game (ours to know; it isn't in the docs the assistant reads or in any menu).
// Frame time, draw calls, triangles, meshes, texture and JS memory, physics, the network and the device's budgets, from
// Babylon's own counters (SceneInstrumentation, EngineInstrumentation) and the engine's (H.textures, H.sync, H.budget).
// It costs nothing while closed: the counters are made when it opens and disposed when it closes. The Inspector button
// loads Babylon's full Inspector from the CDN (about 2 MB) for digging into one mesh, material or texture.
//   HawkesPlay.monitor.toggle() / open() / close() / sample()   the same from the console
(() => {
  const H = window.HawkesPlay;
  if (!H) return;
  const B = window.BABYLON;
  const INSPECTOR = 'https://cdn.jsdelivr.net/npm/babylonjs-inspector@7.54.3/babylon.inspector.bundle.js';
  const W = () => H.world;
  let el = null, sceneI = null, engineI = null, timer = 0, stepStart = 0, stepMs = 0, stepAvg = 0;
  const fpsHistory = [];

  // The fixed step's own cost (scripts, behaviors, Havok, contacts): from the first step hook to the last afterStep hook.
  H.hooks.step.unshift(() => { if (el) stepStart = performance.now(); });
  H.hooks.afterStep.push(() => {
    if (!el || !stepStart) return;
    stepMs = performance.now() - stepStart;
    stepAvg = stepAvg ? stepAvg * 0.9 + stepMs * 0.1 : stepMs;
  });

  const fmt = (n, d = 0) => (n === null || n === undefined || Number.isNaN(n) ? '–' : Number(n).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d }));
  const mb = (bytes) => (bytes ? `${fmt(bytes / 1048576, 1)} MB` : '–');

  /** Draws and triangles counted from what the camera draws, for an engine whose own counters are idle (the null engine of the
   *  tests): one draw per mesh with a material and triangles in the active list, instances of one source (at the level of detail
   *  the camera picks) going out as a single batch; every instance's triangles are drawn. */
  function activeDraws(scene) {
    const list = scene.getActiveMeshes();
    const seen = new Set();
    let draws = 0, tris = 0;
    for (let i = 0; i < list.length; i++) {
      const m = list.data[i];
      const src = m._currentLOD || m.sourceMesh || m;
      const t = src.getTotalIndices() / 3;
      if (!src.material || !t) continue;
      tris += t;
      if (seen.has(src.uniqueId)) continue;
      seen.add(src.uniqueId);
      draws += src.subMeshes ? src.subMeshes.length : 1;
    }
    return { draws, tris: Math.round(tris) };
  }

  /** Everything the panel shows, as numbers (also for the console and tests). */
  function sample() {
    const w = W();
    const scene = w && w.scene;
    if (!scene) return null;
    const engine = scene.getEngine();
    const tex = H.textures && H.textures.stats ? H.textures.stats() : null;
    const net = H.sync && H.sync.stats ? H.sync.stats() : null;
    const ents = w.entities ? [...w.entities] : [];
    const mem = performance.memory || null;
    const act = activeDraws(scene);
    return {
      fps: engine.getFps(),
      frameMs: (sceneI && sceneI.frameTimeCounter.lastSecAverage) || (sceneI ? engine.getDeltaTime() || null : null),
      renderMs: sceneI ? sceneI.renderTimeCounter.lastSecAverage : null,
      gpuMs: engineI && engineI.gpuFrameTimeCounter && engineI.gpuFrameTimeCounter.lastSecAverage ? engineI.gpuFrameTimeCounter.lastSecAverage * 1e-6 : null,
      stepMs: stepAvg || null,
      drawCalls: sceneI ? (sceneI.drawCallsCounter.current || act.draws) : null,
      triangles: Math.round(scene.getActiveIndices() / 3),
      activeDraws: act.draws,
      activeTriangles: act.tris,
      characters: H.presence && H.presence.crowd ? H.presence.crowd() : null,
      vertices: scene.getTotalVertices(),
      activeMeshes: scene.getActiveMeshes().length,
      meshes: scene.meshes.length,
      materials: scene.materials.length,
      textures: scene.textures.length,
      lights: scene.lights.length,
      textureMB: tex ? tex.usedMB : null,
      textureBudgetMB: tex ? tex.budgetMB : null,
      textureLoading: tex ? tex.loading : null,
      heapMB: mem ? mem.usedJSHeapSize / 1048576 : null,
      heapLimitMB: mem ? mem.jsHeapSizeLimit / 1048576 : null,
      entities: ents.length,
      dynamic: ents.filter((e) => e.physics === 'dynamic').length,
      rttMs: net && net.rtt !== undefined ? net.rtt : null,
      upKBs: net && net.seconds ? net.up / 1024 / net.seconds : null,
      downKBs: net && net.seconds ? net.down / 1024 / net.seconds : null,
      corrections: net ? net.corrections : null,
      width: engine.getRenderWidth(),
      height: engine.getRenderHeight(),
      scaling: engine.getHardwareScalingLevel(),
      tier: H.device ? H.device.tier : null,
      timeScale: H.timeScale !== undefined ? H.timeScale : 1,
    };
  }

  // ------------------------------------------------------------------ the panel

  function css() {
    if (document.getElementById('hp-monitor-css')) return;
    const s = document.createElement('style');
    s.id = 'hp-monitor-css';
    s.textContent = `
      .hp-monitor { position: fixed; top: 10px; right: 10px; z-index: 2147483000; width: 248px; padding: 10px 12px 12px;
        background: rgba(8, 10, 18, .86); color: #d7dcf0; border: 1px solid rgba(255, 255, 255, .12); border-radius: 10px;
        font: 11.5px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; pointer-events: auto; user-select: none;
        backdrop-filter: blur(6px); }
      .hp-monitor h6 { margin: 8px 0 3px; font: inherit; font-size: 10px; letter-spacing: .1em; text-transform: uppercase; color: #7e87a8; }
      .hp-monitor .top { display: flex; align-items: baseline; gap: 8px; }
      .hp-monitor .fps { font-size: 22px; font-weight: 600; color: #fff; }
      .hp-monitor .fps.warn { color: #fbbf24; } .hp-monitor .fps.bad { color: #f87171; }
      .hp-monitor .row { display: flex; justify-content: space-between; gap: 10px; }
      .hp-monitor .row span:last-child { color: #fff; text-align: right; }
      .hp-monitor canvas { display: block; width: 100%; height: 34px; margin-top: 6px; }
      .hp-monitor .btns { display: flex; gap: 6px; margin-top: 9px; }
      .hp-monitor button { flex: 1; padding: 4px 0; border: 1px solid rgba(255, 255, 255, .18); border-radius: 6px; background: rgba(255, 255, 255, .06);
        color: #d7dcf0; font: inherit; cursor: pointer; }
      .hp-monitor button:hover { background: rgba(255, 255, 255, .14); }
      .hp-monitor.left { right: auto; left: 10px; }
      .hp-monitor .x { position: absolute; top: 6px; right: 8px; color: #7e87a8; cursor: pointer; }`;
    document.head.appendChild(s);
  }

  function rows(list) {
    return list.map(([k, v]) => `<div class="row"><span>${k}</span><span>${v}</span></div>`).join('');
  }

  function draw() {
    const s = sample();
    if (!el || !s) return;
    fpsHistory.push(s.fps);
    if (fpsHistory.length > 120) fpsHistory.shift();
    const fpsCls = s.fps < 30 ? 'bad' : s.fps < 55 ? 'warn' : '';
    el.querySelector('.body').innerHTML = `
      <div class="top"><span class="fps ${fpsCls}">${fmt(s.fps)}</span><span>fps · ${fmt(s.frameMs, 1)} ms frame</span></div>
      <h6>Frame</h6>${rows([
        ['render (CPU)', `${fmt(s.renderMs, 1)} ms`], ['GPU', s.gpuMs ? `${fmt(s.gpuMs, 1)} ms` : 'n/a here'],
        ['step (scripts, physics)', `${fmt(s.stepMs, 2)} ms`], ['time scale', fmt(s.timeScale, 2)]])}
      <h6>Drawing</h6>${rows([
        ['draw calls', s.drawCalls ? fmt(s.drawCalls) : `~${fmt(s.activeDraws)}`], ['triangles drawn', fmt(s.triangles)], ['vertices', fmt(s.vertices)],
        ['meshes drawn / all', `${fmt(s.activeMeshes)} / ${fmt(s.meshes)}`], ['materials', fmt(s.materials)],
        ['textures', fmt(s.textures)], ['lights', fmt(s.lights)]])}
      ${s.characters && s.characters.bodies ? `<h6>Characters</h6>${rows([
        ['bodies', fmt(s.characters.bodies)], ['animated in full / cap', `${fmt(s.characters.full)} / ${fmt(s.characters.cap)}`],
        ['cheap level', fmt(s.characters.simple)], [`past ${fmt(s.characters.farAt)} m`, fmt(s.characters.far)]])}` : ''}
      <h6>Memory</h6>${rows([
        ['textures (GPU)', s.textureMB !== null ? `${fmt(s.textureMB, 1)} / ${fmt(s.textureBudgetMB, 0)} MB` : '–'],
        ['textures loading', fmt(s.textureLoading)],
        ['JS heap', s.heapMB ? `${fmt(s.heapMB, 0)} / ${fmt(s.heapLimitMB, 0)} MB` : 'n/a here']])}
      <h6>World</h6>${rows([['things', fmt(s.entities)], ['moving (dynamic)', fmt(s.dynamic)]])}
      ${s.rttMs !== null || s.downKBs ? `<h6>Network</h6>${rows([
        ['ping', s.rttMs !== null ? `${fmt(s.rttMs)} ms` : '–'], ['up / down', `${fmt(s.upKBs, 1)} / ${fmt(s.downKBs, 1)} KB/s`],
        ['corrections', fmt(s.corrections)]])}` : ''}
      <h6>Device</h6>${rows([
        ['tier', s.tier || '–'], ['resolution', `${s.width}×${s.height}`], ['hardware scaling', fmt(s.scaling, 2)]])}`;
    const c = el.querySelector('canvas');
    const g = c.getContext('2d');
    c.width = c.clientWidth * 2; c.height = c.clientHeight * 2;
    g.clearRect(0, 0, c.width, c.height);
    g.strokeStyle = 'rgba(255,255,255,.12)';
    for (const f of [30, 60]) { const y = c.height - (f / 75) * c.height; g.beginPath(); g.moveTo(0, y); g.lineTo(c.width, y); g.stroke(); }
    g.strokeStyle = '#60a5fa'; g.lineWidth = 2; g.beginPath();
    fpsHistory.forEach((f, i) => { const x = (i / 119) * c.width; const y = c.height - Math.min(1, f / 75) * c.height; if (i) g.lineTo(x, y); else g.moveTo(x, y); });
    g.stroke();
  }

  function counters(scene) {
    if (sceneI) return;
    sceneI = new B.SceneInstrumentation(scene);
    sceneI.captureFrameTime = true;
    sceneI.captureRenderTime = true;
    try { engineI = new B.EngineInstrumentation(scene.getEngine()); engineI.captureGPUFrameTime = true; } catch { engineI = null; }
  }
  /** The counters without the panel (a playtest, game.overseer.presence().cost): sample() then gives frame ms and draw calls.
   *  probe(false) lets them go again (a panel that is open keeps its own). */
  let probing = false;
  function probe(on = true) {
    const w = W();
    if (on) { if (w && w.scene) { probing = true; counters(w.scene); } return; }
    probing = false;
    if (!el) { if (sceneI) sceneI.dispose(); if (engineI) engineI.dispose(); sceneI = engineI = null; }
  }

  function open() {
    const w = W();
    if (el || !w || !w.scene) return;
    css();
    el = document.createElement('div');
    el.className = 'hp-monitor';
    el.innerHTML = '<span class="x" title="Close (Ctrl+Shift+M)">×</span><div class="body"></div><canvas></canvas><div class="btns"><button type="button" data-a="inspector">Inspector</button><button type="button" data-a="copy">Copy</button></div>';
    el.querySelector('.x').onclick = close;
    el.querySelector('[data-a=inspector]').onclick = inspector;
    el.querySelector('[data-a=copy]').onclick = () => { try { navigator.clipboard.writeText(JSON.stringify(sample(), null, 2)); } catch { /* no clipboard in this frame */ } };
    for (const ev of ['pointerdown', 'mousedown', 'click', 'wheel']) el.addEventListener(ev, (e) => e.stopPropagation());
    document.body.appendChild(el);
    counters(w.scene);
    draw();
    timer = setInterval(draw, 250);
  }

  function close() {
    clearInterval(timer);
    try { const sc = W() && W().scene; if (sc && sc.debugLayer.isVisible()) sc.debugLayer.hide(); } catch { /* no inspector */ }
    if (el) el.remove();
    el = null;
    if (!probing) { if (sceneI) sceneI.dispose(); if (engineI) engineI.dispose(); sceneI = engineI = null; }
    stepAvg = 0;
    fpsHistory.length = 0;
  }

  async function inspector() {
    const scene = W() && W().scene;
    if (!scene) return;
    if (!B.Inspector && !document.querySelector(`script[src="${INSPECTOR}"]`)) {
      await new Promise((ok, fail) => { const s = document.createElement('script'); s.src = INSPECTOR; s.onload = ok; s.onerror = fail; document.head.appendChild(s); }).catch(() => {});
    }
    // (A game page's policy lists the CDN the Inspector comes from, server.ts PLAY_HOSTS; without it, say so.)
    if (!B.Inspector) {
      const b = el && el.querySelector('[data-a="inspector"]');
      if (b) { b.textContent = 'Inspector off'; b.title = 'The Inspector did not load here (blocked or offline)'; b.disabled = true; }
      return;
    }
    // The Inspector docks on the right: the monitor moves over to the left while it's open.
    if (scene.debugLayer.isVisible()) scene.debugLayer.hide();
    else await scene.debugLayer.show({ embedMode: true, overlay: true }).catch(() => {});
    if (el) el.classList.toggle('left', scene.debugLayer.isVisible());
  }

  // A new world (hot reload, a restart) gets fresh counters on its own scene.
  let reopen = false;
  H.hooks.world.push({ leave() { if (el) { close(); reopen = true; } if (probing) { probing = false; sceneI = engineI = null; } } });
  H.hooks.frame.push(() => { if (reopen && W() && W().scene) { reopen = false; open(); } });

  window.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.altKey || (e.key !== 'M' && e.key !== 'm' && e.code !== 'KeyM')) return;
    e.preventDefault();
    e.stopPropagation();
    if (el) close(); else open();
  }, true);

  H.monitor = { open, close, probe, toggle: () => (el ? close() : open()), sample, get isOpen() { return Boolean(el); } };
})();
