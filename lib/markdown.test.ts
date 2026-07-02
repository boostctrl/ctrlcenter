import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown } from "./markdown";

describe("parseInline", () => {
  it("passes plain text through as one token", () => {
    expect(parseInline("hello world")).toEqual([
      { kind: "text", text: "hello world" },
    ]);
  });

  it("parses bold, italic and code", () => {
    expect(parseInline("a **b** *c* _d_ `e`")).toEqual([
      { kind: "text", text: "a " },
      { kind: "bold", children: [{ kind: "text", text: "b" }] },
      { kind: "text", text: " " },
      { kind: "italic", children: [{ kind: "text", text: "c" }] },
      { kind: "text", text: " " },
      { kind: "italic", children: [{ kind: "text", text: "d" }] },
      { kind: "text", text: " " },
      { kind: "code", text: "e" },
    ]);
  });

  it("nests emphasis inside bold", () => {
    expect(parseInline("**a _b_**")).toEqual([
      {
        kind: "bold",
        children: [
          { kind: "text", text: "a " },
          { kind: "italic", children: [{ kind: "text", text: "b" }] },
        ],
      },
    ]);
  });

  it("does not italicize spaced asterisks (arithmetic)", () => {
    expect(parseInline("3 * 4 * 5")).toEqual([
      { kind: "text", text: "3 * 4 * 5" },
    ]);
  });

  it("leaves markdown syntax inside inline code verbatim", () => {
    expect(parseInline("`**not bold**`")).toEqual([
      { kind: "code", text: "**not bold**" },
    ]);
  });

  it("parses http(s) links", () => {
    expect(parseInline("[docs](https://example.com/a)")).toEqual([
      {
        kind: "link",
        href: "https://example.com/a",
        children: [{ kind: "text", text: "docs" }],
      },
    ]);
  });

  it("refuses non-http(s) link schemes, keeping the literal text", () => {
    expect(parseInline("[x](javascript:alert(1))")).toEqual([
      { kind: "text", text: "[x](javascript:alert(1)" },
      { kind: "text", text: ")" },
    ]);
  });

  it("treats HTML as inert text", () => {
    expect(parseInline("<script>alert(1)</script>")).toEqual([
      { kind: "text", text: "<script>alert(1)</script>" },
    ]);
  });
});

describe("parseMarkdown", () => {
  it("parses headings at levels 1-3", () => {
    expect(parseMarkdown("# A\n## B\n### C")).toEqual([
      { kind: "heading", level: 1, children: [{ kind: "text", text: "A" }] },
      { kind: "heading", level: 2, children: [{ kind: "text", text: "B" }] },
      { kind: "heading", level: 3, children: [{ kind: "text", text: "C" }] },
    ]);
  });

  it("splits paragraphs on blank lines and keeps line breaks within one", () => {
    expect(parseMarkdown("a\nb\n\nc")).toEqual([
      {
        kind: "paragraph",
        children: [
          { kind: "text", text: "a" },
          { kind: "break" },
          { kind: "text", text: "b" },
        ],
      },
      { kind: "paragraph", children: [{ kind: "text", text: "c" }] },
    ]);
  });

  it("parses unordered and ordered lists", () => {
    expect(parseMarkdown("- a\n- b\n\n1. c\n2. d")).toEqual([
      {
        kind: "list",
        ordered: false,
        items: [[{ kind: "text", text: "a" }], [{ kind: "text", text: "b" }]],
      },
      {
        kind: "list",
        ordered: true,
        items: [[{ kind: "text", text: "c" }], [{ kind: "text", text: "d" }]],
      },
    ]);
  });

  it("merges consecutive quote lines into one blockquote", () => {
    expect(parseMarkdown("> a\n> b")).toEqual([
      {
        kind: "quote",
        children: [
          { kind: "text", text: "a" },
          { kind: "break" },
          { kind: "text", text: "b" },
        ],
      },
    ]);
  });

  it("keeps fenced code verbatim, including markdown syntax", () => {
    expect(parseMarkdown("```\n# not a heading\n**raw**\n```")).toEqual([
      { kind: "codeBlock", text: "# not a heading\n**raw**" },
    ]);
  });

  it("tolerates an unclosed fence (rest of input becomes the block)", () => {
    expect(parseMarkdown("```\ncode")).toEqual([
      { kind: "codeBlock", text: "code" },
    ]);
  });

  it("parses horizontal rules", () => {
    expect(parseMarkdown("a\n\n---\n\nb")).toEqual([
      { kind: "paragraph", children: [{ kind: "text", text: "a" }] },
      { kind: "rule" },
      { kind: "paragraph", children: [{ kind: "text", text: "b" }] },
    ]);
  });

  it("handles CRLF input", () => {
    expect(parseMarkdown("# A\r\nb")).toEqual([
      { kind: "heading", level: 1, children: [{ kind: "text", text: "A" }] },
      { kind: "paragraph", children: [{ kind: "text", text: "b" }] },
    ]);
  });

  it("does not treat an emphasis line as a list", () => {
    expect(parseMarkdown("*note*")).toEqual([
      {
        kind: "paragraph",
        children: [{ kind: "italic", children: [{ kind: "text", text: "note" }] }],
      },
    ]);
  });
});
