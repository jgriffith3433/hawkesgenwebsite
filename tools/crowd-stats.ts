// What a crowd costs, measured through the resource monitor on the real presence code (test harness: Babylon's NullEngine, so the
// draw calls and triangles are counted from what the camera draws, and the milliseconds are Node's, good to compare runs, not phones).
// The table in docs/characters.md "A crowd" is this tool's output.
//   node --disable-warning=ExperimentalWarning tools/crowd-stats.ts
import { load } from '../test/engine/harness.ts';
import { measureCrowd } from '../test/engine/crowd-measure.ts';

const H = await load();
const rows = [
  ['1 body (you)', 1, {}],
  ['10, different looks', 10, {}],
  ['10, one look', 10, { sameLook: true }],
  ['10, all past 30 m', 10, { spread: 'far' }],
  ['30, different looks', 30, {}],
  ['30, one look', 30, { sameLook: true }],
  ['30, a third past 30 m', 30, { spread: 'mixed' }],
] as const;
console.log('| Crowd (phone tier) | Draw calls | Triangles | Frame (Node) | In full | Cheap | Past 30 m |\n|---|---|---|---|---|---|---|');
for (const [name, n, o] of rows) {
  const r = measureCrowd(H, name, n, o as any);
  console.log(`| ${name} | ${r.draws} | ${r.triangles.toLocaleString('en')} | ${r.frameMs.toFixed(1)} ms | ${r.full} | ${r.simple} | ${r.far} |`);
}
const d = measureCrowd(H, 'desktop 30', 30, { tier: 'desktop' });
console.log(`| 30, different looks (desktop tier: cap ${H.budget.characters}) | ${d.draws} | ${d.triangles.toLocaleString('en')} | ${d.frameMs.toFixed(1)} ms | ${d.full} | ${d.simple} | ${d.far} |`);
process.exit(0);
