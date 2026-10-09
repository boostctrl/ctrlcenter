"use client";

import { useVisitorPrefs } from "../PrefsProvider";
import { SCENE_REGISTRY } from "./index";

// Renders the active scene's backdrop. Lives inside PrefsProvider so it follows
// the visitor's scene choice; SSR'd with the admin default scene so the first
// paint matches the server (canvas scenes just start animating after
// hydration). Falls back to Aurora for any unknown stored value.
export default function SceneLayer() {
  const { scene, surfaceIsLight } = useVisitorPrefs();
  const Backdrop = SCENE_REGISTRY[scene] ?? SCENE_REGISTRY.aurora;
  return (
    <>
      <Backdrop light={surfaceIsLight} />
      {/* Light mode deepens scene colors so they read on the pale page, but
          the bolder shapes (Horizon's sun, Rays, Peaks) then fought the text on
          cards above them. A wash of the page color softens every scene
          evenly (#277). Same -z-10 layer, painted after the backdrop. */}
      {surfaceIsLight && (
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 -z-10 bg-[var(--background)]/40"
        />
      )}
    </>
  );
}
