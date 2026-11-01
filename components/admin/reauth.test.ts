import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithReauth, registerReauthPrompt } from "./reauth";

// fetchWithReauth: a 403 asking for a confirmation, and a 401 from a session
// that ended (#399), both go through the dialog and retry once.
describe("fetchWithReauth", () => {
  afterEach(() => {
    registerReauthPrompt(null);
    vi.unstubAllGlobals();
  });

  it("asks to sign in again on a 401 and retries, keeping the request as it was", async () => {
    const prompt = vi.fn(async () => true);
    registerReauthPrompt(prompt);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ error: "Unauthorized" }, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const init = { method: "PUT", body: "{}" };
    const res = await fetchWithReauth("/api/settings", init);
    expect(res.status).toBe(200);
    expect(prompt).toHaveBeenCalledWith(false, "signin");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]).toEqual(["/api/settings", init]);
  });

  it("hands back the 401 when the admin declines, and the 403 confirmation path is unchanged", async () => {
    const prompt = vi.fn(async () => false);
    registerReauthPrompt(prompt);
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ error: "Unauthorized" }, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    expect((await fetchWithReauth("/api/settings")).status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const confirm = vi.fn(async () => true);
    registerReauthPrompt(confirm);
    const second = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ error: "Confirm", reauthRequired: true, totpRequired: true }, { status: 403 }))
      .mockResolvedValueOnce(Response.json({ ok: true }));
    vi.stubGlobal("fetch", second);
    expect((await fetchWithReauth("/api/config?secrets=1")).status).toBe(200);
    expect(confirm).toHaveBeenCalledWith(true, "confirm");
  });

  it("returns the response untouched when no dialog is mounted", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ error: "Unauthorized" }, { status: 401 })));
    expect((await fetchWithReauth("/api/settings")).status).toBe(401);
  });
});
