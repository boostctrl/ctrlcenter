"use client";

import { useState } from "react";
import type { ArrHealthItem, ArrSnapshot } from "@/lib/services/arr";
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
  Row,
  Section,
  Stat,
  StatGrid,
  ago,
  clock,
  dayName,
  useMounted,
  type Tone,
} from "../kit";

// Sonarr's and Radarr's page (#510), on the page kit (#508): the headline
// numbers, what the service reports about its health, what's coming up, and
// what was grabbed and imported lately.

const HEALTH: Record<ArrHealthItem["type"], { tone: Tone; label: string; rank: number }> = {
  error: { tone: "down", label: "Error", rank: 0 },
  warning: { tone: "warn", label: "Warning", rank: 1 },
  notice: { tone: "info", label: "Notice", rank: 2 },
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const WEEK = 7 * 86_400_000;
// How many recent rows show before "Show all".
const RECENT_SHOWN = 8;

export default function ArrDetail({ kind, data }: { kind: "sonarr" | "radarr"; data: ArrSnapshot }) {
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

  // Sonarr's calendar carries air times; Radarr's release dates are days.
  const when = (at: number | null) =>
    at === null || now === null ? "" : kind === "sonarr" ? `${dayName(at, now)} · ${clock(at)}` : dayName(at, now);

  return (
    <div className="flex flex-col gap-6">
      <StatGrid>
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
          label="Last import"
          value={lastImport?.at != null && now !== null ? ago(lastImport.at, now) : "—"}
          hint={lastImport ? [lastImport.title, lastImport.subtitle].filter(Boolean).join(" · ") : "None lately"}
        />
      </StatGrid>

      {health.length > 0 && (
        <Section title="Health" count={health.length} flush>
          <Notices items={health.map((h) => ({ tone: HEALTH[h.type].tone, label: HEALTH[h.type].label, message: h.message }))} />
        </Section>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Section title="Coming up" description="The next two weeks of the calendar." flush>
          {data.upcoming.length > 0 ? (
            <List>
              {data.upcoming.map((u, i) => (
                <Row
                  key={`${u.title}-${u.subtitle}-${i}`}
                  leading={<DateBadge at={mounted ? u.at : null} />}
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
                    <GlyphBubble name={r.event === "imported" ? "check" : "download"} tone={r.event === "imported" ? "up" : "info"} />
                  }
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
    </div>
  );
}
