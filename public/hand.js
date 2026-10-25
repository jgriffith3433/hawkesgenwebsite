// The landing page's "Hand the Overseer something": the free demo (/v1/demo, src/demo.ts). A picture in, pixel art or a
// background removed out, both on Gen's CPU. Known limits are shown before a try (the daily count from GET /v1/demo);
// a 429 says so in friendly words and offers an account.
(function () {
  var root = document.querySelector('[data-hand]');
  if (!root) return;

  var MAX_BYTES = 6 * 1024 * 1024;
  var TYPES = ['image/png', 'image/jpeg', 'image/webp'];
  var NAMES = { pixel: 'pixel-art', cutout: 'background-removed' };
  var LIMIT = "That was today's last free try. Make an account and you get starter credits to keep going.";
  var DONE = { pixel: 'Here it is, in pixel art.', cutout: "Here it is, with the background taken out." };

  function $(sel) { return root.querySelector(sel); }
  var drop = $('[data-hand-drop]');
  var input = $('[data-hand-file]');
  var preview = $('[data-hand-src]');
  var dropText = $('[data-hand-drop-text]');
  var go = $('[data-hand-go]');
  var stage = $('[data-hand-stage]');
  var out = $('[data-hand-out]');
  var empty = $('[data-hand-empty]');
  var msg = $('[data-hand-msg]');
  var actions = $('[data-hand-actions]');
  var download = $('[data-hand-download]');
  var more = $('[data-hand-more]');
  var signup = $('[data-hand-signup]');
  var left = $('[data-hand-left]');
  var kindButtons = root.querySelectorAll('[data-kind]');

  var file = null;        // the picture chosen
  var kind = 'pixel';     // pixel | cutout
  var busy = false;
  var tries = null;       // free tries left today for this address (null until GET /v1/demo answers)
  var previewUrl = null;
  var resultUrl = null;

  function limited() { return tries !== null && tries <= 0; }

  function say(text, cls) {
    msg.textContent = text;
    msg.className = 'hand-msg' + (cls ? ' ' + cls : '');
  }

  function showLeft() {
    if (tries === null) { left.textContent = ''; return; }
    left.textContent = tries <= 0 ? '' : tries === 1 ? '1 free try left today' : tries + ' free tries left today';
  }

  function refresh() {
    var off = busy || limited();
    drop.classList.toggle('is-off', off);
    drop.setAttribute('aria-disabled', off ? 'true' : 'false');
    go.disabled = !file || off;
    signup.hidden = !limited();
    showLeft();
  }

  function pick(f) {
    if (!f) return;
    if (TYPES.indexOf(f.type) < 0) return say('That is not a picture I can use. PNG, JPG or WebP, please.', 'bad');
    if (f.size > MAX_BYTES) return say('That picture is over 6 MB. Try a smaller one.', 'bad');
    file = f;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(f);
    preview.src = previewUrl;
    preview.hidden = false;
    dropText.hidden = true;
    drop.classList.add('has-file');
    say('Good. Pick what it should become, then beam it down.');
    refresh();
  }

  function reset() {
    file = null;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    resultUrl = null;
    preview.removeAttribute('src');
    preview.hidden = true;
    dropText.hidden = false;
    drop.classList.remove('has-file');
    out.removeAttribute('src');
    stage.classList.remove('landed', 'beaming');
    empty.hidden = false;
    actions.hidden = true;
    input.value = '';
    say(limited() ? LIMIT : 'Choose the next picture.');
    refresh();
  }

  function run() {
    if (!file || busy || limited()) return;
    busy = true;
    say('Beaming it down. This takes a few seconds.', 'busy');
    stage.classList.remove('landed');
    stage.classList.add('beaming');
    empty.hidden = true;
    actions.hidden = true;
    refresh();
    var started = kind;
    fetch('/v1/demo?kind=' + encodeURIComponent(started), {
      method: 'POST',
      headers: { 'Content-Type': file.type },
      body: file,
    }).then(function (r) {
      if (!r.ok) return r.json().catch(function () { return {}; }).then(function (d) { throw { status: r.status, error: d.error }; });
      var remain = r.headers.get('X-Demo-Left');
      if (remain !== null) tries = Number(remain);
      return r.blob();
    }).then(function (blob) {
      if (resultUrl) URL.revokeObjectURL(resultUrl);
      resultUrl = URL.createObjectURL(blob);
      out.src = resultUrl;
      var ext = blob.type === 'image/webp' ? 'webp' : 'png';
      download.href = resultUrl;
      download.setAttribute('download', 'hawkes-' + NAMES[started] + '.' + ext);
      stage.classList.remove('beaming');
      stage.classList.add('landed');
      actions.hidden = false;
      say(limited() ? DONE[started] + ' ' + LIMIT : DONE[started], 'ok');
      if (window.hawkesAnalytics && window.hawkesAnalytics.track) window.hawkesAnalytics.track('demo_run', { kind: started });
    }).catch(function (e) {
      stage.classList.remove('beaming');
      if (resultUrl) stage.classList.add('landed'); else empty.hidden = false;
      if (e && e.status === 429) tries = 0;
      var text = (e && e.error) || 'Could not reach the Overseer. Check your connection and try again.';
      say(e && e.status === 429 ? LIMIT : text, 'bad');
      if (e && e.status === 429 && window.hawkesAnalytics && window.hawkesAnalytics.track) window.hawkesAnalytics.track('demo_limit', {});
    }).then(function () {
      busy = false;
      refresh();
    });
  }

  // Choosing: click, keyboard, or drop.
  function openPicker() { if (!busy && !limited()) input.click(); }
  drop.addEventListener('click', openPicker);
  drop.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPicker(); } });
  input.addEventListener('change', function () { pick(input.files && input.files[0]); });
  ['dragenter', 'dragover'].forEach(function (t) {
    drop.addEventListener(t, function (e) { e.preventDefault(); if (!busy && !limited()) drop.classList.add('is-over'); });
  });
  ['dragleave', 'dragend'].forEach(function (t) {
    drop.addEventListener(t, function () { drop.classList.remove('is-over'); });
  });
  drop.addEventListener('drop', function (e) {
    e.preventDefault();
    drop.classList.remove('is-over');
    if (busy || limited()) return;
    pick(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]);
  });

  kindButtons.forEach(function (b) {
    b.addEventListener('click', function () {
      kind = b.getAttribute('data-kind');
      kindButtons.forEach(function (o) {
        var on = o === b;
        o.classList.toggle('on', on);
        o.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    });
  });

  go.addEventListener('click', run);
  more.addEventListener('click', reset);

  // How many tries are left for this address today, before anyone picks a picture.
  fetch('/v1/demo', { headers: { Accept: 'application/json' } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      if (d && typeof d.left === 'number') tries = d.left;
      if (limited()) say(LIMIT);
      refresh();
    })
    .catch(function () { refresh(); });

  refresh();
})();
