"use client";

import { Fragment, createElement, useMemo } from "react";
import SectionTitle from "../SectionTitle";
import {
  parseMarkdown,
  type InlineToken,
  type MarkdownBlock,
} from "@/lib/markdown";

// Admin-authored note card for the dashboard grid. Content is a safe markdown
// subset (lib/markdown.ts) parsed to tokens and rendered as React elements —
// never injected as HTML. The widget renders nothing when the note is empty;
// the layout editor shows its placeholder in that case.

function Inline({ tokens }: { tokens: InlineToken[] }) {
  return tokens.map((t, i) => {
    switch (t.kind) {
      case "text":
        return <Fragment key={i}>{t.text}</Fragment>;
      case "break":
        return <br key={i} />;
      case "code":
        return (
          <code
            key={i}
            className="rounded bg-fg/10 px-1 py-0.5 font-mono text-[0.85em]"
          >
            {t.text}
          </code>
        );
      case "bold":
        return (
          <strong key={i} className="font-semibold text-ink-90">
            <Inline tokens={t.children} />
          </strong>
        );
      case "italic":
        return (
          <em key={i}>
            <Inline tokens={t.children} />
          </em>
        );
      case "link":
        return (
          <a
            key={i}
            href={t.href}
            target="_blank"
            rel="noreferrer"
            className="underline decoration-fg/30 underline-offset-2 transition-colors hover:text-ink-90"
          >
            <Inline tokens={t.children} />
          </a>
        );
    }
  });
}

const HEADING_CLASS: Record<1 | 2 | 3, string> = {
  1: "text-base font-semibold text-ink-90",
  2: "text-sm font-semibold text-ink-85",
  3: "text-sm font-medium text-ink-75",
};

// A note's headings continue the page's outline: its top heading level sits
// right under the card's title (an h2), or under the page's h1 when the title
// is hidden, so a note that starts at `##` doesn't skip a level. The styling
// still follows the level written.
type HeadingTag = "h2" | "h3" | "h4" | "h5" | "h6";
export function headingTag(level: 1 | 2 | 3, top: number, titled: boolean): HeadingTag {
  const n = Math.min(6, (titled ? 3 : 2) + level - top);
  return `h${n}` as HeadingTag;
}

function Block({ block, top, titled }: { block: MarkdownBlock; top: number; titled: boolean }) {
  switch (block.kind) {
    case "heading": {
      return createElement(
        headingTag(block.level, top, titled),
        { className: HEADING_CLASS[block.level] },
        <Inline tokens={block.children} />
      );
    }
    case "paragraph":
      return (
        <p>
          <Inline tokens={block.children} />
        </p>
      );
    case "list": {
      const items = block.items.map((tokens, i) => (
        <li key={i}>
          <Inline tokens={tokens} />
        </li>
      ));
      return block.ordered ? (
        <ol className="list-decimal space-y-1 pl-5 marker:text-ink-40">
          {items}
        </ol>
      ) : (
        <ul className="list-disc space-y-1 pl-5 marker:text-ink-40">{items}</ul>
      );
    }
    case "quote":
      return (
        <blockquote
          className="border-l-2 pl-3 text-ink-55 italic"
          style={{
            borderColor:
              "color-mix(in srgb, var(--accent-from) 50%, transparent)",
          }}
        >
          <Inline tokens={block.children} />
        </blockquote>
      );
    case "codeBlock":
      return (
        <pre className="overflow-x-auto rounded-lg bg-fg/[0.06] p-3 font-mono text-xs leading-relaxed">
          {block.text}
        </pre>
      );
    case "rule":
      return <hr className="border-fg/10" />;
  }
}

export default function NotesWidget({
  title,
  content,
  showTitle = true,
}: {
  title: string;
  content: string;
  // Show the section heading; the layout editor's label toggle turns it off.
  showTitle?: boolean;
}) {
  const blocks = useMemo(() => parseMarkdown(content), [content]);
  if (blocks.length === 0) return null;
  const titled = showTitle && title.trim() !== "";
  const top = Math.min(4, ...blocks.flatMap((b) => (b.kind === "heading" ? [b.level] : [])));
  return (
    <section>
      {titled && <SectionTitle>{title}</SectionTitle>}
      <div className="glass-card space-y-3 p-6 text-sm leading-relaxed text-ink-70">
        {blocks.map((b, i) => (
          <Block key={i} block={b} top={top} titled={titled} />
        ))}
      </div>
    </section>
  );
}
