// Gives every account its personal org now instead of on first touch (orgs.ts ensurePersonalOrg does the same, one
// account at a time, on any request that needs it). Idempotent: an account that has its org is left alone. Prints what
// it would do; --apply does it. Runs against one project's Firestore with J's Google login (application default
// credentials):
//   cd cloud/functions && GOOGLE_CLOUD_PROJECT=hawkes-staging node tools/migrate-orgs.ts [--apply]
if (!process.env.GOOGLE_CLOUD_PROJECT) throw new Error('set GOOGLE_CLOUD_PROJECT (hawkes-staging or hawkes-prod)');
const apply = process.argv.includes('--apply');
const { users } = await import('../src/store.ts');
const { orgs, ensurePersonalOrg } = await import('../src/orgs.ts');
const { personalOrgId } = await import('../src/platform.ts');

let have = 0, made = 0, skipped = 0;
const all = await users().select('email', 'name').get();
for (const d of all.docs) {
  let orgId: string;
  try { orgId = personalOrgId(d.id); } catch { skipped++; console.log(`skip ${d.id}: not an account id`); continue; }
  if ((await orgs().doc(orgId).get()).exists) { have++; continue; }
  if (apply) await ensurePersonalOrg({ id: d.id, email: String(d.get('email') ?? ''), name: d.get('name') ?? null });
  made++;
}
console.log(`${process.env.GOOGLE_CLOUD_PROJECT}: ${all.size} accounts, ${have} had their org, ${made} ${apply ? 'given one' : 'would get one (--apply)'}, ${skipped} skipped`);
