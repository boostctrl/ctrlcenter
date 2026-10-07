"use client";

import Link from "next/link";
import { buttonClasses } from "@/lib/buttons";
import { Card, Hint, ToggleRow } from "../ui";
import type { SettingsDraft } from "./useSettingsDraft";

export default function LayoutSection({ d }: { d: SettingsDraft }) {
  const {
    settings,
    setSettings,
    components,
    setComponent,
    isWidgetShown,
    setWidgetShown,
    widgetToggles,
    componentToggles,
  } = d;
  return (
    <>
      <Card
        title="Visible widgets"
        intro="Show or hide home-page widgets. Weather and the calendar are toggled under Widgets, the status row under Monitoring; the split clock/weather/status widgets are managed in the home-page editor."
      >
        <div className="flex flex-col gap-2.5">
          {widgetToggles.map((t) => (
            <ToggleRow
              key={t.id}
              label={t.label}
              checked={isWidgetShown(t.id)}
              onChange={(shown) => setWidgetShown(t.id, shown)}
            />
          ))}
          {componentToggles.map((t) => (
            <ToggleRow
              key={t.key}
              label={t.label}
              checked={components[t.key]}
              onChange={(value) => setComponent(t.key, value)}
            />
          ))}
          <ToggleRow
            label="Group private apps separately"
            checked={settings.groupPrivateApps}
            onChange={(groupPrivateApps) =>
              setSettings({ ...settings, groupPrivateApps })
            }
          />
        </div>
        <Hint>
          Private apps only appear when you&apos;re signed in, so this
          &ldquo;Private Applications&rdquo; group is only ever visible to you.
        </Hint>
        {!components.settingsButton && (
          <Hint>
            With the floating navigation menu off, reach this page directly at
            /admin.
          </Hint>
        )}
      </Card>

      <Card
        title="Arrangement"
        intro="Widgets are arranged directly on the home page: drag to reorder, resize by dragging a card's edges, and show or hide everything in place — including swapping the header card for the split clock, weather, and status widgets."
      >
        <Link href="/?edit=1" className={`${buttonClasses("ghost", "sm")} self-start`}>
          Arrange the home page
        </Link>
      </Card>
    </>
  );
}
