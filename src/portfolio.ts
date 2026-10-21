// "Built With Hawkes Gen": the live games and productions across the Hawkes Biomedical universe made with Hawkes Gen.
// Curated counts (the portal has no view of Gen's library, by design).

export type PortfolioItem = {
  id: string;
  project: string;
  title: string;
  genre: string;
  url: string;
  liveUrl: string;
  description: string;
  style: string;
  assetCounts: {
    total: number;
    images: number;
    videos: number;
    audio: number;
    meshes: number;
    entities: number;
  };
  tools: string[];
  pipelines: {
    name: string;
    tools: string[];
    description: string;
  }[];
};

const BASE_PORTFOLIO: PortfolioItem[] = [
  {
    id: 'doseofdestruction',
    project: 'doseofdestruction',
    title: 'Dose Of Destruction',
    genre: '2D Platform Fighter',
    url: 'https://doseofdestruction.com',
    liveUrl: 'https://doseofdestruction.com',
    description:
      'Roster-driven 2D platform fighter where every playable fighter is generated from a concept turnaround into side views, directional combat poses, green-screen move clips, voice lines, and looping stage themes.',
    style:
      'Stylized 3D cartoon render matching the existing roster: clean shapes, bold readable silhouette, saturated colors, soft studio light.',
    assetCounts: {
      total: 1420,
      images: 680,
      videos: 490,
      audio: 230,
      meshes: 20,
      entities: 38,
    },
    tools: ['image.generate', 'image.edit', 'image.angles', 'image.cutout', 'video.i2v', 'audio.voice', 'audio.sfx', 'audio.music', 'llm.json'],
    pipelines: [
      {
        name: 'Fighter Move Pipeline',
        tools: ['image.generate', 'image.edit', 'video.i2v', 'image.cutout'],
        description: 'Concept -> green-screen front reference -> side profile -> start/end combat poses -> 16 fps Wan 2.2 move clips.',
      },
      {
        name: 'Stage & Soundtrack Pipeline',
        tools: ['image.generate', 'audio.music', 'audio.sfx', 'audio.voice'],
        description: 'Wide side-on stage backdrops paired with 90-second loopable instrumental stage themes, combat SFX, and fighter voice barks.',
      },
    ],
  },
  {
    id: 'phorigins',
    project: 'phorigins',
    title: 'PH Origins',
    genre: '3D Corporate Thriller',
    url: 'https://phorigins.com',
    liveUrl: 'https://phorigins.com',
    description:
      'First-person 3D thriller set across one rain-soaked night inside Hawkes Tower. Uses Hawkes Gen for four-view 3D GLB props, PBR material maps, 360° skybox panoramas, 3D Gaussian Splat sets, and voiced dialogue.',
    style:
      'Grounded, cinematic corporate thriller look: one night in Hawkes Tower, cool artificial light, deep shadows, rain-wet city.',
    assetCounts: {
      total: 860,
      images: 410,
      videos: 65,
      audio: 240,
      meshes: 145,
      entities: 112,
    },
    tools: ['image.generate', 'image.remove-background', 'image.viewsheet', 'mesh.views3d', 'texture.maps', 'image.panorama', 'splat.build', 'video.i2v', 'audio.voice', 'audio.sfx', 'llm.json'],
    pipelines: [
      {
        name: 'Multi-View 3D Prop Pipeline',
        tools: ['image.generate', 'image.remove-background', 'image.viewsheet', 'mesh.views3d'],
        description: 'Front reference -> cutout -> verified 4-view turnaround sheet (front, back, left, right) -> textured GLB mesh.',
      },
      {
        name: 'PBR Materials & 3D Gaussian Splats',
        tools: ['image.generate', 'texture.maps', 'image.panorama', 'splat.build'],
        description: 'Seamless architectural textures expanded into normal/roughness/metallic maps, 360° equirectangular skyboxes, and .splat environments.',
      },
    ],
  },
  {
    id: 'sickofit',
    project: 'sickofit',
    title: 'Sick Of It',
    genre: '2D Action Roguelite',
    url: 'https://sickofitgame.com',
    liveUrl: 'https://sickofitgame.com',
    description:
      'Fast 90s-arcade ascent through 1,000 floors of Hell in Unity WebGL. Demon enemies, multi-state animation clips, booming announcer lines, and driving floor soundtracks are built through Hawkes Gen.',
    style:
      'Dark fantasy video game character art: painterly, detailed, gritty, warm rim light from hellfire, readable silhouette.',
    assetCounts: {
      total: 940,
      images: 460,
      videos: 310,
      audio: 170,
      meshes: 0,
      entities: 44,
    },
    tools: ['image.paint', 'image.edit', 'image.generate', 'video.i2v', 'audio.music', 'audio.voice', 'audio.voice-design', 'audio.sfx'],
    pipelines: [
      {
        name: 'Enemy Animator Sheet Pipeline',
        tools: ['image.paint', 'image.edit', 'video.i2v'],
        description: 'Standing side-profile creature painted on #00ff00 -> action poses (move, attack, hurt, die) -> transition video clips.',
      },
      {
        name: 'Arcade Audio & Announcer Pipeline',
        tools: ['audio.voice-design', 'audio.voice', 'audio.sfx', 'audio.music'],
        description: 'Custom voice design for Hell’s announcer, combat hit/spell SFX, and loopable 90s arcade floor themes.',
      },
    ],
  },
  {
    id: 'yoobaland',
    project: 'yoobaland',
    title: 'Yooba Land',
    genre: '3D Creature Adventure',
    url: 'https://yoobalandgame.com',
    liveUrl: 'https://yoobalandgame.com',
    description:
      'Bright stylized 3D adventure in Unity URP where Yooba eats, grows, and finds the way home across low-poly fantasy islands populated with generated 3D props, rigged characters, and ambient music.',
    style:
      'Stylized low-poly fantasy, bright cartoon colors, clean outlines, cartoon grass.',
    assetCounts: {
      total: 320,
      images: 150,
      videos: 25,
      audio: 85,
      meshes: 60,
      entities: 28,
    },
    tools: ['image.generate', 'image.remove-background', 'image.viewsheet', 'mesh.views3d', 'mesh.rig', 'blender.character', 'audio.music', 'audio.sfx'],
    pipelines: [
      {
        name: 'Stylized 3D World & Character Pipeline',
        tools: ['image.generate', 'image.viewsheet', 'mesh.views3d', 'mesh.rig', 'blender.character'],
        description: 'Low-poly fantasy concept art -> 4-view turnaround verification -> 3D mesh generation, rigging, and Quaternius motion retargeting.',
      },
    ],
  },
  {
    id: 'theplacedepartment',
    project: 'theplacedepartment',
    title: 'The Place Department',
    genre: '3D Stylized Wave Defense',
    url: 'https://theplacedepartment.com',
    liveUrl: 'https://theplacedepartment.com',
    description:
      'Moonlit 3D wave-defense game where Warrok defends a pirate playing solo shanty piano in a misty hollow against waves of nocturnal birds.',
    style:
      'Moonlit grassy hollow at night, stylized low-poly, soft lantern light and mist.',
    assetCounts: {
      total: 240,
      images: 110,
      videos: 15,
      audio: 75,
      meshes: 40,
      entities: 22,
    },
    tools: ['image.generate', 'blender.character', 'audio.music', 'audio.sfx', 'audio.voice'],
    pipelines: [
      {
        name: 'Moonlit Bird Roster & Piano Shanty Pipeline',
        tools: ['image.generate', 'blender.character', 'audio.music', 'audio.sfx'],
        description: 'Species concept silhouettes, Blender character/bird rig pipelines, and loopable solo piano shanty themes.',
      },
    ],
  },
  {
    id: 'imaginelivetv',
    project: 'imaginelivetv',
    title: 'Imagine Live TV',
    genre: 'Interactive FMV Story',
    url: 'https://imaginelivetv.com',
    liveUrl: 'https://imaginelivetv.com',
    description:
      'The Final Spark: a branching choose-your-path live-action video thriller where every decision leads to a narrated cinematic scene.',
    style:
      'Cinematic live-action video still, gritty, low light, handheld feel.',
    assetCounts: {
      total: 390,
      images: 160,
      videos: 140,
      audio: 90,
      meshes: 0,
      entities: 34,
    },
    tools: ['image.generate', 'image.edit', 'video.i2v', 'video.compose', 'audio.voice', 'audio.sfx', 'llm.json'],
    pipelines: [
      {
        name: 'Interactive Branch Cinema Pipeline',
        tools: ['llm.json', 'image.edit', 'video.i2v', 'audio.voice', 'video.compose'],
        description: 'Character seed sheets keep cast continuity across branches while stills animate into narrated, scored FMV story clips.',
      },
    ],
  },
  {
    id: 'icanbe',
    project: 'icanbe',
    title: 'I Can Be',
    genre: 'Real-Time Life Simulation',
    url: 'https://icanbe.ai',
    liveUrl: 'https://icanbe.ai',
    description:
      'Quiet suburban 3D diorama simulation of an ordinary day, presented as Hawkes Biomedical’s AI-assisted full-body assessment experience.',
    style:
      'Quiet suburban diorama of one ordinary day: simple box-built rooms, street and furniture, matte muted greens, warm creams and asphalt greys, soft hemispheric daylight.',
    assetCounts: {
      total: 150,
      images: 70,
      videos: 10,
      audio: 45,
      meshes: 25,
      entities: 16,
    },
    tools: ['llm.text', 'llm.json', 'image.generate', 'audio.sfx', 'audio.music'],
    pipelines: [
      {
        name: 'Simulation Narrative & Ambient Audio Pipeline',
        tools: ['llm.text', 'llm.json', 'image.generate', 'audio.sfx'],
        description: 'Structured daily simulation events, suburban diorama concept references, and subtle domestic ambient audio.',
      },
    ],
  },
];

export function getPortfolio() {
  const items = BASE_PORTFOLIO;

  const totals = items.reduce(
    (acc, it) => ({
      games: acc.games + 1,
      assets: acc.assets + it.assetCounts.total,
      entities: acc.entities + it.assetCounts.entities,
    }),
    { games: 0, assets: 0, entities: 0 },
  );

  return {
    title: 'Built With Hawkes Gen',
    studio: 'Hawkes Biomedical',
    totals,
    items,
    projects: items,
  };
}
