// Third-party browser libraries, pinned and served from this site (public/vendor/<name>@<version>/), never from a CDN.
//
//   node tools/vendor.mjs                 fetch every package in tools/vendor.json, check each file against its recorded
//                                         sha256 and write it with its licenses and a .br and a .gz copy beside it
//   node tools/vendor.mjs check           offline: the files in public/vendor match the recorded sha256 and have both copies
//   node tools/vendor.mjs add <name> <version>
//                                         a NEW version of a package already listed: fetch it from the same places with the
//                                         version swapped, record the sha256 of what came (read the diff!) and write it out
//
// To update a library: `add babylonjs 7.55.0` (and its sister packages), point engine.json / the pages at the new folder,
// delete the old folder, commit. The version is in the path, so the server caches these for good (src/vendor.ts).
// A file whose sha256 differs from the record is refused: a CDN that changed under us never reaches the site.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCK = path.join(ROOT, 'tools', 'vendor.json');
const OUT = path.join(ROOT, 'public', 'vendor');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

const lock = JSON.parse(fs.readFileSync(LOCK, 'utf8'));

/** Write a file and its .br and .gz (maximum settings: these are written once, served for years). */
function write(file, buf) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buf);
  fs.writeFileSync(`${file}.br`, zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length, [zlib.constants.BROTLI_PARAM_LGWIN]: 24 } }));
  fs.writeFileSync(`${file}.gz`, zlib.gzipSync(buf, { level: 9 }));
}

async function get(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

const dirOf = (name, version) => path.join(OUT, `${name}@${version}`);

async function fetchPackage(name, pkg, { record }) {
  const dir = dirOf(name, pkg.version);
  for (const [file, f] of Object.entries(pkg.files)) {
    const buf = await get(f.url);
    const got = sha(buf);
    if (record) f.sha256 = got;
    else if (got !== f.sha256) throw new Error(`${name}@${pkg.version}/${file}: sha256 ${got} is not the recorded ${f.sha256} (${f.url}). Refused.`);
    write(path.join(dir, file), buf);
    console.log(`${name}@${pkg.version}/${file}  ${buf.length} bytes  sha256 ${got.slice(0, 12)}`);
  }
}

function check() {
  let bad = 0;
  for (const [name, pkg] of Object.entries(lock.packages)) {
    for (const [file, f] of Object.entries(pkg.files)) {
      const p = path.join(dirOf(name, pkg.version), file);
      const problems = [];
      if (!fs.existsSync(p)) problems.push('missing');
      else if (sha(fs.readFileSync(p)) !== f.sha256) problems.push('sha256 differs from the record');
      for (const ext of ['.br', '.gz']) if (!fs.existsSync(p + ext)) problems.push(`no ${ext}`);
      if (problems.length) { bad++; console.error(`${name}@${pkg.version}/${file}: ${problems.join(', ')}`); }
    }
  }
  if (bad) process.exit(1);
  console.log('vendor: every file matches its record');
}

const [cmd, a, b] = process.argv.slice(2);
if (cmd === 'check') check();
else if (cmd === 'add') {
  const pkg = lock.packages[a];
  if (!pkg || !b) { console.error('usage: node tools/vendor.mjs add <name> <version>'); process.exit(2); }
  const next = JSON.parse(JSON.stringify(pkg).split(pkg.version).join(b));
  next.version = b;
  await fetchPackage(a, next, { record: true });
  lock.packages[a] = next;
  fs.writeFileSync(LOCK, JSON.stringify(lock, null, 2) + '\n');
  console.log(b === pkg.version ? `recorded ${a}@${b}` : `recorded ${a}@${b}. Point the pages at public/vendor/${a}@${b}/ and delete public/vendor/${a}@${pkg.version}/.`);
} else {
  for (const [name, pkg] of Object.entries(lock.packages)) if (!cmd || cmd === name) await fetchPackage(name, pkg, { record: false });
}
