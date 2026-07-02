// Minimal, safe markdown subset for the Notes widget. Parses to a token tree
// that the widget renders as React elements — never raw HTML — so note content
// cannot inject markup (no dangerouslySetInnerHTML anywhere, nothing to
// sanitize). Supported: # ## ### headings, paragraphs, - / 1. lists, > quotes,
// ``` fenced code blocks, --- rules, and inline **bold**, *italic*, `code` and
// [text](url) links (http(s) URLs only — any other scheme stays plain text).

export type InlineToken =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "bold"; children: InlineToken[] }
  | { kind: "italic"; children: InlineToken[] }
  | { kind: "link"; href: string; children: InlineToken[] }
  | { kind: "break" };

export type MarkdownBlock =
  | { kind: "heading"; level: 1 | 2 | 3; children: InlineToken[] }
  | { kind: "paragraph"; children: InlineToken[] }
  | { kind: "list"; ordered: boolean; items: InlineToken[][] }
  | { kind: "quote"; children: InlineToken[] }
  | { kind: "codeBlock"; text: string }
  | { kind: "rule" };

// Inline patterns, tried at every position; on a tie the earlier entry wins,
// so code beats emphasis and ** beats *. Emphasis requires non-whitespace at
// both edges so "3 * 4 * 5" stays arithmetic instead of italicizing " 4 ".
const INLINE_PATTERNS: {
  re: RegExp;
  make: (m: RegExpExecArray) => InlineToken;
}[] = [
  {
    re: /`([^`]+)`/,
    make: (m) => ({ kind: "code", text: m[1] }),
  },
  {
    re: /\*\*([^\s*](?:[^*]*[^\s*])?)\*\*/,
    make: (m) => ({ kind: "bold", children: parseInline(m[1]) }),
  },
  {
    re: /\*([^\s*](?:[^*]*[^\s*])?)\*/,
    make: (m) => ({ kind: "italic", children: parseInline(m[1]) }),
  },
  {
    re: /_([^\s_](?:[^_]*[^\s_])?)_/,
    make: (m) => ({ kind: "italic", children: parseInline(m[1]) }),
  },
  {
    re: /\[([^\]]+)\]\(([^)\s]+)\)/,
    make: (m) =>
      /^https?:\/\//i.test(m[2])
        ? { kind: "link", href: m[2], children: parseInline(m[1]) }
        : // Unsafe scheme (javascript:, data:, …): keep the literal source text.
          { kind: "text", text: m[0] },
  },
];

export function parseInline(src: string): InlineToken[] {
  const out: InlineToken[] = [];
  let rest = src;
  while (rest.length > 0) {
    let earliest: { index: number; length: number; token: InlineToken } | null =
      null;
    for (const p of INLINE_PATTERNS) {
      const m = p.re.exec(rest);
      if (m && (earliest === null || m.index < earliest.index)) {
        earliest = { index: m.index, length: m[0].length, token: p.make(m) };
      }
    }
    if (!earliest) {
      out.push({ kind: "text", text: rest });
      break;
    }
    if (earliest.index > 0) {
      out.push({ kind: "text", text: rest.slice(0, earliest.index) });
    }
    out.push(earliest.token);
    rest = rest.slice(earliest.index + earliest.length);
  }
  return out;
}

// Consecutive lines of one block, joined with explicit line breaks.
function linesWithBreaks(lines: string[]): InlineToken[] {
  const out: InlineToken[] = [];
  lines.forEach((line, i) => {
    if (i > 0) out.push({ kind: "break" });
    out.push(...parseInline(line));
  });
  return out;
}

const UL_RE = /^[-*+]\s+/;
const OL_RE = /^\d+[.)]\s+/;
const HEADING_RE = /^(#{1,3})\s+(.*)$/;
const RULE_RE = /^(-{3,}|\*{3,}|_{3,})$/;
const QUOTE_RE = /^>\s?/;
const FENCE_RE = /^```/;

function startsBlock(trimmed: string): boolean {
  return (
    trimmed === "" ||
    FENCE_RE.test(trimmed) ||
    HEADING_RE.test(trimmed) ||
    RULE_RE.test(trimmed) ||
    QUOTE_RE.test(trimmed) ||
    UL_RE.test(trimmed) ||
    OL_RE.test(trimmed)
  );
}

export function parseMarkdown(src: string): MarkdownBlock[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const trimmed = lines[i].trim();
    if (trimmed === "") {
      i++;
      continue;
    }
    if (FENCE_RE.test(trimmed)) {
      // Fenced code: verbatim until the closing fence (or end of input).
      const buf: string[] = [];
      i++;
      while (i < lines.length && !FENCE_RE.test(lines[i].trim())) {
        buf.push(lines[i]);
        i++;
      }
      i++; // skip the closing fence
      blocks.push({ kind: "codeBlock", text: buf.join("\n") });
      continue;
    }
    const heading = HEADING_RE.exec(trimmed);
    if (heading) {
      blocks.push({
        kind: "heading",
        level: heading[1].length as 1 | 2 | 3,
        children: parseInline(heading[2]),
      });
      i++;
      continue;
    }
    if (RULE_RE.test(trimmed)) {
      blocks.push({ kind: "rule" });
      i++;
      continue;
    }
    if (QUOTE_RE.test(trimmed)) {
      const buf: string[] = [];
      while (i < lines.length && QUOTE_RE.test(lines[i].trim())) {
        buf.push(lines[i].trim().replace(QUOTE_RE, ""));
        i++;
      }
      blocks.push({ kind: "quote", children: linesWithBreaks(buf) });
      continue;
    }
    if (UL_RE.test(trimmed) || OL_RE.test(trimmed)) {
      const ordered = OL_RE.test(trimmed);
      const marker = ordered ? OL_RE : UL_RE;
      const items: InlineToken[][] = [];
      while (i < lines.length && marker.test(lines[i].trim())) {
        items.push(parseInline(lines[i].trim().replace(marker, "")));
        i++;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }
    // Paragraph: consecutive plain lines until a blank or another block form.
    const buf: string[] = [trimmed];
    i++;
    while (i < lines.length && !startsBlock(lines[i].trim())) {
      buf.push(lines[i].trim());
      i++;
    }
    blocks.push({ kind: "paragraph", children: linesWithBreaks(buf) });
  }
  return blocks;
}
