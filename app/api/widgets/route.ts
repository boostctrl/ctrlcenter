import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/api-auth";
import { z } from "zod";
import {
  InvalidWidgetsError,
  addWidget,
  readConfigInternal,
  replaceWidgets,
  restoreWidgets,
  widgetForAdmin,
} from "@/lib/config";
import { WIDGET_IDS } from "@/lib/widgets/defs";
import { widgetInstancesUpdateSchema } from "@/lib/schema";
import { requireRecentAuth } from "@/lib/reauth";
import { widgetsChangeTarget } from "@/lib/reauth-targets";

// Admin-only: replace the widget instances (#297) — the list the admin
// Settings → Widgets tab edits and autosaves whole.
export async function PUT(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  const parsed = widgetInstancesUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid widgets" },
      { status: 400 }
    );
  }
  // Step-up (#378) when the save re-points an API widget's request or a
  // calendar's address or sign-in — where an env-held secret would go.
  const { auth, widgets: stored } = await readConfigInternal();
  // A placeholder the form sent back stands for the stored credential (#382).
  const incoming = restoreWidgets(parsed.data, stored);
  if (widgetsChangeTarget(incoming, stored)) {
    const recent = await requireRecentAuth(request, auth.passwordHash);
    if (!recent.ok) return recent.response;
  }
  return NextResponse.json((await replaceWidgets(incoming)).map(widgetForAdmin));
}

// Admin-only: add one widget of a type, with its defaults and a fresh id —
// the layout editor's palette (#303). Answers with the new instance; placing
// it on a board is the editor's own layout save.
const addSchema = z.object({ type: z.enum(WIDGET_IDS as unknown as [string, ...string[]]) });

export async function POST(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const parsed = addSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Unknown widget type" }, { status: 400 });
  try {
    return NextResponse.json(await addWidget(parsed.data.type as Parameters<typeof addWidget>[0]), { status: 201 });
  } catch (e) {
    if (e instanceof InvalidWidgetsError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
