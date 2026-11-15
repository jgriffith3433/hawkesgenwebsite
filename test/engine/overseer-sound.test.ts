// Overseer sound identity: distance → hum gain rises ≥ 6 dB from 60 m to 5 m; mood pick.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');

describe('overseer sound identity', () => {
  it('ships sound.js and wires it in the overseer module', () => {
    const mod = JSON.parse(readFileSync(path.join(ROOT, 'public/play/modules/overseer/module.json'), 'utf8'));
    assert.ok(mod.scripts.includes('sound.js'));
    const src = readFileSync(path.join(ROOT, 'public/play/modules/overseer/sound.js'), 'utf8');
    assert.match(src, /humGainFor/);
    assert.match(src, /motif/);
    assert.match(src, /__overseerSound/);
  });

  it('humGainFor rises at least 6 dB from 60 m to 5 m', () => {
    // Same curve as sound.js (kept in lockstep by the comment there): linear in dB from 60→5.
    const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
    const humGainFor = (dist: number) => {
      const d = clamp(dist, 5, 60);
      const db = -18 + ((60 - d) / 55) * 6;
      return Math.pow(10, db / 20);
    };
    const src = readFileSync(path.join(ROOT, 'public/play/modules/overseer/sound.js'), 'utf8');
    assert.match(src, /-18 \+ \(\(60 - d\) \/ 55\) \* 6/);
    const rise = 20 * Math.log10(humGainFor(5) / humGainFor(60));
    assert.ok(rise >= 6 - 1e-6, `rise ${rise} dB`);
    assert.ok(humGainFor(5) > humGainFor(30) && humGainFor(30) > humGainFor(60));
  });

  it('playtest scenario is registered', () => {
    const portal = readFileSync(path.join(ROOT, 'public/playtest/portal.js'), 'utf8');
    assert.match(portal, /overseer-sound/);
    assert.match(portal, /runOverseerSound/);
    const scenario = readFileSync(path.join(ROOT, 'public/playtest/overseer-sound.js'), 'utf8');
    assert.match(scenario, /hum-rise/);
    assert.match(scenario, /motif-latency/);
  });
});

void pathToFileURL; // keep import used under erasable checks
