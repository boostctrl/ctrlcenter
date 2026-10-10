"use client";

import { FONTS, fontVar } from "@/lib/fonts";
import { DENSITIES } from "@/lib/theme";
import { ChipGroup } from "../ChipGroup";
import { OptionCard } from "./OptionCard";
import type { ThemeDraft } from "./useThemeDraft";

export default function FontTab({ d }: { d: ThemeDraft }) {
  const {
    fontFor,
    setFont,
    headingFontFor,
    setHeadingFont,
    densityFor,
    setDensity,
    editMode,
  } = d;
  const heading = headingFontFor(editMode);
  const density = densityFor(editMode);
  return (
    <div
      role="tabpanel"
      id="tb-panel-font"
      aria-labelledby="tb-tab-font"
      className="space-y-3"
    >
      <p className="text-xs text-ink-40">
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
              className="block text-2xl leading-tight text-ink-90"
              style={{ fontFamily: fontVar(f.id) }}
              aria-hidden
            >
              Ag
            </span>
          </OptionCard>
        ))}
      </div>

      {/* The heading face (#330): h1–h3 in their own font, or the body's. */}
      <div className="space-y-2 border-t border-fg/10 pt-4">
        <div>
          <span className="text-[10px] font-semibold tracking-[0.15em] text-ink-45 uppercase">
            Headings
          </span>
          <p className="text-xs text-ink-40">
            A separate face for titles and section headings, or the body font.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <OptionCard
            selected={heading === null}
            onClick={() => setHeadingFont("body", editMode)}
            name="Body font"
            title="Headings use the body font"
          >
            <span className="block text-2xl leading-tight text-ink-90" aria-hidden>
              Ag
            </span>
          </OptionCard>
          {FONTS.map((f) => (
            <OptionCard
              key={f.id}
              selected={heading === f.id}
              onClick={() => setHeadingFont(f.id, editMode)}
              name={f.name}
              title={f.name}
              nameStyle={{ fontFamily: fontVar(f.id) }}
            >
              <span
                className="block text-2xl leading-tight font-bold text-ink-90"
                style={{ fontFamily: fontVar(f.id) }}
                aria-hidden
              >
                Ag
              </span>
            </OptionCard>
          ))}
        </div>
      </div>

      {/* Density (#330): every padding and gap scales, text doesn't. */}
      <div className="space-y-2 border-t border-fg/10 pt-4">
        <div>
          <span className="text-[10px] font-semibold tracking-[0.15em] text-ink-45 uppercase">
            Density
          </span>
          <p className="text-xs text-ink-40">
            {DENSITIES.find((x) => x.id === density)?.description}. Paddings and gaps scale;
            text keeps its size.
          </p>
        </div>
        <ChipGroup
          label="Density"
          fit
          options={DENSITIES.map((x) => ({ value: x.id, label: x.name }))}
          value={density}
          onChange={(v) => setDensity(v, editMode)}
        />
      </div>
    </div>
  );
}
