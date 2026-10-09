"use client";

import type { InstanceOf } from "@/lib/schema";
import { Hint, TextArea, TextField } from "../../ui";
import type { InstanceEditorProps } from "./index";

// A Notes widget's fields in admin Settings → Widgets (#285, #297).
export default function NotesSettings({ w, onChange }: InstanceEditorProps<"notes">) {
  const notes: InstanceOf<"notes"> = w;
  return (
    <>
      <TextField
        label="Card title"
        placeholder="Notes"
        value={notes.title}
        onChange={(e) => onChange({ title: e.target.value })}
      />
      <TextArea
        label="Note (markdown)"
        mono
        value={notes.content}
        onChange={(e) => onChange({ content: e.target.value })}
        rows={10}
        placeholder={"# Homelab\n- Renew certs **June 12**\n- `docker compose pull` after backups"}
      />
      <Hint>
        Supports a safe markdown subset: # ## ### headings, **bold**,
        *italic*, `code`, [links](https://…) (http/https only), - and 1.
        lists, &gt; quotes, ``` code blocks and --- rules. Raw HTML is shown
        as plain text, never rendered.
      </Hint>
    </>
  );
}
