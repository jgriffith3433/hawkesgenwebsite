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
- **MCP tools pay like everything else.** Every tool in `src/mcp.ts` either answers directly (account, lists) or starts a task (`src/tasks.ts`), whose steps go through `jobs.ts submit` with the caller's `via` (the daily limit). `/mcp` takes bearer tokens only (OAuth `hgo_` or an `hg_` key), never the session cookie: it has open CORS.
- **Credits are money.** Every change of a balance is a row in `credit_ledger` in the same transaction (`billing.ts add`).
  A job is charged once (`jobs` table) and given back once (unique `job_id, kind`); a Stripe session pays once (unique
  `stripe_session_id`). Keep those indexes and the tests in `test/portal.test.ts`.
- Prices come from Gen (`POST /v1/billing/quote`). Packs are in `billing.ts PACKS`.
- Secrets live in `.env` on the box (gitignored): `HAWKESGEN_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`,
  `STRIPE_WEBHOOK_SECRET`. Never commit, print or log them.
- **Design:** paper and ink, one accent (`--accent`), hairline rules, Instrument Serif headings, IBM Plex Sans/Mono (`public/public.css`). No gradients, glows or emoji. Copy is plain and true: no claims we can't show.
- No runtime dependencies (Node 24, `node:sqlite`, TypeScript by type stripping: erasable syntax only, `.ts` imports).

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
| `src/admin.ts`, `public/admin.html` + `admin.js` | `/admin`: overview (revenue, accounts, credits, jobs), accounts with ledger and jobs, credit adjustments (with a note, in their ledger), disable, roles, password links. `/v1/admin/*` answers 404 to anyone but an admin |
| `src/cli.ts` | On the box: `sudo -u hawkes node src/cli.ts admin <email>` makes an admin and prints a one-time link to set the password; `password-link <email>` for a locked-out customer |
| `src/mcp.ts` | The MCP server at `/mcp` (Streamable HTTP, stateless, protocol 2025-11-25/06-18/03-26): ~24 curated game-dev tools (sprite sheets, transparent images, textures + PBR maps, skyboxes, 3D, rigging, motion, voice, SFX, music, `run_tool` for the rest), slash-command prompts (`sprite_sheet`, `character_3d`, `tileable_material`, `sound_pack`, `ui_icons`), results with inline image previews, `resource_link`s and curl lines, progress as SSE `notifications/progress` when the client sends a progressToken |
| `src/oauth.ts`, `public/authorize.html` | OAuth 2.1 for MCP clients: discovery (`/.well-known/oauth-protected-resource[/mcp]`, `/.well-known/oauth-authorization-server`), dynamic client registration (`/oauth/register`), `/oauth/authorize` (sign in, approve with a daily credit limit), `/oauth/token` (PKCE S256 required, codes single-use, refresh tokens rotate), connections (`/v1/connections`: limit, revoke) |
| `src/caller.ts` | Who is calling and through what (`via`: OAuth connection, API key, session) and the daily limit that applies |
| `src/tasks.ts` | A request as a chain of Gen jobs, each paid; later steps take earlier outputs (`{ from, pick, kind }`); kept in `tasks`, resumed after a restart |
| `src/files.ts`, `src/sign.ts` | Signed links: downloads `/dl/<token>/<name>` (a day), one-time uploads `/up/<token>` (`curl -T`, 30 min), https fetches (public addresses only) |
| `public/connect.html` | `/connect`: Add to Cursor / Install in VS Code buttons, the Claude Code command, Claude, Windsurf, ChatGPT and API-key configs, things to try, the customer's connections |
| `src/portfolio.ts` | "Built with Hawkes Gen": only claims we can show |
| `public/` | The pages: `index.html` (landing, portfolio, pricing), `app.html` + `app.js` (Creator Studio), `public.css`, `hawkesgen.mjs` (the JS client, a copy of `hawkesgen/clients/js`) |
| `deploy/` | The box: `setup.mjs` (one-time, from J's PC), `Caddyfile`, the systemd units, `pull.mjs` (self-deploy) |

## Deploys

Push to `main`. CI runs typecheck and tests; the box checks every 2 minutes (`hawkesgen-portal-pull.timer`), and
deploys a commit whose CI passed: fast-forward, restart, health check, rollback if unhealthy. Logs:
`journalctl -u hawkesgen-portal -u hawkesgen-portal-pull`. There is no beta lane yet. Push to main only with J's OK.

The box: EC2 `hawkes-gen-public` (us-east-1, t3.large, Elastic IP 54.163.56.66, SSH key and state in
`hawkesstudio/deploy/.keys/gen_public_ed25519` / `gen-public.json`). Its IAM role grants nothing it doesn't need: the
portal never touches AWS.
