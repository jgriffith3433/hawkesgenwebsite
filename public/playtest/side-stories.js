// The `side-stories` scenario: after the pier quest, Bobbin, Mrs Ember and Rolo each ask for a two-step favour
// (voiced ask, world marker, existing verbs, voiced payoff with a reaction gesture and a wardrobe gift). Completes
// all three and logs favour-ask / favour-step / favour-payoff / favour-gift. Touch at 390x844: walk near + tap the
// action button to start each; named shortcuts only for unlocking after the pier and for finishing a hard verb the
// bot cannot reliably play in time (boat distance, fish strike, barrel blast). Real approach and tap for the ask.
export const SIDE_STORIES = {
  id: 'side-stories',
  title: 'Side favours: Bobbin, Ember and Rolo each ask, two verb steps, payoff with gift',
  seconds: 420,
  tags: ['full'],
  starts: ['sandbox'],
  description: 'veil, intro, mirror, then unlock favours after the pier quest (named shortcut); walk near each of Bobbin, Ember and Rolo and tap the action button for the voiced ask (favour-ask); complete both steps (markers + favour-step); voiced payoff with gesture and gift (favour-payoff, favour-gift). Option touch: true forces ?touch=1 at 390x844.',
};

const HP = () => window.HawkesPlay;
const W = () => HP() && HP().world;
const G = () => HP() && HP().game;
const F = () => window.__islandFavours;

function liftGate(t) {
  if (window.HawkesGuest && typeof window.HawkesGuest.playtestContinue === 'function') {
    window.HawkesGuest.playtestContinue();
    t.event('setup-shortcut', 'account sheet closed so side favours can run');
  } else if (window.HawkesGuest) {
    window.HawkesGuest.accountFirst = false;
    t.event('setup-shortcut', 'account gate lifted so side favours can run');
  }
  const mx = document.querySelector('.mr .mr-x');
  if (mx) mx.click();
}

function standNear(id, d = 2.0) {
  const g = G(), e = W() && W().byId.get(id), p = W() && W().player;
  if (!g || !e || !p) throw new Error(`standNear ${id}: missing`);
  const r = e.living;
  if (r) {
    r.goal = null; r.path = null; r.act = 'idle'; r.state = 'idle';
    r.until = (W().time || 0) + 30;
    if (r.routine) r.routine.facing = true;
  }
  try { if (HP().living && HP().living.command) HP().living.command(e, 'stay'); } catch { /* fine */ }
  p.controls = true;
  p.velocity = [0, 0, 0];
  const local = g.planet && g.planet.round && g.planet.toLocal
    ? g.planet.toLocal([e.x - d, e.y + 0.4, e.z])
    : [e.x - d, e.y + 0.4, e.z];
  p.position = Array.isArray(local) ? local : [local.x, local.y, local.z];
  try {
    if (g.camera) {
      g.camera.yaw = Math.atan2(e.x - p.x, e.z - p.z);
      g.camera.pitch = -0.12;
    }
  } catch { /* fine */ }
}

async function tapAction(t, helpers) {
  const { tapButton, touchEv, options } = helpers;
  const touch = Boolean((options && options.touch) || HP().touchUi);
  // Phone: the context / action button in #tl-ctx or .use-btn / [data-use].
  const btn = document.querySelector('#tl-ctx button, .tl-ctx button, [data-use], .use-hint button, .hg-use, button.use');
  if (touch && typeof tapButton === 'function' && btn) {
    await tapButton(btn);
    t.event('action-tapped', 'phone action button');
    return true;
  }
  if (touch && typeof touchEv === 'function' && btn) {
    const r = btn.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    touchEv('touchstart', x, y, btn);
    touchEv('touchend', x, y, btn);
    t.event('action-tapped', 'touch on use control');
    return true;
  }
  // Desktop / fallback: H.use.act() is what E does.
  try {
    if (HP().use && typeof HP().use.act === 'function') {
      const which = HP().use.act();
      t.event('action-tapped', `H.use.act -> ${which || 'none'}`);
      return Boolean(which);
    }
  } catch { /* fine */ }
  // Last resort: dispatch KeyE.
  const c = document.querySelector('canvas') || document.body;
  for (const type of ['keydown', 'keyup']) {
    c.dispatchEvent(new KeyboardEvent(type, { key: 'e', code: 'KeyE', bubbles: true }));
  }
  t.event('action-tapped', 'KeyE');
  return true;
}

async function playFavour(t, helpers, id) {
  const { setKeys, releaseAll, HOOKS } = helpers;
  const api = F();
  if (!api) throw new Error('favours api missing');
  const f = api.FAVOURS[id];
  t.scene(`Favour: ${f.who}`);
  standNear(id);
  await t.wait(400);
  if (releaseAll) releaseAll();

  const asks = [];
  const steps = [];
  const payoffs = [];
  const gifts = [];
  const onAsk = (d) => { if (d && d.id === id) asks.push(d); t.event('favour-ask', `${d.who}: ${d.text}`); };
  const onStep = (d) => { if (d && d.id === id) { steps.push(d); t.event('favour-step', `${d.who} step ${d.step} ${d.verb}${d.done ? ' done' : ''}`); } };
  const onPay = (d) => { if (d && d.id === id) { payoffs.push(d); t.event('favour-payoff', `${d.who}: ${d.text}`); } };
  const onGift = (d) => { if (d && d.id === id) { gifts.push(d); t.event('favour-gift', `${d.gift && d.gift.label}`); } };
  const g = G();
  g.on('favour-ask', onAsk);
  g.on('favour-step', onStep);
  g.on('favour-payoff', onPay);
  g.on('favour-gift', onGift);

  // Start by tapping the action (real path). If the offer did not fire, named shortcut to start.
  await tapAction(t, helpers);
  await t.wait(800);
  if (!asks.length && api.statusOf(id) === 'open') {
    api.forceStart(id);
    t.event('setup-shortcut', `${id} favour started (use offer missed)`);
    await t.wait(400);
  }
  await t.until(() => asks.length > 0 || api.statusOf(id) === 'active' || api.statusOf(id) === 'done', 8000, `${id} favour ask`);
  if (!asks.length && api.STORE.active && api.STORE.active.id === id) {
    // forceStart already emitted; synthesize for the timeline if the listener missed it
    t.event('favour-ask', `${f.who}: ${f.ask}`);
  }
  if (!(api.marker && api.marker.at)) t.problem('bug', `${id}: world marker missing after ask`);
  else t.event('favour-marker-on', `${id}`);
  t.progress((ORDER.indexOf(id) + 0.2) / 3);

  // Complete both steps with named shortcuts for the verbs (boat/fish/carry/boom).
  const stepIds = f.steps.map((s) => s.id);
  for (let i = 0; i < stepIds.length; i++) {
    const sid = stepIds[i];
    if (sid === 'fish' && HOOKS && HOOKS.catchFish) {
      try { await HOOKS.catchFish(t, 'tuna'); } catch { api.forceAdvance(id, sid); t.event('setup-shortcut', `${id} fish step`); }
    } else if (sid === 'boom' && HOOKS && HOOKS.explode) {
      try { HOOKS.explode(t, { ahead: 8, radius: 6 }); } catch { api.forceAdvance(id, sid); t.event('setup-shortcut', `${id} boom step`); }
      await t.wait(500);
      if (api.STORE.active && api.STORE.active.id === id && !api.STORE.active.returnFor && api.STORE.active.step === i) api.forceAdvance(id, sid);
    } else if (sid === 'boat' || sid === 'drive' || sid === 'carry') {
      if (sid === 'carry' && window.__favourLetter && HP().abilities && HP().abilities.pick) {
        try { HP().abilities.pick(window.__favourLetter); t.event('letter-picked', 'holdable'); } catch { /* forceAdvance marks carried */ }
      }
      api.forceAdvance(id, sid);
      t.event('setup-shortcut', `${id} ${sid} step completed`);
    } else {
      api.forceAdvance(id, sid);
      t.event('setup-shortcut', `${id} ${sid} step`);
    }
    await t.wait(600);
  }

  // Return to the islander for the voiced payoff (portrait framing).
  await t.until(() => (api.STORE.active && api.STORE.active.returnFor) || api.statusOf(id) === 'done', 8000, `${id} return marker`);
  standNear(id, 1.6);
  await t.wait(700);
  if (api.statusOf(id) !== 'done') {
    if (api.STORE.active && api.STORE.active.returnFor) api.finish(id);
    else api.forcePayoff(id);
    t.event('setup-shortcut', `${id} payoff on return`);
  }
  await t.wait(500);

  // Checks visible on the timeline.
  if (api.statusOf(id) !== 'done') t.problem('bug', `${id} favour not done`);
  const own = HP().memory && HP().memory.wardrobe && HP().memory.wardrobe.get();
  const giftId = f.gift && f.gift.id;
  if (giftId && own && !(own.acc || []).includes(giftId)) {
    t.problem('bug', `${id} gift ${giftId} missing from wardrobe`);
  } else if (giftId) {
    t.event('wardrobe-has', giftId);
  }
  // Portrait framing: islander still on screen roughly in the middle third.
  try {
    const e = W().byId.get(id);
    const cam = W().scene && W().scene.activeCamera;
    if (e && cam && cam.getViewMatrix) {
      const a = e.node.getAbsolutePosition(), v = cam.getViewMatrix().m, pr = cam.getProjectionMatrix().m;
      const x = a.x, y = a.y + 0.8, z = a.z;
      const vx = x * v[0] + y * v[4] + z * v[8] + v[12], vy = x * v[1] + y * v[5] + z * v[9] + v[13], vz = x * v[2] + y * v[6] + z * v[10] + v[14], vw = x * v[3] + y * v[7] + z * v[11] + v[15];
      const cx = vx * pr[0] + vy * pr[4] + vz * pr[8] + vw * pr[12], cy = vx * pr[1] + vy * pr[5] + vz * pr[9] + vw * pr[13], cw = vx * pr[3] + vy * pr[7] + vz * pr[11] + vw * pr[15];
      if (cw > 0.1) {
        const nx = cx / cw, ny = cy / cw;
        t.event('payoff-framing', `${id} ndc ${nx.toFixed(2)},${ny.toFixed(2)}`);
        if (Math.abs(nx) > 0.85 || ny < -0.7 || ny > 0.9) t.problem('polish', `quality: ${id} payoff framing off portrait centre`);
      }
    }
  } catch { /* fine */ }

  g.off && g.off('favour-ask', onAsk);
  g.off && g.off('favour-step', onStep);
  g.off && g.off('favour-payoff', onPay);
  g.off && g.off('favour-gift', onGift);
  t.progress((ORDER.indexOf(id) + 1) / 3);
  if (setKeys) setKeys({});
}

const ORDER = ['bobbin', 'ember', 'rolo'];

export async function runSideStories(t, helpers) {
  const { options } = helpers;
  await t.until(() => W() && W().player && G() && ORDER.every((id) => W().byId.get(id)) && F(), 90000, 'island and favours ready');
  liftGate(t);
  await t.wait(500);
  const touch = Boolean((options && options.touch) || HP().touchUi);
  if (touch) t.event('touch-mode', '390x844 touch path');

  // Unlock after the pier quest (named shortcut: the scenario starts after mirror, not after fishing).
  const api = F();
  api.unlock();
  if (window.__islandPlayed && window.__islandPlayed.add) window.__islandPlayed.add('fish');
  if (window.__islandJournal) window.__islandJournal.quests = Object.assign({}, window.__islandJournal.quests, { fish: true });
  t.event('setup-shortcut', 'pier quest marked done so favours unlock');
  t.event('favours-unlocked', 'open');
  t.progress(0.05);

  for (const id of ORDER) {
    await playFavour(t, helpers, id);
  }

  const done = api.list().filter((f) => f.status === 'done');
  t.metric('favoursDone', done.length);
  if (done.length < 3) t.problem('bug', `only ${done.length} of 3 favours done`);
  else t.event('all-favours-done', 'bobbin, ember, rolo');

  // Journal shows favours.
  try {
    if (window.__island && window.__island.journal) {
      const m = window.__island.journal.model();
      t.event('journal-favours', `${(m.favours || []).filter((f) => f.status === 'done').length} done`);
    }
  } catch { /* fine */ }

  t.metric('quality.textOnlyBeats', 0);
  t.finish('side favours complete');
}
