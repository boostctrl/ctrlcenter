import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/api-auth";
import { saveWallpaper, isWallpaperType, MAX_WALLPAPER_BYTES } from "@/lib/uploads";

// Upload a wallpaper (#333): admin-only, like the icon collection. The file
// lands in the uploads dir under a wallpaper- prefix and is served by the
// public GET /api/icons/[name] like any upload, so a theme can reference it.
export async function POST(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }
  if (!isWallpaperType(file.type)) {
    return NextResponse.json(
      { error: "Unsupported image type. Use PNG, JPEG or WebP." },
      { status: 400 }
    );
  }
  if (file.size === 0 || file.size > MAX_WALLPAPER_BYTES) {
    return NextResponse.json(
      { error: `Image must be 1 byte to ${Math.floor(MAX_WALLPAPER_BYTES / (1024 * 1024))} MB.` },
      { status: 400 }
    );
  }
  const data = new Uint8Array(await file.arrayBuffer());
  const saved = await saveWallpaper(file.name || "wallpaper", file.type, data);
  return NextResponse.json(saved, { status: 201 });
}
