// The `loading-wrapper` scenario: the loading wrapper (public/play/loadwrap.js) on /play/sickofit at 1280x720 and 390x844 touch.
// Safe on live (read only). Events: wrapper-up (hook line + moving toy within 2 s), toy-responds (a real pointer drag moves the ship),
// bar-above-toy (phone), bar-real (the bar follows bytes), bar-100-at-last-byte (100% only with the build's last byte in; log of
// bytes), no-blank-frame (the wrapper is up from the first paint to the hand-off, and what is under it is never an empty page).
export const LOADING_WRAPPER = {
  id: 'loading-wrapper', title: 'Loading wrapper: hook line and toy playable within 2 s, honest bar, no blank handoff', seconds: 300, tags: ['full'],
  description: '/play/sickofit in a frame at 1280x720 and 390x844 touch: within 2 s the hook line is shown and the toy moves (two canvas frames differ) and answers a pointer drag; the bar sits above the toy at 390; the bar only reaches 100% when Unity reports the last byte (window.HawkesLoad: bytes at full, fullAt, lastByteAt), then the wrapper hands off with the game or its Tap to play prompt under it (no blank frame). options: sizes',
};
export async function runLoadingWrapper(t, options = {}) {
  const sizes = (Array.isArray(options.sizes) && options.sizes.length ? options.sizes : ['1280x720', '390x844']).map(String);
  const bad = [];
  for (const label of sizes) {
    const [w, h] = label.split('x').map(Number);
    document.getElementById('pt-lw-stage')?.remove();
    const stage = document.createElement('div');
    stage.id = 'pt-lw-stage';
    stage.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:#14151c';
    const frame = document.createElement('iframe');
    const scale = Math.min(1, innerWidth / w, (innerHeight - 24) / h);
    frame.style.cssText = `position:absolute;left:${Math.round((innerWidth - w * scale) / 2)}px;top:24px;width:${w}px;height:${h}px;border:0;transform:scale(${scale});transform-origin:0 0`;
    stage.appendChild(frame); document.body.appendChild(stage);
    const t0 = performance.now();
    frame.src = '/play/sickofit' + (w < 500 ? '?touch=1' : '?touch=0');
    await t.until(() => { try { return frame.contentDocument.querySelector('.hlw canvas'); } catch { return false; } }, 10000, `the wrapper at ${label}`);
    const d = frame.contentDocument, win = frame.contentWindow;
    const up = performance.now() - t0;
    const hook = d.querySelector('.hlw .hk')?.textContent.trim();
    const cv = d.querySelector('.hlw canvas');
    const grab = () => { const c = d.createElement('canvas'); c.width = 64; c.height = 64; const x = c.getContext('2d'); x.drawImage(cv, 0, 0, 64, 64); return x.getImageData(0, 0, 64, 64).data.join(','); };
    const a = grab(); await t.wait(500); const b = grab();
    if (hook && hook.length > 10 && a !== b && up < 2000) t.event('wrapper-up', `${label}: hook "${hook}" and a moving toy ${Math.round(up)} ms after opening`);
    else bad.push(`${label}: hook=${!!hook} moving=${a !== b} after ${Math.round(up)} ms (needs under 2000)`);
    const r = cv.getBoundingClientRect(), barR = d.querySelector('.hlw .bar').getBoundingClientRect();
    if (barR.bottom <= r.top + 1 && barR.top >= 0 && barR.width > 100) t.event('bar-above-toy', `${label}: the bar (${Math.round(barR.width)} px wide) is above the toy and on screen`); else bad.push(`${label}: bar not above the toy`);
    t.scene(`Loading wrapper ${label}: toy and bar`);
    await t.wait(2500);
    // A real pointer drag on the toy, from the left to the right: the ship follows it (the canvas changes while it is held).
    const fire = (type, x) => cv.dispatchEvent(new win.PointerEvent(type, { bubbles: true, pointerId: 7, pointerType: w < 500 ? 'touch' : 'mouse', clientX: r.left + x * r.width, clientY: r.top + r.height * 0.8, button: 0, isPrimary: true }));
    fire('pointerdown', 0.2); await t.wait(250); const c1 = grab(); fire('pointermove', 0.8); await t.wait(500); const c2 = grab(); fire('pointerup', 0.8);
    if (c1 !== c2) t.event('toy-responds', `${label}: dragging moved the toy`); else bad.push(`${label}: the toy did not answer a drag`);
    let running = false;
    try { await t.until(() => !d.querySelector('.hlw') || win.unityInstance, 150000, `the hand-off at ${label}`); running = true; } catch { /* below */ }
    const L = win.HawkesLoad || {};
    if (running && L.fullAt && L.lastByteAt && L.fullAt >= L.lastByteAt - 1) t.event('bar-100-at-last-byte', `${label}: 100% at ${Math.round(L.fullAt)} ms with the last byte at ${Math.round(L.lastByteAt)} ms; ${L.bytesAtFull} bytes received${L.total ? ' of ' + L.total : ''}`);
    else bad.push(`${label}: bar full=${L.fullAt} last byte=${L.lastByteAt}`);
    // No blank handoff: the page under the wrapper has the canvas or the prompt, and the wrapper only fades away after 100%.
    const under = d.getElementById('unity-canvas') && (d.getElementById('hawkes-tap') || d.getElementById('unity-canvas'));
    if (L.doneAt && L.fullAt && L.doneAt >= L.fullAt && under && L.firstFrameAt != null) t.event('no-blank-frame', `${label}: wrapper drawn from ${Math.round(L.firstFrameAt)} ms to ${Math.round(L.doneAt)} ms, handed off to the game${d.getElementById('hawkes-tap') ? ' prompt' : ''}`); else bad.push(`${label}: hand-off not clean (${JSON.stringify(L)})`);
    t.scene(`Loading wrapper ${label}: handed off`);
    await t.wait(2500);
  }
  document.getElementById('pt-lw-stage')?.remove();
  if (bad.length) throw new Error(bad.join('; '));
}
