// The small line icons the integration pages use (#508), drawn on a 24-unit
// grid at one stroke weight so they read as a set. Decorative: the text
// beside each says what it means.
import type { ReactNode } from "react";

const PATHS = {
  download: <path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19h14" />,
  upload: <path d="M12 15V4m0 0L7.5 8.5M12 4l4.5 4.5M5 19h14" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  calendar: (
    <>
      <rect x="4" y="5.5" width="16" height="14" rx="2.5" />
      <path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" />
    </>
  ),
  alert: (
    <>
      <path d="M12 4.5 3.5 19h17L12 4.5Z" strokeLinejoin="round" />
      <path d="M12 10v4M12 16.5v.01" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5M12 8v.01" />
    </>
  ),
  error: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m9 9 6 6m0-6-6 6" />
    </>
  ),
  offline: (
    <>
      <path d="M4.5 9.5a11 11 0 0 1 15 0M7.5 12.8a6.5 6.5 0 0 1 9 0M10.5 16a2 2 0 0 1 3 0" />
      <path d="m4 4 16 16" />
    </>
  ),
  inbox: <path d="M4 13.5 6.5 6h11l2.5 7.5V18a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18v-4.5Zm0 0h4.5l1.5 2.5h4l1.5-2.5H20" />,
  pulse: <path d="M3.5 12h4l2-5.5 4 11 2-5.5h5" />,
  box: (
    <>
      <path d="M12 3.5 19.5 7.5v9L12 20.5 4.5 16.5v-9L12 3.5Z" />
      <path d="M4.5 7.5 12 11.5l7.5-4M12 11.5v9" />
    </>
  ),
  server: (
    <>
      <rect x="4" y="4.5" width="16" height="6.5" rx="1.5" />
      <rect x="4" y="13" width="16" height="6.5" rx="1.5" />
      <path d="M7.5 7.75h.01M7.5 16.25h.01" />
    </>
  ),
  disk: (
    <>
      <ellipse cx="12" cy="6.5" rx="7.5" ry="2.75" />
      <path d="M4.5 6.5v11c0 1.5 3.4 2.75 7.5 2.75s7.5-1.25 7.5-2.75v-11M4.5 12c0 1.5 3.4 2.75 7.5 2.75s7.5-1.25 7.5-2.75" />
    </>
  ),
  wifi: (
    <>
      <path d="M4 9.5a11.5 11.5 0 0 1 16 0M7 12.75a7 7 0 0 1 10 0M10 16a2.75 2.75 0 0 1 4 0" />
      <path d="M12 19h.01" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.4 2.4 3.5 5.3 3.5 8.5s-1.1 6.1-3.5 8.5c-2.4-2.4-3.5-5.3-3.5-8.5s1.1-6.1 3.5-8.5Z" />
    </>
  ),
  camera: (
    <>
      <rect x="3.5" y="7" width="12" height="10" rx="2" />
      <path d="m15.5 10.5 5-2.5v8l-5-2.5" />
    </>
  ),
  chevron: <path d="m9 6 6 6-6 6" />,
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5" />
    </>
  ),
  play: <path d="M8 5.5v13l10.5-6.5L8 5.5Z" strokeLinejoin="round" />,
  pause: <path d="M8.5 5.5v13M15.5 5.5v13" />,
  film: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2.5" />
      <path d="M8 4v16M16 4v16M4 9h4M4 15h4M16 9h4M16 15h4" />
    </>
  ),
  tv: (
    <>
      <rect x="3.5" y="6" width="17" height="12" rx="2.5" />
      <path d="m9 3 3 3 3-3M8 21h8" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type GlyphName = keyof typeof PATHS;

export function Glyph({ name, className = "h-4 w-4" }: { name: GlyphName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      {PATHS[name]}
    </svg>
  );
}
