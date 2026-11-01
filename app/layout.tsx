import type { Metadata } from "next";
import { headers } from "next/headers";
import localFont from "next/font/local";
import { getSettings } from "@/lib/config";
import { readPublicConfig } from "@/lib/api-auth";
import { DEFAULT_UI_SCALE } from "@/lib/layout";
import { resolveIconUrl } from "@/lib/icons";
import { serializeForScript } from "@/lib/serialize";
import {
  DENSITY_IDS,
  DESIGN_IDS,
  SCENE_IDS,
  packFields,
  resolveThemeGallery,
  resolveThemePacks,
  type ThemePack,
  type VisitorTheming,
} from "@/lib/theme";
import type { Settings } from "@/lib/schema";
import { inlineThemeScript } from "@/lib/theme-paint";
import { scheduleState, themeWithPack } from "@/lib/theme-schedule";
import { boardDefaultTheme, boardForPath } from "@/lib/board-theme";
import type { ScheduleProps } from "@/components/prefs/useScheduledTheme";
import { FONT_IDS } from "@/lib/fonts";
import { PrefsProvider } from "@/components/PrefsProvider";
import SceneLayer from "@/components/scenes/SceneLayer";
import AnnouncementBanner from "@/components/AnnouncementBanner";
import "./globals.css";

// Every selectable font (see lib/fonts.ts) must be declared here: next/font is
// analyzed at build time, so fonts can't be chosen dynamically by id. The
// faces come from the Fontsource packages in node_modules (#412), not from
// Google at build time: a build needs no network for them, and an odd
// response from Google can't fail it. Each exposes a CSS variable; the active
// one is selected by a `font-<id>` class on <html> (app/globals.css). Only the
// default face is preloaded: preloading every font had each page download
// ~400 KB of faces it never renders (#276). The others are fetched only when a
// visitor's chosen font class makes the browser use them.
const jakarta = localFont({
  src: "../node_modules/@fontsource-variable/plus-jakarta-sans/files/plus-jakarta-sans-latin-wght-normal.woff2",
  weight: "200 800",
  variable: "--font-jakarta",
});
const inter = localFont({
  src: "../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
  weight: "100 900",
  variable: "--font-inter",
  preload: false,
});
const poppins = localFont({
  src: [
    { path: "../node_modules/@fontsource/poppins/files/poppins-latin-400-normal.woff2", weight: "400" },
    { path: "../node_modules/@fontsource/poppins/files/poppins-latin-500-normal.woff2", weight: "500" },
    { path: "../node_modules/@fontsource/poppins/files/poppins-latin-600-normal.woff2", weight: "600" },
    { path: "../node_modules/@fontsource/poppins/files/poppins-latin-700-normal.woff2", weight: "700" },
  ],
  variable: "--font-poppins",
  preload: false,
});
const nunito = localFont({
  src: "../node_modules/@fontsource-variable/nunito/files/nunito-latin-wght-normal.woff2",
  weight: "200 1000",
  variable: "--font-nunito",
  preload: false,
});
const lora = localFont({
  src: "../node_modules/@fontsource-variable/lora/files/lora-latin-wght-normal.woff2",
  weight: "400 700",
  variable: "--font-lora",
  preload: false,
});
const jetbrains = localFont({
  src: "../node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2",
  weight: "100 800",
  variable: "--font-jetbrains",
  preload: false,
});
const outfit = localFont({
  src: "../node_modules/@fontsource-variable/outfit/files/outfit-latin-wght-normal.woff2",
  weight: "100 900",
  variable: "--font-outfit",
  preload: false,
});
const grotesk = localFont({
  src: "../node_modules/@fontsource-variable/space-grotesk/files/space-grotesk-latin-wght-normal.woff2",
  weight: "300 700",
  variable: "--font-grotesk",
  preload: false,
});
const manrope = localFont({
  src: "../node_modules/@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2",
  weight: "200 800",
  variable: "--font-manrope",
  preload: false,
});
const rubik = localFont({
  src: "../node_modules/@fontsource-variable/rubik/files/rubik-latin-wght-normal.woff2",
  weight: "300 900",
  variable: "--font-rubik",
  preload: false,
});
const playfair = localFont({
  src: "../node_modules/@fontsource-variable/playfair-display/files/playfair-display-latin-wght-normal.woff2",
  weight: "400 900",
  variable: "--font-playfair",
  preload: false,
});
const quicksand = localFont({
  src: "../node_modules/@fontsource-variable/quicksand/files/quicksand-latin-wght-normal.woff2",
  weight: "300 700",
  variable: "--font-quicksand",
  preload: false,
});

const fontVariables = [
  jakarta.variable,
  inter.variable,
  poppins.variable,
  nunito.variable,
  lora.variable,
  jetbrains.variable,
  outfit.variable,
  grotesk.variable,
  manrope.variable,
  rubik.variable,
  playfair.variable,
  quicksand.variable,
].join(" ");

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSettings();
  // The browser-tab favicon: a configured value (icon slug, bundled local icon,
  // or URL) when set, else the bundled default served from /public. We emit it
  // here rather than via the app/ file conventions (app/favicon.ico,
  // app/icon.svg) on purpose: those conventions always render their own <link>
  // tags that take precedence over metadata, so a configured favicon would never
  // win. Keeping the default in /public means this is the only icon link.
  const favicon =
    (settings.favicon && resolveIconUrl(settings.favicon)) || "/icon.svg";
  return {
    title: settings.title || "Home",
    description: "Personal dashboard",
    icons: { icon: favicon },
  };
}

// The day/night schedule (#336) resolved for this request: the site theme
// for each phase, and the phase at this moment (read here, outside the
// component, which must stay pure).
function resolveSchedule(settings: Settings, packs: ThemePack[]): ScheduleProps | null {
  const sched = settings.themeSchedule;
  if (!sched.enabled) return null;
  const timeZone = settings.timezone || "UTC";
  const location = { latitude: settings.weather.latitude, longitude: settings.weather.longitude };
  const byName = (name: string) => packs.find((p) => p.name === name);
  return {
    config: sched,
    base: settings.theme,
    day: themeWithPack(settings.theme, byName(sched.day), sched.dayMode),
    night: themeWithPack(settings.theme, byName(sched.night), sched.nightMode),
    phase: scheduleState(sched, location, timeZone, Date.now()).phase,
    location,
    timeZone,
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // The settings and, for the theming policy (#335), whether this is an
  // admin: admins are never limited, so the policy the page carries is the
  // effective one for this visitor.
  const { config, isAdmin } = await readPublicConfig();
  const settings = config.settings;
  const weather = settings.weather;
  const visitorTheming: VisitorTheming = isAdmin ? "all" : settings.visitorTheming;
  const packs = resolveThemePacks(config.themes);
  // Per-request CSP nonce from the proxy, so our inline theme script is allowed
  // without script-src 'unsafe-inline'. Reading headers() also opts pages into
  // dynamic rendering, which is required for a per-request nonce to match.
  const requestHeaders = await headers();
  const nonce = requestHeaders.get("x-nonce") ?? undefined;
  // The day/night schedule (#336): the site theme for each phase and the
  // phase now, so the first paint is right; PrefsProvider flips it live.
  // The schedule may name a pack hidden from visitors (a kiosk's night
  // look), so it resolves against the whole gallery.
  const gallery = resolveThemeGallery(config.themes).map((r) => r.pack);
  const schedule = resolveSchedule(settings, gallery);
  const siteTheme = schedule ? (schedule.phase === "day" ? schedule.day : schedule.night) : settings.theme;
  // A board's own theme (#337), when the request shows a board that pins
  // one: it stands in for the site theme on that page, schedule included
  // (the pin is the board's whole look). The proxy passes the path along.
  // It paints the first load and seeds PrefsProvider's board theme, which
  // BoardTheme clears on the way out — never the site default, since this
  // layout doesn't re-render on a client-side move and the pin then stayed
  // on every page after it (#385).
  const board = boardForPath(requestHeaders.get("x-pathname"), config.boards, isAdmin);
  const pinned = board?.theme ? boardDefaultTheme(settings.theme, board, gallery) : null;

  // Apply the effective theme before first paint — imperatively, so React never
  // controls the <html> color variables (which would otherwise clobber it on
  // hydration). The script is the shared theme resolver's own source
  // (lib/theme-paint.ts, #325), run against localStorage and the serialized
  // site default: precedence (visitor wins, then the admin default theme), the
  // --scene-* deepen for light, the --accent-fg contrast pick and the per-theme
  // ink lift are therefore exactly what PrefsProvider paints after hydration.
  // Runs as the first node in <body>.
  // serializeForScript (not raw JSON.stringify) escapes `<`/`>`/`&` so a config
  // string value like a `preset` of `</script>…` can't break out of this inline
  // script and inject HTML into the page served to every visitor.
  // Under "themes only" the script needs the site's themes, since what's
  // stored is a chosen pack's name; otherwise just the policy rides along.
  const themeScript = inlineThemeScript(
    // A pinned board's theme stands in for the site default here, and shows
    // whatever the visitor's schedule switch says (as in PrefsProvider), so
    // no unscheduled theme rides along with it.
    serializeForScript({
      ...(pinned ?? siteTheme),
      policy: visitorTheming,
      ...(visitorTheming === "packs" ? { packs: packs.map(packFields) } : {}),
      ...(schedule && !pinned ? { unscheduled: schedule.base } : {}),
    }),
    {
    design: DESIGN_IDS,
    scene: SCENE_IDS,
    font: FONT_IDS,
    density: DENSITY_IDS,
    }
  );

  // suppressHydrationWarning on <html>: the inline theme script below mutates its
  // classes/inline styles (theme-light, design-*, scene-*, font-*, color vars)
  // before hydration from values the server can't know (visitor localStorage), so
  // the SSR/client diff on <html> is expected — scope the suppression to it so
  // React doesn't log #418.
  // The admin UI scale, as font-size on <html>: the whole UI is rem-based, so
  // one percentage scales text, paddings and cards uniformly. Server-rendered
  // (no flash); the layout editor live-updates the same property while tuning.
  const scale = settings.layout.scale;
  return (
    <html
      lang="en"
      className={`${fontVariables} h-full`}
      style={
        scale !== DEFAULT_UI_SCALE ? { fontSize: `${scale}%` } : undefined
      }
      suppressHydrationWarning
    >
      <body className="relative min-h-full overflow-x-hidden antialiased">
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeScript }} />
        {/* First Tab stop on every page (#274); every page's <main> carries
            id="main-content". Visible only while focused. */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60] focus:rounded-lg focus:bg-[var(--background)] focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:shadow-lg"
        >
          Skip to content
        </a>
        <PrefsProvider
          weatherEnabled={weather.enabled}
          ipLocation={weather.ipLocation}
          defaultTheme={siteTheme}
          initialBoardTheme={pinned}
          visitorTheming={visitorTheming}
          packs={packs}
          schedule={schedule}
          defaults={{
            timezone: settings.timezone || "UTC",
            latitude: weather.latitude,
            longitude: weather.longitude,
            units: weather.units,
          }}
        >
          <SceneLayer />
          {settings.announcement.enabled &&
            settings.announcement.message.trim() !== "" && (
              <AnnouncementBanner
                message={settings.announcement.message}
                tone={settings.announcement.tone}
                dismissible={settings.announcement.dismissible}
              />
            )}
          {children}
        </PrefsProvider>
      </body>
    </html>
  );
}
