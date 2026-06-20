import type { Metadata } from "next";
import type { CSSProperties } from "react";
import { Plus_Jakarta_Sans } from "next/font/google";
import { getSettings } from "@/lib/config";
import { accentColors } from "@/lib/theme";
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

// Applies the visitor's saved theme before first paint to avoid a flash. Mirrors
// applyTheme() in PrefsProvider; runs from localStorage since theme is per-visitor.
const themeScript = `(function(){try{var t=localStorage.getItem('homepage:theme')||'system';var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(!d)document.documentElement.classList.add('theme-light');}catch(e){}})();`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const settings = await getSettings();
  const { from, to } = accentColors(settings.accent);
  const accentVars = {
    "--accent-from": from,
    "--accent-to": to,
  } as CSSProperties;
  const weather = settings.weather;

  return (
    <html lang="en" className={`${jakarta.variable} h-full`} style={accentVars}>
      <body className="relative min-h-full overflow-x-hidden antialiased">
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
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
