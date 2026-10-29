// Beta never touches live (2026-10-29): the settings each Firebase project deploys with (cloud/functions/.env.<project>)
// point beta (hawkes-staging) at beta Gen and beta Hawkes Net, and live (hawkes-prod) at live ones. Reads only the files:
//   node --test --disable-warning=ExperimentalWarning test/lanes.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (project: string) => Object.fromEntries(
  fs.readFileSync(new URL(`../.env.${project}`, import.meta.url), 'utf8').split(/\r?\n/)
    .map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l.trim())).filter((m): m is RegExpExecArray => Boolean(m)).map((m) => [m[1], m[2].trim()]),
) as Record<string, string>;
// The code's defaults (config.ts genUrl/publicUrl, hnet.ts netUrl/netDashboard) are live: a missing setting means live.
const host = (env: Record<string, string>, k: string, fallback: string) => new URL(env[k] ?? fallback).host;

test('beta (hawkes-staging) uses gen-beta, beta Net and its own customers', () => {
  const env = read('hawkes-staging');
  assert.equal(host(env, 'HAWKESGEN_URL', 'https://gen.hawkesgen.ai'), 'gen-beta.hawkesgen.ai');
  assert.equal(host(env, 'PORTAL_NET_URL', 'https://net.hawkesgen.ai'), 'hawkesnet.hawkesgen.ai');
  assert.equal(host(env, 'PORTAL_NET_DASHBOARD', 'https://net.hawkesgen.ai'), 'hawkesnet.hawkesgen.ai');
  assert.equal(host(env, 'PUBLIC_URL', 'https://hawkesgen.ai'), 'beta.hawkesgen.ai');
  assert.notEqual(env.PORTAL_PROJECT_PREFIX ?? 'usr_', 'usr_', 'beta customers are never usr_');
  assert.ok(!env.PORTAL_MAIL, 'beta sends no mail');
  for (const k of ['PORTAL_NET_HOSTS', 'PORTAL_CDN_HOSTS']) for (const h of (env[k] ?? '').split(',').filter(Boolean)) assert.doesNotMatch(h, /\/\/(net|gen)\.hawkesgen\.ai/, `${k} names a live host`);
});

test('live (hawkes-prod) uses live Gen and live Net, never a beta one', () => {
  const env = read('hawkes-prod');
  assert.equal(host(env, 'HAWKESGEN_URL', 'https://gen.hawkesgen.ai'), 'gen.hawkesgen.ai');
  assert.equal(host(env, 'PORTAL_NET_URL', 'https://net.hawkesgen.ai'), 'net.hawkesgen.ai');
  assert.equal(host(env, 'PORTAL_NET_DASHBOARD', 'https://net.hawkesgen.ai'), 'net.hawkesgen.ai');
  assert.equal(host(env, 'PUBLIC_URL', 'https://hawkesgen.ai'), 'hawkesgen.ai');
  assert.equal(env.PORTAL_PROJECT_PREFIX ?? 'usr_', 'usr_');
  for (const v of Object.values(env)) assert.doesNotMatch(v, /beta|staging/, `a live setting names beta: ${v}`);
});
