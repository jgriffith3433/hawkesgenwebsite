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
// The code's defaults (config.ts genUrl/publicUrl/studioUrl, hnet.ts netUrl/netDashboard) are live: a missing setting means live.
const host = (env: Record<string, string>, k: string, fallback: string) => new URL(env[k] ?? fallback).host;

test('beta (hawkes-staging) uses gen-beta, beta Net and its own customers', () => {
  const env = read('hawkes-staging');
  assert.equal(host(env, 'HAWKESGEN_URL', 'https://gen.hawkesgen.ai'), 'gen-beta.hawkesgen.ai');
  assert.equal(host(env, 'PORTAL_NET_URL', 'https://net.hawkesgen.ai'), 'hawkesnet.hawkesgen.ai');
  assert.equal(host(env, 'PORTAL_NET_DASHBOARD', 'https://net.hawkesgames.com'), 'net-beta.hawkesgames.com');
  assert.equal(host(env, 'PUBLIC_URL', 'https://hawkesgames.com'), 'beta.hawkesgames.com');
  assert.equal(host(env, 'PORTAL_STUDIO_URL', 'https://studio.hawkesgen.ai'), 'studio-beta.hawkesgen.ai', 'Open Studio goes to studio-beta');
  assert.notEqual(env.PORTAL_PROJECT_PREFIX ?? 'usr_', 'usr_', 'beta customers are never usr_');
  assert.ok(!env.PORTAL_MAIL, 'beta sends no mail');
  for (const k of ['PORTAL_NET_HOSTS', 'PORTAL_CDN_HOSTS']) for (const h of (env[k] ?? '').split(',').filter(Boolean)) assert.doesNotMatch(h, /\/\/(net|gen)\.hawkesgen\.ai/, `${k} names a live host`);
});

test('Studio links join the lane address and the path with one slash (config.ts studioPage)', async () => {
  const { studioPage } = await import('../src/config.ts');
  for (const [project, host] of [['hawkes-staging', 'https://studio-beta.hawkesgen.ai'], ['hawkes-prod', 'https://studio.hawkesgen.ai']]) {
    const set = read(project).PORTAL_STUDIO_URL ?? 'https://studio.hawkesgen.ai';
    assert.equal(set.replace(/\/+$/, ''), host, project);
    for (const base of [set, `${host}/`, `${host}//`, ` ${host}/ `, `${host}\r\n`]) {
      assert.equal(studioPage('/', base), `${host}/`, `${project} front door from ${JSON.stringify(base)}`);
      assert.equal(studioPage('', base), `${host}/`);
      assert.equal(studioPage('/o/acme-3f2a/', base), `${host}/o/acme-3f2a/`);
      assert.equal(studioPage('o/acme-3f2a/', base), `${host}/o/acme-3f2a/`);
      assert.doesNotMatch(studioPage('/o/acme-3f2a/', base).slice(8), /\/\//, 'no double slash after the scheme');
    }
  }
  // The env var with a trailing slash, as read at run time.
  const was = process.env.PORTAL_STUDIO_URL;
  process.env.PORTAL_STUDIO_URL = 'https://studio-beta.hawkesgen.ai/';
  try { assert.equal(studioPage(), 'https://studio-beta.hawkesgen.ai/'); } finally { if (was === undefined) delete process.env.PORTAL_STUDIO_URL; else process.env.PORTAL_STUDIO_URL = was; }
});

test("admin is J's address on both lanes (accounts.ts adminEmails: unset means piercehawkes3@gmail.com)", () => {
  for (const project of ['hawkes-staging', 'hawkes-prod']) {
    const v = read(project).PORTAL_ADMIN_EMAILS;
    if (v !== undefined) assert.equal(v.trim().toLowerCase(), 'piercehawkes3@gmail.com', `${project} names another admin: ${v}`);
  }
});

test('live (hawkes-prod) uses live Gen and live Net, never a beta one', () => {
  const env = read('hawkes-prod');
  assert.equal(host(env, 'HAWKESGEN_URL', 'https://gen.hawkesgen.ai'), 'gen.hawkesgen.ai');
  assert.equal(host(env, 'PORTAL_NET_URL', 'https://net.hawkesgen.ai'), 'net.hawkesgen.ai');
  assert.equal(host(env, 'PORTAL_NET_DASHBOARD', 'https://net.hawkesgames.com'), 'net.hawkesgames.com');
  // The platform plans (indie, team, studio) are offered on beta first; live keeps free, maker and pro until J sets the
  // prices (platform.ts offeredPlans).
  assert.notEqual(env.PORTAL_PLATFORM_PLANS, 'on', 'live does not offer the platform plans yet');
  assert.equal(host(env, 'PUBLIC_URL', 'https://hawkesgames.com'), 'hawkesgames.com');
  assert.equal(host(env, 'PORTAL_STUDIO_URL', 'https://studio.hawkesgen.ai'), 'studio.hawkesgen.ai');
  assert.equal(env.PORTAL_PROJECT_PREFIX ?? 'usr_', 'usr_');
  for (const v of Object.values(env)) assert.doesNotMatch(v, /beta|staging/, `a live setting names beta: ${v}`);
});
