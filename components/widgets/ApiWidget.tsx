import SectionTitle from "../SectionTitle";
import type { ApiResult, ApiTone } from "@/lib/api-widget";

// The generic API widget (#302): the view the server mapped out of a JSON
// endpoint — a headline stat, a gauge, key/value rows or a list. Purely
// presentational; nothing here ever saw the raw response.
const TONE: Record<ApiTone, string> = {
  ok: "text-ink-90",
  warn: "text-status-warning",
  critical: "text-status-down",
};

export default function ApiWidget({
  title,
  result,
  showTitle = true,
}: {
  title: string;
  result: ApiResult;
  showTitle?: boolean;
}) {
  const { view, error } = result;
  return (
    <section>
      {showTitle && <SectionTitle>{title}</SectionTitle>}
      <div className="glass-card flex min-h-[6rem] flex-col justify-center gap-2 px-5 py-4">
        {!view ? (
          <p className="text-sm text-ink-55">{error ?? "No data"}</p>
        ) : view.display === "stat" ? (
          <div className="flex flex-col">
            <span className={`text-3xl font-bold tabular-nums ${TONE[view.tone]}`}>
              {view.value}
              {view.unit && <span className="ml-1 text-base font-medium text-ink-55">{view.unit}</span>}
            </span>
            {view.label && <span className="text-sm text-ink-55">{view.label}</span>}
          </div>
        ) : view.display === "gauge" ? (
          <div className="flex items-center gap-4">
            <Ring ratio={view.ratio} tone={view.tone} />
            <div className="flex flex-col">
              <span className={`text-2xl font-bold tabular-nums ${TONE[view.tone]}`}>
                {view.value}
                {view.unit && <span className="ml-1 text-sm font-medium text-ink-55">{view.unit}</span>}
              </span>
              {view.label && <span className="text-sm text-ink-55">{view.label}</span>}
            </div>
          </div>
        ) : view.rows.length === 0 ? (
          <p className="text-sm text-ink-55">Nothing to list.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-fg/10">
            {view.rows.map((row, i) => (
              <li key={i} className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
                <span className="min-w-0 truncate text-ink-70" title={row.label}>
                  {row.label}
                </span>
                {row.value && <span className="shrink-0 font-medium text-ink-90 tabular-nums">{row.value}</span>}
              </li>
            ))}
          </ul>
        )}
        {view && error && <p className="text-xs text-ink-45">Showing the last good data — {error}</p>}
      </div>
    </section>
  );
}

// A ring gauge, as on the Monitor tiles: r = 15.9155 makes the circumference
// about 100, so the dash array is the percentage.
function Ring({ ratio, tone }: { ratio: number; tone: ApiTone }) {
  const pct = Math.round(ratio * 100);
  const color = tone === "critical" ? "text-status-down" : tone === "warn" ? "text-status-warning" : "text-[var(--accent-from)]";
  return (
    <svg viewBox="0 0 36 36" className="h-14 w-14 shrink-0 -rotate-90" role="img" aria-label={`${pct}%`}>
      <circle cx="18" cy="18" r="15.9155" fill="none" className="text-fg/10" stroke="currentColor" strokeWidth="3" />
      <circle
        cx="18"
        cy="18"
        r="15.9155"
        fill="none"
        className={color}
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={`${pct} 100`}
      />
    </svg>
  );
}
