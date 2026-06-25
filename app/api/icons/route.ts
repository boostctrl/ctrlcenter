import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/api-auth";
import {
  saveIcon,
  listIcons,
  deleteIcon,
  extForType,
  MAX_ICON_BYTES,
} from "@/lib/uploads";

// The /api/icons collection (list/upload/delete) is admin-only — enforced here
// rather than via the proxy because the sibling GET /api/icons/[name] that serves
// a single icon is intentionally public (icons render on the public dashboard).

export async function GET(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await listIcons());
}

export async function POST(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }
  if (!extForType(file.type)) {
    return NextResponse.json(
      { error: "Unsupported image type. Use PNG, JPEG, WebP, GIF, SVG, or ICO." },
      { status: 400 }
    );
  }
  if (file.size === 0 || file.size > MAX_ICON_BYTES) {
    return NextResponse.json(
      { error: `Image must be 1 byte to ${Math.floor(MAX_ICON_BYTES / 1024)} KB.` },
      { status: 400 }
    );
  }
  const data = new Uint8Array(await file.arrayBuffer());
  const saved = await saveIcon(file.name || "icon", file.type, data);
  return NextResponse.json(saved, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const name = request.nextUrl.searchParams.get("name") ?? "";
  const ok = await deleteIcon(name);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
