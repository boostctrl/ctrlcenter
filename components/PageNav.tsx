import Link from "next/link";
import BackHome from "./BackHome";
import Icon from "./Icon";
import type { NavPages } from "@/lib/nav";

// The shared subpage navigation strip (#164): one identical row at the top of
// every page outside the home dashboard — the back-home link plus the site's
// pages, with the current page emphasized and unlinked. The dashboard itself
// stays chrome-free (FloatingNav is its navigation); this strip is how
// subpages reach each other without bouncing through home or the corner menu.
// Which feature pages appear comes from lib/nav.ts navPages — the same source
// as the floating menu, so the two surfaces can't drift. The admin portal
// renders the strip with no current page: it's a gated portal, not a sibling
// page, so it isn't listed here (it stays in the floating menu). With more
// than one board (#298), the boards after the home board follow the back-home
// link, which stands for the home board. A board with an icon (#316) shows it
// before its name, and on phones in place of it (the name stays for screen
// readers), the way BackHome goes icon-only there.

export type PageNavCurrent =
  | "weather"
  | "status"
  | "calendar"
  | "help"
  | "settings"
  | null;

export default function PageNav({
  current,
  boards,
  weather,
  status,
  calendar,
}: NavPages & { current: PageNavCurrent }) {
  const pages = (
    [
      ...boards.slice(1).map((b) => ({ key: `board:${b.id}`, href: b.href, label: b.name, icon: b.icon })),
      weather ? { key: "weather", href: "/weather", label: "Weather" } : null,
      status ? { key: "status", href: "/status", label: "Status" } : null,
      calendar ? { key: "calendar", href: "/calendar", label: "Calendar" } : null,
      { key: "help", href: "/help", label: "Help" },
      { key: "settings", href: "/settings", label: "Settings" },
    ].filter(Boolean) as { key: string; href: string; label: string; icon?: string }[]
  );

  return (
    // One line at every width (#272): tighter gaps and an icon-only back link
    // on phones, and a sideways scroll rather than a wrap if a long page list
    // still doesn't fit. py/-my keep focus rings clear of the scroll clip.
    <nav
      aria-label="Site pages"
      className="-my-1 flex items-center gap-x-3 overflow-x-auto py-1 whitespace-nowrap sm:gap-x-4"
    >
      <BackHome label={boards.length > 1 ? boards[0].name : "Dashboard"} compact />
      <span aria-hidden className="h-3.5 w-px shrink-0 bg-fg/15" />
      {pages.map((p) =>
        p.key === current ? (
          <span
            key={p.key}
            aria-current="page"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-90"
          >
            <PageLabel {...p} />
          </span>
        ) : (
          <Link
            key={p.key}
            href={p.href}
            className="inline-flex items-center gap-1.5 text-sm text-ink-50 transition-colors hover:text-ink-80"
          >
            <PageLabel {...p} />
          </Link>
        )
      )}
    </nav>
  );
}

function PageLabel({ label, icon }: { label: string; icon?: string }) {
  if (!icon) return <>{label}</>;
  return (
    <>
      <Icon icon={icon} name={label} size={16} />
      <span className="max-sm:sr-only">{label}</span>
    </>
  );
}
