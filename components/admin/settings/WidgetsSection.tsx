"use client";

import { WIDGET_SETTINGS } from "./widgets";
import type { SettingsDraft } from "./useSettingsDraft";

// The Widgets tab: every widget's own editor, from the settings registry
// (./widgets, #285).
export default function WidgetsSection({ d }: { d: SettingsDraft }) {
  return (
    <>
      {Object.entries(WIDGET_SETTINGS).map(([id, Editor]) => (
        <Editor key={id} d={d} />
      ))}
    </>
  );
}
