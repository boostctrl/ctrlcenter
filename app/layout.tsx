import type { Metadata } from "next";
import { headers } from "next/headers";
import {
  Plus_Jakarta_Sans,
  Inter,
  Poppins,
  Nunito,
  Lora,
  JetBrains_Mono,
  Outfit,
  Space_Grotesk,
  Manrope,
  Rubik,
  Playfair_Display,
  Quicksand,
} from "next/font/google";
import { getSettings } from "@/lib/config";
import { DEFAULT_UI_SCALE } from "@/lib/layout";
import { resolveIconUrl } from "@/lib/icons";
import { serializeForScript } from "@/lib/serialize";
import { DENSITY_IDS, DESIGN_IDS, SCENE_IDS } from "@/lib/theme";
import { inlineThemeScript } from "@/lib/theme-paint";
import { FONT_IDS } from "@/lib/fonts";
import { PrefsProvider } from "@/components/PrefsProvider";
import SceneLayer from "@/components/scenes/SceneLayer";
import AnnouncementBanner from "@/components/AnnouncementBanner";
import "./globals.css";

// Every selectable font (see lib/fonts.ts) must be imported here: next/font is
// analyzed at build time, so fonts can't be chosen dynamically by id. Each
// exposes a CSS variable; the active one is selected by a `font-<id>` class on
// <html> (app/globals.css). Only the default face is preloaded: next/font
// preloads every font by default, which had each page download ~400 KB of
// faces it never renders (#276). The others are fetched only when a visitor's
// chosen font class makes the browser use them.
const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-jakarta",
  weight: ["300", "400", "500", "600", "700", "800"],
});
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", preload: false });
const poppins = Poppins({
  subsets: ["latin"],
  variable: "--font-poppins",
  weight: ["400", "500", "600", "700"],
  preload: false,
});
const nunito = Nunito({ subsets: ["latin"], variable: "--font-nunito", preload: false });
const lora = Lora({ subsets: ["latin"], variable: "--font-lora", preload: false });
const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  preload: false,
});
const outfit = Outfit({ subsets: ["latin"], variable: "--font-outfit", preload: false });
const grotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-grotesk", preload: false });
const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope", preload: false });
const rubik = Rubik({ subsets: ["latin"], variable: "--font-rubik", preload: false });
const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-playfair",
  preload: false,
});
const quicksand = Quicksand({ subsets: ["latin"], variable: "--font-quicksand", preload: false });

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

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const settings = await getSettings();
  const weather = settings.weather;
  const defaultTheme = settings.theme;
  // Per-request CSP nonce from the proxy, so our inline theme script is allowed
  // without script-src 'unsafe-inline'. Reading headers() also opts pages into
  // dynamic rendering, which is required for a per-request nonce to match.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

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
  const themeScript = inlineThemeScript(serializeForScript(defaultTheme), {
    design: DESIGN_IDS,
    scene: SCENE_IDS,
    font: FONT_IDS,
    density: DENSITY_IDS,
  });

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
          defaultTheme={defaultTheme}
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
