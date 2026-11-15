"use client";

import { useState } from "react";
import type { TautulliDetail as TautulliDetailData, TautulliSession } from "@/lib/services/tautulli";
import { useNow } from "@/components/useNow";
import {
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
} from "../kit";

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

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Now playing" count={data.sessions.length} flush>
          {data.sessions.length > 0 ? (
            <List>
              {data.sessions.map((s, i) => (
                <Row
                  key={`${s.user}-${s.title}-${i}`}
                  leading={<GlyphBubble name={s.state === "paused" ? "pause" : "play"} tone={s.state === "playing" ? "up" : "muted"} />}
                  primary={s.title}
                  title={s.title}
                  secondary={[s.user, STATE_LABEL[s.state], s.quality].filter(Boolean).join(" · ")}
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
    </div>
  );
}
