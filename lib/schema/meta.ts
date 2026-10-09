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
// private (integrations, inbound webhooks). Applied by stripSecrets.
export const secretFields = z.registry<{ redact: "blank" | "all" }>();

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
