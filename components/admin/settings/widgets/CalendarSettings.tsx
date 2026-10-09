"use client";

import { Card, Hint, NumberRow, SelectField, TextField, ToggleRow } from "../../ui";
import CalendarTest from "../../CalendarTest";
import type { SettingsDraft } from "../useSettingsDraft";

// The Calendar card in admin Settings → Widgets (#285).
export default function CalendarSettings({ d }: { d: SettingsDraft }) {
  const { calendar, updateCalendar } = d;
  return (
    <Card
      title="Calendar"
      intro="Show upcoming events from a published iCal (.ics) URL — or a private CalDAV/WebDAV calendar (e.g. a Nextcloud DAV URL) with credentials."
      toggle={{
        checked: calendar.enabled,
        onChange: (enabled) => updateCalendar({ enabled }),
      }}
    >
      {calendar.enabled && (
        <>
          <TextField
            label="Calendar URL (.ics or CalDAV/WebDAV)"
            placeholder="https://calendar.google.com/…/basic.ics"
            value={calendar.url}
            onChange={(e) => updateCalendar({ url: e.target.value })}
          />
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="Username (optional)"
              autoComplete="off"
              value={calendar.username}
              onChange={(e) => updateCalendar({ username: e.target.value })}
            />
            <TextField
              label="Password (optional)"
              type="password"
              autoComplete="new-password"
              value={calendar.password}
              onChange={(e) => updateCalendar({ password: e.target.value })}
            />
          </div>
          <SelectField
            label="Home widget view"
            value={calendar.homeView}
            onChange={(e) =>
              updateCalendar({
                homeView: e.target.value as "agenda" | "month",
              })
            }
            hint="Agenda lists upcoming events; Month shows a mini calendar that links through. The /calendar page always opens on the month view."
          >
            <option value="agenda">Agenda</option>
            <option value="month">Month</option>
          </SelectField>
          {calendar.homeView === "agenda" && (
            <NumberRow
              label="Events to show"
              min={1}
              max={20}
              value={calendar.count}
              onChange={(count) => updateCalendar({ count })}
            />
          )}
          <ToggleRow
            label="Hide when no upcoming events"
            hint={
              <>
                Drop the home-page card when the agenda is empty. The{" "}
                /calendar page is unaffected.
              </>
            }
            checked={calendar.hideWhenEmpty}
            onChange={(hideWhenEmpty) => updateCalendar({ hideWhenEmpty })}
          />
          <CalendarTest
            url={calendar.url}
            username={calendar.username}
            password={calendar.password}
          />
          {calendar.username.trim() !== "" &&
            /^http:\/\//i.test(calendar.url.trim()) && (
              <p className="text-xs text-amber-400/80">
                This URL is plain http, so the credentials are sent in
                cleartext. Use https where possible.
              </p>
            )}
          <Hint>
            For a private calendar, paste its CalDAV/WebDAV collection URL
            and credentials (a Nextcloud app password is recommended); the
            events are fetched server-side. The password can instead come
            from the CTRLCENTER_CALDAV_PASS env var. Times show in each
            visitor&apos;s time zone; repeating events expand for common
            rules (daily/weekly/monthly).
          </Hint>
        </>
      )}
    </Card>
  );
}
