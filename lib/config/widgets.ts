// Widget instances (#297): the admin edits the whole list at once in
// Settings → Widgets, or one instance in place from the layout editor (#303).
import { randomUUID } from "node:crypto";
import { newInstance, widgetInstancesUpdateSchema, type Group, type WidgetInstance } from "../schema";
import type { WidgetType } from "../layout";
import { allTags } from "../groups";
import { integrationLabels } from "../services/ids";
import { mutate, readConfigInternal } from "./store";

// Replace every widget instance. Layout rows naming an instance that's gone
// are left in place and skipped when the layout resolves (lib/layout.ts), so
// this never has to touch the layout and the two saves can't race.
export async function replaceWidgets(widgets: WidgetInstance[]): Promise<WidgetInstance[]> {
  return mutate((config) => {
    config.widgets = widgets;
    return config.widgets;
  });
}

// One instance as its editor needs it (#303): as stored, secrets included —
// the board page only ever has the redacted copy, and saving that back would
// wipe them — with what the editors offer to pick from. Admin-only callers.
export type WidgetEditContext = {
  widget: WidgetInstance;
  groups: Group[];
  tags: string[];
  integrations: { id: string; label: string }[];
};
export async function widgetForEditing(id: string): Promise<WidgetEditContext | null> {
  const config = await readConfigInternal();
  const widget = config.widgets.find((w) => w.id === id);
  if (!widget) return null;
  const labels = integrationLabels(config.integrations);
  return {
    widget,
    groups: config.groups,
    tags: allTags(config.apps),
    integrations: config.integrations.map((i) => ({ id: i.id, label: labels[i.id] })),
  };
}

export class InvalidWidgetsError extends Error {}

// Save one instance, adding it when its id is new — checked against the rules
// for the whole list (caps, URL schemes), so editing one in place can't get
// past what Settings → Widgets enforces. The others are left exactly as
// stored.
export async function saveWidget(widget: WidgetInstance): Promise<WidgetInstance> {
  return mutate((config) => {
    const exists = config.widgets.some((w) => w.id === widget.id);
    const next = exists
      ? config.widgets.map((w) => (w.id === widget.id ? widget : w))
      : [...config.widgets, widget];
    const parsed = widgetInstancesUpdateSchema.safeParse(next);
    if (!parsed.success) throw new InvalidWidgetsError(parsed.error.issues[0]?.message ?? "Invalid widget");
    config.widgets = next;
    return widget;
  });
}

// Create a widget of a type with a fresh id (the type, then a short random
// suffix) and its defaults — the layout editor's add-widget palette (#303).
// A feed card starts with one empty URL row to type into, as in Settings.
export async function addWidget(type: WidgetType): Promise<WidgetInstance> {
  return mutate((config) => {
    let id = "";
    do id = `${type}-${randomUUID().slice(0, 8)}`;
    while (config.widgets.some((w) => w.id === id));
    const created = newInstance(type, id);
    const widget = created.type === "feed" ? { ...created, urls: [""] } : created;
    const parsed = widgetInstancesUpdateSchema.safeParse([...config.widgets, widget]);
    if (!parsed.success) throw new InvalidWidgetsError(parsed.error.issues[0]?.message ?? "Can't add that widget");
    config.widgets.push(widget);
    return widget;
  });
}
