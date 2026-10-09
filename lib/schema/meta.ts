// Per-field metadata that generic config code reads off the schemas (#287),
// so a rule lives beside the field it governs instead of in a hand-kept list
// somewhere else that a new field can be forgotten from.
import { z } from "zod";

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
