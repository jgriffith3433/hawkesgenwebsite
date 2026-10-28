"""Hawkes Gen short #1: 1080x1920, 30 fps, Pierce Hawkes narrating. Frames are drawn with Pillow and piped to ffmpeg.
   python render.py  ->  hawkesgen-short-01.mp4
"""
import glob, math, subprocess
from PIL import Image, ImageDraw, ImageFont, ImageSequence

W, H, FPS = 1080, 1920, 30
EX = 'C:/Projects/hawkesgenwebsite/public/examples/'
PAPER, PAPER2, PAPER3, INK, INK2, INK3, RULE, ACCENT = (244, 242, 237), (235, 232, 225), (226, 222, 213), (26, 25, 21), (75, 72, 64), (139, 134, 123), (214, 209, 198), (200, 66, 29)
F = 'C:/Windows/Fonts/'
serif = lambda s: ImageFont.truetype(F + 'georgia.ttf', s)
serifi = lambda s: ImageFont.truetype(F + 'georgiai.ttf', s)
sans = lambda s: ImageFont.truetype(F + 'segoeui.ttf', s)
sansb = lambda s: ImageFont.truetype(F + 'segoeuib.ttf', s)
mono = lambda s: ImageFont.truetype(F + 'consola.ttf', s)

def img(name):
    return Image.open(EX + name).convert('RGBA')

knight, sheet, pixel = img('knight.webp'), img('walk-sheet.webp'), img('pixel.png')
variants = [img(f'var{i}.webp') for i in (1, 2, 3)]
tex = [img('tex-albedo.webp'), img('tex-normal.webp'), img('tex-roughness.webp')]
walk = [(f.convert('RGBA'), f.info.get('duration', 100)) for f in ImageSequence.Iterator(Image.open(EX + 'walk.gif'))]
walk_total = sum(d for _, d in walk)

def walk_frame(t):
    ms = (t * 1000) % walk_total
    for f, d in walk:
        if ms < d:
            return f
        ms -= d
    return walk[0][0]

# Scenes: (voice line, caption, pad seconds after the line)
vo = [glob.glob(f'vo/{i:02d}/*.mp3')[0] for i in range(1, 9)]
def dur(p):
    return float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p]))
lines = ['This is Hawkes Gen. Game assets, made to order.', 'Give it a character.', 'Get a walk cycle. Sliced. Looping. Ready for Unity.',
         'Need variants? Fire. Ice. Poison. Same knight.', 'Pixel art, in seconds.', 'Materials that tile, with every map.',
         'Ask for it from Unity, Claude Code, Cursor or VS Code.', 'hawkesgen.ai. Your first 50 credits are on me.']
lead = 0.35
scenes, t0 = [], 0.0
for i, p in enumerate(vo):
    d = dur(p) + lead + (0.45 if i < 7 else 1.6)
    if i == 1: d += 0.6  # let the knight land
    scenes.append((t0, d, p, lines[i]))
    t0 += d
TOTAL = t0

ease = lambda x: 1 - (1 - max(0, min(1, x))) ** 3
def checker(w, h, s=28):
    c = Image.new('RGBA', (w, h), PAPER)
    d = ImageDraw.Draw(c)
    for y in range(0, h, s):
        for x in range(0, w, s):
            if (x // s + y // s) % 2: d.rectangle([x, y, x + s - 1, y + s - 1], fill=PAPER3)
    return c

def fit(im, w, h, nearest=False):
    r = min(w / im.width, h / im.height)
    return im.resize((max(1, int(im.width * r)), max(1, int(im.height * r))), Image.NEAREST if nearest else Image.LANCZOS)

def card(frame, im, box, k=1.0, check=True, nearest=False, label=None):
    """Draws an image on a framed card that rises and fades in with k (0..1)."""
    x, y, w, h = box
    y += int((1 - ease(k)) * 60)
    a = ease(k)
    if a <= 0: return
    c = checker(w, h) if check else Image.new('RGBA', (w, h), PAPER2)
    pic = fit(im, w - 40, h - 40, nearest)
    c.alpha_composite(pic, ((w - pic.width) // 2, (h - pic.height) // 2))
    ImageDraw.Draw(c).rectangle([0, 0, w - 1, h - 1], outline=RULE, width=3)
    if a < 1:
        c.putalpha(c.getchannel('A').point(lambda v: int(v * a)))
    frame.alpha_composite(c, (x, y))
    if label and a > .5:
        d = ImageDraw.Draw(frame)
        tw = d.textlength(label, font=mono(30))
        d.text((x + (w - tw) / 2, y + h + 16), label.upper(), font=mono(30), fill=INK3)

def chip(d, x, y, text, k=1.0):
    if k <= 0: return 0
    f = mono(34)
    tw = d.textlength(text, font=f)
    d.rounded_rectangle([x, y, x + tw + 36, y + 62], 6, outline=(185, 179, 166), width=2, fill=PAPER)
    d.text((x + 18, y + 12), text, font=f, fill=INK2)
    return tw + 36

def centered(d, y, text, font, fill=INK):
    d.text(((W - d.textlength(text, font=font)) / 2, y), text, font=font, fill=fill)

def caption(d, text):
    """Burned-in caption near the bottom, wrapped to two lines at most."""
    f = sansb(46)
    words, rows, row = text.split(), [], ''
    for w in words:
        if d.textlength((row + ' ' + w).strip(), font=f) > W - 160:
            rows.append(row); row = w
        else:
            row = (row + ' ' + w).strip()
    rows.append(row)
    y = H - 330 - 64 * (len(rows) - 1)
    for r in rows:
        tw = d.textlength(r, font=f)
        d.rounded_rectangle([(W - tw) / 2 - 22, y - 8, (W + tw) / 2 + 22, y + 60], 8, fill=INK)
        d.text(((W - tw) / 2, y), r, font=f, fill=PAPER)
        y += 72

def chrome(d, n):
    d.text((70, 90), 'HAWKES GEN', font=mono(34), fill=INK3)
    d.text((W - 70 - d.textlength(f'{n}/7', font=mono(34)), 90), f'{n}/7' if n else '', font=mono(34), fill=INK3)
    d.line([70, 150, W - 70, 150], fill=INK, width=3)
    centered(d, H - 150, 'hawkesgen.ai', mono(40), INK2)

def headline(d, top, k, a, b=None, size=110):
    y = 230 + int((1 - ease(k)) * 40)
    col = tuple(int(PAPER[i] + (INK[i] - PAPER[i]) * ease(k)) for i in range(3))
    centered(d, y, a, serif(size), col)
    if b:
        acc = tuple(int(PAPER[i] + (ACCENT[i] - PAPER[i]) * ease(k - .15)) for i in range(3))
        centered(d, y + size * 1.15, b, serifi(size), acc)

def draw(t):
    fr = Image.new('RGBA', (W, H), PAPER)
    d = ImageDraw.Draw(fr)
    i = max(j for j, s in enumerate(scenes) if s[0] <= t)
    s0, sd, _, line = scenes[i]
    u = t - s0  # seconds into the scene
    k = lambda at, length=.5: (u - at) / length
    if i == 0:
        headline(d, 0, k(0, .7), 'Game assets,', 'made to order.', 120)
        card(fr, knight, (190, 760, 330, 330), k(.6))
        d.text((540, 890), '→', font=sans(80), fill=INK3) if k(.9) > 0 else None
        card(fr, walk_frame(u), (600, 730, 390, 390), k(1.0))
    elif i == 1:
        headline(d, 0, k(0), 'Give it a', 'character.')
        z = ease(k(.2, .6))
        size = int(300 + 380 * z)
        card(fr, knight, ((W - size) // 2, 1050 - size // 2, size, size), z)
    elif i == 2:
        headline(d, 0, k(0), 'A walk cycle,', 'sliced and looping.', 96)
        card(fr, walk_frame(u), (240, 560, 600, 600), k(.2))
        card(fr, sheet, (90, 1220, 900, 260), k(1.2))
        x = 120
        for j, c in enumerate(['walk.png · 8 sprites', 'walk.anim · loops', 'Unity-ready']):
            if k(2.2 + j * .45) > 0: x += chip(d, x, 1510, c) + 14
    elif i == 3:
        headline(d, 0, k(0), 'Variants that', 'stay on-model.', 100)
        for j, v in enumerate(variants):
            card(fr, v, (60 + j * 330, 760, 300, 420), k(.5 + j * .9), check=False, label=f'take {j + 1}')
    elif i == 4:
        headline(d, 0, k(0), 'Pixel art,', 'in seconds.')
        card(fr, knight, (90, 720, 420, 420), k(.1))
        if k(.4) > 0: d.text((515, 880), '→', font=sans(80), fill=INK3)
        card(fr, pixel, (570, 720, 420, 420), k(.5), nearest=True)
        if k(1.0) > 0: chip(d, (W - 330) // 2, 1240, '2 credits · no GPU')
    elif i == 5:
        headline(d, 0, k(0), 'Materials', 'that tile.')
        for j, m in enumerate(tex):
            card(fr, m, (60 + j * 330, 760, 300, 300), k(.3 + j * .5), check=False, label=['albedo', 'normal', 'roughness'][j])
        if k(1.9) > 0: chip(d, (W - 560) // 2, 1200, 'cobblestone.mat · URP / HDRP')
    elif i == 6:
        headline(d, 0, k(0), 'Right where', 'you work.')
        for j, e in enumerate(['Unity', 'Claude Code', 'Cursor', 'VS Code']):
            kk = ease(k(.5 + j * .55, .4))
            if kk > 0:
                col = tuple(int(PAPER[q] + (INK[q] - PAPER[q]) * kk) for q in range(3))
                centered(d, 700 + j * 150 + int((1 - kk) * 30), e, serif(96), col)
    else:
        z = ease(k(0, .7))
        col = tuple(int(PAPER[q] + (INK[q] - PAPER[q]) * z) for q in range(3))
        centered(d, 560, 'hawkesgen.ai', serif(118), col)
        if k(1.2) > 0:
            acc = tuple(int(PAPER[q] + (ACCENT[q] - PAPER[q]) * ease(k(1.2))) for q in range(3))
            centered(d, 740, '50 free credits.', serifi(104), acc)
        card(fr, walk_frame(u), (340, 930, 400, 400), k(.4))
        if k(2.2) > 0: centered(d, 1380, 'Sprites · sprite sheets · 3D · voice · music', sans(40), INK2)
    chrome(d, i if 0 < i < 7 else 0)
    if u >= lead - .1: caption(d, line)
    return fr.convert('RGB')

# Voice track: each line at its scene's start + lead, mixed into one file.
inputs, filt = [], []
for j, (s0, _, p, _) in enumerate(scenes):
    inputs += ['-i', p]
    filt.append(f'[{j}:a]adelay={int((s0 + lead) * 1000)}|{int((s0 + lead) * 1000)}[a{j}]')
filt.append(''.join(f'[a{j}]' for j in range(len(scenes))) + f'amix=inputs={len(scenes)}:normalize=0,apad,atrim=0:{TOTAL:.2f},loudnorm=I=-14:TP=-1.5[out]')
subprocess.run(['ffmpeg', '-y', '-v', 'error', *inputs, '-filter_complex', ';'.join(filt), '-map', '[out]', '-ar', '48000', 'voice.wav'], check=True)

ff = subprocess.Popen(['ffmpeg', '-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-', '-i', 'voice.wav',
                       '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', 'hawkesgen-short-01.mp4'], stdin=subprocess.PIPE)
n = int(TOTAL * FPS)
for f in range(n):
    ff.stdin.write(draw(f / FPS).tobytes())
    if f % 150 == 0: print(f'{f}/{n}', flush=True)
ff.stdin.close()
ff.wait()
draw(scenes[2][0] + 3.0).save('poster.png')
print('done', round(TOTAL, 1), 's')
