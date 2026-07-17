import Link from "next/link";
import BackHome from "./BackHome";

// The shared subpage navigation strip (#164): one identical row at the top of
// every page outside the home dashboard — the back-home link plus the site's
// pages, with the current page emphasized and unlinked. The dashboard itself
// stays chrome-free (FloatingNav is its navigation); this strip is how
// subpages reach each other without bouncing through home or the corner menu.
// Which feature pages appear comes from lib/nav.ts navPages — the same source
// as the floating menu, so the two surfaces can't drift. The admin portal
// renders the strip with no current page: it's a gated portal, not a sibling
// page, so it isn't listed here (it stays in the floating menu).

export type PageNavCurrent =
  | "weather"
  | "status"
  | "calendar"
  | "help"
  | "settings"
  | null;

export default function PageNav({
  current,
  weather,
  status,
  calendar,
}: {
  current: PageNavCurrent;
  weather: boolean;
  status: boolean;
  calendar: boolean;
}) {
  const pages = (
    [
      weather ? { key: "weather", href: "/weather", label: "Weather" } : null,
      status ? { key: "status", href: "/status", label: "Status" } : null,
      calendar ? { key: "calendar", href: "/calendar", label: "Calendar" } : null,
      { key: "help", href: "/help", label: "Help" },
      { key: "settings", href: "/settings", label: "Settings" },
    ].filter(Boolean) as { key: string; href: string; label: string }[]
  );

  return (
    <nav
      aria-label="Site pages"
      className="flex flex-wrap items-center gap-x-4 gap-y-1"
    >
      <BackHome label="Dashboard" />
      <span aria-hidden className="h-3.5 w-px bg-fg/15" />
      {pages.map((p) =>
        p.key === current ? (
          <span
            key={p.key}
            aria-current="page"
            className="text-sm font-medium text-fg/90"
          >
            {p.label}
          </span>
        ) : (
          <Link
            key={p.key}
            href={p.href}
            className="text-sm text-fg/50 transition-colors hover:text-fg/80"
          >
            {p.label}
          </Link>
        )
      )}
    </nav>
  );
}
