// Walking into a game from the website: the light page fades to the game's dark before it opens, so it feels like
// going in rather than loading a page. Links to /play/... or /app/g/... do it by themselves; scripts call
// enterGame(url).
(function () {
  'use strict';
  let veil = null;
  function enterGame(url, o) {
    const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { location.href = url; return; }
    if (!veil) { veil = document.createElement('div'); veil.className = 'enter-veil'; veil.innerHTML = `<span>${(o && o.label) || 'ENTERING'}</span>`; document.body.appendChild(veil); }
    requestAnimationFrame(() => veil.classList.add('on'));
    setTimeout(() => { location.href = url; }, 560);
  }
  window.enterGame = enterGame;
  // Back from the game (bfcache): no veil left over.
  window.addEventListener('pageshow', () => { if (veil) veil.classList.remove('on'); });
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || a.target === '_blank') return;
    const u = new URL(a.href, location.href);
    if (u.origin !== location.origin || !/^\/(play\/[a-z0-9-]|app\/g\/g_)/.test(u.pathname)) return;
    e.preventDefault();
    enterGame(u.pathname + u.search);
  });
})();
