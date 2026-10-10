// Integrations (#300): the admin edits the whole list at once.
import type { Integration } from "../schema";
import { mutate } from "./store";

export async function replaceIntegrations(integrations: Integration[]): Promise<void> {
  await mutate((config) => {
    config.integrations = integrations;
  });
}
