// Delivery of a merged webhook digest (#346, #351): the callback the hook
// route opens a group with, and the one a group read back from the spool at
// startup gets (instrumentation-node.ts). The config is read afresh when
// the group goes out — a channel added or edited while the burst was
// pending is honoured, one removed meanwhile isn't sent to, and a
// report-option toggle (#347) flipped meanwhile applies — which is why this
// lives apart from lib/webhook-digest.ts, which knows nothing of channels
// or config.
import { readConfigInternal } from "./config";
import { anyChannelReady, sendNotification } from "./alerts";
import { reportOptions, type WebhookNotification } from "./webhooks";
import { log } from "./log";

export async function relayDigest(merged: WebhookNotification): Promise<void> {
  const { settings } = await readConfigInternal();
  // The service whose event opened the group; a digest spanning services
  // (#359) names the first.
  const service = merged.report?.service ?? "webhooks";
  if (!anyChannelReady(settings.alerts)) {
    log.info("webhook digest dropped: no alert channel configured", { service });
    return;
  }
  await sendNotification(settings.alerts, merged, {
    at: Date.now(),
    timeZone: settings.timezone,
    siteTitle: settings.title,
    options: reportOptions(settings.webhooks),
  });
}
