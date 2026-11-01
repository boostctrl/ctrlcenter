import type { ComponentType } from "react";
import type { MotionLevel, SceneId } from "@/lib/theme";
import Aurora from "./Aurora";
import { AbyssBackdrop } from "./Abyss";
import Nebula from "./Nebula";
import Grid from "./Grid";
import Starfield from "./Starfield";
import Waves from "./Waves";
import Rays from "./Rays";
import Traces from "./Traces";
import Dots from "./Dots";
import Horizon from "./Horizon";
import Orbit from "./Orbit";
import Peaks from "./Peaks";
import Rain from "./Rain";
import Fireflies from "./Fireflies";
import Blueprint from "./Blueprint";
import Prisms from "./Prisms";
import Petals from "./Petals";
import Comets from "./Comets";
import Topography from "./Topography";
import Snow from "./Snow";
import Embers from "./Embers";
import Bokeh from "./Bokeh";
import Beams from "./Beams";
import Bubbles from "./Bubbles";
import Glyphs from "./Glyphs";

// Scenes render a different treatment for light vs dark surfaces, so each
// backdrop receives the resolved surface lightness, and the motion level it
// should run at (#327): "normal" as designed, "calm" at half speed, "off" a
// still frame. Canvas scenes read the prop; CSS-animated ones follow the
// data-motion attribute the resolver sets on <html>. The OS reduced-motion
// preference stills everything regardless — live, through
// usePrefersReducedMotion in the canvas scenes (#395). The accent pair on
// screen comes along as a dependency: a canvas scene reads its colors from
// the painted --accent-* vars when its effect runs, so an accent change
// re-runs it and recolours the field (#395).
export type SceneProps = { light: boolean; motion: MotionLevel; accentFrom: string; accentTo: string };

// The None scene: a plain surface, nothing drawn.
function None() {
  return null;
}

// Maps each scene to its backdrop component (a fixed layer behind everything).
// <SceneLayer> renders the active scene; the `scene-<id>` class on <html> covers
// any pure-CSS styling. To add a scene: build the component, register it here,
// and add its id to lib/theme.ts SCENES.
export const SCENE_REGISTRY: Record<SceneId, ComponentType<SceneProps>> = {
  none: None,
  aurora: Aurora,
  abyss: AbyssBackdrop,
  nebula: Nebula,
  grid: Grid,
  starfield: Starfield,
  waves: Waves,
  rays: Rays,
  traces: Traces,
  dots: Dots,
  horizon: Horizon,
  orbit: Orbit,
  peaks: Peaks,
  rain: Rain,
  fireflies: Fireflies,
  blueprint: Blueprint,
  prisms: Prisms,
  petals: Petals,
  comets: Comets,
  topography: Topography,
  snow: Snow,
  embers: Embers,
  bokeh: Bokeh,
  beams: Beams,
  bubbles: Bubbles,
  glyphs: Glyphs,
};
