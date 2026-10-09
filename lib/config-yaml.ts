// Comment-preserving config writes (#279). Every admin save used to
// re-serialize the whole config with js-yaml's dump(), so the first save from
// the UI threw away a hand-edited file's comments, key order and formatting —
// undercutting "edit the YAML or use the admin UI, interchangeably".
//
// Instead, the new config is applied onto the existing file's parsed Document
// (the `yaml` package keeps comments and styles on its nodes): maps are
// updated key by key in their existing order, list items carrying an `id` are
// matched by id (so an app's comment follows it when apps are reordered),
// scalars keep their quoting style, and only what changed is created anew.
// Given the config as it read before the edit, a key the file leaves out
// stays out unless its value changed — so saving one setting doesn't write
// every schema default into a minimal hand-written file.
//
// Reading stays on js-yaml (parseConfigYaml in lib/config.ts carries its
// deliberate tolerance rules), so the writer proves itself against the app's
// own read path: the output must read back as exactly the intended config,
// otherwise the caller falls back to a plain dump. So do files this can't safely edit —
// anchors/aliases/merge keys (editing a shared node would change every place
// it's used) or a document that doesn't parse cleanly.
import { isDeepStrictEqual } from "node:util";
import {
  isMap,
  isScalar,
  isSeq,
  parseDocument,
  visit,
  type Document,
  type YAMLMap,
} from "yaml";

type Node = ReturnType<Document["createNode"]> | unknown;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const keyOf = (key: unknown): string =>
  isScalar(key) ? String(key.value) : String(key);

const idOf = (v: unknown): string | undefined =>
  isPlainObject(v) && typeof v.id === "string" ? v.id : undefined;

// Write `value` into `node`, reusing it (and its comments) where the shapes
// agree; returns the node to keep at this position. `prev` is what this
// position read as before the edit (undefined when unknown).
function apply(doc: Document, node: Node, value: unknown, prev: unknown): Node {
  if (isPlainObject(value)) {
    if (!isMap(node)) {
      // Nothing here in the file. With the old value known, write only what
      // differs from it, so untouched defaults stay implicit.
      if (node == null && isPlainObject(prev)) {
        const map = doc.createNode({}) as YAMLMap;
        return apply(doc, map, value, prev);
      }
      return doc.createNode(value);
    }
    // An empty `{}` that gains keys becomes a block map, as a dump writes it.
    if (node.flow && node.items.length === 0 && Object.keys(value).length > 0) node.flow = false;
    // Drop keys the new config no longer has (the schema stripped them, or
    // the mutation removed them) — the same result a full dump gave.
    for (const pair of [...node.items]) {
      const k = keyOf(pair.key);
      if (!Object.hasOwn(value, k) || value[k] === undefined) node.delete(pair.key);
    }
    const before = isPlainObject(prev) ? prev : undefined;
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) continue;
      const pair = node.items.find((p) => keyOf(p.key) === k);
      if (pair) {
        pair.value = apply(doc, pair.value, v, before?.[k]);
      } else if (!before || !isDeepStrictEqual(v, before[k])) {
        // Absent from the file and changed (or nothing to compare with).
        node.add(doc.createPair(k, apply(doc, null, v, before?.[k])));
      }
    }
    return node;
  }
  if (Array.isArray(value)) {
    if (!isSeq(node)) return doc.createNode(value);
    // Likewise an empty `[]` that gains items.
    if (node.flow && node.items.length === 0 && value.length > 0) node.flow = false;
    const old = node.items;
    // A comment above the first item parses onto the list itself; hand it to
    // that item so it travels with it (same output when nothing moves).
    if (node.commentBefore && old.length > 0 && isMap(old[0]) && !old[0].commentBefore) {
      old[0].commentBefore = node.commentBefore;
      node.commentBefore = undefined;
    }
    // Lists of records with ids (apps, bookmarks, widgets…) match by id, so a
    // reorder or a delete keeps each surviving item's comments with it;
    // anything else matches by position.
    const byId = new Map<string, Node>();
    for (const item of old) {
      const id = isMap(item) ? item.get("id") : undefined;
      if (typeof id === "string") byId.set(id, item);
    }
    const prevList = Array.isArray(prev) ? prev : [];
    const prevById = new Map(prevList.flatMap((p) => (idOf(p) ? [[idOf(p)!, p]] : [])));
    node.items = value.map((v, i) => {
      const id = idOf(v);
      const at = id !== undefined ? byId.get(id) : old[i];
      const was = id !== undefined ? prevById.get(id) : prevList[i];
      return at === undefined ? doc.createNode(v) : apply(doc, at, v, was);
    }) as typeof node.items;
    return node;
  }
  // A scalar: keep the node (style, comments) when the type is unchanged.
  if (isScalar(node) && (node.value === null ? value === null : typeof node.value === typeof value)) {
    node.value = value;
    return node;
  }
  return doc.createNode(value);
}

function hasAliasesOrMerges(doc: Document): boolean {
  let found = false;
  visit(doc, {
    Alias() {
      found = true;
      return visit.BREAK;
    },
    Pair(_, pair) {
      if (keyOf(pair.key) === "<<") {
        found = true;
        return visit.BREAK;
      }
    },
    Node(_, node) {
      if ("anchor" in node && node.anchor) {
        found = true;
        return visit.BREAK;
      }
    },
  });
  return found;
}

// `raw` (the current file) rewritten to hold `value`, keeping its comments
// and layout; null when that can't be done safely and the caller should dump
// afresh. `read` turns YAML text into what the app would load from it, and
// must give back `value` for the result to be used. `prev` is what `raw`
// read as before the edit; omit it to write every key of `value`.
export function updateYamlText(
  raw: string,
  value: unknown,
  read: (text: string) => unknown,
  prev?: unknown
): string | null {
  try {
    const doc = parseDocument(raw);
    if (doc.errors.length > 0 || hasAliasesOrMerges(doc)) return null;
    doc.contents = apply(doc, doc.contents, value, prev) as typeof doc.contents;
    // No folding: a long URL or description stays on its line, as typed.
    const text = doc.toString({ lineWidth: 0 });
    const roundTrip = JSON.parse(JSON.stringify(read(text)));
    return isDeepStrictEqual(roundTrip, JSON.parse(JSON.stringify(value))) ? text : null;
  } catch {
    return null;
  }
}
