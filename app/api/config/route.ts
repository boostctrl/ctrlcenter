import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/api-auth";
import { readConfigInternal, replaceConfig, stripAuth } from "@/lib/config";
import { migrateConfig, NewerConfigError } from "@/lib/config-migrate";
import { bundledOutageNotesSchema, configSchema } from "@/lib/schema";
import { exportOutageNotes, flush, importOutageNotes, loadHistory } from "@/lib/status-history";
import {
  exportIcons,
  sanitizeBundledIcons,
  writeBundledIcons,
} from "@/lib/uploads";

// Admin-only: gated by the proxy matcher AND re-checked here, so a proxy
// bypass can't reach the export or the import on its own. GET exports the
// config for backup; POST imports/replaces it after validation. The admin
// credential never crosses this boundary in either direction (stripAuth on the
// way out; replaceConfig keeps the instance's own auth on the way in) — a
// backup file shouldn't leak a password hash or be able to change/wipe the
// password.
//
// Uploaded icons are bundled into the export as base64 `uploads` entries and
// re-materialized on import, so a backup restored on a different instance
// keeps its custom icons (#72). Backups from before bundling simply lack the
// field and import as before.
//
// Outage incident notes (#176) live with the uptime history, not the config,
// so they ride along the same way, as `outageNotes`: each recorded outage that
// carries a note (#309). The rest of the history rebuilds on its own.
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const config = await readConfigInternal();
  if (!(await isAdminRequest(request, config.auth.passwordHash))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const uploads = await exportIcons();
  await loadHistory();
  const outageNotes = exportOutageNotes();
  const body = {
    ...stripAuth(config),
    ...(uploads.length > 0 ? { uploads } : {}),
    ...(outageNotes.length > 0 ? { outageNotes } : {}),
  };
  return NextResponse.json(body, {
    headers: {
      "Content-Disposition": 'attachment; filename="ctrlcenter-config.json"',
    },
  });
}

export async function POST(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  // Upgrade a pre-2.0 backup BEFORE validating: zod strips keys it doesn't
  // know, so parsing the raw body first would silently launder the legacy
  // fields (single feed url, width/spaceBelow rows, 12-column spans) out of
  // the file instead of migrating them.
  let migrated: unknown;
  try {
    migrated = migrateConfig(body).value;
  } catch (error) {
    // A backup from a newer release (#288): say so rather than "invalid".
    if (error instanceof NewerConfigError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
  const parsed = configSchema.safeParse(migrated);
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
  const rawNotes = (body as Record<string, unknown>).outageNotes;
  const notes = bundledOutageNotesSchema.safeParse(rawNotes ?? []);
  if (!notes.success) {
    return NextResponse.json(
      { error: "The incident notes bundled in that file are invalid." },
      { status: 400 }
    );
  }
  const config = await replaceConfig(parsed.data);
  await writeBundledIcons(icons);
  if (notes.data.length > 0) {
    await loadHistory();
    importOutageNotes(notes.data);
    await flush();
  }
  return NextResponse.json(stripAuth(config));
}
