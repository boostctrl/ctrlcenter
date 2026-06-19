import type { MetadataRoute } from "next";
import { getSettings } from "@/lib/config";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const settings = await getSettings();
  const name = settings.title || "Home";
  return {
    name,
    short_name: name,
    description: "Personal dashboard",
    start_url: "/",
    display: "standalone",
    background_color: "#06070d",
    theme_color: "#06070d",
    icons: [{ src: "/favicon.ico", sizes: "any", type: "image/x-icon" }],
  };
}
