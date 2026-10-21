// The box deploys itself: every couple of minutes (hawkesgen-portal-pull.timer), if main moved and GitHub's CI passed on
// the new commit, fast-forward, restart, check health; a commit that fails its health check is rolled back and skipped.
// Runs as root. No dependencies.
//   node deploy/pull.mjs            once
//   node deploy/pull.mjs --dry-run  says what it would do
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const DIR = '/srv/hawkes/hawkesgenwebsite';
const REPO = 'jgriffith3433/hawkesgenwebsite';
const STATE = path.join(DIR, '.data', 'pull.json');
const DRY = process.argv.includes('--dry-run');
const say = (...a) => console.log('[pull]', ...a);
const git = (...a) => execFileSync('sudo', ['-u', 'hawkes', '-H', 'git', '-C', DIR, ...a], { encoding: 'utf8' }).trim();
const token = () => /^GITHUB_TOKEN=(.+)$/m.exec(fs.readFileSync('/etc/hawkes/github.env', 'utf8'))?.[1].trim();
const state = (() => { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return {}; } })();
const save = () => { if (!DRY) fs.writeFileSync(STATE, JSON.stringify(state, null, 2)); };

async function ciPassed(sha) {
  const r = await fetch(`https://api.github.com/repos/${REPO}/commits/${sha}/check-runs?per_page=50`, { headers: { Authorization: `Bearer ${token()}`, Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`GitHub check-runs answered ${r.status}`);
  const runs = (await r.json()).check_runs ?? [];
  if (!runs.length || runs.some((x) => x.status !== 'completed')) return null;
  return runs.every((x) => ['success', 'skipped', 'neutral'].includes(x.conclusion));
}

async function healthy() {
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    try {
      if ((await (await fetch('http://127.0.0.1:8800/v1/health', { signal: AbortSignal.timeout(3000) })).json()).ok) return true;
    } catch {}
  }
  return false;
}

git('fetch', '--quiet', 'origin', 'main');
const head = git('rev-parse', 'HEAD');
const tip = git('rev-parse', 'origin/main');
if (head === tip || state.bad === tip) process.exit(0);
const ci = await ciPassed(tip);
if (ci === null) { say(`${tip.slice(0, 7)}: CI still running`); process.exit(0); }
if (!ci) { say(`${tip.slice(0, 7)}: CI failed, not deploying`); state.bad = tip; save(); process.exit(0); }
if (DRY) { say(`would deploy ${head.slice(0, 7)} -> ${tip.slice(0, 7)}`); process.exit(0); }

git('merge', '--ff-only', '--quiet', tip);
execFileSync('systemctl', ['restart', 'hawkesgen-portal']);
if (await healthy()) {
  say(`deployed ${head.slice(0, 7)} -> ${tip.slice(0, 7)}: ${git('log', '-1', '--format=%s')}`);
  delete state.bad;
} else {
  say(`${tip.slice(0, 7)} did not come up healthy: back to ${head.slice(0, 7)}`);
  git('reset', '--hard', '--quiet', head);
  execFileSync('systemctl', ['restart', 'hawkesgen-portal']);
  state.bad = tip;
}
save();
