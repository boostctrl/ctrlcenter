// Widget instances (#297): the admin edits the whole list at once.
import type { WidgetInstance } from "../schema";
import { mutate } from "./store";

// Replace every widget instance. Layout rows naming an instance that's gone
// are left in place and skipped when the layout resolves (lib/layout.ts), so
// this never has to touch the layout and the two saves can't race.
export async function replaceWidgets(widgets: WidgetInstance[]): Promise<WidgetInstance[]> {
  return mutate((config) => {
    config.widgets = widgets;
    return config.widgets;
  });
}
