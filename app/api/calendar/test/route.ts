import { NextRequest, NextResponse } from "next/server";
import { SECRET_PLACEHOLDER } from "@/lib/schema";
import { isAdminRequest } from "@/lib/api-auth";
import { ENV_CALENDAR_ID, probeCalendar } from "@/lib/calendar-fetch";
import { getSiteConfig } from "@/lib/config";
import { isSavedUrl, withoutEnvSecrets } from "@/lib/secrets";

// Admin-only: fetch the given calendar URL fresh and report whether it's a
// reachable, parsable feed and how many upcoming events it has. Gated here
// (not via the proxy, which only covers /admin, /api/settings, /api/config) so
// the public sibling routes stay public. Takes the URL/credentials in the body
// so the admin can test the values currently in the form before saving.
export async function POST(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  const url = typeof body?.url === "string" ? body.url : "";
  const username = typeof body?.username === "string" ? body.username : undefined;
  const password = typeof body?.password === "string" ? body.password : undefined;
  if (!url.trim()) {
    return NextResponse.json({ ok: false, count: 0, error: "No URL set" });
  }
  // CTRLCENTER_CALDAV_PASS only goes to the saved URL of the calendar it
  // belongs to (lib/calendar-fetch asCalendar); a probe of any other URL uses
  // just the credentials the form sent.
  const widgets = (await getSiteConfig()).widgets;
  const envCalendar = widgets.find((w) => w.id === ENV_CALENDAR_ID);
  const saved = envCalendar?.type === "calendar" ? envCalendar.url : "";
  // A placeholder in the form stands for the stored password of the calendar
  // at that address (#382); for any other address it stands for nothing.
  const storedPassword =
    password === SECRET_PLACEHOLDER
      ? widgets.find((w) => w.type === "calendar" && isSavedUrl(url, w.url))
      : undefined;
  const probe = () =>
    probeCalendar(url, {
      username,
      password:
        password === SECRET_PLACEHOLDER
          ? storedPassword?.type === "calendar"
            ? storedPassword.password
            : ""
          : password,
    });
  const result = isSavedUrl(url, saved)
    ? await probe()
    : await withoutEnvSecrets(probe);
  return NextResponse.json(result);
}
