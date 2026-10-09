// Each widget's help card for /help (#285), keyed by widget id beside the
// widget registry (lib/widgets/defs.ts) and listed there in registry order,
// under "For admins: the home page".
import type { ReactNode } from "react";
import type { WidgetType } from "@/lib/layout";
import { P } from "./ui";

export const WIDGET_HELP: Partial<Record<WidgetType, { title: string; body: ReactNode }>> = {
  notes: {
    title: "Notes card",
    body: (
      <>
        <P>
          A free-form card for anything worth keeping in view — maintenance
          reminders, runbook snippets, a message for the household. Write it
          in <strong>Settings → Widgets → Notes</strong> using a safe markdown subset
          (headings, bold and italic, links, lists, quotes, and code
          blocks), then show the card from the home-page layout editor. Raw
          HTML is displayed as text, never rendered.
        </P>
      </>
    ),
  },
  feed: {
    title: "RSS feed card",
    body: (
      <>
        <P>
          Show the latest headlines from one or more RSS, Atom, or JSON
          feeds — news sites, blogs, release notes — merged into a single list,
          newest-first. Add feed URLs in{" "}
          <strong>Settings → Widgets → RSS feeds</strong> (the{" "}
          <strong>Test feed</strong> button confirms each is readable, and
          if you paste a site&apos;s home page it offers to fill in the
          feed it links to), pick how many entries to show, then show the
          card from the home-page layout editor. Add several cards for
          topical sources — a News card and a Releases card, say — and
          place each one separately on the dashboard. With several feeds each entry is labelled by its
          source; entries are fetched server-side and cached for a few
          minutes, and a slow or unreachable feed drops out rather than
          emptying the card. A <strong>Show summaries</strong> toggle adds
          a short snippet from each entry under its headline.
        </P>
      </>
    ),
  },
  countdown: {
    title: "Countdown card",
    body: (
      <>
        <P>
          Labeled dates shown as &ldquo;in N days&rdquo; rows — domain
          renewals, birthdays, deadlines. Add them in{" "}
          <strong>Settings → Widgets → Countdowns</strong>, then show the card from
          the home-page layout editor. Days count in each visitor&apos;s
          own time zone; today and tomorrow get an accent chip, and past
          dates dim and sink below the upcoming ones.
        </P>
      </>
    ),
  },
  worldClocks: {
    title: "World clocks card",
    body: (
      <>
        <P>
          Live clocks for the time zones you follow — one row each with its
          current time and its own local date. Add zones in{" "}
          <strong>Settings → Widgets → World clocks</strong> (each takes an
          optional label; leave it blank to use the zone&apos;s city name),
          then show the card from the home-page layout editor.
        </P>
      </>
    ),
  },
  systemStats: {
    title: "System stats card",
    body: (
      <>
        <P>
          CPU load, memory pressure, and disk fill of whatever runs the
          app, refreshed on each page load. Show the card from the
          home-page layout editor; its title and extra disk rows live in{" "}
          <strong>Settings → Widgets → System stats</strong>.
        </P>
        <P>
          The card names what it measures, because the two are genuinely
          different. In a container (the usual Docker install) it reads{" "}
          <em>this container&apos;s</em> CPU and memory against its
          configured limits — a container can&apos;t see the rest of the
          machine, and the card won&apos;t pretend it does. Run directly on
          a machine and it reads the whole host. To get host numbers from
          inside a container, mount the host&apos;s <code>/proc</code>{" "}
          read-only at <code>/host/proc</code> (see the README&apos;s
          deployment notes) and the card switches to host mode by itself.
        </P>
        <P>
          Disks are per-path either way: the app&apos;s data volume is
          always listed, and any extra path you add has to be mounted into
          the container to be measurable. If the card is on a public
          dashboard, remember signed-out visitors see these numbers too.
        </P>
      </>
    ),
  },
};
