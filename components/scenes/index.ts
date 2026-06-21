import type { ComponentType } from "react";
import type { SceneId } from "@/lib/theme";
import Aurora from "./Aurora";
import { AbyssBackdrop, AbyssOrnament } from "./Abyss";

// Maps each scene to its backdrop (behind everything) and optional signature
// ornament. <SceneLayer> renders the active scene's pair; the scene's CSS class
// on <html> handles any pure-CSS styling. To add a scene: build the components
// and register them here (plus its id in lib/theme.ts SCENES).
export const SCENE_REGISTRY: Record<
  SceneId,
  { Backdrop: ComponentType; Ornament?: ComponentType }
> = {
  aurora: { Backdrop: Aurora },
  abyss: { Backdrop: AbyssBackdrop, Ornament: AbyssOrnament },
};
