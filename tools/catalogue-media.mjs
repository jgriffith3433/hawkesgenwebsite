// Makes one game's catalogue media from a real gameplay recording (a Studio playtest video or a screen capture).
//   node tools/catalogue-media.mjs <game-id> <recording> --at <start-seconds> [--title "Name"] [--shots 12,30,48,66,80]
// Writes public/catalogue/<id>/: preview.webm + preview.mp4 (<= 18 s from --at, muted, 16:9, under 3 MB, first frame =
// cover), cover-16x9.webp, cover-1x1.webp, shot-1..N.webp. Needs ffmpeg. The title is drawn on covers only, no 'Play', no logo.
// Afterwards set `captured: true` (and `shots`) for the game in cloud/functions/src/catalogue.ts.
import { spawnSync } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
const [id, src, ...rest] = process.argv.slice(2);
if (!id || !src) { console.error('usage: catalogue-media.mjs <game-id> <recording> --at <s> [--title T] [--shots a,b,c]'); process.exit(2); }
const opt = (k, d) => { const i = rest.indexOf('--' + k); return i >= 0 ? rest[i + 1] : d; };
const at = Number(opt('at', 0)), title = opt('title', ''), shots = opt('shots', '').split(',').filter(Boolean).map(Number);
const out = new URL(`../public/catalogue/${id}/`, import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const ff = (...a) => { const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...a], { stdio: 'inherit' }); if (r.status) process.exit(r.status); };
const font = process.env.FONT || '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
const draw = title ? `,drawtext=fontfile=${font}:text='${title.replace(/[':]/g, '')}':fontsize=h/9:fontcolor=white:shadowcolor=black@0.7:shadowx=3:shadowy=3:x=h/20:y=h-h/5` : '';
const v16 = 'scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720';
const cut = ['-ss', String(at), '-t', '18', '-i', src, '-an', '-vf', `${v16},fps=24`];
// Size: two-pass is overkill; constrain by CRF with a max rate, then check the limit.
ff(...cut, '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '37', '-maxrate', '1100k', '-bufsize', '2200k', '-pix_fmt', 'yuv420p', out + 'preview.webm');
ff(...cut, '-c:v', 'libx264', '-crf', '28', '-maxrate', '1100k', '-bufsize', '2200k', '-profile:v', 'main', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out + 'preview.mp4');
ff('-ss', String(at), '-i', src, '-frames:v', '1', '-vf', v16 + draw, '-quality', '82', out + 'cover-16x9.webp');
ff('-ss', String(at), '-i', src, '-frames:v', '1', '-vf', `scale=720:720:force_original_aspect_ratio=increase,crop=720:720${draw}`, '-quality', '82', out + 'cover-1x1.webp');
shots.forEach((t, i) => ff('-ss', String(t), '-i', src, '-frames:v', '1', '-vf', 'scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720', '-quality', '80', out + `shot-${i + 1}.webp`));
for (const f of ['preview.webm', 'preview.mp4']) { const n = statSync(out + f).size; console.log(f, n, n < 3e6 ? 'ok' : 'OVER 3 MB: raise --crf'); }
