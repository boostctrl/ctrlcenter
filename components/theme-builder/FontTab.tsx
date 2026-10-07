"use client";

import { FONTS, fontVar } from "@/lib/fonts";
import { OptionCard } from "./OptionCard";
import type { ThemeDraft } from "./useThemeDraft";

export default function FontTab({ d }: { d: ThemeDraft }) {
  const {
    fontFor,
    setFont,
    editMode,
  } = d;
  return (
    <div
      role="tabpanel"
      id="tb-panel-font"
      aria-labelledby="tb-tab-font"
      className="space-y-3"
    >
      <p className="text-xs text-fg/40">
        The interface typeface of your {editMode} theme.
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {FONTS.map((f) => (
          <OptionCard
            key={f.id}
            selected={fontFor(editMode) === f.id}
            onClick={() => setFont(f.id, editMode)}
            name={f.name}
            title={f.name}
            nameStyle={{ fontFamily: fontVar(f.id) }}
          >
            <span
              className="block text-2xl leading-tight text-fg/90"
              style={{ fontFamily: fontVar(f.id) }}
              aria-hidden
            >
              Ag
            </span>
          </OptionCard>
        ))}
      </div>
    </div>
  );
}
