"use client";

import { SCENES } from "@/lib/theme";
import { OptionCard } from "./OptionCard";
import { scenePreview } from "./scenePreview";
import type { ThemeDraft } from "./useThemeDraft";

export default function SceneTab({ d }: { d: ThemeDraft }) {
  const {
    sceneFor,
    setScene,
    editMode,
    sceneFrom,
    sceneTo,
  } = d;
  return (
    <div
      role="tabpanel"
      id="tb-panel-scene"
      aria-labelledby="tb-tab-scene"
      className="space-y-3"
    >
      <p className="text-xs text-ink-40">
        The animated backdrop behind your {editMode} theme.
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {SCENES.map((s) => (
          <OptionCard
            key={s.id}
            selected={sceneFor(editMode) === s.id}
            onClick={() => setScene(s.id, editMode)}
            name={s.name}
            desc={s.description}
            title={s.description}
          >
            <span
              className="block h-10 w-full overflow-hidden rounded-md ring-1 ring-fg/10"
              style={{
                background: scenePreview(s.id, sceneFrom, sceneTo),
              }}
              aria-hidden
            />
          </OptionCard>
        ))}
      </div>
    </div>
  );
}
