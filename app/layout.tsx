import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { getSettings } from "@/lib/config";
import { PrefsProvider } from "@/components/PrefsProvider";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-jakarta",
  weight: ["300", "400", "500", "600", "700", "800"],
});

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSettings();
  return {
    title: settings.title || "Home",
    description: "Personal dashboard",
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

  // Apply the effective theme before first paint — imperatively, so React never
  // controls the <html> color variables (which would otherwise clobber it on
  // hydration). Precedence (visitor wins, then the admin default theme): a saved
  // custom theme → an explicit light/dark mode → admin custom default colors →
  // admin default mode; accent override and design are layered on last. Runs as
  // the first node in <body>. Mirrors the resolution in PrefsProvider.
  const themeScript = `(function(){try{var dt=${JSON.stringify(
    defaultTheme
  )};var s=document.documentElement.style;s.setProperty('--accent-from',dt.accentFrom);s.setProperty('--accent-to',dt.accentTo);function setMode(m){var d=m==='dark'||(m==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('theme-light',!d);}function setColors(bg,fg){s.setProperty('--background',bg);s.setProperty('--foreground',fg);s.setProperty('--fg',fg);}var ct=localStorage.getItem('homepage:activeTheme');var c=null;if(ct){try{c=JSON.parse(ct);}catch(e){}}if(c&&c.background){setColors(c.background,c.foreground);s.setProperty('--accent-from',c.accentFrom);s.setProperty('--accent-to',c.accentTo);}else{var m=localStorage.getItem('homepage:theme');if(m==='light'||m==='dark'||m==='system'){setMode(m);}else if(dt.background&&dt.foreground){setColors(dt.background,dt.foreground);}else{setMode(dt.mode);}}var ao=localStorage.getItem('homepage:accent');if(ao){var a=JSON.parse(ao);if(a&&a.from){s.setProperty('--accent-from',a.from);s.setProperty('--accent-to',a.to);}}var dz=localStorage.getItem('homepage:design');var design=['glass','aero','flat','soft','minimal','bold','cyber'].indexOf(dz)>=0?dz:dt.design;if(design!=='glass'){document.documentElement.classList.add('design-'+design);}}catch(e){}})();`;

  return (
    <html lang="en" className={`${jakarta.variable} h-full`}>
      <body className="relative min-h-full overflow-x-hidden antialiased">
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
          style={{ opacity: "var(--glow-opacity, 1)" }}
        >
          <div
            className="animate-float absolute -top-32 -left-32 h-96 w-96 rounded-full opacity-30 blur-3xl"
            style={{ backgroundColor: "var(--accent-from)" }}
          />
          <div
            className="animate-float absolute top-1/3 -right-32 h-[28rem] w-[28rem] rounded-full opacity-20 blur-3xl"
            style={{ backgroundColor: "var(--accent-to)", animationDelay: "4s" }}
          />
          <div
            className="animate-float absolute bottom-0 left-1/4 h-80 w-80 rounded-full opacity-[0.15] blur-3xl"
            style={{ backgroundColor: "var(--accent-from)", animationDelay: "8s" }}
          />
        </div>
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
          {children}
        </PrefsProvider>
      </body>
    </html>
  );
}
