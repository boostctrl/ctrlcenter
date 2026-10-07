"use client";

import type { Settings } from "@/lib/schema";
import { ANNOUNCEMENT_TONES, STATUS_ANNOUNCEMENT_KINDS } from "@/lib/schema";
import { STATUS_ANNOUNCEMENT_KIND_META, announcementState } from "@/lib/status-announcements";
import { useNow } from "../../useNow";
import { AddButton, Card, Hint, RemoveButton, SelectField, TextArea, TextField, ToggleRow, controlClasses, fieldLabelClasses, subCardClasses } from "../ui";
import { ChipGroup } from "@/components/ChipGroup";
import { STATUS_STATE_LABELS, TONE_LABELS } from "./constants";
import { isoToLocalInput, localInputToIso } from "./datetime";
import type { SettingsDraft } from "./useSettingsDraft";

export default function AnnouncementsSection({ d }: { d: SettingsDraft }) {
  const {
    announcement,
    updateAnnouncement,
    statusAnnouncements,
    updateStatusAnnouncement,
    addStatusAnnouncement,
    removeStatusAnnouncement,
  } = d;
  // A ticking clock so each announcement's derived state chip (Active /
  // Scheduled / Expired) stays current without a reload.
  const now = useNow(30_000);
  return (
    <>
      <Card
        title="Site-wide banner"
        intro="A banner across the top of every page — maintenance windows, notices, a heads-up for the household. Turn it on, write the message, and it shows site-wide until you turn it off."
        toggle={{
          checked: announcement.enabled,
          onChange: (enabled) => updateAnnouncement({ enabled }),
        }}
      >
        <TextArea
          label="Message"
          value={announcement.message}
          onChange={(e) => updateAnnouncement({ message: e.target.value })}
          rows={3}
          placeholder={"**Maintenance tonight** 10–11pm — [status](https://…)"}
          hint="Supports inline **bold**, *italic*, `code` and [links](https://…) (http/https only). Raw HTML is shown as plain text, never rendered."
        />

        <SelectField
          label="Tone"
          value={announcement.tone}
          onChange={(e) =>
            updateAnnouncement({
              tone: e.target.value as Settings["announcement"]["tone"],
            })
          }
        >
          {ANNOUNCEMENT_TONES.map((t) => (
            <option key={t} value={t}>
              {TONE_LABELS[t]}
            </option>
          ))}
        </SelectField>

        <ToggleRow
          label="Dismissible"
          hint="Let visitors close it; it returns if you change the message."
          checked={announcement.dismissible}
          onChange={(dismissible) => updateAnnouncement({ dismissible })}
        />
      </Card>

      <Card
        title="Status page announcements"
        intro="Maintenance windows and upcoming changes, posted on the status page. An entry with a start time in the future shows as scheduled; once its end time passes it stops showing. Independent of the status checks — a notice appears even with checks off."
      >
        <div className="flex flex-col gap-3">
          {statusAnnouncements.length === 0 && (
            <Hint>
              No announcements yet. Add one to post a maintenance window or
              notice on the status page.
            </Hint>
          )}
          {statusAnnouncements.map((a, i) => {
            const state = announcementState(a, now);
            return (
              <div
                key={a.id}
                className={`${subCardClasses} flex flex-col gap-3 p-4`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-fg/60">
                      Announcement {i + 1}
                    </span>
                    <span className="rounded-full bg-fg/10 px-2 py-0.5 text-[0.7rem] font-medium text-fg/60">
                      {STATUS_STATE_LABELS[state]}
                    </span>
                  </div>
                  <RemoveButton
                    label={`Remove announcement ${i + 1}`}
                    onClick={() => removeStatusAnnouncement(i)}
                  />
                </div>

                <TextField
                  label="Title"
                  value={a.title}
                  onChange={(e) =>
                    updateStatusAnnouncement(i, { title: e.target.value })
                  }
                />

                <TextArea
                  label="Message"
                  value={a.body}
                  onChange={(e) =>
                    updateStatusAnnouncement(i, { body: e.target.value })
                  }
                  rows={2}
                  placeholder={"Upgrading the NAS 10–11pm — some services may blip. [details](https://…)"}
                  hint="Supports inline **bold**, *italic*, `code` and [links](https://…) (http/https only). Raw HTML is shown as plain text."
                />

                <div className="flex flex-col gap-1.5">
                  <span className={fieldLabelClasses}>Kind</span>
                  <ChipGroup
                    label="Announcement kind"
                    equal
                    options={STATUS_ANNOUNCEMENT_KINDS.map((k) => ({
                      value: k,
                      label: STATUS_ANNOUNCEMENT_KIND_META[k].label,
                    }))}
                    value={a.kind}
                    onChange={(kind) => updateStatusAnnouncement(i, { kind })}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1.5 text-sm">
                    <span className={fieldLabelClasses}>Starts (optional)</span>
                    <input
                      type="datetime-local"
                      value={isoToLocalInput(a.startsAt)}
                      onChange={(e) =>
                        updateStatusAnnouncement(i, {
                          startsAt: localInputToIso(e.target.value),
                        })
                      }
                      className={controlClasses}
                    />
                  </label>
                  <label className="flex flex-col gap-1.5 text-sm">
                    <span className={fieldLabelClasses}>Ends (optional)</span>
                    <input
                      type="datetime-local"
                      value={isoToLocalInput(a.endsAt)}
                      onChange={(e) =>
                        updateStatusAnnouncement(i, {
                          endsAt: localInputToIso(e.target.value),
                        })
                      }
                      className={controlClasses}
                    />
                  </label>
                </div>
              </div>
            );
          })}
          <AddButton onClick={addStatusAnnouncement}>
            + Add announcement
          </AddButton>
        </div>
        <Hint>
          Leave both times empty to show a notice until you remove it. Times
          use this browser&apos;s time zone; visitors see them in their own.
        </Hint>
      </Card>
    </>
  );
}
