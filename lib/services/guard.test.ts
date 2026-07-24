import { afterEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

// The guard reads config and re-checks the admin session; both are stubbed so
// the test drives the gate ordering directly.
const { readConfigInternal, isAdminRequest } = vi.hoisted(() => ({
  readConfigInternal: vi.fn(),
  isAdminRequest: vi.fn(),
}));
vi.mock("../config", () => ({ readConfigInternal }));
vi.mock("../api-auth", () => ({ isAdminRequest }));

import { requireAction } from "./guard";

const req = {} as NextRequest;

// One config with a single service slice, so a test dials just the fields the
// gate under test cares about.
function withQbit(over: Record<string, unknown> = {}) {
  readConfigInternal.mockResolvedValue({
    auth: { passwordHash: "hash" },
    settings: {
      integrations: {
        qbittorrent: {
          enabled: true,
          url: "http://qbit.local:8080",
          username: "admin",
          password: "pw",
          allowInsecureTls: false,
          allowActions: true,
          ...over,
        },
      },
    },
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("requireAction", () => {
  it("passes all four gates and returns the resolved config", async () => {
    isAdminRequest.mockResolvedValue(true);
    withQbit();
    const result = await requireAction(req, "qbittorrent");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.cfg.url).toBe("http://qbit.local:8080");
  });

  it("rejects a non-admin session with 401, before any config gate", async () => {
    isAdminRequest.mockResolvedValue(false);
    // Even with actions off AND the service disabled, the session gate wins.
    withQbit({ enabled: false, allowActions: false });
    const result = await requireAction(req, "qbittorrent");
    expect(result).toMatchObject({ ok: false, status: 401 });
  });

  it("rejects an unconfigured integration with 409", async () => {
    isAdminRequest.mockResolvedValue(true);
    withQbit({ url: "   " });
    const result = await requireAction(req, "qbittorrent");
    expect(result).toMatchObject({ ok: false, status: 409 });
  });

  it("rejects a configured integration with actions off with 403", async () => {
    isAdminRequest.mockResolvedValue(true);
    withQbit({ allowActions: false });
    const result = await requireAction(req, "qbittorrent");
    expect(result).toMatchObject({ ok: false, status: 403 });
  });
});
