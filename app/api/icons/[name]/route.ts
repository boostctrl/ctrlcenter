import { NextRequest, NextResponse } from "next/server";
import { readIcon } from "@/lib/uploads";

// Public: uploaded custom icons render on the (unauthenticated) dashboard. Served
// from the data dir rather than /public so they persist in the mounted volume.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const icon = await readIcon(name);
  if (!icon) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return new NextResponse(icon.data, {
    headers: {
      "Content-Type": icon.type,
      // Filenames carry a random suffix, so each URL is immutable — cache hard.
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      // Defense for SVG: even on direct navigation, neutralize scripts/objects so
      // an uploaded SVG can't run code on our origin. Harmless for raster types.
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:",
    },
  });
}
