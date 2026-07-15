import { describe, it, expect, vi, beforeEach } from "vitest";

// ICMP checks shell out to the system `ping`, which needs raw-socket privileges
// CI can't rely on — so stub execFile and assert the exact args checkIcmp passes
// without ever spawning a process. vi.hoisted gives the mock a stable identity
// the hoisted vi.mock factory can close over; the specifier must match how
// status-check.ts imports it (`import { execFile } from "node:child_process"`).
const { execFileMock } = vi.hoisted(() => ({ execFileMock: vi.fn() }));
vi.mock("node:child_process", () => ({ execFile: execFileMock }));

import { checkApp } from "./status-check";

const base = { expectStatus: "", keyword: "" } as const;

// Drive the mocked execFile's callback with `err` (null = ping exited 0, host
// reachable) so the checkIcmp promise settles. execFile's callback is always the
// last positional argument: execFile(cmd, args, options, callback).
function drivePing(err: Error | null) {
  execFileMock.mockImplementation((...callArgs: unknown[]) => {
    const cb = callArgs[callArgs.length - 1] as (e: Error | null) => void;
    cb(err);
  });
}

// The command, args, and options ping was invoked with on the first call.
function firstCall() {
  const [cmd, args, opts] = execFileMock.mock.calls[0] as [
    string,
    string[],
    { timeout?: number },
  ];
  return { cmd, args, opts };
}

beforeEach(() => {
  execFileMock.mockReset();
});

describe("checkApp · icmp", () => {
  it("pings an IPv4-literal host with no -6 flag", async () => {
    drivePing(null);
    const r = await checkApp({
      ...base,
      url: "http://192.168.1.10",
      checkType: "icmp",
    });
    expect(r.up).toBe(true);
    expect(execFileMock).toHaveBeenCalledTimes(1);
    const { cmd, args } = firstCall();
    expect(cmd).toBe("ping");
    // -w deadline is ceil(TIMEOUT_MS / 1000) = 5s; an IPv4 literal gets no -6.
    expect(args).toEqual(["-c", "1", "-w", "5", "192.168.1.10"]);
  });

  it("pings a hostname verbatim with no -6 flag", async () => {
    drivePing(null);
    const r = await checkApp({
      ...base,
      url: "http://pihole.lan:8080",
      checkType: "icmp",
    });
    expect(r.up).toBe(true);
    const { args } = firstCall();
    expect(args).not.toContain("-6");
    // The parsed hostname (scheme and port dropped) is the final ping argument.
    expect(args).toEqual(["-c", "1", "-w", "5", "pihole.lan"]);
  });

  it("prepends -6 and strips brackets for an IPv6-literal host", async () => {
    // Regression cover for #136: hostFromUrl strips the brackets URL.hostname
    // leaves on IPv6 literals, and net.isIP(host) === 6 makes checkIcmp lead
    // with -6 so ping doesn't try to resolve the bare literal as a name first.
    drivePing(null);
    const r = await checkApp({
      ...base,
      url: "http://[::1]:8096",
      checkType: "icmp",
    });
    expect(r.up).toBe(true);
    const { args } = firstCall();
    expect(args).toEqual(["-6", "-c", "1", "-w", "5", "::1"]);
  });

  it("passes a positive timeout option to execFile", async () => {
    drivePing(null);
    await checkApp({ ...base, url: "http://192.168.1.10", checkType: "icmp" });
    // TIMEOUT_MS isn't exported, so assert the shape rather than a brittle value.
    const { opts } = firstCall();
    expect(typeof opts.timeout).toBe("number");
    expect(opts.timeout).toBeGreaterThan(0);
  });

  it("is up with a null status when ping's callback reports no error", async () => {
    drivePing(null);
    const r = await checkApp({
      ...base,
      url: "http://192.168.1.10",
      checkType: "icmp",
    });
    expect(r.up).toBe(true);
    expect(r.status).toBeNull();
  });

  it("is down when ping's callback reports an error", async () => {
    drivePing(new Error("1 packets transmitted, 0 received"));
    const r = await checkApp({
      ...base,
      url: "http://192.168.1.10",
      checkType: "icmp",
    });
    expect(r.up).toBe(false);
    expect(r.status).toBeNull();
    expect(execFileMock).toHaveBeenCalledTimes(1);
  });

  it("is down without invoking ping when the URL is unparsable", async () => {
    const r = await checkApp({ ...base, url: "not a url", checkType: "icmp" });
    expect(r.up).toBe(false);
    expect(r.status).toBeNull();
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("is down without invoking ping when the URL is empty", async () => {
    const r = await checkApp({ ...base, url: "", checkType: "icmp" });
    expect(r.up).toBe(false);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("is down without invoking ping when the hostname begins with a dash (#159)", async () => {
    // `new URL("http://-f/")` yields hostname "-f"; hostFromUrl rejects it so a
    // leading-dash value can never be handed to ping as an option instead of a
    // destination.
    const r = await checkApp({ ...base, url: "http://-f/", checkType: "icmp" });
    expect(r.up).toBe(false);
    expect(execFileMock).not.toHaveBeenCalled();
  });
});
