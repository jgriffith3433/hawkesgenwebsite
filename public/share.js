// The share window (/share/new): a game opens it (the game itself runs sandboxed, with no cookies and no downloads)
// and hands it a photo or clip with postMessage. Here, on the site, it can be downloaded, and a signed-in player can
// upload it into their own Gen project (POST /v1/assets) and make a share link (POST /v1/shares -> /s/<id>). Nothing is
// sent anywhere until the player presses a button.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const opener = window.opener;
  let item = null; // { kind, blob, mime, poster, title, game, gameTitle, filename, seconds, width, height }
  let me = null;
  let objectUrl = null;

  if (!opener) { $('waiting').hidden = true; $('orphan').hidden = false; return; }

  // Tell the game we're here (again, until it answers: it may still be setting up its listener).
  let tries = 0;
  const hello = setInterval(() => {
    if (item || ++tries > 40) { clearInterval(hello); if (!item) { $('waiting').hidden = true; $('orphan').hidden = false; } return; }
    try { opener.postMessage({ source: 'hawkes-share', type: 'ready' }, '*'); } catch { /* gone */ }
  }, 250);
  try { opener.postMessage({ source: 'hawkes-share', type: 'ready' }, '*'); } catch {}

  window.addEventListener('message', (e) => {
    if (e.source !== opener) return;
    const m = e.data || {};
    if (m.source !== 'hawkes-share' || m.type !== 'media' || item) return;
    if (!(m.blob instanceof Blob) || !m.blob.size) return;
    if (m.blob.size > 64 * 1024 * 1024) { $('waiting').textContent = 'That one is over 64 MB: trim it shorter in the game.'; return; }
    item = { kind: m.kind === 'clip' ? 'clip' : 'photo', blob: m.blob, mime: String(m.mime || m.blob.type || ''), poster: m.poster instanceof Blob ? m.poster : null, title: String(m.title || '').slice(0, 90), game: m.game ? String(m.game) : null, moment: m.moment && typeof m.moment === 'object' ? { kind: String(m.moment.kind || ''), caption: String(m.moment.caption || '').slice(0, 140), who: String(m.moment.who || '').slice(0, 40), what: String(m.moment.what || '').slice(0, 40) } : null, gameTitle: String(m.gameTitle || ''), filename: String(m.filename || '').replace(/[^\w.-]+/g, '-').slice(0, 80), seconds: Number(m.seconds) || null, width: Number(m.width) || null, height: Number(m.height) || null };
    show();
  });

  function show() {
    $('waiting').hidden = true;
    $('ready').hidden = false;
    $('saveCard').hidden = false;
    const clip = item.kind === 'clip';
    $('heading').textContent = clip ? 'Your clip' : 'Your photo';
    document.title = `${clip ? 'Your clip' : 'Your photo'} · Hawkes Games`;
    document.querySelectorAll('[data-kind]').forEach((s) => { s.textContent = clip ? 'clip' : 'photo'; });
    objectUrl = URL.createObjectURL(item.blob);
    const media = document.createElement(clip ? 'video' : 'img');
    media.className = 'sw-media';
    media.src = objectUrl;
    if (clip) { media.controls = true; media.loop = true; media.playsInline = true; media.muted = true; media.autoplay = true; media.addEventListener('loadedmetadata', () => { item.width = media.videoWidth || item.width; item.height = media.videoHeight || item.height; facts(); }); }
    else media.addEventListener('load', () => { item.width = media.naturalWidth || item.width; item.height = media.naturalHeight || item.height; facts(); });
    $('mediaWrap').appendChild(media);
    $('title').value = item.title || '';
    const dl = $('download');
    dl.href = objectUrl;
    dl.download = item.filename || (clip ? `clip.${/mp4/.test(item.mime) ? 'mp4' : 'webm'}` : 'photo.png');
    facts();
    fetch('/v1/shares/session', { credentials: 'include' }).then((r) => (r.ok ? r.json() : null)).then((d) => { me = d && d.user ? d.user : null; account(); }).catch(() => account());
  }
  function facts() {
    const bits = [];
    if (item.width && item.height) bits.push(`${item.width} × ${item.height}`);
    if (item.seconds) bits.push(`${item.seconds.toFixed(1)} s`);
    bits.push(`${(item.blob.size / 1024 / 1024).toFixed(item.blob.size > 10 * 1024 * 1024 ? 0 : 1)} MB`);
    if (item.gameTitle) bits.push(`from ${item.gameTitle}`);
    $('facts').textContent = bits.join(' · ');
  }
  function account() {
    $('shareCard').hidden = !me;
    $('authCard').hidden = Boolean(me);
  }

  // ------------------------------------------------------------------ signing up or in, right here
  const setMode = (mode) => {
    $('tabSignup').classList.toggle('on', mode === 'signup');
    $('tabLogin').classList.toggle('on', mode === 'login');
    $('nameWrap').hidden = mode !== 'signup';
    $('authSubmit').textContent = mode === 'signup' ? 'Create account' : 'Sign in';
    $('password').autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
  };
  $('tabSignup').onclick = () => setMode('signup');
  $('tabLogin').onclick = () => setMode('login');
  $('authForm').onsubmit = async (e) => {
    e.preventDefault();
    const mode = $('tabSignup').classList.contains('on') ? 'signup' : 'login';
    const err = $('authError');
    err.hidden = true;
    try {
      const body = mode === 'signup' ? { email: $('email').value, password: $('password').value, name: $('name').value } : { email: $('email').value, password: $('password').value };
      const r = await fetch(`/v1/users/${mode}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'That did not work');
      me = d.user;
      account();
    } catch (x) { err.textContent = x.message; err.hidden = false; }
  };

  // ------------------------------------------------------------------ uploading and making the link
  function upload(blob, mime, name, progress) {
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open('POST', '/v1/assets');
      x.withCredentials = true;
      x.setRequestHeader('Content-Type', mime || blob.type || 'application/octet-stream');
      x.setRequestHeader('X-Filename', name);
      x.upload.onprogress = (e) => { if (e.lengthComputable && progress) progress(e.loaded / e.total); };
      x.onload = () => {
        let d = {};
        try { d = JSON.parse(x.responseText || '{}'); } catch {}
        if (x.status >= 200 && x.status < 300 && d.id) resolve(d); else reject(new Error(d.error || `Upload failed (${x.status})`));
      };
      x.onerror = () => reject(new Error('The upload did not get through: check your connection'));
      x.send(blob);
    });
  }
  $('shareBtn').onclick = async () => {
    const btn = $('shareBtn'), bar = $('bar'), err = $('shareError');
    btn.disabled = true; err.hidden = true; bar.hidden = false;
    const setBar = (p) => { bar.firstChild.style.width = `${Math.round(p * 100)}%`; };
    try {
      const clip = item.kind === 'clip';
      const ext = clip ? (/mp4/.test(item.mime) ? 'mp4' : 'webm') : /jpe?g/.test(item.mime) ? 'jpg' : 'png';
      const base = (item.filename || (clip ? 'clip' : 'photo')).replace(/\.[a-z0-9]+$/i, '');
      const main = await upload(item.blob, item.mime.split(';')[0], `${base}.${ext}`, (p) => setBar(p * (item.poster ? 0.9 : 1)));
      let thumb = null;
      if (item.poster) { try { thumb = (await upload(item.poster, item.poster.type || 'image/jpeg', `${base}-poster.jpg`, (p) => setBar(0.9 + p * 0.1))).id; } catch { thumb = null; } }
      const r = await fetch('/v1/shares', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ asset: main.id, thumb, title: $('title').value, game: item.game, moment: item.moment, width: item.width, height: item.height, seconds: item.seconds }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Could not make the link');
      done(d);
    } catch (x) { err.textContent = x.message; err.hidden = false; btn.disabled = false; }
    finally { bar.hidden = true; }
  };
  function done(share) {
    $('shareCard').hidden = true;
    $('doneCard').hidden = false;
    $('link').textContent = share.url;
    $('open').href = share.url;
    $('postX').href = `https://x.com/intent/post?text=${encodeURIComponent(share.game ? `${share.title} · ${share.game.title}` : share.title)}&url=${encodeURIComponent(share.url)}`;
    $('copy').onclick = () => { try { navigator.clipboard.writeText(share.url); $('copy').textContent = 'Copied'; setTimeout(() => { $('copy').textContent = 'Copy link'; }, 1800); } catch { prompt('Copy this link', share.url); } };
    try { opener.postMessage({ source: 'hawkes-share', type: 'shared', url: share.url, id: share.id }, '*'); } catch {}
  }
  window.addEventListener('beforeunload', () => { if (objectUrl) URL.revokeObjectURL(objectUrl); });
})();
