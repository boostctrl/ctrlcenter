import { NextResponse } from "next/server";
import { getIconVariantIndex } from "@/lib/icon-cache";

// Public: the theme-variant index from the dashboard-icons set's metadata.json,
// proxied-and-cached like the icons themselves (#128) so light/dark icon
// variants keep working offline. Only the slugs that have variants are served
// (~40 KB instead of the full ~1.2 MB index, #276). When it has never been
// fetchable this serves an empty index — exactly the degrade the client used
// against the CDN, so icons simply use their base variant.
export async function GET() {
  const text = await getIconVariantIndex();
  return new NextResponse(text ?? "{}", {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": text
        ? "public, max-age=86400"
        : "public, max-age=300",
    },
  });
}
