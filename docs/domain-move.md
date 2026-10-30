# Moving the portal to hawkesgames.com (and hawkesgen.ai to Gen)

J, 2026-10-29: three products. **hawkesgames.com** is the portal (it was hawkesgen.ai), **HawkesGen.ai** is Hawkes Gen's own
app (it was gen.hawkesgen.ai), and **Studio** stays at studio.hawkesgen.ai. gen.hawkesgen.ai keeps working forever, so every SDK, Unity package, `~/.hawkes/client.json` and
customer setup that names it needs no change.

| | Before | After |
|---|---|---|
| Portal, live | hawkesgen.ai (Firebase hawkes-prod) | **hawkesgames.com** (+ www, redirected) |
| Portal, beta | beta.hawkesgen.ai (Firebase hawkes-staging) | **beta.hawkesgames.com** |
| Gen, live | gen.hawkesgen.ai | **hawkesgen.ai** and gen.hawkesgen.ai (one Worker) |
| Gen, beta | gen-beta.hawkesgen.ai | **beta.hawkesgen.ai** and gen-beta.hawkesgen.ai |
| Net dashboard, live | net.hawkesgen.ai | **net.hawkesgames.com** (the old name sends the page there) |
| Net dashboard, beta | hawkesnet.hawkesgen.ai | **net-beta.hawkesgames.com** |
| Net relay, SDKs, tickets | net.hawkesgen.ai, hawkesnet.hawkesgen.ai | unchanged |
| Studio, CDN, beta game sites | studio., cdn., `<sub>.hawkesgen.ai` | unchanged |
| Mail | support@hawkesgen.ai | unchanged (Resend and MX stay on hawkesgen.ai) |

**Why the Net dashboard moves:** it reads the portal with the portal's session cookie. A browser sends that only when both
pages are on the same site, so it has to sit under hawkesgames.com.

**What hawkesgen.ai does after the move** (hawkesgen `server/gen-edge/src/index.ts`, test `test/gen-edge.test.ts`): it
is Hawkes Gen's own app (the app at `/`, its sign-in, `/legal`, `/admin`, checkout and the API), and the Worker keeps the
portal's old links working:
- A portal OAuth token (`hgo_`) goes to the portal, and so does the portal's `__session` cookie on `/v1` and `/mcp`. A
  platform token (a JWT) goes only to Gen.
- Everything else goes to Gen first. What Gen doesn't have (404) is the portal's: an old page (a browser asking for HTML)
  gets a 301 to the same path on hawkesgames.com; anything else (OAuth, `/up/` with `curl -T`, `/dl/`, the play API) is
  passed on to it. On `/v1` and `/mcp`, a key Gen refuses (401: a portal key, which looks like Gen's `hg_`) is passed on
  too.
- Where both have a path, Gen wins: `/`, `/app`, `/play`, `/legal`, `/admin`, `/v1/billing/webhook`.

So customers' code, editor connections and the Unity package keep working. MCP clients set up with
`https://hawkesgen.ai/mcp` can still sign in, because the portal accepts its former addresses as the OAuth resource
(`PORTAL_FORMER_URLS`). The portal's Stripe webhook does not carry over (see step 5).

## The order

Beta first, all the way through, then live. Every step can be run again safely. Code is on `dev` in hawkesgenwebsite,
hawkesgen, hawkesstudio and hawkesnet, and nothing is deployed until it reaches the right branch at the right step below.

### 1. The portal answers on hawkesgames.com (both names work)

1. `node cloud/cloudflare/portal-domain.mjs --lane beta`. Read the dry run, then run it again with `--apply`. It adds:
   - beta.hawkesgames.com as a Firebase Hosting domain of hawkes-staging, with Firebase's DNS records (DNS only);
   - net-beta.hawkesgames.com as an A record to the beta Net VM;
   - beta.hawkesgames.com to Firebase Auth's authorized domains.

   Run it again until the certificate says ACTIVE.
2. In the Google Cloud console, under OAuth client 217916967472-… > Authorized redirect URIs, add
   `https://beta.hawkesgames.com/auth/google/callback`. Keep the old ones until step 5. Then, under Google Auth Platform >
   Branding > Authorized domains, add `hawkesgames.com`. Google may ask you to verify it in Search Console: add the TXT
   record it gives you in the hawkesgames.com zone.
3. Push hawkesgenwebsite `dev` to `beta`. The portal now uses `PUBLIC_URL=https://beta.hawkesgames.com` for its links,
   Google sign-in, Stripe return pages and mail. hawkes-staging still answers on beta.hawkesgen.ai too. A Google sign-in
   started there first moves to the new name (`/auth/google` looks at `X-Forwarded-Host` against `PORTAL_FORMER_URLS`),
   because that is where Google comes back to and where the sign-in cookie has to be. Someone already signed in on the
   old name signs in once more on the new one.
4. Check https://beta.hawkesgames.com: sign in with Google, open /app, /connect and /net.

### 2. Net's dashboard on its new name

1. hawkesnet: `node deploy/setup.mjs --lane beta`. This writes the Caddyfile with both names (hawkesnet.hawkesgen.ai and
   net-beta.hawkesgames.com), and Caddy fetches the new certificate. A pull doesn't change Caddy: only setup.mjs does.
2. Push hawkesnet `dev` to `beta`. The dashboard now signs in against beta.hawkesgames.com, and
   hawkesnet.hawkesgen.ai/ sends the page to net-beta.hawkesgames.com. The relay and SDK files stay where they are.
3. Check: https://net-beta.hawkesgames.com signs in and lists projects, and a game on beta still joins a room.

### 3. Gen and Studio trust the new portal

Push hawkesgen `dev` and hawkesstudio `dev` to `beta`. What changes:
- Platform tokens' issuer defaults to beta.hawkesgames.com / hawkesgames.com (`settings.platform.issuer` and
  `STUDIO_PLATFORM_ISSUER` still override). The live portal on Cloud Functions mints none yet, so nothing in use breaks.
- Gen's analytics now count hawkesgames.com as the portal's live site and beta.hawkesgames.com as its beta.
- Studio playtests the portal live at hawkesgames.com, and its health alert checks hawkesgames.com/v1/health.

### 4. Gen takes the old name (the cutover; a quiet hour)

1. hawkesgen `server/gen-edge`: `npx wrangler deploy --env beta`. The new routes do nothing yet, because beta.hawkesgen.ai is
   still a DNS-only record pointing at Firebase.
2. `node cloud/cloudflare/cutover.mjs --lane beta` (then `--apply`): beta.hawkesgen.ai leaves Firebase hawkes-staging,
   its records give way to a proxied `AAAA beta.hawkesgen.ai 100::`, and it waits until the name answers as Gen beta.
3. Check:
   - `curl https://beta.hawkesgen.ai/v1/health` answers as Gen beta;
   - `curl -I -H "Accept: text/html" https://beta.hawkesgen.ai/connect` is a 301 to beta.hawkesgames.com;
   - a portal key's job through `https://beta.hawkesgen.ai/v1/jobs` reaches the beta portal.

### 5. Live: the same, in the same order

1. `node cloud/cloudflare/portal-domain.mjs --lane live` (then `--apply`). In the console, add the redirect URI
   `https://hawkesgames.com/auth/google/callback`.
2. **Stripe** (live mode). One account takes payments for the portal, Gen and Studio. Each has its own endpoint, gets
   every event, and acts only on its own: `metadata[product]` is `portal`, `gen` or `studio`, and the portal's older,
   untagged sessions count as the portal's.
   - **Endpoints** (Developers > Webhooks), each with the same five or six events:
     - `https://hawkesgames.com/v1/billing/webhook` (the portal): `checkout.session.completed`,
       `checkout.session.async_payment_succeeded`, `invoice.paid`, `customer.subscription.created`,
       `customer.subscription.updated`, `customer.subscription.deleted`.
     - `https://hawkesgen.ai/v1/billing/webhook` (Gen; made after the live cutover, `stripe-setup.mjs --after-cutover`): `checkout.session.completed`,
       `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`.
     - `https://studio.hawkesgen.ai/api/billing/webhook` (Studio): the same five as Gen.
   - **Keys:** both lanes in `C:/Projects/stripe.txt` (the names are in `cloud/stripe-keys.mjs`'s header: live keys,
     test keys, and one webhook secret per product and lane; beta's three endpoints are the sandbox's, on
     beta.hawkesgames.com, gen-beta.hawkesgen.ai and studio-beta.hawkesgen.ai), then run
     `node cloud/stripe-keys.mjs C:/Projects/stripe.txt`. It sets the portal's secrets in hawkes-prod's Secret Manager
     (the new webhook secret goes beside the hawkesgen.ai endpoint's: `STRIPE_WEBHOOK_SECRET` may list several), and Gen's
     and Studio's through their owner-only config routes.
   - **Settings > Business:** the website is hawkesgames.com; support, privacy and terms are `/legal` there. Payment
     method domains: add hawkesgames.com if Apple Pay or Google Pay are on.
3. Go live: hawkesgenwebsite (`DEPLOY hawkesgenwebsite`), then `node deploy/setup.mjs` in hawkesnet, then hawkesnet,
   hawkesgen and hawkesstudio (their go-live steps). That is steps 1 to 3 for live.
4. Cutover, the same as step 4:
   - `npx wrangler deploy` in gen-edge;
   - remove hawkesgen.ai and www.hawkesgen.ai from Firebase hawkes-prod's custom domains;
   - in Cloudflare, replace their records with proxied `AAAA hawkesgen.ai 100::` and `AAAA www.hawkesgen.ai 100::`. Leave
     MX, SPF, DKIM and the Resend records alone: mail stays.
   - delete the old portal endpoint `https://hawkesgen.ai/v1/billing/webhook` in Stripe now: that address is Gen's from
     here on, and Gen refuses the portal's signature. The hawkesgames.com endpoint carries the portal's events.
5. A day later, if all is well:
   - `node cloud/setup-secrets.mjs --project hawkes-prod --stripe C:/Projects/stripe.txt --drop-old` (with only the
     portal's lines) keeps only the hawkesgames.com endpoint's webhook secret;
   - remove the hawkesgen.ai redirect URIs from the OAuth client;
   - update `~/.hawkes/client.json` `genUrl` to https://hawkesgen.ai if you like (the old one keeps working).

## Rolling back

Before step 4 nothing is lost: the portal answers on both names. At step 4, put the DNS-only records back and add the
domain to Firebase again (the Worker's routes go quiet by themselves once the record isn't proxied). If needed, set
`PUBLIC_URL` back in `cloud/functions/.env.<project>`.

## Not moved (follow-ups)

- The Unity package `hawkesgen-unity` and other clients that default to `https://hawkesgen.ai` as the portal. They keep
  working through the Worker, but their next release should default to hawkesgames.com.
- Product sites' copies of the Gen client and the analytics SDK use gen.hawkesgen.ai, which stays.
- `src/` (the retired box server) and the stale worktree under `.claude/worktrees/` still say hawkesgen.ai. Neither runs.

## After the cutover: gen.hawkesgen.ai goes away

J, 2026-10-29: Gen's name is hawkesgen.ai (beta.hawkesgen.ai on beta); gen.hawkesgen.ai and gen-beta.hawkesgen.ai are
going away. They keep working (the same Worker) until nothing calls them, so the order is: cutover, then every repo's
`gen.hawkesgen.ai` becomes `hawkesgen.ai` and `gen-beta.hawkesgen.ai` becomes `beta.hawkesgen.ai` (SDK defaults, the
analytics tag on every site, Studio, Net, the portal's `HAWKESGEN_URL`, CI, `~/.hawkes/client.json`, Stripe's Gen
webhooks), then the old routes come off the Worker.

**Done 2026-10-29:** the cutover on both lanes; the sweep in hawkesgen, hawkesstudio, hawkesgenwebsite and hawkesnet (the
portal's `HAWKESGEN_URL` is https://hawkesgen.ai / https://beta.hawkesgen.ai). Product sites and Unity projects follow;
then gen.hawkesgen.ai and gen-beta.hawkesgen.ai come off the Worker (hawkesgen `server/gen-edge/wrangler.jsonc`). Stripe's Gen webhooks: `https://hawkesgen.ai/v1/billing/webhook` and
`https://beta.hawkesgen.ai/v1/billing/webhook`.
