// HUD layout (modules/hudlayout): the rule for how much of the right side a panel takes, the four named zones, and the phone compact fold.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { load } from './harness.ts';

const H = await load();

test('named HUD zones cover quest banner (.hc-card, #dl-stack), top-right actions (.gs-acts, .jr-btn), side panel (.mr) and bottom chat (.hc-chat)', () => {
  const z = H.hudLayout.zones;
  assert.ok(z.quest.includes('#dl-stack') && z.quest.includes('.tour-track') && z.quest.includes('.hc-card'), 'quest zone includes #dl-stack, tracker and .hc-card prompt banner');
  assert.ok(z.actions.includes('.gs-acts') && z.actions.includes('.jr-btn'), 'actions zone includes .gs-acts and .jr-btn (fourth top-right action)');
  assert.ok(z.panel.includes('.mr') && z.panel.includes('[data-hud-panel]'), 'panel zone includes .mr and [data-hud-panel]');
  assert.ok(z.chat.includes('.hc-chat'), 'chat zone includes .hc-chat');
});

test('a side panel reserves its width and a gap at 1280x720 and 1440x900; closed or a bottom sheet reserves nothing', () => {
  const c = H.hudLayout.compute;
  assert.equal(c(1280, 864, 400), 1280 - 864 + 12);
  assert.equal(c(1440, 1024, 400), 1440 - 1024 + 12);
  assert.equal(c(1280, 864, 0), 0, 'no panel');
  assert.equal(c(390, 10, 370), 0, 'a phone: the panel is a bottom sheet');
  assert.equal(c(700, 300, 380), 0, 'under 760 wide: bottom sheet, no right reserve');
  assert.equal(c(1280, 200, 400), 0, 'not at the right side');
  assert.equal(H.hudLayout.reserved(), 0);
});

test('hudlayout CSS docks .jr-btn beside .gs-acts, shifts .hc-chat left of the panel, transitions smoothly, and uses no timers', () => {
  const src = fs.readFileSync(new URL('../../public/play/modules/hudlayout/hudlayout.js', import.meta.url), 'utf8');
  assert.ok(src.includes('body:not(.tl):not(.hl-compact) .jr-btn'), '.jr-btn sits in the top-right action row on desktop');
  assert.ok(src.includes('body:not(.tl):not(.hl-compact):has(.jr-btn:not([hidden])) .gs-acts{right:calc(var(--hl-panel) + 62px)'), '.gs-acts leaves room for .jr-btn; right always tracks --hl-panel (glides when it changes)');
  assert.ok(src.includes("syntax:'<length>'") || src.includes('syntax:"<length>"'), '--hl-panel is a registered length so it can interpolate');
  assert.ok(!/right:[^;]*max\(\s*12px\s*,\s*var\(--hl-panel\)/.test(src), 'max(12px, var(--hl-panel)) in right blocks interpolation');
  assert.ok(src.includes('left:calc(50vw - var(--hl-panel) / 2)'), '.hc-chat centres in the free band via --hl-panel (no class-gated snap)');
  assert.ok(src.includes('transition:left .3s ease,width .3s ease,max-width .3s ease'), '.hc-chat transitions smoothly on open/close');
  assert.ok(src.includes('transition:right .3s ease,max-width .3s ease'), '.gs-acts transitions right when the panel closes');
  assert.ok(!/\bsetInterval\b|\bsetTimeout\b/.test(src), 'no timers or polling in hudlayout.js');
});

test('phone compact folds under 760 wide or under 500 tall; sheet is bottom or side', () => {
  const { compact, sheet } = H.hudLayout;
  assert.equal(compact(390, 844), true, 'portrait phone');
  assert.equal(compact(844, 390), true, 'short landscape');
  assert.equal(compact(1280, 720), false, 'desktop');
  assert.equal(compact(760, 500), false, 'exactly at the cuts');
  assert.equal(compact(759, 900), true);
  assert.equal(compact(900, 499), true);
  assert.equal(sheet(390, 844), 'bottom');
  assert.equal(sheet(844, 390), 'side');
  assert.equal(sheet(1280, 720), null);
  // Short landscape still reserves on the right when the panel is a side sheet (width >= 760).
  assert.equal(H.hudLayout.compute(844, 844 - 10 - 280, 280), 844 - (844 - 10 - 280) + 12);
});

test('phone compact CSS hides Journal beside the menu and clears the stick under the sheet', () => {
  const src = fs.readFileSync(new URL('../../public/play/modules/hudlayout/hudlayout.js', import.meta.url), 'utf8');
  assert.ok(src.includes('body.hl-compact .jr-btn{display:none!important}'), 'Journal is folded away on compact (Controls has it)');
  assert.ok(src.includes('max-width:min(260px,calc(100vw - 120px))'), 'short-landscape sheet leaves the left quest band free');
  assert.ok(src.includes('overflow:hidden!important'), 'phone sheets clip instead of spilling past the edge');
});
