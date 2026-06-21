"use client";

import { useVisitorPrefs } from "../PrefsProvider";
import { SCENE_REGISTRY } from "./index";

// Renders the active scene's backdrop + ornament. Lives inside PrefsProvider so
// it follows the visitor's scene choice; SSR'd with the admin default scene so
// the first paint matches the server (the canvas/ornament just start animating
// after hydration). Falls back to Aurora for any unknown stored value.
export default function SceneLayer() {
  const { scene, surfaceIsLight } = useVisitorPrefs();
  const { Backdrop, Ornament } = SCENE_REGISTRY[scene] ?? SCENE_REGISTRY.aurora;
  return (
    <>
      <Backdrop light={surfaceIsLight} />
      {Ornament ? <Ornament light={surfaceIsLight} /> : null}
    </>
  );
}
