// Integrations (#300): the admin edits the whole list at once.
import type { Integration } from "../schema";
import { mutate } from "./store";

export async function replaceIntegrations(integrations: Integration[]): Promise<void> {
  await mutate((config) => {
    config.integrations = integrations;
  });
}

// Turn write actions off for every integration (#367): when two-factor
// authentication is turned off, nothing may keep acting without it. Returns
// how many were on.
export async function clearAllowActions(): Promise<number> {
  return mutate((config) => {
    const on = config.integrations.filter((i) => i.allowActions);
    if (on.length) config.integrations = config.integrations.map((i) => ({ ...i, allowActions: false }));
    return on.length;
  });
}
