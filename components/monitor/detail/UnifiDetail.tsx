"use client";

import type { UnifiDetail as UnifiDetailData, UnifiDevice } from "@/lib/services/unifi";
import { EmptyRow, GlyphBubble, List, Notices, Pill, Row, Section, Stat, StatGrid, UsageBar, type GlyphName } from "../kit";

// UniFi's page (#517), on the page kit (#508): the internet connection, the
// clients on the network, and every UniFi device (other UniFi apps' too,
// such as Protect cameras, #467), whether each is up, what it carries and
// for how long.

// Compact uptime: "5d 4h", "12h", "34m".
function uptimeLabel(seconds: number): string {
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3600);
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return `${h}h`;
  return `${Math.max(1, Math.floor(seconds / 60))}m`;
}

const KIND_GLYPH: Record<string, GlyphName> = {
  Gateway: "globe",
  Switch: "server",
  "Access Point": "wifi",
  Protect: "camera",
};

function deviceLine(d: UnifiDevice): string {
  const parts = [d.kind];
  if (d.up && d.clients !== null) parts.push(`${d.clients} client${d.clients === 1 ? "" : "s"}`);
  if (d.up && d.uptime !== null) parts.push(`up ${uptimeLabel(d.uptime)}`);
  return parts.join(" · ");
}

export default function UnifiDetail({ data }: { data: UnifiDetailData }) {
  const { internet, clients, devices } = data;
  const allDevices = devices.online + devices.disconnected + devices.pending;
  return (
    <div className="flex flex-col gap-6">
      <StatGrid>
        <Stat
          label="Internet"
          value={internet.up ? "Up" : "Down"}
          tone={internet.up ? "up" : "down"}
          hint={[internet.isp, internet.latencyMs !== null ? `${internet.latencyMs} ms` : null].filter(Boolean).join(" · ") || undefined}
        />
        <Stat label="WAN address" value={<span className="truncate font-mono text-lg">{internet.wanIp ?? "—"}</span>} hint="Public IP" />
        <Stat
          label="Clients"
          value={clients.total}
          hint={[`${clients.wireless} WiFi`, `${clients.wired} wired`, clients.guests ? `${clients.guests} guest${clients.guests === 1 ? "" : "s"}` : null]
            .filter(Boolean)
            .join(" · ")}
          visual={<UsageBar ratio={clients.total ? clients.wireless / clients.total : 0} />}
        />
        <Stat
          label="Devices online"
          value={devices.online}
          unit={allDevices ? `of ${allDevices}` : undefined}
          tone={devices.disconnected ? "down" : undefined}
          hint={
            [devices.disconnected ? `${devices.disconnected} offline` : null, devices.pending ? `${devices.pending} pending` : null]
              .filter(Boolean)
              .join(" · ") || "All online"
          }
        />
      </StatGrid>

      {data.issues.length > 0 && (
        <Section title="Issues" count={data.issues.length} flush>
          <Notices
            items={data.issues.map((i) => ({
              tone: i.level === "error" ? "down" : "warn",
              label: i.level === "error" ? "Error" : "Warning",
              message: i.message,
            }))}
          />
        </Section>
      )}

      <Section title="Devices" count={data.deviceList.length} flush>
        {data.deviceList.length > 0 ? (
          <div className="grid lg:grid-cols-2 lg:divide-x lg:divide-fg/[0.07]">
            {[0, 1].map((col) => {
              // Two columns on wide screens, filled down the first column, so
              // the offline devices (sorted first) lead it.
              const mid = Math.ceil(data.deviceList.length / 2);
              const part = col === 0 ? data.deviceList.slice(0, mid) : data.deviceList.slice(mid);
              return (
                <List key={col}>
                  {part.map((d, i) => (
                    <Row
                      key={`${d.name}-${i}`}
                      leading={<GlyphBubble name={KIND_GLYPH[d.kind] ?? "box"} tone={d.up ? "muted" : "down"} />}
                      primary={d.name}
                      title={d.name}
                      secondary={deviceLine(d)}
                      trailing={<Pill tone={d.up ? "up" : "down"}>{d.up ? "Online" : "Offline"}</Pill>}
                    />
                  ))}
                </List>
              );
            })}
          </div>
        ) : (
          <EmptyRow>No devices reported.</EmptyRow>
        )}
      </Section>
    </div>
  );
}
