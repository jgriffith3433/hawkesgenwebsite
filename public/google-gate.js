// "Continue with Google" only where Google sign-in is set up (/v1/health says `google`). Where it isn't (beta), the
// button and the "or with email" line under it are hidden, so nobody follows a link that cannot work.
(() => {
  const links = () => [...document.querySelectorAll('a[href*="/auth/google"], #googleBtn, #google')];
  const hide = () => links().forEach((a) => {
    a.hidden = true;
    a.style.display = 'none';
    const next = a.nextElementSibling;
    if (next && next.classList.contains('or')) next.style.display = 'none';
  });
  fetch('/v1/health').then((r) => r.json()).then((h) => { if (!h || !h.google) hide(); }).catch(() => {});
})();
