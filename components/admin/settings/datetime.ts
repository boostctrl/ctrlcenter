
// <input type="datetime-local"> shows/edits a local wall-clock string with no
// zone, but a window is stored as a UTC ISO instant. Convert both directions
// in the browser's own zone so a value round-trips to the same wall-clock time.
export function isoToLocalInput(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
export function localInputToIso(value: string): string {
  if (!value) return "";
  const d = new Date(value); // a zone-less datetime-local is parsed as local
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}
