import Icon from "./Icon";
import type { BookmarkItem } from "@/lib/schema";

// `topId` marks the search's top match (the link Enter opens), #274.
export default function BookmarkGroup({
  category,
  items,
  topId = null,
}: {
  category: string;
  items: BookmarkItem[];
  topId?: string | null;
}) {
  return (
    <div className="glass-card px-5 py-4">
      <h3 className="accent-label mb-3 text-xs font-semibold tracking-[0.18em] uppercase">
        {category}
      </h3>
      <ul className="space-y-1">
        {items.map((b) => (
          <li key={b.id}>
            <a
              href={b.url}
              target="_blank"
              rel="noreferrer"
              className={`flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm text-ink-70 transition-colors hover:bg-fg/5 hover:text-fg ${
                b.id === topId
                  ? "bg-fg/5 outline-2 outline-[color:var(--scene-from)]"
                  : ""
              }`}
            >
              <Icon icon={b.icon} name={b.name} size={18} />
              <span className="truncate">{b.name}</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
