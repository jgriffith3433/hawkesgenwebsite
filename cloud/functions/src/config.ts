// Settings. Secrets (keys) come from Secret Manager through the functions' `secrets` list; the rest are plain
// environment variables in cloud/functions/.env.<project> (committed: nothing secret in them).
import { defineSecret } from 'firebase-functions/params';

export const SECRETS = {
  genKey: defineSecret('HAWKESGEN_KEY'),
  stripeSecret: defineSecret('STRIPE_SECRET_KEY'),
  stripeWebhook: defineSecret('STRIPE_WEBHOOK_SECRET'),
  googleSecret: defineSecret('GOOGLE_CLIENT_SECRET'),
  signing: defineSecret('PORTAL_SIGNING_KEY'),
};

export const env = (k: string): string | undefined => process.env[k] || undefined;

/** Hawkes Gen, the backend: every job runs there. */
export const genUrl = () => (env('HAWKESGEN_URL') ?? 'https://gen.hawkesgen.com').replace(/\/+$/, '');
export const genKey = () => SECRETS.genKey.value();
/** This site's own address (links in mail, Stripe's return pages, Google's redirect). */
export const publicUrl = () => (env('PUBLIC_URL') ?? 'https://hawkesgen.com').replace(/\/+$/, '');
/** Customers' Gen projects are this prefix plus 16 hex digits (usr_ on live; staging has its own). */
export const PROJECT_PREFIX = (() => {
  const p = env('PORTAL_PROJECT_PREFIX') ?? 'usr_';
  if (!/^[a-z][a-z0-9]{0,15}_$/.test(p)) throw new Error(`PORTAL_PROJECT_PREFIX must be lowercase letters and digits ending in "_" (got "${p}")`);
  return p;
})();
export const USER_ID = `${PROJECT_PREFIX}[0-9a-f]+`;
export const isLive = () => PROJECT_PREFIX === 'usr_';
