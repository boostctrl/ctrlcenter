// The app's canonical button recipe, shared by the admin <Button> component,
// links styled as buttons, and one-off buttons outside the admin — so every
// button-shaped control uses the same geometry and variants instead of
// hand-rolled near-misses. Plain module (no "use client") so server components
// can use it too.

export type ButtonVariant = "primary" | "ghost" | "danger";

export function buttonClasses(variant: ButtonVariant = "primary"): string {
  const base =
    "rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
  const variants: Record<ButtonVariant, string> = {
    primary: "btn-accent",
    ghost: "border border-fg/10 bg-fg/5 text-fg/80 hover:bg-fg/10",
    danger:
      "border border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20",
  };
  return `${base} ${variants[variant]}`;
}
