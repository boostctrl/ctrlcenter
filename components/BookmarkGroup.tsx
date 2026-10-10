import Icon from "./Icon";
import type { BookmarkItem, GroupColor } from "@/lib/schema";

// `topId` marks the search's top match (the link Enter opens), #274.
export default function BookmarkGroup({
  name,
  icon,
  color,
  items,
  topId = null,
}: {
  // The group's name (#299), and its own icon and color (#316).
  name: string;
  icon?: string;
  color?: GroupColor;
  items: BookmarkItem[];
  topId?: string | null;
}) {
  return (
    <div className="glass-card px-5 py-4">
      <h3
        className={`mb-3 flex items-center gap-2 text-xs font-semibold tracking-[0.18em] uppercase ${
          color ? `group-color-${color}` : ""
        }`}
      >
        {icon && <Icon icon={icon} name={name} size={16} />}
        {/* The accent gradient unless the group has its own color. */}
        <span className={`min-w-0 truncate ${color ? "" : "accent-label"}`}>{name}</span>
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
