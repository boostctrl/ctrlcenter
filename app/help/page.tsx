import type { Metadata } from "next";
import Link from "next/link";
import { getSettings } from "@/lib/config";
import { BUILTIN_BANGS } from "@/lib/search";
import BackHome from "@/components/BackHome";
import FloatingSettings from "@/components/FloatingSettings";

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
      <div className="columns-1 gap-4 lg:columns-2">{children}</div>
    </section>
  );
}

// In-app usage guide, mirroring /weather, /status and /calendar so the docs are
// discoverable without leaving the app. Static reference content; the only
// runtime read is the components flag that gates the floating settings button.
export default async function HelpPage() {
  const { components } = await getSettings();
  const builtins = Object.entries(BUILTIN_BANGS);

  return (
    <>
      <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-8 px-6 py-12 sm:px-10 lg:py-16">
        <div>
          <BackHome />
          <h1 className="mt-3 text-3xl font-bold">Help</h1>
          <p className="mt-1 text-sm text-fg/50">
            How to get around ctrlcenter, plus setup notes for admins. Some
            features below appear only when the admin has turned them on.
          </p>
        </div>

        <Section
          title="For everyone"
          note="Works in any browser — nothing here needs the admin password."
        >
          <Card title="Search">
            <p className="text-sm text-fg/70">
              Start typing to filter your apps <em>and</em> bookmarks at once.
              The search box is the fastest way around:
            </p>
            <ul className="flex flex-col gap-2 text-sm text-fg/70">
              <li className="flex items-baseline gap-3">
                <Kbd>/</Kbd>
                <span>Jump to the search box from anywhere on the page.</span>
              </li>
              <li className="flex items-baseline gap-3">
                <Kbd>Enter</Kbd>
                <span>
                  Open the top match. With nothing matching, it searches the web
                  instead.
                </span>
              </li>
              <li className="flex items-baseline gap-3">
                <Kbd>Esc</Kbd>
                <span>Clear the box and unfocus it.</span>
              </li>
            </ul>
          </Card>

          <Card title="Bang shortcuts">
            <p className="text-sm text-fg/70">
              Begin a query with <Code>!</Code> to jump straight out instead of
              filtering. <Code>!key term</Code> searches the site;{" "}
              <Code>!key</Code> on its own opens its home page. An unrecognized
              bang just falls back to a web search.
            </p>
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
            <p className="text-sm text-fg/70">
              Every app also gets its own bang from its name — and its subtitle —
              so <Code>!plex</Code> opens Plex. The admin can add more custom
              bangs in the portal.
            </p>
          </Card>

          <Card title="Favorites">
            <p className="text-sm text-fg/70">
              Hover an app card and click the star (
              <span
                className="align-middle"
                style={{ color: "var(--accent-from)" }}
                aria-hidden
              >
                ★
              </span>
              ) to pin it. Pinned apps collect in a <strong>Favorites</strong>{" "}
              row at the top of the dashboard. Favorites are saved in this
              browser only — no account needed.
            </p>
          </Card>

          <Card title="More pages">
            <p className="text-sm text-fg/70">
              When the admin enables them, these get their own pages (and a card
              or widget on the dashboard):
            </p>
            <ul className="flex flex-col gap-2 text-sm text-fg/70">
              <li>
                <Link
                  href="/weather"
                  className="font-medium text-fg/85 underline underline-offset-2 hover:text-fg"
                >
                  Weather
                </Link>{" "}
                — current conditions, an hourly and 7-day forecast, sun times,
                and detail tiles.
              </li>
              <li>
                <Link
                  href="/status"
                  className="font-medium text-fg/85 underline underline-offset-2 hover:text-fg"
                >
                  Status
                </Link>{" "}
                — per-service uptime % and a 90-day timeline for the apps being
                monitored.
              </li>
              <li>
                <Link
                  href="/calendar"
                  className="font-medium text-fg/85 underline underline-offset-2 hover:text-fg"
                >
                  Calendar
                </Link>{" "}
                — your full upcoming agenda, in your own time zone.
              </li>
            </ul>
          </Card>

          <Card title="Make it yours">
            <p className="text-sm text-fg/70">
              Open{" "}
              <Link
                href="/settings"
                className="font-medium text-fg/85 underline underline-offset-2 hover:text-fg"
              >
                Settings
              </Link>{" "}
              (the gear in the corner) to set your greeting name, time zone,
              weather location and units, and your whole theme — design, scene,
              colors, and font. Everything here is stored in this browser only
              and never leaves your device, so each visitor gets their own look.
            </p>
          </Card>

        </Section>

        <Section
          title="For admins"
          note="Running and configuring the instance — these need the admin password."
        >
          <Card title="The admin portal">
            <p className="text-sm text-fg/70">
              The{" "}
              <Link
                href="/admin"
                className="font-medium text-fg/85 underline underline-offset-2 hover:text-fg"
              >
                admin portal
              </Link>{" "}
              (password-protected) manages apps and bookmarks, icons and the
              favicon, the search engine and custom bangs, uptime checks and
              alerts, the calendar feed, which components show on the home page,
              and one-click export/import of the whole config.
            </p>
          </Card>

          <Card title="Deployment & security">
            <p className="text-sm text-fg/70">
              ctrlcenter is meant to run <strong>behind a reverse proxy</strong>{" "}
              (for TLS and a stable address). Login attempts are rate-limited per
              client IP, read from the <Code>X-Forwarded-For</Code> header.
            </p>
            <p className="text-sm text-fg/70">
              Set <Code>TRUSTED_PROXY_HOPS</Code> to how many proxies sit in
              front of the app (default <Code>1</Code>). If you expose ctrlcenter{" "}
              <strong>directly, with no proxy</strong>, set it to <Code>0</Code>{" "}
              — otherwise a visitor can spoof <Code>X-Forwarded-For</Code> to
              forge a fresh IP each request and slip past the per-IP login
              throttle.
            </p>
            <p className="text-sm text-fg/70">
              Installation, environment variables, and the full configuration
              reference live in the{" "}
              <a
                href="https://github.com/boostctrl/ctrlcenter#readme"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-fg/85 underline underline-offset-2 hover:text-fg"
              >
                project README
              </a>
              .
            </p>
          </Card>
        </Section>
      </main>
      {components.settingsButton && <FloatingSettings />}
    </>
  );
}
