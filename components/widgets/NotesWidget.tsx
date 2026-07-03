"use client";

import { Fragment, useMemo } from "react";
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
          <strong key={i} className="font-semibold text-fg/90">
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
            className="underline decoration-fg/30 underline-offset-2 transition-colors hover:text-fg/90"
          >
            <Inline tokens={t.children} />
          </a>
        );
    }
  });
}

const HEADING_CLASS: Record<1 | 2 | 3, string> = {
  1: "text-base font-semibold text-fg/90",
  2: "text-sm font-semibold text-fg/85",
  3: "text-sm font-medium text-fg/75",
};

function Block({ block }: { block: MarkdownBlock }) {
  switch (block.kind) {
    case "heading": {
      const Tag = (["h3", "h4", "h5"] as const)[block.level - 1];
      return (
        <Tag className={HEADING_CLASS[block.level]}>
          <Inline tokens={block.children} />
        </Tag>
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
        <ol className="list-decimal space-y-1 pl-5 marker:text-fg/40">
          {items}
        </ol>
      ) : (
        <ul className="list-disc space-y-1 pl-5 marker:text-fg/40">{items}</ul>
      );
    }
    case "quote":
      return (
        <blockquote
          className="border-l-2 pl-3 text-fg/55 italic"
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
  maxBodyHeight,
}: {
  title: string;
  content: string;
  // Show the section heading; the layout editor's label toggle turns it off.
  showTitle?: boolean;
  // Cap the note body's height (px), scrolling past it; from the layout editor.
  maxBodyHeight?: number;
}) {
  const blocks = useMemo(() => parseMarkdown(content), [content]);
  if (blocks.length === 0) return null;
  return (
    <section>
      {showTitle && title.trim() !== "" && <SectionTitle>{title}</SectionTitle>}
      <div
        className="glass-card space-y-3 p-6 text-sm leading-relaxed text-fg/70"
        style={
          maxBodyHeight
            ? { maxHeight: maxBodyHeight, overflowY: "auto" }
            : undefined
        }
      >
        {blocks.map((b, i) => (
          <Block key={i} block={b} />
        ))}
      </div>
    </section>
  );
}
