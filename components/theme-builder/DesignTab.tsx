"use client";

import { DESIGNS } from "@/lib/theme";
import { OptionCard } from "./OptionCard";
import type { ThemeDraft } from "./useThemeDraft";

export default function DesignTab({ d }: { d: ThemeDraft }) {
  const {
    designFor,
    setDesign,
    activeAccent,
    editMode,
  } = d;
  return (
    <div
      role="tabpanel"
      id="tb-panel-design"
      aria-labelledby="tb-tab-design"
      className="space-y-3"
    >
      <p className="text-xs text-fg/40">
        How cards &amp; panels are drawn — the surface style of your{" "}
        {editMode} theme.
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {DESIGNS.map((d) => (
          <OptionCard
            key={d.id}
            selected={designFor(editMode) === d.id}
            onClick={() => setDesign(d.id, editMode)}
            name={d.name}
            desc={d.description}
            title={d.description}
          >
            <span
              className={`pointer-events-none block ${d.id === "glass" ? "" : `design-${d.id}`}`}
            >
              <span className="glass-card flex h-10 w-full items-center justify-center">
                <span
                  className="h-1.5 w-9 rounded-full"
                  style={{
                    backgroundImage: `linear-gradient(to right, ${activeAccent.from}, ${activeAccent.to})`,
                  }}
                  aria-hidden
                />
              </span>
            </span>
          </OptionCard>
        ))}
      </div>
    </div>
  );
}
