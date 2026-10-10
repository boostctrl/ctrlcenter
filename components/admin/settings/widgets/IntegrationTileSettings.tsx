"use client";

import type { InstanceOf } from "@/lib/schema";
import { Hint, SelectField } from "../../ui";
import type { InstanceEditorProps } from "./index";

// An integration tile's fields in admin Settings → Widgets (#301): which
// integration, and who sees it. The tile is the one the Monitor shows; a
// tile for everyone shows only counts and states.
export default function IntegrationTileSettings({ w, onChange, integrations }: InstanceEditorProps<"integration">) {
  const tile: InstanceOf<"integration"> = w;
  const known = integrations.some((i) => i.id === tile.integration);
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Integration"
          value={tile.integration}
          onChange={(e) => onChange({ integration: e.target.value })}
        >
          <option value="">Choose one…</option>
          {integrations.map((i) => (
            <option key={i.id} value={i.id}>
              {i.label}
            </option>
          ))}
          {tile.integration && !known && <option value={tile.integration}>{tile.integration} (gone)</option>}
        </SelectField>
        <SelectField
          label="Who sees it"
          value={tile.visibility}
          onChange={(e) => onChange({ visibility: e.target.value === "public" ? "public" : "admin" })}
        >
          <option value="admin">Only me</option>
          <option value="public">Everyone</option>
        </SelectField>
      </div>
      <Hint>
        {tile.visibility === "public"
          ? "Everyone sees a reduced tile: counts and states only — no names, titles, hosts or errors."
          : "Only you, signed in, see this tile; it opens the integration's Monitor page."}
        {integrations.length === 0 && " Set up an integration under Settings → Integrations first."}
      </Hint>
    </>
  );
}
