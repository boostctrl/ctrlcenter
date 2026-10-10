"use client";

import type { ThemePack } from "@/lib/theme";
import { FONTS, fontVar, type FontId } from "@/lib/fonts";
import { DENSITIES, VISITOR_THEMING, type Density } from "@/lib/theme";
import { Card, ControlRow, SelectField, TextField, controlClasses, fieldLabelClasses } from "../ui";
import { ChipGroup } from "@/components/ChipGroup";
import IconField from "../IconField";
import { WallpaperFields } from "@/components/theme-builder/WallpaperFields";
import type { SettingsDraft } from "./useSettingsDraft";

export default function GeneralSection({
  d,
  themePacks,
}: {
  d: SettingsDraft;
  themePacks: ThemePack[];
}) {
  const {
    settings,
    setSettings,
    theme,
    updateTheme,
    applyDefaultTheme,
    applyLightDefault,
  } = d;
  return (
    <>
      <Card title="Site">
        <TextField
          label="Page title"
          value={settings.title}
          onChange={(e) => setSettings({ ...settings, title: e.target.value })}
        />
        <IconField
          label="Favicon (slug or image URL)"
          name={settings.title || "favicon"}
          value={settings.favicon}
          onChange={(favicon) => setSettings({ ...settings, favicon })}
        />
        <label className="flex flex-col gap-1.5 text-sm">
          <span className={fieldLabelClasses}>Default time zone</span>
          <input
            list="settings-tz"
            value={settings.timezone}
            onChange={(e) =>
              setSettings({ ...settings, timezone: e.target.value })
            }
            placeholder="Search a time zone…"
            className={controlClasses}
          />
        </label>
      </Card>

      <Card
        title="Appearance"
        intro={
          <>
            The site-wide default look visitors see before they customize
            their own. Pick a theme as the default; edit the themes themselves
            in the <span className="text-ink-60">Themes</span> tab.
          </>
        }
      >
        <ControlRow label="Default mode">
          <ChipGroup
            label="Default mode"
            capitalize
            shrink
            options={(["system", "light", "dark"] as const).map((m) => ({
              value: m,
              label: m,
            }))}
            value={theme.mode}
            onChange={(mode) => updateTheme({ mode })}
          />
        </ControlRow>

        {/* What visitors may change (#335); signed-in admins always may. */}
        <ControlRow
          label="Visitors can change"
          hint={VISITOR_THEMING.find((v) => v.id === settings.visitorTheming)?.description}
        >
          <ChipGroup
            label="What visitors can change about the theme"
            shrink
            options={VISITOR_THEMING.map((v) => ({ value: v.id, label: v.name }))}
            value={settings.visitorTheming}
            onChange={(visitorTheming) => setSettings({ ...settings, visitorTheming })}
          />
        </ControlRow>

        <SelectField
          label="Default theme"
          value={theme.preset ?? ""}
          onChange={(e) => applyDefaultTheme(e.target.value)}
        >
          {!theme.preset && (
            <option value="" disabled>
              Custom
            </option>
          )}
          {themePacks.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}
            </option>
          ))}
        </SelectField>

        <SelectField
          label="Light mode look"
          value={theme.presetLight ?? ""}
          onChange={(e) => applyLightDefault(e.target.value)}
          hint={
            <>
              Give light mode its own design, scene &amp; colors — leave on{" "}
              <span className="text-ink-60">Same as default</span> to mirror
              the theme above.
            </>
          }
        >
          <option value="">Same as default</option>
          {themePacks.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}
            </option>
          ))}
        </SelectField>

        {/* A pack may carry fonts (#330) but most don't, so the default font
            is its own control beside the pack selects above. Each option
            renders in its own face (every font is loaded up front in the
            root layout, so the variables exist here too). */}
        <SelectField
          label="Default font"
          value={theme.font}
          onChange={(e) => updateTheme({ font: e.target.value as FontId })}
          style={{ fontFamily: fontVar(theme.font) }}
        >
          {FONTS.map((f) => (
            <option key={f.id} value={f.id} style={{ fontFamily: fontVar(f.id) }}>
              {f.name}
            </option>
          ))}
        </SelectField>

        <SelectField
          label="Light mode font"
          value={theme.fontLight ?? ""}
          onChange={(e) =>
            updateTheme({
              fontLight: (e.target.value || undefined) as FontId | undefined,
            })
          }
          style={
            theme.fontLight
              ? { fontFamily: fontVar(theme.fontLight) }
              : undefined
          }
        >
          <option value="">Same as default</option>
          {FONTS.map((f) => (
            <option key={f.id} value={f.id} style={{ fontFamily: fontVar(f.id) }}>
              {f.name}
            </option>
          ))}
        </SelectField>

        {/* The heading face (#330): titles and section headings in their own
            font, or the body's. */}
        <SelectField
          label="Heading font"
          value={theme.headingFont ?? ""}
          onChange={(e) =>
            updateTheme({
              headingFont: (e.target.value || undefined) as FontId | undefined,
            })
          }
          style={theme.headingFont ? { fontFamily: fontVar(theme.headingFont) } : undefined}
        >
          <option value="">Same as the body font</option>
          {FONTS.map((f) => (
            <option key={f.id} value={f.id} style={{ fontFamily: fontVar(f.id) }}>
              {f.name}
            </option>
          ))}
        </SelectField>

        {/* The site wallpaper (#333): behind every visitor's scene, for both
            modes unless the light look has one of its own below. */}
        <details className="text-xs">
          <summary className="cursor-pointer text-ink-50 transition-colors hover:text-ink-80">
            Wallpaper{theme.wallpaper ? " · set" : ""}
          </summary>
          <div className="mt-2">
            <WallpaperFields
              value={theme.wallpaper ?? null}
              onChange={(wp) => updateTheme({ wallpaper: wp ?? undefined })}
              idPrefix="site-wallpaper"
              canUpload
              compact
            />
          </div>
        </details>
        <details className="text-xs">
          <summary className="cursor-pointer text-ink-50 transition-colors hover:text-ink-80">
            Light mode wallpaper{theme.wallpaperLight ? " · set" : ""}
          </summary>
          <div className="mt-2">
            <WallpaperFields
              value={theme.wallpaperLight ?? null}
              onChange={(wp) => updateTheme({ wallpaperLight: wp ?? undefined })}
              idPrefix="site-wallpaper-light"
              canUpload
              compact
            />
          </div>
        </details>

        <ControlRow label="Density">
          <ChipGroup
            label="Density"
            shrink
            options={DENSITIES.map((d) => ({ value: d.id, label: d.name }))}
            value={(theme.density ?? "comfortable") as Density}
            onChange={(density) =>
              updateTheme({ density: density === "comfortable" ? undefined : density })
            }
          />
        </ControlRow>

        {/* Preview of the default look's dark + light surfaces with the accent. */}
        <div className="grid grid-cols-2 gap-2">
          {(["dark", "light"] as const).map((m) => {
            const bg =
              m === "light"
                ? theme.backgroundLight ?? "#eceef3"
                : theme.background ?? "#06070d";
            return (
              <div
                key={m}
                className="flex h-12 items-end justify-start overflow-hidden rounded-lg p-1.5 ring-1 ring-fg/10"
                style={{
                  background: `radial-gradient(120% 100% at 50% -10%, ${theme.accentFrom}, transparent 60%), ${bg}`,
                }}
              >
                <span className="rounded bg-black/20 px-1 text-[9px] text-white/80 capitalize">
                  {m}
                </span>
              </div>
            );
          })}
        </div>
      </Card>
    </>
  );
}
