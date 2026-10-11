import type { ReactNode } from "react";

// The heading over a block of a builder tab: a small tracked eyebrow and one
// line on what the block does, the shape the Font tab's Headings and Density
// blocks set. `id` names the block for aria-labelledby.
export function SectionHeading({
  id,
  eyebrow,
  children,
}: {
  id?: string;
  eyebrow: string;
  children: ReactNode;
}) {
  return (
    <div>
      <span id={id} className="text-[10px] font-semibold tracking-[0.15em] text-ink-45 uppercase">
        {eyebrow}
      </span>
      <p className="text-xs text-ink-40">{children}</p>
    </div>
  );
}
