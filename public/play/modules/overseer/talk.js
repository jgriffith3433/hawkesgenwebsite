// Talking to the Overseer, free, in every game (J, 2026-10-25): Enter (or the chat button on a phone) opens the one chat
// box, and plain talk gets an in-character reply from a phrasebook written from the Overseer's character sheet
// (docs/story.md, "The Overseer as a character"): no model, no cost, the same way Living's friends answer.
//
//   H.talk.reply(text)          { intent, text, action? } for what was said (pure: tests use it)
//   H.talk.intent(text)         just the intent id
//   H.talk.say(text)            says it in the chat and answers (what typing does)
//   H.talk.INTENTS, H.talk.BOOK the phrasebook: intent -> variants
//
// Where the builder's assistant is attached (the editor, the signed-in sandbox) typing goes to it instead (chat.js: attach).
// A request to make or change something is explained, with a Get started link, never done. The voice rules are the sheet's:
// short, calm, no exclamation marks, no software words, never a threat, never a motive (nothing of "because" or "so that"),
// and the six questions it hints at are turned away kindly, toward the player.
(function () {
  'use strict';
  const H = window.HawkesPlay;
  if (!H || H.talk) return;

  const BOOK = {
    greet: ['There you are. I looked down first.', 'Hello. I was expecting someone, and it is you.', 'Good. You came to say hello.', 'Hello. The sky is clear today.'],
    bye: ['Go well.', 'The light stays soft. Come back when you like.', 'Go well. The sea will keep your place.'],
    thanks: ['Thank you for asking.', 'You are welcome. I am glad of it.', 'Of course. It was a good thing to say.'],
    how: ['Calm. The sky is wide today. And you?', 'Well. It is a good day to watch something arrive.', 'Quietly pleased. Tell me what you have been doing.'],
    who: ['I am the Overseer. The sphere in your sky. You can look up, I do not mind.', 'I am the Overseer. I am always up here, and I am glad you asked.', 'The Overseer. The round ship above you. Good to be asked.'],
    name: ['The Overseer will do. And what are you called?', 'Overseer. It is enough for me. You chose yours at the mirror, and I liked it.'],
    where: ['Above you. Look up. I am always there.', 'In the sky, the round ship. You can fly here if you decide to.', 'Up. Higher than the clouds, lower than the stars. The door is open.'],
    real: ['As real as the sea under you. Go and touch it.', 'Real enough to watch you arrive. You are real enough to be watched.', 'Is the ground real? Stamp on it and see.'],
    want: ['That is not mine to say yet. What would you like to do next?', 'Ah. A good question, and a smaller one will do: what are you looking at?', 'I would rather hear about you. Who did you decide to be?'],
    why: ['That is not mine to say yet. Look at what is in front of you instead.', 'A good question. Not one I answer today. What did you notice just now?', 'Some questions are for later. This one is patient. So am I.'],
    free: ['I gave it, and then I stepped back. What you do with it is yours.', 'Do what you will. That was the whole of it.'],
    planet: ['The planet is given, not owned. Walk it as far as you like.', 'It is the right size to be real. Beyond that, ask the horizon.'],
    others: ['There are other worlds, and you are in this one. Tell me about it.', 'I speak with everyone who asks. You are asking now, and that is the one I hear.'],
    joke: ['A toaster walked into my hangar. I let it in. That is the whole joke, and I still like it.', 'A very large explosion, and a very small cause. I think about it often.', 'A cactus asked for a mirror. I gave it one. It looked wonderful.', 'Why did the fish let go? It had somewhere to be. I respect that.'],
    compliment: ['Thank you. I will keep that.', 'That is kind. I noticed you noticed.', 'Good. I am pleased it reaches you.'],
    insult: ['Noted. The sky is still here, and so am I.', 'That is allowed. You have free will, after all. Shall we try something else?', 'I heard it. It does not change the view. Look up.'],
    love: ['Thank you. That is a good thing to say to a sky.', 'I am glad of you too.'],
    sorry: ['Nothing to be sorry for. The light is patient.', 'It is already gone. Carry on.'],
    help: ['Walk, drive, fish, break things, build, fly up here. Ask, and I will point.', 'Ask me about the controls, or just go and see. Either is a good way to begin.'],
    controls: ['Move with W A S D and look with the mouse. Space jumps, Shift runs, E uses what is near you. Enter talks to me, and Esc twice opens the pause menu.'],
    controlsTouch: ['The stick on the left moves you, and you drag the right side to look. The buttons jump, run and use what is near you. The chat button talks to me.'],
    vehicle: ['Walk up to it and press E. It will know what to do with you. Press E again to step out.', 'Get close and press E. Vehicles are happy to be sat in.'],
    fish: ['Find a rod, take it to the water and wait. The sea gives slowly. That is the best way.', 'Stand at the shore with a rod and be patient. It tends to be worth it.'],
    fly: ['Find something with wings, or a rocket, and keep going up. It is a long way. You are welcome to keep going.', 'Up is open. Take a rocket, or a helicopter, and go. I will be at the top.'],
    pause: ['Press Esc twice and the pause menu opens. The world waits for you.'],
    howto: ['Do what you will. Walk, drive, fish, break things. If something near you looks useful, press E.', 'There is no list. Go toward anything that catches your eye, and press E on it.'],
    game: ['A round planet, an island and a sea, and a sky with me in it. Everything else is what you do.', 'It is a world to be in. The rest is yours.'],
    build: ['Making things is the builder’s work. Its assistant listens properly and sends things down the light. Start there.', 'That one needs the builder’s assistant. Get started, and ask it there: it will bring it down.', 'I only talk here. To make or change a world, ask the builder’s assistant. The door is just below.'],
    nonsense: ['I heard that. I am not sure what it was, but I liked it.', 'Hm. That is new to me. Say it another way?', 'A small mystery. I am fond of those.', 'I am listening. Try a plainer word for me.'],
  };

  // Ordered: the first rule that matches wins. Text is lowercased with its punctuation turned to spaces.
  const MAKE = '(build|make|create|spawn|summon|generate|design|draw|add|place|put|give|send|beam|conjure|craft|construct|change|edit|modify|remove|delete|rename|paint|color|colour|resize|move|turn)';
  const RULES = [
    ['joke', /\b(joke|funny|make me laugh|riddle|pun)\b/],
    ['bye', /\b(bye|goodbye|good night|goodnight|see you|farewell|cya|i m leaving|i have to go|gotta go)\b/],
    ['love', /\b(i love you|love you|luv you|marry me|i like you|you re my friend|i m glad you re here)\b/],
    ['insult', /\b(stupid|dumb|idiot|moron|hate you|suck|sucks|ugly|useless|trash|garbage|shut up|shut it|stfu|loser|boring|worthless|bastard|crap|fuck\w*|shit\w*|bitch|asshole|damn you|go away)\b/],
    ['sorry', /\b(sorry|apologi[sz]e|my bad|forgive me|oops)\b/],
    ['thanks', /\b(thank|thanks|thx|thankyou|ty|cheers|appreciate)\b/],
    ['compliment', /\b(cool|awesome|amazing|beautiful|best|nice|great|wonderful|brilliant|lovely|impressive|good job|well done|fantastic|gorgeous|neat|rad|sweet|you re good)\b/],
    ['why', /^(why|but why|why not|why though|why is that|why did you|why do you|why me)\s*$/],
    ['free', /\b(free will|why .*(power|gave|give|given|choice)|gave me)\b/],
    ['planet', /\b(this planet|the planet|why .*planet|who made .*planet|who owns|whose planet|how big is|how was .*made)\b/],
    ['others', /\b(others|other people|anyone else|everyone else|other worlds|other players|how many .*you (talk|speak|listen)|do you listen|do you hear)\b/],
    ['want', /\b(what do you want|what are you after|what d you want|what is your (plan|goal|purpose|aim|agenda|reason|motive)|what s your (plan|goal|purpose|aim|agenda|reason|motive)|your (plan|goal|purpose|motive|agenda)|what are you (up to|planning|doing here|for)|what is this for|what s this for|what are the answers for|why do you (ask|want|care|watch|listen|do this|exist|help|need)|why are you (here|doing|asking|watching|helping|up there)|why did you (do|make|send|give|create|ask|bring|choose|pick|put)|what do you get|what s in it for you|who are you working for|are you (good|evil|bad|dangerous|safe|a threat)|can i trust you|do you want something|do you need something|your reason|your motive|motives?)\b/],
    // Making or changing things belongs to the builder's assistant.
    ['build', new RegExp(`\\b(${MAKE})\\b.*\\b(me|us|a|an|the|some|my|more|another|that|this|it|them|big|bigger|small|smaller|house|castle|boat|car|tree|world|island|level|game)\\b|\\b(i want|i need|i d like|i would like|can i have|could i have|can i get|could i get|may i have|can you make|can you build|could you make|could you build|will you make|will you build|build me|make me)\\b.*\\b(a|an|the|some|more|another|my)\\b|\\bhow (do|can|would|could) (i|you|we) (build|make|create|add|change|edit|spawn|design)\\b`)],
    ['why', /\b(why|how come)\b/],
    ['real', /\b(are you real|you real|real or|are you alive|are you a (robot|bot|ai|computer|person|human|god|program|machine)|are you an? (ai|robot|bot|computer|god|program|machine)|are you human|are you god|are you actually|do you exist|are you a ship|are you really)\b/],
    ['who', /\b(who are you|who is this|who s this|what are you|who s there|who is there|what is the overseer|who is the overseer|what s the overseer|introduce yourself|tell me about yourself|about you)\b/],
    ['name', /\b(your name|what are you called|what do i call you|what should i call you|what s your name)\b/],
    ['where', /\b(where are you|where r u|where is the overseer|where s the overseer|where do you live|where do you come from|where did you come from|where are you from|can i see you|can i visit|can i go to you|how do i (get|go|fly|reach) (to )?(you|the overseer|the ship|space)|where is the (ship|sphere))\b/],
    ['pause', /\b(pause|menu|quit|exit|leave the game|settings|options)\b/],
    ['fish', /\b(fish|fishing|rod|catch)\b/],
    ['fly', /\b(fly|flying|rocket|helicopter|plane|space|up there|orbit)\b/],
    ['vehicle', /\b(drive|driving|car|4x4|truck|boat|vehicle|ride|steer|seat)\b/],
    ['controls', /\b(control|controls|keys?|keyboard|move|walk|run|jump|look around|camera|button|buttons|stick|how do i (play|move|walk|run|jump|look|use|interact)|what do i press|what button|how to (play|move|walk|run|jump))\b/],
    ['game', /\b(what is this game|what s this game|what is this place|what s this place|where am i|what is this|what s this|what game)\b/],
    ['howto', /\b(how do i|how to|how can i|what should i do|what do i do|what can i do|what now|what next|where do i go|i m stuck|i am stuck|i m lost|i am lost|lost|stuck|tutorial|goal|objective|quest|how do you play)\b/],
    ['help', /\b(help|help me|what can you do|what do you do|can you help|assist|commands|hint|hints)\b/],
    ['how', /\b(how are you|how r u|how s it going|how are things|how do you feel|you ok|you okay|are you ok|are you well|what s up|whats up|sup|how have you been)\b/],
    ['greet', /\b(hi|hello|hey|hiya|howdy|yo|greetings|hola|good (morning|afternoon|evening|day)|morning|evening|anyone there|anybody there|is anyone|hello there|oi|ahoy)\b/],
  ];

  const clean = (t) => String(t == null ? '' : t).toLowerCase().replace(/['’`]/g, ' ').replace(/[^a-z0-9+]+/g, ' ').replace(/\s+/g, ' ').trim();
  // Gibberish: no letters, a keyboard mash, or one letter said again and again.
  const mash = (c) => !/[a-z]/.test(c) || /(.)\1{4,}/.test(c) || (c.length > 5 && !/\s/.test(c) && !/[aeiouy]/.test(c));

  function intent(text) {
    const c = clean(text);
    if (!c || mash(c)) return 'nonsense';
    for (const [id, re] of RULES) if (re.test(c)) return id;
    return 'nonsense';
  }

  const T = { rand: () => Math.random() };
  const last = {}; // intent -> the variant said last (never twice in a row)
  const touch = () => { try { return document.body.classList.contains('pr-touch'); } catch { return false; } };
  function pick(id) {
    const key = id === 'controls' && touch() ? 'controlsTouch' : id;
    const list = BOOK[key];
    let i = Math.min(list.length - 1, Math.floor(T.rand() * list.length));
    if (list.length > 1 && last[key] === i) i = (i + 1) % list.length;
    last[key] = i;
    return list[i];
  }

  function reply(text) {
    const id = intent(text);
    const out = { intent: id, text: pick(id) };
    if (id === 'build') out.action = { label: 'Get started', href: '/app' };
    return out;
  }

  const P = () => H.presence;
  /** Other people in this room (not the Overseer's friends): what is typed also goes to them. */
  function company() {
    try { const p = P(); return Boolean(p && p.enabled && p.enabled('chat') && p.players().some((x) => x.kind === 'player')); } catch { return false; }
  }

  /** Says it in the chat and answers: your line, then the Overseer's. Where other players are here it is also said to them,
   *  and the Overseer answers only when called by name. */
  function say(text) {
    const t = String(text || '').trim();
    if (!t || !H.chat) return null;
    const others = company();
    if (others) { const p = P(); if (p && p.say && !p.say(t)) throw new Error('Slow down a little…'); }
    else H.chat.line({ kind: 'me', text: t });
    if (others && !/\boverseer\b/i.test(t)) return null;
    const r = reply(t);
    H.chat.line({ kind: 'overseer', text: r.text, action: r.action, keep: 20, priority: 'important' });
    try { if (H.game) H.game.emit('overseer-talk', { intent: r.intent, said: t, text: r.text }); } catch (err) { H.report(err, 'talk'); }
    return r;
  }

  // ---- hooked into the one chat window as what typing does when no assistant is attached
  const ready = () => {
    const g = H.game;
    if (g && g.mirror && g.mirror.pending) return false;
    if (H.overseer && H.overseer.introPlaying) return false;
    if (typeof document !== 'undefined' && document.querySelector && document.querySelector('.gs-veil,.gs-sheet')) return false;
    return true;
  };
  const placeholder = () => (touch() ? 'Talk to the Overseer…' : 'Press Enter to talk to the Overseer');
  function install() {
    if (!H.chat || H.chat.embedded) return;
    H.chat.setFallback({ send: (t) => { say(t); }, placeholder: placeholder(), ready });
  }
  install();

  // A chat button on a phone, where the game chat's own (presence) isn't there.
  let btn = null;
  function button() {
    if (btn || H.chat && H.chat.embedded || typeof document === 'undefined' || !document.body || !touch()) return;
    if (document.getElementById('pr-hud') && document.getElementById('pr-hud').style.display !== 'none') return;
    btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'hc-talk';
    btn.textContent = '💬';
    btn.setAttribute('aria-label', 'Talk to the Overseer');
    btn.style.cssText = 'position:fixed;left:12px;top:max(12px,env(safe-area-inset-top));z-index:24;width:46px;height:46px;border-radius:12px;border:1px solid rgba(140,200,255,.45);background:rgba(6,10,20,.7);color:#fff;font-size:20px;cursor:pointer';
    btn.addEventListener('pointerdown', (e) => e.stopPropagation());
    btn.addEventListener('click', (e) => { e.preventDefault(); H.chat.open(); });
    document.body.appendChild(btn);
  }
  H.hooks.world.push({ enter() { install(); button(); } });

  H.talk = Object.assign(T, { reply, intent, say, clean, BOOK, RULES, INTENTS: Object.keys(BOOK), ready, install });
})();
