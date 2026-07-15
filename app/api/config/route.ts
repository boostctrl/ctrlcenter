import { NextRequest, NextResponse } from "next/server";
import { readConfigInternal, replaceConfig, stripAuth } from "@/lib/config";
import { migrateConfigShape } from "@/lib/config-migrate";
import { configSchema } from "@/lib/schema";
import {
  exportIcons,
  sanitizeBundledIcons,
  writeBundledIcons,
} from "@/lib/uploads";

// Admin-only (gated by the proxy matcher). GET exports the config for backup;
// POST imports/replaces it after validation. The admin credential never crosses
// this boundary in either direction (stripAuth on the way out; replaceConfig
// keeps the instance's own auth on the way in) — a backup file shouldn't leak a
// password hash or be able to change/wipe the password.
//
// Uploaded icons are bundled into the export as base64 `uploads` entries and
// re-materialized on import, so a backup restored on a different instance
// keeps its custom icons (#72). Backups from before bundling simply lack the
// field and import as before.
export const dynamic = "force-dynamic";

export async function GET() {
  const config = await readConfigInternal();
  const uploads = await exportIcons();
  const body =
    uploads.length > 0
      ? { ...stripAuth(config), uploads }
      : stripAuth(config);
  return NextResponse.json(body, {
    headers: {
      "Content-Disposition": 'attachment; filename="ctrlcenter-config.json"',
    },
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  // Upgrade a pre-2.0 backup BEFORE validating: zod strips keys it doesn't
  // know, so parsing the raw body first would silently launder the legacy
  // fields (single feed url, width/spaceBelow rows, 12-column spans) out of
  // the file instead of migrating them.
  const parsed = configSchema.safeParse(migrateConfigShape(body).value);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "That doesn't look like a valid ctrlcenter config file." },
      { status: 400 }
    );
  }
  // Bundled icons ride beside the config fields (the schema ignores the extra
  // key). Validate them before replacing anything so a bad file is rejected
  // whole instead of half-applied.
  const icons = sanitizeBundledIcons(
    (body as Record<string, unknown>).uploads
  );
  if (icons === null) {
    return NextResponse.json(
      { error: "The icons bundled in that file are invalid." },
      { status: 400 }
    );
  }
  const config = await replaceConfig(parsed.data);
  await writeBundledIcons(icons);
  return NextResponse.json(stripAuth(config));
}
