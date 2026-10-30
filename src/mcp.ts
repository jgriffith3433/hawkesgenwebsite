// The Hawkes Gen MCP server (https://hawkesgen.ai/mcp, Streamable HTTP, stateless). Game-dev tools an agent can use the
// way a developer would: give it a file (an asset ref, a URL, inline bytes, or a one-time `curl -T` upload link), ask for
// a sprite sheet / 3D model / sound, and get back previews it can see and download links it can save into the project.
// Each tool is a task (tasks.ts): one or more Gen jobs, paid per job within the connection's daily limit. Long tasks
// stream progress when the client accepts it, and get_task picks up anything still running.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { gen } from './gen.ts';
import { quote } from './jobs.ts';
import { getUser } from './users.ts';
import { startTask, waitTask, getTask, cancelTask, recentTasks, results, type Step, type Task } from './tasks.ts';
import { downloadUrl, assetBytes, putFile, uploadLink, fetchIntoLibrary, extFor } from './files.ts';
import type { Caller } from './caller.ts';
import { spentToday } from './jobs.ts';
import { publicUrl } from './config.ts';
import { PACKS, checkout } from './billing.ts';
import { PortalError, readBody } from './util.ts';

const PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26'];
const VERSION = '1.0.0';

const INSTRUCTIONS = `Hawkes Gen makes and processes game assets on its own GPUs and servers: images, transparent sprites, sprite sheets, textures and PBR maps, skyboxes, video, 3D models, rigging, animation, voice, sound effects and music. Nothing runs on the user's machine.
- Files: pass an asset ref ("asset:a_..."), a public https URL, or upload a local file with upload_file (it gives a curl command to run; small files can go inline as base64).
- Results include previews you can see and download URLs. Save files into the project with: curl -L -o <path> "<url>". Name and place them the way the project already organizes assets.
- Every tool costs credits (1 credit = $0.01; images ~5, sounds ~8, video ~40, 3D ~50+; transform_image, remove_background and sprite sheets from a video ~2). Use estimate_cost when unsure, and tell the user what a large batch will cost first. account shows the balance; when it runs out, buy_credits gives the user a Stripe checkout link without leaving the editor.
- Editing: edit_image (instructions, references), make_variations, transform_image (resize, crop, trim, pixel art, outlines, flips, power-of-two), remove_background, upscale_image.
- Long work (video, 3D) can take minutes. If a result says it is still running, call get_task with its task_id.
- For transparent sprites and sprite sheets, prefer make_sprite_sheet / generate_image with transparent: true over doing it by hand.`;

// ------------------------------------------------------------------ file arguments

const fileArg = (description: string) => ({ type: 'string', description: `${description} An asset ref ("asset:a_..."), or a public https URL. For a local file, call upload_file first.` });

async function file(c: Caller, v: unknown, what: string): Promise<string> {
  const s = String(v ?? '').trim();
  if (!s) throw new PortalError(`${what} is required`);
  if (/^asset:a_[0-9a-f]+$/.test(s)) return s;
  if (/^a_[0-9a-f]+$/.test(s)) return `asset:${s}`;
  if (s.startsWith('https://')) return (await fetchIntoLibrary(c.user, s)).ref;
  throw new PortalError(`${what}: use an asset ref ("asset:a_...") or an https URL. For a file on this computer, call upload_file first and use the ref it returns.`);
}

const ASPECTS: Record<string, [number, number]> = { '1:1': [1024, 1024], '16:9': [1344, 768], '9:16': [768, 1344], '4:3': [1152, 864], '3:4': [864, 1152], '21:9': [1536, 640], '2:3': [832, 1248], '3:2': [1248, 832] };
const wanFrames = (seconds: number) => Math.min(81, Math.max(17, Math.round((seconds * 16) / 4) * 4 + 1));
const clamp = (v: unknown, lo: number, hi: number, d: number) => (Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Math.round(Number(v)))) : d);

// ------------------------------------------------------------------ the tools

type Ctx = { caller: Caller };
type Built = { name: string; steps: Step[] } | { direct: any };
type ToolDef = { name: string; title: string; description: string; inputSchema: any; annotations?: Record<string, unknown>; build: (a: any, ctx: Ctx) => Promise<Built> };

const gpu = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
const read = { readOnlyHint: true, openWorldHint: false };

const TOOLS: ToolDef[] = [
  // ---------------------------------------------------------------- files, account, tasks
  {
    name: 'upload_file',
    title: 'Upload a file',
    description: 'Gets a file into Hawkes Gen so other tools can use it. Without content_base64 or url, returns a one-time upload URL and the curl command to send a local file (run it in a shell; it prints JSON with the asset ref). content_base64 works for small files (under ~5 MB). url fetches a public https file. Returns "asset:a_..." to pass to other tools.',
    inputSchema: { type: 'object', properties: { filename: { type: 'string', description: 'The file name, with its extension (hero.png, walk.mp4, voice.wav, model.glb).' }, content_base64: { type: 'string', description: 'The file bytes, base64 (small files only).' }, url: { type: 'string', description: 'A public https URL to fetch instead.' } }, required: ['filename'] },
    annotations: { readOnlyHint: false, openWorldHint: false },
    async build(a, { caller }) {
      if (a.url) return { direct: { uploaded: await fetchIntoLibrary(caller.user, String(a.url)) } };
      if (a.content_base64) {
        const buf = Buffer.from(String(a.content_base64).replace(/^data:[^,]*,/, ''), 'base64');
        if (buf.length > 6_000_000) throw new PortalError('Inline uploads are limited to about 5 MB; call upload_file without content to get an upload link');
        return { direct: { uploaded: await putFile(caller.user, new Uint8Array(buf), String(a.filename)) } };
      }
      const link = uploadLink(caller.user, String(a.filename));
      return { direct: { upload: { ...link, then: 'Run the curl command from the folder the file is in. It prints JSON with "ref": "asset:a_..." - pass that ref to the next tool.' } } };
    },
  },
  {
    name: 'account',
    title: 'Credits and limits',
    description: 'The credit balance (1 credit = $0.01), what this connection has spent today against its daily limit, and where to buy more.',
    inputSchema: { type: 'object', properties: {} },
    annotations: read,
    async build(_a, { caller }) {
      const u = getUser(caller.user.id)!;
      return { direct: { email: u.email, credits: u.credits, usd: u.credits / 100, connection: caller.via.name ?? caller.via.kind, daily_limit: caller.via.cap, spent_today: caller.via.cap != null ? spentToday(caller.via.id) : undefined, buy_credits: `${publicUrl()}/credits`, manage_limits: `${publicUrl()}/connect` } };
    },
  },
  {
    name: 'buy_credits',
    title: 'Buy credits',
    description: 'A secure Stripe checkout link for a credit pack, to show the user: they pay in the browser and the credits are on the account within seconds. Without a pack, lists the packs. Packs: starter_10 ($10, 1,000 credits), creator_25 ($25, 2,750), studio_100 ($100, 12,000). Credits never expire.',
    inputSchema: { type: 'object', properties: { pack: { type: 'string', enum: PACKS.map((p) => p.id), description: 'Which pack.' } } },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    async build(a, { caller }) {
      const balance = getUser(caller.user.id)?.credits;
      if (!a.pack) return { direct: { balance, packs: PACKS.map((p) => ({ pack: p.id, price: `$${p.priceUsd}`, credits: p.credits, bonus: p.bonusPercent ? `${p.bonusPercent}% more` : undefined })), next: 'Call buy_credits with the pack the user picks to get the checkout link.' } };
      const c = await checkout(caller.user, { packId: a.pack, successUrl: `${publicUrl()}/thanks?pack=${a.pack}`, cancelUrl: `${publicUrl()}/thanks?cancelled=1` });
      return { direct: { checkout_url: c.url, pack: c.pack.id, price: `$${c.pack.priceUsd}`, credits: c.pack.credits, balance_now: balance, tell_the_user: `Open this link to pay $${c.pack.priceUsd} for ${c.pack.credits.toLocaleString('en-US')} credits (Stripe): ${c.url} . The credits arrive within seconds; then carry on.` } };
    },
  },
  {
    name: 'get_file',
    title: 'Get a file',
    description: 'A fresh download link (and a preview for images) for any asset ref from earlier work: links in results expire after 24 hours, refs never do.',
    inputSchema: { type: 'object', properties: { ref: { type: 'string', description: '"asset:a_..."' }, filename: { type: 'string', description: 'The name to save it as.' } }, required: ['ref'] },
    annotations: read,
    async build(a, { caller }) {
      const m = /^(?:asset:)?(a_[0-9a-f]+)$/.exec(String(a.ref ?? '').trim());
      if (!m) throw new PortalError('ref is "asset:a_..."');
      const name = String(a.filename || m[1]).replace(/[^\w.-]+/g, '-');
      const url = downloadUrl(caller.user, m[1], name);
      return { direct: { file: { ref: `asset:${m[1]}`, filename: name, url, curl: `curl -L -o "${name}" "${url}"` }, previewAsset: m[1] } };
    },
  },
  {
    name: 'estimate_cost',
    title: 'Estimate the cost',
    description: 'What one run of a Hawkes Gen tool would cost in credits, before running it. Use the tool id (image.generate, video.i2v, mesh.views3d, audio.music...) and its params.',
    inputSchema: { type: 'object', properties: { tool: { type: 'string' }, params: { type: 'object' } }, required: ['tool'] },
    annotations: read,
    async build(a, { caller }) {
      const q = await quote(caller.user, { tool: a.tool, params: a.params ?? {} });
      return { direct: { tool: q.tool, credits: q.credits, usd: q.credits / 100, your_balance: q.userCredits } };
    },
  },
  {
    name: 'get_task',
    title: 'Check a task',
    description: 'Waits for a task that was still running (up to wait_seconds, default 50) and returns its results, or how far it got.',
    inputSchema: { type: 'object', properties: { task_id: { type: 'string' }, wait_seconds: { type: 'number', minimum: 0, maximum: 600 } }, required: ['task_id'] },
    annotations: read,
    async build(a, { caller }) {
      const t = getTask(String(a.task_id), caller.user.id);
      if (!t) throw new PortalError('No such task');
      return { direct: { task: t.id, wait: clamp(a.wait_seconds, 0, 600, 50) } };
    },
  },
  {
    name: 'cancel_task',
    title: 'Cancel a task',
    description: 'Stops a running task. The step that was running is refunded; finished steps keep their results.',
    inputSchema: { type: 'object', properties: { task_id: { type: 'string' } }, required: ['task_id'] },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    async build(a, { caller }) {
      const t = await cancelTask(caller.user, String(a.task_id));
      return { direct: { task: t.id, state: t.state } };
    },
  },
  {
    name: 'recent_work',
    title: 'Recent work',
    description: "The user's recent tasks with their state and results (asset refs), newest first.",
    inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 50 } } },
    annotations: read,
    async build(a, { caller }) {
      return { direct: { tasks: recentTasks(caller.user.id, clamp(a.limit, 1, 50, 10)).map((t) => ({ task_id: t.id, name: t.name, state: t.state, credits: t.credits, created: new Date(t.created).toISOString(), results: results(t).map((o) => ({ ref: `asset:${o.asset}`, kind: o.kind, title: o.title })), error: t.error ?? undefined })) } };
    },
  },

  // ---------------------------------------------------------------- images
  {
    name: 'generate_image',
    title: 'Generate an image',
    description: 'Concept art, props, characters, icons, backgrounds, UI art. transparent: true cuts the subject out onto a transparent PNG (sprites, icons, items). seamless: true makes a tiling texture. ~5 credits per image (+2 for transparent).',
    inputSchema: { type: 'object', properties: { prompt: { type: 'string', description: 'What to draw, with the style (e.g. "pixel art", "hand-painted", "low-poly render").' }, aspect: { type: 'string', enum: Object.keys(ASPECTS), default: '1:1' }, count: { type: 'integer', minimum: 1, maximum: 4, default: 1 }, transparent: { type: 'boolean', default: false, description: 'Cut the subject out (transparent PNG).' }, seamless: { type: 'boolean', default: false, description: 'Tile seamlessly (textures).' } }, required: ['prompt'] },
    annotations: gpu,
    async build(a) {
      const [width, height] = ASPECTS[a.aspect] ?? ASPECTS['1:1'];
      const count = clamp(a.count, 1, 4, 1);
      const steps: Step[] = [{ tool: 'image.generate', title: 'Painting', params: { prompt: String(a.prompt), width, height, count, seamless: Boolean(a.seamless) && !a.transparent } }];
      if (a.transparent) for (let i = 0; i < count; i++) steps.push({ tool: 'image.cutout', title: `Cutting out ${count > 1 ? `#${i + 1}` : ''}`.trim(), inputs: { image: { from: 0, pick: i } }, keep: true });
      return { name: String(a.prompt), steps };
    },
  },
  {
    name: 'edit_image',
    title: 'Edit an image',
    description: 'Changes an image as instructed: recolor, restyle, change the pose, add or remove things, make a variant. Up to two reference images guide it (a style, a character to keep on-model). ~5 credits.',
    inputSchema: { type: 'object', properties: { image: fileArg('The image to change.'), instruction: { type: 'string' }, references: { type: 'array', items: { type: 'string' }, maxItems: 2, description: 'Optional reference images (asset refs or https URLs).' }, count: { type: 'integer', minimum: 1, maximum: 4, default: 1 } }, required: ['image', 'instruction'] },
    annotations: gpu,
    async build(a, { caller }) {
      const images = [await file(caller, a.image, 'image'), ...(await Promise.all((a.references ?? []).slice(0, 2).map((r: unknown) => file(caller, r, 'reference'))))];
      return { name: String(a.instruction), steps: [{ tool: 'image.edit', title: 'Editing', params: { prompt: String(a.instruction), count: clamp(a.count, 1, 4, 1) }, inputs: { images } }] };
    },
  },
  {
    name: 'make_variations',
    title: 'Variations of an image',
    description: 'Several takes on an image that keep the subject and art style: alternate poses, outfits, colorways, item variants, enemy palette swaps. Say what should change, or leave it open. ~5 credits each.',
    inputSchema: { type: 'object', properties: { image: fileArg('The image.'), change: { type: 'string', description: 'What should differ, e.g. "different weapons", "fire, ice and poison versions".' }, count: { type: 'integer', minimum: 2, maximum: 4, default: 3 } }, required: ['image'] },
    annotations: gpu,
    async build(a, { caller }) {
      const prompt = `A variation of this image: the same subject, art style, framing and background. ${a.change ? `Change: ${a.change}.` : 'Change the pose and small details.'}`;
      return { name: `variations ${a.change ?? ''}`.trim(), steps: [{ tool: 'image.edit', title: 'Making variations', params: { prompt, count: clamp(a.count, 2, 4, 3) }, inputs: { images: [await file(caller, a.image, 'image')] } }] };
    },
  },
  {
    name: 'transform_image',
    title: 'Resize, crop, pixel art and more',
    description: `Fast fixes on an image (2 credits, no GPU), as steps in order:
- {"op":"resize","width":128,"height":128,"fit":"contain|cover|stretch","pixel":true} (pixel: nearest-neighbour)
- {"op":"scale","factor":2,"pixel":true} · {"op":"crop","x":0,"y":0,"width":64,"height":64}
- {"op":"trim","pad":2} (to the visible pixels) · {"op":"pad","width":256,"height":256,"color":"ffffff"} · {"op":"square"} · {"op":"pot"} (power-of-two sides)
- {"op":"flip","axis":"h|v"} · {"op":"rotate","degrees":90}
- {"op":"pixelate","size":64,"colors":16,"upscale":4} (pixel art) · {"op":"colors","count":8}
- {"op":"outline","width":2,"color":"000000"} (sprite outline) · {"op":"tint","color":"ff0000","amount":0.4} · {"op":"grayscale"}
For example a left-facing copy: [{"op":"flip"}]; a 64 px pixel-art icon: [{"op":"trim"},{"op":"pixelate","size":64,"colors":16},{"op":"outline","width":1}].`,
    inputSchema: { type: 'object', properties: { image: fileArg('The image.'), steps: { type: 'array', items: { type: 'object' }, minItems: 1, maxItems: 20 }, format: { type: 'string', enum: ['png', 'webp', 'jpg'], default: 'png' } }, required: ['image', 'steps'] },
    annotations: gpu,
    async build(a, { caller }) {
      if (!Array.isArray(a.steps) || !a.steps.length) throw new PortalError('steps: a list like [{"op":"trim"},{"op":"resize","width":128,"height":128}]');
      return { name: a.steps.map((st: any) => st?.op).filter(Boolean).join('-') || 'transformed', steps: [{ tool: 'image.transform', title: 'Transforming', params: { ops: a.steps, format: ['png', 'webp', 'jpg'].includes(a.format) ? a.format : 'png' }, inputs: { image: await file(caller, a.image, 'image') } }] };
    },
  },
  {
    name: 'remove_background',
    title: 'Remove the background',
    description: 'Cuts the subject out of an image onto transparency (sprites, items, characters, photos of props). Returns a trimmed transparent PNG. ~2 credits.',
    inputSchema: { type: 'object', properties: { image: fileArg('The image.'), keep_glow: { type: 'boolean', default: false, description: 'Keep fire, magic and light effects as soft glow.' } }, required: ['image'] },
    annotations: gpu,
    async build(a, { caller }) {
      return { name: 'cutout', steps: [{ tool: 'image.cutout', title: 'Cutting out', params: { glow: Boolean(a.keep_glow) }, inputs: { image: await file(caller, a.image, 'image') } }] };
    },
  },
  {
    name: 'upscale_image',
    title: 'Upscale an image',
    description: 'Sharp 2x or 4x upscaling for sprites, textures, concept art and frames. ~5 credits.',
    inputSchema: { type: 'object', properties: { image: fileArg('The image.'), scale: { type: 'integer', enum: [2, 4], default: 2 } }, required: ['image'] },
    annotations: gpu,
    async build(a, { caller }) {
      return { name: 'upscaled', steps: [{ tool: 'image.upscale', title: 'Upscaling', params: { resize: Number(a.scale) === 4 ? 1 : 0.5 }, inputs: { image: await file(caller, a.image, 'image') } }] };
    },
  },
  {
    name: 'character_views',
    title: 'Character from 8 angles',
    description: 'The same character or object from 8 camera angles (front, sides, 3/4, high and low): reference sheets for artists, animators and 3D. ~5 credits.',
    inputSchema: { type: 'object', properties: { image: fileArg('The character or object, one clear view.') }, required: ['image'] },
    annotations: gpu,
    async build(a, { caller }) {
      return { name: 'views', steps: [{ tool: 'image.angles', title: 'Turning it around', inputs: { image: await file(caller, a.image, 'image') } }] };
    },
  },
  {
    name: 'make_texture',
    title: 'Tileable material',
    description: 'A seamless texture from a description, plus its PBR maps: albedo (lighting flattened), normal (OpenGL, +Y up) and roughness, ready for Unity, Godot, Unreal or Babylon.js. ~10 credits.',
    inputSchema: { type: 'object', properties: { surface: { type: 'string', description: 'The surface, e.g. "mossy cobblestone", "scratched sci-fi hull plates", "pixel-art grass".' }, size: { type: 'integer', enum: [512, 1024, 2048], default: 1024 } }, required: ['surface'] },
    annotations: gpu,
    async build(a) {
      const size = [512, 1024, 2048].includes(Number(a.size)) ? Number(a.size) : 1024;
      return { name: String(a.surface), steps: [
        { tool: 'image.generate', title: 'Painting the texture', params: { prompt: `${a.surface}, seamless tileable texture, top-down, flat even lighting, no shadows`, width: size, height: size, seamless: true } },
        { tool: 'texture.maps', title: 'Making PBR maps', inputs: { image: { from: 0 } }, keep: true },
      ] };
    },
  },
  {
    name: 'make_skybox',
    title: '360° skybox',
    description: 'An equirectangular 360° panorama (2:1) for skyboxes, environment maps and backdrops. ~5 credits.',
    inputSchema: { type: 'object', properties: { prompt: { type: 'string', description: 'The environment, e.g. "stormy alien desert at dusk, two moons".' } }, required: ['prompt'] },
    annotations: gpu,
    async build(a) {
      return { name: String(a.prompt), steps: [{ tool: 'image.panorama', title: 'Painting the panorama', params: { prompt: String(a.prompt) } }] };
    },
  },

  // ---------------------------------------------------------------- animation, sprites, video
  {
    name: 'make_sprite_sheet',
    title: 'Animated sprite sheet',
    description: 'A game sprite sheet from a character image and a motion ("idle breathing", "run cycle", "sword slash"), or from an existing video. From an image: cuts the character out, animates it on a green screen, keys the green to transparency and lays the frames out. Returns sheet.png (transparent atlas), the frame JSON (TexturePacker hash: works with Phaser, Godot, Unity importers) and a GIF preview. ~50 credits from an image, ~2 from a video.',
    inputSchema: { type: 'object', properties: { image: fileArg('The character (any background).'), motion: { type: 'string', description: 'The animation, e.g. "idle breathing loop", "running cycle facing right".' }, video: fileArg('Or: an existing animation to slice (then no image or motion).'), frames: { type: 'integer', minimum: 2, maximum: 32, default: 8 }, columns: { type: 'integer', minimum: 0, maximum: 32, default: 0, description: '0 = square-ish grid.' }, frame_size: { type: 'integer', minimum: 32, maximum: 512, default: 256, description: 'Frame width in pixels.' }, loop: { type: 'boolean', default: true, description: 'End where it started (cycles, idles).' }, key: { type: 'string', description: 'With video: the flat background color to make transparent (hex, e.g. 00ff00).' } } },
    annotations: gpu,
    async build(a, { caller }) {
      const sheet = { frames: clamp(a.frames, 2, 32, 8), columns: clamp(a.columns, 0, 32, 0), cell: clamp(a.frame_size, 32, 512, 256), fps: 12 };
      if (a.video) return { name: 'sprite sheet', steps: [{ tool: 'sprite.sheet', title: 'Making the sprite sheet', params: { ...sheet, key: String(a.key ?? ''), loop: a.loop !== false }, inputs: { video: await file(caller, a.video, 'video') } }] };
      if (!a.image || !a.motion) throw new PortalError('Give image and motion (or a video)');
      const loop = a.loop !== false;
      return { name: `${a.motion}`, steps: [
        { tool: 'image.cutout', title: 'Cutting out the character', inputs: { image: await file(caller, a.image, 'image') } },
        { tool: 'image.frame', title: 'Placing it on a green screen', params: { width: 640, height: 640, color: '00ff00', fill: 0.78 }, inputs: { image: { from: 0 } } },
        { tool: 'video.i2v', title: 'Animating', params: { prompt: `${a.motion}. The character stays in place, centered, full body in frame. Flat solid green background, no shadows.`, width: 640, height: 640, frames: 33 }, inputs: loop ? { start: { from: 1 }, end: { from: 1 } } : { start: { from: 1 } }, keep: true },
        { tool: 'sprite.sheet', title: 'Making the sprite sheet', params: { ...sheet, key: '00ff00', loop }, inputs: { video: { from: 2 } }, keep: true },
      ] };
    },
  },
  {
    name: 'animate_image',
    title: 'Animate an image',
    description: 'A short video clip that starts on an image: characters moving, idle loops, ambient scenes, title screens. loop: true ends where it started. ~40 credits.',
    inputSchema: { type: 'object', properties: { image: fileArg('The first frame.'), motion: { type: 'string', description: 'What happens.' }, seconds: { type: 'number', minimum: 1, maximum: 5, default: 3 }, loop: { type: 'boolean', default: false }, aspect: { type: 'string', enum: ['1:1', '16:9', '9:16'], default: '1:1' } }, required: ['image', 'motion'] },
    annotations: gpu,
    async build(a, { caller }) {
      const start = await file(caller, a.image, 'image');
      const [width, height] = a.aspect === '16:9' ? [832, 480] : a.aspect === '9:16' ? [480, 832] : [640, 640];
      return { name: String(a.motion), steps: [{ tool: 'video.i2v', title: 'Animating', params: { prompt: String(a.motion), width, height, frames: wanFrames(Number(a.seconds) || 3) }, inputs: a.loop ? { start, end: start } : { start } }] };
    },
  },
  {
    name: 'make_video',
    title: 'Video from text',
    description: 'A short video clip from a description: trailers shots, cutscene ideas, backgrounds, effects. ~40 credits.',
    inputSchema: { type: 'object', properties: { prompt: { type: 'string' }, seconds: { type: 'number', minimum: 1, maximum: 10, default: 5 }, aspect: { type: 'string', enum: ['1:1', '16:9', '9:16'], default: '16:9' } }, required: ['prompt'] },
    annotations: gpu,
    async build(a) {
      const [width, height] = a.aspect === '1:1' ? [640, 640] : a.aspect === '9:16' ? [480, 832] : [832, 480];
      return { name: String(a.prompt), steps: [{ tool: 'video.t2v', title: 'Filming', params: { prompt: String(a.prompt), seconds: clamp(a.seconds, 1, 10, 5), width, height } }] };
    },
  },

  // ---------------------------------------------------------------- 3D
  {
    name: 'image_to_3d',
    title: 'Image to 3D model',
    description: 'A textured 3D model (GLB with PBR materials) from an image. kind "character": makes the back and side views first, then builds from all four (much better backs and sides; best from a full-body front view in a neutral pose). kind "prop": builds from the single image. Takes several minutes. ~60-100 credits.',
    inputSchema: { type: 'object', properties: { image: fileArg('The character (front view, whole body) or the prop.'), kind: { type: 'string', enum: ['character', 'prop'], default: 'character' } }, required: ['image'] },
    annotations: gpu,
    async build(a, { caller }) {
      const image = await file(caller, a.image, 'image');
      if (a.kind === 'prop') return { name: 'prop', steps: [{ tool: 'mesh.textured', title: 'Building the model', params: { allowSingleView: true }, inputs: { image } }] };
      return { name: 'character', steps: [
        { tool: 'image.cutout', title: 'Cutting out', inputs: { image } },
        { tool: 'image.viewsheet', title: 'Drawing the back and sides', inputs: { image: { from: 0 } }, keep: true },
        { tool: 'mesh.views3d', title: 'Building the 3D model', inputs: { image: { from: 1, kind: 'image', pick: 0 } }, keep: true },
      ] };
    },
  },
  {
    name: 'rig_character',
    title: 'Rig a 3D character',
    description: 'Adds a skeleton and skin weights to a 3D character (GLB, FBX or OBJ, standing upright). Humanoids get a Mixamo-compatible skeleton (Mixamo and Unity Humanoid animations work); other shapes get a fitted one. Returns the rigged GLB and a preview walk. Several minutes. ~20+ credits.',
    inputSchema: { type: 'object', properties: { model: fileArg('The 3D model.'), kind: { type: 'string', enum: ['auto', 'humanoid'], default: 'auto', description: 'auto handles humanoids and creatures; humanoid forces a Mixamo skeleton.' } }, required: ['model'] },
    annotations: gpu,
    async build(a, { caller }) {
      return { name: 'rigged', steps: [{ tool: 'mesh.rig', title: 'Rigging', params: { kind: a.kind === 'humanoid' ? 'humanoid' : 'auto' }, inputs: { mesh: await file(caller, a.model, 'model') } }] };
    },
  },
  {
    name: 'animate_character',
    title: 'Animate a 3D character',
    description: 'A humanoid animation from a sentence ("drunken stumble then falls", "two-handed overhead axe swing"), put on a rigged character (from rig_character). Without a model, returns the motion as BVH. ~20+ credits.',
    inputSchema: { type: 'object', properties: { motion: { type: 'string' }, model: fileArg('The rigged character (optional).'), seconds: { type: 'number', minimum: 0.5, maximum: 12, default: 3 }, loop: { type: 'boolean', default: false }, in_place: { type: 'boolean', default: false, description: 'No root motion (for game controllers that move the character).' } }, required: ['motion'] },
    annotations: gpu,
    async build(a, { caller }) {
      const inputs = a.model ? { character: await file(caller, a.model, 'model') } : {};
      return { name: String(a.motion), steps: [{ tool: 'motion.from-text', title: 'Animating', params: { prompt: String(a.motion), seconds: Math.max(0.5, Math.min(12, Number(a.seconds) || 3)), loop: Boolean(a.loop), inPlace: Boolean(a.in_place) }, inputs }] };
    },
  },

  // ---------------------------------------------------------------- audio
  {
    name: 'sound_effect',
    title: 'Sound effect',
    description: 'A game sound from a description: hits, footsteps, UI clicks, spells, explosions, creature noises, ambient loops. Leave seconds empty for one-shots. ~8 credits each.',
    inputSchema: { type: 'object', properties: { description: { type: 'string' }, seconds: { type: 'number', minimum: 0.5, maximum: 30 }, loop: { type: 'boolean', default: false, description: 'A seamless loop (ambience); set seconds too.' }, variations: { type: 'integer', minimum: 1, maximum: 4, default: 1 } }, required: ['description'] },
    annotations: gpu,
    async build(a) {
      return { name: String(a.description), steps: [{ tool: 'audio.sfx', title: 'Recording', params: { text: String(a.description), ...(a.seconds ? { duration: Number(a.seconds) } : {}), loop: Boolean(a.loop), count: clamp(a.variations, 1, 4, 1) } }] };
    },
  },
  {
    name: 'list_voices',
    title: 'Available voices',
    description: 'The voices voice_line can use, with their ids and descriptions.',
    inputSchema: { type: 'object', properties: {} },
    annotations: read,
    async build(_a, { caller }) {
      const r: any = await gen('/v1/editor/voices', { as: caller.user.project });
      return { direct: { voices: (r.voices ?? []).map((v: any) => ({ id: v.id, name: v.name, description: v.about })) } };
    },
  },
  {
    name: 'voice_line',
    title: 'Voice line',
    description: 'Speaks a line of dialogue in a voice (id or name from list_voices). Say how to deliver it in the text, e.g. [whispers] or [laughs]. ~10 credits.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' }, voice: { type: 'string', description: 'A voice id or name from list_voices.' }, variations: { type: 'integer', minimum: 1, maximum: 4, default: 1 } }, required: ['text', 'voice'] },
    annotations: gpu,
    async build(a, { caller }) {
      let voice = String(a.voice);
      if (!/^(hv|gv)_[a-z0-9_]+$/.test(voice)) {
        const r: any = await gen('/v1/editor/voices', { as: caller.user.project });
        const want = voice.toLowerCase();
        const v = (r.voices ?? []).find((x: any) => String(x.name).toLowerCase() === want) ?? (r.voices ?? []).find((x: any) => `${x.name} ${x.about}`.toLowerCase().includes(want));
        if (!v) throw new PortalError(`No voice named "${voice}"; call list_voices`);
        voice = v.id;
      }
      return { name: String(a.text).slice(0, 60), steps: [{ tool: 'audio.voice', title: 'Speaking', params: { text: String(a.text), voice, count: clamp(a.variations, 1, 4, 1) } }] };
    },
  },
  {
    name: 'make_music',
    title: 'Music',
    description: 'Game music from style tags: level themes, boss fights, menus, loops; instrumental unless lyrics are given (use [Verse]/[Chorus] sections). ~20 credits.',
    inputSchema: { type: 'object', properties: { style: { type: 'string', description: 'Genre, mood, instruments, e.g. "tense orchestral boss battle, taiko, brass stabs".' }, seconds: { type: 'number', minimum: 10, maximum: 240, default: 60 }, bpm: { type: 'integer', minimum: 40, maximum: 220 }, lyrics: { type: 'string' } }, required: ['style'] },
    annotations: gpu,
    async build(a) {
      return { name: String(a.style), steps: [{ tool: 'audio.music', title: 'Composing', params: { prompt: String(a.style), seconds: clamp(a.seconds, 10, 240, 60), ...(a.bpm ? { bpm: clamp(a.bpm, 40, 220, 95) } : {}), ...(a.lyrics ? { lyrics: String(a.lyrics) } : {}) } }] };
    },
  },

  // ---------------------------------------------------------------- everything else
  {
    name: 'list_all_tools',
    title: 'Every Hawkes Gen tool',
    description: 'All the lower-level tools run_tool can use (ids, what they do, their params): image edits with references, video from control videos, frame interpolation, Blender character ops, LoRA, film tools...',
    inputSchema: { type: 'object', properties: { search: { type: 'string' } } },
    annotations: read,
    async build(a, { caller }) {
      const r: any = await gen('/v1/tools', { as: caller.user.project });
      const s = String(a.search ?? '').toLowerCase();
      return { direct: { tools: (r.tools ?? []).filter((t: any) => !s || `${t.id} ${t.title} ${t.description}`.toLowerCase().includes(s)).map((t: any) => ({ id: t.id, title: t.title, description: String(t.description ?? '').slice(0, 300), inputs: Object.keys(t.inputs ?? {}), params: Object.keys(t.params ?? {}) })) } };
    },
  },
  {
    name: 'run_tool',
    title: 'Run any tool',
    description: 'Runs one Hawkes Gen tool by id (see list_all_tools) with its params and inputs. File inputs take asset refs or https URLs (or lists of them).',
    inputSchema: { type: 'object', properties: { tool: { type: 'string' }, params: { type: 'object' }, inputs: { type: 'object', description: 'Input name -> asset ref, https URL, or a list of them.' } }, required: ['tool'] },
    annotations: gpu,
    async build(a, { caller }) {
      const inputs: Record<string, string | string[]> = {};
      for (const [k, v] of Object.entries(a.inputs ?? {})) inputs[k] = Array.isArray(v) ? await Promise.all(v.map((x) => file(caller, x, k))) : await file(caller, v, k);
      return { name: String(a.tool), steps: [{ tool: String(a.tool), title: String(a.tool), params: a.params ?? {}, inputs }] };
    },
  },
];

// ------------------------------------------------------------------ prompts (slash commands in the editor)

const PROMPTS = [
  { name: 'sprite_sheet', title: 'Sprite sheet for my game', description: 'A transparent, animated sprite sheet, saved into the project and hooked up.', arguments: [{ name: 'character', description: 'Who (a description, or a path/URL to an image)', required: true }, { name: 'animation', description: 'e.g. idle, run cycle, attack', required: true }],
    text: (a: any) => `Make a game sprite sheet of ${a.character} doing: ${a.animation}.
1. If ${a.character} is a file on disk, upload it with upload_file. If it's a URL, use it directly. If it's only a description, use generate_image with transparent: true, a full-body view facing right, in the art style this project already uses (look at existing sprites first).
2. Call make_sprite_sheet with that image and the motion "${a.animation}" (loop: true for cycles).
3. Save sheet.png, its JSON and the GIF next to the project's other sprites, named after the character and animation.
4. Hook it up the way this project loads sprites (Unity: Sprite Mode Multiple sliced by the JSON; Godot: SpriteFrames/AnimatedSprite2D; Phaser: load.atlas), then show me the GIF.` },
  { name: 'character_3d', title: 'Rigged 3D character', description: 'From a description or concept to a textured, rigged, animated GLB in the project.', arguments: [{ name: 'character', description: 'A description, or a path/URL to a concept image', required: true }, { name: 'animations', description: 'e.g. idle, walk, jump', required: false }],
    text: (a: any) => `Make a game-ready 3D character: ${a.character}.
1. If it's a file, upload it with upload_file. If it's a description, generate_image a full-body FRONT view in a neutral A-pose on a plain background.
2. image_to_3d with kind "character" (it draws the back and sides first). Show me the view sheet.
3. rig_character on the GLB.
4. animate_character for: ${a.animations || 'idle, walk'} (in_place: true for gameplay).
5. Save the GLBs into the project's models folder and set them up the way this project imports characters. Tell me the total credits spent.` },
  { name: 'tileable_material', title: 'Tileable PBR material', description: 'A seamless texture with normal and roughness maps, saved and set up as a material.', arguments: [{ name: 'surface', description: 'e.g. mossy cobblestone', required: true }],
    text: (a: any) => `Make a tileable PBR material: ${a.surface}. Call make_texture, save the albedo, normal and roughness maps into the project's textures folder, and create a material that uses them the way this project does (Unity URP/HDRP Lit, Godot StandardMaterial3D, Unreal, or Babylon.js PBRMaterial).` },
  { name: 'sound_pack', title: 'Sound effects pack', description: 'Every sound a feature needs, generated, named and wired up.', arguments: [{ name: 'feature', description: 'e.g. "the player controller", "inventory UI", or a list of sounds', required: true }],
    text: (a: any) => `Make the sound effects for ${a.feature}. Read the code first and list every moment that should make a sound, then show me the list with the estimated cost (about 8 credits each). Then call sound_effect for each (2 variations for frequent ones like footsteps), save them into the project's audio folder with clear names, and wire them up where they belong.` },
  { name: 'ui_icons', title: 'Game UI icons', description: 'A consistent set of transparent icons.', arguments: [{ name: 'icons', description: 'e.g. "sword, shield, potion, gold coin"', required: true }, { name: 'style', description: 'e.g. "hand-painted fantasy", "flat pixel art"', required: false }],
    text: (a: any) => `Make game UI icons for: ${a.icons}. Style: ${a.style || 'match the existing UI art in this project'}. Use generate_image with transparent: true, one call per icon, with the same style words in each prompt so they match. Save them as PNGs in the project's UI folder with clear names.` },
];

// ------------------------------------------------------------------ results

async function present(c: Caller, t: Task, opts: { previews?: boolean } = {}) {
  if (t.state === 'running') {
    return { content: [{ type: 'text', text: `Still working on "${t.name}" (step ${Math.min(t.step + 1, t.steps.length)} of ${t.steps.length}: ${t.detail ?? 'running'}). Credits so far: ${t.credits}. Call get_task with task_id "${t.id}" to wait for it.` }], structuredContent: { task_id: t.id, state: t.state, step: t.step + 1, steps: t.steps.length, detail: t.detail, credits: t.credits, progress: progressOf(t) } };
  }
  if (t.state !== 'done') {
    const broke = /Not enough credits/.test(t.error ?? '') ? ' Use buy_credits to get a checkout link for the user (it takes a minute), then try again.' : '';
    return { isError: true, content: [{ type: 'text', text: `"${t.name}" ${t.state === 'cancelled' ? 'was cancelled' : `failed: ${t.error}`}. The credits for the step that didn't finish were refunded; ${t.credits} credits were used by earlier steps.${broke}` }], structuredContent: { task_id: t.id, state: t.state, error: t.error, credits: t.credits } };
  }
  const outs = results(t);
  // Short names: the first few words of what was asked ("walking-in-place", "mossy-cobblestone").
  const base = t.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter((w) => !['a', 'an', 'the', 'of', 'with'].includes(w)).slice(0, 3).join('-').slice(0, 32) || 'asset';
  const files = outs.map((o, i) => {
    const ext = o.title === 'sprite sheet frames' ? '.json' : extFor(o.mime) || '';
    const name = o.title === 'sprite sheet' ? `${base}-sheet.png` : o.title === 'sprite sheet frames' ? `${base}-sheet.json` : o.title === 'preview' ? `${base}-preview${ext}` : `${base}${outs.length > 1 ? `-${o.title && !/save|output/i.test(o.title) ? o.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') : i + 1}` : ''}${ext}`;
    return { ref: `asset:${o.asset}`, kind: o.kind, mime: o.mime, title: o.title, filename: name, url: downloadUrl(c.user, o.asset, name) };
  });
  const balance = getUser(c.user.id)?.credits;
  const lines = files.map((f) => `- ${f.filename} (${f.kind}, ${f.ref})\n  curl -L -o "${f.filename}" "${f.url}"`).join('\n');
  const low = balance !== undefined && balance < 60 ? `\nRunning low: ${balance} credits left. buy_credits gives the user a checkout link right here.` : '';
  const content: any[] = [{ type: 'text', text: `Done: "${t.name}" (${t.credits} credits; ${balance} left).\n${lines}\nLinks work for 24 hours (get_file makes new ones). Use the refs as inputs to other tools.${low}` }];
  if (opts.previews !== false) {
    let shown = 0;
    for (const f of files) {
      if (shown >= 4 || !/^image\/(png|jpeg|webp|gif)$/.test(f.mime)) continue;
      const bytes = await assetBytes(c.user, f.ref.slice(6)).catch(() => null);
      if (!bytes) continue;
      content.push({ type: 'image', data: bytes.toString('base64'), mimeType: f.mime });
      shown++;
    }
  }
  for (const f of files) content.push({ type: 'resource_link', uri: f.url, name: f.filename, mimeType: f.mime, description: f.title ?? f.kind });
  return { content, structuredContent: { task_id: t.id, state: 'done', credits: t.credits, balance, files } };
}

const json = (v: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(v, null, 2) }], structuredContent: v });

// Typical seconds per tool once a GPU is up (from live runs), for the progress bar and "about N min left".
const TYPICAL: Record<string, number> = { 'image.generate': 40, 'image.edit': 60, 'image.cutout': 30, 'image.frame': 3, 'image.upscale': 40, 'image.angles': 90, 'image.panorama': 60, 'image.viewsheet': 150, 'image.transform': 3, 'texture.maps': 10, 'sprite.sheet': 5, 'video.i2v': 300, 'video.t2v': 240, 'mesh.views3d': 300, 'mesh.textured': 200, 'mesh.rig': 240, 'motion.from-text': 150, 'audio.sfx': 6, 'audio.voice': 6, 'audio.music': 90 };
const typical = (tool: string) => TYPICAL[tool] ?? 60;
const COLD = /no GPU server|waiting for ComfyUI|starting server|booting/i;

/** Where a task is, as a progress bar: steps done plus the running step's share, of all steps, and a sentence. */
export function progressOf(t: Task, now = Date.now()) {
  const total = t.steps.length;
  const step = Math.min(t.step, total - 1);
  const into = (now - (t.stepStarted ?? t.updated)) / 1000;
  const cold = COLD.test(t.detail ?? '');
  const share = cold ? 0.02 : Math.min(0.95, into / typical(t.steps[step].tool));
  const left = cold ? 60 + t.steps.slice(step).reduce((a, x) => a + typical(x.tool), 0) : Math.max(0, typical(t.steps[step].tool) - into) + t.steps.slice(step + 1).reduce((a, x) => a + typical(x.tool), 0);
  const ahead = Number(/(\d+) jobs? ahead/.exec(t.detail ?? '')?.[1] ?? 0);
  const total_left = left + ahead * typical(t.steps[step].tool);
  const eta = total_left < 45 ? 'under a minute left' : `about ${Math.round(total_left / 60)} min left`;
  const what = cold ? 'Starting a GPU server (about a minute)' : (t.detail ?? t.steps[step].title);
  return { progress: Math.min(total, step + share), total, message: `Step ${step + 1}/${total} · ${what} · ${eta}` };
}

// ------------------------------------------------------------------ the protocol

type Rpc = { jsonrpc: '2.0'; id?: string | number | null; method: string; params?: any };
const ok = (id: Rpc['id'], result: unknown) => ({ jsonrpc: '2.0', id, result });
const fail = (id: Rpc['id'], code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } });

async function callTool(c: Caller, p: any, stream: ((n: any) => void) | null, signal: AbortSignal) {
  const tool = TOOLS.find((t) => t.name === p?.name);
  if (!tool) return { isError: true, content: [{ type: 'text', text: `Unknown tool ${p?.name}` }] };
  let built: Built;
  try {
    built = await tool.build(p.arguments ?? {}, { caller: c });
  } catch (e: any) {
    return { isError: true, content: [{ type: 'text', text: e.message ?? String(e) }] };
  }
  let taskId: string;
  if ('direct' in built) {
    if (built.direct?.previewAsset) {
      // An image the model can look at, beside the link (PNG, JPEG, GIF or WebP, by their first bytes).
      const { previewAsset, ...rest } = built.direct;
      const bytes = await assetBytes(c.user, previewAsset).catch(() => null);
      const mime = !bytes ? null : bytes[0] === 0x89 ? 'image/png' : bytes[0] === 0xff ? 'image/jpeg' : bytes.subarray(0, 3).toString('latin1') === 'GIF' ? 'image/gif' : bytes.subarray(8, 12).toString('latin1') === 'WEBP' ? 'image/webp' : null;
      const out = json(rest) as any;
      if (mime) out.content.push({ type: 'image', data: bytes!.toString('base64'), mimeType: mime });
      return out;
    }
    if (!built.direct?.task) return json(built.direct);
    taskId = built.direct.task;
  } else {
    try {
      taskId = startTask(c.user, c.via, built.name, built.steps).id;
    } catch (e: any) {
      return { isError: true, content: [{ type: 'text', text: e.message ?? String(e) }] };
    }
  }
  const token = p?._meta?.progressToken;
  const waitMs = 'direct' in built ? built.direct.wait * 1000 : stream && token !== undefined ? 9 * 60_000 : 50_000;
  // A progress bar the editor can draw: progress of total (steps), a sentence with the time left, every change and
  // every 5 s so it never looks stuck. Progress only goes up, as the spec requires.
  let last = -1;
  const tick = () => {
    const u = getTask(taskId);
    if (!stream || token === undefined || !u || u.state !== 'running') return;
    const pr = progressOf(u);
    // Rounded first, then compared, so what the editor sees always goes up.
    const value = Math.max(Math.round((last + 0.001) * 1000) / 1000, Math.round(pr.progress * 1000) / 1000);
    last = value;
    stream({ jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: token, progress: value, total: pr.total, message: pr.message } });
  };
  tick();
  const beat = setInterval(tick, 5000);
  const t = await waitTask(taskId, waitMs, () => tick(), signal).finally(() => clearInterval(beat));
  return present(c, getTask(t.id) ?? t);
}

async function dispatch(c: Caller, m: Rpc, stream: ((n: any) => void) | null, signal: AbortSignal) {
  switch (m.method) {
    case 'initialize': {
      const asked = m.params?.protocolVersion;
      return ok(m.id, { protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0], capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } }, serverInfo: { name: 'hawkesgen', title: 'Hawkes Gen', version: VERSION, websiteUrl: publicUrl() }, instructions: INSTRUCTIONS });
    }
    case 'ping':
      return ok(m.id, {});
    case 'tools/list':
      return ok(m.id, { tools: TOOLS.map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: { title: t.title, ...(t.annotations ?? {}) } })) });
    case 'tools/call':
      return ok(m.id, await callTool(c, m.params, stream, signal));
    case 'prompts/list':
      return ok(m.id, { prompts: PROMPTS.map(({ text, ...p }) => p) });
    case 'prompts/get': {
      const p = PROMPTS.find((x) => x.name === m.params?.name);
      if (!p) return fail(m.id, -32602, `Unknown prompt ${m.params?.name}`);
      return ok(m.id, { description: p.description, messages: [{ role: 'user', content: { type: 'text', text: p.text(m.params?.arguments ?? {}) } }] });
    }
    case 'resources/list':
      return ok(m.id, { resources: [] });
    case 'resources/templates/list':
      return ok(m.id, { resourceTemplates: [] });
    default:
      return fail(m.id, -32601, `Method not found: ${m.method}`);
  }
}

/** POST /mcp. One message or a batch; notifications get 202. A tools/call from a client that accepts event streams gets
 *  its progress as server-sent events, then the result. */
export async function handleMcp(c: Caller, req: IncomingMessage, res: ServerResponse) {
  const raw = (await readBody(req, 8 * 1024 * 1024)).toString('utf8');
  let body: any;
  try {
    body = JSON.parse(raw);
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return void res.end(JSON.stringify(fail(null, -32700, 'Parse error')));
  }
  const batch = Array.isArray(body);
  const msgs: Rpc[] = batch ? body : [body];
  const requests = msgs.filter((m) => m && m.id !== undefined && m.method);
  if (!requests.length) {
    res.writeHead(202);
    return void res.end();
  }
  const ctrl = new AbortController();
  res.on('close', () => ctrl.abort());
  const wantsStream = String(req.headers.accept ?? '').includes('text/event-stream') && !batch && requests[0].method === 'tools/call' && requests[0].params?._meta?.progressToken !== undefined;
  if (wantsStream) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
    const send = (msg: unknown) => res.write(`event: message\ndata: ${JSON.stringify(msg)}\n\n`);
    const beat = setInterval(() => res.write(': keep-alive\n\n'), 15_000);
    try {
      send(await dispatch(c, requests[0], send, ctrl.signal));
    } finally {
      clearInterval(beat);
      res.end();
    }
    return;
  }
  const out = await Promise.all(requests.map((m) => dispatch(c, m, null, ctrl.signal).catch((e) => fail(m.id, -32603, e.message ?? String(e)))));
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(batch ? out : out[0]));
}

export const toolNames = () => TOOLS.map((t) => t.name);
