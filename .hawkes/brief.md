# Work for Hawkes Gen (customer portal)

You are fixing a problem Hawkes Studio's automated playtest found in Hawkes Gen (customer portal) (The customer portal for public Hawkes Gen (hawkesgen.com): accounts, credits, Stripe payments, the landing page, portfolio and the Creator Studio UI, with its own database. It is a server app on its own EC2 box (not GitHub Pages) and a customer of Hawkes Gen like Studio: Gen does the jobs, the portal sells and shows them.).


## What J asked for

We have no measured data on real devices. Using the existing monitor (public/play/modules/monitor, HawkesPlay.monitor.sample()) and public/play/analytics.js, send a small 'perf' event at game_ready (load ms by stage, device tier, bytes if available), after 30 s of play and every 2 minutes (median and p5 fps, frame ms, draw calls, JS heap, texture MB vs budget), and when fps drops below 20 for 3 s (once per session, with what was on screen). No personal data. Add the event to AGENTS.md Analytics and keep /legal true (statistics line). Cheap: no continuous reporting.

Work out what that means in this project (read the story doc and AGENTS.md), make it well, and keep it consistent with
the product's tone and style. If it's too big for one change, do a solid first part and say what's left in the summary.

## GPU budget: none

Nothing here was approved for GPU generation (images, video, music, 3D on the fleet). Do everything that needs no GPU
(design, data, specs, Claude-only steps, voice and sound effects are fine: cents each), price the GPU part with
`hawkesgen_estimate`, and end with that estimate in your summary so J can approve it. Never start a GPU server.

## Acceptance criteria (how this is judged)

The change is ready once your checks pass and its pull request is open; after it is merged into beta, beta's playtest
judges these, and the work is done only when every one of them passes there:
1. A play session on beta shows perf events with device tier, fps and load times in Studio analytics
2. Low-fps episodes are reported once per session with the nearest context
3. /legal's statistics section still describes what is collected

Where the game implements the playtest contract (`window.hawkesPlaytest`: see this project's AGENTS.md, and the spec
at `hawkesstudio/docs/playtest.md` next to this repository), add or extend a scenario that plays to what the criteria
describe (through real input, no teleporting; named setup shortcuts are fine) and logs events or checks that show each
one, so the review can judge them from the footage and the timeline. Write that scenario's name (one line, e.g.
`checkout`) in `.hawkes/scenario.txt`: beta's playtest plays it (and this change's, when J asks for one). To play specific content
(a new stage, level or enemy), add a second line with the scenario's options as JSON, e.g. `{"stage":"neon-pit"}`. Without a contract, make
sure each criterion can be seen when the page is played.





## Other agents on Hawkes Gen (customer portal)

Up to 3 agents work on Hawkes Gen (customer portal) at once, each on its own branch from beta. Another agent may merge into beta
while you work, so keep your change narrow: touch only the files your task needs, and don't reformat, rename or move
shared files. Running now:

- c_0e05442096cd (working): Trim the blocking path: hut LOD, lazy modules, fonts, template cache. Asked: "From the audit: (1) the hut (20.3 m from spawn) pulls its 0.96 MB full-size copy on desktop and 0.44 MB on phone because the near distance is 25 m: set shape.lod.distance to about 12 for it in src/overseer-games/sandbox.ts (look at where mo..."
  Files touched so far: `ublic/editor.html`, `public/play/play.html`, `public/public.css`, `src/server.ts`, `public/fonts/`
- c_9dfca9932972 (working): The robots: characterful machines. Asked: "Following docs/characters.md: rebuild the robot bodies (TV robot, roll-bot and the other robot options in presence-core.js WHATS / presence-bodies.js) with beveled forms, panel lines, glowing screens or lights for the face (expressions show..."
  Files touched so far: `ublic/avatars.js`, `public/play/modules/presence/module.json`, `public/play/modules/presence/presence-things.js`, `test/engine/things.test.ts`, `public/play/modules/presence/presence-robots.js`, `tools/_bb.ts`

Stay out of the files they touch where you can; where you can't, keep your edit there small and say so in your
summary.

## What the studio already knows (shared memory)

Earlier agents, J and Talk learned these; follow decisions and preferences, respect canon, and use the lessons
(unconfirmed ones are an earlier agent's notes: check them). More: memory_search, if you have the tool.
- [decision] Phone notifications only for what went wrong, J-only decisions and milestones: Merges, starts, answers and progress go to Talk only. (m_0754baa8d780)
- [decision] Unity work: use prefabs as much as possible (fewer merge conflicts, good practice); several agents may work on one Unity product at once: 2026-10-19. In Unity projects (Sick Of It, Yooba Land, The Place Department), put new or changed content in prefabs, not straight into scenes. Keep scene edits small and rare; prefer runtime-built content and data files where a project already does. J raised agents per product to 3, so agents must expect another agent working on the same repo. They must check which files the others touch, avoid h… (m_0cbc53095180)
- [decision] PM may start up to 5000 agents a day; keep working through the roadmap without stopping: 2026-10-19: J raised the PM's maxStartsPerDay from 100 to 5000 after Yooba Land's roadmap tasks and bugs sat idle at the 100-start cap. He also said "Just.. don't stop working there's a lot to do": keep the roadmap and the backlog bugs moving continuously, and don't let work idle on caps. Max-plan usage (not billed) is the real limit. (m_10400c353706)
- [decision] Build a reusable Babylon performance & leak root-cause monitor and attach its diagnostics to beta bug reports: Build a shared Babylon.js performance and leak root-cause monitor (usable across all Babylon projects: I Can Be, PH Origins, Dose Of Destruction) that diagnoses leaks, high-poly meshes, draw calls, render passes, unfrozen meshes/materials, and per-frame shader dirtying, and include its diagnostic snapshot automatically when submitting bug reports. (m_1140e13dc447)
- [decision] Reviews run on Sonnet: STUDIO_REVIEW_MODEL; a review is a few cents. Keep them there. (m_1bfcd733d45d)
- [decision] Studio must run the roadmap and bugs to done from J adding items alone; catch the roadmap up to what's already on beta: 2026-10-19. Work already on beta counts as done, never "planned". A dropped dependency never blocks. Held ideas are released when the item they waited on lands on beta. Tasks whose tries all found the work already done are done, not failed. Any remaining stall gets one Inbox question. Today's cleanup: Circle IX levels k_2bbf6b413a9f released (one level = one floor), Spire Fiend k_e16304d7a504 now… (m_1d389f0d68a1)
- [decision] DoD Season 2 and PH Origins level 7 directions (picked by Talk under J's delegation): 2026-10-19. DoD Season 2 "The card is yours" (i_b4cf57094da9): Exit Punk is the champion defending the card against 4 walk-ons not used in Season 1, reusing existing stages (Rainbow Full Pipe gets a chapter); a new finale stage is a later item. PH Origins level 7 "The Train" (i_0968e068740d): Pierce walks the cars toward his old, untransformed body, which gets off at a stop and doesn't look back,… (m_2015488b4339)
- [decision] Approvals move from typed words to an Approve / Deny button (m_286ae9f4cd83)
- [decision] Hawkes Analytics is the only analytics in every project, websites included: 2026-10-18. Every product's game AND website pages (including the Unity games' separate website repos: sickofitgamewebsite, YoobaLandGame, theplacedepartmentwebsite) use Hawkes Analytics (Gen's SDK). Remove GoatCounter, Umami, gtag or any other tracker wherever found, and never add another. Extends m_e4959acc8abd. (m_3000e802bd85)

## How to work

1. Read `AGENTS.md` (and any docs it points to) before changing anything. Follow its rules.
2. Look at the screenshots to see the problem. Find the cause in the code or data; prefer the smallest correct fix.
3. Keep to this finding. Don't refactor unrelated code, don't touch generated output or build folders, don't change
   secrets, CI, or deploy scripts.
4. Run the project's checks:
- (none listed: at least make sure it builds or loads)
5. Commit your change with a clear message (`Fix: ...`). Don't push; Studio does. Studio stops a pass after
   180 minutes: commit as you go (after each working piece or finished batch), so a stop loses nothing.
6. Write `.hawkes/summary.md`: what was wrong, what you changed (files), how you checked it, and anything J should
   look at. If you couldn't fix it, explain why there instead, and don't commit.
   Two approaches, then stop: when two different approaches haven't worked (the checks still fail, or you can't find
   the cause), don't keep iterating. Write `.hawkes/stuck.md` (what you tried, what happened, where you think the cause
   is) and commit nothing that doesn't work: Studio gives the next attempt a bigger model, with your notes.
7. Write `.hawkes/try.md`: how J tries it on the beta site, in two to five short steps a player would follow (where to
   go, what to press, what he should see).
8. If you can't go on without a decision that the request, the criteria and the thread don't settle (a real direction
   choice, not a detail you can decide well yourself), write ONE clear question to `.hawkes/question.md` (the options
   you see and the one you'd pick), commit nothing, and stop. Studio gets you the answer and you continue in this same
   session.
9. Before you finish, write `.hawkes/learned.md`: what the next agent working on this project should know that
   isn't obvious from the code (at most 5 lines, only real knowledge: a trap you hit and how you got past it, how a part of
   the codebase really works, a check that matters). One per line, in this form:
   - lesson: <short title> — <what broke or misled you, and the fix>
   - convention: <short title> — <how this codebase does it>
   Write nothing there if you learned nothing new. Studio keeps these in the shared memory for the next agent.

## The product's story (for tone and intent)

--- hawkesgenwebsite/AGENTS.md
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
  (Levels of detail are not an exception: Gen makes them itself as part of making every image and model, its own
  `asset.lod` work, charged to nobody; the portal only reads them: `src/lods.ts`.)
- **MCP tools pay like everything else.** Every tool in `src/mcp.ts` either answers directly (account, lists) or starts a task (`src/tasks.ts`), whose steps go through `jobs.ts submit` with the caller's `via` (the daily limit). `/mcp` takes bearer tokens only (OAuth `hgo_` or an `hg_` key), never the session cookie: it has open CORS.
- **Credits are money.** Every change of a balance is a row in `credit_ledger` in the same transaction (`billing.ts add`).
  A job is charged once (`jobs` table) and given back once (unique `job_id, kind`); a Stripe session pays once (unique
  `stripe_session_id`). Keep those indexes and the tests in `test/portal.test.ts`.
- Prices come from Gen (`POST /v1/billing/quote`). Packs are in `billing.ts PACKS`.
- Secrets live in `.env` on the box (gitignored): `HAWKESGEN_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`,
  `STRIPE_WEBHOOK_SECRET`. Never commit, print or log them.
- **Design:** the website is light (`body.landing` tokens in `public/public.css` + `public/site.css`, Inter headings, JetBrains Mono for code). The one exception is the landing page's hero (`public/overseer-sky.js` + `overseer-sky.css`): the Overseer's sky, dark like the game, which the page descends out of into the light; its wish box is a preview of the beam, not a build, and says so. Otherwise only the game is dark: the editor (`studio.css`) and `/play` (`play/play.html`), entered with a fade (`public/enter.js`). In the game everything reads like a game: no web header, a pause menu (Esc twice), game chat, cards in the world. Copy is plain and true: no claims we can't show.
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
| `src/mcp.ts` | The MCP server at `/mcp` (Streamable HTTP, stateless, protocol 2025-11-25/06-18/03-26): ~29 curated game-dev tools (sprite sheets, transparent images, edits and variations, `transform_image` (Gen `image.transform`), textures + PBR maps, skyboxes, 3D, rigging, motion, voice, SFX, music, `buy_credits` (a Stripe checkout link i
