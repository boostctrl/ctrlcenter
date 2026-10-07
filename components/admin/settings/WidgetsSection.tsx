"use client";

import { MAX_FEED_CARDS, MAX_STAT_DISKS } from "@/lib/schema";
import { SEARCH_ENGINES, SEARCH_ENGINE_KEYS, type SearchEngine } from "@/lib/search";
import { AddButton, Card, Hint, ListPanel, MoveButtons, NumberRow, RemoveButton, SelectField, TextArea, TextField, ToggleRow, controlClasses, fieldLabelClasses } from "../ui";
import CalendarTest from "../CalendarTest";
import { useFeedHealth } from "../FeedHealth";
import CitySearch from "../CitySearch";
import { FeedCardEditor } from "./FeedCardEditor";
import type { SettingsDraft } from "./useSettingsDraft";

export default function WidgetsSection({ d }: { d: SettingsDraft }) {
  const {
    settings,
    setSettings,
    calendar,
    updateCalendar,
    notes,
    updateNotes,
    feeds,
    updateFeedCard,
    addFeedCard,
    removeFeedCard,
    moveFeedCard,
    countdown,
    countdownRows,
    updateCountdownItem,
    worldClocks,
    worldClockRows,
    updateWorldClockItem,
    systemStats,
    statDiskRows,
    updateStatDisk,
    bangs,
    bangRows,
    updateBang,
  } = d;
  // Health covers every URL the home page has fetched; each card reads its own
  // rows out of it. Poll while any card is enabled.
  const feedHealth = useFeedHealth(
    feeds.some((f) => f.enabled)
  );

  return (
    <>
      <Card title="Search engine">
        <SelectField
          label="Search bar engine"
          value={settings.search.engine}
          onChange={(e) =>
            setSettings({
              ...settings,
              search: { ...settings.search, engine: e.target.value as SearchEngine },
            })
          }
        >
          {SEARCH_ENGINE_KEYS.map((key) => (
            <option key={key} value={key}>
              {key === "custom" ? "Custom…" : SEARCH_ENGINES[key].label}
            </option>
          ))}
        </SelectField>
        {settings.search.engine === "custom" && (
          <TextField
            label="Custom search URL (use %s for the query)"
            placeholder="https://example.com/search?q=%s"
            value={settings.search.customUrl}
            onChange={(e) =>
              setSettings({
                ...settings,
                search: { ...settings.search, customUrl: e.target.value },
              })
            }
          />
        )}
        <Hint>
          Pressing Enter in the search bar opens the top match, or searches
          here when nothing matches.
        </Hint>
      </Card>

      <Card
        title="Custom bangs"
        intro={
          <>
            Type <span className="text-fg/60">!key term</span> in the search
            bar to jump to a site (use <span className="text-fg/60">%s</span>{" "}
            for the term). Built-ins (<span className="text-fg/60">!yt</span>,{" "}
            <span className="text-fg/60">!gh</span>,{" "}
            <span className="text-fg/60">!w</span>…) plus your app names and
            subtitles work already.
          </>
        }
      >
        <ListPanel>
          {bangs.map((b, i) => (
            <div key={bangRows.keys[i] ?? i} className="flex items-center gap-2">
              <span className="text-fg/40">!</span>
              <input
                value={b.key}
                onChange={(e) =>
                  updateBang(i, {
                    key: e.target.value.replace(/[^a-z0-9]/gi, "").toLowerCase(),
                  })
                }
                placeholder="key"
                aria-label={`Bang ${i + 1} key`}
                className={`${controlClasses} w-24`}
              />
              <input
                value={b.url}
                onChange={(e) => updateBang(i, { url: e.target.value })}
                placeholder="https://example.com/search?q=%s"
                aria-label={`Bang ${i + 1} URL`}
                className={`${controlClasses} min-w-0 flex-1`}
              />
              <RemoveButton
                label={`Remove bang ${i + 1}`}
                onClick={() => bangRows.removeAt(i)}
              />
            </div>
          ))}
          <AddButton onClick={() => bangRows.add({ key: "", url: "" })}>
            + Add bang
          </AddButton>
        </ListPanel>
      </Card>

      <Card
        title="Weather"
        toggle={{
          checked: settings.weather.enabled,
          onChange: (enabled) =>
            setSettings({
              ...settings,
              weather: { ...settings.weather, enabled },
            }),
        }}
      >
        <div className="flex flex-col gap-1.5">
          <span className={fieldLabelClasses}>Default location</span>
          <CitySearch
            onSelect={(latitude, longitude) =>
              setSettings({
                ...settings,
                weather: { ...settings.weather, latitude, longitude },
              })
            }
          />
          <Hint>
            Search a city to set the coordinates, or enter them manually.
          </Hint>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <TextField
            label="Latitude"
            type="number"
            step="any"
            min={-90}
            max={90}
            value={settings.weather.latitude}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              setSettings({
                ...settings,
                weather: {
                  ...settings.weather,
                  latitude: Number.isNaN(v) ? settings.weather.latitude : v,
                },
              });
            }}
          />
          <TextField
            label="Longitude"
            type="number"
            step="any"
            min={-180}
            max={180}
            value={settings.weather.longitude}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              setSettings({
                ...settings,
                weather: {
                  ...settings.weather,
                  longitude: Number.isNaN(v) ? settings.weather.longitude : v,
                },
              });
            }}
          />
        </div>

        <SelectField
          label="Units"
          value={settings.weather.units}
          onChange={(e) =>
            setSettings({
              ...settings,
              weather: {
                ...settings.weather,
                units: e.target.value as "imperial" | "metric",
              },
            })
          }
        >
          <option value="imperial">Imperial (°F)</option>
          <option value="metric">Metric (°C)</option>
        </SelectField>
      </Card>

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

      <Card
        title="RSS feed"
        intro="Show the latest entries from one or more RSS, Atom, or JSON feeds, merged newest-first. Add several cards for topical sources — news, releases, blogs — each placed separately in the home-page layout editor. Fetched server-side and cached for a few minutes; cards ship hidden until you show them."
      >
        <div className="flex flex-col gap-3">
          {feeds.map((f, i) => (
            <FeedCardEditor
              key={f.id}
              feed={f}
              index={i}
              count={feeds.length}
              health={feedHealth}
              onChange={(next) => updateFeedCard(f.id, next)}
              onRemove={() => removeFeedCard(f.id)}
              onMove={moveFeedCard}
            />
          ))}
          {feeds.length < MAX_FEED_CARDS && (
            <AddButton onClick={addFeedCard}>+ Add feed card</AddButton>
          )}
          <Hint>
            Within a card, several feeds merge newest-first and each entry
            shows its source. Add separate cards to place feeds independently
            on the dashboard.
          </Hint>
        </div>
      </Card>

      <Card
        title="Notes"
        intro="A free-form note card for the home page. Ships hidden — show it in the home-page layout editor (or the Home layout section) once there's something to say."
      >
        <TextField
          label="Card title"
          placeholder="Notes"
          value={notes.title}
          onChange={(e) => updateNotes({ title: e.target.value })}
        />
        <TextArea
          label="Note (markdown)"
          mono
          value={notes.content}
          onChange={(e) => updateNotes({ content: e.target.value })}
          rows={10}
          placeholder={"# Homelab\n- Renew certs **June 12**\n- `docker compose pull` after backups"}
        />
        <Hint>
          Supports a safe markdown subset: # ## ### headings, **bold**,
          *italic*, `code`, [links](https://…) (http/https only), - and 1.
          lists, &gt; quotes, ``` code blocks and --- rules. Raw HTML is shown
          as plain text, never rendered.
        </Hint>
      </Card>

      <Card
        title="Countdown"
        intro="Labeled dates shown as “in N days” rows — renewals, birthdays, deadlines. Ships hidden — show the card in the home-page layout editor once dates are added."
      >
        <TextField
          label="Card title"
          placeholder="Countdown"
          value={countdown.title}
          onChange={(e) =>
            setSettings((s) => ({
              ...s,
              countdown: { ...s.countdown, title: e.target.value },
            }))
          }
        />
        <ListPanel label="Dates">
          {countdown.items.map((item, i) => (
            <div
              key={countdownRows.keys[i] ?? i}
              className="flex items-center gap-2"
            >
              <input
                value={item.label}
                onChange={(e) => updateCountdownItem(i, { label: e.target.value })}
                placeholder="Renew domain"
                aria-label={`Countdown ${i + 1} label`}
                className={`${controlClasses} min-w-0 flex-1`}
              />
              <input
                type="date"
                value={item.date}
                onChange={(e) => updateCountdownItem(i, { date: e.target.value })}
                aria-label={`Countdown ${i + 1} date`}
                className={`${controlClasses} shrink-0`}
              />
              <RemoveButton
                label={`Remove countdown ${i + 1}`}
                onClick={() => countdownRows.removeAt(i)}
              />
            </div>
          ))}
          <AddButton onClick={() => countdownRows.add({ label: "", date: "" })}>
            + Add date
          </AddButton>
        </ListPanel>
        <Hint>
          Days count in each visitor&apos;s own time zone. Past dates dim and
          sink below the upcoming ones.
        </Hint>
      </Card>

      <Card
        title="World clocks"
        intro="Live clocks for the time zones you follow. Ships hidden — show the card in the home-page layout editor once zones are added."
      >
        <TextField
          label="Card title"
          placeholder="World clocks"
          value={worldClocks.title}
          onChange={(e) =>
            setSettings((s) => ({
              ...s,
              worldClocks: { ...s.worldClocks, title: e.target.value },
            }))
          }
        />
        <ListPanel label="Time zones">
          {worldClocks.items.map((item, i) => (
            <div
              key={worldClockRows.keys[i] ?? i}
              className="flex items-center gap-2"
            >
              {worldClocks.items.length > 1 && (
                <MoveButtons
                  index={i}
                  count={worldClocks.items.length}
                  label={`world clock ${i + 1}`}
                  onMove={worldClockRows.move}
                />
              )}
              <input
                value={item.label}
                onChange={(e) => updateWorldClockItem(i, { label: e.target.value })}
                placeholder="Label (optional)"
                aria-label={`World clock ${i + 1} label`}
                className={`${controlClasses} min-w-0 flex-1`}
              />
              <input
                list="settings-tz"
                value={item.timeZone}
                onChange={(e) => updateWorldClockItem(i, { timeZone: e.target.value })}
                placeholder="Time zone…"
                aria-label={`World clock ${i + 1} time zone`}
                className={`${controlClasses} min-w-0 flex-1`}
              />
              <RemoveButton
                label={`Remove world clock ${i + 1}`}
                onClick={() => worldClockRows.removeAt(i)}
              />
            </div>
          ))}
          <AddButton
            onClick={() => worldClockRows.add({ label: "", timeZone: "" })}
          >
            + Add time zone
          </AddButton>
        </ListPanel>
        <Hint>
          Each clock shows the current time in its own zone. Leave the label
          blank to use the zone&apos;s city name.
        </Hint>
      </Card>

      <Card
        title="System stats"
        intro="CPU, memory and disk usage of whatever runs the app. Ships hidden — show the card in the home-page layout editor. The card itself says whether it's measuring this container or the host machine."
      >
        <TextField
          label="Card title"
          placeholder="System stats"
          value={systemStats.title}
          onChange={(e) =>
            setSettings((s) => ({
              ...s,
              systemStats: { ...s.systemStats, title: e.target.value },
            }))
          }
        />
        <ListPanel label="Extra disks">
          {systemStats.disks.map((disk, i) => (
            <div
              key={statDiskRows.keys[i] ?? i}
              className="flex items-center gap-2"
            >
              {systemStats.disks.length > 1 && (
                <MoveButtons
                  index={i}
                  count={systemStats.disks.length}
                  label={`disk ${i + 1}`}
                  onMove={statDiskRows.move}
                />
              )}
              <input
                value={disk.label}
                onChange={(e) => updateStatDisk(i, { label: e.target.value })}
                placeholder="Label (optional)"
                aria-label={`Disk ${i + 1} label`}
                className={`${controlClasses} min-w-0 flex-1`}
              />
              <input
                value={disk.path}
                onChange={(e) => updateStatDisk(i, { path: e.target.value })}
                placeholder="/mnt/media"
                aria-label={`Disk ${i + 1} path`}
                className={`${controlClasses} min-w-0 flex-1`}
              />
              <RemoveButton
                label={`Remove disk ${i + 1}`}
                onClick={() => statDiskRows.removeAt(i)}
              />
            </div>
          ))}
          {systemStats.disks.length < MAX_STAT_DISKS && (
            <AddButton onClick={() => statDiskRows.add({ label: "", path: "" })}>
              + Add disk
            </AddButton>
          )}
        </ListPanel>
        <Hint>
          The data volume is always shown. A path here has to be mounted into
          the app&apos;s container to be measurable; a path that isn&apos;t is
          simply skipped. Leave the label blank and the card shows the
          folder&apos;s name, never the full mount path.
        </Hint>
      </Card>
    </>
  );
}
