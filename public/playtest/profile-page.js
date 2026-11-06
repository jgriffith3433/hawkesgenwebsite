// The `profile-page` scenario: /profile at 390x844 and 1440x900. Loaded by portal.js. Safe on live (read only, no sign-up).
//   Signed in (the runner's browser is already on a Google account): profile-avatar, profile-worlds (cards, or an empty state with a link),
//   profile-plan (plan chip and credits), empty-states-guide (every empty state has a link saying what to do next), no-horizontal-scroll.
//   Signed out: profile-gate (the page offers Google sign-in) and a warning that the signed-in page was not seen.
export const PROFILE_PAGE = {
  id: 'profile-page', title: 'The profile page: avatar, worlds, credits and plan; empty states that say what to do next; no sideways scroll at 390px', seconds: 90, tags: ['full'],
  description: 'no sign-up, no game, read only. For 390x844 and 1440x900 (an iframe each): the avatar (profile-avatar), worlds or their empty state (profile-worlds), credits and plan (profile-plan), a link in every empty state (empty-states-guide), no horizontal scroll. Signed out it checks the sign-in card (profile-gate). options: sizes',
};

export async function runProfilePage(t, options = {}) {
  const sizes = (Array.isArray(options.sizes) && options.sizes.length ? options.sizes : ['390x844', '1440x900']).map(String);
  t.event('plan', `profile-page: ${sizes.join(', ')}`);
  const failed = [];
  for (let i = 0; i < sizes.length; i++) {
    const [w, h] = sizes[i].split('x').map(Number);
    if (!(w > 0 && h > 0)) throw new Error(`bad size "${sizes[i]}"`);
    failed.push(...await oneSize(t, w, h, sizes[i]));
    t.progress((i + 1) / sizes.length);
  }
  document.getElementById('pt-pf-stage')?.remove();
  if (failed.length) { t.event('profile-failed', failed.join(' | ')); throw new Error(`profile: ${failed.join(' | ')}`); }
  t.finish('done');
}

async function oneSize(t, w, h, label) {
  document.getElementById('pt-pf-stage')?.remove();
  const stage = document.createElement('div');
  stage.id = 'pt-pf-stage';
  stage.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:#14151c;overflow:hidden';
  const frame = document.createElement('iframe');
  frame.title = `The profile at ${label}`;
  const scale = Math.min(1, innerWidth / w, (innerHeight - 24) / h);
  frame.style.cssText = `position:absolute;left:${Math.round((innerWidth - w * scale) / 2)}px;top:24px;width:${w}px;height:${h}px;border:0;background:#fff;transform:scale(${scale});transform-origin:0 0`;
  stage.appendChild(frame);
  document.body.appendChild(stage);
  const bad = [];
  frame.src = '/profile';
  await t.until(() => { try { return frame.contentWindow.hgProfileReady === true; } catch { return false; } }, 30000, `the profile at ${label}`);
  const doc = frame.contentWindow.document;
  const $ = (s) => doc.querySelector(s);
  await t.wait(500);
  const state = $('#pfMain')?.dataset.state;
  if (state !== 'ready') {
    if ($('#gate') && !$('#gate').hidden && $('#gateBtn')) t.event('profile-gate', `signed out at ${label}: the page offers Google sign-in`);
    else bad.push(`${label}: the page is neither the profile nor the sign-in card`);
    t.problem('warning', `${label}: signed out, so the profile itself was not seen`);
    t.scene(`Profile ${label}: sign in`);
    return bad;
  }
  if ($('#avatar')?.children.length && $('#name')?.textContent.trim()) t.event('profile-avatar', `avatar and name "${$('#name').textContent.trim()}" at ${label}`);
  else bad.push(`${label}: no avatar or name`);
  const cards = doc.querySelectorAll('#worlds .game-card').length;
  const emptyWorlds = $('#worlds .pf-empty a[href]');
  if (cards) t.event('profile-worlds', `${cards} worlds at ${label}`);
  else if (emptyWorlds) t.event('profile-worlds', `no worlds: the empty state links to ${emptyWorlds.getAttribute('href')} at ${label}`);
  else bad.push(`${label}: no worlds and no empty state`);
  if ($('#chips .plan-chip') && /credits/.test($('#stats').textContent)) t.event('profile-plan', `${$('#chips .plan-chip').textContent}, ${$('#stats .pf-stat b').textContent} credits at ${label}`);
  else bad.push(`${label}: plan or credits missing`);
  const empties = [...doc.querySelectorAll('.pf-empty')];
  const mute = empties.filter((e) => !e.querySelector('a[href]') || !e.querySelector('p')?.textContent.trim());
  if (mute.length) bad.push(`${label}: ${mute.length} empty states do not say what to do next`);
  else t.event('empty-states-guide', `${empties.length} empty states, each with words and a link at ${label}`);
  t.scene(`Profile ${label}`);
  const de = doc.documentElement;
  if (de.scrollWidth > de.clientWidth + 1) bad.push(`${label}: horizontal scroll`); else t.event('no-horizontal-scroll', label);
  return bad;
}
