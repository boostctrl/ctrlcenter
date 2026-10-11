// The email for a relayed webhook event (#345): a subject, an HTML sheet and a
// plain-text part built from the WebhookReport the parsers in lib/webhooks.ts
// produce. Pure string building — no templating library — and client-safe (no
// lib/log.ts, no node:*, no process.env) so an admin preview can run it in the
// browser later. Every payload-derived string passes escapeHtml; only http(s)
// URLs become an href, and only https URLs — plus the inline data:image/*
// tile the admin preview (#347) hands in — an image. The parsers
// (lib/webhooks.ts httpsUrl) never emit data:, so a hostile payload can
// print text but never a link or an image.

import { formatInZone, normalizeIntlSpaces } from "./datetime";
import {
  clamp,
  displayUrl,
  type NotificationContext,
  type NotificationLevel,
  type ReportFact,
  type ReportOptions,
  type WebhookNotification,
  type WebhookReport,
} from "./webhooks";

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Header-safe: CR/LF and every other control character become a space (a
// newline in a Subject header is an injection), whitespace collapsed.
export function cleanHeader(s: string): string {
  return s.replace(/[\p{Cc}\s]+/gu, " ").trim();
}

const isHttp = (u: string | undefined): u is string => !!u && /^https?:\/\//i.test(u);
const isHttps = (u: string | undefined): u is string => !!u && /^https:\/\//i.test(u);
// A poster is an https image, or an inline raster/SVG data URL: the admin
// preview (#347) shows a placeholder tile that way so it fetches nothing.
// The parsers only ever emit https, and an <img> never runs an SVG's script.
const isPoster = (u: string | undefined): u is string =>
  isHttps(u) || (!!u && /^data:image\/(?:png|jpeg|gif|webp|svg\+xml)[;,]/i.test(u));

// The host of a URL for the caption under the button; "" when it isn't one.
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

// --- Subject ---

const SUBJECT_TARGET = 60;
const SUBJECT_MAX = 78;

// "[App] Event: Summary", aimed at 60 characters and never past 78. Over the
// target, a trailing "(YYYY)" goes first; then the summary is word-cut, keeping
// at least 24 characters of it while the cap allows. Only the summary is ever
// cut — the prefix, app and event always survive. Without a report the
// cleaned title is the subject.
export function buildSubject(c: WebhookNotification, prefix = ""): string {
  const lead = cleanHeader(prefix);
  const r = c.report;
  if (!r) {
    return clamp(cleanHeader(`${lead} ${c.title}`), SUBJECT_MAX) || "Notification";
  }
  const app = clamp(cleanHeader(r.app), 20);
  const head = `${lead ? `${lead} ` : ""}[${app}] ${cleanHeader(r.event)}`;
  let tail = cleanHeader(r.summary);
  if (head.length + 2 + tail.length > SUBJECT_TARGET) {
    const noYear = tail.replace(/\s*\(\d{4}\)$/, "");
    tail = noYear;
    if (head.length + 2 + tail.length > SUBJECT_TARGET) {
      const room = Math.max(
        SUBJECT_TARGET - head.length - 2,
        Math.min(24, SUBJECT_MAX - head.length - 2)
      );
      tail = room < 4 ? "" : clamp(tail, room);
    }
  }
  const out = (tail ? `${head}: ${tail}` : head).slice(0, SUBJECT_MAX);
  return out || "Notification";
}

// --- HTML ---

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = "SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace";

// The light palette, inline on every cell; the <style> block overrides it
// for dark mode by class. Every colour here has a dark twin in darkRules().
const L = {
  page: "#f4f4f5",
  sheet: "#ffffff",
  rule: "#e4e4e7",
  ink: "#18181b",
  body: "#3f3f46",
  muted: "#52525b",
  link: "#1e40af",
  frame: "#f4f4f5",
};

const BAND: Record<NotificationLevel, string> = {
  info: "#1e40af",
  success: "#15803d",
  warning: "#b45309",
  error: "#b91c1c",
};

// Dark-mode rules, emitted once under prefers-color-scheme and once under
// Outlook.com's [data-ogsc] hook. All !important because the light values are
// inline.
function darkRules(scope: string): string {
  const rules: [string, string][] = [
    [".bg", "background-color:#09090b"],
    [".sheet", "background-color:#18181b;border-color:#3f3f46"],
    [".ink", "color:#f4f4f5"],
    [".body", "color:#d4d4d8"],
    [".muted", "color:#a1a1aa"],
    [".rule", "border-color:#3f3f46"],
    [".frame", "background-color:#27272a;border-color:#3f3f46;color:#a1a1aa"],
    [".btn", "background-color:#f4f4f5"],
    [".btn a", "color:#18181b"],
    [".link", "color:#93c5fd"],
  ];
  return rules
    .map(
      ([sel, decl]) =>
        `${scope}${sel}{${decl
          .split(";")
          .map((d) => `${d}!important`)
          .join(";")}}`
    )
    .join("\n");
}

function styleBlock(): string {
  return `<style>
:root{color-scheme:light dark;supported-color-schemes:light dark}
@media (prefers-color-scheme:dark){
${darkRules("")}
}
${darkRules("[data-ogsc] ")}
@media screen and (max-width:600px){
.px{padding-left:20px!important;padding-right:20px!important}
.stack{display:block!important;width:100%!important;box-sizing:border-box!important}
th.stack{padding-bottom:0!important;border-bottom:0!important}
td.stack{padding-top:2px!important;border-top:0!important}
}
</style>`;
}

// Escaped text with a break opportunity after each . - _ so a release name
// wraps at its dots rather than anywhere — except inside a channel count or
// a version like "7.1", a lone digit on each side.
function breakable(s: string): string {
  const e = escapeHtml(s);
  const digit = (i: number) => /\d/.test(e[i] ?? "");
  return e.replace(/[._-]/g, (m, i: number) =>
    digit(i - 1) && !digit(i - 2) && digit(i + 1) && !digit(i + 2) ? m : `${m}<wbr>`
  );
}

const lines = (s: string) => s.replace(/\n/g, "<br>");

function bandHtml(app: string, event: string, level: NotificationLevel): string {
  const colour = BAND[level];
  const cell = `font-family:${FONT};font-size:12px;line-height:16px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#ffffff`;
  return `<tr><td class="px" bgcolor="${colour}" style="background-color:${colour};padding:11px 32px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse"><tr>
<td style="${cell}">${escapeHtml(app)}</td>
<td align="right" style="${cell};text-align:right">${escapeHtml(event)}</td>
</tr></table>
</td></tr>`;
}

// A 72×108 framed tile beside the headline. With images blocked the tile
// stays, tinted, with the alt text as its caption; the text column never
// moves because the cell keeps its width either way.
function posterHtml(image: WebhookReport["image"]): string {
  if (!image || !isPoster(image.url)) return "";
  const caption = `font-family:${FONT};font-size:11px;line-height:14px;color:${L.muted};text-align:center`;
  return `<td width="72" valign="top" style="width:72px;padding:4px 0 0 24px">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr>
<td class="frame" width="72" height="108" bgcolor="${L.frame}" align="center" valign="middle" style="width:72px;height:108px;background-color:${L.frame};border:1px solid ${L.rule};${caption}"><img src="${escapeHtml(image.url)}" width="72" height="108" alt="${escapeHtml(image.alt)}" style="display:block;width:72px;height:108px;border:0;outline:none;text-decoration:none;${caption}"></td>
</tr></table>
</td>`;
}

function headlineHtml(r: Sheet, poster: string): string {
  const subtitle = r.subtitle
    ? `<p class="body" style="margin:6px 0 0;font-family:${FONT};font-size:15px;line-height:22px;color:${L.body}">${escapeHtml(r.subtitle)}</p>`
    : "";
  return `<tr><td class="px" style="padding:28px 32px 0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse"><tr>
<td valign="top" style="font-family:${FONT}">
<h1 class="ink" style="margin:0;font-family:${FONT};font-size:24px;line-height:30px;font-weight:700;letter-spacing:-.01em;color:${L.ink};word-break:break-word">${escapeHtml(r.headline)}</h1>
${subtitle}
</td>
${poster}
</tr></table>
</td></tr>`;
}

function factsHtml(facts: ReportFact[]): string {
  if (!facts.length) return "";
  const rows = facts
    .map((f, i) => {
      const last = i === facts.length - 1;
      const border = `border-top:1px solid ${L.rule}${last ? `;border-bottom:1px solid ${L.rule}` : ""}`;
      const text = lines(f.mono ? breakable(f.value) : escapeHtml(f.value));
      const inner = f.mono
        ? `<span style="font-family:${MONO};font-size:13px;line-height:22px">${text}</span>`
        : text;
      const value = isHttp(f.href)
        ? `<a class="link" href="${escapeHtml(f.href)}" target="_blank" rel="noopener" style="color:${L.link};text-decoration:underline">${inner}</a>`
        : inner;
      return `<tr>
<th scope="row" class="rule muted stack" align="left" valign="top" width="136" style="width:136px;padding:10px 12px 10px 0;${border};font-family:${FONT};font-size:11px;line-height:20px;letter-spacing:.08em;text-transform:uppercase;font-weight:600;color:${L.muted}">${escapeHtml(f.label)}</th>
<td class="rule ink stack" valign="top" style="padding:9px 0 10px;${border};font-family:${FONT};font-size:15px;line-height:22px;color:${L.ink};word-break:break-word;overflow-wrap:anywhere">${value}</td>
</tr>`;
    })
    .join("\n");
  return `<tr><td class="px" style="padding:22px 32px 0">
<table role="table" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse">
${rows}
</table>
</td></tr>`;
}

function messageHtml(label: string, message: string | undefined): string {
  if (!message) return "";
  return `<tr><td class="px" style="padding:24px 32px 0">
<p class="muted" style="margin:0 0 6px;font-family:${FONT};font-size:11px;line-height:16px;letter-spacing:.08em;text-transform:uppercase;font-weight:600;color:${L.muted}">${escapeHtml(label)}</p>
<p class="body" style="margin:0;font-family:${FONT};font-size:15px;line-height:24px;color:${L.body}">${lines(escapeHtml(clamp(message, 600)))}</p>
</td></tr>`;
}

// The one button. A URL that isn't http(s) is printed, not linked: a
// javascript: or data: href in a mail client that honours it is a phishing
// vector.
function buttonHtml(link: WebhookReport["link"]): string {
  if (!link?.url) return "";
  if (!isHttp(link.url)) {
    return `<tr><td class="px" style="padding:24px 32px 0"><p class="muted" style="margin:0;font-family:${FONT};font-size:13px;line-height:20px;color:${L.muted};word-break:break-all">${escapeHtml(link.url)}</p></td></tr>`;
  }
  return `<tr><td class="px" style="padding:28px 32px 0">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr>
<td class="btn" bgcolor="${L.ink}" style="background-color:${L.ink};border-radius:6px;mso-padding-alt:12px 22px"><a href="${escapeHtml(link.url)}" target="_blank" rel="noopener" style="display:inline-block;padding:12px 22px;font-family:${FONT};font-size:14px;line-height:20px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px">${escapeHtml(link.label)}</a></td>
</tr></table>
<p class="muted" style="margin:10px 0 0;font-family:${FONT};font-size:12px;line-height:18px;color:${L.muted};word-break:break-all">${escapeHtml(hostOf(link.url))}</p>
</td></tr>`;
}

// The local time of the event, and the ISO instant for a tooltip and the
// text part. An unknown zone degrades to UTC (lib/datetime.ts).
function whenOf(ctx: NotificationContext): { local: string; iso: string } {
  const d = new Date(ctx.at);
  return {
    local: normalizeIntlSpaces(
      formatInZone(d, ctx.timeZone, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      })
    ),
    iso: d.toISOString(),
  };
}

// "relayed from Sonarr (Sonarr 4K)" — the instance only when it says more.
function relayOf(r: WebhookReport): string {
  return r.instance && r.instance !== r.app ? `${r.app} (${r.instance})` : r.app;
}

// What the sheet renders: a report, or the stand-in made from a notification
// that carries none.
type Sheet = Omit<WebhookReport, "service" | "eventType">;

// What the synopsis switch hides: the plot overview, the one message that
// can spoil (the parsers label only that "Overview"). A failure reason, a
// health message, update notes, an issue's description or comment stay —
// they are the point of their event.
const spoiler = (r: Sheet, o: ReportOptions) => o.synopsis === false && r.messageLabel === "Overview";

function sheetOf(c: WebhookNotification): Sheet {
  if (c.report) return c.report;
  return {
    app: "CtrlCenter",
    event: "Notification",
    level: "info",
    headline: c.title,
    summary: c.title,
    facts: [],
    message: c.body?.trim() || undefined,
    messageLabel: "Message",
    link: c.url?.trim() ? { label: "Open", url: c.url.trim() } : undefined,
  };
}

// The hidden inbox preview line: the report's own, else the summary and the
// chips. Exported so the admin preview (#347) shows what the inbox would.
export function buildPreheader(c: WebhookNotification): string {
  const r = sheetOf(c);
  return clamp(
    cleanHeader(r.preheader || [r.summary, ...(r.chips ?? [])].filter(Boolean).join(" · ")),
    140
  );
}

function renderHtml(c: WebhookNotification, ctx: NotificationContext, subject: string): string {
  const r = sheetOf(c);
  const o: ReportOptions = ctx.options ?? {};
  const when = whenOf(ctx);
  const preheader = buildPreheader(c);
  const relay = c.report ? ` · relayed from ${escapeHtml(relayOf(c.report))}` : "";
  const poster = o.poster === false ? "" : posterHtml(r.image);
  return `<!doctype html>
<html lang="en" dir="ltr" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(subject)}</title>
<!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
${styleBlock()}
</head>
<body class="bg" bgcolor="${L.page}" style="margin:0;padding:0;background-color:${L.page};-webkit-text-size-adjust:100%">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:${L.page}">${escapeHtml(preheader)}${"&zwnj;&nbsp;".repeat(60)}</div>
<table role="presentation" class="bg" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${L.page}" style="width:100%;border-collapse:collapse;background-color:${L.page}">
<tr><td align="center" style="padding:32px 12px 40px">
<!--[if mso]><table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" class="sheet" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="${L.sheet}" style="width:100%;max-width:600px;border-collapse:separate;border-spacing:0;background-color:${L.sheet};border:1px solid ${L.rule}">
${bandHtml(r.app, r.event, r.level)}
${headlineHtml(r, poster)}
${o.facts === false ? "" : factsHtml(r.facts)}
${spoiler(r, o) ? "" : messageHtml(r.messageLabel ?? "Message", r.message)}
${buttonHtml(r.link)}
<tr><td height="32" style="height:32px;font-size:0;line-height:0">&nbsp;</td></tr>
</table>
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;border-collapse:collapse">
<tr><td class="muted" style="padding:18px 8px 0;font-family:${FONT};font-size:12px;line-height:18px;color:${L.muted}">
<span style="font-weight:600">CtrlCenter</span> · ${escapeHtml(ctx.siteTitle)}${relay}<br><span title="${escapeHtml(when.iso)}">${escapeHtml(when.local)}</span>
</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;
}

// --- Plain text ---

const TEXT_WIDTH = 78;
const LABEL_COL = 18;
const RULE = 64;

// Word-wrap to a width without ever splitting a word: a URL or a release
// name longer than the line stays whole and simply overruns.
function wrap(s: string, width: number): string[] {
  const out: string[] = [];
  for (const para of s.split("\n")) {
    let line = "";
    for (const word of para.split(" ")) {
      if (!word) continue;
      if (line && line.length + 1 + word.length > width) {
        out.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    out.push(line);
  }
  return out;
}

function renderText(c: WebhookNotification, ctx: NotificationContext): string {
  const r = sheetOf(c);
  const o: ReportOptions = ctx.options ?? {};
  const when = whenOf(ctx);
  const out: string[] = [];
  out.push(`${cleanHeader(r.app)} · ${cleanHeader(r.event)}`.toUpperCase(), "=".repeat(RULE));
  out.push(...wrap(r.headline, TEXT_WIDTH));
  if (r.subtitle) out.push(...wrap(r.subtitle, TEXT_WIDTH));
  if (o.facts !== false && r.facts.length) {
    out.push("");
    for (const f of r.facts) {
      // A linked value prints its URL once: alone when the value is just the
      // URL's own short form, else after a dash.
      const shown = isHttp(f.href)
        ? displayUrl(f.href) === f.value
          ? f.href
          : `${f.value} — ${f.href}`
        : f.value;
      const pad = " ".repeat(LABEL_COL);
      const label = f.label.length < LABEL_COL ? f.label.padEnd(LABEL_COL) : `${f.label}\n${pad}`;
      wrap(shown, TEXT_WIDTH - LABEL_COL).forEach((line, i) => out.push(`${i === 0 ? label : pad}${line}`));
    }
  }
  if (!spoiler(r, o) && r.message) {
    out.push("-".repeat(RULE), (r.messageLabel ?? "Message").toUpperCase());
    out.push(...wrap(clamp(r.message, 600), TEXT_WIDTH));
  }
  if (r.link?.url) out.push("", `${r.link.label}: ${r.link.url}`);
  const relay = c.report ? ` · relayed from ${relayOf(c.report)}` : "";
  out.push("", `CtrlCenter · ${ctx.siteTitle}${relay}`, when.local, `UTC ${when.iso}`);
  return out.join("\n");
}

// Email content for a relayed notification. Pure, unit-tested; `ctx` carries
// the clock so the time line is reproducible.
export function buildNotificationEmail(
  c: WebhookNotification,
  ctx: NotificationContext
): { subject: string; text: string; html: string } {
  const subject = buildSubject(c, ctx.options?.subjectPrefix);
  return { subject, text: renderText(c, ctx), html: renderHtml(c, ctx, subject) };
}
