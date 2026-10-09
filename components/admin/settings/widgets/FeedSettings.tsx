"use client";

import { FeedCardEditor } from "../FeedCardEditor";
import type { InstanceEditorProps } from "./index";

// An RSS feed widget's fields in admin Settings → Widgets (#285, #297).
export default function FeedSettings({ w, label, onChange, feedHealth }: InstanceEditorProps<"feed">) {
  return <FeedCardEditor feed={w} label={label} health={feedHealth ?? null} onChange={onChange} />;
}
