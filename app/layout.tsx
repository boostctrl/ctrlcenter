import type { Metadata } from "next";
import { headers } from "next/headers";
import { Plus_Jakarta_Sans } from "next/font/google";
import { getSettings } from "@/lib/config";
import { resolveIconUrl } from "@/lib/icons";
import { PrefsProvider } from "@/components/PrefsProvider";
import SceneLayer from "@/components/scenes/SceneLayer";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-jakarta",
  weight: ["300", "400", "500", "600", "700", "800"],
});

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSettings();
  // A configured favicon (icon slug, bundled local icon, or URL) overrides the
  // default app/icon.svg; otherwise fall back to that convention.
  const favicon = settings.favicon ? resolveIconUrl(settings.favicon) : null;
  return {
    title: settings.title || "Home",
    description: "Personal dashboard",
    ...(favicon ? { icons: { icon: favicon } } : {}),
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
  // hydration). Precedence (visitor wins, then the admin default theme): a saved
  // custom theme → an explicit light/dark mode → admin custom default colors →
  // admin default mode; accent override and design are layered on last. Runs as
  // the first node in <body>. Mirrors the resolution in PrefsProvider.
  const themeScript = `(function(){try{var dt=${JSON.stringify(
    defaultTheme
  )};var s=document.documentElement.style;s.setProperty('--accent-from',dt.accentFrom);s.setProperty('--accent-to',dt.accentTo);function setMode(m){var d=m==='dark'||(m==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('theme-light',!d);}function setColors(bg,fg){s.setProperty('--background',bg);s.setProperty('--foreground',fg);s.setProperty('--fg',fg);}var ct=localStorage.getItem('homepage:activeTheme');var c=null;if(ct){try{c=JSON.parse(ct);}catch(e){}}if(c&&c.background){setColors(c.background,c.foreground);s.setProperty('--accent-from',c.accentFrom);s.setProperty('--accent-to',c.accentTo);}else{var m=localStorage.getItem('homepage:theme');if(m==='light'||m==='dark'||m==='system'){setMode(m);}else if(dt.background&&dt.foreground){setColors(dt.background,dt.foreground);}else{setMode(dt.mode);}}var ao=localStorage.getItem('homepage:accent');if(ao){var a=JSON.parse(ao);if(a&&a.from){s.setProperty('--accent-from',a.from);s.setProperty('--accent-to',a.to);}}var dz=localStorage.getItem('homepage:design');var design=['glass','aero','flat','soft','minimal','bold','cyber'].indexOf(dz)>=0?dz:dt.design;if(design!=='glass'){document.documentElement.classList.add('design-'+design);}var sz=localStorage.getItem('homepage:scene');var scene=['aurora','abyss'].indexOf(sz)>=0?sz:dt.scene;if(scene&&scene!=='aurora'){document.documentElement.classList.add('scene-'+scene);}}catch(e){}})();`;

  return (
    <html lang="en" className={`${jakarta.variable} h-full`}>
      <body className="relative min-h-full overflow-x-hidden antialiased">
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeScript }} />
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
          {children}
        </PrefsProvider>
      </body>
    </html>
  );
}
