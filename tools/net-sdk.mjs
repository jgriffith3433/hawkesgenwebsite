// Hawkes Net's SDK for the play page: the version package.json pins (devDependencies "@hawkesgen/net", from the public
// hawkesnet-js repo by tag) copied into public/play/, where game pages import it as plain files (the site has no runtime
// dependencies, and a sandboxed game imports /play/hawkes-net.mjs). Updating it: bump the tag in package.json,
// npm install, then
//
//   npm run net-sdk            copy the installed SDK into public/play/
//   npm run net-sdk -- check   fail if public/play/ differs from the installed SDK (test/hnet.test.ts runs it)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG = path.join(ROOT, 'node_modules', '@hawkesgen', 'net');
const OUT = path.join(ROOT, 'public', 'play');
export const NET_SDK_FILES = ['hawkes-net.mjs', 'hawkes-net-core.mjs'];

/** The files of public/play/ that are not the installed SDK's ("" when they match; null when it isn't installed). Line
 *  endings don't count: git on Windows checks the copies out with CRLF, npm installs LF. */
export function netSdkDiffers() {
  if (!fs.existsSync(path.join(PKG, 'package.json'))) return null;
  const text = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
  return NET_SDK_FILES.filter((f) => !fs.existsSync(path.join(OUT, f)) || text(path.join(PKG, f)) !== text(path.join(OUT, f))).join(', ');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { version } = JSON.parse(fs.readFileSync(path.join(PKG, 'package.json'), 'utf8'));
  if (process.argv[2] === 'check') {
    const off = netSdkDiffers();
    if (off) { console.error(`public/play/ is not @hawkesgen/net ${version}: ${off} (npm run net-sdk)`); process.exit(1); }
    console.log(`public/play/ has @hawkesgen/net ${version}`);
  } else {
    for (const f of NET_SDK_FILES) fs.copyFileSync(path.join(PKG, f), path.join(OUT, f));
    console.log(`public/play/: @hawkesgen/net ${version} (${NET_SDK_FILES.join(', ')})`);
  }
}
