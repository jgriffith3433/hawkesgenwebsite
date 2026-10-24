# hawkesgen.com — the Hawkes Gen customer portal

The site paying customers use: the landing page and portfolio (`/`), the Creator Studio (`/app`), accounts, credits
and Stripe. It does no generation itself. **Hawkes Gen is the backend** (jobs, the GPU fleet, the library), and the
portal is one of its customers, exactly like Hawkes Studio: one Gen key, scoped in Gen to the projects `usr_*`.
Every customer is a project (`usr_<16 hex>`), and every call the portal makes for a customer carries
`X-Hawkesgen-Project: usr_...`, which narrows the key to that project inside Gen (`hawkesgen/src/auth.ts`). So Gen
itself keeps customers apart: jobs by id, events, assets, files, inputs and `slot:` references.

```
customer ──https──▶ hawkesgen.com (this repo, its own EC2 box, Caddy, .data/portal.db)
                        │  Gen key (usr_*) + X-Hawkesgen-Project
                        ▼
                    Hawkes Gen (gen.hawkesgen.com today; moves to Studio's new domain later) ──▶ GPU fleet, APIs
```

## Hard rules

- **Never give a customer a way to start Gen work without paying.** Only the routes listed in `src/server.ts`
  (`PASS_GET`, `PASS_POST`, `UPLOADS`) reach Gen as they are; `POST /v1/jobs` and `/v1/run` go through `src/jobs.ts`
  (quote, take credits, submit, settle). Never pass through rerun, entity make/revise, or anything else that queues a job.
  **The one exception is the landing page's free demo** (`src/demo.ts`, `/v1/demo`): only `image.transform` pixel art and
  `image.cutout` (Gen's CPU, no GPU), images up to 6 MB, `DEMO_PER_IP` (3) a day per address and `DEMO_PER_DAY` (300) for
  everyone, as the demo project `usr_0000000000000000`. Never add a GPU tool to it.
  **The other exception is images' smaller copies** (`src/variants.ts`): the portal itself (never a customer's request,
  and with steps fixed in code) runs Gen's CPU `image.transform` (resize to 128-2048 px, WebP) once per image that enters
  a game or the community library, as the image's own project, for the engine's texture levels of detail. Customers'
  images are capped at `VARIANTS_PER_DAY` (400) a day for everyone. Never add another tool or a customer-shaped step to it.
- **MCP tools pay like everything else.** Every tool in `src/mcp.ts` either answers directly (account, lists) or starts a task (`src/tasks.ts`), whose steps go through `jobs.ts submit` with the caller's `via` (the daily limit). `/mcp` takes bearer tokens only (OAuth `hgo_` or an `hg_` key), never the session cookie: it has open CORS.
- **Credits are money.** Every change of a balance is a row in `credit_ledger` in the same transaction (`billing.ts add`).
  A job is charged once (`jobs` table) and given back once (unique `job_id, kind`); a Stripe session pays once (unique
  `stripe_session_id`). Keep those indexes and the tests in `test/portal.test.ts`.
- Prices come from Gen (`POST /v1/billing/quote`). Packs are in `billing.ts PACKS`.
- Secrets live in `.env` on the box (gitignored): `HAWKESGEN_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`,
  `STRIPE_WEBHOOK_SECRET`. Never commit, print or log them.
- **Design:** the website is light (`body.landing` tokens in `public/public.css` + `public/site.css`, Inter headings, JetBrains Mono for code). Only the game is dark: the editor (`studio.css`) and `/play` (`play/play.html`), entered with a fade (`public/enter.js`). In the game everything reads like a game: no web header, a pause menu (Esc twice), game chat, cards in the world. Copy is plain and true: no claims we can't show.
- No runtime dependencies (Node 24, `node:sqlite`, TypeScript by type stripping: erasable syntax only, `.ts` imports).
- Customer ids are `${PROJECT_PREFIX}<16 hex>` (`config.ts`; `usr_` on live): match them with `USER_ID`, never a literal `usr_`.

## Run

```bash
npm start            # http://127.0.0.1:8800 ; needs HAWKESGEN_URL and HAWKESGEN_KEY (a key with projects ["usr_*"])
npm run typecheck
npm test             # against a fake Gen, offline
```

## Layout

| Path | What |
|---|---|
| `src/server.ts` | Routes: pages, open routes (portfolio, packs, signup/login, the Stripe webhook), the customer's routes, the Gen pass-through list |
| `src/users.ts` | Accounts (scrypt), sessions (`hg_session` cookie), personal API keys (`hg_...`, hashed), who a request is |
| `src/billing.ts` | Packs, the ledger (hold, attach, refund), Stripe Checkout and the signed webhook |
| `src/jobs.ts` | Quote, take credits, submit to Gen as the customer, settle from Gen's event stream (`watch`) and the sweep |
| `src/gen.ts` | The Gen client (the portal's key, narrowed per call) |
| `src/users.ts` referrals | `?ref=<code>` and `?utm_source=` are kept by the landing page as cookies (`hg_ref`, `hg_src`) and read at sign-up (`originOf`, email and Google): a friend gets `REFERRAL_BONUS` (50) more, the inviter `REFERRAL_REWARD` (100) on the friend's first paid checkout (`billing.ts rewardReferrer`, once: `referral_paid`); `users.source` records where a sign-up came from. `GET /v1/referral`, the invite card in /app |
| `src/admin.ts`, `public/admin.html` + `admin.js` | `/admin`: overview (revenue, accounts, credits, jobs), accounts with ledger and jobs, credit adjustments (with a note, in their ledger), gifts (credits plus an email from support@: `giftCredits`, `mail.ts giftEmail`), disable, roles, password links. `/v1/admin/*` answers 404 to anyone but an admin |
| `src/cli.ts` | On the box: `sudo -u hawkes node src/cli.ts admin <email>` makes an admin and prints a one-time link to set the password; `password-link <email>` for a locked-out customer; `grant <email> <credits> <why>` adjusts credits (in their ledger) |
| `src/mcp.ts` | The MCP server at `/mcp` (Streamable HTTP, stateless, protocol 2025-11-25/06-18/03-26): ~29 curated game-dev tools (sprite sheets, transparent images, edits and variations, `transform_image` (Gen `image.transform`), textures + PBR maps, skyboxes, 3D, rigging, motion, voice, SFX, music, `buy_credits` (a Stripe checkout link in the chat; `/thanks` after paying), `get_file`, `run_tool` for the rest), slash-command prompts (`sprite_sheet`, `character_3d`, `tileable_material`, `sound_pack`, `ui_icons`), results with inline image previews, `resource_link`s and curl lines, progress as SSE `notifications/progress` when the client sends a progressToken |
| `src/oauth.ts`, `public/authorize.html` | OAuth 2.1 for MCP clients: discovery (`/.well-known/oauth-protected-resource[/mcp]`, `/.well-known/oauth-authorization-server`), dynamic client registration (`/oauth/register`), `/oauth/authorize` (sign in, approve with a daily credit limit), `/oauth/token` (PKCE S256 required, codes single-use, refresh tokens rotate), connections (`/v1/connections`: limit, revoke) |
| `src/caller.ts` | Who is calling and through what (`via`: OAuth connection, API key, session) and the daily limit that applies |
| `src/tasks.ts` | A request as a chain of Gen jobs, each paid; later steps take earlier outputs (`{ from, pick, kind }`); kept in `tasks`, resumed after a restart |
| `src/files.ts`, `src/sign.ts` | Signed links: downloads `/dl/<token>/<name>` (a day), one-time uploads `/up/<token>` (`curl -T`, 30 min), https fetches (public addresses only) |
| `public/connect.html` | `/connect`: Add to Cursor / Install in VS Code buttons, Add to Claude (copies the address, opens Connectors in the Claude desktop app via `claude://claude.ai/customize/connectors` (a second button opens claude.ai) and shows the three steps left; Claude has no install link), a sentence to paste into Claude Code, a CLI button on the Claude card that shows the `claude mcp add` command, the Unity package, Windsurf, ChatGPT and API-key configs, things to try, the customer's connections; buttons turn to "✓ Connected" for editors already connected |
| `src/portfolio.ts` | "Built with Hawkes Gen": only claims we can show |
| `public/sitenav.js` | **The site's one navigation**: every public page's header has `<nav class="hg-nav-links" data-site-nav>` (the same links inside, for no-script) and loads it; add a page to its `LINKS`, not to each header. Marks the current page; a Menu button below 1120px |
| `public/` | The pages: `index.html` (landing, portfolio, pricing), `app.html` + `app.js` (Creator Studio), `public.css`, `hawkesgen.mjs` (the JS client, a copy of `hawkesgen/clients/js`) |
| `public/play/` | **The game engine.** `runtime.js` (the world from `scene.json`, entities, the fixed step (physics.js runs Havok in it), the built-in player: first/third/top view and `config.player` settings, fall catching, waypoints, behaviors, hot reload without a page reload, `game.ui` menus/popups/panels, the game look, a worker that keeps it running in a background tab), `behaviors.js` (built-in behaviors in plain words), `net.js` (multiplayer over `/v1/ws`: snapshot interpolation, the owner simulates what it holds, blended hand-overs, `H.sync`), `rewind.js` (rewind and reset while playing), `build.js` (the editor's in-world tools: HUD, grab and throw, hotbar, cards, undo, the Gen beam), `play.html` (draft and published pages; `/play/t/<id>` plays an Overseer template). **Modules:** the core (`engine.json`: runtime, physics (Havok), kinds, scale (budgets), controllers, behaviors, net, gameplay) plus every `modules/<name>/module.json`, loaded by one script, `/play/modules.js` (`src/engine.ts`: the manifest, one cache-busting hash, the kinds scenes may hold). Modules extend the engine through registries (`H.kinds`, `H.tools`, `H.controllers`, `H.features`, `H.physics`, `H.sync`), never by editing runtime.js: **`docs/engine-modules.md`** is the guide. `/play/WORLD.md` and `/play/API.md` are the contract, assembled from one section per module (`docs/{world,api}/NN-name.md`); the assistant reads both fresh with every message, so document every engine feature there |
| `public/play/` loading and memory | **Phones first** (docs/engine-modules.md "Loading and memory", `docs/performance.md`): `scale.js` (**H.device** tiers and **H.budget** per tier: things, bodies, shadows, texture memory, largest texture, pixel ratio, draw distance), `textures.js` (**H.textures**: every image starts at its smallest copy and is sharpened when near and big on screen, within the budget; the least visible go down first under pressure; `reserve` for big visuals), `kinds.js` (models load nearest first; low copy far, full copy near), `loader.js` (Babylon and Havok's wasm preloaded; `"lazy": true` modules load only when a game uses them, the rest right after it's playable) |
| `public/play/` core seams | `use.js` (**H.use**: E near things; every module registers an offer, the engine picks the best and shows the hint), `assets.js` (**H.assets**: assets by id, found by word; `config.assets` is the world's choice per word), in runtime.js **H.hooks.game** (add `game.<yours>` before scripts; never redefine `window.game`), **H.audio** (one context; every sound through `H.audio.master`, effects such as water's muffling, `output` to record from), **H.timeScale** / `H.slow(owner, k)` (slow motion: fewer fixed steps), and in physics.js the one **'explosion'** event (`H.physics.on('explosion')`, `game.on('explosion')`; lasting changes only when `authoritative`). docs/engine-modules.md has each |
| `public/play/modules/<name>/` | The modules (each a folder: `module.json`, its scripts, `docs/{world,api}/NN-name.md`, its tests in `test/engine/<name>.test.ts`): `terrain` (ground from words, digging, craters), `vehicles` (cars, 4x4s, boats, planes...), `living` (creatures, herds, riding, AI friends on a free phrasebook: there is no paid AI talk), `water` (sea, swimming, buoyancy, rain, fishing), `mayhem` (explosions, fire, breaking, spawning a hundred of anything, the tools), `homes` (houses, furniture that works, TVs and screens), `share` (photo mode, clips, share links, the trailer camera). Animals are Living things' (Mayhem's spawning makes creatures) |
| `src/shares.ts`, `public/share.html`, `/s/<id>` | **Share links** for photos and clips from games: the file is the player's own Gen asset (uploaded through the `/v1/assets` pass-through); the table says which asset, its picture, title and game. `/s/<id>` is rendered here with Open Graph and Twitter tags; `/share/new` is the share window |
| `src/variants.ts` | **Images' smaller copies** (texture levels of detail): every image in a game or the community library gets 128, 256, 512, 1024, 2048 px and full-size WebP copies, made once by Gen's CPU `image.transform` (free, see the hard rules), kept in `asset_variants` by image id. Bundles carry them (`assets[name].variants`, `size`), served at the image's link with `?lod=<size>&v=<id>` (immutable); community rows list them and their thumb is the 256 px copy; the customer's own `/v1/assets` list leaves them out. The server queues anything without copies at start (the backfill) and makes them one at a time; `node src/cli.ts variants status|backfill|run [n]`. The engine side is `public/play/textures.js`; `docs/performance.md` has the numbers |
| `src/words.ts` | Words as labels for assets (singular, phrases and words): game_assets.words, filled from community uses, the assistant's names and asset names; the engine's assets.js uses the same rules |
| `src/scene.ts`, `src/rooms.ts`, `src/ws.ts` | The world as ops (create, update, replace, delete, config) applied to `scene.json` (`games.ts sceneOps`, `POST /v1/games/:id/scene`); realtime rooms over a dependency-free WebSocket (`edit:<game>` with a signed token from `/bundle`, `play:<slug>:<code>` for players): avatars, who simulates what (owner or host, held things locked to their holder), script events. `src/relay.ts` is the room itself, with no sockets (tests drive it): the newest pose and state copies for joiners and new hosts, and per-player bundles every 33 ms by interest (near at full rate, far less often, important first, a byte budget). Nothing said in a room is saved |
| `public/editor.html` + `editor.js` + `studio.css` | `/app/g/<id>`: the game full screen in a sandboxed frame; the page holds the account side (saving ops, the SSE feed, the assistant with what the player sees, the Library, Advanced: code, assets, settings, docs) |
| `public/entities.html` + `entities.js` | `/entities`, the entity codex: every kind of thing `play/runtime.js` builds, live in the real runtime, with its `scene.json` spec (edit and apply), how things move, every behavior, the asset kinds Gen makes (`gameai.ts KINDS`). Keep it in step when the engine gains a kind |
| `src/community.ts`, `community/starter.mjs`, `tools/starter.mjs`, `public/community.html` + `community.js` | **The community library**: things every builder can use, on shelves (a kind and a `category`: props, nature, stone, calm, ui...) and found by words (title, category and search `tags`). `GET /v1/community?q=&kind=&category=&tag=&sort=liked|new|fresh|name&offset=&exact=1` and `GET /v1/community/categories` (the shelves with counts) are public, files at `/v1/community/<a_>/file`. **`/community`** is the public library page (shelves, search, a model live in 3D, sounds with a player, linkable `?kind=&category=&q=&open=`). Rows only point at an asset in its owner's Gen project; using one (`POST /v1/games/:id/community`) puts that asset in the game (a model's low copy too), so nothing is copied or paid twice. Players share their own (`POST /v1/community` with `category`, the ⇪ on Create > Yours; `DELETE` takes it back). The **starter pack** is `community/starter.mjs`: five in each category, one look (`STYLE`), pictures made three times with Claude keeping the best (`paramsFor`). From J's PC: `node tools/starter.mjs check` (the data is sound), `estimate [kind]` (the price, nothing made), `make <kind|all> [category]` (costs money: J's OK), `status`. Jobs go into the starter project `usr_00000000000000c0` with labels pack, kind, tag (the category), tags, name, item; `syncStarter` reads every page of Gen's list every 10 minutes and keeps one row per thing (a remade one replaces it; one an admin hid stays hidden). The assistant sees the matches for each message, and each asset it suggests shows community picks next to "Make our own" |
| Live games, saves, people | **Every game is live**: `/play/<slug>` plays it as it is now (`playBundle` with no version), everyone on it shares the room `live`, and world edits reach play rooms too, so people play while others build. **Save** (bottom right in building, Ctrl+S; `POST /v1/games/:id/save`) adds a numbered save to `game_releases`; the owner brings one back (`releases/<n>/restore`: files and assets, after saving what was there), `/play/<slug>/v/<n>` plays one. **Roles** (`games.ts memberGame` need): owner, editor (code, settings), builder (the world, the assistant, saving; scripts the assistant writes are skipped for builders), player (plays). Invites make builders; the owner sets roles (`POST /v1/games/:id/members/<usr>`) and `visitors` (play, or build: `POST /v1/play/<slug>/join`). **Who is here**: play pages `POST /v1/play/<slug>/here` every 30 s (`rooms.ts liveCounts`: playing, plus building from the edit room), shown on the gallery (sorted Live now) and in the game. **Likes** on community things: other accounts that used one (`community_uses`, once each), sort `liked`, `new` or `fresh` |
| Play before signing up | **`/play/sandbox`** (the landing page's "Play now (no sign-up)"): the `sandbox` template (`templates.ts SANDBOX`: an island, the sea, a 4x4 and a boat, barrels and crates, herds, Pip the friend on the free phrasebook, a rod on the dock, the mayhem tools) played alone, nothing saved, no Gen, no assistant. `public/play/guest.js` runs it (play.html hands over for that slug; served without the play sandbox because only our template runs there): things to try, "Save this world" / "Build your own" / "Ask the assistant" / "Invite a friend" → the world snapshotted to localStorage → sign up (email, or Google back to `/play/sandbox?claim=<why>`) → `POST /v1/games` (template `sandbox`) + the changes as scene ops → the editor. Analytics `sandbox_*`. Tests: `test/sandbox.test.ts`, `test/engine/sandbox.test.ts` |
| `deploy/` | The box: `setup.mjs` (one-time, from J's PC), `Caddyfile`, the systemd units, `pull.mjs` (self-deploy) |

## Testing the game locally

Some test browsers (the Claude app's own) refuse scripts from a sandboxed page on a local address. `PORTAL_DEV_OPEN_PLAY=1`
in a local `.env` serves games unsandboxed, only to localhost / 127.0.0.1 requests (`server.ts devOpenPlay`). Never set it
on the box. `?touch=1` / `?touch=0` on a play page forces the phone controls on or off.

## Beta (Hawkes Studio)

Work goes to the `beta` branch (agents open pull requests into it; `.github/workflows/hawkes-studio.yml` tells Studio
about every push). **https://hawkesgenwebsite.hawkesgen.com/** (Studio's login) is the real portal running beta's
commit on Studio's server, restarted on every push to beta (`hawkesstudio/src/apps.ts`, products.json `app`): its own
database, Gen on the same server with its own key, customers as `ubeta_<16 hex>` (`PORTAL_PROJECT_PREFIX=ubeta_`, so it
never touches a live customer's `usr_` project), `PUBLIC_URL` the beta host, and no Stripe, Google or mail. An agent
change opens at `/c/<change id>/` on the same host (its own server and database); `/c/beta/` goes back. Studio
playtests beta and live with read-only site crawls. Keep the server starting from `node src/server.ts` with only `PORT`,
`PORTAL_DATA_DIR`, `PUBLIC_URL`, `HAWKESGEN_URL`, `HAWKESGEN_KEY` and `PORTAL_PROJECT_PREFIX` set, and `/v1/health`
answering 200: that is how Studio runs it.

## Deploys

Push to `main` (going live: Studio fast-forwards main to the playtested beta commit when J types
`DEPLOY hawkesgenwebsite`). CI runs typecheck and tests; the box checks every 2 minutes (`hawkesgen-portal-pull.timer`), and
deploys a commit whose CI passed: fast-forward, restart, health check, rollback if unhealthy. Logs:
`journalctl -u hawkesgen-portal -u hawkesgen-portal-pull`. Push to main only with J's OK.

The box: EC2 `hawkes-gen-public` (us-east-1, t3.large, Elastic IP 54.163.56.66, SSH key and state in
`hawkesstudio/deploy/.keys/gen_public_ed25519` / `gen-public.json`). Its IAM role (`/hawkes/hawkesgen-portal`) can only send
email as support@hawkesgen.com (`src/mail.ts`, on when `PORTAL_MAIL=ses`): the welcome email on signup. Mail to support@ is
received by SES, kept in `s3://hawkes-mail-028793236279/inbound/` and forwarded to J by the Lambda `hawkes-support-forward`.

## Engine integrations (Unity next)

An engine plugin talks to the same API as everything else; nothing engine-specific is needed on the server.
- **Auth:** the user pastes a personal key from /app (`Authorization: Bearer hg_...`). (Later: sign in from the editor
  with the same OAuth as MCP clients: `/.well-known/oauth-authorization-server`, PKCE with a loopback redirect.)
- **Files in:** `POST /v1/uploads {filename}` gives a one-time URL; `PUT` the bytes to it; use the returned
  `asset:a_...` as an input. Or `POST /v1/assets` with the bytes directly.
- **Work:** `POST /v1/billing/quote` (show the price), `POST /v1/jobs` (one tool) or the MCP tools for chains;
  `GET /v1/jobs/:id` (with `queue.ahead` while waiting) or `GET /v1/events` (SSE, the customer's jobs only).
- **Files out:** `GET /v1/assets/:id/file`; outputs carry `mime` and `title` (a sprite sheet's `.json` is TexturePacker hash).
- **Credits:** `GET /v1/users/me` (balance); 402 means out of credits: open `https://hawkesgen.com/app#credits`.
- **Built:** `jgriffith3433/hawkesgen-unity` (C:\Projects\hawkesgen-unity), Window > Hawkes Gen, signs in with the same OAuth
  (loopback, any port) and calls the MCP tools. `public/downloads/HawkesGen.unitypackage` is its export (re-export with
  its `HawkesGenExport` dev method when the package changes); the Asset Store listing is pending review.
