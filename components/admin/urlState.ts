"use client";

// Mirror a piece of client component state into the query string with a
// native history replace: refresh restores the view and the URL is shareable,
// with no server round-trip, scroll reset, or history entry per change.
// AdminDashboard owns the `tab` param this way; SettingsManager owns
// `section` (#132).
export function replaceUrlParams(
  mutate: (params: URLSearchParams) => void
): void {
  const url = new URL(window.location.href);
  mutate(url.searchParams);
  window.history.replaceState(null, "", url);
}
