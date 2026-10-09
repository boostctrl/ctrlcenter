"use client";

import { SEARCH_ENGINES, SEARCH_ENGINE_KEYS, type SearchEngine } from "@/lib/search";
import { AddButton, Card, Hint, ListPanel, RemoveButton, SelectField, TextField, controlClasses } from "../../ui";
import type { SettingsDraft } from "../useSettingsDraft";

// The Search engine, Custom bangs cards in admin Settings → Widgets (#285).
export default function SearchSettings({ d }: { d: SettingsDraft }) {
  const { settings, setSettings, bangs, bangRows, updateBang } = d;
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
            Type <span className="text-ink-60">!key term</span> in the search
            bar to jump to a site (use <span className="text-ink-60">%s</span>{" "}
            for the term). Built-ins (<span className="text-ink-60">!yt</span>,{" "}
            <span className="text-ink-60">!gh</span>,{" "}
            <span className="text-ink-60">!w</span>…) plus your app names and
            subtitles work already.
          </>
        }
      >
        <ListPanel>
          {bangs.map((b, i) => (
            <div key={bangRows.keys[i] ?? i} className="flex items-center gap-2">
              <span className="text-ink-40">!</span>
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
    </>
  );
}
