// What the layout editor and the admin call each widget instance (#297): its
// own title when it has one, else its type's label, numbered when several
// share it ("Notes", "Notes 2") so they stay tell-apart-able. A number is
// skipped when its label is already another instance's own or an earlier
// numbered one, so "Notes", "Notes", "Notes 2" are told apart as "Notes",
// "Notes 3", "Notes 2" (#484). Pure.
import { WIDGET_LABELS } from "../layout";
import type { WidgetInstance } from "../schema";

export function instanceLabels(instances: readonly WidgetInstance[]): Record<string, string> {
  const base = instances.map((w) => {
    const title = "title" in w && typeof w.title === "string" ? w.title.trim() : "";
    return title || WIDGET_LABELS[w.type];
  });
  const taken = new Set(base);
  const used = new Set<string>();
  // The last number given to each shared label; the first holder keeps it bare.
  const lastNumber = new Map<string, number>();
  const out: Record<string, string> = {};
  instances.forEach((w, i) => {
    const b = base[i];
    let label = b;
    const last = lastNumber.get(b);
    if (last === undefined) {
      lastNumber.set(b, 1);
    } else {
      let n = last + 1;
      while (taken.has(`${b} ${n}`) || used.has(`${b} ${n}`)) n++;
      lastNumber.set(b, n);
      label = `${b} ${n}`;
    }
    used.add(label);
    out[w.id] = label;
  });
  return out;
}
