// Which recorded voice clips have a line in the game's text, and which lines have a clip.
// node tools/voice-coverage.mjs        (reads the sources, hashes every string literal like runtime.js lineHash)
import fs from 'node:fs';
import path from 'node:path';
const hash = (t) => { const s = String(t).trim().toLowerCase().replace(/\s+/g, ' '); let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); };
const files = [];
const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) { if (!/vendor|node_modules|anim$/.test(f.name)) walk(p); } else if (/\.(js|ts|json)$/.test(f.name)) files.push(p); } };
walk('src/overseer-games'); walk('public/play/modules'); files.push('public/play/guest.js', 'public/play/runtime.js');
const clips = new Set(fs.readdirSync('public/play/audio/voice').filter((f) => f.endsWith('.mp3')).map((f) => f.slice(0, -4)));
const byHash = new Map();
for (const f of clips) { const h = f.split('-')[1]; (byHash.get(h) || byHash.set(h, []).get(h)).push(f); }
const found = new Map();
for (const f of files) {
  if (!fs.existsSync(f)) continue;
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/'((?:[^'\\\n]|\\.)+)'|"((?:[^"\\\n]|\\.)+)"|`((?:[^`\\]|\\.)+)`/g)) {
    let s = m[1] ?? m[2] ?? m[3]; s = s.replace(/\\(['"`\\])/g, '$1').replace(/\\n/g, ' ');
    if (s.length < 3) continue;
    const h = hash(s);
    if (byHash.has(h)) for (const c of byHash.get(h)) (found.get(c) || found.set(c, []).get(c)).push(`${f}: ${s}`);
  }
}
const orphans = [...clips].filter((c) => !found.has(c));
const bySpeaker = {};
for (const c of clips) { const sp = c.split('-')[0]; (bySpeaker[sp] ||= { files: 0, matched: 0 }).files++; if (found.has(c)) bySpeaker[sp].matched++; }
console.log(JSON.stringify(bySpeaker));
for (const c of clips) if (c.startsWith("narrator-")) console.log(c, (found.get(c)||[]).slice(0,2));
console.log('files with no line in the sources:', orphans.length);
for (const c of orphans) console.log('  ' + c);
