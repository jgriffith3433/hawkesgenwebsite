// The game engine's manifest and docs, and the starter games, as the function has them: the function ships only
// cloud/functions, so tools/prebuild.mjs (firebase.json functions "predeploy") copies them from public/play, docs and
// src/ into cloud/functions/assets/ before every deploy (see that file for what is where). Read once per instance:
// a deploy is a new instance, so nothing here goes stale.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PortalError } from './http.ts';

export const ASSETS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets');

export type Manifest = {
  version: string;
  babylon: string[];
  havok: string;
  scripts: string[];
  eager: string[];
  optional: string[];
  editor: string[];
  kinds: string[];
  modules: { name: string; title: string; kinds: string[]; lazy: boolean; optional: boolean; config: string[]; tools: string[]; words: string[]; needs: string[]; scripts: string[] }[];
};

const cache = new Map<string, string>();
/** A file prebuild.mjs made (assets/<rel>). Missing means the deploy skipped the prebuild: a plain 503, never a crash. */
export function asset(rel: string): string {
  const hit = cache.get(rel);
  if (hit !== undefined) return hit;
  let text: string;
  try { text = fs.readFileSync(path.join(ASSETS, rel), 'utf8'); }
  catch { throw new PortalError('The game engine is not on this server yet (run cloud/functions/tools/prebuild.mjs before deploying)', { status: 503 }); }
  cache.set(rel, text);
  return text;
}

let parsed: Manifest | null = null;
export const manifest = (): Manifest => (parsed ??= JSON.parse(asset('engine/manifest.json')) as Manifest);
/** Every kind of thing a scene may hold: the core's and every module's. */
export const engineKinds = () => manifest().kinds;
/** WORLD.md or API.md, every section in order. */
export const engineDoc = (which: 'world' | 'api') => asset(`engine/${which}.md`);
/** /play/modules.js: the manifest and the loader in one small script. */
export const loaderScript = () => `window.HawkesModules = ${JSON.stringify(manifest())};\n${asset('engine/loader.js')}`;
export const playHtml = () => asset('pages/play.html');
export const closedHtml = () => asset('pages/closed.html');

// ------------------------------------------------------------------ the starter games (src/templates.ts, as prebuilt)
export type Template = { id: string; name: string; blurb: string; featured?: { emoji: string }; assets?: Record<string, string>; files: (title: string) => Record<string, string> };
export type Templates = {
  TEMPLATES: Template[];
  featured: () => { id: string; name: string; blurb: string; emoji: string; url: string }[];
  templateBundle: (id: string) => { id: string; slug: string; title: string; description: string; by: string; version: null; template: string; files: Record<string, string>; assets: Record<string, unknown> } | null;
};
let templatesP: Promise<Templates> | null = null;
/** src/templates.ts and src/overseer-games, loaded the first time they are needed (they lay the island on its terrain). */
export function templates(): Promise<Templates> {
  templatesP ??= (async () => {
    const file = path.join(ASSETS, 'src', 'templates.ts');
    if (!fs.existsSync(file)) throw new PortalError('The starter games are not on this server yet (run cloud/functions/tools/prebuild.mjs before deploying)', { status: 503 });
    return (await import(pathToFileURL(file).href)) as Templates;
  })();
  templatesP.catch(() => { templatesP = null; });
  return templatesP;
}
