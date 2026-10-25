// Presence (public/play/modules/presence): name tags, speech bubbles, emotes, looks and spectating, in the real engine in
// Node (test/engine/harness.ts). Another player is stood in for by a peer in net.js's list with an avatar, the way
// net.js makes one; what they send arrives through the same handlers the room's messages reach. The avatar route is in
// test/presence.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, world, sceneOf } from './harness.ts';
import { AVATAR } from '../../src/presence.ts';

const H = await load();
const P = H.presence;
const C = P.core;
const I = P._internal;
const floor = { type: 'box', shape: { size: [80, 1, 80] }, transform: { position: [0, -0.5, 0] } };
const start = { type: 'spawn', transform: { position: [0, 0, -6] } };

/** Another player in the room, as net.js keeps them: an entry in its peer list and a capsule avatar. */
function peer(id: string, name: string, at: number[], info: any = {}) {
  const g = H.game;
  const a = g.capsule({ x: at[0], y: at[1], z: at[2], radius: 0.35, height: 1.8, color: '#ef4444', physics: 'kinematic', tag: 'player', name });
  a.remotePlayer = true; a.isPlayer = true; a.netId = id;
  (globalThis as any).HawkesNet.peers().set(id, { id, name, color: '#ef4444', state: { p: at, y: 0, pi: 0 }, avatar: a, seen: performance.now() });
  I.peerInfo.set(id, info);
  return a;
}
function clearPeers() { (globalThis as any).HawkesNet.peers().clear(); I.peerInfo.clear(); }
const shown = (key: string) => P.shown.find((s: any) => s.key === key);

test('core: tags are capped, nearest first, friends before strangers, smaller and fainter far away', () => {
  const c = (id: string, kind: string, distance: number) => ({ id, kind, distance, onScreen: true });
  const many = Array.from({ length: 20 }, (_, i) => c(`p${i}`, 'player', 3 + i * 2));
  const out = C.layoutTags(many, { max: 6 });
  assert.equal(out.length, 6, 'never more than max');
  assert.deepEqual(out.map((o: any) => o.id), ['p0', 'p1', 'p2', 'p3', 'p4', 'p5'], 'the nearest ones');
  assert.ok(out[0].scale > out[5].scale, 'nearer is bigger');
  const crowd = [...many.slice(0, 10), c('pal', 'friend', 60), c('npc', 'npc', 5)];
  const picked = C.layoutTags(crowd, { max: 3 }).map((o: any) => o.id);
  assert.ok(picked.includes('pal'), 'a friend far away still shows over strangers');
  assert.ok(!picked.includes('npc'), 'NPCs give way to players when there are too many');
  const far = C.layoutTags([c('a', 'player', 68)], {})[0];
  assert.ok(far && far.opacity < 0.3 && far.scale >= C.TAGS.minScale - 1e-9, 'fades near the edge of its range, never tiny');
  assert.equal(C.layoutTags([c('a', 'player', 90)], {}).length, 0, 'gone past its range');
  assert.equal(C.layoutTags([{ ...c('a', 'player', 5), onScreen: false }], {}).length, 0, 'off screen: no tag');
  assert.equal(C.layoutTags([c('n', 'npc', 35)], {}).length, 0, 'NPC tags have a shorter range');
  const big = C.layoutTags([c('a', 'player', 3)], { size: 2 })[0];
  assert.ok(Math.abs(big.scale - C.TAGS.maxScale * 2) < 1e-9, 'size scales every tag');
});

test('core: bubbles stack (three at most), wrap, time out; looks are cleaned; emotes by name; chat is limited', () => {
  const b = C.bubbles();
  for (const t of ['one', 'two', 'three', 'four']) b.say('x', t, 1000);
  assert.deepEqual(b.live('x', 1001).map((l: any) => l.text), ['two', 'three', 'four'], 'oldest drops off the stack');
  assert.equal(b.live('x', 1000 + 10_000).length, 0, 'and they go away');
  assert.ok(C.wrap('a fairly long sentence that has to break somewhere sensible', 20).every((l: string) => l.length <= 20));
  assert.equal(C.wrap('x'.repeat(50), 20).length, 3, 'long words are cut');
  assert.ok(C.bubbleSeconds('hi') >= 3 && C.bubbleSeconds('x'.repeat(140)) <= 9);
  const l = C.cleanLook({ body: 'red', hat: 'crown', extras: ['wings', 'wings', 'nope', 'cape', 'tail', 'scarf'], model: 'javascript:x', shape: 'tall' });
  assert.equal(l.body, '#4a9eff'); assert.equal(l.hat, 'crown'); assert.equal(l.shape, 'tall'); assert.equal(l.model, null);
  assert.deepEqual(l.extras, ['wings', 'cape', 'tail'], 'known extras, once each, three at most');
  assert.deepEqual(C.randomLook(42), C.randomLook(42), 'a seed gives the same look');
  assert.deepEqual(C.cleanLook(C.randomLook(7)), C.randomLook(7), 'random looks are valid looks');
  assert.equal(C.emote('thumbs up').name, 'thumbsup'); assert.equal(C.emote('LOL').name, 'laugh'); assert.equal(C.emote('moonwalk'), null);
  assert.equal(C.EMOTES.length, 10);
  const lim = C.limiter();
  assert.ok(lim.ok(0)); assert.ok(!lim.ok(100), 'not twice in a blink');
  let n = 1; for (let t = 1000; t < 9000; t += 1000) if (lim.ok(t)) n++;
  assert.equal(n, C.CHAT.burst, 'a few lines per ten seconds');
  assert.equal(C.cleanLine('  hi\n\tthere  '), 'hi there');
});

test('name tags over other players, AI friends, pets and named NPCs; never over things without names', () => {
  clearPeers();
  world(H, sceneOf({
    floor, start,
    max: { type: 'friend', name: 'Max', shape: { species: 'person', follow: false }, transform: { position: [-2, 0.5, 4] } },
    rex: { type: 'creature', name: 'Rex', shape: { species: 'dog', follow: 'player' }, transform: { position: [2, 0.5, 2] } },
    bob: { type: 'box', name: 'Bob', tag: 'npc', transform: { position: [4, 0.5, 6] } },
    crate: { type: 'box', name: 'Crate', transform: { position: [-4, 0.5, 6] } },
    cow: { type: 'creature', shape: { species: 'cow' }, transform: { position: [0, 0.5, 12] } },
  }));
  H.game.player.controls = false;
  peer('c2', 'Sam', [1, 1, 8], { look: { hat: 'crown', body: '#22c55e' } });
  H.tick(0.5);
  assert.equal(shown('p:c2')?.kind, 'player', `Sam has a tag (${JSON.stringify(P.shown.map((s: any) => s.name))})`);
  assert.equal(shown('p:c2').name, 'Sam');
  const kinds = Object.fromEntries(P.shown.map((s: any) => [s.name, s.kind]));
  assert.equal(kinds.Max, 'ai'); assert.equal(kinds.Rex, 'pet'); assert.equal(kinds.Bob, 'npc');
  assert.equal(kinds.Crate, undefined, 'a named box is not a person'); assert.ok(!P.shown.some((s: any) => s.kind === 'me'), 'no tag over yourself in first person');
  const max = H.game.entity('max');
  assert.equal(max.living.friend.tag.isEnabled(), false, "the friend's own little tag gives way to presence's");
  // Sam's look: a block avatar with a crown, the capsule only a collider.
  const rig = [...I.rigs.entries()].find(([e]: any) => e.netId === 'c2');
  assert.ok(rig, 'Sam wears a look');
  assert.ok(rig[1].meshes.some((m: any) => m.name === 'pr-crown'), 'with the crown they chose');
  assert.equal(rig[0].node.visibility, 0, 'the capsule hides under it');
});

test('typing, host and health show on the tag; friends are marked; the list puts friends first', () => {
  clearPeers();
  world(H, sceneOf({ floor, start }));
  H.game.player.controls = false;
  peer('c2', 'Sam', [1, 1, 6], { ty: 1, host: 1, hp: 40, mx: 100, b: 'badge-sam' });
  peer('c3', 'Ana', [-1, 1, 7], { b: 'badge-ana' });
  I.verified.set('badge-sam', { user: 'usr_aa', name: 'Sam', friend: false });
  I.verified.set('badge-ana', { user: 'usr_bb', name: 'Ana', friend: true });
  H.tick(0.5);
  const sam = shown('p:c2');
  assert.ok(sam.typing && sam.host, 'typing dots and the crown');
  assert.equal(sam.hp, 40, 'a health bar when hurt');
  assert.equal(shown('p:c3').kind, 'friend', 'Ana is my friend on the platform');
  const list = P.players();
  assert.deepEqual(list.map((x: any) => x.name), [list[0].name, 'Ana', 'Sam'], 'me, then friends, then everyone else');
  assert.ok(list[0].me);
  P.mute('c2');
  assert.ok(P.muted('c2'));
  I.onSay({ w: 'c2', t: 'buy my stuff' }, { id: 'c2' });
  H.tick(0.1);
  assert.deepEqual(shown('p:c2').bubbles, [], 'muted: no bubble');
  P.mute('c2', false);
});

test('chat: a line from a player is a bubble over them (stacked), in the log, and a game event scripts hear', () => {
  clearPeers();
  world(H, sceneOf({ floor, start }), { scripts: { 'main.js': "game.on('chat', (m) => { game.state.heard = (game.state.heard || []).concat(m.name + ': ' + m.text); });" } });
  H.game.player.controls = false;
  peer('c2', 'Sam', [0, 1, 5]);
  const said: any[] = [];
  const off = P.on('say', (m: any) => said.push(m));
  I.onSay({ w: 'c2', t: 'hello there' }, { id: 'c2' });
  I.onSay({ w: 'c2', t: 'over here!' }, { id: 'c2' });
  H.tick(0.1);
  assert.deepEqual(shown('p:c2').bubbles, ['hello there', 'over here!']);
  assert.deepEqual(said.map((m) => m.text), ['hello there', 'over here!']);
  assert.deepEqual(H.world.state.heard, ['Sam: hello there', 'Sam: over here!']);
  // Someone else can't put words over Sam's head (only Sam, or the host relaying).
  I.peerInfo.set('c9', { host: 1 }); (globalThis as any).HawkesNet.peers().set('c9', { id: 'c9', name: 'Host', color: '#fff', state: null, avatar: null });
  I.onSay({ w: 'c2', t: 'I am a fake' }, { id: 'c5' });
  I.onSay({ w: 'c2', t: 'relayed' }, { id: 'c9' });
  H.tick(0.1);
  assert.deepEqual(shown('p:c2').bubbles.slice(-1), ['relayed'], 'a spoofed line is dropped, a relayed one shows');
  // My own lines: sent to the room (here: offline, straight back), never too fast.
  assert.equal(P.say('hi all'), true);
  assert.equal(P.say('again'), false, 'too soon');
  assert.equal(said.at(-1).me, true);
  off();
});

test('what NPCs and AI friends say (e.say, living.act) shows as bubbles over them', () => {
  clearPeers();
  world(H, sceneOf({ floor, start, max: { type: 'friend', name: 'Max', shape: { species: 'person', follow: false }, transform: { position: [0, 0.5, 3] } }, sign: { type: 'box', name: 'Sign', transform: { position: [2, 0.5, 4] } } }));
  H.game.player.controls = false;
  H.tick(0.2);
  const max = H.game.entity('max');
  H.living.act(max, 'dance', 'Watch this!');
  H.game.entity('sign').say('Shop open');
  H.tick(0.1);
  const m = P.shown.find((s: any) => s.name === 'Max');
  assert.ok(m && m.bubbles.includes('Watch this!'), `Max's line over Max (${JSON.stringify(P.shown)})`);
  assert.ok(P.shown.some((s: any) => s.bubbles.includes('Shop open') && !s.tag), 'a thing that talks gets a bubble, not a tag');
  H.tick(10);
  assert.ok(!P.shown.some((s: any) => s.bubbles.length), 'and they time out');
});

test('emotes: mine and others\' play on the block avatar, with the emoji on the tag; "everyone" makes a dance party', () => {
  clearPeers();
  world(H, sceneOf({ floor, start, rex: { type: 'creature', name: 'Rex', shape: { species: 'dog', follow: false }, transform: { position: [2, 0.5, 3] } } }));
  const p = H.game.player;
  p.controls = false;
  const a = peer('c2', 'Sam', [0, 1, 5]);
  H.tick(0.2);
  P.emote('wave');
  H.tick(0.3);
  const mine = I.rigs.get(p);
  assert.equal(mine.emote.def.name, 'wave', 'my avatar waves');
  assert.ok(mine.shR.rotation.z < -2, `the right arm is up (${mine.shR.rotation.z})`);
  // Sam's emote arrives (as the room's action would bring it).
  I.onEmote({ w: 'c2', e: 'cheer' }, { id: 'c2' });
  H.tick(0.3);
  const sams = I.rigs.get(a);
  assert.equal(sams.emote.def.name, 'cheer');
  assert.equal(shown('p:c2').react, '🙌', 'the emoji pops on the tag');
  H.tick(3);
  assert.equal(sams.emote, null, 'and it ends');
  // Sitting lasts until you move.
  P.emote('sit');
  H.tick(2);
  assert.equal(mine.emote && mine.emote.def.name, 'sit');
  p.position = [p.x + 4, p.y, p.z]; H.tick(0.1); p.position = [p.x + 4, p.y, p.z]; H.tick(0.7);
  assert.equal(mine.emote, null, 'moving stands you up');
  P.emote('dance', 'all');
  H.tick(0.2);
  assert.equal(I.rigs.get(p).emote.def.name, 'dance'); assert.equal(I.rigs.get(a).emote.def.name, 'dance');
  assert.equal(I.reactions.get(I.people(true).find((x: any) => x.name === 'Rex').key).icon, '💃', 'the dog joins in');
  assert.throws(() => P.emote('moonwalk'), /No emote/);
});

test('looks: mine changes at once and is sent to the room; config can turn parts off or change the tags', () => {
  clearPeers();
  world(H, sceneOf({ floor, start, bob: { type: 'box', name: 'Bob', tag: 'npc', transform: { position: [0, 0.5, 2] } } }, { presence: { colors: { npc: '#22c55e' }, size: 2 } }));
  const p = H.game.player;
  p.controls = false;
  H.tick(0.2);
  P.setLook({ hat: 'tophat', shape: 'big', extras: ['cape'] });
  H.tick(0.1);
  const rig = I.rigs.get(p);
  assert.ok(rig.meshes.some((m: any) => m.name === 'pr-top') && rig.meshes.some((m: any) => m.name === 'pr-cape'), 'the top hat and cape are on');
  assert.ok(rig.root.scaling.y > 1.1, 'and the body is big');
  assert.equal(rig.root.isEnabled(), false, 'not drawn in first person');
  p.view = 'third'; H.tick(0.1);
  assert.equal(I.rigs.get(p).root.isEnabled(), true, 'seen in third person');
  assert.equal(I.mine().look.hat, 'tophat', 'what the room gets');
  const bob = P.shown.find((s: any) => s.name === 'Bob');
  assert.ok(bob.scale > 1.2, `names in big letters (${bob.scale})`);
  const el = [...(globalThis as any).document.body.children].find((x: any) => x.id === 'pr-layer');
  assert.ok(el, 'tags are drawn in the page over the game');
  // Turned off: no tags, no looks.
  world(H, sceneOf({ floor, start, bob: { type: 'box', name: 'Bob', tag: 'npc', transform: { position: [0, 0.5, 2] } } }, { presence: false }));
  H.tick(0.3);
  assert.equal(P.shown.length, 0);
  assert.equal(I.rigs.size, 0);
});

test('spectate: watch another player over their shoulder, cycle, and stop (your controls come back)', () => {
  clearPeers();
  world(H, sceneOf({ floor, start }));
  const p = H.game.player;
  H.tick(0.2);
  peer('c2', 'Sam', [5, 1, 5]);
  peer('c3', 'Ana', [-5, 1, 5]);
  H.tick(0.3);
  const k = P.spectate('c2');
  assert.equal(k, 'p:c2');
  H.tick(0.2);
  const cam = H.world.scene.activeCamera.position;
  assert.ok(Math.hypot(cam.x - 5, cam.z - (5 - 3.2)) < 0.6, `the camera is behind Sam (${cam.x.toFixed(2)}, ${cam.z.toFixed(2)})`);
  assert.equal(p.controls, false, 'you stand still while watching');
  assert.equal(P.spectate('next'), 'p:c3');
  P.spectate(null);
  H.tick(0.1);
  assert.equal(P.spectating(), null);
  assert.equal(p.controls, true);
  clearPeers();
  assert.equal(P.spectate('next'), null, 'nobody to watch');
});

test('the mirror look: eyes, one of 12 accessories in its color, kept by the server\'s lists, on every body, seen on tags', () => {
  assert.deepEqual(C.LOOK.accessories, AVATAR.accessories, 'client and server agree on the accessories');
  assert.equal(C.ACCESSORIES.length, 13, 'none and twelve');
  assert.deepEqual(C.ACCESSORIES.map((a: any) => a.id), C.LOOK.accessories, 'every one has its icon and anchor');
  assert.ok(C.ACCESSORIES.every((a: any) => a.id === 'none' || ['head', 'face', 'neck', 'back'].includes(a.anchor)));
  const old = C.cleanLook({ body: '#22c55e' });
  assert.deepEqual([old.eyeColor, old.accessory, old.accessoryColor], ['#14161d', 'none', '#ffffff'], 'an older look has dark eyes and nothing on');
  const l = C.cleanLook({ eyeColor: '#2F6FDB', accessory: 'jetpack', accessoryColor: 'red' });
  assert.deepEqual([l.eyeColor, l.accessory, l.accessoryColor], ['#2f6fdb', 'jetpack', '#ffffff'], 'colors are #hex only');
  assert.equal(C.cleanLook({ accessory: 'jetski' }).accessory, 'none');
  assert.ok(JSON.stringify(C.cleanLook(C.randomLook(3))).length < C.LOOK.maxBytes / 2, 'room to spare under the byte limit');
  const seen = new Set<string>(); for (let i = 0; i < 80; i++) seen.add(C.randomLook(i).accessory);
  assert.ok(seen.size >= 10, `surprises wear different accessories (${seen.size})`);

  world(H, sceneOf({ floor, start }), { mode: 'play' });
  H.tick(0.3);
  const p = H.world.player;
  p.view = 'third';
  for (const w of C.WHATS) {
    let none = 0;
    for (const a of C.ACCESSORIES) {
      P.setLook({ what: w.id, accessory: a.id, accessoryColor: '#ec4899', eyeColor: '#22a06b' });
      H.tick(0.05);
      const rig = I.rigs.get(p);
      const n = rig.meshes.length;
      if (a.id === 'none') { none = n; continue; }
      assert.ok(n > none, `${w.id} wears ${a.id} (${n} vs ${none} meshes)`);
      const mats = rig.meshes.filter((m: any) => m.material).map((m: any) => m.material.name);
      assert.ok(a.id === 'medal' || a.id === 'jetpack' || mats.some((x: string) => x.includes('#ec4899') || x.includes('ec4899')), `${w.id} ${a.id}: in the color picked`);
    }
  }
  // It travels with the look: what the room gets, and what another player's tag shows.
  P.setLook({ what: 'person', accessory: 'headphones', accessoryColor: '#ef4444', eyeColor: '#2f6fdb' });
  assert.deepEqual([I.mine().look.accessory, I.mine().look.accessoryColor, I.mine().look.eyeColor], ['headphones', '#ef4444', '#2f6fdb']);
  world(H, sceneOf({ floor, start }), { mode: 'play' });
  H.tick(0.2);
  const them = peer('c2', 'Zed', [0, 0.9, 4], { look: { ...C.cleanLook({}), name: 'Zed', body: '#a855f7', accessory: 'flower', accessoryColor: '#ec4899', eyeColor: '#e11d48' } });
  H.tick(0.3);
  const rig = I.rigs.get(them);
  assert.ok(rig && rig.look.accessory === 'flower' && rig.look.eyeColor === '#e11d48', 'their rig wears what they sent');
  const tag = shown('p:c2');
  assert.ok(tag, 'their tag shows');
  const el = [...(globalThis as any).document.body.children].find((x: any) => x.id === 'pr-layer');
  assert.ok(el && JSON.stringify(P.shown).includes('Zed'), 'named');
  clearPeers();
});
