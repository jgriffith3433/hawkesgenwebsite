// A game's world is scene.json: settings plus a flat map of entities (public/play/docs/world is the format). The world is
// changed by ops, from the editor (dragging, the popups, undo), from the assistant, and from nothing else: the server
// applies them in order, keeps scene.json, and tells everyone in the game. Ops are small, so two people building at
// once never overwrite each other's whole world.

import { engineKinds } from './engine.ts';

/** The kinds of things a world may hold: the engine core's (public/play/engine.json) and every module's
 *  (public/play/modules/<name>/module.json "kinds"), read fresh so a new module needs no change here. */
export const kindsOfThings = (): string[] => engineKinds();
export const PHYSICS = ['static', 'dynamic', 'kinematic', 'trigger', 'none'] as const;
export const SCENE_LIMITS = { entities: 500, bytes: 240 * 1024, opsPerCall: 200 };

export type Entity = { id: string; type: string; name?: string | null; tag?: string | null; parent?: string | null; [k: string]: any };
export type Scene = { version: number; config: Record<string, any>; entities: Record<string, Entity>; nextId: number };
/** How a new thing comes into the world (the engine's arrivals: public/play/modules/overseer/arrive.js). An op may say;
 *  it is passed on to everyone, never saved in the thing. */
export const ARRIVALS = ['drop', 'grow', 'beam', 'none'] as const;
const arrival = (raw: any) => (ARRIVALS.includes(raw?.arrive) ? { arrive: raw.arrive as string } : {});
export type Op =
  | { op: 'create'; entity: Partial<Entity>; arrive?: string }
  | { op: 'update'; id: string; patch: Record<string, any> }
  | { op: 'replace'; entity: Entity; arrive?: string }
  | { op: 'delete'; id: string }
  | { op: 'config'; patch: Record<string, any> };

export class SceneError extends Error {}

const ID = /^[A-Za-z0-9_-]{1,48}$/;

export function emptyScene(): Scene {
  return { version: 2, config: { background: '#9fd3f0' }, entities: {}, nextId: 1 };
}

/** scene.json text as a scene, forgiving: a missing or broken file is an empty world (never a crash). */
export function parseScene(text: string | null | undefined): Scene {
  if (!text) return emptyScene();
  try {
    const s = JSON.parse(text);
    if (!s || typeof s !== 'object' || Array.isArray(s)) return emptyScene();
    const entities: Record<string, Entity> = {};
    for (const [k, e] of Object.entries(s.entities ?? {})) if (e && typeof e === 'object' && ID.test(k)) entities[k] = { ...(e as any), id: k };
    return { version: 2, config: s.config && typeof s.config === 'object' ? s.config : {}, entities, nextId: Math.max(1, Number(s.nextId) || 1) };
  } catch {
    return emptyScene();
  }
}

export const sceneText = (s: Scene) => JSON.stringify(s, null, 1);

/** Merges patch into target. Arrays and plain values replace; null removes the key. */
function merge(target: Record<string, any>, patch: Record<string, any>) {
  for (const [k, v] of Object.entries(patch)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    if (v === null) delete target[k];
    else if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object' && !Array.isArray(target[k])) merge(target[k], v);
    else target[k] = clone(v);
  }
  return target;
}
const clone = (v: any) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

function checkEntity(e: Entity) {
  const kinds = kindsOfThings();
  if (!kinds.includes(e.type)) throw new SceneError(`"${e.type}" is not a kind of thing (one of ${kinds.join(', ')})`);
  if (e.physics != null && !PHYSICS.includes(e.physics)) throw new SceneError(`physics is one of ${PHYSICS.join(', ')}`);
  const t = e.transform;
  if (t) for (const k of ['position', 'rotation', 'scale'] as const) {
    const v = t[k];
    if (v == null) continue;
    const arr = typeof v === 'number' ? [v] : v;
    if (!Array.isArray(arr) || arr.length > 3 || arr.some((n: any) => typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > 1e5)) throw new SceneError(`transform.${k} is [x, y, z] numbers`);
  }
  if (e.behaviors != null && !Array.isArray(e.behaviors)) throw new SceneError('behaviors is a list');
}

function freeId(s: Scene, want?: string | null) {
  const base = String(want ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32);
  if (base && !s.entities[base]) return base;
  for (;;) {
    const id = base ? `${base}_${s.nextId++}` : `e_${s.nextId++}`;
    if (!s.entities[id]) return id;
  }
}

/** Applies ops to a copy of the scene. Bad ops are skipped (and listed) so one mistake doesn't lose the rest. */
export function applyOps(scene: Scene, ops: unknown): { scene: Scene; applied: Op[]; errors: string[]; created: string[] } {
  if (!Array.isArray(ops)) throw new SceneError('ops is a list');
  if (ops.length > SCENE_LIMITS.opsPerCall) throw new SceneError(`At most ${SCENE_LIMITS.opsPerCall} changes at once`);
  const s: Scene = clone(scene);
  const applied: Op[] = [];
  const errors: string[] = [];
  const created: string[] = [];
  for (const raw of ops as any[]) {
    try {
      if (!raw || typeof raw !== 'object') throw new SceneError('an op is an object');
      if (raw.op === 'create') {
        if (Object.keys(s.entities).length >= SCENE_LIMITS.entities) throw new SceneError(`A world holds up to ${SCENE_LIMITS.entities} things`);
        const spec = clone(raw.entity ?? {});
        if (!spec || typeof spec !== 'object') throw new SceneError('create needs an entity');
        delete spec.arrive;
        const id = spec.id && ID.test(spec.id) && !s.entities[spec.id] ? spec.id : freeId(s, spec.id || spec.name || spec.type);
        const e: Entity = { ...spec, id, type: spec.type ?? 'box' };
        checkEntity(e);
        s.entities[id] = e;
        created.push(id);
        applied.push({ op: 'create', entity: e, ...arrival(raw) });
      } else if (raw.op === 'update') {
        const e = s.entities[raw.id];
        if (!e) throw new SceneError(`nothing called ${raw.id}`);
        if (!raw.patch || typeof raw.patch !== 'object') throw new SceneError('update needs a patch');
        const next = merge(clone(e), raw.patch);
        next.id = e.id;
        checkEntity(next as Entity);
        s.entities[e.id] = next as Entity;
        applied.push({ op: 'update', id: e.id, patch: clone(raw.patch) });
      } else if (raw.op === 'replace') {
        const e = clone(raw.entity);
        if (!e || !ID.test(e.id)) throw new SceneError('replace needs an entity with an id');
        delete e.arrive;
        if (!s.entities[e.id] && Object.keys(s.entities).length >= SCENE_LIMITS.entities) throw new SceneError(`A world holds up to ${SCENE_LIMITS.entities} things`);
        checkEntity(e);
        s.entities[e.id] = e;
        applied.push({ op: 'replace', entity: e, ...arrival(raw) });
      } else if (raw.op === 'delete') {
        if (!s.entities[raw.id]) throw new SceneError(`nothing called ${raw.id}`);
        const gone = new Set([raw.id]);
        // Children go with their parent.
        for (let grew = true; grew;) {
          grew = false;
          for (const e of Object.values(s.entities)) if (e.parent && gone.has(e.parent) && !gone.has(e.id)) { gone.add(e.id); grew = true; }
        }
        for (const id of gone) delete s.entities[id];
        applied.push({ op: 'delete', id: raw.id });
      } else if (raw.op === 'config') {
        if (!raw.patch || typeof raw.patch !== 'object') throw new SceneError('config needs a patch');
        merge(s.config, raw.patch);
        applied.push({ op: 'config', patch: clone(raw.patch) });
      } else throw new SceneError(`unknown op ${raw.op}`);
    } catch (e: any) {
      if (!(e instanceof SceneError)) throw e;
      errors.push(e.message);
    }
  }
  if (Buffer.byteLength(sceneText(s)) > SCENE_LIMITS.bytes) throw new SceneError('The world is too big to save; remove some things first');
  return { scene: s, applied, errors, created };
}

/** A short description of the world for the assistant: one line per thing. */
export function describeScene(s: Scene, limit = 300) {
  const lines: string[] = [];
  for (const e of Object.values(s.entities).slice(0, limit)) {
    const p = (e.transform?.position ?? [0, 0, 0]).map((n: number) => Math.round(n * 10) / 10).join(', ');
    const bits = [e.type, e.physics ?? '', e.tag ? `tag ${e.tag}` : '', (e.behaviors ?? []).map((b: any) => b?.use ?? b?.type).filter(Boolean).join('+')].filter(Boolean).join(' · ');
    lines.push(`${e.id}${e.name ? ` "${e.name}"` : ''}: ${bits} at [${p}]`);
  }
  const more = Object.keys(s.entities).length - lines.length;
  return lines.join('\n') + (more > 0 ? `\n(and ${more} more)` : '');
}
