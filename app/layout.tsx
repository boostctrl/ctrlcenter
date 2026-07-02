import type { Metadata } from "next";
import { headers } from "next/headers";
import {
  Plus_Jakarta_Sans,
  Inter,
  Poppins,
  Nunito,
  Lora,
  JetBrains_Mono,
} from "next/font/google";
import { getSettings } from "@/lib/config";
import { DEFAULT_UI_SCALE } from "@/lib/layout";
import { resolveIconUrl } from "@/lib/icons";
import { serializeForScript } from "@/lib/serialize";
import { PrefsProvider } from "@/components/PrefsProvider";
import SceneLayer from "@/components/scenes/SceneLayer";
import "./globals.css";

// Every selectable font (see lib/fonts.ts) must be imported here: next/font is
// analyzed at build time, so fonts can't be chosen dynamically by id. Each
// exposes a CSS variable; the active one is selected by a `font-<id>` class on
// <html> (app/globals.css). Only the rendered font's files are fetched by the
// browser, so loading several is cheap at runtime.
const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-jakarta",
  weight: ["300", "400", "500", "600", "700", "800"],
});
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const poppins = Poppins({
  subsets: ["latin"],
  variable: "--font-poppins",
  weight: ["400", "500", "600", "700"],
});
const nunito = Nunito({ subsets: ["latin"], variable: "--font-nunito" });
const lora = Lora({ subsets: ["latin"], variable: "--font-lora" });
const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
});

const fontVariables = [
  jakarta.variable,
  inter.variable,
  poppins.variable,
  nunito.variable,
  lora.variable,
  jetbrains.variable,
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
  // hydration). Precedence (visitor wins, then the admin default theme): a saved
  // `.theme-light` always tracks the resolved mode; an active look (visitor
  // custom, else the admin custom default colors) supplies the surface colors
  // for that mode — the look carries both variants, so picking a mode just flips
  // which one shows — else the CSS defaults apply. Accent override and
  // design/scene classes are layered on last. Runs as the first node in <body>.
  // MUST mirror applyAll() / resolveLook() in PrefsProvider — including the
  // --scene-* deepen for light (dp() mirrors deepenForLight in scenes/color.ts),
  // so scene backdrops paint saturated on the first frame rather than washing in,
  // and the --accent-fg contrast pick (lm() mirrors applyAccent's luminance), so
  // accent buttons get legible text before hydration too.
  // serializeForScript (not raw JSON.stringify) escapes `<`/`>`/`&` so a config
  // string value like a `preset` of `</script>…` can't break out of this inline
  // script and inject HTML into the page served to every visitor.
  const themeScript = `(function(){try{var dt=${serializeForScript(
    defaultTheme
  )};var el=document.documentElement;var s=el.style;var prefersDark=window.matchMedia('(prefers-color-scheme: dark)').matches;var m=localStorage.getItem('ctrlcenter:theme');var modeChosen=(m==='light'||m==='dark'||m==='system');var mode=modeChosen?m:dt.mode;var dark=mode==='dark'||(mode==='system'&&prefersDark);el.classList.toggle('theme-light',!dark);function cs(o){return o&&typeof o.background==='string'&&typeof o.accentFrom==='string'?o:null;}var look=null;var ct=localStorage.getItem('ctrlcenter:activeTheme');if(ct){try{var c=JSON.parse(ct);if(c){if(cs(c.dark)&&cs(c.light)){look={dark:c.dark,light:c.light};}else if(cs(c)){look={dark:c,light:c};}}}catch(e){}}if(!look&&dt.background&&dt.foreground){look={dark:{background:dt.background,foreground:dt.foreground,accentFrom:dt.accentFrom,accentTo:dt.accentTo},light:{background:dt.backgroundLight||dt.background,foreground:dt.foregroundLight||dt.foreground,accentFrom:dt.accentFrom,accentTo:dt.accentTo}};}var v=look?(dark?look.dark:look.light):null;if(v){s.setProperty('--background',v.background);s.setProperty('--foreground',v.foreground);s.setProperty('--fg',v.foreground);}var af=v?v.accentFrom:dt.accentFrom;var at=v?v.accentTo:dt.accentTo;var ao=localStorage.getItem('ctrlcenter:accent');if(ao){try{var a=JSON.parse(ao);if(a&&(a.dark||a.light)){a=dark?a.dark:a.light;}if(a&&a.from&&a.to){af=a.from;at=a.to;}}catch(e){}}s.setProperty('--accent-from',af);s.setProperty('--accent-to',at);function lm(hx){var m=/^#?([0-9a-fA-F]{6})$/.exec((hx||'').trim());if(!m)return 0.5;var n=parseInt(m[1],16);return(0.299*((n>>16)&255)+0.587*((n>>8)&255)+0.114*(n&255))/255;}s.setProperty('--accent-fg',(lm(af)+lm(at))/2>=0.6?'#000000':'#ffffff');function dp(hx){var m=/^#?([0-9a-fA-F]{6})$/.exec((hx||'').trim());if(!m)return hx;var n=parseInt(m[1],16);var r=((n>>16)&255)/255,g=((n>>8)&255)/255,b=(n&255)/255;var mx=Math.max(r,g,b),mn=Math.min(r,g,b),l=(mx+mn)/2,sa=0,h=0;if(mx!==mn){var d=mx-mn;sa=l>0.5?d/(2-mx-mn):d/(mx+mn);if(mx===r)h=(g-b)/d+(g<b?6:0);else if(mx===g)h=(b-r)/d+2;else h=(r-g)/d+4;h/=6;}l*=0.6;sa=Math.min(1,sa*1.15);function hu(p,q,t){if(t<0)t+=1;if(t>1)t-=1;if(t<1/6)return p+(q-p)*6*t;if(t<1/2)return q;if(t<2/3)return p+(q-p)*(2/3-t)*6;return p;}var qq=l<0.5?l*(1+sa):l+sa-l*sa,pp=2*l-qq;function tc(t){return Math.round(hu(pp,qq,t)*255);}return 'rgb('+tc(h+1/3)+','+tc(h)+','+tc(h-1/3)+')';}s.setProperty('--scene-from',dark?af:dp(af));s.setProperty('--scene-to',dark?at:dp(at));function pick(k,valid,dd,dl){var raw=localStorage.getItem(k);var v=null;if(raw){var o=null;try{o=JSON.parse(raw);}catch(e){o=raw;}if(typeof o==='string'){v=o;}else if(o&&typeof o==='object'){v=dark?o.dark:o.light;}}if(valid.indexOf(v)<0){v=dark?dd:(dl||dd);}return v;}var design=pick('ctrlcenter:design',['glass','aero','flat','soft','minimal','bold','cyber','clay','frost','outline','paper','gradient','aura','emboss','carve','stripe','sketch','console'],dt.design,dt.designLight);if(design&&design!=='glass'){el.classList.add('design-'+design);}var scene=pick('ctrlcenter:scene',['aurora','abyss','nebula','grid','starfield','waves','rays','traces','dots','horizon','orbit','peaks','rain','fireflies','blueprint','prisms','petals','comets'],dt.scene,dt.sceneLight);if(scene&&scene!=='aurora'){el.classList.add('scene-'+scene);}var font=pick('ctrlcenter:font',['jakarta','inter','poppins','nunito','lora','jetbrains'],dt.font,dt.fontLight);if(font&&font!=='jakarta'){el.classList.add('font-'+font);}}catch(e){}})();`;

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
