# Hosted games: /play/<game>

Hawkes's own games that are built elsewhere (Unity games in Hawkes Studio) play at `https://hawkesgames.com/play/<game>`,
next to the games people make here.

- **The route is reserved by being a folder.** `public/play/<game>/index.html` is a static file, and Firebase Hosting
  serves static files before any rewrite, so `/play/<game>` never reaches the play function (`firebase.json` rewrites
  `/play/**` to `playpages.ts`). Games people make can't take the name: their links always end in a code
  (`games.ts slugFor`: `<title>-<4 hex>`), so a name with no dash, like `sickofit`, is always free. Each hosted game also
  gets a rewrite of `/play/<game>` to its `index.html` (before the `/play/**` function rewrite) and a `no-cache` header
  rule, so the page and its `build.json` are never stale.
- **The build is not in this repo.** The Unity files stay on Hawkes Studio's public builds host (`sites.hawkesgen.ai/builds/...`,
  open CORS, Brotli served with its Content-Encoding, cached for a year per version), so Firebase Hosting holds only the
  page and a pointer. No size limit or wasm header to worry about here.
- **Deploying a new build is Studio's job.** The game's Studio project publishes into the `hawkes-games` project with
  `publish: { project: "hawkes-games", path: "public/play/<game>/", commit: true, page: "site" }` (hawkesstudio
  docs/builds.md "A site with its own game page"): Studio keeps the build at its public address and commits only
  `public/play/<game>/build.json` and `window.HAWKES_BUILD_URL` at the top of the page's `<head>` onto `beta`. That push
  deploys beta.hawkesgames.com (firebase.yml); going live moves `main` through Studio like every other change here.
- **The page** reads `build.json` first (no-store), then `window.HAWKES_BUILD_URL`, then the version it shipped with,
  and loads the game from there.

## Games here

| Game | Page | Studio project | Notes |
|---|---|---|---|
| Sick of It | `/play/sickofit` | `sick-of-it-unity` | Ghost lobby on Hawkes Net: beta pages use beta Net (`hawkesnet.hawkesgen.ai`), live pages `net.hawkesgen.ai`; both list this site for the `sickofit` project. |
