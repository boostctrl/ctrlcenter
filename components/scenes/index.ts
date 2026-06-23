import type { ComponentType } from "react";
import type { SceneId } from "@/lib/theme";
import Aurora from "./Aurora";
import { AbyssBackdrop } from "./Abyss";
import Nebula from "./Nebula";
import Grid from "./Grid";
import Starfield from "./Starfield";
import Waves from "./Waves";
import Mesh from "./Mesh";
import Constellation from "./Constellation";

// Scenes render a different treatment for light vs dark surfaces, so each
// backdrop receives the resolved surface lightness.
export type SceneProps = { light: boolean };

// Maps each scene to its backdrop component (a fixed layer behind everything).
// <SceneLayer> renders the active scene; the `scene-<id>` class on <html> covers
// any pure-CSS styling. To add a scene: build the component, register it here,
// and add its id to lib/theme.ts SCENES.
export const SCENE_REGISTRY: Record<SceneId, ComponentType<SceneProps>> = {
  aurora: Aurora,
  abyss: AbyssBackdrop,
  nebula: Nebula,
  grid: Grid,
  starfield: Starfield,
  waves: Waves,
  mesh: Mesh,
  constellation: Constellation,
};
