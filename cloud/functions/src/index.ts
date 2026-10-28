// hawkesgen.com's API on Google Cloud (docs/cloud.md). Firebase Hosting serves public/ and sends the dynamic paths here
// (firebase.json). Each area module registers its routes when imported.
import './options.ts';
import { onRequest } from 'firebase-functions/https';
import { handle, route } from './http.ts';
import { NET_DASHBOARD_ROUTES, netDashboardCors } from './hnet.ts';
import { SECRETS, genKey } from './config.ts';
import './accounts.ts';
import './billing.ts';
import './jobs.ts';
import './plans.ts';
import './oauth.ts';
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
import './gallery.ts';
import './portfolio.ts';
import './prices.ts';
import './demo.ts';
import './analytics.ts';
export { syncStarter } from './community.ts';
export { refreshLods } from './lods.ts';


route('GET', '/v1/health', () => ({ ok: true, service: 'hawkesgen-portal', cloud: 'gcp', gen: Boolean(genKey()), google: Boolean(process.env.GOOGLE_CLIENT_ID) }));

export const api = onRequest(
  { memory: '512MiB', concurrency: 80, timeoutSeconds: 300, minInstances: 0, secrets: Object.values(SECRETS), invoker: 'public' },
  handle,
);
