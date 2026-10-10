// The JSON query check (#294): a tiny JSONPath subset plus one comparison,
// written as `$.status == "ok"` or `$.queue.depth < 50`. Pure — the check
// engine fetches, this decides.
//
//   query  := path [op value]
//   path   := "$" ( "." name | "[" index "]" | "[" quoted "]" )*
//   op     := "==" | "!=" | "<=" | ">=" | "<" | ">"
//   value  := a JSON literal ("ok", 42, true, null) or bare text (ok)
//
// With no comparison the field just has to be present and truthy. Numbers and
// numeric strings compare as numbers, so `$.count > 3` works on "7" too.

export type JsonQuery = {
  path: (string | number)[];
  op: "==" | "!=" | "<" | "<=" | ">" | ">=" | null;
  value?: unknown;
};

const OPS = ["==", "!=", "<=", ">=", "<", ">"] as const;

export function parseJsonQuery(source: string): JsonQuery | { error: string } {
  const src = source.trim();
  if (!src.startsWith("$")) return { error: "Start the query with $, e.g. $.status" };
  const path: (string | number)[] = [];
  let i = 1;
  while (i < src.length) {
    const ch = src[i];
    if (ch === ".") {
      const m = /^[A-Za-z0-9_$-]+/.exec(src.slice(i + 1));
      if (!m) return { error: `Expected a field name after "." at position ${i + 1}` };
      path.push(m[0]);
      i += 1 + m[0].length;
    } else if (ch === "[") {
      const rest = src.slice(i + 1);
      const index = /^\s*(\d+)\s*\]/.exec(rest);
      const quoted = /^\s*(["'])((?:\\.|(?!\1).)*)\1\s*\]/.exec(rest);
      if (index) {
        path.push(Number(index[1]));
        i += 1 + index[0].length;
      } else if (quoted) {
        path.push(quoted[2].replace(/\\(.)/g, "$1"));
        i += 1 + quoted[0].length;
      } else {
        return { error: `Expected [number] or ["name"] at position ${i + 1}` };
      }
    } else {
      break;
    }
  }
  const tail = src.slice(i).trim();
  if (tail === "") return { path, op: null };
  const op = OPS.find((o) => tail.startsWith(o));
  if (!op) return { error: `Expected a comparison (==, !=, <, >, <=, >=) after the path` };
  const raw = tail.slice(op.length).trim();
  if (raw === "") return { error: `Expected a value after ${op}` };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    // Bare text compares as a string: `$.status == ok`.
    value = raw;
  }
  return { path, op, value };
}

// The value at a path, and whether it's there at all.
export function selectPath(data: unknown, path: (string | number)[]): { found: boolean; value?: unknown } {
  let cur: unknown = data;
  for (const seg of path) {
    if (cur === null || typeof cur !== "object") return { found: false };
    const container = cur as Record<string | number, unknown>;
    if (!Object.hasOwn(container, seg)) return { found: false };
    cur = container[seg];
  }
  return { found: true, value: cur };
}

const asNumber = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
};

export function evaluateJsonQuery(query: JsonQuery, data: unknown): boolean {
  const { found, value } = selectPath(data, query.path);
  if (!found) return false;
  if (query.op === null) {
    return value !== null && value !== false && value !== 0 && value !== "";
  }
  const a = asNumber(value);
  const b = asNumber(query.value);
  if (query.op === "==" || query.op === "!=") {
    const equal =
      a !== null && b !== null ? a === b : JSON.stringify(value) === JSON.stringify(query.value);
    return query.op === "==" ? equal : !equal;
  }
  if (a === null || b === null) return false;
  switch (query.op) {
    case "<":
      return a < b;
    case "<=":
      return a <= b;
    case ">":
      return a > b;
    case ">=":
      return a >= b;
  }
}

// A bare path (no comparison), for mapping a JSON field to a value: the
// generic API widget (#302). `$` alone is the whole document.
export function parseJsonPath(source: string): (string | number)[] | { error: string } {
  const parsed = parseJsonQuery(source);
  if ("error" in parsed) return parsed;
  if (parsed.op !== null) return { error: "Just the path here, without a comparison" };
  return parsed.path;
}

