"use client";

import { Hint, NumberRow, SelectField, TextField, ToggleRow } from "../../ui";
import CalendarTest from "../../CalendarTest";
import type { InstanceEditorProps } from "./index";

// A Calendar widget's fields in admin Settings → Widgets (#285, #297).
export default function CalendarSettings({ w, onChange }: InstanceEditorProps<"calendar">) {
  return (
    <>
      <TextField
        label="Calendar URL (.ics or CalDAV/WebDAV)"
        placeholder="https://calendar.google.com/…/basic.ics"
        value={w.url}
        onChange={(e) => onChange({ url: e.target.value })}
      />
      <div className="grid grid-cols-2 gap-3">
        <TextField
          label="Username (optional)"
          autoComplete="off"
          value={w.username}
          onChange={(e) => onChange({ username: e.target.value })}
        />
        <TextField
          label="Password (optional)"
          type="password"
          autoComplete="new-password"
          value={w.password}
          onChange={(e) => onChange({ password: e.target.value })}
        />
      </div>
      <SelectField
        label="Home widget view"
        value={w.homeView}
        onChange={(e) => onChange({ homeView: e.target.value as "agenda" | "month" })}
        hint="Agenda lists upcoming events; Month shows a mini calendar that links through. The /calendar page always opens on the month view."
      >
        <option value="agenda">Agenda</option>
        <option value="month">Month</option>
      </SelectField>
      {w.homeView === "agenda" && (
        <NumberRow
          label="Events to show"
          min={1}
          max={20}
          value={w.count}
          onChange={(count) => onChange({ count })}
        />
      )}
      <ToggleRow
        label="Hide when no upcoming events"
        hint={
          <>
            Drop the home-page card when the agenda is empty. The /calendar
            page is unaffected.
          </>
        }
        checked={w.hideWhenEmpty}
        onChange={(hideWhenEmpty) => onChange({ hideWhenEmpty })}
      />
      <CalendarTest url={w.url} username={w.username} password={w.password} />
      {w.username.trim() !== "" && /^http:\/\//i.test(w.url.trim()) && (
        <p className="text-xs text-status-warning">
          This URL is plain http, so the credentials are sent in cleartext.
          Use https where possible.
        </p>
      )}
      <Hint>
        For a private calendar, paste its CalDAV/WebDAV collection URL and
        credentials (a Nextcloud app password is recommended); the events are
        fetched server-side. Times show in each visitor&apos;s time zone;
        repeating events expand for common rules (daily/weekly/monthly). Every
        calendar shown on the home page also appears on the /calendar page.
      </Hint>
    </>
  );
}
