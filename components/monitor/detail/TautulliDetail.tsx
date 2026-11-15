"use client";

import { useState } from "react";
import type { TautulliDetail as TautulliDetailData, TautulliSession } from "@/lib/services/tautulli";
import { useNow } from "@/components/useNow";
import {
  BarChart,
  Donut,
  EmptyRow,
  GlyphBubble,
  List,
  MoreButton,
  Pill,
  Row,
  Section,
  Stat,
  StatGrid,
  UsageBar,
  ago,
  useMounted,
  type ChartColor,
} from "../kit";
import { HistoryCharts } from "../kit/timeline";

const count = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

// Tautulli's page (#512), on the page kit (#508): who's watching now, with
// each stream's progress and whether the server is transcoding it, and what
// was watched lately.

// Tautulli reports bandwidth in kbps.
function bandwidth(kbps: number | null): { value: string; unit: string } {
  if (kbps === null || kbps <= 0) return { value: "0", unit: "Mbps" };
  if (kbps >= 1000) return { value: (kbps / 1000).toFixed(1), unit: "Mbps" };
  return { value: String(Math.round(kbps)), unit: "kbps" };
}

// How many watched titles show before "Show all": about the height of a
// few streams beside them, so the two cards end near each other (#521).
const WATCHED_SHOWN = 6;

const STATE_LABEL: Record<TautulliSession["state"], string> = {
  playing: "Playing",
  paused: "Paused",
  buffering: "Buffering",
};

export default function TautulliDetail({ data }: { data: TautulliDetailData }) {
  const mounted = useMounted();
  const clockNow = useNow(60_000);
  const now = mounted ? clockNow : null;
  const [allWatched, setAllWatched] = useState(false);
  const stats = data.stats;
  // "Nov 14" from the day Tautulli reports ("2026-11-14"), read as a plain
  // date so the viewer's zone can't move it.
  const plays = stats.playsByDay.map((d, i, all) => ({
    label:
      i === all.length - 1
        ? "Today"
        : i % 2 === all.length % 2
          ? ""
          : new Date(`${d.day}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    values: [d.tv, d.movies, d.music],
  }));
  const mostPlays = Math.max(...stats.topUsers.map((u) => u.plays), 1);
  const bw = bandwidth(data.totalBandwidthKbps);
  const paused = data.sessions.filter((s) => s.state === "paused").length;
  const viewers = new Set(data.history.map((h) => h.user)).size;

  return (
    <div className="flex flex-col gap-6">
      <StatGrid>
        <Stat
          label="Streaming now"
          value={data.streamCount}
          hint={data.streamCount === 0 ? "Nobody is watching" : paused ? `${paused} paused` : "All playing"}
        />
        <Stat
          label="Transcoding"
          value={data.transcodeCount}
          hint={data.transcodeCount === 0 ? "Everything plays direct" : "The server is converting these"}
        />
        <Stat label="Bandwidth" value={bw.value} unit={bw.unit} hint="Across every stream" />
        <Stat
          label="Watched lately"
          value={data.history.length}
          hint={data.history.length ? `by ${viewers} ${viewers === 1 ? "person" : "people"}` : "Nothing yet"}
        />
      </StatGrid>

      <HistoryCharts
        charts={[
          {
            title: "Streams",
            metrics: [
              { key: "streams", label: "Streams", color: 1 },
              { key: "transcodes", label: "Transcoding", color: 2 },
            ],
            format: count,
          },
          {
            title: "Bandwidth",
            metrics: [{ key: "bandwidth", label: "Bandwidth", color: 3 }],
            format: (kbps) => `${(kbps / 1000).toFixed(kbps >= 10_000 ? 0 : 1)} Mbps`,
          },
        ]}
      />

      {(plays.length > 0 || stats.platforms.length > 0) && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <Section title="Plays per day" description="The last two weeks, by kind.">
            {plays.length > 0 ? (
              <BarChart
                label="Plays per day over the last two weeks"
                slots={plays}
                series={[
                  { label: "TV", color: 1 },
                  { label: "Movies", color: 2 },
                  { label: "Music", color: 3 },
                ]}
              />
            ) : (
              <p className="py-6 text-center text-sm text-ink-50">Tautulli didn&apos;t report its plays.</p>
            )}
          </Section>
          <Section title="By platform" description="Where it was watched, over the last 30 days.">
            {stats.platforms.length > 0 ? (
              <Donut
                label="Plays by platform"
                center={String(stats.platforms.reduce((sum, p) => sum + p.plays, 0))}
                caption="plays"
                parts={stats.platforms.map((p, i) => ({ label: p.name, value: p.plays, color: (i + 1) as ChartColor }))}
              />
            ) : (
              <p className="py-6 text-center text-sm text-ink-50">Nothing watched in the last 30 days.</p>
            )}
          </Section>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Now playing" count={data.sessions.length} flush>
          {data.sessions.length > 0 ? (
            <List>
              {data.sessions.map((s, i) => (
                <Row
                  key={`${s.user}-${s.title}-${i}`}
                  leading={<GlyphBubble name={s.state === "paused" ? "pause" : "play"} tone={s.state === "playing" ? "up" : "muted"} />}
                  href={s.href}
                  primary={s.title}
                  title={s.title}
                  secondary={[s.user, STATE_LABEL[s.state], s.quality, s.player, s.remote ? "Remote" : ""].filter(Boolean).join(" · ")}
                  trailing={
                    <>
                      <Pill tone={s.playback === "transcode" ? "info" : "muted"}>
                        {s.playback === "transcode" ? "Transcode" : "Direct"}
                      </Pill>
                      <span>{Math.round(s.progress)}%</span>
                    </>
                  }
                  below={<UsageBar ratio={s.progress / 100} tone={s.state === "playing" ? undefined : "muted"} className="h-1" />}
                />
              ))}
            </List>
          ) : (
            <EmptyRow>Nobody is watching right now.</EmptyRow>
          )}
        </Section>

        <Section title="Recently watched" count={data.history.length} flush>
          {data.history.length > 0 ? (
            <List>
              {(allWatched ? data.history : data.history.slice(0, WATCHED_SHOWN)).map((h, i) => (
                <Row
                  key={`${h.title}-${h.at ?? i}-${i}`}
                  leading={<GlyphBubble name="check" />}
                  href={h.href}
                  primary={h.title}
                  title={h.title}
                  secondary={[h.user, h.at !== null && now !== null ? ago(h.at, now) : null].filter(Boolean).join(" · ")}
                  trailing={h.playback === "transcode" ? <Pill tone="info">Transcode</Pill> : undefined}
                />
              ))}
            </List>
          ) : (
            <EmptyRow>Nothing watched lately.</EmptyRow>
          )}
          {data.history.length > WATCHED_SHOWN && (
            <MoreButton expanded={allWatched} total={data.history.length} onToggle={() => setAllWatched((v) => !v)} />
          )}
        </Section>
      </div>

      {(stats.topUsers.length > 0 || stats.libraries.length > 0) && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Section title="Top viewers" description="By plays over the last 30 days." flush>
            {stats.topUsers.length > 0 ? (
              <List>
                {stats.topUsers.map((u) => (
                  <Row
                    key={u.name}
                    leading={<GlyphBubble name="user" />}
                    primary={u.name}
                    secondary={`${Math.round(u.seconds / 3600)} hours watched`}
                    trailing={`${u.plays} plays`}
                    below={<UsageBar ratio={u.plays / mostPlays} className="h-1" />}
                  />
                ))}
              </List>
            ) : (
              <EmptyRow>Nobody watched anything in the last 30 days.</EmptyRow>
            )}
          </Section>
          <Section title="Libraries" count={stats.libraries.length} flush>
            {stats.libraries.length > 0 ? (
              <List>
                {stats.libraries.map((l) => (
                  <Row
                    key={l.name}
                    leading={<GlyphBubble name={l.kind === "show" ? "tv" : l.kind === "movie" ? "film" : "server"} />}
                    primary={l.name}
                    title={l.name}
                    trailing={`${l.count.toLocaleString()} ${l.kind === "show" ? "shows" : l.kind === "movie" ? "movies" : l.kind === "artist" ? "artists" : "items"}`}
                  />
                ))}
              </List>
            ) : (
              <EmptyRow>Tautulli didn&apos;t report its libraries.</EmptyRow>
            )}
          </Section>
        </div>
      )}
    </div>
  );
}
