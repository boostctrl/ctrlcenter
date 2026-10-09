"use client";

import { Card, Hint, TextArea, TextField } from "../../ui";
import type { SettingsDraft } from "../useSettingsDraft";

// The Notes card in admin Settings → Widgets (#285).
export default function NotesSettings({ d }: { d: SettingsDraft }) {
  const { notes, updateNotes } = d;
  return (
    <Card
      title="Notes"
      intro="A free-form note card for the home page. Switch it on to show it; arrange it in the home-page layout editor."
      toggle={{
        checked: d.isWidgetShown("notes"),
        onChange: (v) => d.setWidgetShown("notes", v),
        label: "Show Notes on the home page",
      }}
    >
      <TextField
        label="Card title"
        placeholder="Notes"
        value={notes.title}
        onChange={(e) => updateNotes({ title: e.target.value })}
      />
      <TextArea
        label="Note (markdown)"
        mono
        value={notes.content}
        onChange={(e) => updateNotes({ content: e.target.value })}
        rows={10}
        placeholder={"# Homelab\n- Renew certs **June 12**\n- `docker compose pull` after backups"}
      />
      <Hint>
        Supports a safe markdown subset: # ## ### headings, **bold**,
        *italic*, `code`, [links](https://…) (http/https only), - and 1.
        lists, &gt; quotes, ``` code blocks and --- rules. Raw HTML is shown
        as plain text, never rendered.
      </Hint>
    </Card>
  );
}
