"use client";

import { useState } from "react";
import Link from "next/link";
import { buttonClasses } from "@/lib/buttons";
import { boardName, MAX_BOARD_NAME, MAX_BOARDS, MAX_GROUP_NAME } from "@/lib/schema";
import { findGroupByName, groupUsage } from "@/lib/groups";
import { useConfirm } from "../Confirm";
import { useToast } from "../Toast";
import type { GroupsState } from "../useGroups";
import type { ItemsState } from "../useAdminData";
import { Button, Card, Hint, ListPanel, MoveButtons, RemoveButton, ToggleRow, controlClasses } from "../ui";
import type { SettingsDraft } from "./useSettingsDraft";

// The boards (#298): one row each, in navigation order. The first is the
// home page. A board's id is its URL, set from its name when it's created
// and kept through renames so links to it keep working.
function BoardsCard({ d }: { d: SettingsDraft }) {
  const { boards, savedBoardIds, addBoard, updateBoard, moveBoard, removeBoard } = d;
  const [draftName, setDraftName] = useState("");
  const add = () => {
    if (!draftName.trim()) return;
    addBoard(draftName);
    setDraftName("");
  };
  return (
    <Card
      title="Boards"
      intro="Separate dashboards, each with its own arrangement of widgets. The first board is the home page; switch boards from the corner menu, or with the 1–9, [ and ] keys. A private board is only there for you, signed in."
    >
      <ListPanel>
        {boards.map((b, i) => {
          const label = boardName(b);
          const href = i === 0 ? "/" : `/b/${b.id}`;
          return (
            <div key={b.id} className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                {boards.length > 1 && (
                  <MoveButtons index={i} count={boards.length} label={`${label} board`} onMove={moveBoard} />
                )}
                <input
                  value={b.name}
                  maxLength={MAX_BOARD_NAME}
                  onChange={(e) => updateBoard(b.id, { name: e.target.value })}
                  placeholder={b.id}
                  aria-label={`Name of the ${label} board`}
                  className={`${controlClasses} min-w-0 flex-1 basis-40`}
                />
                <select
                  value={b.visibility}
                  onChange={(e) =>
                    updateBoard(b.id, { visibility: e.target.value === "private" ? "private" : "public" })
                  }
                  aria-label={`Who can open the ${label} board`}
                  className={controlClasses}
                >
                  <option value="public">Everyone</option>
                  <option value="private">Only me</option>
                </select>
                {savedBoardIds.has(b.id) ? (
                  <Link href={`${href}?edit=1`} className={buttonClasses("ghost", "sm")}>
                    Arrange
                  </Link>
                ) : (
                  <Button variant="ghost" size="sm" disabled>
                    Arrange
                  </Button>
                )}
                {boards.length > 1 && (
                  <RemoveButton label={`Delete the ${label} board`} onClick={() => removeBoard(b.id, label)} />
                )}
              </div>
              <span className="text-xs text-ink-45">
                {i === 0 ? "Home page, at /" : `At ${href}`}
                {b.visibility === "private" && i === 0 && boards.length > 1
                  ? " — visitors who aren't signed in get the first board open to everyone instead"
                  : ""}
              </span>
            </div>
          );
        })}
      </ListPanel>
      {boards.length < MAX_BOARDS && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <label className="flex min-w-0 flex-1 basis-48 flex-col gap-1.5 text-sm">
            <span className="text-[13px] font-medium text-ink-60">New board</span>
            <input
              value={draftName}
              maxLength={MAX_BOARD_NAME}
              onChange={(e) => setDraftName(e.target.value)}
              placeholder="Media, Infra, Family…"
              className={controlClasses}
            />
          </label>
          <Button type="submit" variant="ghost" size="sm" disabled={!draftName.trim()}>
            Add board
          </Button>
        </form>
      )}
      <Hint>
        A new board starts empty: open it with Arrange, then show widgets from
        the tray. Widgets are shared, so the same notes card can sit on two
        boards. Deleting a board keeps its widgets.
      </Hint>
    </Card>
  );
}

// The groups apps and bookmarks belong to (#299): rename (onto another
// group's name merges the two), reorder (the bookmarks widgets' order), and
// delete once nothing uses a group. Groups are made by naming one in an app
// or bookmark form.
function GroupsCard({ groupsState, items }: { groupsState: GroupsState; items: ItemsState }) {
  const { groups, save } = groupsState;
  // Names being typed, by group id, until committed on blur or Enter.
  const [names, setNames] = useState<Record<string, string>>({});
  const dropName = (id: string) =>
    setNames((n) => Object.fromEntries(Object.entries(n).filter(([k]) => k !== id)));
  const confirm = useConfirm();
  const toast = useToast();
  const usage = groupUsage(items.apps, items.bookmarks);
  const persist = async (next: typeof groups, done: string) => {
    try {
      // The items' groups, for the usage counts; a merge moves some.
      const moved = await save(next);
      items.setApps(moved.apps);
      items.setBookmarks(moved.bookmarks);
      toast(done);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't save the groups", "error");
    }
  };
  const commitName = async (id: string) => {
    const typed = names[id];
    dropName(id);
    const current = groups.find((g) => g.id === id);
    const to = typed?.trim();
    if (!current || !to || to === current.name) return;
    const other = findGroupByName(groups, to);
    if (other && other.id !== id) {
      const ok = await confirm({
        title: `Merge “${current.name}” into “${other.name}”?`,
        message: `Every app and bookmark in “${current.name}” moves into “${other.name}”.`,
        confirmLabel: "Merge",
      });
      if (!ok) return;
    }
    await persist(
      groups.map((g) => (g.id === id ? { ...g, name: other && other.id !== id ? other.name : to } : g)),
      other && other.id !== id ? "Groups merged" : "Group renamed"
    );
  };
  return (
    <Card
      title="Groups"
      intro="The groups apps and bookmarks belong to. Bookmarks widgets list them in this order, and an Applications widget can show one. Start a group by naming it in an app or bookmark form."
    >
      {groups.length === 0 ? (
        <Hint>No groups yet.</Hint>
      ) : (
        <ListPanel>
          {groups.map((g, i) => {
            const u = usage.get(g.id);
            const count = u
              ? [u.apps && `${u.apps} app${u.apps === 1 ? "" : "s"}`, u.bookmarks && `${u.bookmarks} bookmark${u.bookmarks === 1 ? "" : "s"}`]
                  .filter(Boolean)
                  .join(" · ")
              : "Unused";
            return (
              <div key={g.id} className="flex flex-wrap items-center gap-2">
                {groups.length > 1 && (
                  <MoveButtons
                    index={i}
                    count={groups.length}
                    label={`group ${g.name}`}
                    onMove={(from, to) => {
                      const next = [...groups];
                      const [moved] = next.splice(from, 1);
                      next.splice(to, 0, moved);
                      void persist(next, "Group order saved");
                    }}
                  />
                )}
                <input
                  value={names[g.id] ?? g.name}
                  maxLength={MAX_GROUP_NAME}
                  onChange={(e) => setNames((n) => ({ ...n, [g.id]: e.target.value }))}
                  onBlur={() => void commitName(g.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                    if (e.key === "Escape") dropName(g.id);
                  }}
                  aria-label={`Name of the ${g.name} group`}
                  className={`${controlClasses} min-w-0 flex-1 basis-40`}
                />
                <span className="w-32 shrink-0 text-right text-xs text-ink-55">{count}</span>
                {!u && (
                  <RemoveButton
                    label={`Delete the ${g.name} group`}
                    onClick={() => void persist(groups.filter((x) => x.id !== g.id), "Group deleted")}
                  />
                )}
              </div>
            );
          })}
        </ListPanel>
      )}
    </Card>
  );
}

export default function LayoutSection({
  d,
  groupsState,
  items,
}: {
  d: SettingsDraft;
  groupsState: GroupsState;
  items: ItemsState;
}) {
  const { settings, setSettings, isWidgetShown, setWidgetShown, widgetToggles, instancesOf, updateWidget, widgetLabels } =
    d;
  const headerCards = instancesOf("headerCard");
  return (
    <>
      <BoardsCard d={d} />
      <GroupsCard groupsState={groupsState} items={items} />
      <Card
        title="Visible widgets"
        intro="Show or hide widgets on the home page (the first board). The content widgets (calendars, feeds, notes…) each have their own switch under Widgets; the split clock/weather/status widgets are managed in the home-page editor."
      >
        <div className="flex flex-col gap-2.5">
          {widgetToggles.map((t) => (
            <ToggleRow
              key={t.id}
              label={t.label}
              checked={isWidgetShown(t.id)}
              onChange={(shown) => setWidgetShown(t.id, shown)}
            />
          ))}
          {headerCards.map((w) => (
            <ToggleRow
              key={w.id}
              label={
                headerCards.length > 1
                  ? `Date & clock (inside ${widgetLabels[w.id]})`
                  : "Date & clock (inside the header card)"
              }
              checked={w.type === "headerCard" && w.showClock}
              onChange={(showClock) => updateWidget(w.id, { showClock })}
            />
          ))}
          <ToggleRow
            label="Floating navigation menu"
            checked={settings.settingsButton}
            onChange={(settingsButton) => setSettings({ ...settings, settingsButton })}
          />
        </div>
        {!settings.settingsButton && (
          <Hint>
            With the floating navigation menu off, reach this page directly at
            /admin.
          </Hint>
        )}
      </Card>

      <Card
        title="Arrangement"
        intro="Widgets are arranged directly on each board: drag to reorder, resize by dragging a card's edges, and show or hide everything in place — including swapping the header card for the split clock, weather, and status widgets. Each board's Arrange button above opens it in the editor."
      >
        <Link href="/?edit=1" className={`${buttonClasses("ghost", "sm")} self-start`}>
          Arrange the home page
        </Link>
      </Card>
    </>
  );
}
