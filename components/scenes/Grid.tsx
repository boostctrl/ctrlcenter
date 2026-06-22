import type { CSSProperties } from "react";
import type { SceneProps } from "./index";

const SIZE = 48;

// Grid — a full-page grid background plus a perspective floor receding to the
// horizon. A faint flat grid covers the whole viewport (the general grid
// backdrop that the Bold/Cyber designs used to bake in), and the scrolling
// perspective plane (animate-grid) adds depth. Dark = glowing synthwave; light =
// a clean blueprint grid (no glow). Recolored from the accent var; motion stops
// under prefers-reduced-motion.
export default function Grid({ light }: SceneProps) {
  const line = light
    ? "color-mix(in srgb, var(--accent-from) 22%, transparent)"
    : "color-mix(in srgb, var(--accent-from) 42%, transparent)";
  const flatLine = light
    ? "color-mix(in srgb, var(--accent-from) 13%, transparent)"
    : "color-mix(in srgb, var(--accent-from) 16%, transparent)";
  const flatMask =
    "linear-gradient(to bottom, transparent, black 28%, black 68%, transparent)";

  const flat: CSSProperties = {
    backgroundImage: `linear-gradient(to right, ${flatLine} 1px, transparent 1px), linear-gradient(to bottom, ${flatLine} 1px, transparent 1px)`,
    backgroundSize: `${SIZE}px ${SIZE}px`,
    maskImage: flatMask,
    WebkitMaskImage: flatMask,
  };

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
      <div className="absolute inset-0" style={flat} />
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
