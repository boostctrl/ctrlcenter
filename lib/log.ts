// Minimal leveled logger for server-side diagnostics. The app previously
// swallowed every failure silently (a timed-out weather fetch, a rejected alert
// webhook, an unreadable feed), which made problems hard to trace. This writes
// one structured line per event to stdout/stderr so they surface in `docker
// logs` / the console.
//
// Level threshold via the LOG_LEVEL env var (debug | info | warn | error;
// default "info"). Context is passed as a flat object and rendered as
// space-separated key=value pairs. NOTE: never pass secrets or full third-party
// URLs (which can embed tokens, e.g. a private .ics address) — log the host
// instead (see `hostOf`).

type Level = "debug" | "info" | "warn" | "error";

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = ORDER[(process.env.LOG_LEVEL as Level) ?? "info"] ?? ORDER.info;

function render(meta?: Record<string, unknown>): string {
  if (!meta) return "";
  const parts: string[] = [];
  for (const [key, value] of Object.entries(meta)) {
    if (value === undefined) continue;
    let str: string;
    if (typeof value === "string") str = value;
    else {
      try {
        str = JSON.stringify(value);
      } catch {
        str = String(value);
      }
    }
    // Keep each pair on one line so a log line stays greppable.
    parts.push(`${key}=${str.replace(/\s+/g, " ")}`);
  }
  return parts.length ? " " + parts.join(" ") : "";
}

function emit(level: Level, msg: string, meta?: Record<string, unknown>): void {
  if (ORDER[level] < threshold) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ctrlcenter: ${msg}${render(meta)}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  debug: (msg: string, meta?: Record<string, unknown>) => emit("debug", msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) => emit("info", msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => emit("warn", msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => emit("error", msg, meta),
};

// The host of a URL, for logging without leaking a token embedded in the path
// or query. Falls back to "(invalid url)" so a bad value never throws in a log.
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "(invalid url)";
  }
}

// A short reason string for a failed fetch/parse, distinguishing a timeout
// (AbortError) from other network/parse errors.
export function errorReason(e: unknown): string {
  if (e instanceof Error) return e.name === "AbortError" ? "timeout" : e.message;
  return String(e);
}
