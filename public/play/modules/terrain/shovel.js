// The shovel (H.tools 'shovel'): click digs where you look and throws the dirt beside the hole; shift+click (or R)
// piles dirt up. On a phone, Dig and Pile buttons. Every dig is shared with everyone playing (H.terrain edits).
// game.player.tool = 'shovel' or { type: 'shovel', radius: 1.4, depth: 0.7 } (a bigger shovel digs bigger holes).
/* global HawkesPlay, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = BABYLON;
  const T = window.HawkesTerrainCore;

  function viewModel(scene) {
    const root = new B.TransformNode('shovel', scene);
    const wood = new B.StandardMaterial('shovel-wood', scene); wood.diffuseColor = B.Color3.FromHexString('#8a5a32'); wood.specularColor = new B.Color3(0.05, 0.05, 0.05);
    const steel = new B.StandardMaterial('shovel-steel', scene); steel.diffuseColor = B.Color3.FromHexString('#9aa3ad'); steel.specularColor = new B.Color3(0.6, 0.6, 0.65);
    const handle = B.MeshBuilder.CreateCylinder('shovel-handle', { diameter: 0.045, height: 1.0, tessellation: 8 }, scene);
    handle.material = wood; handle.parent = root; handle.rotation.x = Math.PI / 2 - 0.5; handle.position.set(0, 0.05, 0.25);
    const blade = B.MeshBuilder.CreateBox('shovel-blade', { width: 0.24, height: 0.02, depth: 0.3 }, scene);
    blade.material = steel; blade.parent = root; blade.position.set(0, -0.2, 0.68); blade.rotation.x = -0.5;
    for (const m of [handle, blade]) { m.isPickable = false; m.metadata = { decor: true }; m.renderingGroupId = 1; }
    return root;
  }
  function touchButtons(state) {
    if (!H.touchUi) return;
    const wrap = document.createElement('div');
    wrap.className = 'terrain-touch';
    wrap.style.cssText = 'position:fixed;right:110px;bottom:max(30px,env(safe-area-inset-bottom));display:flex;gap:10px;z-index:5;';
    for (const [key, label] of [['g', 'Dig'], ['r', 'Pile']]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.style.cssText = 'width:66px;height:66px;border-radius:50%;border:1px solid rgba(255,255,255,.45);background:rgba(255,255,255,.14);color:#fff;font:600 15px/1 system-ui,sans-serif;touch-action:none;';
      H.bindTouchKey(b, key);
      wrap.appendChild(b);
    }
    document.body.appendChild(wrap);
    state.touch = wrap;
  }

  /** One shovelful: dig (and throw the dirt to the side) or pile, where the crosshair is on the ground. */
  function use(ctx, pile) {
    const g = ctx.game, t = H.terrain;
    if (!t || !t.active) { g.ui.message('Nothing to dig: this world has no terrain', 1.2); return false; }
    const reach = Number(ctx.opts.reach) || 6;
    const hit = g.aim(reach);
    if (!hit || !hit.entity || !hit.entity.isTerrain) { g.ui.message('Point the shovel at the ground', 0.8); return false; }
    const [x, , z] = hit.point;
    const r = Math.max(0.5, Number(ctx.opts.radius) || 1.4), d = Math.max(0.1, Number(ctx.opts.depth) || 0.7);
    const cam = H.world.scene.activeCamera;
    const f = cam.getDirection(B.Axis.Z);
    const side = (ctx.state.flip = !ctx.state.flip) ? 1 : -1;
    // Beside the hole, a bit to one side and toward you: where a shovelful lands.
    const len = Math.hypot(f.x, f.z) || 1;
    const fx = f.x / len, fz = f.z / len;
    const px = x + (fz * side * 1.0 - fx * 0.7) * r * 1.7, pz = z + (-fx * side * 1.0 - fz * 0.7) * r * 1.7;
    let edits;
    if (pile) edits = [['raise', r * 1.1, d * 0.8, x, z]];
    else {
      const pr = r * 1.25;
      const amount = (d * T.bumpVolume(r)) / T.bumpVolume(pr);
      edits = [['dig', r, d, x, z], ['raise', pr, amount, px, pz], ['paint', r * 0.9, 1, x, z], ['paint', pr * 0.9, 1, px, pz]];
    }
    t._share(edits);
    g.burst([x, hit.point[1] + 0.1, z], { color: '#8a6a48', count: 14, speed: 3, size: 0.12, life: 0.5 });
    if (g.sound) g.sound(pile ? 'dirt-pile' : 'dig');
    ctx.state.swing = 1;
    return true;
  }

  H.tools.register('shovel', {
    title: 'Shovel: click digs, shift+click (or R) piles dirt',
    kind: 'tool',
    use,
    equip(ctx) {
      ctx.state.cool = 0; ctx.state.swing = 0;
      ctx.state.mesh = viewModel(H.world.scene);
      touchButtons(ctx.state);
      ctx.game.ui.message(H.touchUi ? 'Shovel: Dig and Pile buttons' : 'Shovel: click digs, shift+click piles', 1.6);
    },
    unequip(ctx) { if (ctx.state.mesh) ctx.state.mesh.dispose(false, true); if (ctx.state.touch) ctx.state.touch.remove(); },
    step(dt, ctx) {
      const input = H.input, s = ctx.state;
      s.cool = Math.max(0, s.cool - dt);
      if (s.cool > 0 || H.world.paused) return;
      const click = input.mouse.pressed && (input.mouse.locked || (H.world.player && H.world.player.mouse === 'free'));
      // Holding G / R (or the phone's Dig / Pile) keeps digging, a shovelful at a time.
      const pile = input.held.has('r') || (click && input.held.has('shift'));
      const dig = input.held.has('g') || (click && !input.held.has('shift'));
      if ((pile || dig) && use(ctx, pile)) s.cool = 0.35;
    },
    frame(dt, ctx) {
      const s = ctx.state, w = H.world;
      if (!s.mesh || !w) return;
      s.mesh.parent = w.scene.activeCamera;
      s.mesh.setEnabled(Boolean(w.player && w.player._view === 'first'));
      s.swing = Math.max(0, s.swing - dt * 4);
      const k = Math.sin(s.swing * Math.PI);
      s.mesh.position.set(0.32, -0.32 - k * 0.12, 0.45 + k * 0.25);
      s.mesh.rotation.set(0.2 + k * 0.9, -0.15, 0.1);
    },
  });
})();
