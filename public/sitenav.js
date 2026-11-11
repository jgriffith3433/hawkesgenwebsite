// The site's one navigation: every public page's header has <nav class="hg-nav-links" data-site-nav> and loads this, so
// the same links are everywhere (add a page here, not in each header). The current page is marked; on phones the links
// fold into a Menu button. The links inside each nav in the HTML are the same list, for a page read without scripts.
(() => {
  const LINKS = [
    ['/games', 'Games', 'Play what people built'],
    ['/games/sickofit', 'Sick of It', 'Play Sick of It: 1,000 floors of Hell, one rewind button'],
    // Studio game sites: a full address opens in a new tab. Add a title with one line here.
    ['/games/yoobaland', 'Yooba Land', 'Yooba Land, a Hawkes game'],
    ['/games/dose-of-destruction', 'Dose of Destruction', 'Dose of Destruction, a Hawkes game'],
    ['/games/ph-origins', 'PH Origins', 'PH Origins, a Hawkes game'],
    ['/games/place-department', 'The Place Department', 'The Place Department, a Hawkes game'],
    ['/community', 'Community library', 'Every shared model, texture, sky, sprite and sound, free to use in your game'],
    ['/entities', 'Engine codex', 'Every kind of thing the game engine builds, live'],
    ['/avatars', 'Avatars', 'Every body a player can be, live'],
    ['/net', 'Hawkes Net', 'Multiplayer for your game'],
    ['/#pricing', 'Pricing', 'Credits and packs'],
  ];
  const here = location.pathname.replace(/\/+$/, '') || '/';
  for (const nav of document.querySelectorAll('[data-site-nav]')) {
    nav.innerHTML = '';
    for (const [href, label, title] of LINKS) {
      const a = document.createElement('a');
      a.href = href;
      a.textContent = label;
      a.title = title;
      const external = /^https?:\/\//.test(href);
      if (external) { a.target = '_blank'; a.rel = 'noopener'; }
      const path = href.split('#')[0];
      if (!external && path !== '/' && (here === path || here.startsWith(`${path}/`))) a.setAttribute('aria-current', 'page');
      nav.append(a);
    }
    // Phones: one Menu button that opens the links as a sheet under the header.
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'site-menu-btn';
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-label', 'Menu');
    btn.innerHTML = '<span aria-hidden="true">☰</span> Menu';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = nav.classList.toggle('open');
      btn.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', (e) => {
      if (!nav.contains(e.target)) { nav.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); }
    });
    nav.after(btn);
  }
})();
