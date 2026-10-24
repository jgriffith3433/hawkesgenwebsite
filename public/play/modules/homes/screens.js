// Screens and media: TVs, computers, phones and projectors that play shows, a security camera whose picture any
// screen can show (a studio's camera makes a live TV show), radios, a TV remote and a phone you hold.
// A screen has channels: a video asset ("cartoons.mp4"), a built-in show drawn live ("cartoons", "news", "nature",
// "sports", "weather", "music", "cooking", "desktop", "clock", "bars", "static"), a camera in the world
// ({ "camera": "studio_cam" } or the show it films), words ({ "text": "Hello" }), or a picture. A show with a video asset
// of its name ("cartoons.mp4") plays the video once it exists; until then it's drawn, so a TV works with no art.
/* global HawkesPlay, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = BABYLON;
  const L = H.lib;
  const M = H.homes;
  const RAD = Math.PI / 180;
  const W = () => H.world;
  const P = M.part;
  const num = (v, d) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : d);
  const say = (t, s = 1.6) => H.game && H.game.ui.message(t, s);
  const face = (yaw) => ({ rotation: [0, Math.round((yaw / RAD + 180) / 15) * 15, 0] });

  // ------------------------------------------------------------------ the built-in shows (drawn live, no art needed)
  const TITLE = { cartoons: 'Cartoons', news: 'News', nature: 'Nature', sports: 'Sports', weather: 'Weather', music: 'Music', cooking: 'Cooking', desktop: 'Desktop', clock: 'Clock', bars: 'Test card', static: 'Static' };
  const HEADLINES = ['Local cat elected mayor, promises naps', 'Sunny with a chance of meatballs', 'Scientists confirm: cozy is good', 'Town builds world\'s biggest sofa', 'Duck seen in bathtub, more at eleven'];
  const rr = (c, x, y, w, h, r, fill) => { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); c.fillStyle = fill; c.fill(); };
  const SHOWS = {
    cartoons(c, w, h, t) {
      const sky = c.createLinearGradient(0, 0, 0, h); sky.addColorStop(0, '#6ec6ff'); sky.addColorStop(1, '#c9f0ff');
      c.fillStyle = sky; c.fillRect(0, 0, w, h);
      c.fillStyle = '#ffe066'; c.beginPath(); c.arc(w - 40, 34, 20 + Math.sin(t * 3) * 2, 0, 7); c.fill();
      c.fillStyle = '#7bd389'; c.beginPath(); c.ellipse(w / 2, h + 40, w * 0.8, 90, 0, 0, 7); c.fill();
      const pals = [['#ff6b6b', 0], ['#845ef7', 1.7], ['#ffa94d', 3.1]];
      pals.forEach(([col, ph], i) => {
        const x = ((t * 55 + i * 110) % (w + 80)) - 40;
        const y = h - 52 - Math.abs(Math.sin(t * 4 + ph)) * 46;
        const sq = 1 + Math.max(0, 0.25 - Math.abs(Math.sin(t * 4 + ph))) * 0.8;
        c.save(); c.translate(x, y); c.scale(sq, 1 / sq);
        c.fillStyle = col; c.beginPath(); c.arc(0, 0, 22, 0, 7); c.fill();
        c.fillStyle = '#fff'; c.beginPath(); c.arc(-7, -5, 6, 0, 7); c.arc(8, -5, 6, 0, 7); c.fill();
        c.fillStyle = '#111'; c.beginPath(); c.arc(-6, -4, 3, 0, 7); c.arc(9, -4, 3, 0, 7); c.fill();
        c.strokeStyle = '#111'; c.lineWidth = 2; c.beginPath(); c.arc(1, 5, 8, 0.2, Math.PI - 0.2); c.stroke();
        c.restore();
      });
    },
    news(c, w, h, t, s) {
      c.fillStyle = '#123d7a'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#1d5bb5'; for (let i = 0; i < 6; i++) c.fillRect(i * 60 + ((t * 8) % 60), 0, 2, h - 40);
      c.fillStyle = '#2b2f3a'; c.fillRect(w * 0.18, h * 0.62, w * 0.64, h * 0.2);
      c.fillStyle = '#f1c27d'; c.beginPath(); c.arc(w / 2, h * 0.38, 24, 0, 7); c.fill();
      c.fillStyle = '#3b3f4a'; c.fillRect(w / 2 - 34, h * 0.48, 68, 34);
      c.fillStyle = '#111'; c.fillRect(w / 2 - 8, h * 0.38 + 8 + Math.abs(Math.sin(t * 9)) * 3, 16, 3);
      c.fillStyle = '#d63031'; c.fillRect(0, h - 42, 70, 24); c.fillStyle = '#fff'; c.font = 'bold 14px sans-serif'; c.fillText('LIVE', 16, h - 25);
      c.fillStyle = '#f5f6fa'; c.fillRect(70, h - 42, w - 70, 24);
      const lines = (s && s.headlines) || HEADLINES;
      const txt = lines.join('   •   ');
      c.fillStyle = '#111'; c.font = '600 14px sans-serif';
      const tw = c.measureText(txt).width + 60;
      const x = 80 + w - ((t * 50) % (tw + w));
      c.save(); c.beginPath(); c.rect(70, h - 42, w - 70, 24); c.clip(); c.fillText(txt, x, h - 25); c.restore();
      c.fillStyle = '#0a1f40'; c.fillRect(0, h - 18, w, 18);
      c.fillStyle = '#9fc3ff'; c.font = '12px monospace'; c.fillText(new Date().toLocaleTimeString(), 8, h - 5);
    },
    nature(c, w, h, t) {
      const sky = c.createLinearGradient(0, 0, 0, h); sky.addColorStop(0, '#ffb88c'); sky.addColorStop(1, '#ffe7c2');
      c.fillStyle = sky; c.fillRect(0, 0, w, h);
      const hills = [['#8fbf7a', 0.55, 8, 30], ['#5f9c5a', 0.68, 16, 22], ['#3d7044', 0.8, 30, 16]];
      for (const [col, y0, sp, amp] of hills) { c.fillStyle = col; c.beginPath(); c.moveTo(0, h); for (let x = 0; x <= w; x += 8) c.lineTo(x, h * y0 + Math.sin((x + t * sp) * 0.02) * amp); c.lineTo(w, h); c.fill(); }
      c.strokeStyle = '#333'; c.lineWidth = 2;
      for (let i = 0; i < 4; i++) { const x = (t * 30 + i * 70) % (w + 40) - 20, y = 40 + Math.sin(t + i) * 10 + i * 6, f = Math.sin(t * 8 + i) * 5; c.beginPath(); c.moveTo(x - 8, y - f); c.lineTo(x, y); c.lineTo(x + 8, y - f); c.stroke(); }
    },
    sports(c, w, h, t, s) {
      c.fillStyle = '#2f8f46'; c.fillRect(0, 0, w, h);
      c.strokeStyle = 'rgba(255,255,255,.8)'; c.lineWidth = 2; c.strokeRect(14, 14, w - 28, h - 28); c.beginPath(); c.moveTo(w / 2, 14); c.lineTo(w / 2, h - 14); c.stroke(); c.beginPath(); c.arc(w / 2, h / 2, 26, 0, 7); c.stroke();
      const bx = w / 2 + Math.sin(t * 0.9) * (w * 0.38), by = h / 2 + Math.sin(t * 1.7) * (h * 0.3);
      for (let i = 0; i < 10; i++) { const team = i % 2, a = t * (0.7 + i * 0.05) + i; const x = bx + Math.cos(a) * (30 + i * 7) * (team ? -1 : 1), y = by + Math.sin(a * 1.3) * (20 + i * 4); c.fillStyle = team ? '#ff6b6b' : '#4dabf7'; c.beginPath(); c.arc(x, y, 6, 0, 7); c.fill(); }
      c.fillStyle = '#fff'; c.beginPath(); c.arc(bx, by, 4, 0, 7); c.fill();
      if (!s.score) s.score = [0, 0];
      if (Math.abs(Math.sin(t * 0.9)) > 0.995 && (!s.lastGoal || t - s.lastGoal > 2)) { s.lastGoal = t; s.score[Math.sin(t * 0.9) > 0 ? 0 : 1]++; }
      rr(c, w / 2 - 44, 4, 88, 22, 6, 'rgba(0,0,0,.6)'); c.fillStyle = '#fff'; c.font = 'bold 15px sans-serif'; c.textAlign = 'center'; c.fillText(`${s.score[0]} - ${s.score[1]}`, w / 2, 20); c.textAlign = 'left';
    },
    weather(c, w, h, t) {
      c.fillStyle = '#e8f4ff'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#9ad08a'; c.beginPath(); c.moveTo(40, 40); c.bezierCurveTo(140, 10, 260, 50, 290, 100); c.bezierCurveTo(260, 160, 120, 170, 50, 140); c.closePath(); c.fill();
      const icons = [[90, 70, '☀', '24°'], [190, 60, '⛅', '19°'], [150, 120, '🌧', '15°'], [250, 115, '☀', '26°']];
      c.font = '24px sans-serif'; c.textAlign = 'center';
      icons.forEach(([x, y, ic, tp], i) => { c.fillText(ic, x, y + Math.sin(t * 2 + i) * 2); c.fillStyle = '#123d7a'; c.font = 'bold 13px sans-serif'; c.fillText(tp, x, y + 18); c.font = '24px sans-serif'; c.fillStyle = '#000'; });
      c.textAlign = 'left'; c.fillStyle = '#123d7a'; c.fillRect(0, h - 22, w, 22); c.fillStyle = '#fff'; c.font = 'bold 13px sans-serif'; c.fillText('WEATHER  ·  Mild and cozy all week', 10, h - 7);
    },
    music(c, w, h, t) {
      const g = c.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#2b1055'); g.addColorStop(1, '#d53369');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      const n = 24;
      for (let i = 0; i < n; i++) { const v = (Math.sin(t * 6 + i * 0.7) * 0.5 + 0.5) * (Math.sin(t * 2.3 + i * 1.9) * 0.3 + 0.7); const bh = 10 + v * (h - 50); c.fillStyle = `hsl(${(i * 12 + t * 40) % 360},90%,65%)`; c.fillRect(10 + i * ((w - 20) / n), h - 10 - bh, (w - 20) / n - 3, bh); }
      c.fillStyle = '#fff'; c.font = 'bold 15px sans-serif'; c.fillText('♪ Now playing: Cozy Beats', 12, 22);
    },
    cooking(c, w, h, t) {
      c.fillStyle = '#fff4e6'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#e9ecef'; c.fillRect(0, h * 0.62, w, h * 0.38);
      c.fillStyle = '#495057'; c.beginPath(); c.ellipse(w / 2, h * 0.7, 70, 20, 0, 0, 7); c.fill();
      c.fillStyle = '#ffd43b'; c.beginPath(); c.ellipse(w / 2, h * 0.68 - Math.abs(Math.sin(t * 3)) * 30, 30, 12, Math.sin(t * 3) * 0.6, 0, 7); c.fill();
      c.fillStyle = '#f1c27d'; c.beginPath(); c.arc(w * 0.22, h * 0.36, 20, 0, 7); c.fill();
      c.fillStyle = '#fff'; c.fillRect(w * 0.22 - 16, h * 0.36 - 38, 32, 18);
      c.fillStyle = '#d63031'; c.font = 'bold 15px sans-serif'; c.fillText('COOKING WITH BOB', w - 165, 22);
    },
    desktop(c, w, h, t, s) {
      const g = c.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#355c7d'); g.addColorStop(1, '#6c5b7b');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      rr(c, 30, 26, w * 0.55, h * 0.55, 6, '#f8f9fa'); c.fillStyle = '#dee2e6'; c.fillRect(30, 26, w * 0.55, 14);
      c.fillStyle = '#212529'; c.font = '11px monospace';
      const lines = (s && s.lines) || ['> hello, world', '> build a house', '> add a cozy sofa', '> done!'];
      const shown = Math.floor(t * 1.5) % (lines.length + 3);
      lines.slice(0, shown).forEach((ln, i) => c.fillText(ln, 38, 56 + i * 14));
      if (Math.floor(t * 2) % 2) c.fillRect(38 + (shown <= lines.length ? 0 : 0), 56 + Math.min(shown, lines.length) * 14 - 9, 7, 11);
      c.fillStyle = 'rgba(0,0,0,.45)'; c.fillRect(0, h - 18, w, 18);
      c.fillStyle = '#fff'; c.font = '11px sans-serif'; c.fillText(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), w - 48, h - 5);
    },
    clock(c, w, h) {
      c.fillStyle = '#0b0f19'; c.fillRect(0, 0, w, h);
      const d = new Date();
      c.fillStyle = '#7cf2c2'; c.font = 'bold 58px monospace'; c.textAlign = 'center'; c.fillText(d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), w / 2, h / 2 + 10);
      c.fillStyle = '#9aa6c2'; c.font = '15px sans-serif'; c.fillText(d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }), w / 2, h / 2 + 40); c.textAlign = 'left';
    },
    bars(c, w, h, t, s) {
      const cols = ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0'];
      cols.forEach((col, i) => { c.fillStyle = col; c.fillRect(i * w / 7, 0, w / 7 + 1, h * 0.72); });
      c.fillStyle = '#111'; c.fillRect(0, h * 0.72, w, h * 0.28);
      c.fillStyle = '#fff'; c.font = 'bold 15px sans-serif'; c.textAlign = 'center';
      c.fillText((s && s.title) || 'No signal', w / 2, h * 0.86);
      c.font = '11px sans-serif'; c.fillStyle = '#aaa'; c.fillText((s && s.sub) || '', w / 2, h * 0.95); c.textAlign = 'left';
    },
    static(c, w, h) {
      const img = c.createImageData(w, h);
      for (let i = 0; i < img.data.length; i += 4) { const v = Math.random() * 255 | 0; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
      c.putImageData(img, 0, 0);
    },
    text(c, w, h, t, s) {
      c.fillStyle = s.background || '#0b0f19'; c.fillRect(0, 0, w, h);
      c.fillStyle = s.color || '#ffffff'; c.textAlign = 'center'; c.textBaseline = 'middle';
      const text = String(typeof s.text === 'function' ? s.text() : s.text ?? '');
      const lines = text.split('\n');
      const size = Math.max(12, Math.min(64, Math.floor((h * 0.8) / lines.length), Math.floor(w / Math.max(4, ...lines.map((x) => x.length)) * 1.7)));
      c.font = `bold ${size}px Inter, system-ui, sans-serif`;
      lines.forEach((ln, i) => c.fillText(ln, w / 2, h / 2 + (i - (lines.length - 1) / 2) * size * 1.15));
      c.textAlign = 'left'; c.textBaseline = 'alphabetic';
    },
  };

  // ------------------------------------------------------------------ cameras: what a security camera sees, on a screen
  const isCam = (e) => e && e.alive && e._cctv;
  function findCamera(want) {
    if (!want) return null;
    const w = String(want).toLowerCase();
    for (const e of W().entities) if (isCam(e) && ((e.sceneId && e.sceneId.toLowerCase() === w) || (e.name && e.name.toLowerCase() === w) || (e._cctv.show && e._cctv.show.toLowerCase() === w) || (e.homes && e.homes.id.toLowerCase() === w))) return e;
    return null;
  }
  function feedOf(cam) {
    if (cam._feed) return cam._feed;
    const sc = W().scene;
    const fc = new B.FreeCamera('cctv', new B.Vector3(0, 0, 0), sc);
    fc.minZ = 0.05; fc.maxZ = 400; fc.fov = cam._cctv.fov;
    const rtt = new B.RenderTargetTexture('cctv', { width: 384, height: 216 }, sc, false);
    rtt.activeCamera = fc;
    rtt.refreshRate = 2;
    rtt.renderList = null;
    rtt.renderListPredicate = (m) => m.isEnabled() && m.isVisible && !(m.metadata && m.metadata.entity === cam) && m.name !== 'sky' && !(m.metadata && m.metadata.screen);
    const feed = { rtt, fc, users: 0, on: false };
    cam._feed = feed;
    cam.onDestroy(() => { const i = sc.customRenderTargets.indexOf(rtt); if (i >= 0) sc.customRenderTargets.splice(i, 1); rtt.dispose(); fc.dispose(); cam._feed = null; });
    return feed;
  }
  function aimFeed(cam) {
    const f = cam._feed;
    const at = M.worldPoint(cam, [0, 0, 0.12]);
    f.fc.position.set(at[0], at[1], at[2]);
    f.fc.rotation.set((cam._cctv.pitch || 0) * RAD, cam.node.rotation.y, 0);
  }

  // ------------------------------------------------------------------ a screen: a surface with a channel on it
  const screens = new Set();
  /** Makes `mesh` (a plane facing the thing's front) a screen of thing e. */
  function screen(e, mesh, o = {}) {
    const sc = W().scene;
    const m = new B.StandardMaterial('screen', sc);
    m.disableLighting = true;
    m.diffuseColor = new B.Color3(0, 0, 0);
    m.emissiveColor = new B.Color3(0.03, 0.035, 0.04);
    mesh.material = m;
    mesh.metadata = { ...(mesh.metadata || {}), keep: true, screen: true, noGlow: true }; // the glow would wash the picture out
    const res = o.small ? [192, 340] : [320, 180];
    const dyn = new B.DynamicTexture('screen', { width: res[0], height: res[1] }, sc, false);
    const s = { e, mesh, mat: m, dyn, w: res[0], h: res[1], cur: null, key: null, video: null, vtex: null, img: null, data: {}, t: 0, last: 0, feed: null, override: null };
    screens.add(s);
    e.onDestroy(() => { screens.delete(s); stopVideo(s); dyn.dispose(); if (s.img) s.img.dispose(); });
    return s;
  }
  function stopVideo(s) { if (s.vtex) { try { s.video.pause(); s.video.removeAttribute('src'); s.video.load(); } catch {} s.vtex.dispose(); s.vtex = null; s.video = null; } }
  /** What a channel entry means: { kind, title, ... }. */
  function resolve(ch) {
    if (ch === null || ch === undefined || ch === false || ch === 'off') return { kind: 'off', title: 'Off' };
    if (typeof ch === 'string') {
      if (/\.(mp4|webm|mov|m4v)$/i.test(ch)) return { kind: 'video', asset: ch, title: ch.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ') };
      if (/\.(png|jpe?g|webp|gif)$/i.test(ch)) return { kind: 'image', asset: ch, title: ch };
      if (/^cam(era)?:/i.test(ch)) return { kind: 'camera', camera: ch.replace(/^cam(era)?:/i, ''), title: ch.replace(/^cam(era)?:/i, '') };
      const k = ch.toLowerCase();
      if (SHOWS[k] && k !== 'text') return { kind: 'show', show: k, title: TITLE[k] || ch, asset: `${k}.mp4` };
      return { kind: 'camera-or-show', name: ch, title: ch };
    }
    if (typeof ch === 'object') {
      if (ch.camera) return { kind: 'camera', camera: ch.camera, title: ch.title || ch.camera };
      if (ch.asset || ch.video) return { kind: 'video', asset: ch.asset || ch.video, title: ch.title || String(ch.asset || ch.video), fallback: ch.show || null };
      if (ch.image) return { kind: 'image', asset: ch.image, title: ch.title || ch.image };
      if (ch.text !== undefined) return { kind: 'text', text: ch.text, title: ch.title || 'Text', color: ch.color, background: ch.background };
      if (ch.show) return { kind: 'show', show: String(ch.show).toLowerCase(), title: ch.title || TITLE[String(ch.show).toLowerCase()] || ch.show, asset: `${String(ch.show).toLowerCase()}.mp4`, headlines: ch.headlines, lines: ch.lines };
    }
    return { kind: 'off', title: 'Off' };
  }
  /** Puts a channel on a screen (null: off). Cheap to call every frame: it only changes when the channel does. */
  function tune(s, ch) {
    const r = resolve(ch);
    // A show with a video asset plays the video; a camera that isn't there (yet) is a test card.
    let kind = r.kind, asset = r.asset;
    if (kind === 'show') { const v = M.assetFor(r.show, 'video'); if (v) { kind = 'video'; asset = v; } }
    if (kind === 'camera-or-show') { if (findCamera(r.name)) { kind = 'camera'; r.camera = r.name; } else if (M.assetFor(r.name, 'video')) { kind = 'video'; asset = M.assetFor(r.name, 'video'); } else { kind = 'show'; r.show = 'bars'; r.sub = 'Waiting for this show'; } }
    if (kind === 'video' && !M.hasAssetRef(asset)) { kind = 'show'; r.show = r.fallback && SHOWS[r.fallback] ? r.fallback : 'bars'; r.sub = `${asset}: not made yet`; }
    const key = `${kind}|${asset || ''}|${r.show || ''}|${r.camera || ''}|${r.title || ''}`;
    s.data = { ...r, title: r.title, sub: r.sub, text: r.text, headlines: r.headlines, lines: r.lines };
    if (key === s.key) return r;
    s.key = key;
    stopVideo(s);
    if (s.img) { s.img.dispose(); s.img = null; }
    s.feed = null;
    s.cur = kind;
    const m = s.mat;
    if (kind === 'off') { m.emissiveTexture = null; m.emissiveColor = new B.Color3(0.03, 0.035, 0.04); return r; }
    m.emissiveColor = new B.Color3(0, 0, 0); // (Babylon adds the emissive color to the picture: black keeps it true)
    if (kind === 'video') {
      const vt = new B.VideoTexture('tv', M.assetUrl(asset), W().scene, true, false, B.Texture.TRILINEAR_SAMPLINGMODE, { autoPlay: true, loop: true, muted: true, autoUpdateTexture: true });
      s.vtex = vt; s.video = vt.video; s.video.crossOrigin = 'anonymous';
      m.emissiveTexture = vt;
    } else if (kind === 'image') {
      try { if (!M.hasAssetRef(asset)) throw new Error('none'); s.img = new B.Texture(M.assetUrl(asset), W().scene); m.emissiveTexture = s.img; } catch { s.cur = 'show'; s.data.show = 'bars'; m.emissiveTexture = s.dyn; }
    } else if (kind === 'camera') {
      s.camera = r.camera;
      m.emissiveTexture = s.dyn; // until the camera is found
    } else {
      s.show = kind === 'text' ? 'text' : r.show;
      m.emissiveTexture = s.dyn;
      s.last = 0;
    }
    return r;
  }
  /** Every frame: shows drawn (about 15 a second, only screens near you), cameras pointed, videos' sound by distance. */
  function runScreens(dt) {
    const cam = W().scene.activeCamera;
    if (!cam) return;
    const now = performance.now();
    for (const f of feedsInUse) f.users = 0;
    for (const s of screens) {
      if (!s.e.alive || !s.mesh.isEnabled()) continue;
      const at = s.mesh.getAbsolutePosition();
      const d = B.Vector3.Distance(cam.position, at);
      s.t += dt;
      if (s.cur === 'camera') {
        const c = findCamera(s.camera);
        if (c) { const f = feedOf(c); if (d < 45) { f.users++; feedsInUse.add(f); aimFeed(c); } if (s.mat.emissiveTexture !== f.rtt) s.mat.emissiveTexture = f.rtt; }
        else { if (s.mat.emissiveTexture !== s.dyn) s.mat.emissiveTexture = s.dyn; if (d < 40 && now - s.last > 500) { s.last = now; draw(s, 'bars', { title: s.data.title || 'Camera', sub: 'No camera by that name' }); } }
      } else if ((s.cur === 'show' || s.cur === 'text') && d < 40 && now - s.last > (s.show === 'static' ? 90 : 66)) {
        s.last = now;
        draw(s, s.cur === 'text' ? 'text' : s.show, s.data);
      } else if (s.cur === 'video' && s.video) {
        const v = s.video;
        const vol = M.near([at.x, at.y, at.z], 14) * 0.9;
        v.volume = Math.max(0, Math.min(1, vol));
        if (window.__homesAudio && v.muted && vol > 0.01) { v.muted = false; v.play().catch(() => {}); }
      }
    }
    const sc = W().scene;
    for (const f of feedsInUse) {
      const i = sc.customRenderTargets.indexOf(f.rtt);
      if (f.users && i < 0) sc.customRenderTargets.push(f.rtt);
      else if (!f.users && i >= 0) sc.customRenderTargets.splice(i, 1);
      if (!f.users) feedsInUse.delete(f);
    }
  }
  const feedsInUse = new Set();
  function draw(s, show, data) {
    const fn = SHOWS[show] || SHOWS.bars;
    const c = s.dyn.getContext();
    c.save();
    try { fn(c, s.w, s.h, s.t, Object.assign(s.data, data, { lines: s.data.lines || s.lines })); } catch (err) { H.report(err, `show ${show}`); }
    c.restore();
    s.dyn.update();
  }
  const screensFrame = (dt) => runScreens(dt);
  M.perFrame.add(screensFrame);
  H.hooks.world.push({ enter() { M.perFrame.add(screensFrame); }, leave() { screens.clear(); feedsInUse.clear(); } });
  // Sound may play once the player has pressed something (browsers' rule): E or a tap counts.
  window.addEventListener('keydown', () => { window.__homesAudio = true; }, { once: true });
  window.addEventListener('pointerdown', () => { window.__homesAudio = true; }, { once: true });

  // ------------------------------------------------------------------ channels on a thing (TV, computer, projector, phone)
  /** Channel list from a spec: shape.channels, or the defaults (plus the shows the world's cameras film). */
  function channelsOf(sh, spec, defaults) {
    const list = Array.isArray(sh.channels) ? sh.channels : Array.isArray(spec && spec.shape && spec.shape.channels) ? spec.shape.channels : null;
    if (list && list.length) return list.slice(0, 40);
    if (sh.channel !== undefined) return [sh.channel];
    return defaults.slice();
  }
  /** A thing with a screen and channels: state { on, channel }; E turns it on, then changes channel (and off at the base). */
  function tv(e, s, sh, o, spec, defaults, pts) {
    let list = channelsOf(sh, spec, defaults);
    const withCams = () => {
      if (sh.only) return list;
      // The world's shows (cameras with data.show) join the channels (shape.only: just the listed ones).
      const extra = [];
      for (const c of W().entities) if (isCam(c) && c._cctv.show && !list.includes(c._cctv.show)) extra.push(c._cctv.show);
      return list.concat(extra);
    };
    e._channels = () => (e._override ? [e._override] : withCams());
    e._setChannels = (l) => { list = l.slice(); show(); };
    const show = () => {
      const st = e.homes.state;
      const chs = e._channels();
      const ch = st.on ? chs[((st.channel % chs.length) + chs.length) % chs.length] : null;
      return tune(s, ch);
    };
    e._show = show;
    M.track(e, { on: sh.on !== false, channel: Math.max(0, Number(sh.start) || 0) }, (st, changed, quiet) => {
      const r = show();
      if (!quiet && st.on && changed.includes('channel') && e._announce) { e._announce = false; say(`Channel ${(st.channel % e._channels().length) + 1}: ${r.title}`, 1.4); }
      if (!quiet && changed.includes('on')) M.noise({ kind: 'click', volume: 0.2, at: M.worldPoint(e, [0, 1, 0]) });
    }, M.keyOf(o, spec));
    // Cameras may be built after the TV: check again once the world is up.
    setTimeout(() => { if (e.alive) show(); }, 0);
    let wait = 0;
    M.animate(e, (dt) => { wait += dt; if (wait > 1 && s.cur === 'show' && s.data && s.data.sub === 'Waiting for this show') { wait = 0; s.key = null; show(); } });
    M.usable(e, [
      { label: () => (e.homes.state.on ? 'next channel' : 'turn it on'), at: pts.screen, use: (ctx) => { const st = e.homes.state; e._announce = true; ctx.set(st.on ? { channel: (st.channel + 1) % Math.max(1, e._channels().length) } : { on: true }); } },
      { label: 'turn it off', at: pts.base, when: () => e.homes.state.on, use: (ctx) => ctx.set({ on: false }) },
    ]);
    return show;
  }
  homes_screens();
  function homes_screens() { M.tune = tune; M.screen = screen; M.findCamera = findCamera; M.SHOWS = SHOWS; M.screens = screens; }

  function kind(type, def) {
    H.kinds.register(type, {
      physics: 'static', maker: true,
      build: (sh, o, spec) => M.furniture(type, sh || {}, o, (root, e, main) => def.make(root, e, sh || {}, o, spec, main), { color: def.color }),
      destroy: def.destroy,
      editor: { word: def.word, lift: () => def.lift ?? 0.02, textureable: true, motion: [], hotbar: def.hotbar || [] },
      codex: { group: 'Screens and media', what: def.what, spec: def.spec, fields: def.fields || [], props: true },
    });
  }
  const CH_FIELD = ['shape.channels', 'a list: show names (cartoons, news, nature, sports, weather, music, cooking, desktop, clock), video assets ("show.mp4"), { "camera": "<id, name or show>" }, { "text": "words" }, { "image": "pic.png" }', 'cartoons, news, nature, sports, weather, music'];

  kind('tv', {
    word: 'a TV', color: '#2b2f36',
    what: 'A TV that plays shows. E turns it on, E again changes channel (E at its base turns it off). Channels: built-in shows drawn live, video assets, a camera in the world (a live show from a studio), words. shape.wall hangs it on a wall.',
    spec: { type: 'tv', name: 'TV', transform: { position: [0, 0, 0] }, shape: { width: 1.2, channels: ['cartoons', 'news', 'nature'] } },
    fields: [CH_FIELD, ['shape.width', 'screen width in meters', '1.2'], ['shape.wall', 'hangs on a wall (no stand); shape.height is its middle', 'false'], ['shape.on', 'starts on', 'true'], ['shape.start', 'the channel it starts on (0 is the first)', '0']],
    hotbar: [{ order: 240, icon: '📺', label: 'TV', make: (yaw) => ({ type: 'tv', name: 'TV', shape: { width: 1.2 }, transform: face(yaw) }) }],
    make(root, e, sh, o, spec, main) {
      const w = num(sh.width, 1.2), h = w * 9 / 16;
      let cy;
      if (sh.wall) cy = num(sh.height, 1.4);
      else {
        P(root, 'box', [Math.max(1.2, w * 1.05), 0.5, 0.42], [0, 0.25, 0], M.mat('#6b4a2b'));
        P(root, 'box', [0.3, 0.03, 0.2], [0, 0.515, 0], main);
        P(root, 'box', [0.06, 0.12, 0.04], [0, 0.58, -0.02], main);
        cy = 0.62 + h / 2;
      }
      P(root, 'box', [w + 0.06, h + 0.06, 0.06], [0, cy, -0.01], main);
      const plane = P(root, 'plane', [w, h], [0, cy, 0.022], '#000000', { keep: true });
      plane.rotation.y = Math.PI;
      const s = screen(e, plane);
      tv(e, s, sh, o, spec, ['cartoons', 'news', 'nature', 'sports', 'weather', 'music'], { screen: [0, cy, 0.05], base: [0, sh.wall ? cy - h / 2 : 0.4, 0.1] });
    },
  });

  kind('computer', {
    word: 'a computer', color: '#d9dde3', lift: 0.02,
    what: 'A computer: a monitor, a keyboard and a mouse (stand it on a desk: y = the desk\'s height, 0.75). E turns it on and changes what it shows: its desktop, the security cameras, the news. data.lines writes on its screen.',
    spec: { type: 'computer', name: 'Computer', transform: { position: [0, 0.75, 0] }, shape: { channels: ['desktop', 'cam:Front door camera'] } },
    fields: [CH_FIELD, ['data.lines', 'lines typed on its desktop', '']],
    make(root, e, sh, o, spec, main) {
      const w = 0.56, h = 0.33;
      P(root, 'box', [0.22, 0.015, 0.16], [0, 0.008, -0.05], main);
      P(root, 'box', [0.05, 0.22, 0.04], [0, 0.12, -0.07], main);
      P(root, 'box', [w + 0.03, h + 0.03, 0.035], [0, 0.22 + h / 2, -0.05], main);
      const plane = P(root, 'plane', [w, h], [0, 0.22 + h / 2, -0.031], '#000000', { keep: true });
      plane.rotation.y = Math.PI;
      P(root, 'box', [0.44, 0.02, 0.15], [0, 0.01, 0.18], '#3b3f4a');
      P(root, 'box', [0.06, 0.025, 0.1], [0.32, 0.012, 0.18], '#3b3f4a');
      const s = screen(e, plane);
      const lines = (spec && spec.data && spec.data.lines) || (o.data && o.data.lines);
      if (Array.isArray(lines)) s.lines = lines.map(String);
      tv(e, s, { on: true, ...sh }, o, spec, ['desktop', 'news', 'clock'], { screen: [0, 0.22 + h / 2, 0.05], base: [0.32, 0.03, 0.2] });
    },
  });

  kind('projector', {
    word: 'a projector', color: '#e9ecef',
    what: 'A projector that throws a big picture onto the wall in front of it (shape.throw meters away). Channels like a TV: a movie night is a projector with a video asset or a show.',
    spec: { type: 'projector', name: 'Projector', transform: { position: [0, 0.75, 0] }, shape: { throw: 4, width: 2.6, channels: ['nature'] } },
    fields: [CH_FIELD, ['shape.throw', 'how far the picture is, meters', '4'], ['shape.width', 'the picture\'s width', '2.6'], ['shape.lift', 'the picture\'s middle above the projector', '0.9']],
    make(root, e, sh, o, spec, main) {
      P(root, 'box', [0.32, 0.12, 0.26], [0, 0.06, 0], main);
      P(root, 'cyl', [0.08, 0.04], [0.06, 0.06, 0.14], '#22262d', { rot: [90, 0, 0] });
      const th = num(sh.throw, 4), w = num(sh.width, 2.6), h = w * 9 / 16, lift = num(sh.lift, 0.9);
      const plane = P(root, 'plane', [w, h], [0, lift, th], '#000000', { keep: true, decor: true });
      plane.rotation.y = Math.PI;
      const beam = B.MeshBuilder.CreateCylinder('beam', { diameterTop: 0.05, diameterBottom: w * 0.9, height: th, tessellation: 4 }, W().scene);
      beam.parent = root; beam.position.set(0.03, (0.06 + lift) / 2, th / 2); beam.rotation.set(Math.PI / 2 + Math.atan2(lift - 0.06, th), 0, 0);
      beam.material = M.mat('#fff8dc', { alpha: 0.05, glow: true }); beam.isPickable = false; beam.metadata = { decor: true, keep: true };
      const s = screen(e, plane);
      tv(e, s, sh, o, spec, ['nature', 'cartoons', 'music'], { screen: [0, 0.08, 0.15], base: [0, 0.08, -0.1] });
      M.animate(e, () => { beam.setEnabled(Boolean(e.homes && e.homes.state.on)); plane.setEnabled(Boolean(e.homes && e.homes.state.on)); });
    },
  });

  kind('cctv', {
    word: 'a security camera', color: '#f1f3f5', lift: 2.4,
    what: 'A camera in the world: any screen can show what it sees ({ "camera": "<its id or name>" } in the screen\'s channels). data.show names the show it films ("Cooking with Bob"): TVs then have that channel by itself. Point it with the thing\'s rotation and shape.pitch (degrees down). Its position is its center.',
    spec: { type: 'cctv', name: 'Front door camera', transform: { position: [0, 2.4, 0], rotation: [0, 180, 0] }, shape: { pitch: 20 }, data: { show: '' } },
    fields: [['shape.pitch', 'degrees it looks down', '20'], ['shape.fov', 'how wide it sees, degrees', '60'], ['data.show', 'the name of the show it films', '']],
    make(root, e, sh, o, spec, main) {
      P(root, 'box', [0.12, 0.12, 0.24], [0, 0, 0], main);
      P(root, 'cyl', [0.08, 0.05], [0, 0, 0.14], '#1d2128', { rot: [90, 0, 0] });
      const led = P(root, 'sphere', [0.025], [0.04, 0.05, 0.1], M.mat('#ff3b30', { glow: true }), { keep: true, decor: true });
      P(root, 'box', [0.03, 0.2, 0.03], [0, 0.12, -0.08], '#9aa3ad', { decor: true });
      const show = (spec && spec.data && spec.data.show) || (o.data && o.data.show) || '';
      e._cctv = { pitch: num(sh.pitch, 20), fov: num(sh.fov, 60) * RAD, show: show || null };
      root.rotation.x = 0;
      M.animate(e, () => { led.setEnabled(Math.floor(performance.now() / 700) % 2 === 0); });
      M.track(e, {}, () => {}, M.keyOf(o, spec));
    },
  });

  kind('radio', {
    word: 'a radio', color: '#b0643a',
    what: 'A radio: E turns it on, changes station, and off. Stations are music assets by name (shape.stations); until there is music it plays a little tune of its own. Louder up close.',
    spec: { type: 'radio', name: 'Radio', transform: { position: [0, 0.75, 0] }, shape: { stations: ['jazz.mp3', 'lofi.mp3'] } },
    fields: [['shape.stations', 'music assets (a tune of its own until they exist)', 'three tunes'], ['shape.volume', '0 to 1', '0.6'], ['shape.on', 'starts on', 'false']],
    make(root, e, sh, o, spec, main) {
      P(root, 'box', [0.38, 0.22, 0.14], [0, 0.11, 0], main);
      P(root, 'cyl', [0.13, 0.01], [-0.08, 0.11, 0.072], '#2b2f36', { rot: [90, 0, 0] });
      P(root, 'box', [0.12, 0.05, 0.01], [0.1, 0.15, 0.072], '#f6e7b4', { keep: true });
      P(root, 'cyl', [0.04, 0.02], [0.1, 0.07, 0.075], '#2b2f36', { rot: [90, 0, 0] });
      P(root, 'cyl', [0.008, 0.4], [0.15, 0.35, -0.04], '#c9d1da', { rot: [0, 0, -20], decor: true });
      const stations = (Array.isArray(sh.stations) && sh.stations.length ? sh.stations : ['tune:1', 'tune:2', 'tune:3']).slice(0, 12);
      const names = ['Radio Cozy', 'Hawkes FM', 'Night Jazz', 'Lo-fi Lane', 'Classic Hits'];
      let playing = null;
      const play = (st) => {
        if (playing) { playing.stop(); playing = null; }
        if (!st.on) return;
        const s = stations[st.station % stations.length];
        const seed = /^tune:(\d+)/.exec(String(s));
        playing = M.loop({ asset: seed ? null : s, synth: M.tuneSynth(seed ? Number(seed[1]) : (st.station + 7), (st.station % 2) ? 'synth' : 'soft'), thing: e, volume: num(sh.volume, 0.6), range: 16 });
      };
      M.track(e, { on: Boolean(sh.on), station: 0 }, (st, changed, quiet) => {
        if (quiet === 'init' && !st.on) return;
        play(st);
        if (!quiet && st.on) { const s = stations[st.station % stations.length]; say(`📻 ${/^tune:/.test(String(s)) ? names[st.station % names.length] : String(s).replace(/\.[a-z0-9]+$/i, '')}`, 1.4); }
      }, M.keyOf(o, spec));
      e.onDestroy(() => { if (playing) playing.stop(); });
      M.usable(e, [{
        label: () => (!e.homes.state.on ? 'turn the radio on' : e.homes.state.station + 1 < stations.length ? 'next station' : 'turn the radio off'),
        at: [0, 0.15, 0.1],
        use: (ctx) => { const st = e.homes.state; if (!st.on) ctx.set({ on: true, station: 0 }); else if (st.station + 1 < stations.length) ctx.set({ station: st.station + 1 }); else ctx.set({ on: false }); },
      }]);
    },
  });

  // ------------------------------------------------------------------ things you pick up: a remote, a phone
  kind('remote', {
    word: 'a TV remote', color: '#22262d',
    what: 'A TV remote lying around: E picks it up (it becomes the "remote" tool: click changes the channel of the TV you look at, R turns it on and off, Q puts it away).',
    spec: { type: 'remote', name: 'Remote', transform: { position: [0, 0.42, 0] } },
    make(root, e) {
      P(root, 'box', [0.05, 0.02, 0.17], [0, 0.01, 0], e._mat);
      for (let i = 0; i < 6; i++) P(root, 'box', [0.012, 0.006, 0.012], [-0.012 + (i % 2) * 0.024, 0.022, -0.05 + Math.floor(i / 2) * 0.025], i === 0 ? '#e03131' : '#adb5bd', { decor: true });
      M.usable(e, [{ label: 'pick up the remote', at: [0, 0.03, 0], use: () => { W().player.tool = 'remote'; say('Remote: click changes channel · R on/off · Q puts it away', 2.4); } }]);
    },
  });
  kind('phone', {
    word: 'a phone', color: '#1d2128',
    what: 'A phone lying on a table (its screen shows the time). E picks it up: the "phone" tool, whose screen shows the security cameras and the shows (click: next, Q: put away).',
    spec: { type: 'phone', name: 'Phone', transform: { position: [0, 0.75, 0] } },
    make(root, e, sh, o, spec, main) {
      P(root, 'box', [0.08, 0.012, 0.16], [0, 0.006, 0], main);
      const plane = P(root, 'plane', [0.07, 0.145], [0, 0.0125, 0], '#000000', { keep: true });
      plane.rotation.x = Math.PI / 2;
      const s = screen(e, plane, { small: true });
      tune(s, 'clock');
      M.usable(e, [{ label: 'pick up the phone', at: [0, 0.02, 0], use: () => { W().player.tool = 'phone'; say('Phone: click for the next feed · Q puts it away', 2.4); } }]);
    },
  });

  /** The TV a remote points at (or the nearest one in front within 15 m). */
  function aimedScreen(g) {
    const hit = g.aim(30);
    let e = hit && hit.entity;
    if (e && e._channels) return e;
    const p = W().player, f = { x: Math.sin(W().camera.yaw || 0), z: Math.cos(W().camera.yaw || 0) };
    let best = null, bd = 15;
    for (const t of W().entities) {
      if (!t._channels || !t.alive) continue;
      const dx = t.x - p.x, dz = t.z - p.z, d = Math.hypot(dx, dz);
      if (d < bd && (d < 1 || (dx * f.x + dz * f.z) / d > 0.6)) { bd = d; best = t; }
    }
    return best;
  }
  /** A small thing held in front of the camera (the remote, the phone). */
  function viewModel(make) {
    const sc = W().scene;
    const root = new B.TransformNode('held', sc);
    root.parent = sc.activeCamera;
    make(root);
    for (const m of root.getChildMeshes()) { m.isPickable = false; m.metadata = { ...(m.metadata || {}), decor: true }; m.renderingGroupId = 1; }
    return root;
  }
  function touchButtons(list) {
    if (!H.touchUi) return null;
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;right:max(22px,env(safe-area-inset-right));bottom:190px;display:flex;flex-direction:column;gap:10px;z-index:6';
    for (const [label, key] of list) { const b = document.createElement('button'); b.textContent = label; b.style.cssText = 'width:58px;height:58px;border-radius:50%;border:1px solid rgba(255,255,255,.45);background:rgba(255,255,255,.14);color:#fff;font:600 18px/1 system-ui;touch-action:none'; H.bindTouchKey(b, key); wrap.appendChild(b); }
    document.body.appendChild(wrap);
    return wrap;
  }
  H.tools.register('remote', {
    title: 'TV remote',
    equip(ctx) {
      ctx.state.view = viewModel((root) => { P(root, 'box', [0.05, 0.02, 0.17], [0.22, -0.2, 0.42], '#22262d', { rot: [-25, -8, 0] }); P(root, 'box', [0.014, 0.006, 0.014], [0.22, -0.185, 0.38], M.mat('#e03131', { glow: true }), { rot: [-25, -8, 0] }); });
      ctx.state.buttons = touchButtons([['⏻', 'r'], ['✕', 'q']]);
    },
    unequip(ctx) { if (ctx.state.view) ctx.state.view.dispose(); if (ctx.state.buttons) ctx.state.buttons.remove(); },
    step(dt, ctx) {
      const g = ctx.game, inp = g.input;
      if (inp.pressed('q')) { ctx.player.tool = null; return; }
      const next = H.input.mouse.pressed, power = inp.pressed('r');
      if (!next && !power) return;
      const t = aimedScreen(g);
      if (!t) { say('Point it at a TV'); return; }
      const st = t.homes.state;
      t._announce = true;
      if (power) M.set(t, { on: !st.on });
      else M.set(t, st.on ? { channel: (st.channel + 1) % Math.max(1, t._channels().length) } : { on: true });
      if (ctx.state.view) { ctx.state.view.position.z = -0.02; setTimeout(() => { if (ctx.state.view) ctx.state.view.position.z = 0; }, 90); }
    },
  });
  H.tools.register('phone', {
    title: 'Phone',
    equip(ctx) {
      let plane = null;
      const holder = { alive: true, onDestroy: () => holder, handlers: {} };
      ctx.state.view = viewModel((root) => {
        P(root, 'box', [0.085, 0.17, 0.012], [0.2, -0.13, 0.42], '#1d2128', { rot: [-10, -12, 0] });
        plane = P(root, 'plane', [0.076, 0.155], [0.2, -0.13, 0.413], '#000000', { rot: [-10, 168, 0] });
      });
      ctx.state.screen = screen(holder, plane, { small: true });
      plane.renderingGroupId = 1;
      ctx.state.feeds = () => { const l = ['clock']; for (const c of W().entities) if (isCam(c)) l.push({ camera: c.homes ? c.homes.id : c.name, title: c.name || c._cctv.show || 'Camera' }); return l.concat(['news', 'cartoons', 'weather']); };
      ctx.state.i = 0;
      tune(ctx.state.screen, ctx.state.feeds()[0]);
      ctx.state.buttons = touchButtons([['✕', 'q']]);
      ctx.state.holder = holder;
    },
    unequip(ctx) { if (ctx.state.holder) { ctx.state.holder.alive = false; screens.delete(ctx.state.screen); stopVideo(ctx.state.screen); ctx.state.screen.dyn.dispose(); } if (ctx.state.view) ctx.state.view.dispose(); if (ctx.state.buttons) ctx.state.buttons.remove(); },
    step(dt, ctx) {
      const inp = ctx.game.input;
      if (inp.pressed('q')) { ctx.player.tool = null; return; }
      if (H.input.mouse.pressed) {
        const l = ctx.state.feeds();
        ctx.state.i = (ctx.state.i + 1) % l.length;
        const r = tune(ctx.state.screen, l[ctx.state.i]);
        say(`📱 ${r.title}`, 1.2);
      }
    },
  });
})();
