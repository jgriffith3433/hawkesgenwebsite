// The engine's loader. The server serves it as /play/modules.js, right after `window.HawkesModules = <manifest>`
// (src/engine.ts): every page that runs the engine includes only that one script and then calls
//   HawkesModules.load('play')    Babylon, Havok, the core scripts and every module, in order
//   HawkesModules.load('editor')  the editor's in-world tools (after 'play')
// Both return a promise that resolves once the scripts ran and the engine is ready (physics included).
/* global HawkesModules */
(function () {
  'use strict';
  const M = window.HawkesModules;
  const done = new Map();
  function script(src) {
    if (done.has(src)) return done.get(src);
    const p = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = false; // scripts added this way still run in the order they were added
      s.onload = () => resolve();
      s.onerror = () => reject(new Error(`Could not load ${src.replace(/\?.*$/, '')}`));
      document.head.appendChild(s);
    });
    done.set(src, p);
    return p;
  }
  const all = (list) => Promise.all(list.map(script));
  M.load = function (which = 'play') {
    if (which === 'editor') return M.load('play').then(() => all(M.editor)).then(() => window.HawkesPlay && window.HawkesPlay.ready);
    const babylon = window.BABYLON ? [] : M.babylon;
    const havok = typeof window.HavokPhysics === 'function' || !M.havok ? [] : [M.havok];
    return all([...babylon, ...havok, ...M.scripts]).then(() => window.HawkesPlay && window.HawkesPlay.ready);
  };
})();
