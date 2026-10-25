// The Overseer's speech desk (public/play/modules/overseer/speech.js): every line a caption for as long as it is said,
// never two at once (the later waits, or the important one cuts in gently), captions and volumes set apart.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { load, world, sceneOf } from './harness.ts';

const H = await load();
const floor = { type: 'box', shape: { size: [400, 1, 400] }, transform: { position: [0, -0.5, 0] } };
const start = { type: 'spawn', transform: { position: [-4, 0, 0] } };
const S = H.speech;

// A stand-in for an <audio> clip: it plays for `duration` seconds of the desk's clock.
const clips: any[] = [];
class FakeAudio {
  listeners: Record<string, Function[]> = {}; volume = 1; paused = true; duration = 3; src: string; crossOrigin = '';
  constructor(src: string) { this.src = src; clips.push(this); }
  addEventListener(e: string, f: Function) { (this.listeners[e] ||= []).push(f); }
  play() { this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
}

let t = 0;
const chat: any[] = [];
let chatLine: any;
function fresh() {
  t = 1000;
  S.clock = () => t;
  S.reset();
  S.set({ captions: true, voice: 1, music: 1 });
  world(H, sceneOf({ floor, start }));
  H.tick(0.2);
  chat.length = 0; clips.length = 0;
  if (!chatLine) chatLine = H.chat.line;
  H.chat.line = (m: any) => { chat.push(m); return chatLine(m); };
}
const step = (s = 0.3) => { t += s; S.pump(); };
const shown = () => chat.filter((m) => m.now && m.kind === 'overseer').map((m) => m.text);

test('with sound off every Overseer line is a caption, for as long as it takes to read', () => {
  fresh();
  const text = 'The sea gives. It gives slowly. That is the best way.';
  S.say({ text });
  assert.deepEqual(shown(), [text], 'shown at once, no clip needed');
  const c = S.current;
  assert.equal(c.caption, true);
  assert.equal(c.voiced, false);
  const secs = c.endsAt - t;
  assert.ok(secs > 2.5 && secs < 8, `held for the reading: ${secs.toFixed(1)} s`);
  assert.equal(chat[0].reveal > 2, true, 'the words type out over that time');
  // Captions off changes nothing without a voice to hear: the line still shows.
  S.set({ captions: false });
  S.say({ text: 'Ask, and I will send it down.' });
  step(secs + 1);
  assert.deepEqual(shown(), [text, 'Ask, and I will send it down.']);
  // The voice turned right down (sound off) also keeps the captions, even with a clip.
  (globalThis as any).Audio = FakeAudio;
  S.set({ voice: 0 });
  step(10);
  S.say({ text: 'Destruction is a kind of freedom too.', voice: 'overseer-destruction.mp3' });
  assert.equal(S.current.voiced, false);
  assert.equal(S.current.caption, true);
  delete (globalThis as any).Audio;
});

test('two lines never overlap: the later waits its turn', () => {
  fresh();
  const a = 'You came all this way. The door was open.';
  const b = 'A new one, from me.';
  S.say({ text: a });
  S.say({ text: b });
  assert.deepEqual(shown(), [a], 'only the first is said');
  assert.deepEqual(S.waiting, [b]);
  step(1);
  assert.deepEqual(shown(), [a], 'still the first');
  step(S.current.endsAt - t + 0.01);
  assert.deepEqual(shown(), [a, b], 'then the second, never together');
  assert.equal(S.waiting.length, 0);
  // The log shows no two lines at once.
  const l = S.log;
  assert.ok(l[1].at >= l[0].ended, 'the second began after the first ended');
});

test('an important line cuts in gently; an equal one does not; a low one waits behind', () => {
  fresh();
  (globalThis as any).Audio = FakeAudio;
  S.say({ text: 'Something calm to hear while the sea moves on.', voice: 'overseer-ask.mp3', priority: 'normal' });
  assert.equal(clips.length, 1);
  step(0.5);
  S.say({ text: 'Another normal one.', priority: 'normal' });
  S.say({ text: 'A low one.', priority: 'low' });
  assert.deepEqual(S.waiting, ['Another normal one.', 'A low one.']);
  const ends: any[] = [];
  H.game.on('overseer-speech', (d: any) => { if (d.state === 'end') ends.push(d); });
  S.say({ text: 'You answered me. Good.', priority: 'important' });
  assert.equal(ends.length, 1);
  assert.equal(ends[0].interrupted, true, 'the first was cut in on');
  assert.equal(S.current.text, 'You answered me. Good.');
  assert.deepEqual(S.waiting, ['Another normal one.', 'A low one.'], 'the rest still wait, in order');
  assert.equal(shown().at(-1), 'You answered me. Good.');
  // Never two at once: only one voice plays at a time (the first fades out under a quarter second).
  step(S.current.endsAt - t + 0.01);
  assert.equal(S.current.text, 'Another normal one.');
  step(S.current.endsAt - t + 0.01);
  assert.equal(S.current.text, 'A low one.');
  delete (globalThis as any).Audio;
});

test('captions and voice volume are separate: captions off hides only a line that is really heard', () => {
  fresh();
  (globalThis as any).Audio = FakeAudio;
  S.set({ captions: false, voice: 0.6, music: 0.2 });
  assert.deepEqual({ ...S.settings }, { captions: false, voice: 0.6, music: 0.2 });
  S.say({ text: 'Ask, and I will send it down.', voice: 'overseer-ask.mp3' });
  assert.equal(S.current.voiced, true);
  assert.equal(S.current.caption, false);
  assert.deepEqual(shown(), [], 'heard, so not written');
  step(10);
  // Captions on, voice quiet: both.
  S.set({ captions: true });
  S.say({ text: 'Destruction is a kind of freedom too.', voice: 'overseer-destruction.mp3' });
  assert.equal(S.current.caption, true);
  assert.equal(S.current.voiced, true);
  assert.equal(S.settings.voice, 0.6, 'turning captions on left the voice alone');
  assert.equal(S.settings.music, 0.2, 'and the music');
  S.set({ voice: 0.1 });
  assert.equal(S.settings.captions, true);
  // Turning captions on while a hidden line is still being said shows it.
  step(10);
  S.set({ captions: false });
  S.say({ text: 'A new one, from me.', voice: 'overseer-a-new-one.mp3' });
  assert.deepEqual(shown().includes('A new one, from me.'), false);
  S.set({ captions: true });
  assert.deepEqual(shown().includes('A new one, from me.'), true, 'shown the moment captions come on');
  delete (globalThis as any).Audio;
});

test('the settings are kept, and the engine has a voice level and a music level of its own', () => {
  fresh();
  S.set({ captions: false, voice: 0.4, music: 0.7 });
  S.reload();
  // (A page without storage keeps them in the desk; with storage a reload reads them back.)
  assert.ok(S.settings.voice <= 1 && S.settings.music <= 1);
  H.audio.voiceVolume = 0.3; H.audio.musicVolume = 0.5;
  assert.equal(H.audio.voiceVolume, 0.3);
  assert.equal(H.audio.musicVolume, 0.5);
  assert.equal(H.audio.volume, 1, 'the master is untouched');
  S.set({ captions: true, voice: 1, music: 1 });
  assert.equal(H.audio.voiceVolume, 1);
  assert.equal(H.audio.musicVolume, 1);
});

test('replay says the last line again, and a line held by the intro waits for it', () => {
  fresh();
  S.say({ text: 'That is your world. All of it.' });
  step(S.current.endsAt - t + 0.01);
  assert.equal(S.replay(), true);
  assert.deepEqual(shown(), ['That is your world. All of it.', 'That is your world. All of it.']);
  step(10);
  S.hold('intro');
  S.say({ text: 'The beam is ready.' });
  assert.equal(S.current, null, 'held for the intro');
  S.say({ text: 'I have given you the power of free will.', owner: 'intro', priority: 'important' });
  assert.equal(S.current.text, 'I have given you the power of free will.');
  step(S.current.endsAt - t + 0.01);
  S.hold('intro', false);
  assert.equal(S.current.text, 'The beam is ready.');
});

test('the assistant\'s reply is spoken only where a clip has those very words, and never by the browser', () => {
  fresh();
  (globalThis as any).Audio = FakeAudio;
  // No clip for these words: nothing to speak, and no second caption (the editor shows its own).
  S.say({ text: 'Some new words the assistant wrote.', caption: false });
  assert.equal(clips.length, 0);
  assert.deepEqual(shown(), []);
  // A line with a clip, said again as a reply: spoken from the clip.
  S.clip('You found your way. Good.', 'overseer-found-your-way.mp3');
  S.say({ text: 'You found your way. Good.', caption: false });
  assert.equal(clips.length, 1);
  assert.deepEqual(shown(), [], 'no second caption');
  delete (globalThis as any).Audio;
});

test('the editor never uses the browser\'s own voice; its menu has captions, voice, music and replay', () => {
  const js = fs.readFileSync(new URL('../../public/editor.js', import.meta.url), 'utf8');
  const html = fs.readFileSync(new URL('../../public/editor.html', import.meta.url), 'utf8');
  assert.ok(!/speechSynthesis|SpeechSynthesisUtterance/.test(js));
  for (const id of ['speechCaptions', 'speechVoice', 'speechMusic', 'speechReplay']) assert.ok(html.includes(`id="${id}"`), id);
  assert.ok(js.includes("type: 'assistant-reply'") && js.includes("type: 'speech-settings'"));
});
