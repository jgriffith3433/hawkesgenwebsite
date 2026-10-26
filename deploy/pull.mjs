// The box deploys itself: every couple of minutes (hawkesgen-portal-pull.timer), if main moved and the new commit's
// typecheck and tests pass HERE (on a clean copy, at low priority: GitHub runs no tests, J 2026-10-25), fast-forward,
// restart, check health; a commit that fails its tests or its health check is skipped.
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

/**
 * Typecheck and tests of `sha` on a clean copy (a worktree beside the checkout, its own npm ci), niced so the portal
 * keeps answering, with no secrets in the environment. Once per commit (state.tested). null: couldn't set it up.
 */
function testedHere(sha) {
  if (state.tested?.sha === sha) return state.tested.ok;
  const wt = '/srv/hawkes/.portal-test';
  const asHawkes = (cmd, args, opts = {}) => execFileSync('sudo', ['-u', 'hawkes', '-H', cmd, ...args], { encoding: 'utf8', ...opts });
  const cleanup = () => { try { git('worktree', 'remove', '--force', wt); } catch { /* not there */ } fs.rmSync(wt, { recursive: true, force: true }); try { git('worktree', 'prune'); } catch { /* fine */ } };
  const t0 = Date.now();
  try {
    cleanup();
    git('worktree', 'add', '--detach', '--quiet', wt, sha);
    const env = { PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin', LANG: 'C.UTF-8', CI: '1', NODE_ENV: 'test' };
    try {
      asHawkes('env', ['-i', ...Object.entries(env).map(([k, v]) => `${k}=${v}`), 'HOME=/home/hawkes', 'nice', '-n', '19', 'bash', '-c', 'npm ci --no-audit --no-fund --loglevel=error && npm run typecheck && npm test'], { cwd: wt, stdio: ['ignore', 'pipe', 'pipe'], timeout: 30 * 60_000, maxBuffer: 256 * 1024 * 1024 });
      state.tested = { sha, ok: true, at: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000) };
    } catch (e) {
      const out = `${e.stdout ?? ''}\n${e.stderr ?? ''}`.split('\n').filter((l) => /^(✖|not ok|error TS)/.test(l.trim())).slice(0, 6).join(' | ');
      state.tested = { sha, ok: false, at: new Date().toISOString(), detail: (out || String(e.message).split('\n')[0]).slice(0, 500) };
    }
  } catch (e) {
    say(`${sha.slice(0, 7)}: couldn't set up the test copy: ${String(e.message).split('\n')[0]}`);
    return null;
  } finally {
    cleanup();
  }
  save();
  return state.tested.ok;
}

/** GitHub's check runs on the commit: only when HAWKESGEN_PULL_GITHUB_CI=1 (GitHub no longer runs the tests). */
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
if (DRY) { say(`would test and deploy ${head.slice(0, 7)} -> ${tip.slice(0, 7)}`); process.exit(0); }
const ci = process.env.HAWKESGEN_PULL_GITHUB_CI === '1' ? await ciPassed(tip) : (say(`${tip.slice(0, 7)}: typecheck and tests here`), testedHere(tip));
if (ci === null) { say(`${tip.slice(0, 7)}: not tested yet, trying again on the next timer`); process.exit(0); }
if (!ci) { say(`${tip.slice(0, 7)}: tests failed, not deploying${state.tested?.detail ? `: ${state.tested.detail}` : ''}`); state.bad = tip; save(); process.exit(0); }

git('merge', '--ff-only', '--quiet', tip);

// The portal runs as a cluster (src/primary.ts): the primary stays, and `systemctl reload` restarts its web processes one
// at a time (a new one answering before the old one leaves, so no request and no editor stream is cut) and the worker
// last. A change to the primary itself (or a first run of the cluster unit) needs the whole service restarted.
const primaryChanged = () => git('diff', '--name-only', head, tip).split('\n').some((f) => /^(src\/primary\.ts|src\/proc\.ts|deploy\/hawkesgen-portal\.service)$/.test(f));
const ROLL = path.join(DIR, '.data', 'roll.json');
const rolled = () => { try { return JSON.parse(fs.readFileSync(ROLL, 'utf8')); } catch { return null; } };
const UNIT = '/etc/systemd/system/hawkesgen-portal.service';
async function restart() {
  // The unit file lives outside the repo: when the repo's differs (the first cluster deploy), install it and restart whole.
  const wanted = fs.readFileSync(path.join(DIR, 'deploy', 'hawkesgen-portal.service'), 'utf8');
  const installed = (() => { try { return fs.readFileSync(UNIT, 'utf8'); } catch { return ''; } })();
  if (installed !== wanted) {
    fs.writeFileSync(UNIT, wanted, { mode: 0o644 });
    execFileSync('systemctl', ['daemon-reload']);
    say('installed the portal unit (cluster)');
    execFileSync('systemctl', ['restart', 'hawkesgen-portal']);
    return true;
  }
  if (primaryChanged() || !rolled()) { execFileSync('systemctl', ['restart', 'hawkesgen-portal']); return true; }
  fs.rmSync(ROLL, { force: true });
  execFileSync('systemctl', ['reload', 'hawkesgen-portal']);
  for (let i = 0; i < 240; i++) { // (up to four minutes)
    await new Promise((r) => setTimeout(r, 1000));
    const r = rolled();
    if (r?.state === 'done') return true;
    if (r?.state === 'failed') { say(`rolling restart failed: ${r.error}`); return false; }
  }
  return false;
}

if (await restart() && await healthy()) {
  say(`deployed ${head.slice(0, 7)} -> ${tip.slice(0, 7)}: ${git('log', '-1', '--format=%s')}`);
  delete state.bad;
} else {
  say(`${tip.slice(0, 7)} did not come up healthy: back to ${head.slice(0, 7)}`);
  git('reset', '--hard', '--quiet', head);
  execFileSync('systemctl', ['restart', 'hawkesgen-portal']); // (whole service: back on the old code in every process)
  state.bad = tip;
}
save();
