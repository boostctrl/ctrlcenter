// A list the admin edits item by item, saved as what changed (#396). The
// Settings form and the layout editor used to PUT whole lists from their
// page-load copies, so a widget added in one tab was deleted by an unrelated
// edit in another, and a rename sent every other board's visibility back as
// it was at page load. A patch names only the items this form touched:
// `upsert` replaces each by id (appending a new one), `remove` drops ids, and
// `order` is the full id order when the admin reordered. The server applies it
// to the stored list, so edits made elsewhere survive.
export type ListPatch<T> = { upsert?: T[]; remove?: string[]; order?: string[] };

type WithId = { id: string };

// The stored list with `patch` applied: removals, then upserts (in place, or
// appended), then the order when one is given. Ids the order doesn't name
// keep their relative position after the ones it does.
export function applyListPatch<T extends WithId>(stored: T[], patch: ListPatch<T>): T[] {
  const removed = new Set(patch.remove ?? []);
  let next = stored.filter((item) => !removed.has(item.id));
  for (const item of patch.upsert ?? []) {
    const at = next.findIndex((o) => o.id === item.id);
    if (at === -1) next = [...next, item];
    else next = next.map((o, i) => (i === at ? item : o));
  }
  if (patch.order) {
    const rank = new Map(patch.order.map((id, i) => [id, i]));
    const named = next.filter((o) => rank.has(o.id)).sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
    const rest = next.filter((o) => !rank.has(o.id));
    next = [...named, ...rest];
  }
  return next;
}

// What changed between `before` (the list as last saved) and `after` (the form's
// current list), as a patch. An item counts as changed when its JSON differs;
// `order` is sent only when applying the upserts and removals alone would leave
// the ids in a different sequence. Null when nothing changed.
export function diffList<T extends WithId>(before: T[], after: T[]): ListPatch<T> | null {
  const was = new Map(before.map((item) => [item.id, JSON.stringify(item)]));
  const upsert = after.filter((item) => was.get(item.id) !== JSON.stringify(item));
  const kept = new Set(after.map((item) => item.id));
  const remove = before.filter((item) => !kept.has(item.id)).map((item) => item.id);
  const patch: ListPatch<T> = {};
  if (upsert.length) patch.upsert = upsert;
  if (remove.length) patch.remove = remove;
  const replayed = applyListPatch(before, patch).map((item) => item.id);
  const wanted = after.map((item) => item.id);
  if (replayed.join("\u0000") !== wanted.join("\u0000")) patch.order = wanted;
  return Object.keys(patch).length ? patch : null;
}
