// Hawkes Gen — Authenticated Creator Studio Web App (/app)
// Covers all 6 Creation Studios, Live Credit Quoting, SSE + Polling Job Feed,
// My Generations Gallery with 'Use in...' actions, Stripe Credit Wallet & Ledger,
// and Personal API / Unity / MCP Key management.

const STUDIOS = {
  image: {
    eyebrow: 'Images',
    heading: 'Images & textures',
    tools: [
      {
        id: 'image.generate',
        label: 'Generate Image',
        desc: 'Generate concept art, character references, or seamless tileable textures.',
        defaultCredits: 5,
        fields: [
          { name: 'prompt', label: 'Prompt', type: 'textarea', placeholder: 'A weathered obsidian monolith glowing with cyan runes, studio concept art', required: true },
          {
            name: 'aspect',
            label: 'Aspect Ratio / Resolution',
            type: 'select',
            options: [
              { value: '1024x1024', label: '1:1 Square (1024×1024)' },
              { value: '1344x768', label: '16:9 Widescreen (1344×768)' },
              { value: '768x1344', label: '9:16 Portrait (768×1344)' },
              { value: '1216x832', label: '3:2 Landscape (1216×832)' },
            ],
            default: '1024x1024',
          },
          { name: 'seamless', label: 'Seamless Tileable Texture', type: 'checkbox', default: false },
        ],
      },
      {
        id: 'image.edit',
        label: 'Edit Image',
        desc: 'Modify an existing image with natural language instructions (Flux Kontext / Qwen Edit).',
        defaultCredits: 5,
        inputKey: 'images',
        inputMultiple: true,
        inputLabel: 'Source Image to Edit',
        fields: [
          { name: 'prompt', label: 'Edit Instruction', type: 'textarea', placeholder: 'Turn the armor into brushed titanium with violet energy trim', required: true },
        ],
      },
      {
        id: 'image.cutout',
        label: 'Background Cutout',
        desc: 'Remove the background from a character or prop image cleanly (rembg / BiRefNet).',
        defaultCredits: 2,
        inputKey: 'image',
        inputLabel: 'Image to Cut Out',
        fields: [],
      },
      {
        id: 'image.angles',
        label: 'Multi-Angle Turnaround',
        desc: 'Generate consistent multi-angle orthographic turnaround views from a reference image.',
        defaultCredits: 5,
        inputKey: 'image',
        inputLabel: 'Front Reference Image',
        fields: [],
      },
      {
        id: 'image.panorama',
        label: '360° Skybox Panorama',
        desc: 'Generate seamless 360° equirectangular environment skyboxes for Unity, Unreal, or Babylon.js.',
        defaultCredits: 5,
        fields: [
          { name: 'prompt', label: '360° Environment Prompt', type: 'textarea', placeholder: '360 equirectangular panorama of a rain-soaked cyberpunk courtyard at night, neon reflections', required: true },
        ],
      },
      {
        id: 'texture.maps',
        label: 'PBR Material Maps',
        desc: 'Decompose a seamless texture into Albedo, Normal, Roughness, Metallic, and Height maps.',
        defaultCredits: 5,
        inputKey: 'image',
        inputLabel: 'Base Color / Texture Image',
        fields: [],
      },
    ],
  },

  video: {
    eyebrow: 'Video',
    heading: 'Video',
    tools: [
      {
        id: 'video.t2v',
        label: 'Text to Video (video.t2v)',
        desc: 'Synthesize cinematic video clips directly from a text prompt (Wan 2.2 / LTX-2).',
        defaultCredits: 40,
        fields: [
          { name: 'prompt', label: 'Video Prompt', type: 'textarea', placeholder: 'Slow tracking camera through a misty moonlit forest with glowing fireflies, cinematic 24fps', required: true },
          { name: 'seconds', label: 'Duration (Seconds)', type: 'range', min: 2, max: 8, step: 1, default: 4 },
        ],
      },
      {
        id: 'video.i2v',
        label: 'Image to Video (video.i2v)',
        desc: 'Animate a character pose or environment still into a smooth video clip.',
        defaultCredits: 40,
        inputKey: 'start',
        inputLabel: 'Start Frame Image',
        fields: [
          { name: 'prompt', label: 'Motion Prompt', type: 'textarea', placeholder: 'The fighter steps forward and unleashes a spinning flame uppercut', required: true },
          { name: 'seconds', label: 'Duration (Seconds)', type: 'range', min: 2, max: 8, step: 1, default: 4 },
        ],
        // Gen takes frames (4n + 1) at fps, not seconds.
        mapParams: (p) => { p.fps = 16; p.frames = Math.round((p.seconds * 16) / 4) * 4 + 1; delete p.seconds; },
      },
      {
        id: 'video.animate',
        label: 'Character Motion Transfer (video.animate)',
        desc: 'Transfer body movement and choreography from a driving video onto a character image.',
        defaultCredits: 40,
        inputKey: 'reference',
        inputLabel: 'Character Reference Image',
        fields: [
          { name: 'motion', label: 'Driving Motion Video (asset: or blob:)', type: 'text', placeholder: 'asset:a_motion_clip', asInput: true, required: true },
          { name: 'prompt', label: 'Character & Scene Prompt', type: 'textarea', placeholder: 'Smooth character animation preserving identity and costume details' },
        ],
      },
      {
        id: 'video.talk',
        label: 'Portrait Lip-Sync (video.talk)',
        desc: 'Drive expressive lip-synced character dialogue from a portrait image and spoken audio clip.',
        defaultCredits: 40,
        inputKey: 'image',
        inputLabel: 'Character Portrait Image',
        fields: [
          { name: 'audio', label: 'Voice Audio Asset (asset: or blob:)', type: 'text', placeholder: 'asset:a_voice_line', asInput: true, required: true },
          { name: 'prompt', label: 'Expression & Delivery Direction', type: 'text', placeholder: 'Speaking intensely with subtle head nods, cinematic lighting' },
        ],
      },
      {
        id: 'video.control',
        label: 'Depth / Pose Controlled Video (video.control)',
        desc: 'Reskin a Blender pass or depth/pose control video with AI cinematography.',
        defaultCredits: 40,
        inputKey: 'control',
        inputLabel: 'Control / Depth Pass Video',
        fields: [
          { name: 'image', label: 'First Frame in the Finished Look (asset: or blob:)', type: 'text', placeholder: 'asset:a_styled_first_frame', asInput: true, required: true },
          { name: 'prompt', label: 'Visual Style Prompt', type: 'textarea', placeholder: 'Gritty cyberpunk alley, rain-wet asphalt, neon rim lighting', required: true },
        ],
      },
      {
        id: 'video.upscale',
        label: 'Video Upscale (video.upscale)',
        desc: 'Enhance and upscale generated video clips to crisp HD resolution.',
        defaultCredits: 40,
        inputKey: 'video',
        inputLabel: 'Source Video to Upscale',
        fields: [],
      },
    ],
  },

  mesh: {
    eyebrow: '3D',
    heading: '3D models & rigging',
    tools: [
      {
        id: 'mesh.views3d',
        label: '4-View Sheet → 3D GLB (mesh.views3d)',
        desc: 'Turn a verified 4-view turnaround sheet (front, back, left, right) into a textured 3D GLB mesh.',
        defaultCredits: 50,
        inputKey: 'image',
        inputLabel: '4-View Turnaround Sheet Image',
        fields: [],
      },
      {
        id: 'image.viewsheet',
        label: 'Generate 4-View Sheet (image.viewsheet)',
        desc: 'Generate and Claude-verify a consistent Front / Back / Left / Right sheet from a front reference.',
        defaultCredits: 15,
        inputKey: 'image',
        inputLabel: 'Front Character / Prop Image',
        fields: [
          { name: 'look', label: 'Subject Description', type: 'text', placeholder: 'Stylized fantasy knight in silver armor, A-pose' },
        ],
      },
      {
        id: 'mesh.textured',
        label: 'Image → Textured 3D GLB (mesh.textured)',
        desc: 'Convert a prop or concept image directly into a textured 3D GLB model (Hunyuan3D 2.1).',
        defaultCredits: 50,
        inputKey: 'image',
        inputLabel: 'Reference Image',
        fields: [
          { name: 'allowSingleView', label: 'Allow Single-View Prop / Blockout Mode', type: 'checkbox', default: true },
        ],
      },
      {
        id: 'mesh.from-image',
        label: 'Image → Untextured 3D Mesh (mesh.from-image)',
        desc: 'Fast geometry-first 3D GLB extraction from a reference image.',
        defaultCredits: 50,
        inputKey: 'image',
        inputLabel: 'Reference Image',
        fields: [
          { name: 'allowSingleView', label: 'Allow Single-View Prop / Blockout Mode', type: 'checkbox', default: true },
        ],
      },
      {
        id: 'mesh.rig',
        label: 'Auto-Rig 3D GLB (mesh.rig)',
        desc: 'Automatically rig a 3D GLB mesh with a commercial-cleared Mixamo humanoid or SkinTokens skeleton.',
        defaultCredits: 20,
        inputKey: 'mesh',
        inputLabel: '3D Mesh GLB to Auto-Rig',
        fields: [
          {
            name: 'kind',
            label: 'Skeleton Type',
            type: 'select',
            options: [
              { value: 'auto', label: 'Auto (Humanoid Mixamo or Creature SkinTokens)' },
              { value: 'humanoid', label: 'Humanoid (Make-It-Animatable Mixamo Bones)' },
            ],
            default: 'auto',
          },
        ],
      },
      {
        id: 'blender.character',
        label: 'Blender Character Pipeline (blender.character)',
        desc: 'Clean, bake textures, attach props, and retarget Quaternius CC0 motion clips onto a rigged GLB.',
        defaultCredits: 20,
        inputKey: 'files',
        inputMultiple: true,
        inputLabel: 'Rigged Character GLB',
        fields: [
          { name: 'clips', label: 'CC0 Motion Library Clips (comma-separated)', type: 'text', placeholder: 'Walk_Loop, Run_Loop, Idle_Loop', required: true },
        ],
        // Gen takes the clips as files (motion:<pack>/<clip>) and the steps as ops.
        mapParams: (p, inputs) => {
          const clips = String(p.clips || '').split(',').map((c) => c.trim()).filter(Boolean);
          delete p.clips;
          inputs.files = [...(inputs.files || []), ...clips.map((c) => (c.startsWith('motion:') ? c : `motion:${c.includes('/') ? c : `ual1/${c}`}`))];
          p.ops = [
            { op: 'import', file: 0 },
            ...clips.map((c, i) => ({ op: 'retarget', file: i + 1, name: c.split('/').pop() })),
            { op: 'export', format: 'fbx' },
            { op: 'export', format: 'glb' },
            { op: 'preview' },
          ];
        },
      },
    ],
  },

  motion: {
    eyebrow: 'Motion',
    heading: 'Animation',
    tools: [
      {
        id: 'motion.from-text',
        label: 'Text to 3D Skeletal Motion (motion.from-text)',
        desc: 'Synthesize custom 3D skeletal animation clips from a text prompt (Kimodo SOMA / HY-Motion).',
        defaultCredits: 20,
        fields: [
          { name: 'prompt', label: 'Motion Prompt', type: 'textarea', placeholder: 'A character performs a cautious stealth walk, looks over both shoulders, and crouches', required: true },
          { name: 'seconds', label: 'Duration (Seconds)', type: 'range', min: 2, max: 10, step: 1, default: 4 },
        ],
      },
    ],
  },

  audio: {
    eyebrow: 'Audio',
    heading: 'Voice, sound & music',
    tools: [
      {
        id: 'audio.music',
        label: 'ACE-Step 1.5 Music (audio.music)',
        desc: 'Generate full-length songs or seamless gameplay loops with lyrics or instrumental toggle.',
        defaultCredits: 20,
        fields: [
          { name: 'prompt', label: 'Style & Instrumentation Prompt', type: 'textarea', placeholder: 'Dark synthwave action soundtrack, 128 BPM, punchy analog bass, atmospheric pads', required: true },
          { name: 'lyrics', label: 'Lyrics (Leave blank for Instrumental)', type: 'textarea', placeholder: '[Verse 1]\nNeon rain on obsidian glass...' },
          { name: 'instrumental', label: 'Instrumental Only (No Vocals)', type: 'checkbox', default: true },
          { name: 'seconds', label: 'Duration (Seconds)', type: 'range', min: 15, max: 180, step: 15, default: 60 },
        ],
        mapParams: (p) => { if (p.instrumental || !p.lyrics) p.lyrics = '[Instrumental]'; delete p.instrumental; },
      },
      {
        id: 'audio.voice',
        label: 'Character Voice (audio.voice)',
        desc: 'Speak character dialogue with ElevenLabs voices.',
        defaultCredits: 8,
        fields: [
          { name: 'text', label: 'Spoken Dialogue Line', type: 'textarea', placeholder: 'Lock down the reactor core—nobody leaves Hawkes Tower tonight.', required: true },
          {
            name: 'voice',
            label: 'Character Voice Picker',
            type: 'select',
            options: [
              { value: 'JBFqnCBsd6RMkjVDRZzb', label: 'George — Deep British Narrator' },
              { value: 'EXAVITQu4vr4xnSDxMaL', label: 'Sarah — Warm Expressive Lead' },
              { value: 'onwK4e9ZLuTAKqWW03F9', label: 'Daniel — Grounded Commander' },
              { value: 'N2lVS1w4EtoT3dr4eOWO', label: 'Callum — Gritty Action Hero' },
            ],
            default: 'JBFqnCBsd6RMkjVDRZzb',
          },
        ],
      },
      {
        id: 'audio.voice-design',
        label: 'Custom Voice Design (audio.voice-design)',
        desc: 'Design a brand-new character voice from a natural-language persona description.',
        defaultCredits: 8,
        fields: [
          { name: 'description', label: 'Voice Persona Description', type: 'textarea', placeholder: 'Ancient gravelly demon announcer with booming theatrical resonance and raspy undertone', required: true },
          { name: 'text', label: 'Sample Preview Line', type: 'text', placeholder: 'Welcome to Floor One Thousand of the Infernal Arena, challenger!' },
        ],
      },
      {
        id: 'audio.sfx',
        label: 'Game Sound Effects (audio.sfx)',
        desc: 'Generate crisp combat impacts, UI chimes, creature vocals, or ambient foley.',
        defaultCredits: 8,
        fields: [
          { name: 'text', label: 'Sound Effect Description', type: 'textarea', placeholder: 'Heavy plasma rifle charge-up followed by a crisp electromagnetic blast', required: true },
          { name: 'duration', label: 'Duration (Seconds)', type: 'range', min: 1, max: 15, step: 1, default: 3 },
        ],
      },
    ],
  },

  pipelines: {
    eyebrow: 'Chains',
    heading: 'Multi-step jobs',
    tools: [
      {
        id: 'pipeline.char3d',
        realTool: 'asset.make',
        label: 'Prompt → Concept → 4-View → 3D Mesh → Auto-Rigged GLB',
        desc: 'Complete 3D character pipeline: generates concept art, cuts it out, verifies a 4-view turnaround sheet, extracts a textured GLB mesh, and auto-rigs with a humanoid skeleton.',
        defaultCredits: 90,
        fields: [
          { name: 'prompt', label: 'Character Concept Prompt', type: 'textarea', placeholder: 'Stylized low-poly cyber-samurai in A-pose, clean silhouette, studio light', required: true },
        ],
        buildSteps: (vals) => [
          { tool: 'image.generate', params: { prompt: `${vals.prompt || 'Stylized 3D character'}, full body front view, A-pose, clean background` } },
          { tool: 'image.remove-background', params: {}, inputs: { image: '$prev' } },
          { tool: 'image.viewsheet', params: { look: vals.prompt || 'Stylized 3D character' }, inputs: { image: '$prev' } },
          { tool: 'mesh.views3d', params: {}, inputs: { image: '$prev:sheet' } },
          { tool: 'mesh.rig', params: { kind: 'auto' }, inputs: { mesh: '$prev' } },
        ],
      },
      {
        id: 'pipeline.pbr',
        realTool: 'asset.make',
        label: 'Prompt → Seamless Texture → Full PBR Material Maps',
        desc: 'Generates a seamless tileable texture from your prompt and decomposes it into Albedo, Normal, Roughness, Metallic, and Height maps.',
        defaultCredits: 10,
        fields: [
          { name: 'prompt', label: 'Material / Surface Prompt', type: 'textarea', placeholder: 'Worn industrial steel grating with subtle rust and oil stains, orthographic top-down', required: true },
        ],
        buildSteps: (vals) => [
          { tool: 'image.generate', params: { prompt: vals.prompt || 'Seamless material texture', seamless: true } },
          { tool: 'texture.maps', params: {}, inputs: { image: '$prev' } },
        ],
      },
      {
        id: 'pipeline.sprite',
        realTool: 'asset.make',
        label: 'Prompt → Character Concept → Clean Transparent Cutout',
        desc: 'Generates a game character or prop and immediately produces a clean alpha-channel cutout.',
        defaultCredits: 7,
        fields: [
          { name: 'prompt', label: 'Sprite / Prop Prompt', type: 'textarea', placeholder: 'Dark fantasy hellhound boss, side profile facing right, crisp silhouette', required: true },
        ],
        buildSteps: (vals) => [
          { tool: 'image.generate', params: { prompt: vals.prompt || 'Game sprite character' } },
          { tool: 'image.remove-background', params: {}, inputs: { image: '$prev' } },
        ],
      },
    ],
  },
};

const state = {
  user: null,
  studioKey: 'image',
  toolIndex: 0,
  presets: [],
  voices: [],
  jobs: [],
  assets: [],
  motions: [],
  galleryKind: '',
  galleryQuery: '',
  quoteTimer: null,
  eventSource: null,
  pollTimer: null,
};

// ============================================================================
// INITIALIZATION & AUTHENTICATION CHECK
// ============================================================================

async function init() {
  const params = new URLSearchParams(window.location.search);
  const requestedStudio = params.get('studio');
  if (requestedStudio && STUDIOS[requestedStudio]) {
    state.studioKey = requestedStudio;
  }

  if (params.get('checkout') === 'success' || params.get('billing') === 'success') {
    const banner = document.getElementById('checkoutBanner');
    if (banner) banner.hidden = false;
  }

  document.getElementById('dismissCheckoutBanner')?.addEventListener('click', () => {
    document.getElementById('checkoutBanner').hidden = true;
  });

  bindInlineAuth();
  bindModals();
  bindSidebarAndComposer();
  bindGalleryControls();

  await checkSession();
}

/** A Hawkes Analytics event (the page's SDK, data-product="hawkesgen"); never throws, nothing if it didn't load. */
function track(name, props) {
  try { window.hawkesAnalytics?.track(name, props); } catch {}
}

/** Sign-ups and purchases are told by site-analytics.js (from the account's ledger, for every page and every way in);
 *  this page only asks it to look again now that we know who this is. */
async function funnelOnLoad() {
  try { window.hgAnalytics?.refresh(); } catch {}
}

/** The invite card: the customer's link (GET /v1/referral), what a friend gets, what they've earned. */
async function loadInvite() {
  const r = await fetch('/v1/referral').catch(() => null);
  if (!r || !r.ok) return;
  const d = await r.json();
  document.getElementById('inviteText').textContent = `Friends who sign up with your link get ${d.bonus} extra credits. When one buys credits, you get ${d.reward}.`;
  document.getElementById('inviteStats').textContent = d.invited ? `${d.invited} signed up · ${d.bought} bought · ${d.earned} credits earned` : '';
  const btn = document.getElementById('inviteCopy');
  btn.onclick = async () => { await navigator.clipboard.writeText(d.link); btn.textContent = 'Copied'; setTimeout(() => (btn.textContent = 'Copy invite link'), 1500); };
  document.getElementById('inviteCard').hidden = false;
}

async function checkSession() {
  try {
    const res = await fetch('/v1/users/me?soft=1', { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      showInlineAuth();
      return;
    }
    const data = await res.json();
    if (!data.user) { showInlineAuth(); return; }
    state.user = data.user;
    showStudioApp();
    updateWalletUI(state.user.credits);
    document.getElementById('userEmailBadge').textContent = state.user.email || '';
    loadInvite();
    funnelOnLoad();

    const savedKey = localStorage.getItem('hg_last_minted_key');
    if (savedKey) {
      document.getElementById('mintedApiKeyInput').value = savedKey;
      updateKeySnippets(savedKey);
    } else if (data.client?.prefix) {
      document.getElementById('mintedApiKeyInput').value = `${data.client.prefix}••••••••••••••••••••`;
    }

    await Promise.all([
      loadPresets(),
      loadVoices(),
      loadJobs(),
      loadAssets(),
      loadMotions(''),
    ]);
    renderStudio();
    connectEventStream();
  } catch {
    showInlineAuth();
  }
}

function showInlineAuth() {
  document.getElementById('studioAuthScreen').hidden = false;
  document.getElementById('studioAppShell').style.display = 'none';
}

function showStudioApp() {
  document.getElementById('studioAuthScreen').hidden = true;
  document.getElementById('studioAppShell').style.display = 'grid';
}

function updateWalletUI(credits) {
  if (typeof credits === 'number') {
    if (state.user) state.user.credits = credits;
    document.getElementById('walletCreditsCount').textContent = credits.toLocaleString();
  }
}

// ============================================================================
// INLINE AUTHENTICATION: Google only (the "Continue with Google" link; google-gate.js adds the referral)
// ============================================================================

function bindInlineAuth() {
  // Back from Google with a problem (?signin_error=): say so under the button.
  const errEl = document.getElementById('inlineAuthError');
  const problem = new URLSearchParams(location.search).get('signin_error');
  if (problem && errEl) {
    errEl.textContent = problem;
    errEl.style.display = 'block';
  }

  document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    await fetch('/v1/users/logout', { method: 'POST' }).catch(() => {});
    state.user = null;
    showInlineAuth();
  });
}

// ============================================================================
// LEFT SIDEBAR & SMART COMPOSER
// ============================================================================

function bindSidebarAndComposer() {
  document.querySelectorAll('#studioSidebarNav .studio-nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-studio');
      if (!key || !STUDIOS[key]) return;
      state.studioKey = key;
      state.toolIndex = 0;
      renderStudio();
    });
  });

  document.getElementById('composerPresetSelect')?.addEventListener('change', () => scheduleQuote());
  document.getElementById('composerNegativePrompt')?.addEventListener('input', () => scheduleQuote());
  document.getElementById('composerInputAssetRef')?.addEventListener('input', () => scheduleQuote());

  // Drag & drop upload to POST /v1/assets
  const dropzone = document.getElementById('composerDropzone');
  const fileInput = document.getElementById('composerFileInput');
  dropzone?.addEventListener('click', () => fileInput?.click());
  dropzone?.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });
  dropzone?.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
  dropzone?.addEventListener('drop', async (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    const file = e.dataTransfer?.files?.[0];
    if (file) await uploadInputAsset(file);
  });
  fileInput?.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (file) await uploadInputAsset(file);
  });

  document.getElementById('composerInputAssetRef')?.addEventListener('input', () => showInputPreview());

  document.getElementById('openLibraryPickerBtn')?.addEventListener('click', () => {
    renderLibraryPicker();
    document.getElementById('libraryPickerModal').hidden = false;
  });

  document.getElementById('composerForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    await submitComposerJob();
  });

  document.getElementById('motionSearchInput')?.addEventListener('input', (e) => {
    loadMotions(e.target.value.trim());
  });

  document.getElementById('refreshJobsBtn')?.addEventListener('click', () => loadJobs());
}

async function uploadInputAsset(file) {
  const statusEl = document.getElementById('dropzoneStatusText');
  statusEl.textContent = `Uploading ${file.name}...`;
  try {
    const res = await fetch('/v1/assets', {
      method: 'POST',
      headers: {
        'X-Filename': file.name,
        'Content-Type': file.type || 'application/octet-stream',
      },
      body: file,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Upload failed');
    const ref = data.id ? `asset:${data.id}` : data.blob;
    document.getElementById('composerInputAssetRef').value = ref;
    statusEl.textContent = `Uploaded: ${file.name}`;
    await loadAssets();
    showInputPreview();
    scheduleQuote();
  } catch (err) {
    statusEl.textContent = `Upload error: ${err.message || err}`;
  }
}

function getActiveToolDef() {
  const studio = STUDIOS[state.studioKey] || STUDIOS.image;
  return studio.tools[state.toolIndex] || studio.tools[0];
}

function renderStudio() {
  const studio = STUDIOS[state.studioKey] || STUDIOS.image;
  const tool = getActiveToolDef();

  document.querySelectorAll('#studioSidebarNav .studio-nav-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-studio') === state.studioKey);
  });

  document.getElementById('activeStudioEyebrow').textContent = studio.eyebrow;
  document.getElementById('activeStudioHeading').textContent = studio.heading;
  document.getElementById('activeToolIdBadge').textContent = tool.realTool || tool.id;

  // Render subtool chips
  const chipsEl = document.getElementById('studioToolChips');
  chipsEl.innerHTML = '';
  studio.tools.forEach((t, idx) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `subtool-chip${idx === state.toolIndex ? ' active' : ''}`;
    btn.textContent = t.label;
    btn.addEventListener('click', () => {
      state.toolIndex = idx;
      renderStudio();
    });
    chipsEl.appendChild(btn);
  });

  document.getElementById('composerToolTitle').textContent = tool.label;
  document.getElementById('composerToolDesc').textContent = tool.desc;

  // Render dynamic fields
  const fieldsContainer = document.getElementById('composerDynamicFields');
  fieldsContainer.innerHTML = '';
  for (const field of tool.fields || []) {
    const wrap = document.createElement('div');
    wrap.className = 'form-field';
    const id = `field_${field.name}`;

    if (field.type === 'checkbox') {
      wrap.innerHTML = `
        <label style="justify-content:flex-start;gap:10px;cursor:pointer;">
          <input type="checkbox" id="${id}" data-field="${field.name}" ${field.default ? 'checked' : ''}>
          <span>${field.label}</span>
        </label>
      `;
    } else if (field.type === 'select') {
      const options = field.name === 'voice' && state.voices.length
        ? state.voices.map((v) => ({ value: v.voice_id || v.id, label: `${v.name} (${v.labels?.accent || 'Voice'})` }))
        : (field.options || []);
      wrap.innerHTML = `
        <label for="${id}">${field.label}</label>
        <select id="${id}" data-field="${field.name}" class="form-select">
          ${options.map((o) => `<option value="${escapeHtml(o.value)}" ${o.value === field.default ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
        </select>
      `;
    } else if (field.type === 'range') {
      wrap.innerHTML = `
        <label for="${id}">
          <span>${field.label}</span>
          <span id="${id}_val">${field.default}s</span>
        </label>
        <input type="range" id="${id}" data-field="${field.name}" min="${field.min}" max="${field.max}" step="${field.step}" value="${field.default}">
      `;
      const rangeInput = wrap.querySelector('input');
      const valSpan = wrap.querySelector(`#${id}_val`);
      rangeInput?.addEventListener('input', () => {
        if (valSpan) valSpan.textContent = `${rangeInput.value}s`;
        scheduleQuote();
      });
    } else if (field.type === 'textarea') {
      wrap.innerHTML = `
        <label for="${id}">${field.label}</label>
        <textarea id="${id}" data-field="${field.name}" class="form-textarea" placeholder="${escapeHtml(field.placeholder || '')}" ${field.required ? 'required' : ''}></textarea>
      `;
    } else {
      wrap.innerHTML = `
        <label for="${id}">${field.label}</label>
        <input type="text" id="${id}" data-field="${field.name}" class="form-input" placeholder="${escapeHtml(field.placeholder || '')}" ${field.required ? 'required' : ''}>
      `;
    }

    wrap.querySelectorAll('input, select, textarea').forEach((el) => {
      el.addEventListener('input', () => scheduleQuote());
      el.addEventListener('change', () => scheduleQuote());
    });
    if (field.asInput) {
      const box = document.createElement('div');
      box.className = 'input-preview';
      box.hidden = true;
      wrap.appendChild(box);
      const el = wrap.querySelector('input');
      el?.addEventListener('input', () => showInputPreview(box, el.value.trim()));
    }
    fieldsContainer.appendChild(wrap);
  }

  // Input asset section visibility
  const inputSec = document.getElementById('composerInputSection');
  if (tool.inputKey) {
    inputSec.hidden = false;
    document.getElementById('composerInputLabel').textContent = tool.inputLabel || `Source Input (${tool.inputKey})`;
  } else {
    inputSec.hidden = true;
  }

  // Motion library browser visibility in Studio 4
  const motionBrowser = document.getElementById('motionLibraryBrowser');
  motionBrowser.hidden = state.studioKey !== 'motion';
  showInputPreview();

  populatePresetDropdown(tool.realTool || tool.id);
  scheduleQuote();
}

function collectComposerSpec() {
  const toolDef = getActiveToolDef();
  const rawValues = {};
  document.querySelectorAll('#composerDynamicFields [data-field]').forEach((el) => {
    const key = el.getAttribute('data-field');
    if (el.type === 'checkbox') {
      rawValues[key] = el.checked;
    } else if (el.type === 'range' || el.type === 'number') {
      rawValues[key] = Number(el.value);
    } else {
      const v = el.value.trim();
      if (v !== '') rawValues[key] = v;
    }
  });

  if (rawValues.aspect) {
    const [w, h] = String(rawValues.aspect).split('x').map(Number);
    if (w && h) {
      rawValues.width = w;
      rawValues.height = h;
    }
    delete rawValues.aspect;
  }

  const neg = document.getElementById('composerNegativePrompt')?.value.trim();
  if (neg && !toolDef.buildSteps) {
    rawValues.negative = neg;
  }

  const preset = document.getElementById('composerPresetSelect')?.value || undefined;
  const inputs = {};
  if (toolDef.inputKey) {
    const ref = document.getElementById('composerInputAssetRef')?.value.trim();
    if (ref) {
      inputs[toolDef.inputKey] = toolDef.inputMultiple ? [ref] : ref;
    }
  }
  // Fields that name another asset (a driving video, a voice line) are inputs, not params.
  for (const f of toolDef.fields || []) {
    if (f.asInput && rawValues[f.name] !== undefined) {
      inputs[f.name] = rawValues[f.name];
      delete rawValues[f.name];
    }
  }
  toolDef.mapParams?.(rawValues, inputs);

  if (toolDef.buildSteps) {
    return {
      tool: 'asset.make',
      params: { steps: toolDef.buildSteps(rawValues) },
      inputs: {},
    };
  }

  return {
    tool: toolDef.id,
    preset,
    params: rawValues,
    inputs,
  };
}

function scheduleQuote() {
  if (state.quoteTimer) clearTimeout(state.quoteTimer);
  const toolDef = getActiveToolDef();
  const badge = document.getElementById('liveQuoteBadge');
  if (badge) badge.textContent = `${toolDef.defaultCredits || 5} Credits`;

  state.quoteTimer = setTimeout(async () => {
    try {
      const spec = collectComposerSpec();
      const res = await fetch('/v1/billing/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: spec.tool, preset: spec.preset, params: spec.params }),
      });
      if (!res.ok) return;
      const q = await res.json();
      if (badge && typeof q.credits === 'number') {
        badge.textContent = `${q.credits} Credits ($${(q.credits / 100).toFixed(2)})`;
      }
      if (typeof q.userCredits === 'number') {
        updateWalletUI(q.userCredits);
      }
    } catch {}
  }, 180);
}

async function submitComposerJob() {
  const errEl = document.getElementById('composerErrorMsg');
  const btn = document.getElementById('generateSubmitBtn');
  errEl.style.display = 'none';
  btn.disabled = true;
  try {
    const spec = collectComposerSpec();
    const res = await fetch('/v1/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(spec),
    });
    if (res.ok) track('job_start', { tool: spec.tool });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 402) {
        openCreditsModal();
      }
      throw new Error(data.error || 'Failed to submit generation job');
    }
    await Promise.all([loadJobs(), refreshProfileCredits()]);
  } catch (err) {
    errEl.textContent = err.message || String(err);
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false;
  }
}

async function refreshProfileCredits() {
  const res = await fetch('/v1/users/me').catch(() => null);
  if (res && res.ok) {
    const d = await res.json();
    if (d.user) updateWalletUI(d.user.credits);
  }
}

// ============================================================================
// PRESETS, VOICES & 3D MOTION LIBRARY
// ============================================================================

async function loadPresets() {
  const res = await fetch('/v1/presets').catch(() => null);
  if (!res || !res.ok) return;
  const data = await res.json();
  state.presets = data.projects || [];
}

function populatePresetDropdown(toolId) {
  const sel = document.getElementById('composerPresetSelect');
  if (!sel) return;
  const options = ['<option value="">None (Custom Studio Prompt)</option>'];
  for (const proj of state.presets) {
    for (const [name, p] of Object.entries(proj.presets || {})) {
      if (!p.tool || p.tool === toolId) {
        const fullName = `${proj.project}/${name}`;
        const label = `${proj.title || proj.project}: ${name}${p.description ? ` — ${p.description.slice(0, 48)}` : ''}`;
        options.push(`<option value="${escapeHtml(fullName)}">${escapeHtml(label)}</option>`);
      }
    }
  }
  sel.innerHTML = options.join('');
}

async function loadVoices() {
  const res = await fetch('/v1/providers/elevenlabs/voices').catch(() => null);
  if (!res || !res.ok) return;
  const data = await res.json().catch(() => ({}));
  if (Array.isArray(data.voices) && data.voices.length) {
    state.voices = data.voices;
  }
}

async function loadMotions(query) {
  const url = `/v1/motions?q=${encodeURIComponent(query || '')}&limit=60`;
  const res = await fetch(url).catch(() => null);
  if (!res || !res.ok) return;
  const data = await res.json();
  state.motions = data.items || data.clips || [];
  renderMotionBrowser();
}

function renderMotionBrowser() {
  const container = document.getElementById('motionResultsList');
  if (!container) return;
  if (!state.motions.length) {
    container.innerHTML = '<div style="color:var(--text-muted);font-size:0.82rem;">No matching CC0 motion clips found.</div>';
    return;
  }
  container.innerHTML = state.motions.slice(0, 36).map((m) => {
    const clipName = m.title || m.name;
    const pack = m.meta?.pack || m.pack || 'ual1';
    const dur = m.meta?.duration ?? m.duration ?? 0;
    const ref = `${pack}/${clipName}`;
    return `
      <div style="background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:var(--radius-sm);padding:10px;display:flex;flex-direction:column;justify-content:space-between;gap:6px;">
        <div>
          <div style="font-weight:700;font-size:0.83rem;word-break:break-word;">${escapeHtml(clipName)}</div>
          <div style="font-size:0.74rem;color:var(--text-muted);">${escapeHtml(pack)} · ${dur}s · CC0</div>
        </div>
        <button type="button" class="btn btn-secondary btn-sm" data-use-motion="${escapeHtml(ref)}">Retarget in 3D Studio</button>
      </div>
    `;
  }).join('');

  container.querySelectorAll('[data-use-motion]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const ref = btn.getAttribute('data-use-motion');
      state.studioKey = 'mesh';
      state.toolIndex = STUDIOS.mesh.tools.findIndex((t) => t.id === 'blender.character');
      if (state.toolIndex < 0) state.toolIndex = 0;
      renderStudio();
      const clipsInput = document.getElementById('field_clips');
      if (clipsInput) clipsInput.value = ref;
    });
  });
}

// ============================================================================
// REAL-TIME JOB FEED (SSE /v1/events + Polling Fallback)
// ============================================================================

async function loadJobs() {
  const res = await fetch('/v1/jobs?limit=25').catch(() => null);
  if (!res || !res.ok) return;
  const data = await res.json();
  state.jobs = data.jobs || [];
  renderJobsFeed();
}

function connectEventStream() {
  if (state.eventSource) state.eventSource.close();
  try {
    const es = new EventSource('/v1/events');
    state.eventSource = es;
    es.addEventListener('job', (ev) => {
      try {
        const job = JSON.parse(ev.data);
        const idx = state.jobs.findIndex((j) => j.id === job.id);
        if (idx >= 0) state.jobs[idx] = { ...state.jobs[idx], ...job };
        else state.jobs.unshift(job);
        renderJobsFeed();
        if (['done', 'failed', 'cancelled'].includes(job.status)) {
          loadAssets();
          refreshProfileCredits();
        }
      } catch {}
    });
  } catch {}

  if (!state.pollTimer) {
    state.pollTimer = setInterval(() => {
      if (state.jobs.some((j) => j.status === 'queued' || j.status === 'running')) {
        loadJobs();
      }
    }, 4000);
  }
}

function renderJobsFeed() {
  const el = document.getElementById('liveJobFeedList');
  if (!el) return;
  if (!state.jobs.length) {
    el.innerHTML = '<div style="color:var(--text-muted);font-size:0.88rem;padding:18px 0;text-align:center;">No active or recent jobs yet. Submit a prompt on the left to start generating!</div>';
    return;
  }

  el.innerHTML = state.jobs.slice(0, 15).map((j) => {
    const statusClass = `job-status-${j.status || 'queued'}`;
    const promptPreview = j.params?.prompt || j.params?.text || j.detail || j.tool;
    const outAsset = Array.isArray(j.outputs) && j.outputs.length ? j.outputs[0] : null;
    const outId = typeof outAsset === 'string' ? outAsset : outAsset?.id;
    return `
      <div class="job-card">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
          <span class="tool-tag">${escapeHtml(j.tool)}</span>
          <span class="job-status-badge ${statusClass}">${escapeHtml(j.status)}</span>
        </div>
        <div style="font-size:0.84rem;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
          ${escapeHtml(String(promptPreview || ''))}
        </div>
        ${j.detail ? `<div style="font-size:0.76rem;color:var(--cyan-400);">⚡ ${escapeHtml(j.detail)}</div>` : ''}
        ${j.error ? `<div style="font-size:0.76rem;color:var(--rose-400);">✕ ${escapeHtml(j.error)} (Credits refunded)</div>` : ''}
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:4px;">
          <span style="font-size:0.73rem;color:var(--text-dim);font-family:var(--font-mono);">${escapeHtml(j.id)}</span>
          <div style="display:flex;gap:6px;">
            ${(j.status === 'queued' || j.status === 'running') ? `<button type="button" class="btn btn-ghost btn-sm" data-cancel-job="${escapeHtml(j.id)}">Cancel</button>` : ''}
            ${outId ? `<a href="/v1/assets/${escapeHtml(outId)}/file" target="_blank" class="btn btn-secondary btn-sm">Open Output ↗</a>` : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');

  el.querySelectorAll('[data-cancel-job]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const jid = btn.getAttribute('data-cancel-job');
      await fetch(`/v1/jobs/${jid}/cancel`, { method: 'POST' }).catch(() => {});
      await Promise.all([loadJobs(), refreshProfileCredits()]);
    });
  });
}

// ============================================================================
// MY GENERATIONS GALLERY & 'USE IN...' QUICK ACTIONS
// ============================================================================

function bindGalleryControls() {
  document.querySelectorAll('#galleryKindFilters .filter-pill').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#galleryKindFilters .filter-pill').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.galleryKind = btn.getAttribute('data-kind') || '';
      loadAssets();
    });
  });

  document.getElementById('gallerySearchInput')?.addEventListener('input', (e) => {
    state.galleryQuery = e.target.value.trim();
    loadAssets();
  });
}

async function loadAssets() {
  const qs = new URLSearchParams({ limit: '48' });
  if (state.galleryKind) qs.set('kind', state.galleryKind);
  if (state.galleryQuery) qs.set('q', state.galleryQuery);
  const res = await fetch(`/v1/assets?${qs.toString()}`).catch(() => null);
  if (!res || !res.ok) return;
  const data = await res.json();
  state.assets = data.items || [];
  renderGallery();
}

/** A card's picture or model at a level of detail Gen made (asset.lods): an image about `px` wide, a model's mid copy. */
function previewUrl(asset, px = 512) {
  const fileUrl = `/v1/assets/${encodeURIComponent(asset.id)}/file`;
  const levels = asset.lods && Array.isArray(asset.lods.levels) ? asset.lods.levels : [];
  if (!levels.length) return fileUrl;
  const pick = asset.kind === 'mesh' ? (levels.find((l) => l.role === 'mid') || levels[levels.length - 1]) : ([...levels].reverse().find((l) => l.level <= px) || levels[0]);
  return `${fileUrl}?lod=${pick.level}&v=${encodeURIComponent(pick.sha || '')}`;
}

function renderMediaPreview(asset) {
  const fileUrl = `/v1/assets/${encodeURIComponent(asset.id)}/file`;
  if (asset.kind === 'image') {
    return `<img src="${previewUrl(asset)}" alt="${escapeHtml(asset.title || asset.id)}" loading="lazy">`;
  }
  if (asset.kind === 'video') {
    return `<video src="${fileUrl}" controls preload="metadata" playsinline></video>`;
  }
  if (asset.kind === 'mesh') {
    return `<model-viewer src="${previewUrl(asset)}" camera-controls auto-rotate style="width:100%;height:100%;background:#05060a;"></model-viewer>`;
  }
  if (asset.kind === 'audio') {
    return `<div style="padding:16px;width:100%;"><audio src="${fileUrl}" controls style="width:100%;"></audio></div>`;
  }
  return `<div class="tool-tag">${escapeHtml(asset.kind || 'file')}</div>`;
}

function renderGallery() {
  const grid = document.getElementById('galleryGrid');
  if (!grid) return;
  if (!state.assets.length) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:32px;color:var(--text-muted);">No generated assets match your filter yet. Use the Smart Composer above to create your first asset!</div>`;
    return;
  }

  grid.innerHTML = state.assets.map((a) => {
    const fileUrl = `/v1/assets/${encodeURIComponent(a.id)}/file`;
    const downloadUrl = `${fileUrl}?download=1`;
    const promptText = a.recipe?.params?.prompt || a.recipe?.params?.text || a.title || a.tool;

    const quickActions = [];
    if (a.kind === 'image') {
      quickActions.push(`<button type="button" class="btn btn-secondary btn-sm" data-use-action="animate" data-asset-id="${escapeHtml(a.id)}">Animate Image</button>`);
      quickActions.push(`<button type="button" class="btn btn-secondary btn-sm" data-use-action="to3d" data-asset-id="${escapeHtml(a.id)}">Convert to 3D Mesh</button>`);
      quickActions.push(`<button type="button" class="btn btn-ghost btn-sm" data-use-action="pbr" data-asset-id="${escapeHtml(a.id)}">PBR Maps</button>`);
    } else if (a.kind === 'mesh') {
      quickActions.push(`<button type="button" class="btn btn-secondary btn-sm" data-use-action="rig" data-asset-id="${escapeHtml(a.id)}">Auto-Rig GLB</button>`);
    }

    return `
      <article class="asset-card">
        <div>
          <div class="asset-preview">${renderMediaPreview(a)}</div>
          <div class="asset-body">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
              <span class="tool-tag">${escapeHtml(a.tool)}</span>
              <span style="font-size:0.72rem;color:var(--text-dim);font-family:var(--font-mono);">${escapeHtml(a.id)}</span>
            </div>
            <div style="font-size:0.84rem;color:var(--text-secondary);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">
              ${escapeHtml(String(promptText || ''))}
            </div>
          </div>
        </div>
        <div class="asset-body" style="padding-top:0;">
          <div class="asset-actions">
            ${['image', 'mesh', 'audio', 'video'].includes(a.kind) ? `<button type="button" class="btn btn-primary btn-sm" data-to-game="${escapeHtml(a.id)}">Use in a game</button>` : ''}
            ${quickActions.join('')}
            <button type="button" class="btn btn-ghost btn-sm" data-open-recipe="${escapeHtml(a.id)}">Recipe</button>
            <a href="${downloadUrl}" class="btn btn-ghost btn-sm" download>Download ↓</a>
          </div>
        </div>
      </article>
    `;
  }).join('');

  grid.querySelectorAll('[data-use-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const act = btn.getAttribute('data-use-action');
      const assetId = btn.getAttribute('data-asset-id');
      sendAssetToTool(act, `asset:${assetId}`);
    });
  });

  grid.querySelectorAll('[data-to-game]').forEach((btn) => {
    btn.addEventListener('click', () => pickGameFor(state.assets.find((x) => x.id === btn.getAttribute('data-to-game'))));
  });

  grid.querySelectorAll('[data-open-recipe]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const assetId = btn.getAttribute('data-open-recipe');
      const asset = state.assets.find((x) => x.id === assetId);
      if (!asset) return;
      document.getElementById('recipeDrawerTitle').textContent = `${asset.title || asset.id} (${asset.tool})`;
      document.getElementById('recipeDrawerPre').textContent = JSON.stringify(asset.recipe || asset, null, 2);
      document.getElementById('recipeDrawerModal').hidden = false;
    });
  });
}

/** "Use in a game": pick one of your games; the asset joins it and you go in with it placed where you stand. */
async function pickGameFor(asset) {
  if (!asset) return;
  const modal = document.getElementById('gamePickerModal');
  const list = document.getElementById('gamePickerList');
  list.innerHTML = '<p class="muted">Loading your games…</p>';
  modal.hidden = false;
  try {
    const r = await fetch('/v1/games').then((x) => x.json());
    const games = r.games || [];
    if (!games.length) { list.innerHTML = '<p class="muted">No games yet. <a href="/app">Make one</a>, then come back.</p>'; return; }
    list.innerHTML = games.map((g) => `<button type="button" class="game-pick" data-g="${escapeHtml(g.id)}"><b>${escapeHtml(g.title)}</b><span>${escapeHtml(g.role === 'owner' ? 'yours' : 'shared with you')}</span></button>`).join('');
    list.querySelectorAll('[data-g]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      const want = String(asset.title || asset.recipe?.params?.prompt || asset.kind).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || asset.kind;
      const res = await fetch(`/v1/games/${b.dataset.g}/assets`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ asset: asset.id, name: want }) });
      const row = await res.json().catch(() => ({}));
      if (!res.ok) { b.disabled = false; b.querySelector('span').textContent = row.error || 'Could not add it'; return; }
      const go = `/app/g/${b.dataset.g}?place=${encodeURIComponent(row.name)}`;
      if (window.enterGame) window.enterGame(go); else location.href = go;
    }));
  } catch (e) { list.innerHTML = `<p class="muted">${escapeHtml(e.message)}</p>`; }
}

/** Shows what the composer's input box points at: the asset's picture (or player), title and tool, not just its id. */
function showInputPreview(box = document.getElementById('composerInputPreview'), ref = document.getElementById('composerInputAssetRef')?.value.trim() || '') {
  if (!box) return;
  const id = /^asset:(a_[0-9a-f]+)$/.exec(ref)?.[1];
  if (!id) {
    box.hidden = true;
    box.innerHTML = '';
    return;
  }
  // An asset not in the loaded page of the library is still shown, as an image if it is one.
  const asset = state.assets.find((a) => a.id === id) || { id, kind: 'image' };
  box.innerHTML = `
    <div class="asset-preview">${renderMediaPreview(asset)}</div>
    <div>
      <strong style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(asset.title || asset.id)}</strong>
      ${asset.tool ? `<span class="tool-tag" style="justify-self:start;">${escapeHtml(asset.tool)}</span>` : ''}
    </div>`;
  box.querySelector('img')?.addEventListener('error', () => { box.querySelector('.asset-preview').innerHTML = `<div class="tool-tag">${escapeHtml(asset.kind || 'file')}</div>`; });
  box.hidden = false;
}

function sendAssetToTool(action, assetRef) {
  if (action === 'animate') {
    state.studioKey = 'video';
    state.toolIndex = STUDIOS.video.tools.findIndex((t) => t.id === 'video.i2v');
  } else if (action === 'to3d') {
    state.studioKey = 'mesh';
    state.toolIndex = STUDIOS.mesh.tools.findIndex((t) => t.id === 'mesh.textured');
  } else if (action === 'pbr') {
    state.studioKey = 'image';
    state.toolIndex = STUDIOS.image.tools.findIndex((t) => t.id === 'texture.maps');
  } else if (action === 'rig') {
    state.studioKey = 'mesh';
    state.toolIndex = STUDIOS.mesh.tools.findIndex((t) => t.id === 'mesh.rig');
  }
  if (state.toolIndex < 0) state.toolIndex = 0;
  renderStudio();
  const refInput = document.getElementById('composerInputAssetRef');
  if (refInput) refInput.value = assetRef;
  showInputPreview();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  scheduleQuote();
}

function renderLibraryPicker() {
  const grid = document.getElementById('libraryPickerGrid');
  if (!grid) return;
  if (!state.assets.length) {
    grid.innerHTML = '<div style="color:var(--text-muted);padding:16px;">Your library is empty. Upload a file or generate an asset first.</div>';
    return;
  }
  grid.innerHTML = state.assets.map((a) => `
    <div class="asset-card" style="cursor:pointer;" data-pick-asset="asset:${escapeHtml(a.id)}">
      <div class="asset-preview" style="height:130px;">${renderMediaPreview(a)}</div>
      <div class="asset-body">
        <div style="font-size:0.8rem;font-weight:600;">${escapeHtml(a.title || a.id)}</div>
        <span class="tool-tag">${escapeHtml(a.tool)}</span>
      </div>
    </div>
  `).join('');

  grid.querySelectorAll('[data-pick-asset]').forEach((card) => {
    card.addEventListener('click', () => {
      const ref = card.getAttribute('data-pick-asset');
      document.getElementById('composerInputAssetRef').value = ref;
      document.getElementById('libraryPickerModal').hidden = true;
      showInputPreview();
      scheduleQuote();
    });
  });
}

// ============================================================================
// MODALS: CREDIT WALLET / STRIPE CHECKOUT / LEDGER & API KEYS
// ============================================================================

function bindModals() {
  document.getElementById('openBuyCreditsBtn')?.addEventListener('click', () => openCreditsModal());
  document.getElementById('walletCreditPill')?.addEventListener('click', () => openCreditsModal());
  document.getElementById('openApiKeysBtn')?.addEventListener('click', () => {
    document.getElementById('apiKeyModal').hidden = false;
  });

  document.querySelectorAll('[data-close-modal]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-close-modal');
      const modal = document.getElementById(id);
      if (modal) modal.hidden = true;
    });
  });

  document.getElementById('mintApiKeyBtn')?.addEventListener('click', async () => {
    const res = await fetch('/v1/users/api-key', { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.apiKey) {
      document.getElementById('mintedApiKeyInput').value = data.apiKey;
      try { localStorage.setItem('hg_last_minted_key', data.apiKey); } catch {}
      updateKeySnippets(data.apiKey);
    }
  });

  document.getElementById('copyApiKeyBtn')?.addEventListener('click', () => {
    const val = document.getElementById('mintedApiKeyInput')?.value;
    if (val) navigator.clipboard?.writeText(val).catch(() => {});
  });
}

function updateKeySnippets(apiKey) {
  const origin = window.location.origin;
  document.getElementById('snippetCurl').textContent = `curl -X POST ${origin}/v1/jobs \\\n  -H "Authorization: Bearer ${apiKey}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"tool":"image.generate","params":{"prompt":"A glowing obsidian crystal"}}'`;
  document.getElementById('snippetJs').textContent = `import { HawkesGen } from '${origin}/client/hawkesgen.mjs';\nconst gen = new HawkesGen({ url: '${origin}', key: '${apiKey}' });\nconst job = await gen.run('image.generate', { prompt: 'Seamless sci-fi hull plating', seamless: true });`;
  document.getElementById('snippetUnity').textContent = `// Unity Editor: Window > Hawkes Gen -> Server: ${origin} | API Key: ${apiKey}`;
}

async function openCreditsModal() {
  const modal = document.getElementById('creditsModal');
  modal.hidden = false;
  document.getElementById('checkoutErrorBox').style.display = 'none';

  const [packsRes, ledgerRes] = await Promise.all([
    fetch('/v1/billing/packs').catch(() => null),
    fetch('/v1/billing/ledger?limit=50').catch(() => null),
  ]);

  if (packsRes && packsRes.ok) {
    const { packs = [], firstPurchaseBonus = 0 } = await packsRes.json();
    // A first pack comes with more credits (billing.ts FIRST_PURCHASE_BONUS) until the account has bought once.
    const firstBonus = state.user && !state.user.bought ? firstPurchaseBonus : 0;
    const container = document.getElementById('modalPacksContainer');
    container.innerHTML = (firstBonus ? `<div style="grid-column:1/-1;padding:10px 14px;border:1px solid var(--accent, #c8421d);border-radius:var(--radius-md);font-size:0.9rem;">Your first pack comes with <b>${firstBonus}% more credits</b>, on top of any pack bonus.</div>` : '') + packs.map((p) => `
      <div class="pricing-card ${p.id === 'creator_25' ? 'featured' : ''}" style="padding:18px;">
        <div>
          <span class="portfolio-genre">${escapeHtml(p.name)}</span>
          <div style="font-size:1.75rem;font-weight:800;margin:6px 0;">$${escapeHtml(String(p.priceUsd))}</div>
          <div style="color:var(--cyan-400);font-weight:700;margin-bottom:12px;">
            ${Number(p.credits).toLocaleString()} Credits ${p.bonusPercent ? `(+${p.bonusPercent}% Bonus)` : ''}
          </div>
          ${firstBonus ? `<div style="font-size:0.85rem;margin:-6px 0 12px;">+${Math.round((p.credits * firstBonus) / 100).toLocaleString()} first-pack bonus = <b>${Math.round(p.credits * (1 + firstBonus / 100)).toLocaleString()}</b></div>` : ''}
        </div>
        <button type="button" class="btn btn-primary btn-sm" data-checkout-pack="${escapeHtml(p.id)}">
          Buy with Stripe →
        </button>
      </div>
    `).join('');

    container.querySelectorAll('[data-checkout-pack]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const packId = btn.getAttribute('data-checkout-pack');
        track('checkout_start', { pack: packId, first: !state.user?.bought });
        const errBox = document.getElementById('checkoutErrorBox');
        errBox.style.display = 'none';
        btn.disabled = true;
        try {
          const res = await fetch('/v1/billing/checkout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              packId,
              successUrl: `${window.location.origin}/app?checkout=success`,
              cancelUrl: `${window.location.origin}/app?checkout=cancelled`,
            }),
          });
          const body = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(body.error || 'Stripe checkout unavailable');
          if (body.url) window.location.href = body.url;
        } catch (err) {
          errBox.textContent = err.message || String(err);
          errBox.style.display = 'block';
        } finally {
          btn.disabled = false;
        }
      });
    });
  }

  if (ledgerRes && ledgerRes.ok) {
    const ledger = await ledgerRes.json();
    updateWalletUI(ledger.credits);
    const tbody = document.getElementById('creditLedgerTableBody');
    const entries = ledger.entries || [];
    tbody.innerHTML = entries.map((e) => {
      const sign = e.delta > 0 ? '+' : '';
      const color = e.delta > 0 ? 'var(--emerald-400)' : 'var(--text-secondary)';
      return `
        <tr>
          <td style="font-size:0.78rem;color:var(--text-muted);">${new Date(e.created).toLocaleString()}</td>
          <td><span class="tool-tag">${escapeHtml(e.kind)}</span></td>
          <td style="font-size:0.82rem;">${escapeHtml(e.detail || '')}</td>
          <td style="font-weight:700;color:${color};">${sign}${e.delta}</td>
          <td style="font-family:var(--font-mono);">${e.balance_after}</td>
        </tr>
      `;
    }).join('');
  }
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

init();
