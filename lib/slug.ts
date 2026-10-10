// A URL-safe id made from a display name, kept unique among `taken`: what new
// boards (#298) and groups (#299) are keyed by. Pure, so client and server
// mint the same id from the same name.
export function slugId(name: string, taken: Iterable<string>, fallback: string): string {
  const used = new Set(taken);
  const stem =
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 56) || fallback;
  let id = stem;
  for (let n = 2; used.has(id); n++) id = `${stem}-${n}`;
  return id;
}
