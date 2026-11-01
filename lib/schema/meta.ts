// Per-field metadata that generic config code reads off the schemas (#287),
// so a rule lives beside the field it governs instead of in a hand-kept list
// somewhere else that a new field can be forgotten from.
import { z } from "zod";
import { lenientItems } from "./shared";

// How a settings PUT applies a section: by default plain objects deep-merge
// (only the keys sent change) and arrays/scalars replace. A section marked
// "replace" is swapped whole — for shapes where an omitted key means
// "cleared", like the theme's optional custom colors.
export const mergeRules = z.registry<{ merge: "replace" }>();

// Fields a signed-out visitor must never receive (#157). "blank" empties a
// string; "all" neutralizes a whole section — every string blanked, every
// boolean off — for sections where even which parts are switched on is
// private (integrations, inbound webhooks). Applied by stripSecrets. A backup
// without secrets (redactForExport) goes by the "blank" marks alone: the
// secrets inside an "all" section carry their own, and the rest of it — the
// inbound webhooks' switches, Application URLs and subject prefix — is kept
// (#437).
//
// `exportOnly` marks a secret the server's own public rendering reads from
// the public config: a calendar's address (#380), which the board's fetch and
// the nav's calendar link need. stripSecrets leaves it, and a visitor's page
// is kept clear of it by sending each widget's public shape instead
// (lib/widgets/public.ts); a backup without secrets blanks it like any other.
//
// `credential` marks the subset the admin's own client doesn't get either
// (#382): passwords, keys and tokens. redactForAdmin replaces a stored one
// with SECRET_PLACEHOLDER, and restoreAdminSecrets puts the stored value back
// when the placeholder is saved, so a stolen session can read the forms
// without reading the secrets, and the admin clears one by emptying the field.
export const secretFields = z.registry<{
  redact: "blank" | "all";
  exportOnly?: true;
  credential?: true;
}>();

// What the admin's forms show in place of a stored credential (#382).
export const SECRET_PLACEHOLDER = "••••••••";

// The schema a wrapper stands for: defaults, .catch fallbacks and optionals
// peeled off. Metadata can sit on any layer, so walkers check each.
function layers(schema: z.ZodType): z.ZodType[] {
  const out = [schema];
  let s = schema;
  while (s instanceof z.ZodDefault || s instanceof z.ZodCatch || s instanceof z.ZodOptional) {
    s = s.unwrap() as z.ZodType;
    out.push(s);
  }
  return out;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

// Every string blanked and every boolean off, all the way down.
function neutralize(value: unknown): unknown {
  if (typeof value === "string") return "";
  if (typeof value === "boolean") return false;
  if (Array.isArray(value)) return value.map(neutralize);
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, neutralize(v)]));
  }
  return value;
}

// `value` with every field `schema` marks in secretFields redacted. Fields
// the schema doesn't know pass through (the stored schemas strip unknown
// keys, so a parsed config has none).
export function redactSecrets<T>(schema: z.ZodType, value: T): T {
  const stack = layers(schema);
  for (const s of stack) {
    const rule = secretFields.get(s);
    if (rule?.exportOnly) continue;
    if (rule?.redact === "all") return neutralize(value) as T;
    if (rule?.redact === "blank") return (typeof value === "string" ? "" : value) as T;
  }
  const base = stack[stack.length - 1];
  // A union (the widget instances, #297): redact by the option the value
  // actually is. Values reaching here were parsed by this schema, so one fits.
  if (base instanceof z.ZodUnion) {
    const option = (base.options as z.ZodType[]).find((o) => o.safeParse(value).success);
    return option ? redactSecrets(option, value) : value;
  }
  const item = lenientItems.get(base);
  if (item && Array.isArray(value)) {
    return value.map((v) => redactSecrets(item, v)) as T;
  }
  if (base instanceof z.ZodArray && Array.isArray(value)) {
    return value.map((v) => redactSecrets(base.element as z.ZodType, v)) as T;
  }
  if (base instanceof z.ZodObject && isPlainObject(value)) {
    const shape = base.shape as Record<string, z.ZodType>;
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, shape[k] ? redactSecrets(shape[k], v) : v])
    ) as T;
  }
  return value;
}

// A `${NAME}` environment reference (#300): names a variable rather than
// holding a secret, so it may stay in an export.
const isEnvRef = (v: unknown): boolean => typeof v === "string" && /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(v.trim());

// `value` for a backup without secrets (#366): every field marked "blank" is
// emptied — an environment reference is kept, it names no secret. An "all"
// section is private wholesale from a visitor only; a backup keeps its
// settings and blanks just the fields marked within it, so the inbound
// webhooks lose their tokens and keep their Application URLs (#437). The
// shape is otherwise the stored one, so the file imports cleanly and
// restoreSecrets can fill the blanks back from what the instance holds.
export function redactForExport<T>(schema: z.ZodType, value: T): T {
  const stack = layers(schema);
  for (const s of stack) {
    if (secretFields.get(s)?.redact === "blank") {
      return (typeof value === "string" && !isEnvRef(value) ? "" : value) as T;
    }
  }
  const base = stack[stack.length - 1];
  if (base instanceof z.ZodUnion) {
    const option = (base.options as z.ZodType[]).find((o) => o.safeParse(value).success);
    return option ? redactForExport(option, value) : value;
  }
  const item = lenientItems.get(base) ?? (base instanceof z.ZodArray ? (base.element as z.ZodType) : null);
  if (item && Array.isArray(value)) return value.map((v) => redactForExport(item, v)) as T;
  if (base instanceof z.ZodObject && isPlainObject(value)) {
    const shape = base.shape as Record<string, z.ZodType>;
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, shape[k] ? redactForExport(shape[k], v) : v])
    ) as T;
  }
  return value;
}

// The counterpart of an item in the other list: by `id` when both carry
// one, else the same position.
function counterpart(list: unknown[], item: unknown, index: number): unknown {
  if (isPlainObject(item) && typeof item.id === "string") {
    return list.find((o) => isPlainObject(o) && o.id === item.id);
  }
  return list[index];
}

// `incoming` (a backup being restored, #366) with every field marked "blank"
// that is blank in it taken from `stored` (what the instance already holds),
// matched by id through the lists. A secret-less export then restores without
// wiping the credentials the instance has; a file that carries its own
// secrets keeps them. The other fields of an "all" section are the file's own
// (#437): a blank Application URL in it is a cleared one, not a gap.
export function restoreSecrets<T>(schema: z.ZodType, incoming: T, stored: unknown): T {
  const stack = layers(schema);
  for (const s of stack) {
    if (secretFields.get(s)?.redact === "blank") {
      return (incoming === "" && typeof stored === "string" ? stored : incoming) as T;
    }
  }
  const base = stack[stack.length - 1];
  if (base instanceof z.ZodUnion) {
    const option = (base.options as z.ZodType[]).find((o) => o.safeParse(incoming).success);
    return option ? restoreSecrets(option, incoming, stored) : incoming;
  }
  const item = lenientItems.get(base) ?? (base instanceof z.ZodArray ? (base.element as z.ZodType) : null);
  if (item && Array.isArray(incoming)) {
    const from = Array.isArray(stored) ? stored : [];
    return incoming.map((v, i) => restoreSecrets(item, v, counterpart(from, v, i))) as T;
  }
  if (base instanceof z.ZodObject && isPlainObject(incoming)) {
    const shape = base.shape as Record<string, z.ZodType>;
    const from = isPlainObject(stored) ? stored : {};
    return Object.fromEntries(
      Object.entries(incoming).map(([k, v]) => [k, shape[k] ? restoreSecrets(shape[k], v, from[k]) : v])
    ) as T;
  }
  return incoming;
}

// `value` as the admin's own client receives it (#382): every field marked
// `credential` that holds something is replaced by SECRET_PLACEHOLDER. An
// environment reference stays, it names no secret, and an empty field stays
// empty so the form shows what is and isn't set.
export function redactForAdmin<T>(schema: z.ZodType, value: T): T {
  const stack = layers(schema);
  for (const s of stack) {
    const rule = secretFields.get(s);
    if (rule?.credential) {
      return (typeof value === "string" && value !== "" && !isEnvRef(value)
        ? SECRET_PLACEHOLDER
        : value) as T;
    }
  }
  const base = stack[stack.length - 1];
  if (base instanceof z.ZodUnion) {
    const option = (base.options as z.ZodType[]).find((o) => o.safeParse(value).success);
    return option ? redactForAdmin(option, value) : value;
  }
  const item = lenientItems.get(base) ?? (base instanceof z.ZodArray ? (base.element as z.ZodType) : null);
  if (item && Array.isArray(value)) return value.map((v) => redactForAdmin(item, v)) as T;
  if (base instanceof z.ZodObject && isPlainObject(value)) {
    const shape = base.shape as Record<string, z.ZodType>;
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, shape[k] ? redactForAdmin(shape[k], v) : v])
    ) as T;
  }
  return value;
}

// `incoming` (a save from the admin's forms, #382) with every credential field
// that still carries SECRET_PLACEHOLDER taken from `stored`, matched by id
// through the lists. Anything else the form sent, an empty field included,
// is the admin's own value.
export function restoreAdminSecrets<T>(schema: z.ZodType, incoming: T, stored: unknown): T {
  const stack = layers(schema);
  for (const s of stack) {
    const rule = secretFields.get(s);
    if (rule?.credential) {
      return (incoming === SECRET_PLACEHOLDER && typeof stored === "string" ? stored : incoming) as T;
    }
  }
  const base = stack[stack.length - 1];
  if (base instanceof z.ZodUnion) {
    const option = (base.options as z.ZodType[]).find((o) => o.safeParse(incoming).success);
    return option ? restoreAdminSecrets(option, incoming, stored) : incoming;
  }
  const item = lenientItems.get(base) ?? (base instanceof z.ZodArray ? (base.element as z.ZodType) : null);
  if (item && Array.isArray(incoming)) {
    const from = Array.isArray(stored) ? stored : [];
    return incoming.map((v, i) => restoreAdminSecrets(item, v, counterpart(from, v, i))) as T;
  }
  if (base instanceof z.ZodObject && isPlainObject(incoming)) {
    const shape = base.shape as Record<string, z.ZodType>;
    const from = isPlainObject(stored) ? stored : {};
    return Object.fromEntries(
      Object.entries(incoming).map(([k, v]) => [k, shape[k] ? restoreAdminSecrets(shape[k], v, from[k]) : v])
    ) as T;
  }
  return incoming;
}
