import type { MetadataRoute } from "next";
import { getSettings } from "@/lib/config";
import { resolveIconUrl } from "@/lib/icons";

// Generated per-request so the app name reflects the current settings rather
// than whatever was on disk at build time.
export const dynamic = "force-dynamic";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const settings = await getSettings();
  const name = settings.title || "Home";
  // Mirror the tab favicon (see generateMetadata in app/layout.tsx): the
  // configured icon when set, else the bundled default from /public.
  const iconSrc =
    (settings.favicon && resolveIconUrl(settings.favicon)) || "/icon.svg";
  const type = iconSrc.endsWith(".png")
    ? "image/png"
    : iconSrc.endsWith(".svg") || iconSrc === "/icon.svg"
      ? "image/svg+xml"
      : undefined;
  return {
    name,
    short_name: name,
    description: "Personal dashboard",
    start_url: "/",
    display: "standalone",
    background_color: "#06070d",
    theme_color: "#06070d",
    icons: [{ src: iconSrc, sizes: "any", ...(type ? { type } : {}) }],
  };
}
