// The default scene: three softly floating accent glow blobs behind everything.
// Lifted verbatim from the old hardcoded layout markup; gated by --glow-opacity
// (designs dim or disable it) and recolored by the accent CSS vars. The float
// animation is disabled under prefers-reduced-motion (see globals.css).
export default function Aurora() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
      style={{ opacity: "var(--glow-opacity, 1)" }}
    >
      <div
        className="animate-float absolute -top-32 -left-32 h-96 w-96 rounded-full opacity-30 blur-3xl"
        style={{ backgroundColor: "var(--accent-from)" }}
      />
      <div
        className="animate-float absolute top-1/3 -right-32 h-[28rem] w-[28rem] rounded-full opacity-20 blur-3xl"
        style={{ backgroundColor: "var(--accent-to)", animationDelay: "4s" }}
      />
      <div
        className="animate-float absolute bottom-0 left-1/4 h-80 w-80 rounded-full opacity-[0.15] blur-3xl"
        style={{ backgroundColor: "var(--accent-from)", animationDelay: "8s" }}
      />
    </div>
  );
}
