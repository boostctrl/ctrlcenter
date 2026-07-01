// The heading above a home-page dashboard section (Applications, Bookmarks,
// Favorites, the calendar widget, …). Shared so every section's title reads
// identically. `action` is an optional right-aligned control (e.g. the calendar
// widget's "View calendar" link).
export default function SectionTitle({
  children,
  action,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex items-baseline justify-between gap-4">
      <h2 className="text-sm font-semibold tracking-[0.2em] text-fg/60 uppercase">
        {children}
      </h2>
      {action}
    </div>
  );
}
