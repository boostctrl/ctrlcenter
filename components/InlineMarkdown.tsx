import { Fragment } from "react";
import type { InlineToken } from "@/lib/markdown";

// Render a parseInline() token list as React elements — bold/italic/code/links
// only, never raw HTML. Shared by the site-wide AnnouncementBanner and the
// /status page announcement cards so both render the same safe inline subset the
// same way. A `break` collapses to a space (callers pass single-line content).
export default function InlineMarkdown({ tokens }: { tokens: InlineToken[] }) {
  return tokens.map((t, i) => {
    switch (t.kind) {
      case "text":
        return <Fragment key={i}>{t.text}</Fragment>;
      case "break":
        return " ";
      case "code":
        return (
          <code
            key={i}
            className="rounded bg-fg/10 px-1 py-0.5 font-mono text-[0.9em]"
          >
            {t.text}
          </code>
        );
      case "bold":
        return (
          <strong key={i} className="font-semibold">
            <InlineMarkdown tokens={t.children} />
          </strong>
        );
      case "italic":
        return (
          <em key={i}>
            <InlineMarkdown tokens={t.children} />
          </em>
        );
      case "link":
        return (
          <a
            key={i}
            href={t.href}
            target="_blank"
            rel="noreferrer"
            className="font-medium underline decoration-fg/40 underline-offset-2 transition-colors hover:decoration-fg"
          >
            <InlineMarkdown tokens={t.children} />
          </a>
        );
    }
  });
}
