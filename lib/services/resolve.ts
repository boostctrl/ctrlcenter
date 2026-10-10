// An integration's credentials as its client uses them (#300): `${ENV}`
// references expanded, and for the integration a 2.x config migrated to (id
// = type), the pre-3.0 environment variable (CTRLCENTER_SONARR_KEY, …)
// still beating the stored secret. Server-only; the result never leaves the
// server.
import type { Integration } from "../schema";
import { expandEnvRefs, resolveSecret } from "../secrets";
import { SERVICE_META } from "./ids";

export type ResolvedIntegration = {
  url: string;
  username: string;
  password: string;
  apiKey: string;
  allowInsecureTls: boolean;
};

export function resolveIntegration(
  i: Pick<Integration, "id" | "type" | "url" | "username" | "password" | "apiKey" | "allowInsecureTls">
): ResolvedIntegration {
  const meta = SERVICE_META[i.type];
  const legacy = (field: "password" | "apiKey", stored: string) =>
    i.id === i.type && (meta.credentials === "apiKey") === (field === "apiKey")
      ? resolveSecret(meta.legacyEnv, stored)
      : stored;
  return {
    url: expandEnvRefs(i.url),
    username: expandEnvRefs(i.username),
    password: expandEnvRefs(legacy("password", i.password)),
    apiKey: expandEnvRefs(legacy("apiKey", i.apiKey)),
    allowInsecureTls: i.allowInsecureTls,
  };
}
