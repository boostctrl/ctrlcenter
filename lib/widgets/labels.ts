// What the layout editor and the admin call each widget instance (#297): its
// own title when it has one, else its type's label, numbered when several
// share it ("Notes", "Notes 2") so they stay tell-apart-able. Pure.
import { WIDGET_LABELS } from "../layout";
import type { WidgetInstance } from "../schema";

export function instanceLabels(instances: readonly WidgetInstance[]): Record<string, string> {
  const base = instances.map((w) => {
    const title = "title" in w && typeof w.title === "string" ? w.title.trim() : "";
    return title || WIDGET_LABELS[w.type];
  });
  const total = new Map<string, number>();
  for (const b of base) total.set(b, (total.get(b) ?? 0) + 1);
  const seen = new Map<string, number>();
  const out: Record<string, string> = {};
  instances.forEach((w, i) => {
    const b = base[i];
    const n = (seen.get(b) ?? 0) + 1;
    seen.set(b, n);
    out[w.id] = (total.get(b) ?? 0) > 1 && n > 1 ? `${b} ${n}` : b;
  });
  return out;
}
