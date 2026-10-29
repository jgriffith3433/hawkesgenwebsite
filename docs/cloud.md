# hawkesgen.ai on Google Cloud (serverless)

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

- **Projects:** `hawkes-staging` (beta: https://beta.hawkesgen.ai and https://hawkes-staging.web.app, customers `ustg_…`,
  gen-beta, beta Net, Stripe in test mode) and `hawkes-prod` (hawkesgen.ai, customers `usr_…`). `.firebaserc` aliases `staging`
  and `prod`.
- **Deploy:** `firebase deploy --only hosting,functions:portal,firestore --project staging` from the repo root. Live
  (`--project prod`) only after J's `DEPLOY hawkesgenwebsite`.
- **Settings:** plain ones in `cloud/functions/.env.<project>` (committed, nothing secret); keys in Secret Manager
  (`cloud/setup-secrets.mjs`; `config.ts SECRETS`).

## Lanes (dev -> beta -> main; beta never touches live)

J, 2026-10-29: the portal follows Gen and Studio's lanes. `dev` deploys nothing; `beta` deploys `hawkes-staging`;
`main` deploys `hawkes-prod` (J's `DEPLOY hawkesgenwebsite`).

| | Beta (`hawkes-staging`) | Live (`hawkes-prod`) |
|---|---|---|
| Address (`PUBLIC_URL`) | https://beta.hawkesgen.ai (and hawkes-staging.web.app) | https://hawkesgen.ai |
| Gen (`HAWKESGEN_URL`, secret `HAWKESGEN_KEY`) | https://gen-beta.hawkesgen.ai, key "portal (beta)" | https://gen.hawkesgen.ai, key "portal (live)" |
| Hawkes Net (`PORTAL_NET_URL`, `PORTAL_NET_DASHBOARD`) | https://hawkesnet.hawkesgen.ai | https://net.hawkesgen.ai (the default) |
| Hawkes Studio, "Open Studio" (`PORTAL_STUDIO_URL`) | https://studio-beta.hawkesgen.ai | https://studio.hawkesgen.ai (the default) |
| Customers (`PORTAL_PROJECT_PREFIX`) | `ustg_` | `usr_` |
| Stripe | test mode (`sk_test_…` and its webhook secret in Secret Manager; a live key is refused) | live |
| Mail | none (`unset`) | on |

- `cloud/functions/test/lanes.test.ts` checks both `.env` files (`node --test test/lanes.test.ts`, no keys needed).
- `cloud/point-gen.mjs --project <id>` makes the lane's Gen key on that lane's Gen (it checks Gen's `/v1/health` `lane`)
  and stores it; `cloud/cloudflare/beta-domain.mjs` adds beta.hawkesgen.ai (Firebase custom domain, Cloudflare DNS,
  Firebase Auth's authorized domains) and prints the OAuth redirect URI to add by hand. Both are J's (dry run first).
- Hawkes analytics stays one place (the SDK always posts to gen.hawkesgen.ai, as for every product) and files events
  from `*.hawkesgen.ai` as `beta`.

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
- **Tests:** `npm test` in `cloud/functions` (`GOOGLE_CLOUD_PROJECT=hawkes-staging` for the ones that use Firestore),
  against the staging project (no emulator on J's PC). Use documents under test-only ids and delete them after.

## Orgs, entitlements, scopes and the platform token (2026-10-29, platform Phase 0)

The portal is the one account system for Gen, Studio and Net (hawkesstudio `docs/platform-plan.md`, 4.2). The rules
are pure functions in `platform.ts` (`test/platform.test.ts`); Firestore is `orgs.ts`; the token is `platform-token.ts`.

- **Orgs** (`orgs/{org_…}`, `orgMembers/{org}__{user}`, `orgInvites/{sha256(token)}`). Every account has a **personal
  org**, `org_<the account's hex>`, made on first touch (`ensurePersonalOrg`: idempotent, safe under concurrency; or all
  at once with `GOOGLE_CLOUD_PROJECT=<project> node tools/migrate-orgs.ts [--apply]` in `cloud/functions`). Its plan is
  the owner's subscription, so Stripe bills accounts exactly as before. **Team orgs** are made by a person (their owner)
  and carry their own `plan` / `sub_status`, set by a portal admin for now (`POST /v1/orgs/<id>/plan`); Stripe billing
  per org is the next step. Roles: owner > admin > member > viewer (admins manage members and viewers only; the last
  owner can't leave). Seats are everyone but viewers. Invites go by email (Resend where mail is on) with a link
  `/orgs/join#<token>` (`public/org-join.html`) that only the invited Google account can accept; the inviter gets the
  link too. Routes: `GET|POST /v1/orgs`, `GET|PATCH|DELETE /v1/orgs/<id>`, `POST /v1/orgs/<id>/invites`,
  `DELETE /v1/orgs/<id>/invites/<id>`, `PATCH|DELETE /v1/orgs/<id>/members/<user>`, `POST /v1/orgs/invites/peek|accept`.
- **Plans and entitlements** (`platform.ts PLANS`): free, indie (~$29), team (~$99), studio (~$299), with games, seats,
  desktop minutes and monthly credits, and `entitlements` per product (`gen`, `studio`, `net`). **Prices and limits are
  provisional.** `PORTAL_PLATFORM_PLANS=on` (beta only; `test/lanes.test.ts` keeps it off live) offers them; otherwise
  free, maker and pro are offered as before. Maker and pro subscribers keep their plan either way (`legacy`). Hawkes
  Net's live rooms are the `net` entitlement now (`hnet.ts`), not "any purchase": a paid plan, or a `grants.net` on the
  personal org that the migration gives accounts that ever paid and every credit pack sets (`grantNetLive`).
- **OAuth scopes** (`oauth.ts`): `generate`, `playtest`, `backlog`, `build`, `agents`, in plain words on the consent page
  with an org picker for people in more than one org. A token gets what was asked, cut to what the picked org's plan
  and the person's role allow; no scope asked means `generate` (as before). The connection keeps its `org_id` and
  `scopes`; old connections read as the personal org with `generate`. A connection without `generate` can't run Gen
  work here (`caller.ts`; `/mcp` answers 403 insufficient_scope) but can mint platform tokens.
- **The platform token**: `POST /v1/platform/token` (a session, an `hg_` key, or an `hgo_` token; body `org`, `scope`,
  `aud` optional) returns a JWT (EdDSA, Ed25519, 10 minutes): `iss` (this lane's `PUBLIC_URL`), `aud` (`hawkesgen`,
  `hawkesstudio`, `hawkesnet`), `sub`/`user`, `org`, `project` (the Gen project), `role`, `plan`, `entitlements`,
  `scopes`, `via`. A connection gets its own org and scopes only. Gen and Studio verify it with
  **`/.well-known/jwks.json`** (also `jwks_uri` in the OAuth metadata) using `verifyPlatformToken` (copy it: it needs
  only `node:crypto`), checking `iss` for their lane. The key is the secret **`PORTAL_PLATFORM_KEY`** (PKCS#8 PEM;
  `node cloud/setup-secrets.mjs --project <id> --only PORTAL_PLATFORM_KEY`). Rotate by putting a new PEM first and the
  old one after it (both are published), then dropping the old one after 10 minutes. Without the secret the JWKS is
  empty and minting answers 503.

## Open Studio (2026-10-29)

Customers' Studios are cells (hawkesstudio `docs/studio-customers.md`): an org's own Studio is
`studio.hawkesgen.ai/o/<its Studio id>/`, and `studio.hawkesgen.ai` is the front door (Continue with Google; no Studio
yet means a short sign-up). Every "Open Studio" link on the portal is **`/studio`** (orgs.ts), which redirects:
- signed in, `?org=<org_…>` they are a member of with a Studio: that Studio's `/o/<id>/`;
- signed in, no org asked: the first of their orgs (personal first) with a Studio;
- otherwise (signed out, no Studio, not a member): the front door.
The address is the lane's (`config.ts studioUrl`, `PORTAL_STUDIO_URL`: studio-beta on beta). Studio's org ids are its
own (a slug and 4 hex), so an org records its Studio id in `orgs/{id}.studio`, set by its owners and admins with
`PATCH /v1/orgs/<id> {"studio": "<id>"}` (`""` forgets it); `/v1/orgs` and the org page show it as `studio` (the link),
`/v1/plans` carries the front door. It is only a link: the Studio checks who signs in, and no platform token rides along
(Studio's own Google sign-in is the way in; the portal never linked to `/auth/platform`). Links: the plans' actions on
`/app` and `/credits`, and the landing page's pricing notes. Tests `test/orgs.test.ts`, `test/lanes.test.ts`.
Open: Studio's control plane could tell the portal an org's Studio id when it makes the cell (today an owner sets it).

## Admin: J alone (2026-10-29)

Admin is never a stored role. `accounts.ts adminFrom(req)` decides it on every request: the `__session` cookie verified
by Firebase (revocation checked), signed in with `google.com`, its email verified by Google and on **`PORTAL_ADMIN_EMAILS`**
(comma-separated; unset means `piercehawkes3@gmail.com`; set but empty means nobody), and the same email as the portal
account it maps to. A bearer token (an `hg_` key, an `hgo_` OAuth token) and a stream link are never an admin. Everything
admin goes through it: `/admin` and `/v1/admin/*` (403 to anyone else), `/v1/health/details`, `POST /v1/orgs/<id>/plan`,
taking back someone else's community thing or kit, and Hawkes Net's dashboard admin (`hnet.ts developerOf`). The
`role` field on accounts stays in Firestore but grants nothing; `/v1/users/me` shows `role: "admin"` only on J's own
session. `cloud/make-admin.mjs` is gone, and `/v1/admin/users/<id>/role` answers 410. Test: `test/admin.test.ts` (every
admin route against nobody, a customer, a customer with `role: "admin"` set by hand, a key, a token: 403).

## Production checklist (2026-10-29)

**Verified in code and tests** (`npm test` in `cloud/functions` with `GOOGLE_CLOUD_PROJECT=hawkes-staging`: 33 pass):
- Admin is J's Google sign-in alone (above). Orgs, entitlements and the platform token have no admin bypass: an org's
  role is its `orgMembers` row, `orgContext` 404s a non-member, minting a token for an org needs membership, and the one
  portal-admin action there (a team org's plan) uses `requireAdmin`.
- Sign-in is Google only (`signInWithIdp`, a verified email required); email and password routes answer 410.
- Packs: Checkout (`billing.ts checkout`), the signed webhook (HMAC, 5 minutes), credits once per session (`once`
  `stripe:<session>`), the first-pack bonus once, and a retried delivery now finishes what a stopped one left (bonus,
  referral, Net grant). Unpaid async sessions wait for `async_payment_succeeded`.
- Plans: Checkout, `invoice.paid` gives a month's credits once per invoice (only a subscription's invoices; a one-off
  invoice gives none), the plan is read from the price's lookup key (a change made in Stripe's billing portal counts),
  cancel and resume (`cancel_at_period_end`), Stripe's billing portal (`/v1/billing/portal`).
- One Stripe account for the portal, Gen and Studio: everything the portal makes carries `metadata[product]=portal`
  (a pack's session; a plan's session and `subscription_data`, so its invoices and subscription events carry it). The
  webhook answers 200 and does nothing for an event tagged with another product (`billing.ts productOf`), or for an
  account it doesn't have; never a 4xx for those (Stripe would retry, then turn the endpoint off). Older untagged
  portal sessions and subscriptions still work.
- Failed payments: Stripe marks the subscription `past_due` (the plan holds while Stripe retries the card: the grace
  period in `platform.ts planOf`); no month's credits until an invoice is paid; when Stripe gives up the subscription is
  deleted or `unpaid` and the plan is free. Credits already given always stay.
- Holds for Gen work: a failed or cancelled job's refund is now in the same transaction as its end (no settled job with
  its credits kept), once; a hold no job was ever attached to (the function stopped before Gen answered) is given back
  after an hour by the 2-minute sweep (`releaseOrphanHolds`).
- Limits: sign-ins 20 per 15 minutes and sign-ups 5 an hour per address; checkouts, plan changes, cancel and billing
  portal 10 per 10 minutes per account (new). Checkout shows a line linking `/terms`, `/privacy` and `/refunds` above
  the pay button (`custom_text`).
- Beta reads `STRIPE_SECRET_KEY` (a `sk_test_` key, checked 2026-10-29) and `STRIPE_WEBHOOK_SECRET` from hawkes-staging's
  Secret Manager (the `api` function binds every secret in `config.ts SECRETS` at deploy); a live key there is refused.

**Left (not done):**
- Limits are per function instance (in memory), so soft. A hard limit on sign-in, sign-up and checkout needs Firestore
  counters or a Cloudflare / Cloud Armor rate rule.
- Starter credits (50) go to every new Google account: one per Google email, but nothing stops many Google accounts.
  Options: fewer, only after a first purchase, or Turnstile on sign-up.
- Refunds and disputes: `charge.refunded` and `charge.dispute.created` are not handled, so credits stay after a refund
  made in Stripe. Take them back by hand in `/admin` for now.
- Receipts: the portal sends no purchase email. Turn on Stripe's "successful payments" and "failed payments" customer
  emails (live mode; test mode sends none to customers).
- Packs and plans are billed per account; team orgs' plans are still set by J (`/v1/orgs/<id>/plan`), not Stripe.

**J's steps for a test-card purchase on beta:**
1. Stripe dashboard, **test mode**: Developers > Webhooks: an endpoint `https://beta.hawkesgen.ai/v1/billing/webhook` with
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `invoice.paid`,
   `customer.subscription.created`, `.updated`, `.deleted`. Its signing secret must be hawkes-staging's
   `STRIPE_WEBHOOK_SECRET` (else add it as a new version of that secret). Settings > Billing > Customer portal: save it
   once in test mode (the portal link fails until then). Settings > Subscriptions: after all retries fail, cancel.
2. Deploy beta (push `dev` to `beta`: `deploy-beta.bat`); the secrets bind at deploy.
3. Sign in at https://beta.hawkesgen.ai with Google, open `/credits`, buy the Starter pack with card `4242 4242 4242 4242`,
   any future date, any CVC and ZIP. Back in `/app`: 1,000 credits and the 250 first-purchase bonus in the ledger.
4. Subscribe to Indie (beta offers the platform plans) with the same card: 1,500 credits and the plan. Manage billing
   opens Stripe's portal; cancel there or in `/credits` (ends at the period's end), choose the plan again to resume.
5. A failed payment: in the portal, change the card to `4000 0000 0000 0341` (attaches, then declines), then in the
   dashboard advance the subscription with a test clock or "Create invoice" > charge: it goes `past_due`, no credits.
6. Check: the webhook endpoint shows 200s; `/admin` > Purchases lists the pack.

## Status

| Area | Module | State |
|---|---|---|
| Router, settings, Firestore, sign-in (Google via Firebase Auth), accounts, API keys, referral | `http.ts`, `config.ts`, `store.ts`, `accounts.ts`, `caller.ts` | ported |
| Credits, packs, Stripe Checkout and webhook, holds | `billing.ts` | ported |
| Jobs: quote, submit, settle (scheduled sweep), Gen pass-through, uploads | `jobs.ts`, `gen.ts` | ported |
| Plans and subscriptions | `plans.ts` | ported |
| OAuth server, MCP, tasks, files and signed links, connections | `oauth.ts`, `mcp.ts`, `tasks.ts`, `files.ts` | ported |
| Games, the assistant, scene, releases, members, invites, play pages, play assets, live feed | `games.ts`, `gameai.ts`, … | ported |
| Community, kits, shares, LODs, templates, gallery, portfolio, demo, prices, analytics relay | `community.ts`, … | ported |
| Admin, presence, friends, Hawkes Net tickets, health | `admin.ts`, `presence.ts`, `friends.ts`, `hnet.ts` | ported |
| Orgs, members, invites, entitlements, OAuth scopes, the platform token (JWT + JWKS) | `platform.ts`, `orgs.ts`, `platform-token.ts` | new (2026-10-29), on beta first |
| Sign-in buttons on the pages (Google only), data move from portal.db | `public/`, `cloud/migrate.mjs` | ported; the data move is being matched to each module |

Staging: https://hawkes-staging.web.app (deployed 2026-10-28). Scheduled functions: settleJobs (2 min), advanceTasks (1 min),
advanceGameGens (1 min), syncStarter (10 min), refreshLods (15 min); gameAssistant runs on a Firestore trigger.

## What changed from the box (decide or check on staging)

- Sign-in is Google only. Old email accounts link by email. Studio's sign-up playtests stop at the account sheet.
- Uploads through a function: 30 MB (Google's 32 MB request limit), was 64 MB; bigger files by https URL.
- Long waits end sooner: /v1/run and MCP streams within ~270 s (then get_task); Hosting may cut a function request at
  60 s and buffer server-sent streams: check /v1/run, MCP progress, the editor's live feed and large /play-asset files.
- Library search matches whole words and word starts (no full-text search in Firestore).
- New levels of detail can take up to 15 minutes to appear (refreshLods), unless a share or the starter sync recorded them.
- Game rooms are Hawkes Net's only (no in-process rooms).
- No email yet (welcome, gifts, low balance): SES needed the AWS box's role. To do: a mail provider.
- One-time per project: `cloud/grant-build.ps1` (the default compute service account's roles) and
  `cloud/setup-secrets.mjs` (the keys in Secret Manager).
