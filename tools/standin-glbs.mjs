// Writes the stand-in models (public/avatars-standins.js) as GLB files into test/fixtures/models: node tools/standin-glbs.mjs
// test/engine/models.test.ts checks they are what the description makes. No GPU, no network.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STANDINS, toGlb } from '../public/avatars-standins.js';

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures', 'models');
fs.mkdirSync(out, { recursive: true });
for (const [key, spec] of Object.entries(STANDINS)) {
  const bytes = toGlb(spec);
  fs.writeFileSync(path.join(out, `standin-${key}.glb`), bytes);
  console.log(`standin-${key}.glb  ${bytes.length} bytes`);
}
