"use client";

import { useState } from "react";
import type { ArrDetail as ArrDetailData, ArrHealthItem, ArrQueueItem } from "@/lib/services/arr";
import { formatBytes } from "@/lib/format";
import { useNow } from "@/components/useNow";
import { arrWeek } from "../glances";
import {
  DateBadge,
  DayStrip,
  EmptyRow,
  GlyphBubble,
  List,
  MoreButton,
  Notices,
  Pill,
  Poster,
  Row,
  Section,
  Stat,
  StatGrid,
  UsageBar,
  ago,
  clock,
  dayName,
  useMounted,
  type Tone,
} from "../kit";

// Sonarr's and Radarr's page (#510), on the page kit (#508): the headline
// numbers, what the service reports about its health, what's downloading
// now, what's coming up, what was grabbed and imported lately, what's
// wanted and missing, and the room on each disk (#523). Rows carry the
// poster and open the series or movie in the service (#522).

const HEALTH: Record<ArrHealthItem["type"], { tone: Tone; label: string; rank: number }> = {
  error: { tone: "down", label: "Error", rank: 0 },
  warning: { tone: "warn", label: "Warning", rank: 1 },
  notice: { tone: "info", label: "Notice", rank: 2 },
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const WEEK = 7 * 86_400_000;
// How many recent rows show before "Show all".
const RECENT_SHOWN = 8;

// A queue row's state, in the page's tones.
const QUEUE: Record<string, { tone: Tone; label: string }> = {
  downloading: { tone: "info", label: "Downloading" },
  paused: { tone: "muted", label: "Paused" },
  queued: { tone: "muted", label: "Queued" },
  delay: { tone: "muted", label: "Delayed" },
  completed: { tone: "up", label: "Importing" },
  warning: { tone: "warn", label: "Needs a look" },
  failed: { tone: "down", label: "Failed" },
};
const queueState = (q: ArrQueueItem) => QUEUE[q.status] ?? { tone: "muted" as Tone, label: q.status };
// "00:12:30" or "1.02:00:00" as the service gives it → "12m", "1d 2h".
function timeLeft(raw: string | null): string {
  const m = raw?.match(/^(?:(\d+)\.)?(\d+):(\d+):(\d+)/);
  if (!m) return "";
  const [d, h, min] = [Number(m[1] ?? 0), Number(m[2]), Number(m[3])];
  if (d > 0) return `${d}d ${h}h left`;
  if (h > 0) return `${h}h ${min}m left`;
  return `${Math.max(1, min)}m left`;
}

export default function ArrDetail({ kind, data }: { kind: "sonarr" | "radarr"; data: ArrDetailData }) {
  const mounted = useMounted();
  const [allRecent, setAllRecent] = useState(false);
  const clockNow = useNow(60_000);
  const now = mounted ? clockNow : null;

  const week = arrWeek(data, now);
  const lastWeek = now === null ? [] : data.recent.filter((r) => r.at !== null && now - r.at < WEEK);
  const grabbed = lastWeek.filter((r) => r.event === "grabbed").length;
  const imported = lastWeek.filter((r) => r.event === "imported").length;
  const lastImport = data.recent.find((r) => r.event === "imported");
  const next = data.upcoming.find((u) => u.at !== null && (now === null || u.at >= now)) ?? data.upcoming[0];

  const count = (type: ArrHealthItem["type"]) => data.health.filter((h) => h.type === type).length;
  const errors = count("error");
  const warnings = count("warning");
  const notices = count("notice");
  const health = [...data.health].sort((a, b) => HEALTH[a.type].rank - HEALTH[b.type].rank);
  const stuck = data.queue.filter((q) => q.status === "warning" || q.status === "failed").length;
  // The disk with the least room is the one to watch.
  const tightest = [...data.disks].sort((a, b) => a.free - b.free)[0];
  const fullness = tightest?.total ? 1 - tightest.free / tightest.total : null;

  // Sonarr's calendar carries air times; Radarr's release dates are days.
  const when = (at: number | null) =>
    at === null || now === null ? "" : kind === "sonarr" ? `${dayName(at, now)} · ${clock(at)}` : dayName(at, now);

  return (
    <div className="flex flex-col gap-6">
      <StatGrid six>
        <Stat
          label="Next up"
          value={next?.at != null && now !== null ? dayName(next.at, now) : "—"}
          hint={next ? [next.title, next.subtitle].filter(Boolean).join(" · ") : "Nothing in the next two weeks"}
        />
        <Stat
          label="This week"
          value={now === null ? "—" : week.thisWeek}
          hint={now === null ? undefined : `${grabbed} grabbed · ${imported} imported`}
          visual={<DayStrip values={week.values} className="h-6 gap-1" />}
        />
        {errors > 0 ? (
          <Stat label="Health" value={errors} unit={errors === 1 ? "error" : "errors"} tone="down" hint={warnings ? plural(warnings, "warning") : undefined} />
        ) : warnings > 0 ? (
          <Stat label="Health" value={warnings} unit={warnings === 1 ? "warning" : "warnings"} tone="warn" hint={notices ? plural(notices, "notice") : undefined} />
        ) : (
          <Stat label="Health" value="Healthy" tone="up" hint={notices ? plural(notices, "notice") : "No issues reported"} />
        )}
        <Stat
          label="Downloading"
          value={data.queueTotal}
          tone={stuck > 0 ? "warn" : undefined}
          hint={data.queueTotal === 0 ? "The queue is empty" : stuck > 0 ? `${stuck} need a look` : "in the queue"}
        />
        <Stat
          label="Missing"
          value={data.missingTotal}
          hint={kind === "sonarr" ? "monitored episodes" : "monitored movies"}
        />
        {tightest ? (
          <Stat
            label="Free space"
            value={formatBytes(tightest.free)}
            hint={tightest.path}
            tone={fullness !== null && fullness >= 0.9 ? "down" : fullness !== null && fullness >= 0.8 ? "warn" : undefined}
            visual={fullness !== null ? <UsageBar ratio={fullness} tone={fullness >= 0.9 ? "down" : fullness >= 0.8 ? "warn" : undefined} /> : undefined}
          />
        ) : (
          <Stat
            label="Last import"
            value={lastImport?.at != null && now !== null ? ago(lastImport.at, now) : "—"}
            hint={lastImport ? [lastImport.title, lastImport.subtitle].filter(Boolean).join(" · ") : "None lately"}
          />
        )}
      </StatGrid>

      {health.length > 0 && (
        <Section title="Health" count={health.length} flush>
          <Notices items={health.map((h) => ({ tone: HEALTH[h.type].tone, label: HEALTH[h.type].label, message: h.message }))} />
        </Section>
      )}

      {data.queue.length > 0 && (
        <Section
          title="Downloading"
          count={data.queueTotal}
          actions={<OpenLink href={data.links.queue}>Open the queue</OpenLink>}
          flush
        >
          <List>
            {data.queue.map((q, i) => {
              const state = queueState(q);
              return (
                <Row
                  key={`${q.title}-${q.subtitle}-${i}`}
                  leading={<Poster src={q.poster} title={q.title} />}
                  href={q.href}
                  primary={q.title}
                  title={q.title}
                  secondary={[q.subtitle, q.size !== null ? formatBytes(q.size) : "", timeLeft(q.timeLeft)].filter(Boolean).join(" · ")}
                  trailing={
                    <>
                      <Pill tone={state.tone}>{state.label}</Pill>
                      {q.progress !== null && <span>{Math.floor(q.progress * 100)}%</span>}
                    </>
                  }
                  below={
                    q.progress !== null ? (
                      <UsageBar ratio={q.progress} tone={state.tone === "down" || state.tone === "warn" ? state.tone : undefined} className="h-1" />
                    ) : undefined
                  }
                />
              );
            })}
          </List>
        </Section>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Coming up" description="The next two weeks of the calendar." flush>
          {data.upcoming.length > 0 ? (
            <List>
              {data.upcoming.map((u, i) => (
                <Row
                  key={`${u.title}-${u.subtitle}-${i}`}
                  leading={<DateBadge at={mounted ? u.at : null} />}
                  href={u.href}
                  primary={u.title}
                  title={u.title}
                  secondary={u.subtitle}
                  trailing={when(u.at)}
                />
              ))}
            </List>
          ) : (
            <EmptyRow>Nothing scheduled in the next two weeks.</EmptyRow>
          )}
        </Section>

        <Section title="Recent activity" count={data.recent.length} flush>
          {data.recent.length > 0 ? (
            <List>
              {(allRecent ? data.recent : data.recent.slice(0, RECENT_SHOWN)).map((r, i) => (
                <Row
                  key={`${r.title}-${r.subtitle}-${i}`}
                  leading={
                    r.poster ? (
                      <Poster src={r.poster} title={r.title} />
                    ) : (
                      <GlyphBubble name={r.event === "imported" ? "check" : "download"} tone={r.event === "imported" ? "up" : "info"} />
                    )
                  }
                  href={r.href}
                  primary={r.title}
                  title={r.title}
                  secondary={r.subtitle}
                  trailing={
                    <>
                      <Pill tone={r.event === "imported" ? "up" : "info"}>{r.event === "imported" ? "Imported" : "Grabbed"}</Pill>
                      {r.at !== null && now !== null && <span>{ago(r.at, now)}</span>}
                    </>
                  }
                />
              ))}
            </List>
          ) : (
            <EmptyRow>Nothing grabbed or imported lately.</EmptyRow>
          )}
          {data.recent.length > RECENT_SHOWN && (
            <MoreButton expanded={allRecent} total={data.recent.length} onToggle={() => setAllRecent((v) => !v)} />
          )}
        </Section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section
          title="Missing"
          count={data.missingTotal}
          description={kind === "sonarr" ? "Monitored episodes that have aired and aren't in the library." : "Monitored movies that aren't in the library."}
          actions={<OpenLink href={data.links.missing}>See them all</OpenLink>}
          flush
        >
          {data.missing.length > 0 ? (
            <List>
              {data.missing.map((m, i) => (
                <Row
                  key={`${m.title}-${m.subtitle}-${i}`}
                  leading={<Poster src={m.poster} title={m.title} />}
                  href={m.href}
                  primary={m.title}
                  title={m.title}
                  secondary={m.subtitle}
                  trailing={m.at !== null && now !== null ? ago(m.at, now) : undefined}
                />
              ))}
            </List>
          ) : (
            <EmptyRow>Nothing is missing.</EmptyRow>
          )}
        </Section>

        <Section title="Disk space" count={data.disks.length} flush>
          {data.disks.length > 0 ? (
            <List>
              {data.disks.map((d) => {
                const used = d.total ? 1 - d.free / d.total : null;
                return (
                  <Row
                    key={d.path}
                    leading={<GlyphBubble name="server" tone={used !== null && used >= 0.9 ? "down" : "muted"} />}
                    primary={<span className="font-mono text-[13px]">{d.path}</span>}
                    title={d.path}
                    secondary={`${formatBytes(d.free)} free${d.total ? ` of ${formatBytes(d.total)}` : ""}`}
                    trailing={used !== null ? `${Math.round(used * 100)}% used` : undefined}
                    below={
                      used !== null ? (
                        <UsageBar ratio={used} tone={used >= 0.9 ? "down" : used >= 0.8 ? "warn" : undefined} className="h-1" />
                      ) : undefined
                    }
                  />
                );
              })}
            </List>
          ) : (
            <EmptyRow>The service didn&apos;t report its disks.</EmptyRow>
          )}
        </Section>
      </div>
    </div>
  );
}

// A section's link into the service, in a new tab.
function OpenLink({ href, children }: { href: string; children: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-xs font-medium text-ink-60 underline-offset-2 transition-colors hover:text-ink-90 hover:underline"
    >
      {children}
      <span className="sr-only"> in a new tab</span>
    </a>
  );
}
