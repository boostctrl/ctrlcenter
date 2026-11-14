// A change to one widget instance: the fields to merge, or a function of the
// latest instance that returns them. A list editor passes the function, so two
// row mutations batched in one tick (quick "+ Add" clicks) compose instead of
// both starting from the list as rendered, which kept only the last (#163).
export type InstancePatch<W> = Partial<W> | ((prev: W) => Partial<W>);

export function applyInstancePatch<W extends object>(w: W, patch: InstancePatch<W>): W {
  return { ...w, ...(typeof patch === "function" ? patch(w) : patch) };
}
