// The Markdown for a relayed webhook event (#532): what an Apprise channel
// gets in place of the one-liner the other chat and push channels relay. The
// Apprise API takes it as `format: "markdown"` and renders it in each
// destination's own terms — Markdown kept for Discord, Slack and Telegram,
// HTML for a mail or Pushover — so the report the email shows (the headline,
// the facts, the synopsis, the link back into the app) arrives as far as
// each service can carry it, and the poster rides along as an attachment.
//
// Built from the same report and options as the email (lib/webhook-email.ts),
// so the two never disagree. Client-safe, for the settings preview. Every
// payload-derived string passes escapeMarkdown, so a title or a comment can
// print but never format, link or page anyone (#533, #535); only http(s) URLs
// become a link and only an https poster an attachment.

import {
  buildSubject,
  isHttp,
  relayOf,
  sheetOf,
  spoiler,
  whenOf,
} from "./webhook-email";
import {
  clamp,
  type NotificationContext,
  type NotificationLevel,
  type ReportFact,
  type ReportOptions,
  type WebhookNotification,
} from "./webhooks";

// Discord takes 2,000 characters for the title and the body together (the
// strictest of the services Apprise reaches that refuse a longer message
// rather than cutting it); the title is a subject line, 78 at most, so the
// body keeps under the rest with room to spare.
export const MARKDOWN_MAX = 1900;

// The synopsis, as the email shows it.
const MESSAGE_MAX = 600;

// A synopsis cut shorter than this isn't worth sending: it is dropped whole.
const MESSAGE_MIN = 80;

// The notification types Apprise colours and badges by.
export type AppriseType = "info" | "success" | "warning" | "failure";
export const APPRISE_TYPE: Record<NotificationLevel, AppriseType> = {
  info: "info",
  success: "success",
  warning: "warning",
  error: "failure",
};

// Per channel, beside the report options every channel shares.
export type MarkdownOptions = {
  // The title's TMDB page as a plain link (#536).
  tmdbLink?: boolean;
};

export type AppriseMessage = {
  title: string;
  body: string;
  type: AppriseType;
  // An https image for the Apprise server to fetch and forward.
  attach?: string;
};

// Mentions that can't page anyone. The services behind Apprise read them in
// the text they are handed: Nextcloud Talk any @ that opens a word ("@all"
// notifies the whole conversation, #535), Matrix "@room", Telegram and
// Slack an "@name", and Discord — which Apprise sends no allowed_mentions —
// "@everyone" and "@here" wherever they stand and its "<@user>",
// "<@&role>", "<#channel>" and "<!…>" tags (#533). A zero-width space after
// the @, or the <, reads the same but is no mention; an @ inside a word, as
// in an email address, is left be. For the title too, which a service with
// a title field shows as it is (an escape would print), and one without
// folds into the Markdown.
export function quietMentions(s: string): string {
  return s
    .replace(/(?<![\p{L}\p{N}_])@(?=[\p{L}\p{N}_"'.@-])/gu, "@\u200b")
    .replace(/@(?=(everyone|here)\b)/gi, "@\u200b")
    .replace(/<(?=[@#!])/g, "<\u200b");
}

// A line's opening that CommonMark (or Discord) reads as structure: a
// heading, a quote, a list item, a rule or a heading's underline.
function escapeLineStart(line: string): string {
  const rest = line.replace(/^[ \t]+/, "");
  if (/^(#{1,6}(\s|$)|>|[-+](\s|$))/.test(rest) || /^(=+|-+)[ \t]*$/.test(rest) || /^(-[ \t]*){3,}$/.test(rest)) {
    return `\\${rest}`;
  }
  const ordered = /^(\d{1,9})(?=[.)](\s|$))/.exec(rest);
  return ordered ? `${ordered[1]}\\${rest.slice(ordered[1].length)}` : rest;
}

// Payload text as literal Markdown (#533): the characters that format (*, _,
// ~, `, |), link ([ ] and < for an autolink, a mention or a tag) or escape
// (\) are backslash-escaped anywhere, and a line's opening only where it
// would read as structure — so a title or a comment reads as written in
// Discord, Telegram and a mail alike, with as few backslashes as possible
// left showing where a service prints Markdown as it is. A line's
// indentation goes (four spaces would make it code); a newline is kept,
// for the caller to break on.
export function escapeMarkdown(s: string): string {
  return quietMentions(s)
    .replace(/[\\`*_~|[\]<]/g, "\\$&")
    .split("\n")
    .map(escapeLineStart)
    .join("\n");
}

// A URL as a link destination: the characters that would end or break one
// are percent-encoded. The parsers hand on only http(s) URLs; the caller
// checks before linking.
function destination(url: string): string {
  return url.replace(/[\s()<>]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`);
}

// A link reading `text` when `url` is http(s); else the URL as plain text,
// which links nowhere — a javascript: or data: one is never a link.
export function markdownLink(text: string, url: string): string {
  return isHttp(url) ? `[${escapeMarkdown(text)}](${destination(url)})` : escapeMarkdown(url);
}

// Text as an inline code span, for a release or a file name: no escaping
// inside, and a fence longer than any run of backticks in it.
function code(s: string): string {
  const longest = Math.max(0, ...(s.match(/`+/g) ?? []).map((r) => r.length));
  const fence = "`".repeat(longest + 1);
  const pad = s.startsWith("`") || s.endsWith("`") ? " " : "";
  return `${fence}${pad}${quietMentions(s)}${pad}${fence}`;
}

// One line of a fact's value: a link when it carries an http(s) one, code
// when it is a release name, else escaped text.
function factValue(f: ReportFact, line: string): string {
  if (f.mono) return code(line);
  return isHttp(f.href) ? markdownLink(line, f.href) : escapeMarkdown(line);
}

// A fact as lines: "**Quality:** WEBDL-1080p", or the label on a line of
// its own over a value of several (a burst's episodes).
function factLines(f: ReportFact): string[] {
  const label = `**${escapeMarkdown(f.label)}:**`;
  const values = f.value.split("\n").filter((l) => l.trim() !== "");
  if (values.length === 0) return [];
  if (values.length === 1) return [`${label} ${factValue(f, values[0])}`];
  return [label, ...values.map((v) => factValue(f, v))];
}

// Lines of one block, each its own line wherever the text lands: two
// trailing spaces are a hard break in CommonMark (a strict renderer would
// otherwise run them together) and invisible where a newline already is
// one.
const block = (lines: string[]) => lines.join("  \n");

const size = (s: string) => Array.from(s).length;

// What a TMDB page the parsers build looks like: nothing else goes out as a
// bare link, unescaped.
const TMDB_PAGE = /^https:\/\/www\.themoviedb\.org\/(movie|tv)\/[1-9]\d*$/;

// The synopsis under its label, a quote line per line of it.
function quote(label: string, text: string): string {
  const lines = text.split("\n").map((l) => l.trim());
  return block([`**${escapeMarkdown(label)}**`, ...lines.map((l) => (l ? `> ${escapeMarkdown(l)}` : ">"))]);
}

// The Markdown body for a relayed notification: the headline and subtitle,
// the facts, the synopsis in a quote, the link back into the app, and the
// footer the email ends on — each switched as the email's options switch
// it. Past MARKDOWN_MAX the synopsis gives way first, shortened and then
// dropped, then the facts a line at a time from the end, so nothing is cut
// through the middle of a link or a code span.
//
// With `tmdbLink`, the title's TMDB page follows the link as a plain URL
// (#536): Nextcloud Talk takes no image, but it previews the first plain
// link in a message — a Markdown link is none — with the page's poster,
// title and overview, so the line follows the Poster and Synopsis switches.
// A fact linking the same page (Seerr's) gives way to it.
export function buildNotificationMarkdown(
  c: WebhookNotification,
  ctx: NotificationContext,
  m: MarkdownOptions = {}
): string {
  const r = sheetOf(c);
  const o: ReportOptions = ctx.options ?? {};
  const when = whenOf(ctx);
  const page =
    m.tmdbLink && o.poster !== false && o.synopsis !== false && TMDB_PAGE.test(r.page ?? "") ? r.page : undefined;

  const head = block([`**${escapeMarkdown(r.headline)}**`, ...(r.subtitle ? [escapeMarkdown(r.subtitle)] : [])]);
  const link = r.link?.url ? markdownLink(r.link.label, r.link.url) : "";
  const relay = c.report ? ` · relayed from ${relayOf(c.report)}` : "";
  const footer = escapeMarkdown(`CtrlCenter · ${ctx.siteTitle}${relay} · ${when.local}`);
  const assemble = (facts: string[], message: string) =>
    [head, block(facts), message, link, page, footer].filter(Boolean).join("\n\n");

  let facts = o.facts === false ? [] : r.facts.filter((f) => !page || f.href !== page).flatMap(factLines);
  const label = r.messageLabel ?? "Message";
  let text = !spoiler(r, o) && r.message ? clamp(r.message, MESSAGE_MAX) : "";
  const body = () => assemble(facts, text ? quote(label, text) : "");

  // The synopsis first: cut by what's over (escaping can add a little, so
  // it is measured again), dropped once too short to be worth reading.
  for (let over = size(body()) - MARKDOWN_MAX; text && over > 0; over = size(body()) - MARKDOWN_MAX) {
    const keep = size(text) - over - 1;
    text = keep >= MESSAGE_MIN ? clamp(text, keep) : "";
  }
  // Then the facts, a line at a time from the end, saying how many went.
  const all = facts;
  for (let kept = all.length - 1; kept >= 0 && size(body()) > MARKDOWN_MAX; kept--) {
    facts = [...all.slice(0, kept), `…and ${all.length - kept} more`];
  }
  return body();
}

// What an Apprise channel sends for a relayed notification: the email's
// subject line as the title, the Markdown body, the level as Apprise's
// type, and the poster when the email would show one.
export function appriseNotification(
  c: WebhookNotification,
  ctx: NotificationContext,
  m: MarkdownOptions = {}
): AppriseMessage {
  const r = sheetOf(c);
  const o: ReportOptions = ctx.options ?? {};
  const poster = o.poster !== false && r.image?.url && /^https:\/\//i.test(r.image.url) ? r.image.url : undefined;
  return {
    title: quietMentions(buildSubject(c, o.subjectPrefix)),
    body: buildNotificationMarkdown(c, ctx, m),
    type: APPRISE_TYPE[r.level],
    ...(poster ? { attach: poster } : {}),
  };
}
