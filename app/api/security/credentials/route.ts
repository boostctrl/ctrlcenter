import { NextRequest, NextResponse } from "next/server";
import { viewerOf } from "@/lib/api-auth";
import { readConfigInternal, readConfigOnDisk, resaveConfig, rotateConfigKey } from "@/lib/config";
import { credentialStatus } from "@/lib/config-crypto";
import { requireRecentAuth } from "@/lib/reauth";
import { eventMeta, recordSecurityEvent } from "@/lib/security-events";
import { notifySecurityEvent } from "@/lib/security-alerts";
import { z } from "zod";

// The stored credentials at rest (#370), for Settings → Security: where the
// key comes from and how many are encrypted, plaintext or unreadable.
export async function GET(request: NextRequest) {
  const config = await readConfigInternal();
  const viewer = await viewerOf(request, config.auth);
  if (!viewer?.isAdmin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await credentialStatus(await readConfigOnDisk()));
}

const actionSchema = z.object({ action: z.enum(["encrypt", "rotate"]) });

// "encrypt": save the config now, so a credential still in plaintext goes
// in encrypted. "rotate": a new key file, every credential saved again
// under it; a step-up, and refused while the key comes from CONFIG_KEY (a
// new one is set there) or while a value can't be opened (it would be lost
// with the old key).
export async function POST(request: NextRequest) {
  const config = await readConfigInternal();
  const viewer = await viewerOf(request, config.auth);
  if (!viewer?.isAdmin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  if (parsed.data.action === "encrypt") {
    await resaveConfig();
    return NextResponse.json(await credentialStatus(await readConfigOnDisk()));
  }

  const recent = await requireRecentAuth(request, config.auth);
  if (!recent.ok) return recent.response;
  const status = await credentialStatus(await readConfigOnDisk());
  if (status.source === "env") {
    return NextResponse.json(
      { error: "The key comes from CONFIG_KEY. Set a new one there, move the old one to CONFIG_KEY_PREVIOUS, and restart." },
      { status: 409 }
    );
  }
  if (status.source === "none") {
    return NextResponse.json({ error: "The config volume can't hold an encryption key." }, { status: 409 });
  }
  if (status.unreadable > 0) {
    return NextResponse.json(
      { error: "Some stored credentials can't be opened with the current key; a new key would lose them for good." },
      { status: 409 }
    );
  }
  await rotateConfigKey();
  notifySecurityEvent(await recordSecurityEvent("key.rotated", eventMeta(request, viewer.account.id)));
  return NextResponse.json(await credentialStatus(await readConfigOnDisk()));
}
