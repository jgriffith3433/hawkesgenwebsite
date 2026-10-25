// The landing page's tool table, from Gen's own quotes: what each tool costs at its floor, asked as the demo project (a
// quote starts no work and takes nothing), kept for half an hour. A tool Gen does not know or cannot price is left out,
// and the page keeps the figure printed in its HTML.
import { gen } from './gen.ts';
import { DEMO_PROJECT } from './demo.ts';

export const PRICED_TOOLS = [
  'image.generate', 'image.edit', 'image.cutout', 'image.angles', 'image.panorama', 'texture.maps',
  'video.t2v', 'video.i2v', 'video.animate', 'video.upscale', 'video.interpolate',
  'image.viewsheet', 'mesh.views3d', 'mesh.textured',
  'mesh.rig', 'motion.from-text', 'blender.character',
  'audio.voice', 'audio.voice-design', 'audio.sfx', 'audio.music',
];

const TTL = 30 * 60_000;
let cache: { at: number; tools: Record<string, number> } | null = null;

export async function toolPrices(now = Date.now()) {
  if (cache && now - cache.at < TTL) return cache.tools;
  const tools: Record<string, number> = {};
  await Promise.all(PRICED_TOOLS.map(async (tool) => {
    try {
      const q = await gen<{ credits?: number }>('/v1/billing/quote', { as: DEMO_PROJECT, body: { tool, params: {} }, signal: AbortSignal.timeout(8000) });
      if (Number.isFinite(q.credits) && Number(q.credits) > 0) tools[tool] = Number(q.credits);
    } catch { /* not priced here: the page keeps its printed figure */ }
  }));
  if (Object.keys(tools).length) cache = { at: now, tools };
  return tools;
}
