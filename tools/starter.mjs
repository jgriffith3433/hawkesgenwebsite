// Makes the community starter pack (community/starter.mjs) in Hawkes Gen, from J's PC (~/.hawkes/client.json).
//   node tools/starter.mjs list                       what's in the pack, by kind and tag
//   node tools/starter.mjs make <kind> [tag]          queue what isn't made yet (costs money: price it first)
//   node tools/starter.mjs status [kind] [tag]        how each one is doing (made, running, not made)
// Everything is filed in the starter project with labels { pack, community, kind, tag, tags, name }; the portal picks up
// what's finished (src/community.ts syncStarter). Each job has a stable key, so running make again never pays twice.
import { HawkesGen } from '../public/hawkesgen.mjs';
import { STARTER, stepsFor, slug } from '../community/starter.mjs';

export const STARTER_PROJECT = 'usr_00000000000000c0';
const [cmd = 'list', kind, tag] = process.argv.slice(2);
const pick = () => STARTER.filter((g) => (!kind || g.kind === kind) && (!tag || g.tag === tag)).flatMap((g) => g.items.map(([name, what, words]) => ({ kind: g.kind, tag: g.tag, name, what, words })));
const keyOf = (it) => `starter/${it.kind}/${slug(it.name)}/v1`;

if (cmd === 'list') {
  for (const g of STARTER) console.log(`${g.kind.padEnd(9)} ${g.tag.padEnd(10)} ${g.items.map((i) => i[0]).join(', ')}`);
  const by = {};
  for (const g of STARTER) by[g.kind] = (by[g.kind] ?? 0) + g.items.length;
  console.log('\n', by, 'total', Object.values(by).reduce((a, b) => a + b, 0));
} else if (cmd === 'make') {
  if (!kind) throw new Error('make <kind> [tag]: one kind at a time');
  const gen = new HawkesGen({ project: STARTER_PROJECT });
  for (const it of pick()) {
    const labels = { pack: 'starter', community: true, kind: it.kind, tag: it.tag, tags: [it.tag, ...it.words.split(/\s+/)].join(' '), name: it.name };
    // The same key hands back the same job (made, running or queued): running make again never pays twice.
    const job = await gen.submit('asset.make', { params: { steps: stepsFor(it.kind, it.what) }, labels, key: keyOf(it), reuse: true });
    console.log(`${job.status.padEnd(9)} ${job.id}  ${it.kind}/${it.tag}  ${it.name}`);
  }
} else if (cmd === 'status') {
  const gen = new HawkesGen({ project: STARTER_PROJECT });
  const jobs = (await gen.jobs({ project: STARTER_PROJECT, tool: 'asset.make', limit: 500 })).filter((j) => j.labels?.pack === 'starter');
  for (const it of pick()) {
    const j = jobs.find((x) => x.labels?.name === it.name && x.labels?.kind === it.kind && x.status !== 'cancelled');
    console.log(`${(j?.status ?? 'not made').padEnd(9)} ${j?.id ?? ''.padEnd(14)}  ${it.kind}/${it.tag}  ${it.name}  ${j?.detail ?? ''}`);
  }
} else throw new Error(`unknown command ${cmd}`);
