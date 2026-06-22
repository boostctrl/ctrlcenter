import Icon from "./Icon";
import type { BookmarkItem } from "@/lib/schema";

export default function BookmarkGroup({
  category,
  items,
}: {
  category: string;
  items: BookmarkItem[];
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
              className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm text-fg/70 transition-colors hover:bg-fg/5 hover:text-fg"
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
