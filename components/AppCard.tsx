import Icon from "./Icon";
import { StatusDot } from "./StatusProvider";
import type { AppItem } from "@/lib/schema";

export default function AppCard({ app }: { app: AppItem }) {
  return (
    <a
      href={app.url}
      target="_blank"
      rel="noreferrer"
      className="glass-card group flex items-center gap-4 px-5 py-4"
    >
      <StatusDot id={app.id} />
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-fg/5 ring-1 ring-fg/10">
        <Icon icon={app.icon} name={app.name} size={26} />
      </div>
      <div className="min-w-0">
        <p className="truncate font-semibold text-fg/90 group-hover:text-fg">
          {app.name}
        </p>
        {app.subtitle && (
          <p className="truncate text-sm text-fg/40">{app.subtitle}</p>
        )}
      </div>
    </a>
  );
}
