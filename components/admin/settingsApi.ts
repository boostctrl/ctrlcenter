import type { z } from "zod";
import type {
  boardLayoutUpdateSchema,
  boardsUpdateSchema,
  settingsInputSchema,
} from "@/lib/schema";
import type { WidgetInstance } from "@/lib/schema";
import type { WidgetEditContext } from "@/lib/config/widgets";
import { apiErrorMessage } from "./apiError";

// Save a partial settings update. /api/settings merges it key by key, so a
// caller sends only the sections it owns (the bookmarks tab its category
// order) and never reverts anything saved from another surface. Throws with the API's error message, or `fallback` (also
// for a network failure, so callers never show a raw "Failed to fetch").
// `keepalive` lets a save fired from a page unload still complete.
// PUT a JSON body; throws with the API's error message, or `fallback`.
async function putJson(
  url: string,
  body: unknown,
  fallback: string,
  keepalive?: boolean
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive,
    });
  } catch {
    throw new Error(fallback);
  }
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(apiErrorMessage(data, fallback));
  }
}

export async function saveSettingsPatch(
  // The PUT body as the API parses it, so fields the schema defaults may be
  // left out.
  patch: z.input<typeof settingsInputSchema>,
  { fallback = "Failed to save settings", keepalive }: {
    fallback?: string;
    keepalive?: boolean;
  } = {}
): Promise<void> {
  await putJson("/api/settings", patch, fallback, keepalive);
}

// Save the whole widget-instance list (#297). Throws like saveSettingsPatch.
export async function saveWidgets(
  widgets: unknown[],
  { keepalive }: { keepalive?: boolean } = {}
): Promise<void> {
  await putJson("/api/widgets", widgets, "Failed to save widgets", keepalive);
}

// Save the board list (#298): names, order, visibility, and any layouts sent.
export async function saveBoards(
  boards: z.input<typeof boardsUpdateSchema>,
  { keepalive }: { keepalive?: boolean } = {}
): Promise<void> {
  await putJson("/api/boards", boards, "Failed to save boards", keepalive);
}

// Save one board's arrangement from the layout editor, with the page-level
// scale and spacing.
export async function saveBoardLayout(
  boardId: string,
  layout: z.input<typeof boardLayoutUpdateSchema>,
  { keepalive }: { keepalive?: boolean } = {}
): Promise<void> {
  await putJson(
    `/api/boards/${encodeURIComponent(boardId)}/layout`,
    layout,
    "Failed to save layout",
    keepalive
  );
}

// Save the whole integration list (#300).
export async function saveIntegrations(
  integrations: unknown[],
  { keepalive }: { keepalive?: boolean } = {}
): Promise<void> {
  await putJson("/api/integrations", integrations, "Failed to save integrations", keepalive);
}

// One widget edited in place from the layout editor (#303): the instance as
// stored (secrets included) with what its editor offers to pick from.
export async function fetchWidgetForEditing(id: string): Promise<WidgetEditContext> {
  let res: Response;
  try {
    res = await fetch(`/api/widgets/${encodeURIComponent(id)}`);
  } catch {
    throw new Error("Couldn't load the widget");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(apiErrorMessage(data, "Couldn't load the widget"));
  return data as WidgetEditContext;
}

// Save that one widget; the others stay exactly as stored.
export async function saveWidget(widget: WidgetInstance, { keepalive }: { keepalive?: boolean } = {}): Promise<void> {
  await putJson(`/api/widgets/${encodeURIComponent(widget.id)}`, widget, "Failed to save the widget", keepalive);
}

// Add a widget of a type, with its defaults (the palette, #303).
export async function createWidget(type: string): Promise<WidgetInstance> {
  let res: Response;
  try {
    res = await fetch("/api/widgets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type }),
    });
  } catch {
    throw new Error("Couldn't add the widget");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(apiErrorMessage(data, "Couldn't add the widget"));
  return data as WidgetInstance;
}
