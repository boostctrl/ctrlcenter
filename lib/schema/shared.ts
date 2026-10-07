// Building blocks shared by the per-domain schema modules. Exported for those
// modules only — the lib/schema.ts barrel deliberately does not re-export them.
import { z } from "zod";

// 6-digit hex color (matches what <input type="color"> produces and the
// client-side theme sanitizers accept).
export const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Must be a #rrggbb color");

// z.string().url() accepts any valid URL — including `javascript:`, `data:`,
// and `vbscript:` schemes. App/bookmark URLs are rendered as <a href> on the
// public dashboard, so an unsafe scheme would be stored XSS. Restrict to http(s).
export const httpUrl = z
  .string()
  .url()
  .refine((value) => /^https?:\/\//i.test(value.trim()), {
    message: "URL must start with http:// or https://",
  });

// Parse an array, dropping only the items that fail validation instead of
// failing the whole config. A non-array value falls back to an empty list.
export function lenientArray<T extends z.ZodTypeAny>(item: T) {
  return z
    .array(z.unknown())
    .catch([])
    .transform((arr) =>
      arr.flatMap((value) => {
        const parsed = item.safeParse(value);
        return parsed.success ? [parsed.data as z.infer<T>] : [];
      })
    );
}
