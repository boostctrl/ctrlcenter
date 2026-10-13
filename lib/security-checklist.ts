// The security checklist (#367): the facts that decide whether this
// deployment is in a safe state for a public port, judged into rows an admin
// can act on. `securityChecklist` is pure (tests pin every row);
// `collectSecurityFacts` gathers the facts from config, env and the session
// list. Settings → Security shows the rows; boot logs the red ones.
//
// No network probes and no guess at "is this exposed to the internet": the
// rows state what the app can see and let the admin judge.

import type { Config } from "./schema";
import { integrationLabels } from "./services/ids";
import { persistedSessionSecret } from "./session-secret";
import { getIdleHours, listSessions, sessionsPersisted } from "./sessions";
import { TRUSTED_PROXY_HOPS, productionEntry } from "./rate-limit";
import { NO_PASSWORD_MESSAGE } from "./auth";

export type ChecklistLevel = "ok" | "warn" | "bad";

export type ChecklistRow = {
  id: string;
  level: ChecklistLevel;
  // What the row is about, and the state with the fix when there is one.
  title: string;
  detail: string;
};

// `forwarded` is null when the app couldn't tell how the sign-in arrived (#383).
export type SessionFact = { ip: string | null; https: boolean; forwarded: boolean | null };

export type SecurityFacts = {
  totpEnabled: boolean;
  // A password set in the portal (stored hash) / the ADMIN_PASSWORD env var.
  passwordStored: boolean;
  passwordEnv: boolean;
  sessionSecret: "env" | "volume" | "password";
  sessionsPersisted: boolean;
  trustedProxyHops: number;
  // Whether the server runs from the Docker image's entry
  // (scripts/server-entry.mjs), the only place that can tell a proxied
  // sign-in from a direct one (#383).
  productionEntry: boolean;
  // The live sessions' sign-in facts; empty at boot, when the rows that
  // need them are left out.
  sessions: SessionFact[];
  // The labels of the integrations with "Allow actions from the dashboard" on.
  actionsOn: string[];
  idleHours: number;
};

// A loopback or private-range address — one a plain-HTTP sign-in from is a
// LAN habit rather than a public exposure. Null (unknown) counts as private:
// the app can't tell, so it doesn't accuse.
export function isPrivateIp(ip: string | null): boolean {
  if (!ip) return true;
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(v4);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      a === 0
    );
  }
  const lower = ip.toLowerCase();
  return lower === "::1" || lower === "::" || /^f[cd]/.test(lower) || lower.startsWith("fe80:");
}

const list = (names: string[]) =>
  names.length <= 3 ? names.join(", ") : `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;

export function securityChecklist(f: SecurityFacts): ChecklistRow[] {
  const rows: ChecklistRow[] = [];

  rows.push(
    f.totpEnabled
      ? { id: "totp", level: "ok", title: "Two-factor authentication", detail: "On: sign-in needs a code from your authenticator app." }
      : {
          id: "totp",
          level: "bad",
          title: "Two-factor authentication",
          detail: "Off: anyone with the password can sign in. Turn it on in Settings → Security before exposing the portal.",
        }
  );

  rows.push(
    f.passwordStored
      ? { id: "password", level: "ok", title: "Admin password", detail: "Set in the portal, so it can be changed here without a restart." }
      : f.passwordEnv
        ? {
            id: "password",
            level: "warn",
            title: "Admin password",
            detail: "Comes only from ADMIN_PASSWORD. Set one in the portal so it can be changed without a restart and never sits in the container's environment.",
          }
        : { id: "password", level: "bad", title: "Admin password", detail: NO_PASSWORD_MESSAGE }
  );

  if (f.sessions.length > 0) {
    const plain = f.sessions.filter((s) => !s.https);
    const exposed = plain.filter((s) => !isPrivateIp(s.ip));
    rows.push(
      exposed.length > 0
        ? {
            id: "https",
            level: "bad",
            title: "HTTPS",
            detail: `A session signed in over plain HTTP from ${exposed[0].ip}. Put the portal behind HTTPS before it faces the internet.`,
          }
        : plain.length > 0
          ? {
              id: "https",
              level: "warn",
              title: "HTTPS",
              detail: "Sessions sign in over plain HTTP. Fine on a trusted network; use HTTPS before exposing the portal.",
            }
          : { id: "https", level: "ok", title: "HTTPS", detail: "Every session signed in over HTTPS." }
    );

    // Judged only from the sign-ins whose arrival is known (#383): Next fills
    // X-Forwarded-For in on every request, so only the production entry can
    // tell, and a session from before it recorded that is unknown too.
    const known = f.sessions.filter((s) => s.forwarded !== null);
    const direct = known.filter((s) => s.forwarded === false);
    const proxied = known.filter((s) => s.forwarded === true);
    if (known.length === 0) {
      // Not knowing doesn't accuse, but the setting decides whether the
      // login throttle works, so it's worth a look.
      rows.push({
        id: "proxy",
        level: "warn",
        title: "Reverse proxy",
        detail: f.productionEntry
          ? "Can't tell yet whether sign-ins come through a proxy: the open sessions began before the app recorded that. Sign out and back in to check."
          : `Can't tell whether sign-ins come through a proxy: the app sees that only when run from the Docker image. Make sure TRUSTED_PROXY_HOPS (now ${f.trustedProxyHops}) is 0 if the portal is reached directly, or the number of proxies in front.`,
      });
    } else if (f.trustedProxyHops >= 1 && direct.length > 0) {
      rows.push({
        id: "proxy",
        level: "bad",
        title: "Reverse proxy",
        detail: `TRUSTED_PROXY_HOPS is ${f.trustedProxyHops} but a sign-in arrived with no X-Forwarded-For header, so the app looks directly reachable: a client can forge that header to dodge the login throttle. Set TRUSTED_PROXY_HOPS=0, or put the proxy in front.`,
      });
    } else if (f.trustedProxyHops === 0 && proxied.length > 0) {
      // Raising the setting while the portal is also reached directly would
      // let a direct client forge its address, so the advice waits for that.
      rows.push({
        id: "proxy",
        level: "warn",
        title: "Reverse proxy",
        detail: `Sign-ins arrive with X-Forwarded-For but TRUSTED_PROXY_HOPS is 0, so every client behind the proxy shares one login throttle. Set it to the number of proxies in front${direct.length > 0 ? ", once the portal can be reached only through them" : ""}.`,
      });
    } else {
      rows.push({
        id: "proxy",
        level: "ok",
        title: "Reverse proxy",
        detail:
          f.trustedProxyHops === 0
            ? "Reached directly, and the login throttle counts each client by its own address."
            : `Behind ${f.trustedProxyHops === 1 ? "a reverse proxy" : `${f.trustedProxyHops} proxies`}, and the login throttle counts each client by the address it reports.`,
      });
    }
  }

  rows.push(
    f.sessionSecret === "password"
      ? {
          id: "secret",
          level: "bad",
          title: "Session secret",
          detail: "Falls back to the admin password because the config volume can't be written. Set SESSION_SECRET, or make the volume writable, so a captured cookie can't be used to guess the password.",
        }
      : {
          id: "secret",
          level: "ok",
          title: "Session secret",
          detail: f.sessionSecret === "env" ? "Set with SESSION_SECRET." : "A random secret kept in the config volume.",
        }
  );

  rows.push(
    f.sessionsPersisted
      ? { id: "sessions", level: "ok", title: "Session list", detail: "Kept in the config volume, so ending a session survives a restart." }
      : {
          id: "sessions",
          level: "warn",
          title: "Session list",
          detail: "Can't be written to the config volume: sessions end when the server restarts, and the list below is this process's only.",
        }
  );

  rows.push(
    f.actionsOn.length === 0
      ? { id: "actions", level: "ok", title: "Dashboard actions", detail: "No integration allows actions from the dashboard." }
      : f.totpEnabled
        ? { id: "actions", level: "ok", title: "Dashboard actions", detail: `On for ${list(f.actionsOn)}, behind two-factor authentication.` }
        : {
            id: "actions",
            level: "bad",
            title: "Dashboard actions",
            detail: `On for ${list(f.actionsOn)} but two-factor authentication is off, so they stay blocked until it's on.`,
          }
  );

  rows.push(
    f.idleHours <= 24
      ? {
          id: "idle",
          level: "ok",
          title: "Idle timeout",
          detail: `An unused session ends after ${f.idleHours === 1 ? "an hour" : `${f.idleHours} hours`}.`,
        }
      : {
          id: "idle",
          level: "warn",
          title: "Idle timeout",
          detail: `An unused session lasts up to ${Math.round(f.idleHours / 24)} days. A day or less is safer on a public port.`,
        }
  );

  return rows;
}

// Gather the facts from the config, the environment and (unless `sessions`
// is false, as at boot) the live session list.
export async function collectSecurityFacts(
  config: Pick<Config, "auth" | "integrations">,
  opts: { sessions?: boolean } = {}
): Promise<SecurityFacts> {
  const labels = integrationLabels(config.integrations);
  const sessionSecret: SecurityFacts["sessionSecret"] = process.env.SESSION_SECRET
    ? "env"
    : (await persistedSessionSecret())
      ? "volume"
      : "password";
  return {
    totpEnabled: config.auth.totp.enabled,
    passwordStored: Boolean(config.auth.passwordHash),
    passwordEnv: Boolean(process.env.ADMIN_PASSWORD),
    sessionSecret,
    sessionsPersisted: await sessionsPersisted(),
    trustedProxyHops: TRUSTED_PROXY_HOPS,
    productionEntry: productionEntry(),
    sessions:
      opts.sessions === false
        ? []
        : (await listSessions()).map((s) => ({ ip: s.ip, https: s.https, forwarded: s.forwarded })),
    actionsOn: config.integrations.filter((i) => i.allowActions).map((i) => labels[i.id]),
    idleHours: await getIdleHours(),
  };
}
