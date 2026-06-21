// Order the bookmark categories that are actually present by the admin-set
// `order`, then append any present categories that aren't listed (in their given
// first-seen order). Stale entries in `order` (deleted/renamed categories) are
// ignored. Shared by the public dashboard and the admin manager.
export function orderCategories(present: string[], order: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const c of order) {
    if (!seen.has(c) && present.includes(c)) {
      result.push(c);
      seen.add(c);
    }
  }
  for (const c of present) {
    if (!seen.has(c)) {
      result.push(c);
      seen.add(c);
    }
  }
  return result;
}
