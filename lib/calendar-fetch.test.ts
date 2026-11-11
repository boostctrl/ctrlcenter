import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchCalendarRange } from "./calendar-fetch";

const ICS = [
  "BEGIN:VCALENDAR",
  "BEGIN:VEVENT",
  "UID:private-1",
  "DTSTART:20270105T100000Z",
  "DTEND:20270105T110000Z",
  "SUMMARY:Private meeting",
  "END:VEVENT",
  "END:VCALENDAR",
  "",
].join("\r\n");

const FROM = Date.parse("2027-01-01T00:00:00Z");
const TO = Date.parse("2027-02-01T00:00:00Z");

// A CalDAV server that answers only a request carrying the right Basic auth.
function stubServer() {
  const expected = "Basic " + Buffer.from("alice:secret").toString("base64");
  const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const auth = new Headers(init?.headers).get("authorization");
    return auth === expected
      ? new Response(ICS, { status: 200 })
      : new Response("Unauthorized", { status: 401 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("calendar cache (#461)", () => {
  it("doesn't serve an authenticated feed's events to a request without credentials", async () => {
    stubServer();
    const url = "https://cal.test/private-a.ics";
    const withAuth = await fetchCalendarRange(url, FROM, TO, { username: "alice", password: "secret" });
    expect(withAuth.map((e) => e.summary)).toEqual(["Private meeting"]);
    const withoutAuth = await fetchCalendarRange(url, FROM, TO);
    expect(withoutAuth).toEqual([]);
  });

  it("doesn't serve them to a request with other credentials", async () => {
    stubServer();
    const url = "https://cal.test/private-b.ics";
    await fetchCalendarRange(url, FROM, TO, { username: "alice", password: "secret" });
    const wrong = await fetchCalendarRange(url, FROM, TO, { username: "alice", password: "guess" });
    expect(wrong).toEqual([]);
  });

  it("still serves one URL and credential pair from the cache", async () => {
    const fetchMock = stubServer();
    const url = "https://cal.test/private-c.ics";
    const auth = { username: "alice", password: "secret" };
    await fetchCalendarRange(url, FROM, TO, auth);
    const calls = fetchMock.mock.calls.length;
    const again = await fetchCalendarRange(url, FROM, TO, auth);
    expect(again.map((e) => e.summary)).toEqual(["Private meeting"]);
    expect(fetchMock.mock.calls.length).toBe(calls);
  });
});
