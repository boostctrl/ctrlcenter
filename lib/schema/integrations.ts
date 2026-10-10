// Integrations (#189, #300): connections to other self-hosted services, shown
// only on the private Monitor dashboard (/admin/monitor). Since 3.0 they're a
// top-level list of instances — two Sonarrs, three Portainers — each with its
// own id (its Monitor URL, /admin/monitor/<id>), type, name and credentials.
// The type's facts live in lib/services/ids.ts (SERVICE_META).
//
// The credentials are secrets, and the URLs internal topology, so the whole
// list is admin-only: readPublicConfig drops it, and stripSecrets blanks it in
// anything serialized. Any text field may hold `${ENV_VAR}` references,
// resolved server-side at use time (lib/services/resolve.ts) and never sent to
// the browser.
//
// One shape serves every type: a WebUI login (username/password) or an API
// key; each type reads the fields its SERVICE_META.credentials names.
import { z } from "zod";
import { SERVICE_IDS } from "../services/ids";
import { wholeOf } from "./input";

const integrationId = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);

export const integrationSchema = z.object({
  id: integrationId,
  type: z.enum(SERVICE_IDS),
  // What the admin calls it ("Sonarr 4K"); blank for the type's label.
  name: z.string().max(60).catch("").default(""),
  enabled: z.boolean().catch(true).default(true),
  url: z.string().catch("").default(""),
  username: z.string().catch("").default(""),
  password: z.string().catch("").default(""),
  apiKey: z.string().catch("").default(""),
  // Opt-in, default off: skip TLS certificate verification. Only honored by
  // clients that support it (UniFi) and only for an https URL — it exists for
  // controllers that ship a self-signed cert with no plaintext alternative.
  allowInsecureTls: z.boolean().catch(false).default(false),
  // The write-side opt-in (#201/#202/#203): default off, so a configured
  // integration stays read-only until the admin turns it on. Only the
  // action-capable types expose the toggle and honor it.
  allowActions: z.boolean().catch(false).default(false),
});
export type Integration = z.infer<typeof integrationSchema>;

// The shapes the clients take: a login, or a key. Kept so each client module
// can type its own slice.
export type UserPassIntegration = Pick<
  Integration,
  "enabled" | "url" | "username" | "password" | "allowInsecureTls" | "allowActions"
>;
export type ApiKeyIntegration = Pick<
  Integration,
  "enabled" | "url" | "apiKey" | "allowInsecureTls" | "allowActions"
>;

export const MAX_INTEGRATIONS = 50;

// Stored leniently: an entry that won't parse is dropped, a repeated id keeps
// its first entry. The whole list is secret: stripSecrets empties it.
export const integrationsSchema = z
  .array(z.unknown())
  .catch([])
  .default([])
  .transform((rows): Integration[] => {
    const seen = new Set<string>();
    const out: Integration[] = [];
    for (const row of rows) {
      const parsed = integrationSchema.safeParse(row);
      if (!parsed.success || seen.has(parsed.data.id)) continue;
      seen.add(parsed.data.id);
      out.push(parsed.data);
    }
    return out.slice(0, MAX_INTEGRATIONS);
  });

// Admin input (PUT /api/integrations): the whole list, each entry complete.
// No URL-format check on purpose: a half-typed URL (a schemeless
// "192.168.1.10:8080" pasted from the service's own UI) shouldn't block the
// autosave. URLs are validated at use — serviceBase() (lib/services/http.ts)
// rejects a non-http(s) URL with a clear message on the Monitor tile and the
// Test button — so a bad value stays inert.
export const integrationsUpdateSchema = z
  .array(wholeOf(integrationSchema))
  .max(MAX_INTEGRATIONS)
  .superRefine((list, ctx) => {
    const ids = new Set<string>();
    list.forEach((i, idx) => {
      if (ids.has(i.id)) ctx.addIssue({ code: "custom", message: "Duplicate integration id", path: [idx, "id"] });
      ids.add(i.id);
    });
  });
