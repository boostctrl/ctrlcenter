// Admin input schemas derived from the stored ones (#287). Every settings
// section used to have a stored schema plus a hand-written "Update" twin that
// repeated each field; the two could drift (a new stored field the input
// silently dropped). Now the input is computed from the stored schema:
//
// - wholeOf: the stored shape minus its leniency. `.default()` and `.catch()`
//   fallbacks are peeled off (input must be valid, not coerced) and lenient
//   lists become strict arrays of whole items. Fields optional in the stored
//   schema stay optional; the rest are required.
// - patchOf: for a section the settings PUT deep-merges (lib/config/settings.ts
//   mergeSettings), every object field optional, all the way down, so a
//   patch carries only what changes. Lists inside are still whole: a list
//   replaces, so each item must be complete.
//
// Peeling the defaults matters: in Zod 4 an optional field whose inner schema
// has a default still fills it in, so a plain `.partial()` would write
// defaults over the stored values of every field the patch left out.
//
// What the stored schema can't say — rules that apply only to admin input,
// like coordinate bounds or "a custom search engine needs a valid URL" — is
// layered on with .extend()/.refine() where each section's input is defined.
import { z } from "zod";
import { lenientItems } from "./shared";

type Peel<T> = T extends z.ZodDefault<infer I> ? Peel<I> : T extends z.ZodCatch<infer I> ? Peel<I> : T;
// Keeps the mapped shapes below within what z.ZodObject accepts.
type Z<T> = Extract<T, z.ZodType>;

export type Whole<T> =
  Peel<T> extends z.ZodOptional<infer I>
    ? z.ZodOptional<Z<Whole<I>>>
    : Peel<T> extends z.ZodObject<infer S>
      ? z.ZodObject<{ -readonly [K in keyof S]: Z<Whole<S[K]>> }>
      : Peel<T> extends z.ZodArray<infer E>
        ? z.ZodArray<Z<Whole<E>>>
        : Peel<T>;

export type Patch<T> =
  Peel<T> extends z.ZodOptional<infer I>
    ? z.ZodOptional<Z<Patch<I>>>
    : Peel<T> extends z.ZodObject<infer S>
      ? z.ZodObject<{ -readonly [K in keyof S]: z.ZodOptional<Z<Patch<S[K]>>> }>
      : Whole<T>;

function peel(schema: z.ZodType): z.ZodType {
  let s = schema;
  while (s instanceof z.ZodDefault || s instanceof z.ZodCatch) s = s.unwrap() as z.ZodType;
  return s;
}

function mapShape(
  object: z.ZodObject,
  fn: (field: z.ZodType) => z.ZodType
): Record<string, z.ZodType> {
  return Object.fromEntries(
    Object.entries(object.shape as Record<string, z.ZodType>).map(([k, v]) => [k, fn(v)])
  );
}

function whole(schema: z.ZodType): z.ZodType {
  const s = peel(schema);
  if (s instanceof z.ZodOptional) return whole(s.unwrap() as z.ZodType).optional();
  // A tagged union (the widget instances, #297): each option made whole, the
  // tag kept, so input still picks its option by the tag.
  if (s instanceof z.ZodDiscriminatedUnion) {
    const options = (s.options as z.ZodType[]).map(whole) as [z.ZodObject, ...z.ZodObject[]];
    return z.discriminatedUnion(s._zod.def.discriminator, options);
  }
  const item = lenientItems.get(s);
  if (item) return z.array(whole(item));
  if (s instanceof z.ZodObject) return z.object(mapShape(s, whole));
  if (s instanceof z.ZodArray) return z.array(whole(s.element as z.ZodType));
  return s;
}

function patch(schema: z.ZodType): z.ZodType {
  const s = peel(schema);
  if (s instanceof z.ZodOptional) return patch(s.unwrap() as z.ZodType).optional();
  if (s instanceof z.ZodObject) return z.object(mapShape(s, (f) => patch(f).optional()));
  return whole(s);
}

export const wholeOf = <T extends z.ZodType>(schema: T) => whole(schema) as unknown as Whole<T>;
export const patchOf = <T extends z.ZodType>(schema: T) => patch(schema) as unknown as Patch<T>;
