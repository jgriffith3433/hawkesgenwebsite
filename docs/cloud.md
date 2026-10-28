# hawkesgen.com on Google Cloud (serverless)

J, 2026-10-28: move the portal off AWS, "cloud forward and cheap", production class, Google sign-in only (no email and
password), small function endpoints. Phase A (done the same day) moved the box as it is to a Google VM. Phase B, this
folder, is the portal rebuilt on Firebase: it replaces `src/` (the Node server on a VM) area by area.

```
browser ──https──▶ Firebase Hosting (public/, CDN)
                      │  dynamic paths (firebase.json rewrites)
                      ▼
                  Cloud Function `api` (us-east4, Node 24, cloud/functions/src)  ──▶ Hawkes Gen (jobs, assets, GPUs)
                      │                       │
                      ▼                       ▼
                  Firestore (us-east4)    Firebase Auth (Google)        Stripe
```

- **Projects:** `hawkes-staging` (https://hawkes-staging.web.app, customers `ustg_…`, its own Gen key, no Stripe) and
  `hawkes-prod` (hawkesgen.com, customers `usr_…`). `.firebaserc` aliases `staging` and `prod`.
- **Deploy:** `firebase deploy --only hosting,functions:portal,firestore --project staging` from the repo root. Live
  (`--project prod`) only after J's `DEPLOY hawkesgenwebsite`.
- **Settings:** plain ones in `cloud/functions/.env.<project>` (committed, nothing secret); keys in Secret Manager
  (`cloud/setup-secrets.mjs`; `config.ts SECRETS`).

## Conventions (every area follows them)

- **Node 24, TypeScript by type stripping** (erasable syntax only, imports end in `.ts`), `firebase-admin` and
  `firebase-functions` are the only runtime dependencies. `npx tsc -p .` in `cloud/functions` must pass.
- **Routes:** each area is one module in `cloud/functions/src/` that calls `route(method, pathOrRegex, handler)` from
  `http.ts` when imported, and `index.ts` imports it (one line per area). A handler returns a value (sent as JSON 200) or
  answers through `res` itself. Throw `PortalError(message, { status, code })` for anything the caller should read.
  Keep every route's path, method and answer the same as `src/server.ts` has them, so `public/` keeps working.
- **Who is calling:** `requireUser(req)` / `authenticate(req)` (accounts.ts: API key or session) and
  `requireCaller(req)` / `caller(req)` (caller.ts: also OAuth tokens, with `via` and its daily cap).
- **Data:** Firestore through `store.ts` (`db`, `users()`, `ledgerOf()`, `first()`). Documents keep the SQLite
  column names. A table becomes a collection named after it (camelCase: `api_keys` → `apiKeys`), its primary key the
  document id. **Credits only change through `changeCredits`** (balance and ledger row in one transaction; `once` keys
  replace the unique indexes). Anything SQLite did in one transaction is a Firestore transaction. Queries that need a
  composite index get it in `cloud/firestore.indexes.json`.
- **No long-lived process:** no `setInterval`, no in-memory state other requests rely on. Background work is a
  scheduled function (`onSchedule`, exported from `index.ts`) or work done on the next request. Server-sent streams and
  WebSockets don't fit a function: live feeds become Firestore documents the page listens to (later, with rules), and
  game rooms are Hawkes Net's.
- **Request bodies:** Cloud Functions has read them: `req.body` (parsed JSON) and `req.rawBody` (bytes; Stripe's
  signature). At most 32 MB: bigger uploads go through signed links.
- **Cookies:** Hosting forwards only `__session`. The session is a Firebase session cookie there; nothing else may need
  a cookie (the old `hg_ref` / `hg_src` ride as query parameters on `/auth/google`).
- **Tests:** `node --test` in `cloud/functions/test/`, against the staging project (no emulator on J's PC). Use
  documents under test-only ids and delete them after.

## Status

| Area | Module | State |
|---|---|---|
| Router, settings, Firestore, sign-in (Google via Firebase Auth), accounts, API keys, referral | `http.ts`, `config.ts`, `store.ts`, `accounts.ts`, `caller.ts` | written |
| Credits, packs, Stripe Checkout and webhook, holds | `billing.ts` | written |
| Jobs: quote, submit, settle (scheduled sweep), Gen pass-through, uploads | `jobs.ts`, `gen.ts` | written |
| Plans and subscriptions | `plans.ts` | to port |
| OAuth server, MCP, tasks, files and signed links, connections | `oauth.ts`, `mcp.ts`, `tasks.ts`, `files.ts` | to port |
| Games, the assistant, scene, releases, members, invites, play pages, play assets, live feed | `games.ts`, `gameai.ts`, … | to port |
| Community, kits, shares, LODs, templates, gallery, portfolio, demo, prices, analytics relay | `community.ts`, … | to port |
| Admin, presence, friends, Hawkes Net tickets, health | `admin.ts`, `presence.ts`, `friends.ts`, `hnet.ts` | to port |
| Sign-in buttons on the pages (Google only), data move from portal.db | `public/`, `cloud/migrate.mjs` | to do |
