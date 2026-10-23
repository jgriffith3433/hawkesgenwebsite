// HawkesEngine: Live scene-graph engine built on Babylon.js.
// The game world is a JSON scene graph. The AI emits commands; the engine applies them in real-time.
// No iframe, no reload — entities appear and change as the player watches.
/* global BABYLON */

const DEFAULT_CONFIG = {
  background: '#87CEEB',
  ambient: 0.3,
  sun: 0.8,
  sunDirection: [-1, -2, -1],
  shadows: true,
  fog: null,
  gravity: -9.81,
  physics: 'simple',
};

const BUDGET = { maxEntities: 500, maxLights: 8, maxPhysicsBodies: 200 };

function defaultScene() {
  return { version: 1, modules: { core: '1.0.0' }, config: { ...DEFAULT_CONFIG }, entities: {}, nextId: 1 };
}

function hexToColor3(hex) {
  hex = hex.replace('#', '');
  return new BABYLON.Color3(parseInt(hex.substr(0, 2), 16) / 255, parseInt(hex.substr(2, 2), 16) / 255, parseInt(hex.substr(4, 2), 16) / 255);
}

function hexToColor4(hex, a = 1) {
  const c = hexToColor3(hex);
  return new BABYLON.Color4(c.r, c.g, c.b, a);
}

function vec3(arr) { return new BABYLON.Vector3(arr[0] || 0, arr[1] || 0, arr[2] || 0); }
function deg2rad(d) { return d * Math.PI / 180; }

// ===================================================================== HawkesEngine

class HawkesEngine {
  constructor(canvas) {
    this.canvas = canvas;
    this.bEngine = new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
    this.scene = null;
    this.graph = null;
    this.nodes = new Map();
    this.materials = new Map();
    this.mode = 'edit';
    this.camera = null;
    this.sunLight = null;
    this.ambientLight = null;
    this.shadowGen = null;
    this.ground = null;
    this.onLocalChange = null;
    this.onSelect = null;
    this.assetResolver = null;
    this.selected = null;
    this._highlightLayer = null;
    this._disposed = false;

    window.addEventListener('resize', () => { if (!this._disposed) this.bEngine.resize(); });
    this.bEngine.runRenderLoop(() => { if (this.scene && !this._disposed) this.scene.render(); });
  }

  // ------------------------------------------------------------------ scene lifecycle

  loadScene(graph) {
    if (this.scene) this.scene.dispose();
    this.nodes.clear();
    this.materials.clear();

    this.graph = JSON.parse(JSON.stringify(graph || defaultScene()));
    this.scene = new BABYLON.Scene(this.bEngine);

    if (this.graph.config.physics !== 'none') {
      this.scene.enablePhysics(new BABYLON.Vector3(0, this.graph.config.gravity, 0), new BABYLON.CannonJSPlugin());
    }

    this.applyConfig(this.graph.config);
    this.setupCamera();
    this.setupPicking();

    for (const entity of Object.values(this.graph.entities)) {
      this.buildNode(entity);
    }

    this.bEngine.resize();
  }

  saveScene() {
    return JSON.parse(JSON.stringify(this.graph));
  }

  destroy() {
    this._disposed = true;
    if (this.scene) this.scene.dispose();
    this.bEngine.dispose();
  }

  // ------------------------------------------------------------------ config

  applyConfig(cfg) {
    const s = this.scene;
    if (!s) return;

    if (cfg.background) s.clearColor = hexToColor4(cfg.background);

    // Ambient light
    if (this.ambientLight) this.ambientLight.dispose();
    this.ambientLight = new BABYLON.HemisphericLight('_ambient', new BABYLON.Vector3(0, 1, 0), s);
    this.ambientLight.intensity = cfg.ambient ?? 0.3;
    this.ambientLight.diffuse = new BABYLON.Color3(0.95, 0.95, 1.0);
    this.ambientLight.groundColor = new BABYLON.Color3(0.4, 0.35, 0.3);

    // Sun (directional)
    if (this.sunLight) this.sunLight.dispose();
    const dir = cfg.sunDirection || [-1, -2, -1];
    this.sunLight = new BABYLON.DirectionalLight('_sun', vec3(dir), s);
    this.sunLight.intensity = cfg.sun ?? 0.8;

    // Shadows
    if (this.shadowGen) this.shadowGen.dispose();
    if (cfg.shadows) {
      this.shadowGen = new BABYLON.ShadowGenerator(1024, this.sunLight);
      this.shadowGen.useBlurExponentialShadowMap = true;
      this.shadowGen.blurKernel = 16;
    }

    // Fog
    if (cfg.fog) {
      s.fogMode = BABYLON.Scene.FOGMODE_LINEAR;
      s.fogColor = hexToColor3(cfg.fog.color || cfg.background);
      s.fogStart = cfg.fog.start ?? 40;
      s.fogEnd = cfg.fog.end ?? 120;
    } else {
      s.fogMode = BABYLON.Scene.FOGMODE_NONE;
    }
  }

  // ------------------------------------------------------------------ camera

  setupCamera() {
    if (this.camera) this.camera.dispose();

    if (this.mode === 'edit') {
      this.camera = new BABYLON.ArcRotateCamera('_cam', -Math.PI / 4, Math.PI / 3, 20, BABYLON.Vector3.Zero(), this.scene);
      this.camera.lowerRadiusLimit = 2;
      this.camera.upperRadiusLimit = 200;
      this.camera.wheelDeltaPercentage = 0.01;
      this.camera.panningSensibility = 50;
      this.camera.attachControl(this.canvas, true);
    } else {
      this.camera = new BABYLON.UniversalCamera('_cam', new BABYLON.Vector3(0, 2, -5), this.scene);
      this.camera.speed = 0.5;
      this.camera.keysUp = [87]; this.camera.keysDown = [83];
      this.camera.keysLeft = [65]; this.camera.keysRight = [68];
      this.camera.attachControl(this.canvas, true);
    }
    this.camera.minZ = 0.1;
    this.camera.maxZ = 500;
  }

  setMode(mode) {
    this.mode = mode;
    this.setupCamera();
  }

  // ------------------------------------------------------------------ commands

  applyCommands(commands, opts = {}) {
    const applied = [];
    for (const cmd of commands) {
      try {
        this.execute(cmd);
        applied.push(cmd);
      } catch (e) {
        console.warn('Command failed:', cmd.op, e.message);
      }
    }
    if (!opts.remote && applied.length && this.onLocalChange) {
      this.onLocalChange(applied);
    }
    return applied;
  }

  execute(cmd) {
    switch (cmd.op) {
      case 'create': return this.createEntity(cmd.entity);
      case 'update': return this.updateEntity(cmd.id, cmd.patch);
      case 'delete': return this.deleteEntity(cmd.id);
      case 'clone': return this.cloneEntity(cmd.id, cmd.patch);
      case 'config': return this.updateConfig(cmd.patch);
      case 'batch': return (cmd.commands || []).forEach(c => this.execute(c));
      default: console.warn('Unknown command op:', cmd.op);
    }
  }

  // ------------------------------------------------------------------ entity CRUD

  createEntity(spec) {
    if (Object.keys(this.graph.entities).length >= BUDGET.maxEntities) {
      throw new Error('Entity limit reached');
    }
    if (spec.light && this.countLights() >= BUDGET.maxLights) {
      throw new Error('Light limit reached');
    }

    const id = spec.id || `e_${this.graph.nextId++}`;
    const entity = {
      id,
      type: spec.type || 'box',
      name: spec.name || null,
      tag: spec.tag || null,
      parent: spec.parent || null,
      transform: {
        position: spec.transform?.position || [0, 0, 0],
        rotation: spec.transform?.rotation || [0, 0, 0],
        scale: spec.transform?.scale || [1, 1, 1],
      },
      shape: spec.shape || null,
      material: spec.material || null,
      physics: spec.physics || null,
      light: spec.light || null,
      sound: spec.sound || null,
      components: spec.components || {},
      behaviors: spec.behaviors || [],
      data: spec.data || {},
    };

    this.graph.entities[id] = entity;
    this.buildNode(entity);
    return entity;
  }

  updateEntity(id, patch) {
    const entity = this.graph.entities[id];
    if (!entity) throw new Error(`Entity ${id} not found`);

    deepMerge(entity, patch);
    this.updateNode(entity, patch);
    return entity;
  }

  deleteEntity(id) {
    const entity = this.graph.entities[id];
    if (!entity) return;

    const node = this.nodes.get(id);
    if (node) { node.dispose(); this.nodes.delete(id); }
    delete this.graph.entities[id];

    // Delete children
    for (const e of Object.values(this.graph.entities)) {
      if (e.parent === id) this.deleteEntity(e.id);
    }
  }

  cloneEntity(id, patch) {
    const source = this.graph.entities[id];
    if (!source) throw new Error(`Entity ${id} not found`);
    const spec = JSON.parse(JSON.stringify(source));
    delete spec.id;
    if (patch) deepMerge(spec, patch);
    return this.createEntity(spec);
  }

  updateConfig(patch) {
    deepMerge(this.graph.config, patch);
    this.applyConfig(this.graph.config);
  }

  // ------------------------------------------------------------------ build Babylon nodes

  buildNode(entity) {
    let node;

    switch (entity.type) {
      case 'box':
        node = BABYLON.MeshBuilder.CreateBox(entity.id, boxOpts(entity.shape), this.scene);
        break;
      case 'sphere':
        node = BABYLON.MeshBuilder.CreateSphere(entity.id, sphereOpts(entity.shape), this.scene);
        break;
      case 'cylinder':
        node = BABYLON.MeshBuilder.CreateCylinder(entity.id, cylinderOpts(entity.shape), this.scene);
        break;
      case 'capsule':
        node = BABYLON.MeshBuilder.CreateCapsule(entity.id, capsuleOpts(entity.shape), this.scene);
        break;
      case 'plane':
        node = BABYLON.MeshBuilder.CreateGround(entity.id, planeOpts(entity.shape), this.scene);
        break;
      case 'light':
        node = this.buildLight(entity);
        break;
      case 'model':
        node = this.buildModelPlaceholder(entity);
        this.loadModel(entity);
        break;
      case 'mirror':
        node = this.buildMirror(entity);
        break;
      case 'spawn':
      case 'trigger':
        node = BABYLON.MeshBuilder.CreateBox(entity.id, { size: 1 }, this.scene);
        node.visibility = this.mode === 'edit' ? 0.3 : 0;
        if (entity.type === 'spawn') {
          const mat = new BABYLON.StandardMaterial(entity.id + '_mat', this.scene);
          mat.diffuseColor = new BABYLON.Color3(0.2, 0.8, 0.2);
          mat.alpha = 0.3;
          node.material = mat;
        } else {
          const mat = new BABYLON.StandardMaterial(entity.id + '_mat', this.scene);
          mat.diffuseColor = new BABYLON.Color3(0.8, 0.6, 0.2);
          mat.alpha = 0.3;
          node.material = mat;
        }
        break;
      default:
        node = BABYLON.MeshBuilder.CreateBox(entity.id, { size: 0.5 }, this.scene);
        break;
    }

    if (!node) return;

    this.nodes.set(entity.id, node);
    node.metadata = { entityId: entity.id };

    // Transform
    this.applyTransform(node, entity.transform);

    // Material (for meshes, not lights)
    if (entity.material && node.material !== undefined && entity.type !== 'light') {
      this.applyMaterial(node, entity);
    }

    // Physics
    if (entity.physics && entity.physics !== 'none' && entity.type !== 'light') {
      this.applyPhysics(node, entity);
    }

    // Shadows
    if (this.shadowGen && node instanceof BABYLON.AbstractMesh) {
      this.shadowGen.addShadowCaster(node);
      node.receiveShadows = true;
    }

    // Parent
    if (entity.parent && this.nodes.has(entity.parent)) {
      node.parent = this.nodes.get(entity.parent);
    }

    return node;
  }

  updateNode(entity, patch) {
    const node = this.nodes.get(entity.id);
    if (!node) return;

    if (patch.transform) this.applyTransform(node, entity.transform);
    if (patch.material) this.applyMaterial(node, entity);
    if (patch.shape) {
      // Rebuild for shape changes
      node.dispose();
      this.nodes.delete(entity.id);
      this.buildNode(entity);
    }
    if (patch.light && entity.type === 'light') {
      node.dispose();
      this.nodes.delete(entity.id);
      this.buildNode(entity);
    }
  }

  applyTransform(node, t) {
    if (!t) return;
    if (t.position) node.position = vec3(t.position);
    if (t.rotation) node.rotation = new BABYLON.Vector3(deg2rad(t.rotation[0]), deg2rad(t.rotation[1]), deg2rad(t.rotation[2]));
    if (t.scale) {
      if (typeof t.scale === 'number') node.scaling = new BABYLON.Vector3(t.scale, t.scale, t.scale);
      else node.scaling = vec3(t.scale);
    }
  }

  applyMaterial(node, entity) {
    const m = entity.material;
    if (!m) return;

    const matId = entity.id + '_mat';
    let mat = this.scene.getMaterialByName(matId);
    if (!mat) {
      mat = new BABYLON.StandardMaterial(matId, this.scene);
      node.material = mat;
    }

    if (m.color) mat.diffuseColor = hexToColor3(m.color);
    if (m.emissive) mat.emissiveColor = hexToColor3(m.emissive);
    if (m.opacity != null) mat.alpha = m.opacity;

    if (m.texture) {
      const url = this.resolveAsset(m.texture);
      if (url) mat.diffuseTexture = new BABYLON.Texture(url, this.scene);
      if (m.tile) {
        mat.diffuseTexture.uScale = m.tile[0];
        mat.diffuseTexture.vScale = m.tile[1];
      }
    }
    if (m.maps?.normal) {
      const url = this.resolveAsset(m.maps.normal);
      if (url) mat.bumpTexture = new BABYLON.Texture(url, this.scene);
    }
  }

  applyPhysics(node, entity) {
    if (!entity.physics || entity.physics === 'none' || entity.physics === 'trigger') return;
    const mass = entity.physics === 'static' ? 0 : 1;
    node.physicsImpostor = new BABYLON.PhysicsImpostor(
      node,
      BABYLON.PhysicsImpostor.BoxImpostor,
      { mass, restitution: 0.3, friction: 0.5 },
      this.scene
    );
  }

  buildLight(entity) {
    const l = entity.light || {};
    const t = entity.transform?.position || [0, 5, 0];
    let light;

    switch (l.type || 'point') {
      case 'point':
        light = new BABYLON.PointLight(entity.id, vec3(t), this.scene);
        if (l.range) light.range = l.range;
        break;
      case 'spot':
        light = new BABYLON.SpotLight(entity.id, vec3(t), vec3(l.direction || [0, -1, 0]), deg2rad(l.angle || 60), 2, this.scene);
        if (l.range) light.range = l.range;
        break;
      case 'directional':
        light = new BABYLON.DirectionalLight(entity.id, vec3(l.direction || [0, -1, 0]), this.scene);
        break;
    }

    if (light) {
      if (l.color) light.diffuse = hexToColor3(l.color);
      light.intensity = l.intensity ?? 1;
    }

    // Visible marker in edit mode
    if (this.mode === 'edit' && light) {
      const marker = BABYLON.MeshBuilder.CreateSphere(entity.id + '_marker', { diameter: 0.3 }, this.scene);
      marker.position = vec3(t);
      const mat = new BABYLON.StandardMaterial(entity.id + '_marker_mat', this.scene);
      mat.emissiveColor = hexToColor3(l.color || '#ffffff');
      mat.disableLighting = true;
      marker.material = mat;
      marker.metadata = { entityId: entity.id, isMarker: true };
      light._editorMarker = marker;
    }

    return light;
  }

  buildModelPlaceholder(entity) {
    const node = BABYLON.MeshBuilder.CreateBox(entity.id, { size: 1 }, this.scene);
    const mat = new BABYLON.StandardMaterial(entity.id + '_placeholder', this.scene);
    mat.diffuseColor = new BABYLON.Color3(0.5, 0.5, 0.5);
    mat.alpha = 0.5;
    mat.wireframe = true;
    node.material = mat;
    return node;
  }

  async loadModel(entity) {
    const assetName = entity.shape?.asset || entity.data?.asset;
    if (!assetName) return;
    const url = this.resolveAsset(assetName);
    if (!url) return;

    try {
      const result = await BABYLON.SceneLoader.ImportMeshAsync('', url, '', this.scene);
      const placeholder = this.nodes.get(entity.id);
      if (placeholder) { placeholder.dispose(); this.nodes.delete(entity.id); }

      const root = result.meshes[0];
      root.name = entity.id;
      root.metadata = { entityId: entity.id };
      this.nodes.set(entity.id, root);
      this.applyTransform(root, entity.transform);

      if (this.shadowGen) {
        for (const mesh of result.meshes) {
          if (mesh instanceof BABYLON.AbstractMesh) {
            this.shadowGen.addShadowCaster(mesh);
            mesh.receiveShadows = true;
          }
        }
      }
    } catch (e) {
      console.warn('Failed to load model:', assetName, e.message);
    }
  }

  resolveAsset(name) {
    if (!name) return null;
    if (name.startsWith('http')) return name;
    if (this.assetResolver) return this.assetResolver(name);
    return null;
  }

  // ------------------------------------------------------------------ entity picking & inspection

  setupPicking() {
    this._highlightLayer = new BABYLON.HighlightLayer('_select', this.scene);
    this._highlightLayer.outerGlow = true;
    this._highlightLayer.innerGlow = false;

    this.scene.onPointerDown = (evt, pickResult) => {
      if (evt.button !== 0) return;
      if (!pickResult.hit || !pickResult.pickedMesh) { this.deselect(); return; }

      let mesh = pickResult.pickedMesh;
      let entityId = mesh.metadata?.entityId;
      if (!entityId) {
        let p = mesh.parent;
        while (p && !p.metadata?.entityId) p = p.parent;
        entityId = p?.metadata?.entityId;
      }
      if (mesh.metadata?.isMarker) entityId = mesh.metadata.entityId;

      if (entityId && this.graph.entities[entityId]) {
        this.select(entityId);
      } else {
        this.deselect();
      }
    };
  }

  select(entityId) {
    if (this.selected === entityId) return;
    this.deselect();
    this.selected = entityId;

    const node = this.nodes.get(entityId);
    if (node && this._highlightLayer) {
      if (node instanceof BABYLON.AbstractMesh) {
        this._highlightLayer.addMesh(node, BABYLON.Color3.FromHexString('#4a9eff'));
      } else if (node.getChildMeshes) {
        for (const child of node.getChildMeshes()) {
          this._highlightLayer.addMesh(child, BABYLON.Color3.FromHexString('#4a9eff'));
        }
      }
    }

    if (this.onSelect) this.onSelect(entityId, this.graph.entities[entityId]);
  }

  deselect() {
    if (!this.selected) return;
    const prev = this.selected;
    this.selected = null;

    if (this._highlightLayer) this._highlightLayer.removeAllMeshes();
    if (this.onSelect) this.onSelect(null, null);
  }

  getEntityCode(entityId) {
    const entity = this.graph.entities[entityId];
    if (!entity) return null;
    return JSON.stringify(entity, null, 2);
  }

  updateEntityFromCode(entityId, code) {
    try {
      const parsed = JSON.parse(code);
      parsed.id = entityId;
      const old = this.graph.entities[entityId];
      if (!old) return { ok: false, error: 'Entity not found' };

      this.graph.entities[entityId] = parsed;
      const node = this.nodes.get(entityId);
      if (node) { node.dispose(); this.nodes.delete(entityId); }
      this.buildNode(parsed);

      if (this.onLocalChange) {
        this.onLocalChange([{ op: 'update', id: entityId, patch: parsed }]);
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // ------------------------------------------------------------------ queries

  countLights() {
    return Object.values(this.graph.entities).filter(e => e.type === 'light').length;
  }

  countPhysicsBodies() {
    return Object.values(this.graph.entities).filter(e => e.physics && e.physics !== 'none' && e.physics !== 'trigger').length;
  }

  getBudgetStatus() {
    const entityCount = Object.keys(this.graph.entities).length;
    return {
      entities: { used: entityCount, max: BUDGET.maxEntities, remaining: BUDGET.maxEntities - entityCount },
      lights: { used: this.countLights(), max: BUDGET.maxLights, remaining: BUDGET.maxLights - this.countLights() },
      physicsBodies: { used: this.countPhysicsBodies(), max: BUDGET.maxPhysicsBodies, remaining: BUDGET.maxPhysicsBodies - this.countPhysicsBodies() },
    };
  }

  getEntityList() {
    return Object.values(this.graph.entities).map(e => ({
      id: e.id, type: e.type, name: e.name, tag: e.tag,
      pos: e.transform.position,
    }));
  }

  findByTag(tag) {
    return Object.values(this.graph.entities).filter(e => e.tag === tag);
  }

  findByName(name) {
    return Object.values(this.graph.entities).find(e => e.name === name);
  }

  // ------------------------------------------------------------------ download beam (generation effect)

  startDownload(position, opts = {}) {
    const id = 'dl_' + (this.graph.nextId++);
    const pos = vec3(position);

    // Glow layer (shared, created once)
    if (!this._glowLayer) {
      this._glowLayer = new BABYLON.GlowLayer('_glow', this.scene, { blurKernelSize: 32 });
      this._glowLayer.intensity = 0.6;
    }

    // Semi-transparent placeholder box
    const box = BABYLON.MeshBuilder.CreateBox(id + '_box', { size: opts.size || 1 }, this.scene);
    box.position = pos.clone();
    const boxMat = new BABYLON.StandardMaterial(id + '_bm', this.scene);
    boxMat.emissiveColor = new BABYLON.Color3(0.6, 0.7, 0.9);
    boxMat.alpha = 0.12;
    boxMat.disableLighting = true;
    box.material = boxMat;
    box.isPickable = false;

    // Beam: thin cylinder from object up into the sky
    const beamH = 80;
    const beam = BABYLON.MeshBuilder.CreateCylinder(id + '_beam', { diameter: 0.06, height: beamH, tessellation: 8 }, this.scene);
    beam.position = new BABYLON.Vector3(pos.x, pos.y + beamH / 2, pos.z);
    const beamMat = new BABYLON.StandardMaterial(id + '_beamm', this.scene);
    beamMat.emissiveColor = new BABYLON.Color3(1, 1, 1);
    beamMat.alpha = 0.4;
    beamMat.disableLighting = true;
    beam.material = beamMat;
    beam.isPickable = false;
    this._glowLayer.addIncludedOnlyMesh(beam);

    // Progress bar background
    const barBg = BABYLON.MeshBuilder.CreateBox(id + '_bg', { width: 1.2, height: 0.06, depth: 0.02 }, this.scene);
    barBg.position = new BABYLON.Vector3(pos.x, pos.y + (opts.size || 1) * 0.5 + 0.4, pos.z);
    barBg.billboardMode = BABYLON.Mesh.BILLBOARDMODE_Y;
    const bgMat = new BABYLON.StandardMaterial(id + '_bgm', this.scene);
    bgMat.diffuseColor = new BABYLON.Color3(0.08, 0.08, 0.12);
    bgMat.alpha = 0.7;
    bgMat.disableLighting = true;
    barBg.material = bgMat;
    barBg.isPickable = false;

    // Progress bar fill
    const barFill = BABYLON.MeshBuilder.CreateBox(id + '_fill', { width: 1.18, height: 0.05, depth: 0.025 }, this.scene);
    barFill.position = barBg.position.clone();
    barFill.billboardMode = BABYLON.Mesh.BILLBOARDMODE_Y;
    barFill.setPivotPoint(new BABYLON.Vector3(-0.59, 0, 0));
    const fillMat = new BABYLON.StandardMaterial(id + '_fm', this.scene);
    fillMat.emissiveColor = new BABYLON.Color3(0.29, 0.58, 1);
    fillMat.disableLighting = true;
    barFill.material = fillMat;
    barFill.scaling.x = 0.01;
    barFill.isPickable = false;

    const dl = { id, box, beam, barBg, barFill, logs: [], progress: 0, label: opts.label || '', position: pos, size: opts.size || 1, _done: false };
    if (!this._downloads) this._downloads = new Map();
    this._downloads.set(id, dl);

    const obs = this.scene.onBeforeRenderObservable.add(() => {
      if (dl._done) { this.scene.onBeforeRenderObservable.remove(obs); return; }
      const t = performance.now() / 1000;
      const dt = this.bEngine.getDeltaTime() / 1000;

      // Pulse beam brightness with progress
      const base = 0.2 + dl.progress * 0.5;
      beamMat.alpha = base + 0.15 * Math.sin(t * 4);
      boxMat.alpha = 0.08 + 0.06 * Math.sin(t * 2.5) + dl.progress * 0.04;

      // Progress bar
      barFill.scaling.x = Math.max(0.01, dl.progress);

      // Animate log particles upward and fade
      for (let i = dl.logs.length - 1; i >= 0; i--) {
        const log = dl.logs[i];
        log.mesh.position.y += 0.3 * dt;
        log.age += dt;
        log.mesh.material.alpha = Math.max(0, 0.8 - log.age / 3);
        if (log.age > 3) { log.mesh.dispose(); dl.logs.splice(i, 1); }
      }
    });
    dl._obs = obs;

    const handle = {
      id,
      setProgress: (p) => { dl.progress = Math.min(1, Math.max(0, p)); },
      addLog: (text) => { this._spawnLog(dl, text); },
      complete: (entitySpec) => { this._finishDownload(dl, entitySpec); },
      cancel: () => { this._disposeDownload(dl); },
    };
    return handle;
  }

  _spawnLog(dl, text) {
    if (dl._done) return;
    const ox = (Math.random() - 0.5) * 0.6;
    const oy = Math.random() * 1.5;
    const plane = BABYLON.MeshBuilder.CreatePlane(dl.id + '_l' + dl.logs.length, { width: 2.4, height: 0.16 }, this.scene);
    plane.position = new BABYLON.Vector3(dl.position.x + dl.size * 0.6 + 0.3 + ox, dl.position.y + 0.3 + oy, dl.position.z);
    plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
    plane.isPickable = false;

    const dtex = new BABYLON.DynamicTexture(dl.id + '_dt' + dl.logs.length, { width: 512, height: 32 }, this.scene, false);
    dtex.hasAlpha = true;
    dtex.drawText(text, 4, 22, '14px monospace', '#c8d8ff', 'transparent', true);

    const mat = new BABYLON.StandardMaterial(dl.id + '_lm' + dl.logs.length, this.scene);
    mat.diffuseTexture = dtex;
    mat.emissiveColor = new BABYLON.Color3(0.5, 0.6, 0.8);
    mat.alpha = 0.8;
    mat.disableLighting = true;
    mat.backFaceCulling = false;
    plane.material = mat;

    dl.logs.push({ mesh: plane, age: 0 });
  }

  _finishDownload(dl, entitySpec) {
    if (dl._done) return;
    dl._done = true;

    let fadeT = 0;
    const obs = this.scene.onBeforeRenderObservable.add(() => {
      fadeT += this.bEngine.getDeltaTime() / 1000;

      // Flash bright at completion then fade out
      const flash = fadeT < 0.15 ? 1 : Math.max(0, 1 - (fadeT - 0.15) / 0.6);
      dl.beam.material.alpha = flash * 0.8;
      dl.beam.material.emissiveColor = new BABYLON.Color3(flash, flash, flash);
      dl.box.material.alpha = flash * 0.2;
      dl.barBg.material.alpha = (1 - fadeT / 0.8) * 0.7;
      dl.barFill.material.alpha = 1 - fadeT / 0.8;

      if (fadeT > 0.8) {
        this.scene.onBeforeRenderObservable.remove(obs);
        dl.beam.dispose(); dl.box.dispose(); dl.barBg.dispose(); dl.barFill.dispose();
        for (const l of dl.logs) l.mesh.dispose();
        dl.logs = [];
        if (dl._obs) this.scene.onBeforeRenderObservable.remove(dl._obs);
        this._downloads.delete(dl.id);
      }
    });

    if (entitySpec) {
      entitySpec.transform = entitySpec.transform || {};
      entitySpec.transform.position = entitySpec.transform.position || [dl.position.x, dl.position.y, dl.position.z];
      this.createEntity(entitySpec);
    }
  }

  _disposeDownload(dl) {
    if (dl._done) return;
    dl._done = true;
    dl.beam.dispose(); dl.box.dispose(); dl.barBg.dispose(); dl.barFill.dispose();
    for (const l of dl.logs) l.mesh.dispose();
    dl.logs = [];
    if (dl._obs) this.scene.onBeforeRenderObservable.remove(dl._obs);
    this._downloads.delete(dl.id);
  }

  // ------------------------------------------------------------------ mirror (player portal)

  buildMirror(entity) {
    const w = entity.shape?.width || 2;
    const h = entity.shape?.height || 3;

    // Frame
    const frame = new BABYLON.TransformNode(entity.id, this.scene);
    frame.metadata = { entityId: entity.id };

    // Mirror surface
    const mirror = BABYLON.MeshBuilder.CreatePlane(entity.id + '_surface', { width: w, height: h }, this.scene);
    mirror.parent = frame;
    mirror.metadata = { entityId: entity.id };

    const mirrorMat = new BABYLON.StandardMaterial(entity.id + '_mm', this.scene);
    const reflTex = new BABYLON.MirrorTexture(entity.id + '_rt', 512, this.scene, true);
    reflTex.mirrorPlane = new BABYLON.Plane(0, 0, 1, 0);
    reflTex.level = 0.8;
    reflTex.renderList = this.scene.meshes.filter(m => m !== mirror && !m.name.startsWith('dl_'));
    mirrorMat.reflectionTexture = reflTex;
    mirrorMat.diffuseColor = new BABYLON.Color3(0.05, 0.05, 0.08);
    mirrorMat.emissiveColor = new BABYLON.Color3(0.02, 0.04, 0.08);
    mirror.material = mirrorMat;

    // Decorative border (4 thin boxes)
    const bw = 0.06;
    const bc = new BABYLON.Color3(0.6, 0.65, 0.7);
    const bm = new BABYLON.StandardMaterial(entity.id + '_brd', this.scene);
    bm.diffuseColor = bc; bm.emissiveColor = new BABYLON.Color3(0.15, 0.15, 0.2);

    for (const [sx, sy, sw, sh] of [
      [0, h / 2 + bw / 2, w + bw * 2, bw],
      [0, -h / 2 - bw / 2, w + bw * 2, bw],
      [-w / 2 - bw / 2, 0, bw, h],
      [w / 2 + bw / 2, 0, bw, h],
    ]) {
      const seg = BABYLON.MeshBuilder.CreateBox(entity.id + '_b' + sx + sy, { width: sw, height: sh, depth: 0.04 }, this.scene);
      seg.parent = frame;
      seg.position = new BABYLON.Vector3(sx, sy, 0);
      seg.material = bm;
    }

    // Subtle glow pulse
    if (!this._glowLayer) {
      this._glowLayer = new BABYLON.GlowLayer('_glow', this.scene, { blurKernelSize: 32 });
      this._glowLayer.intensity = 0.6;
    }

    const obs = this.scene.onBeforeRenderObservable.add(() => {
      const t = performance.now() / 1000;
      bm.emissiveColor = new BABYLON.Color3(
        0.12 + 0.06 * Math.sin(t * 1.5),
        0.12 + 0.06 * Math.sin(t * 1.5 + 1),
        0.2 + 0.08 * Math.sin(t * 1.5 + 2)
      );
    });
    frame._mirrorObs = obs;
    frame._mirrorTex = reflTex;

    return frame;
  }
}

// ===================================================================== shape options

function boxOpts(shape) {
  if (!shape) return { size: 1 };
  if (shape.size && Array.isArray(shape.size)) return { width: shape.size[0], height: shape.size[1], depth: shape.size[2] };
  return { size: shape.size || 1 };
}

function sphereOpts(shape) {
  return { diameter: (shape?.radius || 0.5) * 2, segments: shape?.segments || 16 };
}

function cylinderOpts(shape) {
  return { diameter: (shape?.radius || 0.5) * 2, height: shape?.height || 1, tessellation: shape?.segments || 16 };
}

function capsuleOpts(shape) {
  return { radius: shape?.radius || 0.5, height: shape?.height || 2 };
}

function planeOpts(shape) {
  return { width: shape?.width || 10, height: shape?.depth || 10, subdivisions: shape?.subdivisions || 1 };
}

// ===================================================================== deep merge utility

function deepMerge(target, source) {
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key]) && target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) {
      deepMerge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}

// ===================================================================== export

window.HawkesEngine = HawkesEngine;
window.HawkesEngine.defaultScene = defaultScene;
window.HawkesEngine.BUDGET = BUDGET;
