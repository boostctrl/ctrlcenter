import { describe, it, expect } from "vitest";
import {
  parseCpuMax,
  parseCpuUsageUsec,
  parseBytesOrMax,
  parseInactiveFile,
  parseProcStatCpu,
  parseMeminfo,
} from "./system-stats";

describe("parseCpuMax", () => {
  it("derives the core budget from quota/period", () => {
    expect(parseCpuMax("100000 100000\n")).toBe(1);
    expect(parseCpuMax("200000 100000")).toBe(2);
    expect(parseCpuMax("50000 100000")).toBe(0.5);
  });

  it("returns null for an unlimited quota or garbage", () => {
    expect(parseCpuMax("max 100000")).toBeNull();
    expect(parseCpuMax("")).toBeNull();
    expect(parseCpuMax("banana split")).toBeNull();
    expect(parseCpuMax("0 100000")).toBeNull();
  });
});

describe("parseCpuUsageUsec", () => {
  it("reads the usage_usec line out of cpu.stat", () => {
    const stat =
      "usage_usec 5342871\nuser_usec 3211001\nsystem_usec 2131870\nnr_periods 0\n";
    expect(parseCpuUsageUsec(stat)).toBe(5342871);
  });

  it("returns null when the line is missing", () => {
    expect(parseCpuUsageUsec("user_usec 10\n")).toBeNull();
    expect(parseCpuUsageUsec("")).toBeNull();
  });
});

describe("parseBytesOrMax", () => {
  it("parses a byte count and maps 'max' (no limit) to null", () => {
    expect(parseBytesOrMax("536870912\n")).toBe(536870912);
    expect(parseBytesOrMax("0")).toBe(0);
    expect(parseBytesOrMax("max\n")).toBeNull();
    expect(parseBytesOrMax("lots")).toBeNull();
  });
});

describe("parseInactiveFile", () => {
  it("reads the inactive_file line out of memory.stat", () => {
    const stat = "anon 1052672\nfile 4096\ninactive_file 2048\nactive_file 2048\n";
    expect(parseInactiveFile(stat)).toBe(2048);
  });

  it("returns null when absent", () => {
    expect(parseInactiveFile("anon 1052672\n")).toBeNull();
  });
});

describe("parseProcStatCpu", () => {
  // user nice system idle iowait irq softirq steal
  const stat =
    "cpu  1000 50 500 8000 200 10 40 0 0 0\ncpu0 500 25 250 4000 100 5 20 0 0 0\n";

  it("sums the aggregate line into idle (idle+iowait) and total jiffies", () => {
    const parsed = parseProcStatCpu(stat);
    expect(parsed).toEqual({ idleTicks: 8200, totalTicks: 9800 });
  });

  it("returns null for a file without the aggregate line", () => {
    expect(parseProcStatCpu("intr 12345\n")).toBeNull();
    expect(parseProcStatCpu("")).toBeNull();
  });
});

describe("parseMeminfo", () => {
  it("converts MemTotal / MemAvailable from kB to bytes", () => {
    const text =
      "MemTotal:       16303680 kB\nMemFree:         1024000 kB\nMemAvailable:    8151840 kB\n";
    expect(parseMeminfo(text)).toEqual({
      totalBytes: 16303680 * 1024,
      availableBytes: 8151840 * 1024,
    });
  });

  it("returns null when either line is missing", () => {
    expect(parseMeminfo("MemTotal: 100 kB\n")).toBeNull();
    expect(parseMeminfo("")).toBeNull();
  });
});
