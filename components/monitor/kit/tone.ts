// The status tones every integration page speaks in (#508): what's fine,
// what needs a look, what's broken, what's merely informative, and what's
// neutral. Each maps to the theme's status colors, which deepen in light
// mode so the text keeps its contrast.
export type Tone = "up" | "warn" | "down" | "info" | "muted";

// A small round marker.
export const TONE_DOT: Record<Tone, string> = {
  up: "bg-status-up",
  warn: "bg-status-warning",
  down: "bg-status-down",
  info: "bg-status-info",
  muted: "bg-fg/30",
};

// Text in the tone's color.
export const TONE_TEXT: Record<Tone, string> = {
  up: "text-status-up",
  warn: "text-status-warning",
  down: "text-status-down",
  info: "text-status-info",
  muted: "text-ink-55",
};

// A soft tinted chip: the tone's color over a wash of itself.
export const TONE_SOFT: Record<Tone, string> = {
  up: "bg-status-up/12 text-status-up",
  warn: "bg-status-warning/15 text-status-warning",
  down: "bg-status-down/12 text-status-down",
  info: "bg-status-info/12 text-status-info",
  muted: "bg-fg/[0.07] text-ink-60",
};

// A filled bar in the tone.
export const TONE_FILL: Record<Tone, string> = {
  up: "bg-status-up/80",
  warn: "bg-status-warning/85",
  down: "bg-status-down/85",
  info: "bg-status-info/75",
  muted: "bg-fg/25",
};
