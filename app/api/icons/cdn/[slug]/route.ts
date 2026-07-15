import { NextRequest, NextResponse } from "next/server";
import { getCdnIcon } from "@/lib/icon-cache";

// Public: one dashboard-icons slug, proxied-and-cached server-side (#128) so
// slug icons render without every visitor's browser reaching the CDN — and
// keep rendering offline once cached. The slug is strictly validated in
// lib/icon-cache; unknown/unfetchable slugs 404 and the client falls back to
// its letter avatar.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const bytes = await getCdnIcon(slug);
  if (!bytes) {
    return NextResponse.json(
      { error: "Not found" },
      // A miss can be transient (offline, CDN hiccup) — don't let caches pin it.
      { status: 404, headers: { "Cache-Control": "no-store" } }
    );
  }
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "image/svg+xml",
      // The upstream ref (@main) is mutable but changes rarely; a week in the
      // browser cache is a fine trade — the disk copy is authoritative.
      "Cache-Control": "public, max-age=604800",
      "X-Content-Type-Options": "nosniff",
      // Same SVG defense as uploaded icons: even on direct navigation,
      // neutralize scripts/objects so a fetched SVG can't run code on our origin.
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:",
    },
  });
}
