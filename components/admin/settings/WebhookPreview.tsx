"use client";

import { useDeferredValue, useMemo, useState } from "react";
import type { AlertConfig, WebhooksConfig } from "@/lib/schema";
import { CHANNEL_LABELS, activeChannels, channelLabel } from "@/lib/alert-channels";
import { buildNotificationEmail, buildPreheader, cleanHeader } from "@/lib/webhook-email";
import {
  SAMPLE_AT,
  SAMPLE_IDS,
  SAMPLE_LABELS,
  sampleNotification,
  type SampleId,
} from "@/lib/notification-samples";
import { ChipGroup } from "@/components/ChipGroup";
import { useLookPrefs } from "@/components/PrefsProvider";
import AlertTest from "../AlertTest";
import { SelectField, fieldLabelClasses, subCardClasses } from "../ui";

// The email subject's hard cap (lib/webhook-email.ts), for the counter.
const SUBJECT_MAX = 78;

// The poster tile the preview shows in place of a real poster: an inline
// SVG, so the preview fetches nothing from TheTVDB or TMDB — and nothing at
// all, the page's img-src admitting data: (lib/csp.ts). A Send sample goes
// without a poster.
const POSTER_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="72" height="108" viewBox="0 0 72 108">' +
  '<rect width="72" height="108" fill="#a1a1aa"/>' +
  '<path d="M14 82l14-19 11 13 8-9 11 15H14z" fill="#e4e4e7"/>' +
  '<circle cx="49" cy="38" r="7" fill="#e4e4e7"/></svg>';
const POSTER_URL = `data:image/svg+xml,${encodeURIComponent(POSTER_SVG)}`;

type Scheme = "light" | "dark";

// What a relayed event looks like before it arrives (#347): the real
// renderer run in the browser over the DRAFT options — every keystroke in
// the subject prefix shows at once, ahead of the autosave — into a
// sandboxed frame, plus the one-liner the push channels get and a Send
// sample per channel that takes inbound webhooks. The frame is `srcdoc`
// with an empty sandbox: the email's inline styles apply under the page's
// own policy, nothing in it can run or navigate, and its links are inert.
export default function WebhookPreview({
  webhooks,
  alerts,
  siteTitle,
  timeZone,
  saving,
}: {
  webhooks: WebhooksConfig;
  alerts: AlertConfig;
  siteTitle: string;
  timeZone: string;
  // A Send sample reads the SAVED config, so it waits out a pending or
  // failed autosave rather than sending the old options.
  saving: boolean;
}) {
  const { surfaceIsLight } = useLookPrefs();
  const [sample, setSample] = useState<SampleId>("sonarr-import");
  // Follows the admin's own surface until a chip is picked.
  const [scheme, setScheme] = useState<Scheme | null>(null);
  const dark = scheme ? scheme === "dark" : !surfaceIsLight;

  const { digestSeconds, poster, facts, synopsis, subjectPrefix } = webhooks;
  const notification = useMemo(
    () => sampleNotification(sample, { digest: digestSeconds > 0, posterUrl: POSTER_URL }),
    [sample, digestSeconds]
  );
  const email = useMemo(
    () =>
      buildNotificationEmail(notification, {
        at: SAMPLE_AT,
        timeZone,
        siteTitle,
        options: { poster, facts, synopsis, subjectPrefix },
      }),
    [notification, timeZone, siteTitle, poster, facts, synopsis, subjectPrefix]
  );
  // Dark is forced through Outlook.com's [data-ogsc] hook the template
  // already styles for, so the frame shows the dark rules whatever the
  // admin's own scheme; the frame's color-scheme keeps Light light when
  // the browser prefers dark.
  const html = dark ? email.html.replace("<html ", "<html data-ogsc ") : email.html;
  // The frame trails typing by a beat while the subject row keeps up.
  const deferredHtml = useDeferredValue(html);
  const preheader = buildPreheader(notification);
  // Whatever buildSubject took off the summary counts as shortened: a
  // trailing year goes first, silently, then words with an ellipsis — so the
  // subject is checked against the summary itself. Without a report only the
  // ellipsis can tell.
  const summary = notification.report ? cleanHeader(notification.report.summary) : "";
  const cut = email.subject.endsWith("…") || (!!notification.report && !email.subject.endsWith(summary));
  const receivers = activeChannels(alerts).filter((ch) => ch.onWebhooks);
  const label = SAMPLE_LABELS[sample];

  return (
    <details className="text-xs" open>
      <summary className="cursor-pointer text-ink-50 transition-colors hover:text-ink-80">
        Preview
      </summary>
      <div className={`${subCardClasses} mt-3 flex flex-col gap-3 p-3`}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0 grow basis-56">
            <SelectField
              label="Sample event"
              value={sample}
              onChange={(e) => setSample(e.target.value as SampleId)}
            >
              {SAMPLE_IDS.map((id) => (
                <option key={id} value={id}>
                  {SAMPLE_LABELS[id]}
                </option>
              ))}
            </SelectField>
          </div>
          <ChipGroup<Scheme>
            label="Preview color scheme"
            size="2xs"
            fit
            options={[
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
            value={dark ? "dark" : "light"}
            onChange={setScheme}
          />
        </div>

        <div className="flex flex-col gap-0.5">
          <p className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 font-medium break-words text-ink-90">{email.subject}</span>
            <span
              className={`shrink-0 tabular-nums ${cut ? "text-status-warning" : "text-ink-45"}`}
              title={cut ? "The title was shortened to fit the subject" : undefined}
            >
              {email.subject.length}/{SUBJECT_MAX}
            </span>
          </p>
          <p className="text-xs text-ink-45">{preheader}</p>
        </div>

        <iframe
          title={`Email preview: ${label}`}
          sandbox=""
          srcDoc={deferredHtml}
          className="h-[28rem] w-full rounded-lg border border-fg/10"
          style={{ colorScheme: dark ? "dark" : "light" }}
        />

        <details className="text-xs">
          <summary className="cursor-pointer text-ink-50 transition-colors hover:text-ink-80">
            Plain-text version
          </summary>
          <pre className="mt-2 overflow-x-auto font-mono text-xs whitespace-pre-wrap text-ink-80">
            {email.text}
          </pre>
        </details>

        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-45">
            <span>Push channels get</span>
            <span className="rounded-full border border-fg/15 px-2.5 py-1 text-xs text-ink-80">
              {notification.title}
            </span>
          </div>
          {notification.body && (
            <p className="text-xs whitespace-pre-line text-ink-45">{notification.body}</p>
          )}
        </div>

        {receivers.length > 0 && (
          <div className="flex flex-col gap-2 border-t border-fg/10 pt-3">
            <span className={fieldLabelClasses}>Send sample</span>
            {receivers.map((ch) => (
              <div
                key={ch.id}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1"
              >
                <span className="text-sm text-ink-80">
                  {channelLabel(ch)}
                  {ch.name.trim() && (
                    <span className="ml-2 text-xs text-ink-45">{CHANNEL_LABELS[ch.type]}</span>
                  )}
                </span>
                {/* Named per channel for assistive tech: the row's channel
                    name is a sibling, not part of the button's name. */}
                <AlertTest
                  channel={ch.id}
                  sample={sample}
                  ready
                  saving={saving}
                  ariaLabel={`Send sample to ${channelLabel(ch)}`}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}
