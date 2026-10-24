// Events, part 3: quests, on top of the rules. "The soul of the game": people and AI friends ask for help, the player
// says yes, the steps show in a quest log (phone-friendly), markers and an arrow point the way, and finishing one
// rewards and celebrates. Quests live in scene.json `config.quests` (the assistant writes them from words) or come from
// scripts (game.events.quests.add). Givers talk with free phrasebook lines only (no paid AI talk).
//
//   { "id": "sheep", "title": "Lost sheep", "giver": "Max", "text": "My sheep ran off...",
//     "steps": [ { "text": "Find the lost sheep", "goal": { "find": "lost-sheep", "count": 5 } },
//                { "text": "Bring them to the barn", "goal": { "bring": "lost-sheep", "count": 5, "to": "Barn" } },
//                { "goal": { "talk": "Max" } } ],
//     "setup": [ { "spawn": "sheep", "count": 5, "at": { "at": [30, 0, 30], "radius": 15 }, "tag": "lost-sheep" } ],
//     "reward": { "score": 50, "give": "lasso", "message": "Max gives you his old lasso" } }
//
// Shared: everyone playing works on the same quests (the host keeps them; everyone sees the log).
/* global HawkesPlay, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = BABYLON;
  const E = H.events;
  const W = () => H.world;
  const G = () => H.game;
  const { num, lower, arr, clone } = E;

  // ------------------------------------------------------------------ per world
  let Q = null; // { defs: Map, st: { [id]: state }, tracked, ui: {}, hostSeen: Map, nextPoll, marks }
  const live = () => (Q && E.live() && Q.s === E.state ? Q : null);
  E.setupHooks.push((g, s) => {
    Q = { s, defs: new Map(), order: [], st: {}, tracked: null, ui: {}, found: new Map(), nextPoll: 0, marks: { meshes: [], arrow: null, givers: new Map() }, nextUi: 0, open: false, dialog: null };
    try { Object.defineProperty(g.events, 'quests', { value: api(), enumerable: true, configurable: true }); } catch { /* frozen */ }
  });
  E.teardownHooks.push(() => { if (!Q) return; disposeMarks(); for (const x of Object.values(Q.ui)) try { x.remove(); } catch { /* gone */ } Q.ui = {}; closeDialog(); });

  // ------------------------------------------------------------------ quests and goals, in one shape
  const GOALS = ['collect', 'find', 'reach', 'talk', 'catch', 'drive', 'defeat', 'kill', 'bring', 'herd', 'build', 'deliver', 'survive', 'until', 'use', 'have', 'event', 'var'];
  function normGoal(g) {
    if (!g || typeof g !== 'object') return null;
    for (const k of GOALS) if (k in g) {
      const type = k === 'kill' ? 'defeat' : k === 'herd' || k === 'build' ? 'bring' : k;
      return { ...g, type, what: g[k], count: type === 'survive' ? Math.max(1, Math.round(num(g[k], 60))) : Math.max(1, Math.floor(num(g.count, 1))) };
    }
    return null;
  }
  function goalText(g) {
    if (g.text) return g.text;
    const n = g.count > 1 ? `${g.count} ` : '';
    const w = (x) => String(x === true || x === undefined ? 'one' : x).replace(/-/g, ' ');
    switch (g.type) {
      case 'collect': return `Collect ${n}${w(g.what)}`;
      case 'find': return `Find ${n}${w(g.what)}`;
      case 'reach': return `Go to ${w(g.what)}`;
      case 'talk': return `Talk to ${w(g.what)}`;
      case 'catch': return g.what === true || lower(g.what) === 'any' || lower(g.what) === 'fish' ? `Catch ${n || 'a '}fish` : `Catch ${n}${w(g.what)}`;
      case 'drive': return g.to ? `Drive ${g.what === true || lower(g.what) === 'any' ? '' : `the ${w(g.what)} `}to ${w(g.to)}` : `Get in ${g.what === true || lower(g.what) === 'any' ? 'a vehicle' : `the ${w(g.what)}`}`;
      case 'defeat': return `Defeat ${n}${w(g.what)}`;
      case 'bring': return `Bring ${n}${w(g.what)} to ${w(g.to)}`;
      case 'deliver': return `Deliver ${n}${w(g.what)} to ${w(g.to)}`;
      case 'survive': return `Survive ${Math.round(num(g.what, 60))} seconds`;
      case 'until': return `Survive until ${typeof g.what === 'number' ? `${g.what}:00` : w(g.what)}`;
      case 'use': return g.label || `Use the ${w(g.what)}`;
      case 'have': return `Have ${n}${w(g.what)}`;
      case 'event': return `${w(g.what)}${g.count > 1 ? ` (${g.count})` : ''}`;
      case 'var': return `${w(g.what)}`;
      default: return 'Do it';
    }
  }
  function normQuest(raw) {
    if (!raw || typeof raw !== 'object' || !raw.id && !raw.title) throw new Error('a quest needs an id (or a title)');
    const id = String(raw.id || lower(raw.title).replace(/[^a-z0-9]+/g, '-'));
    const steps = arr(raw.steps ?? (raw.goal || raw.goals ? [{ goal: raw.goal, goals: raw.goals, text: raw.task }] : [])).map((s, i) => {
      const goals = arr(s.goals ?? s.goal ?? (GOALS.some((k) => k in s) ? s : null)).map(normGoal).filter(Boolean);
      return { id: String(s.id || `s${i + 1}`), text: s.text || (goals.length === 1 ? goalText(goals[0]) : goals.map(goalText).join(', ')), goals, any: Boolean(s.any), optional: Boolean(s.optional), next: s.next, choice: Array.isArray(s.choice) ? s.choice : null, do: arr(s.do ?? s.start), done: arr(s.done ?? s.then), reward: s.reward || null, marker: s.marker, line: s.line || s.say || null };
    });
    return {
      id, title: String(raw.title || id), giver: raw.giver ?? null, text: String(raw.text || raw.description || ''), lines: raw.lines || {},
      auto: raw.auto !== undefined ? Boolean(raw.auto) : raw.start === true || raw.giver === undefined || raw.giver === null, requires: arr(raw.requires ?? raw.after),
      steps, setup: arr(raw.setup), reward: raw.reward || null, fail: arr(raw.onFail ?? raw.failDo), seconds: num(raw.seconds ?? raw.timeLimit, 0),
      repeatable: Boolean(raw.repeatable), marker: raw.marker !== false, raw,
    };
  }

  // ------------------------------------------------------------------ the state (the host's; everyone gets a copy)
  function stOf(id) {
    const d = Q.defs.get(id);
    if (!d) return null;
    if (!Q.st[id]) Q.st[id] = { state: d.requires.every((r) => Q.st[r] && Q.st[r].state === 'done') ? 'available' : 'locked', step: null, side: [], prog: {}, doneSteps: [], t0: 0, start: 0 };
    return Q.st[id];
  }
  function stateOf(id) {
    if (!live() || !Q.defs.has(String(id))) return 'none';
    const s = Q.st[String(id)];
    if (s) return s.state;
    const d = Q.defs.get(String(id));
    return d.requires.every((r) => Q.st[r] && Q.st[r].state === 'done') ? 'available' : 'locked';
  }
  const stepOf = (d, sid) => d.steps.find((s) => s.id === sid) || null;
  const fx = E.syncAction('quests:fx', (d) => effects(d));
  function announce(id, state, extra = {}) {
    const d = Q.defs.get(id);
    fx({ id, state, title: d ? d.title : id, ...extra });
  }
  /** The host starts a quest (for `who`, who said yes). */
  function startQuest(id, who) {
    const d = Q.defs.get(String(id));
    if (!d || !E.net.host) return false;
    const s = stOf(d.id);
    if (s.state === 'active' || (s.state === 'done' && !d.repeatable)) return false;
    Object.assign(s, { state: 'active', side: [], prog: {}, doneSteps: [], start: W().time, by: who || E.meWho() });
    const ctx = { who: s.by, data: { quest: d.id } };
    if (d.setup.length) E.runSeq(d.setup, ctx);
    announce(d.id, 'start', { who: s.by.name });
    if (d.steps.length) enterStep(d, s, d.steps[0].id, ctx);
    else finishQuest(d, s);
    return true;
  }
  function enterStep(d, s, sid, ctx) {
    const st = stepOf(d, sid);
    if (!st) { finishQuest(d, s); return; }
    if (st.optional) {
      if (!s.side.includes(sid)) s.side.push(sid);
      s.prog[sid] = s.prog[sid] || {};
      s[`t_${sid}`] = W().time;
      if (st.do.length) E.runSeq(st.do, ctx);
      const i = d.steps.indexOf(st);
      const nx = d.steps[i + 1];
      if (nx) enterStep(d, s, nx.id, ctx); else finishQuest(d, s);
      return;
    }
    s.step = sid;
    s.prog[sid] = {};
    s.t0 = W().time;
    if (st.do.length) E.runSeq(st.do, ctx);
    if (st.line) E.perform({ say: st.line, by: d.giver || 'player' }, ctx);
    G().emit('quest', { id: d.id, state: 'step', step: sid, title: d.title });
    checkStep(d, s, sid);
  }
  function goalDone(d, s, sid, gi) { const st = stepOf(d, sid); const g = st.goals[gi]; return (s.prog[sid] && s.prog[sid][gi] || 0) >= g.count; }
  function progress(d, s, sid, gi, value, set = false) {
    if (!s.prog[sid]) s.prog[sid] = {};
    const st = stepOf(d, sid), g = st.goals[gi];
    const before = s.prog[sid][gi] || 0;
    const v = Math.max(0, set ? value : before + value);
    if (v === before) return;
    s.prog[sid][gi] = Math.min(g.count, v);
    if (s.prog[sid][gi] >= g.count && before < g.count) {
      if (g.reward) giveReward(g.reward, s.by);
      if (st.goals.length > 1 || st.optional) fx({ id: d.id, state: 'goal', title: d.title, text: goalText(g) });
    }
    checkStep(d, s, sid, gi);
  }
  function checkStep(d, s, sid, lastGoal) {
    const st = stepOf(d, sid);
    if (!st || s.state !== 'active') return;
    if (st.choice) return; // a choice: the giver's dialog decides
    if (!st.goals.length) { completeStep(d, s, sid, null); return; }
    const req = st.goals.map((g, i) => i).filter((i) => !st.goals[i].optional);
    const pool = req.length ? req : st.goals.map((g, i) => i);
    const isDone = (i) => goalDone(d, s, sid, i);
    if (!(st.any ? pool.some(isDone) : pool.every(isDone))) return;
    let next = null;
    if (st.any) { const i = lastGoal !== undefined && pool.includes(lastGoal) && isDone(lastGoal) ? lastGoal : pool.find(isDone); if (i !== undefined && st.goals[i].next) next = st.goals[i].next; }
    completeStep(d, s, sid, next);
  }
  function completeStep(d, s, sid, next) {
    const st = stepOf(d, sid);
    const ctx = { who: s.by || E.meWho(), data: { quest: d.id, step: sid } };
    if (!s.doneSteps.includes(sid)) s.doneSteps.push(sid);
    if (st.done.length) E.runSeq(st.done, ctx);
    if (st.reward) giveReward(st.reward, s.by);
    if (st.optional) { s.side = s.side.filter((x) => x !== sid); fx({ id: d.id, state: 'side', title: d.title, text: st.text }); return; }
    G().emit('quest', { id: d.id, state: 'stepdone', step: sid, title: d.title });
    s.step = null;
    const target = next ?? st.next;
    if (target === 'end' || target === 'done' || target === 'complete') { finishQuest(d, s); return; }
    if (target === 'fail') { failQuest(d, s); return; }
    const i = d.steps.indexOf(st);
    const nx = target ? stepOf(d, String(target)) : d.steps[i + 1];
    if (!nx) { finishQuest(d, s); return; }
    fx({ id: d.id, state: 'step', title: d.title, text: st.text });
    enterStep(d, s, nx.id, ctx);
  }
  function finishQuest(d, s) {
    if (s.state !== 'active') return;
    s.state = 'done';
    s.step = null;
    s.side = [];
    s.end = W().time;
    const ctx = { who: s.by || E.meWho(), data: { quest: d.id } };
    const text = d.reward ? rewardText(d.reward) : '';
    if (d.reward) giveReward(d.reward, s.by);
    if (d.lines.done && d.giver) E.perform({ say: d.lines.done, by: d.giver }, ctx);
    announce(d.id, 'done', { reward: text });
    // Quests that waited for this one can be taken now.
    for (const o of Q.defs.values()) {
      if (!o.requires.includes(d.id)) continue;
      const os = stOf(o.id);
      if ((os.state === 'locked' || os.state === 'available') && o.requires.every((r) => Q.st[r] && Q.st[r].state === 'done')) { os.state = 'available'; if (o.auto) startQuest(o.id, s.by); }
    }
    if (d.repeatable) G().after(1, () => { if (live() && Q.st[d.id] && Q.st[d.id].state === 'done') Q.st[d.id].state = 'available'; });
  }
  function failQuest(d, s) {
    if (s.state !== 'active') return;
    s.state = 'failed';
    s.step = null;
    s.side = [];
    const ctx = { who: s.by || E.meWho(), data: { quest: d.id } };
    if (d.fail.length) E.runSeq(d.fail, ctx);
    announce(d.id, 'failed');
    if (d.repeatable || d.raw.retry !== false) G().after(2, () => { if (live() && Q.st[d.id] && Q.st[d.id].state === 'failed') Q.st[d.id].state = 'available'; });
  }
  function rewardText(r) {
    if (!r) return '';
    if (r.text || r.message) return String(r.text || r.message);
    const parts = [];
    if (r.score) parts.push(`+${r.score} points`);
    for (const g of arr(r.give)) parts.push(typeof g === 'string' ? g.replace(/-/g, ' ') : `${g.count || 1} ${g.item || g.give}`);
    return parts.join(' · ');
  }
  function giveReward(r, who) {
    const ctx = { who: who || E.meWho(), data: null };
    const acts = [];
    if (r.score) acts.push({ score: num(r.score, 0) });
    for (const g of arr(r.give)) acts.push(typeof g === 'string' ? { give: g, count: num(r.count, 1) } : { give: g.item || g.give, count: num(g.count, 1) });
    if (r.var && typeof r.var === 'object') for (const [k, v] of Object.entries(r.var)) acts.push({ var: k, add: num(v, 1) });
    for (const id of arr(r.enable ?? r.unlock)) if (Q.defs.has(String(id))) { const os = stOf(String(id)); if (os.state === 'locked') os.state = 'available'; } else acts.push({ enable: id });
    acts.push(...arr(r.do));
    if (acts.length) E.runSeq(acts, ctx);
  }

  // ------------------------------------------------------------------ what everyone sees: banners, fanfare, the log
  function effects(d) {
    if (!live()) return;
    const g = G();
    if (d.state === 'start') { E.banner(`New quest: ${d.title}`, d.who && d.who !== E.myName() ? `${d.who} took it` : 'Open the quest log to see the steps', 2.6, 'quest'); E.tone([[784, 0, 0.18, 'triangle'], [1046, 0.14, 0.4, 'triangle']], { volume: 0.16 }); if (!Q.tracked) Q.tracked = d.id; }
    else if (d.state === 'step' || d.state === 'goal' || d.state === 'side') { E.toast(`✓ ${d.text}`, 2); E.tone([[988, 0, 0.12, 'triangle'], [1318, 0.1, 0.25, 'triangle']], { volume: 0.12 }); }
    else if (d.state === 'done') {
      E.banner('Quest complete!', `${d.title}${d.reward ? ` · ${d.reward}` : ''}`, 3.6, 'quest');
      E.sound('fanfare');
      const p = W().player;
      if (p) { try { g.burst([p.x, p.y + 1.2, p.z], { color: '#ffd84a', count: 60, speed: 6, size: 0.3 }); g.burst([p.x, p.y + 1.6, p.z], { color: '#7dffa0', count: 40, speed: 5, size: 0.25 }); g.camera.shake(0.12, 0.25); } catch { /* fine */ } }
      if (Q.tracked === d.id) Q.tracked = null;
    } else if (d.state === 'failed') { E.banner('Quest failed', d.title, 3, 'lose'); E.sound('lose'); }
    if (d.state === 'start' || d.state === 'done' || d.state === 'failed') g.emit('quest', { id: d.id, state: d.state, title: d.title });
    Q.dirty = true;
  }

  // ------------------------------------------------------------------ asking the host (accept, talk, choose)
  const ask = E.syncAction('quests:ask', (d, o) => {
    if (!o.authoritative || !live()) return;
    const q = Q.defs.get(String(d.q));
    if (!q) return;
    const s = stOf(q.id);
    const who = d.who || E.meWho();
    if (d.op === 'accept') { if (startQuest(q.id, who) && q.lines.accept && q.giver) E.perform({ say: q.lines.accept, by: q.giver }, { who }); return; }
    if (s.state !== 'active') return;
    const sid = d.step;
    const st = stepOf(q, sid);
    if (!st || (s.step !== sid && !s.side.includes(sid))) return;
    if (d.op === 'talk') { st.goals.forEach((g, i) => { if (g.type === 'talk' && (d.goal === undefined || d.goal === i)) progress(q, s, sid, i, g.count, true); }); return; }
    if (d.op === 'choose' && st.choice) {
      const c = st.choice[num(d.i, 0)];
      if (!c) return;
      if (c.do) E.runSeq(arr(c.do), { who, data: { quest: q.id } });
      if (c.reward) giveReward(c.reward, who);
      completeStep(q, s, sid, c.next ?? null);
    }
  });
  const askHost = (d) => ask({ ...d, who: E.meWho() });

  // ------------------------------------------------------------------ goals that are events: compiled to rules
  function compile(d) {
    for (const st of d.steps) st.goals.forEach((g, gi) => {
      let when = null;
      if (g.type === 'catch') when = { event: 'catch', ...(g.what === true || ['any', 'fish'].includes(lower(g.what)) ? {} : { of: g.what }) };
      else if (g.type === 'drive' && !g.to) when = { event: 'enter', ...(g.what === true || lower(g.what) === 'any' || lower(g.what) === 'vehicle' ? {} : { of: g.what }) };
      else if (g.type === 'defeat') when = { event: 'death', of: g.what };
      else if (g.type === 'event') when = { event: String(g.what), ...(g.of ? { of: g.of } : {}), ...(g.where ? { where: g.where } : {}) };
      else if (g.type === 'use') when = { use: g.what, label: g.label || `Use the ${String(g.what).replace(/-/g, ' ')}`, reach: g.reach };
      else if (g.type === 'collect' && g.pickup) when = { event: 'pickup', of: g.what };
      if (!when) return;
      const rid = `quest:${d.id}:${st.id}:${gi}`;
      E.addRule({ id: rid, when, if: { quest: d.id, step: st.id }, do: [{ _qgoal: d.id, step: st.id, goal: gi }] }, 'quest');
    });
  }
  E.defineAction('_qgoal', {
    scope: 'host',
    run(a) {
      if (!live()) return;
      const d = Q.defs.get(String(a._qgoal));
      const s = d && Q.st[d.id];
      if (!s || s.state !== 'active' || (s.step !== a.step && !s.side.includes(a.step))) return;
      progress(d, s, a.step, num(a.goal, 0), 1);
    },
  });

  // ------------------------------------------------------------------ goals that are places and things: the host looks
  function hostPoll() {
    const players = E.playersAll().filter((p) => p.e);
    for (const d of Q.defs.values()) {
      const s = Q.st[d.id];
      if (!s || s.state !== 'active') continue;
      if (d.seconds && W().time - s.start >= d.seconds) { failQuest(d, s); continue; }
      for (const sid of [s.step, ...s.side].filter(Boolean)) {
        const st = stepOf(d, sid);
        if (!st || s.state !== 'active') continue;
        st.goals.forEach((g, gi) => {
          if (s.state !== 'active' || (s.step !== sid && !s.side.includes(sid)) || goalDone(d, s, sid, gi)) return;
          const key = `${d.id}:${sid}:${gi}`;
          switch (g.type) {
            case 'reach': if (players.some((p) => E.inside([p.e.x, p.e.y, p.e.z], g.what, g.near))) progress(d, s, sid, gi, g.count, true); break;
            case 'drive': {
              const V = H.vehicles;
              const list = V && V.list ? V.list() : [];
              if (list.some((v) => (v.driver || (v.riders && v.riders.length) || v === (V && V.current)) && (g.what === true || ['any', 'vehicle', undefined].includes(lower(g.what) || undefined) || E.matches(v, g.what)) && E.inside([v.x, v.y, v.z], g.to, g.near))) progress(d, s, sid, gi, g.count, true);
              break;
            }
            case 'collect': case 'find': {
              if (g.pickup) break;
              const seen = Q.found.get(key) || new Set();
              Q.found.set(key, seen);
              for (const e of E.things(g.what)) {
                if (seen.has(e) || (e.data && e.data.found && g.type === 'find')) continue;
                const p = players.find((pl) => Math.hypot(pl.e.x - e.x, pl.e.z - e.z) < num(g.reach, g.type === 'find' ? 3 : 1.8) && Math.abs(pl.e.y - e.y) < 3);
                if (!p) continue;
                seen.add(e);
                const who = { id: p.id, name: p.name };
                if (g.type === 'find' && e.living && H.living && H.living.command && g.follow !== false) {
                  e.data.found = true;
                  H.living.command(e, 'follow', { target: p.id === E.net.me ? 'player' : `net:${p.id}` });
                  E.perform({ say: g.say || ['Baa!', 'Found you!', '!'][Math.floor(Math.random() * 3)], by: e.sceneId ? { sceneId: e.sceneId } : e.name }, { who });
                } else if (g.keep !== true) E.perform({ remove: e.sceneId ? { sceneId: e.sceneId } : e.name, count: 1, color: '#ffd84a' }, { who });
                progress(d, s, sid, gi, 1);
              }
              break;
            }
            case 'bring': { const n = E.things(g.what).filter((e) => E.inside([e.x, e.y, e.z], g.to, g.near ?? 1.5)).length; progress(d, s, sid, gi, n, true); break; }
            case 'deliver': {
              for (const p of players) {
                if (!E.inside([p.e.x, p.e.y, p.e.z], g.to, g.near ?? 3)) continue;
                if (E.hasItem({ id: p.id }, g.what, g.count)) { E.perform({ take: g.what, count: g.count }, { who: { id: p.id, name: p.name } }); progress(d, s, sid, gi, g.count, true); break; }
              }
              if (!goalDone(d, s, sid, gi)) { const n = E.things(g.what).filter((e) => E.inside([e.x, e.y, e.z], g.to, g.near ?? 3)).length; if (n) progress(d, s, sid, gi, n, true); }
              break;
            }
            case 'survive': progress(d, s, sid, gi, Math.min(g.count, Math.floor(W().time - (s.step === sid ? s.t0 : s[`t_${sid}`] || s.t0))), true); break;
            case 'until': { const st2 = E.state; if (st2 && st2.clock) { const h = st2.clock.hour, want = typeof g.what === 'string' ? ({ dawn: 6, morning: 8, noon: 12, dusk: 19, night: 21, midnight: 0 }[lower(g.what)] ?? 6) : num(g.what, 6); if (Math.abs(h - want) < 0.25) progress(d, s, sid, gi, g.count, true); } break; }
            case 'have': if (players.some((p) => E.hasItem({ id: p.id }, g.what, g.count))) progress(d, s, sid, gi, g.count, true); break;
            case 'var': {
              const c = { var: g.what };
              for (const k of ['>', '>=', '<', '<=', '=', '==', '!=', 'is', 'above', 'below', 'atLeast', 'atMost', 'equals', 'min', 'max', 'per']) if (k in g) c[k] = g[k];
              if (E.check(c, { who: s.by || E.meWho() })) progress(d, s, sid, gi, g.count, true);
              break;
            }
            default: break;
          }
        });
      }
    }
  }

  // ------------------------------------------------------------------ givers: "!" over their heads, E (or T) to talk
  function giverOf(d) {
    if (d.giver) { const list = E.things(d.giver); if (list.length) return list[0]; }
    for (const e of W().entities) if (e.alive && e.data && Array.isArray(e.data.quests) && e.data.quests.includes(d.id)) return e;
    return null;
  }
  /** What a giver has for this player now: a quest to offer, a step that needs them, or nothing. */
  function giverBusiness(e) {
    const out = [];
    for (const d of Q.defs.values()) {
      const g = giverOf(d);
      const s = Q.st[d.id];
      const state = stateOf(d.id);
      if (g === e && state === 'available' && !d.auto) out.push({ kind: 'offer', d });
      if (state === 'active' && s) for (const sid of [s.step, ...s.side].filter(Boolean)) {
        const st = stepOf(d, sid);
        if (!st) continue;
        if (st.choice && g === e) out.push({ kind: 'choice', d, st });
        st.goals.forEach((gl, gi) => { if (gl.type === 'talk' && !(s.prog[sid] && s.prog[sid][gi] >= gl.count) && E.matches(e, gl.what)) out.push({ kind: 'talk', d, st, gi }); });
      }
    }
    return out;
  }
  E.offer((p) => {
    if (!live() || !E.active() || !p) return null;
    let best = null;
    for (const e of W().entities) {
      if (!e.alive || e.isPlayer || !isGiver(e)) continue;
      const dist = Math.hypot(e.x - p.x, e.z - p.z) - Math.max(e.half[0], e.half[2]);
      if (dist > 3.2 || (best && dist >= best.dist)) continue;
      const biz = giverBusiness(e);
      if (!biz.length) continue;
      best = { e, biz, dist };
    }
    if (!best) return null;
    const b = best.biz[0];
    const name = best.e.name || 'them';
    const label = b.kind === 'offer' ? `Talk to ${name} (quest: ${b.d.title})` : `Talk to ${name}`;
    return { label, priority: 6, distance: best.dist, key: 't', act: () => openDialog(best.e) };
  });
  function isGiver(e) {
    if (e.data && Array.isArray(e.data.quests)) return true;
    for (const d of Q.defs.values()) {
      if (d.giver && E.matches(e, d.giver)) return true;
      for (const st of d.steps) for (const g of st.goals) if (g.type === 'talk' && E.matches(e, g.what)) return true;
    }
    return false;
  }
  // The quest-giver behavior: any thing (a person, a sign, a mailbox) gives the quests named.
  H.behavior('quest-giver', {
    defaults: { quest: null },
    start(thing, o) { thing.data.quests = arr(o.quest ?? o.quests).map(String); },
  });

  // ------------------------------------------------------------------ the dialog (phone-friendly)
  function css() {
    if (typeof document === 'undefined' || document.getElementById('qs-style')) return;
    E.css();
    const st = document.createElement('style');
    st.id = 'qs-style';
    st.textContent = [
      '.qs-btn{position:fixed;left:12px;top:62px;z-index:26;font:700 15px system-ui,sans-serif;color:#fff;background:rgba(10,14,24,.75);border:1px solid rgba(255,216,74,.55);border-radius:14px;padding:8px 12px;min-height:44px;cursor:pointer;backdrop-filter:blur(4px)}',
      '.qs-btn .qs-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#ffd84a;margin-left:6px;vertical-align:middle}',
      '.qs-track{position:fixed;left:12px;top:114px;z-index:25;max-width:min(300px,calc(100vw - 24px));font:600 14px/1.35 system-ui,sans-serif;color:#fff;background:rgba(10,14,24,.62);border-radius:12px;padding:8px 11px;pointer-events:auto;cursor:pointer}',
      '.qs-edge{position:fixed;z-index:24;width:46px;height:46px;margin:-23px 0 0 -23px;pointer-events:none;display:none;filter:drop-shadow(0 2px 6px rgba(0,0,0,.55))}.qs-edge i{position:absolute;inset:0;background:#ffd84a;clip-path:polygon(50% 0,100% 100%,50% 76%,0 100%)}.qs-edge span{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);font:800 11px system-ui,sans-serif;color:#16130a;white-space:nowrap;margin-top:6px}',
      '.qs-dist{position:fixed;z-index:24;pointer-events:none;display:none;transform:translate(-50%,-100%);font:800 12px system-ui,sans-serif;color:#ffd84a;text-shadow:0 1px 3px rgba(0,0,0,.8)}',
      '.qs-track b{color:#ffd84a;display:block;font-size:13px;letter-spacing:.02em}.qs-track .opt{opacity:.75;font-size:12.5px}.qs-track:empty{display:none}',
      '.qs-panel{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:45;width:min(440px,calc(100vw - 24px));max-height:min(78vh,620px);overflow:auto;background:rgba(14,18,30,.95);color:#eef2ff;border:1px solid rgba(255,216,74,.4);border-radius:18px;font:15px/1.45 system-ui,sans-serif;box-shadow:0 14px 50px rgba(0,0,0,.55);padding:14px 16px 16px}',
      '.qs-panel h2{margin:0 0 2px;font:800 20px system-ui,sans-serif;color:#ffd84a}.qs-panel h3{margin:14px 0 4px;font:700 13px system-ui;text-transform:uppercase;letter-spacing:.08em;opacity:.65}',
      '.qs-panel .who{opacity:.7;font-size:13px}.qs-panel p{margin:8px 0}.qs-panel ul{list-style:none;margin:6px 0;padding:0}.qs-panel li{padding:3px 0}.qs-panel li.done{opacity:.6;text-decoration:line-through}.qs-panel li.opt{font-style:italic}',
      '.qs-panel .row{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.qs-panel button{font:700 15px system-ui;border-radius:12px;padding:10px 16px;min-height:44px;cursor:pointer;border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.08);color:#fff}',
      '.qs-panel button.primary{background:#ffd84a;color:#16130a;border-color:#ffd84a}.qs-panel .x{position:absolute;right:8px;top:6px;background:none;border:0;font-size:22px;min-height:0;padding:6px 10px}',
      '.qs-panel .quest{border-top:1px solid rgba(255,255,255,.1);padding:8px 0}.qs-panel .quest:first-of-type{border-top:0}.qs-panel .tag{font-size:12px;opacity:.7;margin-left:6px}.qs-panel .bar{height:6px;border-radius:3px;background:rgba(255,255,255,.12);margin-top:3px}.qs-panel .bar i{display:block;height:100%;border-radius:3px;background:#7dffa0}',
    ].join('\n');
    document.head.appendChild(st);
  }
  function panel() {
    if (typeof document === 'undefined' || !document.body) return null;
    css();
    closeDialog();
    const p = document.createElement('div');
    p.className = 'qs-panel';
    // A dialog: the engine frees the mouse while it's open and doesn't take it back on a click (runtime.js MODAL).
    p.setAttribute('role', 'dialog'); p.setAttribute('aria-modal', 'true');
    for (const t of ['pointerdown', 'wheel', 'touchstart', 'keydown']) p.addEventListener(t, (ev) => { if (ev.key === 'Escape' || ev.key === 'Tab') { closeDialog(); ev.preventDefault && ev.preventDefault(); } ev.stopPropagation(); }, { passive: t !== 'keydown' });
    document.body.appendChild(p);
    Q.dialog = p;
    try { const g = G(); if (g.input && g.input.release) g.input.release(); } catch { /* fine */ }
    return p;
  }
  function closeDialog() { if (Q && Q.dialog) { try { Q.dialog.remove(); } catch { /* gone */ } Q.dialog = null; Q.open = false; } }
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function button(box, label, fn, primary) { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; if (primary) b.className = 'primary'; b.onclick = (ev) => { ev.stopPropagation(); fn(); }; box.appendChild(b); return b; }
  /** Talking to a giver: their line, the quest, Accept / Not now (or the step that needs them, or a choice). */
  function openDialog(e) {
    if (!live()) return;
    const biz = giverBusiness(e);
    if (!biz.length) return;
    const b = biz[0];
    const d = b.d;
    const who = e.name || 'Someone';
    if (e.lookAt && W().player) try { e.lookAt(W().player); } catch { /* fine */ }
    const p = panel();
    if (!p) { if (b.kind === 'offer') askHost({ op: 'accept', q: d.id }); return; }
    const line = b.kind === 'offer' ? d.lines.offer || d.text : b.kind === 'talk' ? b.st.line || d.lines.progress || d.lines.talk || 'Thank you!' : b.st.text;
    p.innerHTML = `<button class="x" aria-label="Close">×</button><div class="who">${esc(who)}</div><h2>${esc(d.title)}</h2><p></p>${b.kind === 'offer' ? `<h3>What to do</h3><ul>${d.steps.filter((s) => !s.optional).map((s) => `<li>• ${esc(s.text)}</li>`).join('')}${d.steps.filter((s) => s.optional).map((s) => `<li class="opt">• ${esc(s.text)} (optional)</li>`).join('')}</ul>${d.reward ? `<h3>Reward</h3><p>${esc(rewardText(d.reward))}</p>` : ''}` : ''}<div class="row"></div>`;
    p.querySelector('p').textContent = `“${line}”`;
    p.querySelector('.x').onclick = closeDialog;
    const row = p.querySelector('.row');
    if (e.say) e.say(line, 4);
    if (b.kind === 'offer') {
      button(row, 'Accept', () => { askHost({ op: 'accept', q: d.id }); closeDialog(); }, true);
      button(row, 'Not now', () => { if (d.lines.decline && e.say) e.say(d.lines.decline, 3); closeDialog(); });
    } else if (b.kind === 'talk') {
      button(row, 'Continue', () => { askHost({ op: 'talk', q: d.id, step: b.st.id, goal: b.gi }); closeDialog(); }, true);
    } else if (b.kind === 'choice') {
      b.st.choice.forEach((c, i) => button(row, c.label || `Choice ${i + 1}`, () => { askHost({ op: 'choose', q: d.id, step: b.st.id, i }); closeDialog(); }, i === 0));
    }
    Q.open = true;
  }
  /** The quest log: every quest, its steps (done, now, optional), progress, rewards; the bag. */
  function openLog() {
    if (!live()) return;
    const p = panel();
    if (!p) return;
    Q.open = 'log';
    renderLog(p);
  }
  function renderLog(p) {
    const list = [...Q.defs.values()].filter((d) => stateOf(d.id) !== 'locked');
    const rank = { active: 0, available: 1, done: 2, failed: 3, none: 4 };
    list.sort((a, b) => rank[stateOf(a.id)] - rank[stateOf(b.id)]);
    const rows = list.map((d) => {
      const s = Q.st[d.id] || { prog: {}, doneSteps: [], side: [] };
      const state = stateOf(d.id);
      const giver = d.giver ? String(d.giver) : '';
      let body = '';
      if (state === 'active') {
        body = `<ul>${d.steps.map((st) => {
          const now = s.step === st.id || s.side.includes(st.id);
          const done = s.doneSteps.includes(st.id);
          if (!now && !done && st.optional === false) return '';
          const goals = st.goals.map((g, gi) => { const v = (s.prog[st.id] && s.prog[st.id][gi]) || 0; return g.count > 1 && now ? `<div class="bar"><i style="width:${Math.round((v / g.count) * 100)}%"></i></div>` : ''; }).join('');
          const prog = now ? st.goals.map((g, gi) => (g.count > 1 ? ` ${(s.prog[st.id] && s.prog[st.id][gi]) || 0}/${g.count}` : '')).join('') : '';
          return `<li class="${done ? 'done' : ''} ${st.optional ? 'opt' : ''}">${done ? '✓' : now ? '▸' : '○'} ${esc(st.text)}${esc(prog)}${st.optional ? ' (optional)' : ''}${goals}</li>`;
        }).join('')}</ul>`;
      } else if (state === 'available') body = `<p class="who">${giver ? `Talk to ${esc(giver)} to start it.` : 'Ready to start.'}</p>`;
      return `<div class="quest" data-id="${esc(d.id)}"><b>${esc(d.title)}</b><span class="tag">${esc(state === 'active' ? (Q.tracked === d.id ? 'tracked' : 'active') : state)}</span>${body}</div>`;
    }).join('');
    const bag = E.state && E.state.inv[E.net.me] ? Object.entries(E.state.inv[E.net.me]).filter(([, n]) => n > 0) : [];
    p.innerHTML = `<button class="x" aria-label="Close">×</button><h2>Quests</h2>${rows || '<p class="who">No quests yet. Talk to people!</p>'}${bag.length ? `<h3>Bag</h3><p>${bag.map(([k, n]) => `${esc(k)} × ${n}`).join(' · ')}</p>` : ''}<div class="row"></div>`;
    p.querySelector('.x').onclick = closeDialog;
    for (const q of p.querySelectorAll('.quest')) q.onclick = () => { const id = q.dataset && q.dataset.id; if (id && stateOf(id) === 'active') { Q.tracked = id; renderLog(p); } };
    button(p.querySelector('.row'), 'Close', closeDialog, true);
  }

  // ------------------------------------------------------------------ the tracker, the button, markers, the arrow
  function trackedQuest() {
    if (Q.tracked && stateOf(Q.tracked) === 'active') return Q.defs.get(Q.tracked);
    for (const d of Q.defs.values()) if (stateOf(d.id) === 'active') { Q.tracked = d.id; return d; }
    return null;
  }
  function uiEl(key, cls, tag = 'div') {
    if (typeof document === 'undefined' || !document.body) return null;
    if (Q.ui[key]) return Q.ui[key];
    css();
    const x = document.createElement(tag);
    x.className = cls;
    document.body.appendChild(x);
    Q.ui[key] = x;
    return x;
  }
  function renderUi() {
    const any = [...Q.defs.values()].some((d) => stateOf(d.id) !== 'locked');
    const btn = uiEl('btn', 'qs-btn', 'button');
    if (!btn) return;
    btn.hidden = !any || !E.playing();
    const active = [...Q.defs.values()].some((d) => stateOf(d.id) === 'active');
    const label = `📜 Quests${active ? '' : ''}`;
    if (btn._l !== label + active) { btn._l = label + active; btn.innerHTML = `${label}${active ? '<span class="qs-dot"></span>' : ''}`; btn.onclick = (ev) => { if (ev && ev.stopPropagation) ev.stopPropagation(); if (Q.open === 'log') closeDialog(); else openLog(); }; btn.onpointerdown = (ev) => ev.stopPropagation(); }
    const tr = uiEl('track', 'qs-track');
    const d = trackedQuest();
    let html = '';
    if (d && E.playing()) {
      const s = Q.st[d.id];
      const lines = [];
      for (const sid of [s.step, ...s.side].filter(Boolean)) {
        const st = stepOf(d, sid);
        if (!st) continue;
        const prog = st.goals.map((g, gi) => (g.count > 1 ? ` ${(s.prog[sid] && s.prog[sid][gi]) || 0}/${g.count}` : '')).join('');
        lines.push(`<div class="${st.optional ? 'opt' : ''}">${st.optional ? '◇' : '▸'} ${esc(st.text)}${esc(prog)}</div>`);
      }
      if (d.seconds) { const left = Math.max(0, d.seconds - (W().time - s.start)); lines.push(`<div class="opt">⏱ ${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}</div>`); }
      html = `<b>${esc(d.title)}</b>${lines.join('')}`;
    }
    if (tr._h !== html) { tr._h = html; tr.innerHTML = html; tr.onclick = () => openLog(); tr.onpointerdown = (ev) => ev.stopPropagation(); }
    if (Q.open === 'log' && Q.dialog && Q.dirty) renderLog(Q.dialog);
    Q.dirty = false;
  }
  function markMat(color) { const m = new B.StandardMaterial('qs-mark', W().scene); const c = B.Color3.FromHexString(color); m.emissiveColor = c; m.diffuseColor = c; m.disableLighting = true; m.alpha = 0.9; return m; }
  function disposeMarks() {
    if (!Q) return;
    for (const m of Q.marks.meshes) try { m.dispose(false, true); } catch { /* gone */ }
    Q.marks.meshes = [];
    if (Q.marks.arrow) try { Q.marks.arrow.dispose(false, true); } catch { /* gone */ }
    Q.marks.arrow = null;
    for (const [, t] of Q.marks.givers) try { t.dispose(false, true); } catch { /* gone */ }
    Q.marks.givers.clear();
  }
  /** Where the tracked quest wants you now: up to three points. */
  function targets() {
    const d = trackedQuest();
    if (!d || d.marker === false) return [];
    const s = Q.st[d.id];
    const st = stepOf(d, s.step);
    if (!st) return [];
    const p = W().player;
    const out = [];
    st.goals.forEach((g, gi) => {
      if ((s.prog[st.id] && s.prog[st.id][gi] || 0) >= g.count) return;
      const at = (ref) => { const list = E.things(ref).filter((e) => !(e.data && e.data.found)); if (p) list.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z)); return list; };
      if (st.marker) { const pos = E.posOf(st.marker); if (pos) out.push(pos); return; }
      if (g.type === 'reach' || g.type === 'bring' || g.type === 'deliver' || (g.type === 'drive' && g.to)) {
        if (g.type === 'bring' && p) { const loose = at(g.what).filter((e) => !E.inside([e.x, e.y, e.z], g.to, 0.5) && !(e.data && e.data.found)); if (loose.length) { for (const e of loose.slice(0, 2)) out.push([e.x, e.y + e.half[1], e.z]); } }
        const z = Array.isArray(g.what) && typeof g.what[0] === 'number' ? E.posOf(g.what) : at(g.type === 'reach' ? g.what : g.to)[0];
        if (z) out.push(Array.isArray(z) ? z : [z.x, z.y + z.half[1], z.z]);
      } else if (g.type === 'talk') { const e = at(g.what)[0]; if (e) out.push([e.x, e.y + e.half[1], e.z]); }
      else if (['find', 'collect', 'defeat', 'use'].includes(g.type)) for (const e of at(g.what).slice(0, 3)) out.push([e.x, e.y + e.half[1], e.z]);
      else if (g.type === 'drive' && !g.to && H.vehicles && H.vehicles.list) { const v = H.vehicles.list().filter((x) => g.what === true || ['any', 'vehicle'].includes(lower(g.what)) || E.matches(x, g.what)); if (p) v.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z)); if (v[0]) out.push([v[0].x, v[0].y + 1, v[0].z]); }
    });
    return out.slice(0, 3);
  }
  /** The target nearest the player (of targets()). */
  function nearestOf(pts, p) {
    let near = null, nd = Infinity;
    if (p) for (const at of pts) { const dd = Math.hypot(at[0] - p.x, at[1] - p.y, at[2] - p.z); if (dd < nd) { nd = dd; near = at; } }
    return near ? { at: near, d: nd } : null;
  }
  /** Where to go, on screen: the distance over the target when you can see it, an arrow at the screen's edge pointing
   *  to it when you can't (behind you, off to the side), so the next objective is never lost. */
  function edgeMark(near) {
    const edge = uiEl('edge', 'qs-edge'), dist = uiEl('dist', 'qs-dist');
    if (!edge || !dist) return;
    if (!edge.firstChild) edge.innerHTML = '<i></i><span></span>';
    const sc = W().scene, cam = sc && sc.activeCamera;
    if (!near || !cam || near.d < 4) { edge.style.display = 'none'; dist.style.display = 'none'; return; }
    const eng = sc.getEngine(), w = eng.getRenderWidth(), h = eng.getRenderHeight();
    const canvas = eng.getRenderingCanvas(), r = canvas ? canvas.getBoundingClientRect() : { left: 0, top: 0, width: w, height: h };
    const v = B.Vector3.Project(new B.Vector3(near.at[0], near.at[1] + 2.2, near.at[2]), B.Matrix.Identity(), sc.getTransformMatrix(), cam.viewport.toGlobal(w, h));
    const label = near.d >= 1000 ? `${(near.d / 1000).toFixed(1)} km` : `${Math.round(near.d)} m`;
    const sx = r.width / w, sy = r.height / h;
    const inView = v.z > 0 && v.z < 1 && v.x > w * 0.06 && v.x < w * 0.94 && v.y > h * 0.08 && v.y < h * 0.92;
    if (inView) {
      edge.style.display = 'none';
      dist.style.display = 'block';
      dist.textContent = label;
      dist.style.left = `${r.left + v.x * sx}px`; dist.style.top = `${r.top + v.y * sy - 6}px`;
      return;
    }
    dist.style.display = 'none';
    // Off screen: from the middle toward it (behind you flips it), clamped to the edge.
    let dx = v.x - w / 2, dy = v.y - h / 2;
    if (v.z < 0 || v.z > 1) { dx = -dx; dy = -dy; }
    if (!dx && !dy) dy = 1;
    const m = 34, k = Math.min((w / 2 - m) / Math.abs(dx || 1e-6), (h / 2 - m) / Math.abs(dy || 1e-6));
    const x = w / 2 + dx * k, y = h / 2 + dy * k;
    edge.style.display = 'block';
    edge.style.left = `${r.left + x * sx}px`; edge.style.top = `${r.top + y * sy}px`;
    edge.firstChild.style.transform = `rotate(${Math.atan2(dy, dx) + Math.PI / 2}rad)`;
    edge.lastChild.textContent = label;
  }
  function updateMarks(t) {
    const w = W(), sc = w.scene, p = w.player;
    const show = E.playing() && p && p.alive;
    const pts = show ? targets() : [];
    // Diamonds with a beam over each target.
    while (Q.marks.meshes.length < pts.length * 2) {
      const dia = B.MeshBuilder.CreatePolyhedron('qs-diamond', { type: 1, size: 0.45 }, sc);
      dia.material = markMat('#ffd84a');
      const beam = B.MeshBuilder.CreateCylinder('qs-beam', { diameter: 0.12, height: 14, tessellation: 8 }, sc);
      beam.material = markMat('#ffd84a'); beam.material.alpha = 0.28;
      for (const m of [dia, beam]) { m.isPickable = false; m.metadata = { decor: true, noGlow: false }; }
      Q.marks.meshes.push(dia, beam);
    }
    for (let i = 0; i < Q.marks.meshes.length; i += 2) {
      const dia = Q.marks.meshes[i], beam = Q.marks.meshes[i + 1], at = pts[i / 2];
      dia.setEnabled(Boolean(at)); beam.setEnabled(Boolean(at));
      if (!at) continue;
      dia.position.set(at[0], at[1] + 1.6 + Math.sin(t * 3 + i) * 0.18, at[2]);
      dia.rotation.y = t * 1.8;
      beam.position.set(at[0], at[1] + 8.5, at[2]);
    }
    // The arrow by your feet, pointing to the nearest target.
    if (!Q.marks.arrow && show) {
      const a = B.MeshBuilder.CreateCylinder('qs-arrow', { diameterTop: 0, diameterBottom: 0.55, height: 0.9, tessellation: 3 }, sc);
      a.material = markMat('#ffd84a'); a.material.alpha = 0.85;
      a.isPickable = false; a.metadata = { decor: true };
      Q.marks.arrow = a;
    }
    if (Q.marks.arrow) {
      let near = null, nd = Infinity;
      if (show) for (const at of pts) { const dd = Math.hypot(at[0] - p.x, at[2] - p.z); if (dd < nd) { nd = dd; near = at; } }
      const on = Boolean(near) && nd > 4 && !(H.vehicles && H.vehicles.current);
      Q.marks.arrow.setEnabled(on);
      if (on) {
        const yaw = Math.atan2(near[0] - p.x, near[2] - p.z);
        Q.marks.arrow.position.set(p.x + Math.sin(yaw) * 1.4, p.bottom + 0.25, p.z + Math.cos(yaw) * 1.4);
        Q.marks.arrow.rotation.set(Math.PI / 2, yaw, 0);
      }
    }
    edgeMark(show ? nearestOf(pts, p) : null);
    // "!" over givers with a quest for you, "?" over people a step needs.
    const want = new Map();
    if (show) for (const e of w.entities) {
      if (!e.alive || e.isPlayer || !isGiver(e)) continue;
      const biz = giverBusiness(e);
      if (biz.length) want.set(e, biz.some((b) => b.kind === 'offer') ? '!' : '?');
    }
    for (const [e, m] of [...Q.marks.givers]) if (!want.has(e) || m._mark !== want.get(e) || !e.alive) { try { m.dispose(false, true); } catch { /* gone */ } Q.marks.givers.delete(e); }
    for (const [e, mark] of want) {
      let m = Q.marks.givers.get(e);
      if (!m) {
        m = H.textPlane(mark, { size: 0.55, color: mark === '!' ? '#ffd84a' : '#9ef0b6', background: false });
        m.isPickable = false; m.metadata = { decor: true }; m._mark = mark;
        Q.marks.givers.set(e, m);
      }
      m.position.set(e.x, e.y + e.half[1] + 0.85 + Math.sin(t * 3) * 0.08, e.z);
    }
  }
  // Friend chat (Living things): a quest chip in the chat's quick buttons when the friend has one for you.
  const bizOf = (e) => (e && W() && isGiver(e) ? giverBusiness(e) : []);
  let chipShown = '';
  if (H.living && H.living.chat) H.living.chat.addChip({
    className: 'qs-chip', style: 'border-color:rgba(255,216,74,.7)',
    show: (e) => bizOf(e).length > 0,
    label: (e) => { const biz = bizOf(e); if (!biz.length) return ''; return biz[0].kind === 'offer' ? `📜 ${biz[0].d.title}` : '📜 About the quest'; },
    act: (e) => { if (H.living.openChat) H.living.openChat(null); openDialog(e); },
  });
  // (Redrawn when what the open chat's friend has for you changes.)
  function friendChip() {
    const c = H.living && H.living.chat;
    if (!c || !c.friend) { chipShown = ''; return; }
    const biz = bizOf(c.friend);
    const key = biz.length ? `${biz[0].kind}:${biz[0].d.title}` : '';
    if (key !== chipShown) { chipShown = key; c.refresh(); }
  }

  // ------------------------------------------------------------------ every step and frame
  H.hooks.step.push(() => {
    if (!live() || !E.active() || !E.net.host) return;
    const t = W().time;
    if (t < Q.nextPoll) return;
    Q.nextPoll = t + 0.25;
    try { hostPoll(); } catch (err) { E.report(err, 'quests'); }
  });
  let chipAt = 0;
  H.hooks.frame.push((elapsed, render, pressed) => {
    if (!live()) return;
    const t = W().time;
    try {
      // (Tab opens the log in a game; in the editor Tab switches building and playing, so there the button opens it.)
      if (E.playing() && !window.HawkesBuild && pressed && pressed.has && pressed.has('tab')) { if (Q.open === 'log') closeDialog(); else openLog(); }
      updateMarks(t);
      if (t >= Q.nextUi || t < Q.nextUi - 1) { Q.nextUi = t + 0.2; renderUi(); }
      if (t - chipAt > 0.3 || t < chipAt) { chipAt = t; friendChip(); }
      if (Q.dialog && Q.open !== 'log' && W().player) { /* a giver's dialog closes when you walk away */ }
    } catch (err) { E.report(err, 'quests'); }
  });
  H.hooks.world.push({
    enter() {
      if (!live() || !E.playing() || !E.net.host) return;
      for (const d of Q.defs.values()) if (d.auto && stateOf(d.id) === 'available') startQuest(d.id, E.meWho());
    },
  });
  if (H.sync && H.sync.state) {
    H.sync.state('quests', {
      rate: 6,
      get: () => (live() ? { st: Q.st } : null),
      set: (s) => { if (live() && s.st) { Q.st = s.st; Q.dirty = true; } },
    });
  }

  // ------------------------------------------------------------------ config.quests, the quest action and condition
  function addQuest(raw, source = 'script') {
    if (!live()) throw new Error('quests: no game is running');
    const d = normQuest(raw);
    d.source = source;
    if (Q.defs.has(d.id)) removeQuest(d.id);
    Q.defs.set(d.id, d);
    compile(d);
    // Started after the world began (a script, an action): auto quests start now.
    if (d.auto && E.active() && E.net.host && stateOf(d.id) === 'available' && E.state.started) startQuest(d.id, E.meWho());
    Q.dirty = true;
    return d.id;
  }
  function removeQuest(id) {
    const d = Q.defs.get(String(id));
    if (!d) return false;
    for (const r of E.rules.filter((x) => x.source === 'quest' && x.id.startsWith(`quest:${d.id}:`))) E.removeRule(r.id);
    Q.defs.delete(d.id);
    delete Q.st[d.id];
    return true;
  }
  H.features.register('quests', {
    apply(value) { if (!live()) return; for (const raw of arr(Array.isArray(value) ? value : value && value.list)) try { addQuest(raw, 'config'); } catch (err) { E.report(err, 'scene.json quests'); } },
    change(value) { if (!live()) return; for (const d of [...Q.defs.values()].filter((x) => x.source === 'config')) removeQuest(d.id); for (const raw of arr(Array.isArray(value) ? value : value && value.list)) try { addQuest(raw, 'config'); } catch (err) { E.report(err, 'scene.json quests'); } },
    dispose() { if (live()) for (const d of [...Q.defs.values()].filter((x) => x.source === 'config')) removeQuest(d.id); },
    codex: { title: 'Quests', group: 'World', what: 'Quests from people and AI friends: steps, goals, rewards, a quest log, markers.', value: [{ id: 'hello', title: 'Say hello', steps: [{ goal: { reach: [0, 0, 8] } }], reward: { score: 10 } }] },
  });
  E.defineCondition('quest', (c) => {
    if (!live()) return false;
    const id = String(c.quest);
    const state = stateOf(id);
    if (c.step !== undefined) { const s = Q.st[id]; return state === 'active' && s && (s.step === String(c.step) || s.side.includes(String(c.step))); }
    const want = c.is ?? c.state;
    if (want === undefined) return state === 'active';
    return arr(want).map(lower).includes(state) || (lower(want) === 'started' && (state === 'active' || state === 'done')) || (lower(want) === 'not-started' && (state === 'available' || state === 'locked'));
  });
  E.defineAction('quest', {
    scope: 'host',
    run(a, ctx) {
      if (!live()) return;
      let id = a.quest;
      if (id && typeof id === 'object') id = addQuest(id, 'action');
      id = String(id);
      const d = Q.defs.get(id);
      if (!d) { E.report(new Error(`events: no quest "${id}"`)); return; }
      const s = stOf(id);
      const op = lower(a.do || (a.start ? 'start' : a.complete || a.finish ? 'complete' : a.fail ? 'fail' : a.advance ? 'advance' : a.reset ? 'reset' : a.available ? 'available' : 'start'));
      if (op === 'start' || op === 'give' || op === 'begin') startQuest(id, ctx.who);
      else if (op === 'complete' || op === 'finish' || op === 'done') { if (s.state !== 'active') startQuest(id, ctx.who); finishQuest(d, s); }
      else if (op === 'fail') failQuest(d, s);
      else if (op === 'advance' || op === 'next') { if (s.state === 'active' && s.step) completeStep(d, s, a.step ? String(a.step) : s.step, a.to || null); }
      else if (op === 'reset') { delete Q.st[id]; Q.dirty = true; }
      else if (op === 'available' || op === 'unlock') { if (s.state === 'locked' || s.state === 'failed' || s.state === 'done') s.state = 'available'; }
    },
  });

  // ------------------------------------------------------------------ game.events.quests
  function api() {
    return {
      add: (q) => (Array.isArray(q) ? q.map((x) => addQuest(x)) : addQuest(q)),
      remove: (id) => removeQuest(id),
      start: (id) => { if (E.net.host) return startQuest(String(id), E.meWho()); askHost({ op: 'accept', q: String(id) }); return true; },
      complete: (id) => E.perform({ quest: String(id), do: 'complete' }, { who: E.meWho() }),
      fail: (id) => E.perform({ quest: String(id), do: 'fail' }, { who: E.meWho() }),
      advance: (id) => E.perform({ quest: String(id), do: 'advance' }, { who: E.meWho() }),
      /** 'locked', 'available', 'active', 'done', 'failed' (or 'none'). */
      state: (id) => stateOf(String(id)),
      step: (id) => (live() && Q.st[String(id)] ? Q.st[String(id)].step : null),
      progress: (id) => (live() && Q.st[String(id)] ? clone(Q.st[String(id)].prog) : null),
      list: () => (live() ? [...Q.defs.values()].map((d) => ({ id: d.id, title: d.title, state: stateOf(d.id), step: Q.st[d.id] ? Q.st[d.id].step : null })) : []),
      talk: (id, step) => askHost({ op: 'talk', q: String(id), step: step || (Q.st[String(id)] || {}).step }),
      choose: (id, i) => askHost({ op: 'choose', q: String(id), step: (Q.st[String(id)] || {}).step, i }),
      open: () => openLog(),
      close: () => closeDialog(),
      talkTo: (e) => openDialog(typeof e === 'string' ? E.things(e)[0] : e),
      track: (id) => { if (live()) Q.tracked = String(id); },
      get tracked() { return live() ? Q.tracked : null; },
      targets: () => (live() ? targets() : []),
    };
  }
  E.quests = { add: addQuest, remove: removeQuest, state: stateOf, start: startQuest, openLog, openDialog, giverBusiness, targets: () => targets(), get q() { return Q; } };
})();
