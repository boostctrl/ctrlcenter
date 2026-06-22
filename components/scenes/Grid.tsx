import type { CSSProperties } from "react";
import type { SceneProps } from "./index";

const SIZE = 48;

// Grid — a perspective grid receding to the horizon. Dark = a glowing synthwave
// grid; light = a clean flat blueprint grid (no glow). The plane scrolls toward
// the viewer (animate-grid), recolored from the accent var. Motion stops under
// prefers-reduced-motion.
export default function Grid({ light }: SceneProps) {
  const line = light
    ? "color-mix(in srgb, var(--accent-from) 22%, transparent)"
    : "color-mix(in srgb, var(--accent-from) 42%, transparent)";

  const plane: CSSProperties = {
    ["--grid-size" as string]: `${SIZE}px`,
    width: "240%",
    height: "65%",
    marginLeft: "-120%",
    backgroundImage: `linear-gradient(to right, ${line} 1px, transparent 1px), linear-gradient(to bottom, ${line} 1px, transparent 1px)`,
    backgroundSize: `${SIZE}px ${SIZE}px`,
    transform: "perspective(320px) rotateX(70deg)",
    transformOrigin: "bottom center",
    maskImage: "linear-gradient(to top, black 28%, transparent 92%)",
    WebkitMaskImage: "linear-gradient(to top, black 28%, transparent 92%)",
  };

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    >
      {!light && (
        <div
          className="absolute inset-x-0"
          style={{
            top: "50%",
            height: "200px",
            background:
              "radial-gradient(60% 100% at 50% 0%, color-mix(in srgb, var(--accent-from) 32%, transparent), transparent 72%)",
            filter: "blur(24px)",
          }}
        />
      )}
      <div className="animate-grid absolute bottom-0 left-1/2" style={plane} />
    </div>
  );
}
