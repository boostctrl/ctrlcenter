import type { Metadata } from "next";
import Link from "next/link";
import { getSettings } from "@/lib/config";
import { BUILTIN_BANGS } from "@/lib/search";
import BackHome from "@/components/BackHome";
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
      <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-8 px-6 py-12 sm:px-10 lg:py-16">
        <div>
          <BackHome />
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
                Frost to Flat, Cyber, and Paper (12 in all).
              </li>
              <li>
                <strong>Scene.</strong> The animated backdrop: Aurora,
                Starfield, Horizon, Rain, and more (16 in all).
              </li>
              <li>
                <strong>Accent and colors.</strong> The accent gradient, plus
                optional custom surface colors.
              </li>
              <li>
                <strong>Font.</strong> Pick from six typefaces.
              </li>
            </ul>
            <P>
              Light and dark can carry wholly independent looks. Like the rest of
              your preferences, everything stays on your device, so each visitor
              gets their own.
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
                service.
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

        <Section
          title="For admins"
          note="Running and configuring the instance. These need the admin password."
        >
          <Card title="The admin portal">
            <P>
              The <A href="/admin">admin portal</A> (password-protected) is
              organized into four tabs: <strong>Applications</strong>,{" "}
              <strong>Bookmarks</strong>, <strong>Themes</strong>, and{" "}
              <strong>Settings</strong>. Changes save automatically as you make
              them, and the header has one-click <em>Export</em> and{" "}
              <em>Import</em> of the whole configuration.
            </P>
          </Card>

          <Card title="Apps, bookmarks & icons">
            <P>
              Add and edit the tiles on the dashboard, and drag to reorder them.
            </P>
            <ul className={LIST_CLASS}>
              <li>
                <strong>Apps</strong> carry a name, optional subtitle, URL, and
                icon.
              </li>
              <li>
                <strong>Bookmarks</strong> group under categories you name. Both
                the bookmarks and the category order are drag-sortable.
              </li>
              <li>
                <strong>Icons</strong> come from a large built-in set (pick by
                name) or your own upload: PNG, JPG, WebP, GIF, SVG, or ICO up to
                512&nbsp;KB, auto-squared so it sits cleanly. The browser-tab{" "}
                <strong>favicon</strong> is set the same way.
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
              accrues even when no one has the page open.
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

          <Card title="Home-page components">
            <P>
              Toggle what appears on the dashboard: the greeting, clock, search
              box, apps, bookmarks, the favorites row, and the floating
              navigation menu. You can also reorder these sections and set each
              one&apos;s width (full, two-thirds, half, or a third), so two or
              three can share a row. Weather, the status row, and the calendar
              have their own enables alongside their setup.
            </P>
          </Card>

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
