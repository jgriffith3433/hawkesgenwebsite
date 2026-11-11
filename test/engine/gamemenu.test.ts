// Game menu (modules/gamemenu): settings persist, effects bus, Esc copy, hudlayout menu zone.
// File-level checks (no Babylon harness: engine tests need installed deps).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../../public/play/modules/gamemenu/gamemenu.js', import.meta.url), 'utf8');
const guest = fs.readFileSync(new URL('../../public/play/guest.js', import.meta.url), 'utf8');
const runtime = fs.readFileSync(new URL('../../public/play/runtime.js', import.meta.url), 'utf8');
const scale = fs.readFileSync(new URL('../../public/play/scale.js', import.meta.url), 'utf8');
const hud = fs.readFileSync(new URL('../../public/play/modules/hudlayout/hudlayout.js', import.meta.url), 'utf8');
const controls = fs.readFileSync(new URL('../../public/play/modules/controls/controls.js', import.meta.url), 'utf8');
const juice = fs.readFileSync(new URL('../../public/play/modules/juice/juice-audio.js', import.meta.url), 'utf8');
const chat = fs.readFileSync(new URL('../../public/play/modules/overseer/chat.js', import.meta.url), 'utf8');

test('game menu module registers H.gameMenu with the seven items and settings keys', () => {
  assert.ok(src.includes('H.gameMenu = api'));
  for (const label of ['Resume', 'Settings', 'Journal', 'Controls', 'Invite a friend', 'Change my look', 'Leave to Hawkes Games']) {
    assert.ok(src.includes(label), label);
  }
  for (const k of ['master', 'music', 'effects', 'voice', 'captions', 'captionSize', 'graphics', 'sensitivity', 'invertY', 'view']) {
    assert.ok(src.includes(`data-s="${k}"`) || src.includes(`'${k}'`) || src.includes(`"${k}"`), k);
  }
  assert.ok(src.includes("e.key === 'Escape'"), 'Esc toggles');
  assert.ok(src.includes('prefers-reduced-motion'));
  assert.ok(src.includes('ui(\'panel\')') || src.includes("ui(\"panel\")") || src.includes("sfx('panel')"));
  assert.ok(src.includes('shouldPause') || src.includes('isGuest() && alone()'));
});

test('runtime exposes effectsVolume; juice and site sounds route through effects', () => {
  assert.ok(runtime.includes('effectsVolume'));
  assert.ok(runtime.includes('effectsGain'));
  assert.ok(runtime.includes('audioApi.effects'));
  assert.ok(runtime.includes('lookFeel'));
  assert.ok(juice.includes('H.audio.effects') || juice.includes('bus()'));
});

test('scale maps graphics Auto/Low/Medium/High via H.setQuality; Low is cheaper than phone Auto', () => {
  assert.ok(scale.includes('H.setQuality'));
  assert.ok(scale.includes("q === 'low'"));
  assert.ok(scale.includes("q === 'medium'"));
  assert.ok(scale.includes("q === 'high'"));
  assert.ok(scale.includes('lowCut'), 'Low further cuts phone-tier budgets');
});

test('mayhem boom synth routes through the effects bus', () => {
  const feel = fs.readFileSync(new URL('../../public/play/modules/mayhem/mayhem-feel.js', import.meta.url), 'utf8');
  const mayhem = fs.readFileSync(new URL('../../public/play/modules/mayhem/mayhem.js', import.meta.url), 'utf8');
  assert.ok(feel.includes('H.audio.effects || H.audio.master'));
  assert.ok(mayhem.includes('H.audio.effects || H.audio.master'));
});

test('guest.js no longer uses Esc twice; wires HawkesGuest for the menu', () => {
  assert.ok(!/now - escAt > 700/.test(guest), 'Esc-twice timer removed from guest.js');
  assert.ok(guest.includes('HawkesGuest.invite') && guest.includes('HawkesGuest.look'));
  assert.ok(guest.includes('H.gameMenu'));
});

test('hudlayout names a menu zone; phone menu button is 48 px', () => {
  assert.ok(hud.includes("menu: '[data-game-menu]'") || hud.includes('menu: "[data-game-menu]"'));
  assert.ok(hud.includes('--hl-menu:48px'));
});

test('controls list says Esc opens the game menu; chat gear opens Settings', () => {
  assert.ok(controls.includes("keys: 'Esc'") && controls.includes('open the game menu'));
  assert.ok(!controls.includes("keys: 'Esc Esc'"));
  assert.ok(chat.includes("H.gameMenu.open('settings')") || chat.includes('H.gameMenu.open("settings")'));
});
