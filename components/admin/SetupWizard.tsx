"use client";

// The first-run setup (#304): four short, skippable steps after the first
// admin sign-in on a fresh install — where you are, your first apps, status
// checks and alerts, a theme. Each step saves ordinary config through the
// usual admin APIs, so everything stays editable in admin Settings (or
// config.yaml) afterwards. Finishing or skipping records settings.setupComplete
// and the setup never shows again.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import type { Settings } from "@/lib/schema";
import { alertChannelSchema, ALERT_TYPES, type AlertType } from "@/lib/schema";
import type { ThemePack } from "@/lib/theme";
import { appNameFromUrl, parsePastedUrls } from "@/lib/setup";
import CitySearch from "./CitySearch";
import { Button, Hint, SelectField, TextArea, TextField, ToggleRow, fieldLabelClasses } from "./ui";
import { saveSettingsPatch } from "./settingsApi";
import { NO_ZONES, getBrowserZones, subscribeZonesNever } from "./settings/zones";

const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

const STEPS = ["Location and time", "Your first apps", "Status and alerts", "A theme"] as const;

// The example config's apps, for "start from a few examples": placeholders to
// point at your own services later, unmonitored until you do.
const EXAMPLE_APPS = [
  { name: "File Storage", subtitle: "Nextcloud", url: "https://files.example.com", icon: "nextcloud" },
  { name: "Password Manager", subtitle: "Vaultwarden", url: "https://vault.example.com", icon: "vaultwarden" },
  { name: "Media Server", subtitle: "Jellyfin", url: "https://media.example.com", icon: "jellyfin" },
  { name: "Photos", subtitle: "Immich", url: "https://photos.example.com", icon: "immich" },
  { name: "Service Status", subtitle: "Uptime Kuma", url: "https://status.example.com", icon: "uptime-kuma" },
  { name: "Web Search", subtitle: "SearXNG", url: "https://search.example.com", icon: "searxng" },
];

const ALERT_LABELS: Record<AlertType, string> = {
  generic: "A JSON webhook",
  discord: "Discord",
  slack: "Slack",
  ntfy: "ntfy",
};

type StepProps = {
  settings: Settings;
  // Save this step and move on; resolves to an error message, or null.
  onSave: (save: () => Promise<void>) => Promise<void>;
  saving: boolean;
};

export default function SetupWizard({ settings, packs }: { settings: Settings; packs: ThemePack[] }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  // Each new step's heading takes focus, so a screen reader hears where it is.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  async function finish(to: string) {
    setSaving(true);
    setError(null);
    try {
      await saveSettingsPatch({ setupComplete: true }, { fallback: "Couldn't finish the setup" });
      router.push(to);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't finish the setup");
      setSaving(false);
    }
  }

  const next = () => (step === STEPS.length - 1 ? finish("/") : setStep(step + 1));

  async function onSave(save: () => Promise<void>) {
    setSaving(true);
    setError(null);
    try {
      await save();
      setSaving(false);
      await next();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save that");
      setSaving(false);
    }
  }

  const props: StepProps = { settings, onSave, saving };

  return (
    <main id="main-content" className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 px-6 pt-12 pb-24">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Set up CtrlCenter</h1>
          <p className="mt-1 text-sm text-ink-60">
            A few quick choices to get your dashboard going. Skip anything — it&apos;s all in admin Settings later.
          </p>
        </div>
        <Button variant="ghost" type="button" disabled={saving} onClick={() => finish("/admin")}>
          Skip setup
        </Button>
      </div>

      <ol className="flex gap-2" aria-label="Setup steps">
        {STEPS.map((name, i) => (
          <li key={name} className="flex-1">
            <span
              aria-current={i === step ? "step" : undefined}
              className={`block h-1.5 rounded-full ${i <= step ? "bg-[var(--accent-from)]" : "bg-fg/15"}`}
            />
            <span className="sr-only">
              {name}
              {i < step ? " (done)" : ""}
            </span>
          </li>
        ))}
      </ol>

      <section aria-labelledby="setup-step-title" className="glass-card flex flex-col gap-5 p-6">
        <div>
          <p className="text-xs font-medium tracking-wide text-ink-55 uppercase">
            Step {step + 1} of {STEPS.length}
          </p>
          <h2 id="setup-step-title" ref={headingRef} tabIndex={-1} className="mt-1 text-xl font-semibold outline-none">
            {STEPS[step]}
          </h2>
        </div>
        {step === 0 && <LocationStep {...props} />}
        {step === 1 && <AppsStep {...props} />}
        {step === 2 && <AlertsStep {...props} />}
        {step === 3 && <ThemeStep {...props} packs={packs} />}
        {error && (
          <p role="alert" className="text-sm text-status-down">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3 border-t border-fg/10 pt-4">
          {step > 0 && (
            <Button variant="ghost" type="button" disabled={saving} onClick={() => setStep(step - 1)}>
              Back
            </Button>
          )}
          <span className="flex-1" />
          <Button variant="ghost" type="button" disabled={saving} onClick={next}>
            {step === STEPS.length - 1 ? "Skip and finish" : "Skip this step"}
          </Button>
          <Button type="submit" form="setup-step" disabled={saving}>
            {saving ? "Saving…" : step === STEPS.length - 1 ? "Save and finish" : "Save and continue"}
          </Button>
        </div>
      </section>
    </main>
  );
}

// Each step is a form with id "setup-step"; the footer's primary button
// submits it.
function StepForm({ onSubmit, children }: { onSubmit: () => void; children: React.ReactNode }) {
  return (
    <form
      id="setup-step"
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      {children}
    </form>
  );
}

function LocationStep({ settings, onSave }: StepProps) {
  // The browser's own zone (read after hydration, so the server's can't
  // differ from it), used unless one is typed or was already chosen.
  const detected = useSyncExternalStore(subscribeZonesNever, browserZone, () => "");
  const [timezone, setTimezone] = useState(settings.timezone !== "UTC" ? settings.timezone : "");
  const [place, setPlace] = useState<{ latitude: number; longitude: number; label: string } | null>(null);
  const [units, setUnits] = useState(settings.weather.units);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);
  const zones = useSyncExternalStore(subscribeZonesNever, getBrowserZones, () => NO_ZONES);

  function locateMe() {
    if (!navigator.geolocation) {
      setLocateError("This browser can't share its location — search for your city instead.");
      return;
    }
    setLocating(true);
    setLocateError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPlace({
          latitude: Math.round(pos.coords.latitude * 1e4) / 1e4,
          longitude: Math.round(pos.coords.longitude * 1e4) / 1e4,
          label: "Your current location",
        });
        setLocating(false);
      },
      () => {
        setLocateError("Couldn't get your location — search for your city instead.");
        setLocating(false);
      },
      { timeout: 10_000 }
    );
  }

  return (
    <StepForm
      onSubmit={() =>
        onSave(() =>
          saveSettingsPatch(
            {
              timezone: timezone.trim() || detected || "UTC",
              weather: {
                units,
                ...(place ? { enabled: true, latitude: place.latitude, longitude: place.longitude } : {}),
              },
            },
            { fallback: "Couldn't save the location" }
          )
        )
      }
    >
      <Hint>Used for the weather and for showing times in your time zone.</Hint>
      <div className="flex flex-col gap-2">
        <span className={fieldLabelClasses}>Where you are</span>
        <CitySearch onSelect={(latitude, longitude, label) => setPlace({ latitude, longitude, label })} />
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="ghost" size="sm" type="button" disabled={locating} onClick={locateMe}>
            {locating ? "Locating…" : "Use my location"}
          </Button>
          {place && (
            <span className="text-sm text-ink-70" aria-live="polite">
              {place.label} ({place.latitude}, {place.longitude})
            </span>
          )}
        </div>
        {locateError && <p className="text-xs text-status-down">{locateError}</p>}
      </div>
      <TextField
        label="Time zone"
        list="setup-zones"
        value={timezone}
        placeholder={detected || "UTC"}
        onChange={(e) => setTimezone(e.target.value)}
        hint="An IANA name like Europe/Berlin. Leave it empty to use this browser's, shown greyed out."
      />
      <datalist id="setup-zones">
        {zones.map((z) => (
          <option key={z} value={z} />
        ))}
      </datalist>
      <SelectField label="Units" value={units} onChange={(e) => setUnits(e.target.value as typeof units)}>
        <option value="metric">Metric (°C)</option>
        <option value="imperial">Imperial (°F)</option>
      </SelectField>
    </StepForm>
  );
}

async function addApp(app: Record<string, unknown>) {
  let res: Response;
  try {
    res = await fetch("/api/apps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(app),
    });
  } catch {
    throw new Error("Couldn't add the apps");
  }
  if (!res.ok) throw new Error(`Couldn't add ${String(app.name)}`);
}

function AppsStep({ onSave }: StepProps) {
  const [text, setText] = useState("");
  const [examples, setExamples] = useState(false);
  const urls = parsePastedUrls(text);
  return (
    <StepForm
      onSubmit={() =>
        onSave(async () => {
          for (const url of urls) await addApp({ name: appNameFromUrl(url), url });
          if (examples) for (const app of EXAMPLE_APPS) await addApp({ ...app, monitor: false });
        })
      }
    >
      <TextArea
        label="Paste your apps' addresses"
        rows={5}
        placeholder={"http://jellyfin.lan:8096\nhttps://nextcloud.example.com"}
        value={text}
        onChange={(e) => setText(e.target.value)}
        hint="One per line. Each becomes an app named after its address — rename it and pick an icon later."
      />
      {urls.length > 0 && (
        <p className="text-sm text-ink-70" aria-live="polite">
          {urls.length === 1 ? "1 app" : `${urls.length} apps`}: {urls.map(appNameFromUrl).join(", ")}
        </p>
      )}
      <ToggleRow
        label="Also add a few examples"
        hint="Nextcloud, Jellyfin, Immich and friends, at placeholder addresses to change later."
        checked={examples}
        onChange={setExamples}
      />
    </StepForm>
  );
}

function AlertsStep({ settings, onSave }: StepProps) {
  const [statusChecks, setStatusChecks] = useState(settings.statusChecks);
  const [format, setFormat] = useState<AlertType>("generic");
  const [url, setUrl] = useState("");
  return (
    <StepForm
      onSubmit={() =>
        onSave(() =>
          saveSettingsPatch(
            {
              statusChecks,
              ...(statusChecks && url.trim()
                ? {
                    alerts: {
                      enabled: true,
                      channels: [
                        ...settings.alerts.channels,
                        alertChannelSchema.parse({ id: "setup-webhook", type: "webhook", format, url: url.trim() }),
                      ],
                    },
                  }
                : {}),
            },
            { fallback: "Couldn't save the status settings" }
          )
        )
      }
    >
      <ToggleRow
        label="Status checks"
        hint="The server checks each app's address and shows whether it's up. Leave off if your apps aren't reachable from it."
        checked={statusChecks}
        onChange={setStatusChecks}
      />
      {statusChecks && (
        <div className="flex flex-col gap-3">
          <Hint>Optionally, get told when an app goes down — more channels (email, Telegram…) are in Settings.</Hint>
          <SelectField label="Send alerts to" value={format} onChange={(e) => setFormat(e.target.value as AlertType)}>
            {ALERT_TYPES.map((t) => (
              <option key={t} value={t}>
                {ALERT_LABELS[t]}
              </option>
            ))}
          </SelectField>
          <TextField
            label="Webhook URL"
            type="url"
            placeholder="https://…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            hint="Leave empty for no alerts."
          />
        </div>
      )}
    </StepForm>
  );
}

function ThemeStep({ settings, onSave, packs }: StepProps & { packs: ThemePack[] }) {
  const [chosen, setChosen] = useState(settings.theme.preset ?? "");
  return (
    <StepForm
      onSubmit={() => {
        const pack = packs.find((p) => p.name === chosen);
        if (!pack) return void onSave(async () => {});
        // As admin Settings → General applies a pack: both modes from it.
        return void onSave(() =>
          saveSettingsPatch(
            {
              theme: {
                ...settings.theme,
                preset: pack.name,
                design: pack.design,
                scene: pack.scene,
                accentFrom: pack.dark.accentFrom,
                accentTo: pack.dark.accentTo,
                accentFromLight: undefined,
                accentToLight: undefined,
                background: pack.dark.background,
                foreground: pack.dark.foreground,
                presetLight: undefined,
                designLight: pack.designLight,
                sceneLight: pack.sceneLight,
                backgroundLight: pack.light.background,
                foregroundLight: pack.light.foreground,
                tune: pack.tune,
                tuneLight: undefined,
                sceneIntensity: undefined,
                sceneMotion: undefined,
                sceneIntensityLight: undefined,
                sceneMotionLight: undefined,
                font: pack.font ?? settings.theme.font,
                headingFont: pack.headingFont,
                headingFontLight: undefined,
                density: undefined,
                densityLight: undefined,
                status: pack.status,
                statusLight: pack.statusLight,
                wallpaper: pack.wallpaper,
                wallpaperLight: pack.wallpaperLight,
              },
            },
            { fallback: "Couldn't save the theme" }
          )
        );
      }}
    >
      <Hint>The look everyone sees. Visitors can still pick their own in their settings.</Hint>
      <div role="radiogroup" aria-label="Theme" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {packs.map((p) => (
          <button
            key={p.name}
            type="button"
            role="radio"
            aria-checked={chosen === p.name}
            onClick={() => setChosen(p.name)}
            className={`flex flex-col gap-2 rounded-xl border p-2 text-left text-sm transition-colors ${
              chosen === p.name ? "border-[var(--accent-from)] ring-2 ring-[var(--accent-from)]/40" : "border-fg/10 hover:border-fg/30"
            }`}
          >
            <span aria-hidden className="flex h-10 overflow-hidden rounded-lg">
              <span className="flex-1" style={{ background: p.dark.background }} />
              <span
                className="flex-1"
                style={{ background: `linear-gradient(135deg, ${p.dark.accentFrom}, ${p.dark.accentTo})` }}
              />
              <span className="flex-1" style={{ background: p.light.background }} />
            </span>
            <span className="font-medium text-ink-80">{p.name}</span>
          </button>
        ))}
      </div>
    </StepForm>
  );
}
