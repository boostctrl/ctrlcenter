import { NextResponse } from "next/server";
import { getCdnIconMetadata } from "@/lib/icon-cache";

// Public: the dashboard-icons set's metadata.json (the theme-variant index),
// proxied-and-cached like the icons themselves (#128) so light/dark icon
// variants keep working offline. When it has never been fetchable this serves
// an empty index — exactly the degrade the client used against the CDN, so
// icons simply use their base variant.
export async function GET() {
  const text = await getCdnIconMetadata();
  return new NextResponse(text ?? "{}", {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": text
        ? "public, max-age=86400"
        : "public, max-age=300",
    },
  });
}
