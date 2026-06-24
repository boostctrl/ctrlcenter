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
  // `.theme-light` always tracks the resolved mode; an active look (visitor
  // custom, else admin custom default colors while no mode is chosen) supplies
  // the surface colors for that mode, else the CSS defaults apply. Accent
  // override and design/scene classes are layered on last. Runs as the first
  // node in <body>. MUST mirror applyAll() in PrefsProvider.
  const themeScript = `(function(){try{var dt=${JSON.stringify(
    defaultTheme
  )};var el=document.documentElement;var s=el.style;var prefersDark=window.matchMedia('(prefers-color-scheme: dark)').matches;var m=localStorage.getItem('ctrlcenter:theme');var modeChosen=(m==='light'||m==='dark'||m==='system');var mode=modeChosen?m:dt.mode;var dark=mode==='dark'||(mode==='system'&&prefersDark);el.classList.toggle('theme-light',!dark);function cs(o){return o&&typeof o.background==='string'&&typeof o.accentFrom==='string'?o:null;}var look=null;var ct=localStorage.getItem('ctrlcenter:activeTheme');if(ct){try{var c=JSON.parse(ct);if(c){if(cs(c.dark)&&cs(c.light)){look={dark:c.dark,light:c.light};}else if(cs(c)){look={dark:c,light:c};}}}catch(e){}}if(!look&&!modeChosen&&dt.background&&dt.foreground){look={dark:{background:dt.background,foreground:dt.foreground,accentFrom:dt.accentFrom,accentTo:dt.accentTo},light:{background:dt.backgroundLight||dt.background,foreground:dt.foregroundLight||dt.foreground,accentFrom:dt.accentFrom,accentTo:dt.accentTo}};}var v=look?(dark?look.dark:look.light):null;if(v){s.setProperty('--background',v.background);s.setProperty('--foreground',v.foreground);s.setProperty('--fg',v.foreground);}var af=v?v.accentFrom:dt.accentFrom;var at=v?v.accentTo:dt.accentTo;var ao=localStorage.getItem('ctrlcenter:accent');if(ao){try{var a=JSON.parse(ao);if(a&&a.from){af=a.from;at=a.to;}}catch(e){}}s.setProperty('--accent-from',af);s.setProperty('--accent-to',at);var dz=localStorage.getItem('ctrlcenter:design');var design=['glass','aero','flat','soft','minimal','bold','cyber','clay'].indexOf(dz)>=0?dz:dt.design;if(design!=='glass'){el.classList.add('design-'+design);}var sz=localStorage.getItem('ctrlcenter:scene');var scene=['aurora','abyss','nebula','grid','starfield','waves','rays','traces'].indexOf(sz)>=0?sz:dt.scene;if(scene&&scene!=='aurora'){el.classList.add('scene-'+scene);}}catch(e){}})();`;

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
