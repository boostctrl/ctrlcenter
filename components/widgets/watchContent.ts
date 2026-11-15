// Calls `measure` whenever a scroll box's overflow could have changed: when
// the box resizes, when anything directly inside it resizes (rows narrowed by
// a search, stats that update themselves, a countdown that ticks), and when
// its contents change (rows added or removed, a link appearing). At an
// explicit height the box's own size never changes, so watching it alone
// missed all of these (#493, #494). Returns the function that stops it.
export function watchContent(box: HTMLElement, measure: () => void): () => void {
  const ro = new ResizeObserver(() => measure());
  const observe = () => {
    ro.disconnect();
    ro.observe(box);
    for (const child of Array.from(box.children)) ro.observe(child);
  };
  observe();
  const mo = new MutationObserver((records) => {
    // New or removed children of the box itself need watching (or letting
    // go of); a change deeper down shows up as one of them resizing, or
    // as something focusable appearing, which only `measure` can tell.
    if (records.some((r) => r.target === box && r.type === "childList")) observe();
    measure();
  });
  mo.observe(box, { childList: true, subtree: true });
  return () => {
    ro.disconnect();
    mo.disconnect();
  };
}
