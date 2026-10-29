// hawkesgen.ai's API on Google Cloud (docs/cloud.md). Firebase Hosting serves public/ and sends the dynamic paths here
// (firebase.json). Each area module registers its routes when imported.
import './options.ts';
import { onRequest } from 'firebase-functions/https';
import { handle, route } from './http.ts';
import { NET_DASHBOARD_ROUTES, netDashboardCors } from './hnet.ts';
import { SECRETS, genKey, publicUrl } from './config.ts';
import { STREAMS } from './accounts.ts';
import './billing.ts';
import './jobs.ts';
import './plans.ts';
import './oauth.ts';
import './orgs.ts';
import './platform-token.ts';
import './files.ts';
import './tasks.ts';
import './mcp.ts';
import './admin.ts';
import './friends.ts';
import './presence.ts';
import './invites.ts';
import './hnet.ts';
import './health.ts';
export { settleJobs } from './jobs.ts';
export { advanceTasks } from './tasks.ts';
import './community.ts';
import './kits.ts';
import './shares.ts';
import './portfolio.ts';
import './prices.ts';
import './demo.ts';
import './analytics.ts';
export { syncStarter } from './community.ts';
export { refreshLods } from './lods.ts';
import './games.ts';
import './playpages.ts';
import './use-community.ts';
// The assistant searches the community library (gameai.ts's hook, set here so neither area imports the other).
import { community as assistantLibrary } from './gameai.ts';
import { search as librarySearch } from './community.ts';
assistantLibrary.search = librarySearch as typeof assistantLibrary.search;
export { gameAssistant, advanceGameGens } from './gameai.ts';

route('GET', '/v1/health', () => ({ ok: true, service: 'hawkesgen-portal', cloud: 'gcp', gen: Boolean(genKey()), google: Boolean(process.env.GOOGLE_CLIENT_ID) }));

export const api = onRequest(
  { memory: '512MiB', cpu: 1, concurrency: 80, timeoutSeconds: 300, minInstances: 0, secrets: Object.values(SECRETS), invoker: 'public' },
  (req, res) => {
    const path = new URL(req.originalUrl || req.url || '/', 'https://x').pathname;
    // The Net dashboard's CORS on every route it uses, including accounts.ts's (api-key, logout).
    if (NET_DASHBOARD_ROUTES.test(path)) netDashboardCors(req, res);
    // Streams reached at the function's own address from our pages (stream links: accounts.ts), no cookies.
    if (STREAMS.test(path) && req.headers.origin === publicUrl()) res.set({ 'Access-Control-Allow-Origin': publicUrl(), Vary: 'Origin' });
    return handle(req, res);
  },
);
