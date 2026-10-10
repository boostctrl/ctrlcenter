"use client";

import { useCallback, useEffect, useState } from "react";
import type { ThemePack } from "@/lib/theme";
import { buttonClasses } from "@/lib/buttons";
import { useConfirm } from "../Confirm";
import { apiErrorMessage } from "../apiError";

// The wallpapers uploaded to this site (#339): every upload under the
// wallpaper- prefix, with what still uses it (the site default, its light
// twin, a gallery pack) so one isn't deleted from under a theme. The icon
// picker hides these on purpose; this is their one home. Reads the uploads
// list on open and after each change; the delete is the icon collection's.
export function WallpaperLibrary({
  used,
  themePacks,
}: {
  // The site theme's wallpaper sources: [dark, light].
  used: (string | undefined)[];
  themePacks: ThemePack[];
}) {
  const [items, setItems] = useState<{ name: string; url: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const confirm = useConfirm();

  // The wallpaper uploads on the server, or why they couldn't be read.
  const load = useCallback(async (): Promise<{ list: { name: string; url: string }[] } | { error: string }> => {
    try {
      const res = await fetch("/api/icons");
      if (!res.ok) throw new Error("Couldn't read the uploads.");
      const list = (await res.json()) as { name: string; url: string }[];
      return { list: list.filter((u) => u.name.startsWith("wallpaper-")) };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "Couldn't read the uploads." };
    }
  }, []);
  const apply = useCallback((r: Awaited<ReturnType<typeof load>>) => {
    if ("error" in r) setError(r.error);
    else {
      setItems(r.list);
      setError(null);
    }
  }, []);

  useEffect(() => {
    let active = true;
    load().then((r) => {
      if (active) apply(r);
    });
    return () => {
      active = false;
    };
  }, [load, apply]);
  const refresh = useCallback(async () => apply(await load()), [load, apply]);

  // Who uses an upload's address: the site theme and the gallery's packs.
  const usersOf = (url: string): string[] => {
    const out: string[] = [];
    if (used[0] === url) out.push("the site theme");
    if (used[1] === url) out.push("the site theme (light)");
    for (const p of themePacks) {
      if (p.wallpaper?.src === url || p.wallpaperLight?.src === url) out.push(`the ${p.name} theme`);
    }
    return out;
  };

  async function remove(name: string, users: string[]) {
    const ok = await confirm({
      title: "Delete this wallpaper?",
      message:
        (users.length
          ? `It's still used by ${users.join(", ")}, which will show no wallpaper. `
          : "") + "Visitors who chose it in their own theme lose it too. This can't be undone.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/icons?name=${encodeURIComponent(name)}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(apiErrorMessage(data, "Couldn't delete the wallpaper."));
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't delete the wallpaper.");
    }
  }

  if (items === null && !error) return <p className="text-xs text-ink-40">Loading…</p>;
  return (
    <div className="space-y-2">
      {error && (
        <p role="alert" className="text-xs text-status-down">
          {error}
        </p>
      )}
      {items && items.length === 0 && (
        <p className="text-xs text-ink-40">
          No uploaded wallpapers yet. Upload one from a wallpaper control above or in the Themes tab.
        </p>
      )}
      {items && items.length > 0 && (
        <ul className="space-y-1.5">
          {items.map((u) => {
            const users = usersOf(u.url);
            return (
              <li key={u.name} className="flex items-center gap-3 rounded-lg border border-fg/10 bg-fg/5 p-1.5">
                {/* eslint-disable-next-line @next/next/no-img-element -- an upload served by this site, not a static asset */}
                <img
                  src={u.url}
                  alt=""
                  className="h-10 w-16 shrink-0 rounded-md object-cover ring-1 ring-fg/10"
                  loading="lazy"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-[11px] text-ink-80">{u.name}</p>
                  <p className="text-[11px] text-ink-45">
                    {users.length ? `Used by ${users.join(", ")}` : "Not used by the site or its themes"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => remove(u.name, users)}
                  aria-label={`Delete wallpaper ${u.name}`}
                  className={`${buttonClasses("ghost", "sm")} shrink-0 hover:text-status-down`}
                >
                  Delete
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
