"use client";

import { DESIGN_NAMES } from "./constants";
import { TuneFields } from "./TuneFields";
import type { ThemeDraft } from "./useThemeDraft";

// Fine-tune (#326): sliders layered over the chosen design. The design stays
// the recipe; each slider scales one of its tokens, so switching design keeps
// the tune and "Reset to the design" returns to its own values.
export default function TuneTab({ d }: { d: ThemeDraft }) {
  const { designFor, tuneFor, setTune, editMode } = d;
  const design = DESIGN_NAMES[designFor(editMode)];
  return (
    <div role="tabpanel" id="tb-panel-tune" aria-labelledby="tb-tab-tune" className="space-y-4">
      <p className="text-xs text-ink-40">
        Adjust the {design} design of your {editMode} theme — each slider scales one
        part of it, and 100% is the design as drawn. Saved with your theme.
      </p>
      <TuneFields
        value={tuneFor(editMode)}
        onChange={(tune) => setTune(tune, editMode)}
        idPrefix={`tb-tune-${editMode}`}
      />
    </div>
  );
}
