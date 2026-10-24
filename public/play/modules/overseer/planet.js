// The planet (H.planet): every level is on a giant planet. Physics stays on the flat local patch (precise and cheap);
// the world is *drawn* as part of a planet:
//   - the ground, the sea and everything else curve down with distance from you (a vertex shader step on every
//     standard and PBR material: drop = distance² / 2R), so the horizon is round and things sink behind it;
//   - beyond the world's own reach the planet itself (one sphere under you, in the sky's far layer): oceans, continents
//     and clouds in the world's colours, the local world painted where it is, hazed into the sky near the horizon;
//   - the air thins with height (H.planet.air(y): 1 at the surface, about 0.004 at 10 km), which the sky (a black sky,
//     stars) and the vehicles (lift, rotors, engines) use; above it, the planet's atmosphere glows at its rim.
// config.planet: { radius, biome ("earth", "desert", "ice", "ocean", "forest", "lava", "alien"), colors: { sea, land,
// sand, snow, rock }, land (0-1), clouds (0-1), air (the air's scale height, m), surface (sea level, m) } or false.
// config.planet.sphere: true makes the world itself round (round.js): the ground is the whole planet, walked, flown
// and built on all the way round; nothing curves in the shader then (the things really are on the ball), and the far
// layer draws the planet turned with the frame, its lands where they are on it.
/* global HawkesPlay, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = BABYLON;
  const L = H.lib;
  const W = () => H.world;
  const SK = H.sky._;
  const { clamp, num, smooth, PHONE } = SK;

  const BIOMES = {
    earth: { sea: '#1d6aa5', land: '#4d8a3a', sand: '#d9c58f', snow: '#eef3f7', rock: '#7d7366', land0: 0.38, clouds: 0.5 },
    forest: { sea: '#1f5f8f', land: '#2f6b2a', sand: '#cdb985', snow: '#e9eff4', rock: '#5f5a4c', land0: 0.5, clouds: 0.55 },
    desert: { sea: '#2a7f9c', land: '#c9a165', sand: '#e6c78d', snow: '#f1e3c4', rock: '#9a6a43', land0: 0.78, clouds: 0.12 },
    ice: { sea: '#2b5f7f', land: '#dce7ee', sand: '#c4d3dc', snow: '#ffffff', rock: '#8a98a3', land0: 0.6, clouds: 0.45 },
    ocean: { sea: '#1b6db0', land: '#4f9a45', sand: '#e3d29e', snow: '#f2f6f9', rock: '#7a7468', land0: 0.12, clouds: 0.5 },
    lava: { sea: '#ff5a1a', land: '#2b2421', sand: '#4a3a33', snow: '#6d625d', rock: '#1b1716', land0: 0.6, clouds: 0.35, glow: 1 },
    alien: { sea: '#25c9ad', land: '#7b4fb0', sand: '#d68bd0', snow: '#f3e6ff', rock: '#4a3a6e', land0: 0.45, clouds: 0.4 },
  };
  const ALIAS = { earthlike: 'earth', green: 'forest', jungle: 'forest', sand: 'desert', dunes: 'desert', mars: 'desert', snow: 'ice', frozen: 'ice', winter: 'ice', water: 'ocean', sea: 'ocean', islands: 'ocean', volcano: 'lava', volcanic: 'lava', fire: 'lava', purple: 'alien', strange: 'alien' };

  const state = { on: true, round: false, radius: 60000, surface: 0, airBase: 0, scale: 1800, k: 1 / 120000 };
  /** Whether config.planet asks for a round world (sphere: true, or "round" / "sphere" / "globe"). */
  const isRound = (v) => Boolean(v && ((typeof v === 'object' && (v.sphere === true || v.round === true || /^(sphere|round|globe)$/i.test(String(v.shape || '')))) || (typeof v === 'string' && /^(sphere|round|globe)$/i.test(v))));
  /** Reads config.planet (and guesses the rest from the world: its sea, its terrain). */
  function read(cfg) {
    const v = cfg.planet;
    if (v === false || v === 'none' || v === 'flat') return { on: false, radius: 60000, surface: 0, scale: 1800, biome: BIOMES.earth };
    const round = isRound(v);
    const o = v && typeof v === 'object' ? v : typeof v === 'string' && !round ? { biome: v } : {};
    let biomeName = String(o.biome || '').toLowerCase();
    biomeName = ALIAS[biomeName] || biomeName;
    if (!BIOMES[biomeName]) {
      const shape = cfg.terrain && typeof cfg.terrain === 'object' ? String(cfg.terrain.shape || '') : String(cfg.terrain || '');
      biomeName = /dune|desert|sand/i.test(shape) ? 'desert' : /volcan/i.test(shape) ? 'earth' : 'earth';
    }
    const base = BIOMES[biomeName];
    const colors = { ...base, ...(o.colors && typeof o.colors === 'object' ? o.colors : {}) };
    if (!(o.colors && o.colors.sea) && cfg.water && typeof cfg.water === 'object' && cfg.water.color) colors.sea = cfg.water.color;
    const hasGround = Boolean(cfg.water || cfg.terrain);
    // A round world: the planet is the ground (sea level is its surface, y = 0 under you; no seas to sink into).
    if (round) {
      return {
        on: true, round: true,
        biome: { ...colors, name: biomeName },
        radius: clamp(num(o.radius, 50000), 2000, 2e6),
        surface: 0, airBase: 0,
        scale: clamp(num(o.air, 1800), 200, 20000),
        land: 1,
        clouds: clamp(num(o.clouds, base.clouds), 0, 1),
        local: 0, localR: 0,
      };
    }
    return {
      on: true,
      biome: { ...colors, name: biomeName },
      radius: clamp(num(o.radius, 60000), 4000, 2e6),
      surface: num(o.surface, hasGround ? (cfg.water && typeof cfg.water === 'object' ? num(cfg.water.level, 0) : typeof cfg.water === 'number' ? cfg.water : 0) : -150),
      scale: clamp(num(o.air, 1800), 200, 20000),
      land: clamp(num(o.land, base.land0), 0, 1),
      clouds: clamp(num(o.clouds, base.clouds), 0, 1),
      local: cfg.terrain ? 1 : cfg.water ? 2 : 0,
      // The air is thickest where the world is (a world floating over the planet breathes sea-level air at y = 0).
      airBase: o.surface !== undefined || hasGround ? null : 0,
      localR: cfg.terrain && typeof cfg.terrain === 'object' ? num(cfg.terrain.size, 512) * 0.5 : 300,
    };
  }

  /** The air at a height y (world meters): 1 at the planet's surface, thinning by e every `scale` meters. */
  function air(y) { if (!state.on) return 1; const h = Math.max(0, Number(y) - state.airBase - AIR_FULL); return Math.exp(-h / state.scale); }
  const AIR_FULL = 250; // the air is as thick as at sea level up to here (the ground's own layer), then thins
  /** Height above the bottom of the air (sea level; y = 0 for a world floating over its planet). */
  const altitude = (y) => Number(y) - state.airBase;
  /** How far a point at a flat distance d from the camera looks lower (the curve of the planet). */
  const drop = (d) => (state.on ? d * d * state.k : 0);

  // ------------------------------------------------------------------ the curve: every standard and PBR material
  const cur = { x: 0, z: 0, k: 0 };
  class CurvePlugin extends B.MaterialPluginBase {
    constructor(material) { super(material, 'HpCurve', 190, { HP_CURVE: false }); this._enable(true); }
    prepareDefines(defines) { defines.HP_CURVE = !this._material.hpNoCurve; }
    getClassName() { return 'HpCurvePlugin'; }
    getUniforms() { return { ubo: [{ name: 'hpCurve', size: 4, type: 'vec4' }], vertex: '#ifdef HP_CURVE\nuniform vec4 hpCurve;\n#endif\n' }; }
    bindForSubMesh(ubo) { if (!this._material.hpNoCurve) ubo.updateFloat4('hpCurve', cur.x, cur.z, cur.k, 0); }
    getCustomCode(type) {
      if (type !== 'vertex') return null;
      return { CUSTOM_VERTEX_UPDATE_WORLDPOS: '#ifdef HP_CURVE\n{ vec2 hpD = worldPos.xz - hpCurve.xy; worldPos.y -= dot(hpD, hpD) * hpCurve.z; }\n#endif\n' };
    }
  }
  if (B.RegisterMaterialPlugin) B.RegisterMaterialPlugin('HpCurve', (material) => (material instanceof B.StandardMaterial || (B.PBRBaseMaterial && material instanceof B.PBRBaseMaterial) ? new CurvePlugin(material) : null));

  // ------------------------------------------------------------------ the planet sphere (far layer)
  B.Effect.ShadersStore.hpPlanetVertexShader = `
precision highp float;
attribute vec3 position;
uniform mat4 world;
uniform mat4 viewProjection;
varying vec3 vN;
varying vec3 vW;
void main(void) { vN = normalize(position); vec4 wp = world * vec4(position, 1.0); vW = wp.xyz; gl_Position = viewProjection * wp; }`;
  B.Effect.ShadersStore.hpPlanetFragmentShader = `
precision highp float;
varying vec3 vN;
varying vec3 vW;
uniform vec3 camPos;
uniform vec3 camFlat;   // x, z of the camera on the flat world, and the planet's radius
uniform vec3 toSun;
uniform vec3 sea; uniform vec3 land; uniform vec3 sand; uniform vec3 snow; uniform vec3 rock;
uniform vec4 look;      // land fraction, clouds, time, lava glow
uniform vec4 localW;    // x, z, radius, kind (1 land, 2 sea)
uniform vec3 hazeCol;
uniform vec4 fogv;      // mode (3 linear), start, end, density
uniform vec4 lightv;    // day light, altitude, haze distance, space
float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), u.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), u.x), u.y); }
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * n2(p); p = p * 2.03 + vec2(17.3, 9.1); a *= 0.5; } return v; }
void main(void) {
  vec3 N = normalize(vN);
  float R = camFlat.z;
  // Where this point is on the flat world (the sphere's top is under the camera).
  float th = acos(clamp(N.y, -1.0, 1.0));
  vec2 dir = length(N.xz) > 1e-6 ? normalize(N.xz) : vec2(1.0, 0.0);
  vec2 fp = camFlat.xy + dir * th * R;
  float n = fbm(fp / 9000.0 + vec2(3.7, 1.3));
  float sl = mix(0.72, 0.3, look.x);
  // The local world: its land (a terrain) or its sea, then the planet's own continents farther out.
  float ld = length(fp - localW.xy);
  if (localW.w > 1.5) n = mix(sl - 0.1, n, smoothstep(2500.0, 6000.0, ld));
  if (localW.w > 0.5 && localW.w < 1.5) { float isl = 1.0 - smoothstep(localW.z * 0.7, localW.z * 1.1, ld); n = mix(mix(sl - 0.08, n, smoothstep(localW.z * 1.2, localW.z * 8.0, ld)), sl + 0.12, isl); }
  float landK = smoothstep(sl - 0.01, sl + 0.01, n);
  float hgt = clamp((n - sl) / 0.3, 0.0, 1.0);
  vec3 lc = mix(sand, land, smoothstep(0.0, 0.08, hgt));
  lc = mix(lc, rock, smoothstep(0.45, 0.7, hgt) * 0.7);
  lc = mix(lc, snow, smoothstep(0.7, 0.85, hgt) + smoothstep(0.82, 0.95, abs(N.y)) * 0.0);
  lc *= 0.85 + 0.3 * n2(fp / 700.0);
  vec3 wc = mix(sea * 0.55, sea, smoothstep(sl - 0.18, sl, n));
  vec3 c = mix(wc, lc, landK);
  // Light: the sun on this side, the night on the other; the sea's glint.
  float ndl = dot(N, toSun);
  float lit = clamp(ndl * 1.3 + 0.15, 0.0, 1.0);
  vec3 V = normalize(camPos - vW);
  float glint = pow(max(dot(reflect(-toSun, N), V), 0.0), 60.0) * (1.0 - landK) * lit;
  c = c * (0.05 + 0.95 * lit * lightv.x) + vec3(1.0, 0.95, 0.85) * glint * 0.6 * lightv.x;
  // Lava glows by itself.
  c += sea * (1.0 - landK) * look.w * 0.8;
  // Clouds (from above: they fade in as you climb).
  float cn = fbm(fp / 3600.0 + vec2(look.z * 0.004, look.z * 0.0015));
  float cl = smoothstep(1.0 - look.y * 0.75, 1.0 - look.y * 0.75 + 0.18, cn) * smoothstep(400.0, 2500.0, lightv.y);
  c = mix(c, vec3(0.95) * (0.08 + 0.92 * lit * lightv.x), cl * 0.9);
  // The haze: far parts fade into the sky (or the world's fog) near the horizon.
  float dist = length(vW - camPos);
  float hz;
  if (fogv.x > 2.5) hz = clamp((dist - fogv.y) / max(1.0, fogv.z - fogv.y), 0.0, 1.0);
  else hz = 1.0 - exp(-dist / lightv.z);
  float rim = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0) * lightv.w;
  c = mix(c, hazeCol, clamp(max(hz * (1.0 - lightv.w * 0.75), rim * 0.8), 0.0, 1.0));
  gl_FragColor = vec4(c, 1.0);
}`;
  B.Effect.ShadersStore.hpAtmoFragmentShader = `
precision highp float;
varying vec3 vN;
varying vec3 vW;
uniform vec3 camPos;
uniform vec3 toSun;
uniform vec3 glow;
uniform float vis;
void main(void) {
  vec3 N = normalize(vN);
  vec3 V = normalize(camPos - vW);
  float r = pow(1.0 - clamp(abs(dot(N, V)), 0.0, 1.0), 2.2);
  float lit = clamp(dot(N, toSun) * 1.5 + 0.35, 0.0, 1.0);
  gl_FragColor = vec4(glow * r * lit * vis * 1.4, 1.0);
}`;
  // ------------------------------------------------------------------ a round world's lands (shared with round.js's ground)
  /** The colours of a round planet at a direction from its middle (in the planet's own frame): meadows and woods,
   *  dry plains, rocky uplands and snow at the poles (the poles are on the z axis, so the start, on top, is mild).
   *  The same function paints the ground near you (round.js) and the whole ball from afar, so they meet without a seam. */
  const BIOME_UNIFORMS = 'uniform vec3 bLand; uniform vec3 bLand2; uniform vec3 bSand; uniform vec3 bRock; uniform vec3 bSnow;\n';
  const BIOME_GLSL = `
float bHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
// Value noise; its lattice repeats every 'per' cells (so a pattern can be fixed to the planet with small numbers).
float bNoise(vec3 p, float per) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  vec3 a = mod(i, per), b = mod(i + 1.0, per);
  return mix(mix(mix(bHash(vec3(a.x, a.y, a.z)), bHash(vec3(b.x, a.y, a.z)), f.x), mix(bHash(vec3(a.x, b.y, a.z)), bHash(vec3(b.x, b.y, a.z)), f.x), f.y),
             mix(mix(bHash(vec3(a.x, a.y, b.z)), bHash(vec3(b.x, a.y, b.z)), f.x), mix(bHash(vec3(a.x, b.y, b.z)), bHash(vec3(b.x, b.y, b.z)), f.x), f.y), f.z);
}
float bFbm(vec3 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * bNoise(p, 100000.0); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return v; }
vec3 biome(vec3 d, float R) {
  vec3 q = d * (R / 9000.0);
  float n = bFbm(q + vec3(3.1, 7.7, 1.3));
  float m = bFbm(q * 2.3 + vec3(9.0, 2.0, 5.0));
  vec3 c = mix(bLand, bLand2, smoothstep(0.42, 0.62, m));
  c = mix(c, bSand, smoothstep(0.56, 0.68, n) * (1.0 - smoothstep(0.45, 0.6, m)));
  c = mix(c, bRock, smoothstep(0.64, 0.76, n) * 0.85);
  float pole = abs(d.z) + (n - 0.5) * 0.18;
  c = mix(c, bSnow, smoothstep(0.82, 0.9, pole));
  return c;
}`;
  B.Effect.ShadersStore.hpRoundVertexShader = `
precision highp float;
attribute vec3 position;
uniform mat4 world;
uniform mat4 viewProjection;
varying vec3 vN;
varying vec3 vNw;
varying vec3 vW;
void main(void) { vN = normalize(position); vNw = normalize((world * vec4(position, 0.0)).xyz); vec4 wp = world * vec4(position, 1.0); vW = wp.xyz; gl_Position = viewProjection * wp; }`;
  B.Effect.ShadersStore.hpRoundFragmentShader = `
precision highp float;
varying vec3 vN;
varying vec3 vNw;
varying vec3 vW;
uniform vec3 camPos;
uniform vec3 toSun;
uniform vec4 look;      // radius, clouds, time, lava glow
uniform vec4 lit2;      // ambient, sun
uniform vec3 hazeCol;
uniform vec4 fogv;      // mode (3 linear), start, end, density
uniform vec4 lightv;    // day light, altitude, haze distance, space
${BIOME_UNIFORMS}${BIOME_GLSL}
void main(void) {
  vec3 d = normalize(vN);
  vec3 N = normalize(vNw);
  vec3 c = biome(d, look.x);
  float ndl = dot(N, toSun);
  float sun = clamp(ndl, 0.0, 1.0);
  // Lit like the ground near you (the world's ambient and sun, as the sky has set them), dark on the night side.
  c *= lit2.x * clamp(ndl * 2.0 + 0.7, 0.08, 1.0) + lit2.y * sun;
  // Clouds, seen from above (they fade in as you climb).
  float cn = bFbm(d * (look.x / 2600.0) + vec3(look.z * 0.003, look.z * 0.001, 0.0));
  float cl = smoothstep(1.0 - look.y * 0.62, 1.0 - look.y * 0.62 + 0.16, cn) * smoothstep(1800.0, 9000.0, lightv.y);
  c = mix(c, vec3(0.96) * (0.08 + 0.92 * clamp(ndl * 1.3 + 0.15, 0.0, 1.0) * lightv.x), cl * 0.85);
  // The haze: far parts fade into the sky (or the world's fog) near the horizon; the air glows at the rim.
  vec3 V = normalize(camPos - vW);
  float dist = length(vW - camPos);
  float hz;
  if (fogv.x > 2.5) hz = clamp((dist - fogv.y) / max(1.0, fogv.z - fogv.y), 0.0, 1.0);
  else hz = 1.0 - exp(-dist / lightv.z);
  float rim = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0) * lightv.w;
  c = mix(c, hazeCol, clamp(max(hz * (1.0 - lightv.w * 0.8), rim * 0.75), 0.0, 1.0));
  gl_FragColor = vec4(c, 1.0);
}`;
  /** The biome's five colours for the shaders (land, a deeper land, sand, rock, snow). */
  function biomeColors(b) {
    const land = L.hex(b.land, '#4d8a3a');
    return { bLand: land, bLand2: land.scale(0.72).add(new B.Color3(0, 0.02, 0)), bSand: L.hex(b.sand, '#d9c58f'), bRock: L.hex(b.rock, '#7d7366'), bSnow: L.hex(b.snow, '#eef3f7') };
  }

  function makePlanet(w, s) {
    const scene = w.scene, bg = s.bg;
    const segs = PHONE ? 64 : 112;
    const sphere = B.MeshBuilder.CreateSphere('hp-planet', { diameter: 2, segments: segs }, scene);
    const m = new B.ShaderMaterial('hp-planet', scene, { vertex: 'hpPlanet', fragment: 'hpPlanet' }, {
      attributes: ['position'],
      uniforms: ['world', 'viewProjection', 'camPos', 'camFlat', 'toSun', 'sea', 'land', 'sand', 'snow', 'rock', 'look', 'localW', 'hazeCol', 'fogv', 'lightv'],
    });
    // A round world's ball: its lands fixed to the planet (turned with the frame), lit like the ground.
    const rm = new B.ShaderMaterial('hp-round', scene, { vertex: 'hpRound', fragment: 'hpRound' }, {
      attributes: ['position'],
      uniforms: ['world', 'viewProjection', 'camPos', 'toSun', 'look', 'lit2', 'hazeCol', 'fogv', 'lightv', 'bLand', 'bLand2', 'bSand', 'bRock', 'bSnow'],
    });
    const atmo = B.MeshBuilder.CreateSphere('hp-atmo', { diameter: 2, segments: PHONE ? 32 : 48 }, scene);
    const am = new B.ShaderMaterial('hp-atmo', scene, { vertex: 'hpPlanet', fragment: 'hpAtmo' }, { attributes: ['position'], uniforms: ['world', 'viewProjection', 'camPos', 'toSun', 'glow', 'vis'], needAlphaBlending: true });
    am.alphaMode = B.Engine.ALPHA_ADD;
    am.disableDepthWrite = true;
    atmo.material = am;
    const P = { sphere, atmo, mat: m, cfg: null, t0: performance.now() };
    const cam = () => w.scene.activeCamera;
    m.onBindObservable.add(() => {
      const e = m.getEffect(), c = cam(), cf = P.cfg;
      if (!e || !c || !cf) return;
      const p = c.globalPosition, sk = H.sky, sun = sk.sunDir, b = cf.biome;
      e.setFloat3('camPos', p.x, p.y, p.z);
      e.setFloat3('camFlat', p.x, p.z, state.radius);
      e.setFloat3('toSun', sun.x, sun.y, sun.z);
      for (const k of ['sea', 'land', 'sand', 'snow', 'rock']) e.setColor3(k, L.hex(b[k], '#808080'));
      e.setFloat4('look', cf.land, cf.clouds, (performance.now() - P.t0) / 1000, b.glow ? 1 : 0);
      e.setFloat4('localW', 0, 0, cf.localR, cf.local);
      const fog = sk.fogOn ? w.scene.fogColor : null;
      e.setColor3('hazeCol', fog || sk.horizon);
      e.setFloat4('fogv', sk.fogOn ? w.scene.fogMode : 0, w.scene.fogStart, w.scene.fogEnd, w.scene.fogDensity);
      const alt = Math.max(0, p.y - state.surface);
      e.setFloat4('lightv', Math.max(0.08, sk.day), alt, 2600 + alt * 3.5, sk.space);
    });
    am.onBindObservable.add(() => {
      const e = am.getEffect(), c = cam();
      if (!e || !c) return;
      const p = c.globalPosition, sun = H.sky.sunDir, g = L.hex((P.cfg && P.cfg.biome && P.cfg.biome.air) || '#6fb6ff');
      e.setFloat3('camPos', p.x, p.y, p.z);
      e.setFloat3('toSun', sun.x, sun.y, sun.z);
      e.setColor3('glow', g);
      e.setFloat('vis', H.sky.space);
    });
    rm.onBindObservable.add(() => {
      const e = rm.getEffect(), c = cam(), cf = P.cfg;
      if (!e || !c || !cf) return;
      const p = c.globalPosition, sk = H.sky, sun = sk.sunDir;
      e.setFloat3('camPos', p.x, p.y, p.z);
      e.setFloat3('toSun', sun.x, sun.y, sun.z);
      const bc = biomeColors(cf.biome);
      for (const k of Object.keys(bc)) e.setColor3(k, bc[k]);
      e.setFloat4('look', state.radius, cf.clouds, (performance.now() - P.t0) / 1000, 0);
      e.setFloat4('lit2', w.hemi ? w.hemi.intensity : 0.7, w.sun ? w.sun.intensity : 0.8, 0, 0);
      const fog = sk.fogOn ? w.scene.fogColor : null;
      e.setColor3('hazeCol', fog || sk.horizon);
      e.setFloat4('fogv', sk.fogOn ? w.scene.fogMode : 0, w.scene.fogStart, w.scene.fogEnd, w.scene.fogDensity);
      const alt = H.planet.heightOf([p.x, p.y, p.z]);
      e.setFloat4('lightv', Math.max(0.08, sk.day), alt, 2600 + Math.max(0, alt) * 3.5, sk.space);
    });
    sphere.material = m;
    sphere.alwaysSelectAsActiveMesh = true;
    atmo.alwaysSelectAsActiveMesh = true;
    bg.add(sphere, 1);
    bg.add(atmo, 1);
    H.sky.onBg((main, fc) => {
      const on = state.on;
      sphere.setEnabled(on); atmo.setEnabled(on && H.sky.space > 0.02);
      if (!on) return;
      const p = main.globalPosition;
      const R = state.radius;
      if (state.round) {
        // The ball itself, at the planet's middle, turned so its lands stay where they are on the planet.
        if (sphere.material !== rm) sphere.material = rm;
        sphere.position.set(0, -R, 0);
        sphere.rotationQuaternion = H.planet.frame.toLocalQ();
      } else {
        if (sphere.material !== m) sphere.material = m;
        sphere.rotationQuaternion = null;
        sphere.position.set(p.x, state.surface - R, p.z);
      }
      sphere.scaling.setAll(R);
      atmo.position.copyFrom(sphere.position);
      atmo.scaling.setAll(R + state.scale * 5);
      const alt = Math.max(1, state.round ? H.planet.heightOf([p.x, p.y, p.z]) : p.y - state.surface);
      fc.minZ = clamp(alt * 0.4, 20, 4000);
      fc.maxZ = Math.max(4e5, R * 4 + alt * 2);
    });
    return P;
  }

  // ------------------------------------------------------------------ each world
  let planet = null;
  function configure() {
    const cf = read(L.effectiveConfig());
    // (A round world isn't curved in the shader: its things really are on the ball.)
    Object.assign(state, { on: cf.on, round: Boolean(cf.on && cf.round), radius: cf.radius, surface: cf.surface, airBase: cf.airBase === null || cf.airBase === undefined ? cf.surface : cf.airBase, scale: cf.scale, k: cf.on && !cf.round ? 1 / (2 * cf.radius) : 0 });
    if (planet) planet.cfg = cf;
    return cf;
  }
  H.sky.onEnter((w, s) => {
    planet = null;
    const cf = configure();
    if (s.bg) try { planet = makePlanet(w, s); planet.cfg = cf; } catch (err) { H.report(err, 'planet'); }
  });
  H.hooks.world.push({
    enter() { configure(); },
    ops(ops) { if ((ops || []).some((o) => o && o.op === 'config' && o.patch && ('planet' in o.patch || 'water' in o.patch || 'terrain' in o.patch))) configure(); },
  });
  // The curve follows the camera, before anything draws.
  H.hooks.frame.push(() => {
    const w = W(), c = w && w.scene && w.scene.activeCamera;
    if (!c) return;
    const p = c.globalPosition;
    cur.x = p.x; cur.z = p.z; cur.k = state.on ? state.k : 0;
  });

  // The codex's page (planet.js reads config.planet itself, every world).
  H.features.register('planet', {
    apply() {}, change() {}, dispose() {},
    codex: {
      title: 'The planet', group: 'World features',
      what: 'Every level is on a giant planet: the ground curves away at the horizon, the air thins as you climb (helicopters top out low, planes higher), and above it are space, the stars and the planet below. On by default; false makes the world flat.',
      value: { biome: 'earth', radius: 20000, surface: -2500 },
      fields: [['biome', 'earth, forest, desert, ice, ocean, lava, alien', 'earth (desert for dunes)'], ['radius', 'meters', '60000'], ['colors', '{ sea, land, sand, snow, rock }', "the biome's"], ['land', '0-1: how much is land', 'by biome'], ['clouds', '0-1', 'by biome'], ['air', "the air's scale height (m)", '1800'], ['surface', 'sea level (m)', "the sea's level, or 150 m below a world with no ground"]],
    },
  });

  H.planet = {
    BIOMES, BIOME_GLSL, BIOME_UNIFORMS, biomeColors, isRound,
    get on() { return state.on; },
    /** A round world (config.planet.sphere): the ground is the whole planet (round.js). */
    get round() { return state.round; },
    get radius() { return state.radius; },
    /** Height above the ground of a point in the world (a round world: from the planet's middle; else y over sea level). */
    heightOf(p) { const v = L.vec(p); return state.round ? Math.hypot(v[0], v[1] + state.radius, v[2]) - state.radius : v[1] - state.surface; },
    /** Which way is up at a point (away from the planet's middle in a round world; +y otherwise): [x, y, z]. */
    up(p) { if (!state.round) return [0, 1, 0]; const v = L.vec(p); const x = v[0], y = v[1] + state.radius, z = v[2]; const l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; },
    /** Where the planet's middle is in the world now ([0, -radius, 0] in a round world; null otherwise). */
    get center() { return state.round ? [0, -state.radius, 0] : null; },
    /** The local frame of a round world (round.js fills it in): where you are on the planet and how it's turned. */
    frame: { toLocalQ: () => B.Quaternion.Identity() },
    /** The planet's surface (sea level) in world meters. */
    get surface() { return state.surface; },
    /** The air's scale height (m): the air thins by e every this many meters. */
    get scale() { return state.scale; },
    /** Where space begins (the air is under half a percent): a height in world meters. */
    get space() { return state.airBase + AIR_FULL + state.scale * Math.log(250); },
    air, altitude, drop,
    /** How much lower a point looks than it is, from the camera (the planet's curve). */
    dropAt(x, z) { return drop(Math.hypot(Number(x) - cur.x, Number(z) - cur.z)); },
    /** The planet's settings as they are now ({ biome, radius, land, clouds, ... }). */
    get config() { return planet && planet.cfg ? { ...planet.cfg } : read(L.effectiveConfig()); },
    configure,
  };
})();
