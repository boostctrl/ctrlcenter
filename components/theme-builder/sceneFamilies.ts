import { SCENES, type SceneId } from "@/lib/theme";

// How the Scene tab lays the scenes out: in families, one labelled row each,
// so twenty-five tiles read as five short rows instead of one long grid.
// Typed over every SceneId — a new scene with no family fails `npm run
// typecheck`, the same guard as the swatch record (scenePreview.ts). "none"
// is no tile at all: the current-scene panel turns the backdrop off.
export type SceneFamilyId = "glow" | "sky" | "water" | "land" | "lines";

export const SCENE_FAMILIES: { id: SceneFamilyId; name: string; description: string }[] = [
  { id: "glow", name: "Light & glow", description: "Soft washes and beams of accent light" },
  { id: "sky", name: "Sky & space", description: "Stars, planets, comets and a setting sun" },
  { id: "water", name: "Water & weather", description: "Waves, rain, snow and the deep" },
  { id: "land", name: "Land & nature", description: "Ridgelines, contours, petals and sparks" },
  { id: "lines", name: "Lines & geometry", description: "Grids, traces, shards and glyphs" },
];

const SCENE_FAMILY: Record<SceneId, SceneFamilyId | null> = {
  none: null,
  aurora: "glow",
  nebula: "glow",
  rays: "glow",
  beams: "glow",
  bokeh: "glow",
  starfield: "sky",
  comets: "sky",
  orbit: "sky",
  fireflies: "sky",
  horizon: "sky",
  waves: "water",
  abyss: "water",
  rain: "water",
  snow: "water",
  bubbles: "water",
  peaks: "land",
  topography: "land",
  petals: "land",
  embers: "land",
  grid: "lines",
  blueprint: "lines",
  traces: "lines",
  dots: "lines",
  prisms: "lines",
  glyphs: "lines",
};

// Each family with its scenes in registry order.
export const SCENE_ROWS = SCENE_FAMILIES.map((f) => ({
  ...f,
  scenes: SCENES.filter((s) => SCENE_FAMILY[s.id] === f.id),
}));
