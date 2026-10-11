import { describe, it, expect, vi, afterEach } from "vitest";
import { log, hostOf, errorReason } from "./log";

// One line per event (lib/log.ts): the context renders as key=value pairs on
// that line, with every control character gone — a logged string may be a
// sender's (a webhook's event type), and an escape sequence would reach the
// terminal as is.
afterEach(() => {
  vi.restoreAllMocks();
});

describe("log", () => {
  it("renders the context on one line, controls and whitespace runs collapsed to a space", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    log.warn("something happened", { key: "a\u001b[31m\u0007b\r\n  c", n: 3, skip: undefined });
    expect(warn).toHaveBeenCalledTimes(1);
    const line = warn.mock.calls[0][0] as string;
    expect(line).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z WARN  ctrlcenter: something happened key=a \[31m b c n=3$/);
    expect(line).not.toMatch(/\p{Cc}/u);
  });

  it("logs a URL's host only, and names a timeout", () => {
    expect(hostOf("https://cal.example.com/private/abc.ics?token=secret")).toBe("cal.example.com");
    expect(hostOf("not a url")).toBe("(invalid url)");
    expect(errorReason(new DOMException("aborted", "AbortError"))).toBe("timeout");
    expect(errorReason(new Error("ECONNREFUSED"))).toBe("ECONNREFUSED");
    expect(errorReason("boom")).toBe("boom");
  });
});
