"use client";

import { MAX_FEED_CARDS } from "@/lib/schema";
import { useFeedHealth } from "../FeedHealth";
import { AddButton, Card, Hint, RemoveButton, Switch, fieldLabelClasses, subCardClasses } from "../ui";
import { INSTANCE_GROUPS, SITE_SETTINGS } from "./widgets";
import type { SettingsDraft } from "./useSettingsDraft";

// The Widgets tab (#285): the site settings some widgets read, then every
// content widget type with its instances (#297). Each instance has its own
// editor, a switch for whether it shows on the home page, and Remove; Add puts
// another of the type on the board.
export default function WidgetsSection({ d }: { d: SettingsDraft }) {
  const { instancesOf, widgetLabels, updateWidget, addWidget, removeWidget, isWidgetShown, setWidgetShown } = d;
  // Health covers every URL the home page has fetched; each feed reads its own
  // rows out of it. Polls while any feed card exists.
  const feedHealth = useFeedHealth(instancesOf("feed").length > 0);
  return (
    <>
      {SITE_SETTINGS.map((Settings, i) => (
        <Settings key={i} d={d} />
      ))}
      {INSTANCE_GROUPS.map(({ type, title, intro, add, Editor }) => {
        const instances = instancesOf(type);
        const atCap = type === "feed" && instances.length >= MAX_FEED_CARDS;
        return (
          <Card key={type} title={title} intro={intro}>
            <div className="flex flex-col gap-3">
              {instances.length === 0 && <Hint>None yet.</Hint>}
              {instances.map((w) => {
                const label = widgetLabels[w.id];
                return (
                  <div key={w.id} className={`${subCardClasses} flex flex-col gap-3 p-3`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className={`${fieldLabelClasses} truncate`}>{label}</span>
                      <div className="flex shrink-0 items-center gap-2">
                        <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-60">
                          On the home page
                          <Switch
                            checked={isWidgetShown(w.id)}
                            onChange={(shown) => setWidgetShown(w.id, shown)}
                            label={`Show ${label} on the home page`}
                          />
                        </label>
                        <RemoveButton label={`Remove ${label}`} onClick={() => removeWidget(w.id)} />
                      </div>
                    </div>
                    <Editor
                      w={w as never}
                      label={label}
                      onChange={(patch) => updateWidget(w.id, patch)}
                      feedHealth={feedHealth}
                    />
                  </div>
                );
              })}
              {!atCap && <AddButton onClick={() => addWidget(type)}>{add}</AddButton>}
              <Hint>Arrange them on the home page in its layout editor.</Hint>
            </div>
          </Card>
        );
      })}
    </>
  );
}
