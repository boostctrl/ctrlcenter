import type { LayoutWidget } from "./layout";
import type { Config } from "./schema";
import { shownToGuests } from "./widgets/integration-tiles";

// The rows of a board this viewer gets. An admin sees every row, the hidden
// ones included (the editor shows them dimmed). Anyone else sees the rows on
// show, less the ones with nothing for them: an apps widget showing only
// private apps when none of the viewer's apps is private (#299) — a
// visitor's never are, a member's are the ones shared with them (#451) —
// an integration tile not set to "Everyone" (#301), and an API widget that
// isn't public (#302). `apps` is the list already filtered for the viewer
// (readPublicConfig), so the test is on what they may see, not on the flag.
export function rowsFor(
  resolved: readonly LayoutWidget[],
  instances: Config["widgets"],
  apps: readonly { private: boolean }[],
  isAdmin: boolean
): LayoutWidget[] {
  if (isAdmin) return [...resolved];
  const anyPrivate = apps.some((a) => a.private);
  const withheld = new Set(
    instances
      .filter(
        (w) =>
          (w.type === "apps" && w.filter.private === "only" && !anyPrivate) ||
          (w.type === "integration" && !shownToGuests(w)) ||
          (w.type === "api" && w.visibility !== "public")
      )
      .map((w) => w.id)
  );
  return resolved.filter((w) => !w.hidden && !withheld.has(w.id));
}
