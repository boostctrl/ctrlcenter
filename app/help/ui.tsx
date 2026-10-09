// Shared bits of the help page's markup.
import type { ReactNode } from "react";

// Body paragraph — the default prose style used throughout the cards.
export function P({ children }: { children: ReactNode }) {
  return <p className="text-sm text-ink-70">{children}</p>;
}
