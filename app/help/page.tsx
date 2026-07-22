import type { Metadata } from "next";
import Link from "next/link";
import { getSettings } from "@/lib/config";
import { BUILTIN_BANGS } from "@/lib/search";
import PageNav from "@/components/PageNav";
import FloatingNav from "@/components/FloatingNav";
import { navPages } from "@/lib/nav";

export const metadata: Metadata = { title: "Help" };
export const dynamic = "force-dynamic";

// A short keyboard-key chip.
function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded-md border border-fg/15 bg-fg/[0.06] px-1.5 py-0.5 font-mono text-xs text-fg/75">
      {children}
    </kbd>
  );
}

// A monospace inline snippet (bang keys, config values).
function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-fg/[0.06] px-1 py-0.5 font-mono text-[0.85em] text-fg/80">
      {children}
    </code>
  );
}

// A link that reads the same whether internal (Link) or external (<a>).
function A({
  href,
  external,
  children,
}: {
  href: string;
  external?: boolean;
  children: React.ReactNode;
}) {
  const className =
    "font-medium text-fg/85 underline underline-offset-2 hover:text-fg";
  if (external) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
      >
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}

// Body paragraph — the default prose style used throughout the cards.
function P({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-fg/70">{children}</p>;
}

// Shared class for the bulleted feature lists in the cards below.
const LIST_CLASS =
  "flex list-disc flex-col gap-1.5 pl-4 text-sm text-fg/70 marker:text-fg/30";

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="glass-card mb-4 flex break-inside-avoid flex-col gap-3 p-6">
      <h3 className="text-sm font-semibold tracking-[0.15em] text-fg/60 uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

// A labelled group of cards (e.g. "For everyone" vs "For admins").
function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-bold tracking-tight">{title}</h2>
        {note && <p className="mt-1 text-sm text-fg/50">{note}</p>}
      </div>
      <div className="columns-1 gap-4 md:columns-2 xl:columns-3">{children}</div>
    </section>
  );
}

// In-app usage guide, mirroring /weather, /status and /calendar so the docs are
// discoverable without leaving the app. Static reference content; the only
// runtime reads are the built-in bang list and the components flag that gates
// the floating navigation menu.
export default async function HelpPage() {
  const settings = await getSettings();
  const { components } = settings;
  const builtins = Object.entries(BUILTIN_BANGS);

  return (
    <>
      <main className="mx-auto flex min-h-screen w-full max-w-8xl flex-col gap-8 px-6 py-12 sm:px-10 lg:py-16">
        <div>
          <PageNav current="help" {...navPages(settings)} />
          <h1 className="mt-3 text-3xl font-bold">Help</h1>
          <p className="mt-1 text-sm text-fg/50">
            Everything ctrlcenter can do, plus setup notes for admins. Some
            features below appear only when the admin has turned them on.
          </p>
        </div>

        <Section
          title="For everyone"
          note="Works in any browser. Nothing here needs the admin password."
        >
          <Card title="Getting around">
            <P>
              Every page outside the home dashboard opens with the same slim
              navigation strip: a link back to the dashboard, then the
              site&apos;s pages with the one you&apos;re on highlighted. The
              floating menu in the corner holds the same destinations and works
              everywhere, the dashboard included.
            </P>
            <P>
              The status glance in the dashboard&apos;s header card — the pulse
              dot with <em>Uptime &amp; outages</em> beside it — is the quick
              way into the <A href="/status">status page</A>.
            </P>
          </Card>

          <Card title="Search">
            <P>
              Start typing to filter your apps and bookmarks at once. It matches
              on name, subtitle, URL, and a bookmark&apos;s category, and opening
              anything launches it in a new tab.
            </P>
            <ul className="flex flex-col gap-2 text-sm text-fg/70">
              <li className="flex items-baseline gap-3">
                <Kbd>/</Kbd>
                <span>
                  Jump to the search box from anywhere on the page, as long as
                  you&apos;re not already typing in a field.
                </span>
              </li>
              <li className="flex items-baseline gap-3">
                <Kbd>Enter</Kbd>
                <span>
                  Open the top match. A <Code>!bang</Code> takes priority, and if
                  nothing matches it runs a web search instead.
                </span>
              </li>
              <li className="flex items-baseline gap-3">
                <Kbd>Esc</Kbd>
                <span>Clear the box and unfocus it.</span>
              </li>
            </ul>
          </Card>

          <Card title="Bang shortcuts">
            <P>
              Begin a query with <Code>!</Code> to jump straight to a site
              instead of filtering. <Code>!key term</Code> searches that site,
              and <Code>!key</Code> on its own opens its home page. An
              unrecognized bang falls back to a web search of your text.
            </P>
            <div>
              <p className="mb-1.5 text-xs tracking-wide text-fg/45 uppercase">
                Built-in
              </p>
              <div className="flex flex-wrap gap-1.5">
                {builtins.map(([key, b]) => (
                  <span
                    key={key}
                    title={b.label}
                    className="rounded-md border border-fg/10 bg-fg/[0.04] px-2 py-1 text-xs text-fg/70"
                  >
                    <span className="font-mono text-fg/90">!{key}</span>{" "}
                    <span className="text-fg/45">{b.label}</span>
                  </span>
                ))}
              </div>
            </div>
            <P>
              Every app also gets its own bang from its name and subtitle, so an
              app named &ldquo;Plex&rdquo; answers to <Code>!plex</Code>. The
              admin can add custom bangs too, and those take priority over the
              built-ins.
            </P>
          </Card>

          <Card title="Favorites">
            <P>
              Hover an app card and click the star (
              <span
                className="align-middle text-[color:var(--accent-from)]"
                aria-hidden
              >
                ★
              </span>
              ) to pin it, then click again to unpin. Pinned apps collect in a{" "}
              <strong>Favorites</strong> row on the dashboard, in the order you
              pinned them. Favorites live in this browser only, so no account is
              needed.
            </P>
          </Card>

          <Card title="Your preferences">
            <P>
              Open <A href="/settings">Settings</A> (the gear in the corner) to
              tailor your view. Every option is saved in this browser only.
            </P>
            <ul className={LIST_CLASS}>
              <li>
                <strong>Appearance mode.</strong> Light, dark, or follow your
                device.
              </li>
              <li>
                <strong>Greeting name.</strong> The name shown in &ldquo;Good
                evening, …&rdquo;.
              </li>
              <li>
                <strong>Time zone.</strong> Used by the clock and the calendar.
              </li>
              <li>
                <strong>Weather location and units.</strong> Set a spot or tap{" "}
                <em>Use my location</em>, and switch between °F and °C (when the
                admin has weather on).
              </li>
              <li>
                <strong>Reset all settings.</strong> Wipe your personalizations
                back to the site defaults.
              </li>
            </ul>
          </Card>

          <Card title="Themes & looks">
            <P>
              The theme builder in <A href="/settings">Settings</A> makes the
              dashboard yours, with a live preview as you go.
            </P>
            <ul className={LIST_CLASS}>
              <li>
                <strong>Design.</strong> The card surface style, from Glass and
                Frost to Cyber, Emboss, and Sketch (18 in all).
              </li>
              <li>
                <strong>Scene.</strong> The animated backdrop: Aurora,
                Starfield, Petals, Comets, and more (18 in all).
              </li>
              <li>
                <strong>Accent and colors.</strong> The accent gradient, plus
                optional custom surface colors.
              </li>
              <li>
                <strong>Font.</strong> Pick from twelve typefaces, from
                geometric sans to serif and mono.
              </li>
            </ul>
            <P>
              Light and dark can carry wholly independent looks. Like the rest of
              your preferences, everything stays on your device, so each visitor
              gets their own. Signed-in admins get one extra control here: the
              globe on a saved theme makes that look the site-wide default every
              visitor starts from — a copy, so editing the saved theme later
              doesn&apos;t change the site.
            </P>
          </Card>

          <Card title="The extra pages">
            <P>
              When the admin enables them, each gets a card or widget on the home
              page and a full page of its own.
            </P>
            <ul className={LIST_CLASS}>
              <li>
                <A href="/weather">Weather</A> shows current conditions with an
                hourly and 7-day forecast, sunrise and sunset, and detail tiles
                for your location and units.
              </li>
              <li>
                <A href="/status">Status</A> reports per-service uptime over a
                range you pick, with a 90-day timeline for each monitored
                service. Click anywhere on a service&apos;s card to open its
                detail view: a larger, finer-grained uptime graph,
                response-time analytics, every range&apos;s uptime at once, the
                outage log — exact start and end times, with any note the admin
                has attached to an incident — and how the check is configured.
              </li>
              <li>
                <A href="/calendar">Calendar</A> shows your full upcoming agenda
                in your own time zone. The home &ldquo;Upcoming&rdquo; card links
                here.
              </li>
            </ul>
          </Card>

          <Card title="Privacy & your data">
            <P>
              Everything you personalize (appearance, greeting, time zone,
              weather location, theme, and favorites) is stored in your
              browser&apos;s local storage. It never leaves your device and
              isn&apos;t tied to any account, so two people on the same
              ctrlcenter each see their own setup. <em>Reset all settings</em>{" "}
              clears it.
            </P>
          </Card>

          <Card title="Install it as an app">
            <P>
              ctrlcenter is a progressive web app, so you can install it from
              your browser&apos;s menu (&ldquo;Install&rdquo; on desktop, or
              &ldquo;Add to Home Screen&rdquo; on mobile). It then opens in its
              own window, using the name and icon the admin has set.
            </P>
          </Card>
        </Section>

        {/* The admin material is grouped by what the admin is trying to do —
            content, monitoring, the home page, operations — so each section
            stays a handful of comparable cards and a new feature lands as its
            own card in the group it belongs to (#178). */}
        <Section
          title="For admins: content & search"
          note="What the dashboard shows. Everything from here down needs the admin password."
        >
          <Card title="The admin portal">
            <P>
              The <A href="/admin">admin portal</A> (password-protected) is
              organized into four tabs: <strong>Applications</strong>,{" "}
              <strong>Bookmarks</strong>, <strong>Themes</strong>, and{" "}
              <strong>Settings</strong>. Changes save automatically as you make
              them, and the header has one-click <em>Export</em> and{" "}
              <em>Import</em> of the whole configuration. Import asks you to
              confirm first — showing how many apps and bookmarks the file holds,
              and the title it will set — and saves your previous configuration
              to <Code>config.yaml.bak</Code> beside the config file, so a
              mistaken import can be undone.
            </P>
          </Card>

          <Card title="Apps, bookmarks & icons">
            <P>
              Add and edit the tiles on the dashboard, and drag to reorder them.
            </P>
            <ul className={LIST_CLASS}>
              <li>
                <strong>Apps</strong> carry a name, optional subtitle, URL, and
                icon. Mark one <strong>Only show when logged in</strong> to keep
                an internal service off the dashboard and status page for
                signed-out visitors — it&apos;s still monitored and alerted on.
                Turn on <strong>Group private apps separately</strong> under
                Settings → Layout to collect those apps into their own{" "}
                <strong>Private Applications</strong> section, shown only to you.
              </li>
              <li>
                <strong>Bookmarks</strong> group under categories you name. Both
                the bookmarks and the category order are drag-sortable, and a
                category can be renamed from its heading — every bookmark in it
                moves across at once. Bookmarks take the same{" "}
                <strong>Only show when logged in</strong> flag as apps; a
                category whose bookmarks are all private disappears for
                signed-out visitors too.
              </li>
              <li>
                <strong>Icons</strong> are matched by name against the
                dashboard-icons project. The server fetches each icon once and
                keeps a copy in its data folder, so every icon in use keeps
                rendering with no internet at all — only <em>browsing</em> the
                full set in the icon picker needs a connection. On a fully
                offline install you can still upload your own: PNG, JPG, WebP,
                GIF, SVG, or ICO up to 512&nbsp;KB, auto-squared so it sits
                cleanly. The browser-tab <strong>favicon</strong> is set the
                same way.
              </li>
            </ul>
          </Card>

          <Card title="Search engine & custom bangs">
            <P>
              Under <strong>Settings</strong>, choose the web-search engine used
              when a query matches nothing: DuckDuckGo, Google, Bing, Brave, or a
              custom <Code>%s</Code> URL template.
            </P>
            <P>
              Add your own <strong>bangs</strong> too: map a <Code>!key</Code> to
              any <Code>%s</Code> template. Custom bangs override the built-ins,
              which override the automatic per-app bangs.
            </P>
          </Card>

          <Card title="Calendar feed">
            <P>
              Point the calendar at a published <Code>.ics</Code> feed or a
              CalDAV URL (a <Code>webcal://</Code> address works too), with
              optional Basic-auth credentials for a private feed. The{" "}
              <strong>Test feed</strong> button reports whether it&apos;s
              reachable and how many upcoming events it sees.
            </P>
            <P>
              A <em>Hide when no upcoming events</em> option drops the home
              &ldquo;Upcoming&rdquo; card entirely when the agenda is empty.
            </P>
          </Card>
        </Section>

        <Section
          title="For admins: monitoring"
          note="Health checks, the status page, and letting people know what happened."
        >
          <Card title="Uptime monitoring">
            <P>
              Give any app a health check and its results show on{" "}
              <A href="/status">/status</A>. Pick the method that fits the
              service.
            </P>
            <ul className={LIST_CLASS}>
              <li>
                <strong>HTTP.</strong> A request that can require a specific
                status code or a keyword in the response body.
              </li>
              <li>
                <strong>TCP.</strong> A port accepts a connection.
              </li>
              <li>
                <strong>DNS.</strong> The host resolves.
              </li>
              <li>
                <strong>Ping.</strong> An ICMP echo (the container must be
                allowed to ping).
              </li>
            </ul>
            <P>
              A background poller records history on its own schedule, so uptime
              accrues even when no one has the page open. Completed outages are
              recorded with the exact moment the check failed and the moment it
              recovered, and each service&apos;s detail page lists them for 90
              days.
            </P>
          </Card>

          <Card title="The Monitor page">
            <P>
              Connect <strong>qBittorrent</strong>, <strong>Sonarr</strong>, or{" "}
              <strong>Radarr</strong> under{" "}
              <strong>Settings → Integrations</strong> (each has a
              test-connection button) and the private{" "}
              <A href="/admin/monitor">Monitor</A> page shows what they&apos;re
              doing right now: transfer speeds and the busiest torrents,
              download queues with progress, missing counts, and health
              warnings. It refreshes itself while the tab is open.
            </P>
            <P>
              Everything about it is admin-only: the page, the data it polls,
              and the stored credentials all sit behind your sign-in, and
              nothing from an integration ever appears on the public dashboard.
              Connections are read-only — the dashboard can look, never touch.
              Each credential can also come from an environment variable
              instead of the config file (see the README&apos;s environment
              table).
            </P>
          </Card>

          <Card title="Incident notes">
            <P>
              Explain an outage where people will look for the explanation.
              While signed in, open a service&apos;s detail page from{" "}
              <A href="/status">/status</A>: every recorded outage in the log
              offers <em>Add note</em> (or a pencil beside an existing note).
              Type the reason — &ldquo;planned maintenance&rdquo;, &ldquo;ISP
              fault&rdquo; — and press <Kbd>Enter</Kbd>; clearing the text
              deletes the note after a confirmation. Visitors see a note
              wherever they can see the service itself.
            </P>
            <P>
              Notes are stored with the recorded uptime history, not the
              configuration, so they stay out of config export and import —
              same as the outage history they annotate.
            </P>
          </Card>

          <Card title="Alerts">
            <P>
              Get notified when a monitored service goes down and when it
              recovers. Under the master <strong>Alerts</strong> switch,{" "}
              <strong>email</strong> (via your SMTP server) and a{" "}
              <strong>webhook</strong> are independent channels, so you can
              enable either or both.
            </P>
          </Card>

          <Card title="Announcement banner">
            <P>
              A banner across the top of every page for notices, maintenance
              windows, or a heads-up for the household. Turn it on in{" "}
              <strong>Settings → Announcements</strong> and write the message
              using inline <strong>bold</strong>, <em>italic</em> and{" "}
              <span className="underline underline-offset-2">links</span>{" "}
              (http/https only; raw HTML is never rendered). Pick a tone — info,
              warning, success, or your accent color — and optionally let
              visitors dismiss it, in which case it reappears whenever you change
              the message.
            </P>
          </Card>

          <Card title="Status announcements">
            <P>
              Tell your household about maintenance and upcoming changes right on
              the <A href="/status">status page</A>, separate from the site-wide
              banner. In <strong>Settings → Announcements</strong>{" "}
              add an entry with a kind (maintenance, incident, or notice — it
              tints the card), a title, and a message in the same inline markdown
              subset. An optional start and end schedule it: an entry with a
              future start shows as <em>scheduled</em> until its window opens,
              then drops off on its own once the end passes. Times display in
              each visitor&apos;s own time zone, and the section appears even when
              status checks are off.
            </P>
          </Card>
        </Section>

        <Section
          title="For admins: the home page"
          note="Arranging the dashboard and the cards that can live on it."
        >
          <Card title="Home-page components">
            <P>
              The dashboard is a grid of widgets you arrange in place. Toggle
              what appears — the greeting, clock, search box, apps, bookmarks,
              the favorites row, and the floating navigation menu — then shape
              the layout directly on the page.
            </P>
            <ul className={LIST_CLASS}>
              <li>
                <strong>Reorder.</strong> Drag a card by its{" "}
                <strong>⠿</strong> grip, or use the move arrows.
              </li>
              <li>
                <strong>Resize.</strong> Drag a card&apos;s right edge to set its{" "}
                <strong>width</strong> in columns, or its bottom edge to set its{" "}
                <strong>height</strong>; the steppers do the same in exact steps.
                A <strong>Fill</strong> button widens a card to close the gap
                when it doesn&apos;t reach the end of its row.
              </li>
              <li>
                <strong>Explicit height.</strong> Making a card taller than its
                content gives it presence — the greeting and header card center
                in it, restoring the classic header — while a shorter height
                scrolls a long list inside.
              </li>
              <li>
                <strong>The More menu</strong> on each card adds{" "}
                <strong>space on any side</strong> (above, below, or beside a
                card sharing its row), sets <strong>cards per row</strong> for
                the app and bookmark grids, and hides a section&apos;s heading.
              </li>
              <li>
                <strong>Toolbar controls</strong> set the{" "}
                <strong>card gap</strong> between all cards, the{" "}
                <strong>top gap</strong> above the first row, and the{" "}
                <strong>UI scale</strong> that sizes the whole dashboard up or
                down.
              </li>
              <li>
                <strong>Undo any misstep.</strong> <strong>Undo</strong> (
                <Kbd>Ctrl</Kbd>+<Kbd>Z</Kbd>) takes back the last change,{" "}
                <strong>Revert</strong> restores the layout you started the
                session with, and <strong>Reset</strong> returns the whole
                arrangement to its out-of-the-box defaults.
              </li>
            </ul>
            <P>
              The editor previews exactly what the live page shows, keeping cards
              in the order you place them. Weather, the status row, and the
              calendar have their own enables alongside their setup.
            </P>
          </Card>

          <Card title="Notes card">
            <P>
              A free-form card for anything worth keeping in view — maintenance
              reminders, runbook snippets, a message for the household. Write it
              in <strong>Settings → Widgets → Notes</strong> using a safe markdown subset
              (headings, bold and italic, links, lists, quotes, and code
              blocks), then show the card from the home-page layout editor. Raw
              HTML is displayed as text, never rendered.
            </P>
          </Card>

          <Card title="RSS feed card">
            <P>
              Show the latest headlines from one or more RSS, Atom, or JSON
              feeds — news sites, blogs, release notes — merged into a single list,
              newest-first. Add feed URLs in{" "}
              <strong>Settings → Widgets → RSS feed</strong> (the{" "}
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
          </Card>

          <Card title="Countdown card">
            <P>
              Labeled dates shown as &ldquo;in N days&rdquo; rows — domain
              renewals, birthdays, deadlines. Add them in{" "}
              <strong>Settings → Widgets → Countdown</strong>, then show the card from
              the home-page layout editor. Days count in each visitor&apos;s
              own time zone; today and tomorrow get an accent chip, and past
              dates dim and sink below the upcoming ones.
            </P>
          </Card>

          <Card title="World clocks card">
            <P>
              Live clocks for the time zones you follow — one row each with its
              current time and its own local date. Add zones in{" "}
              <strong>Settings → Widgets → World clocks</strong> (each takes an
              optional label; leave it blank to use the zone&apos;s city name),
              then show the card from the home-page layout editor.
            </P>
          </Card>

          <Card title="System stats card">
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
          </Card>

        </Section>

        <Section
          title="For admins: appearance & operations"
          note="Site-wide looks, backups, and running the instance safely."
        >
          <Card title="Themes">
            <P>
              The <strong>Themes</strong> tab edits the built-in theme packs
              visitors can choose from: the design, scene, and colors for both
              light and dark. Reset any pack to restore its original values.
            </P>
          </Card>

          <Card title="Backup: export & import">
            <P>
              <em>Export</em> downloads your whole configuration as a single JSON
              file, and <em>Import</em> restores it. The admin password is never
              included in the export, and importing a file can&apos;t change or
              clear it. Password changes only happen through the flow below.
            </P>
            <P>
              <strong>Treat a backup file as a secret.</strong> It holds your
              whole configuration in clear text, which includes any calendar
              Basic-auth credentials and SMTP password you&apos;ve set — the
              admin password is the one thing left out.
            </P>
            <P>
              Icons you uploaded are bundled into the export and restored on
              import, so a backup moved to a new instance keeps its custom
              icons. Backups made before icon bundling still import fine.
            </P>
          </Card>

          <Card title="Password & sessions">
            <P>
              Set or change the admin password from the portal. If none is set,
              login falls back to the <Code>ADMIN_PASSWORD</Code> environment
              variable. Changing the password signs out every other session.
            </P>
          </Card>

          <Card title="Deployment & security">
            <P>
              ctrlcenter is meant to run <strong>behind a reverse proxy</strong>{" "}
              (for TLS and a stable address). Login attempts are rate-limited per
              client IP, read from the <Code>X-Forwarded-For</Code> header.
            </P>
            <P>
              Set <Code>TRUSTED_PROXY_HOPS</Code> to how many proxies sit in
              front of the app (default <Code>1</Code>). If you expose ctrlcenter{" "}
              <strong>directly, with no proxy</strong>, set it to <Code>0</Code>.
              Otherwise a visitor can spoof <Code>X-Forwarded-For</Code> to forge
              a fresh IP on each request and slip past the per-IP login throttle.
            </P>
            <P>
              Installation, environment variables, and the full configuration
              reference live in the{" "}
              <A href="https://github.com/boostctrl/ctrlcenter#readme" external>
                project README
              </A>
              .
            </P>
          </Card>
        </Section>
      </main>
      {components.settingsButton && <FloatingNav {...navPages(settings)} />}
    </>
  );
}
