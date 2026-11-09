// Makes the community starter pack (community/starter.mjs) in Hawkes Gen, from J's PC (~/.hawkes/client.json).
//   node tools/starter.mjs list                         what's in the pack, by kind and category
//   node tools/starter.mjs check                        the pack's data is sound (names, categories, five per shelf)
//   node tools/starter.mjs estimate [kind] [category]   what making it would cost (Gen's own job history), nothing made
//   node tools/starter.mjs make <kind|all> [category]   queue what isn't made yet (costs money: estimate first, J's OK)
//   node tools/starter.mjs status [kind] [category]     how each one is doing (made, running, failed, not made)
// Everything is filed in the starter project with labels { pack, community, kind, tag, tags, name, item }; the portal
// picks up what's finished (src/community.ts syncStarter). Each thing has a stable key, so running make again never pays
// twice for what's made or under way, and retries what failed (a failed job frees its key in Gen).
import { HawkesGen } from '../public/hawkesgen.mjs';
import { STARTER, paramsFor, slug, KEY_VERSION, KIND_VERSION, keyOf, labelsOf } from '../community/starter.mjs';

export const STARTER_PROJECT = 'usr_00000000000000c0';
// (The versions, keys and labels live in community/starter.mjs since 2026-11-09: the portal remakes missing things too.)
export { KEY_VERSION, KIND_VERSION };
const KINDS = ['model', 'texture', 'image', 'sprite', 'sky', 'music', 'ambience', 'sfx', 'voice', 'video'];

const [cmd = 'list', kindArg, tag] = process.argv.slice(2);
const kind = kindArg === 'all' ? undefined : kindArg;
const pick = () => STARTER.filter((g) => (!kind || g.kind === kind) && (!tag || g.tag === tag)).flatMap((g) => g.items.map(([name, what, words]) => ({ kind: g.kind, tag: g.tag, name, what, words })));

/** Problems in the pack's data, as sentences (none: it's sound). */
export function problems() {
  const out = [];
  const seen = new Set();
  for (const g of STARTER) {
    if (!KINDS.includes(g.kind)) out.push(`unknown kind "${g.kind}"`);
    if (!/^[a-z][a-z0-9-]{1,23}$/.test(g.tag)) out.push(`${g.kind}: category "${g.tag}" is not one lowercase word`);
    if (g.tag === g.kind) out.push(`${g.kind}: category "${g.tag}" just repeats the kind (pick a shelf people browse by)`);
    // Five per shelf; a voice shelf is a set of lines (as many as the script has).
    if (g.kind !== 'voice' && g.items.length !== 5) out.push(`${g.kind}/${g.tag}: ${g.items.length} things (five per category)`);
    for (const [name, what, words] of g.items) {
      const k = `${g.kind}/${slug(name)}`;
      if (seen.has(k)) out.push(`${k}: two things share the name "${name}"`);
      seen.add(k);
      if (!what || what.length < 8) out.push(`${k}: no description`);
      if (g.kind === 'voice' && what.length > 300) out.push(`${k}: a voice line over 300 characters`);
      if (!words?.trim()) out.push(`${k}: no search words`);
    }
  }
  return out;
}

if (cmd === 'list') {
  for (const g of STARTER) console.log(`${g.kind.padEnd(9)} ${g.tag.padEnd(10)} ${g.items.map((i) => i[0]).join(', ')}`);
  const by = {};
  for (const g of STARTER) by[g.kind] = (by[g.kind] ?? 0) + g.items.length;
  console.log('\n', by, 'total', Object.values(by).reduce((a, b) => a + b, 0));
} else if (cmd === 'check') {
  const p = problems();
  console.log(p.length ? p.join('\n') : `ok: ${STARTER.length} categories, ${STARTER.reduce((n, g) => n + g.items.length, 0)} things`);
  if (p.length) process.exitCode = 1;
} else if (cmd === 'estimate') {
  const gen = new HawkesGen({ project: STARTER_PROJECT });
  const items = pick().map((it) => ({ tool: 'asset.make', params: paramsFor(it.kind, it.what), label: `${it.kind}/${it.tag}/${it.name}` }));
  const e = await gen.estimate(items, { project: STARTER_PROJECT });
  console.log(JSON.stringify(e, null, 2));
} else if (cmd === 'make') {
  if (!kindArg) throw new Error('make <kind|all> [category]');
  const p = problems();
  if (p.length) throw new Error(`fix the pack first (node tools/starter.mjs check):\n${p.join('\n')}`);
  const gen = new HawkesGen({ project: STARTER_PROJECT });
  for (const it of pick()) {
    // The same key hands back the same job when it's made or under way: running make again never pays twice.
    const job = await gen.submit('asset.make', { params: paramsFor(it.kind, it.what), labels: labelsOf(it), key: keyOf(it), reuse: true });
    console.log(`${job.status.padEnd(9)} ${job.id}  ${it.kind}/${it.tag}  ${it.name}`);
  }
} else if (cmd === 'status') {
  const gen = new HawkesGen({ project: STARTER_PROJECT });
  const jobs = (await gen.jobs({ project: STARTER_PROJECT, tool: 'asset.make', limit: 500 })).filter((j) => j.labels?.pack === 'starter');
  const count = {};
  for (const it of pick()) {
    // The newest job for this thing (jobs come newest first).
    const j = jobs.find((x) => x.labels?.kind === it.kind && (x.labels?.item ?? slug(x.labels?.name ?? '')) === slug(it.name) && x.status !== 'cancelled');
    const s = j?.status ?? 'not made';
    count[s] = (count[s] ?? 0) + 1;
    console.log(`${s.padEnd(9)} ${j?.id ?? ''.padEnd(14)}  ${it.kind}/${it.tag}  ${it.name}  ${s === 'failed' ? (j?.error ?? '').slice(0, 120) : ''}`);
  }
  console.log('\n', count);
} else throw new Error(`unknown command ${cmd}`);
