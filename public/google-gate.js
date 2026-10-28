// Signing in is Google only (J, 2026-10-28: no email and password). Every "Continue with Google" link goes to
// /auth/google?next=<path>, and this script adds where the visitor came from: the landing page keeps ?ref= and
// ?utm_source= in the cookies hg_ref / hg_src, but Firebase Hosting forwards only the __session cookie to the API, so
// they ride along as ?ref= and ?src= (accounts.ts reads them). `window.hgGoogleUrl(next)` builds such a link.
// Where Google sign-in is not set up (/v1/health says `google: false`), the buttons say so instead of leading nowhere.
(() => {
  const cookie = (name) => {
    const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    try { return m ? decodeURIComponent(m[1]) : ''; } catch { return ''; }
  };
  const ok = (v) => (v && /^[a-z0-9_.-]{1,60}$/i.test(v) ? v : '');
  const withOrigin = (href) => {
    const u = new URL(href, location.href);
    const ref = ok(cookie('hg_ref')), src = ok(cookie('hg_src'));
    if (ref && !u.searchParams.get('ref')) u.searchParams.set('ref', ref);
    if (src && !u.searchParams.get('src')) u.searchParams.set('src', src);
    return u.pathname + u.search;
  };
  window.hgGoogleUrl = (next) => withOrigin('/auth/google?next=' + encodeURIComponent(next || '/app'));
  // On the click (capture), so links whose href a page sets later get it too.
  document.addEventListener('click', (e) => {
    const a = e.target && e.target.closest ? e.target.closest('a[href*="/auth/google"]') : null;
    if (!a) return;
    if (a.dataset.signinOff) { e.preventDefault(); return; }
    a.setAttribute('href', withOrigin(a.getAttribute('href')));
  }, true);
  const links = () => [...document.querySelectorAll('a[href*="/auth/google"], #googleBtn, #google')];
  const off = () => links().forEach((a) => {
    a.dataset.signinOff = '1';
    a.setAttribute('aria-disabled', 'true');
    a.style.opacity = '0.55';
    a.style.cursor = 'not-allowed';
    a.title = 'Sign-in is not set up on this server';
    const label = a.querySelector('span') || a;
    label.textContent = 'Sign-in is not available here';
  });
  fetch('/v1/health').then((r) => r.json()).then((h) => { if (!h || !h.google) off(); }).catch(() => {});
})();
