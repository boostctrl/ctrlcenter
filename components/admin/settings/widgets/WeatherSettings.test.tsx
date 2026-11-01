import { useState } from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { settingsSchema, type Settings } from "@/lib/schema";
import type { SettingsDraft } from "../useSettingsDraft";
import WeatherSettings from "./WeatherSettings";

// The card reads and writes only the settings of its draft.
function setup() {
  let latest: Settings = settingsSchema.parse({});
  function Harness() {
    const [settings, setSettings] = useState(latest);
    const d = {
      settings,
      setSettings: (next: Settings) => {
        latest = next;
        setSettings(next);
      },
    } as unknown as SettingsDraft;
    return <WeatherSettings d={d} />;
  }
  render(<Harness />);
  return { user: userEvent.setup(), stored: () => latest.weather };
}

const field = (name: string) => screen.getByLabelText(name) as HTMLInputElement;

// The coordinate fields used to parse every keystroke, so a longitude typed
// over the old one came out as something the server then rejected (#397).
describe("Weather coordinates keep what is typed (#397)", () => {
  it("keeps a longitude typed in full: -74.0 is -74", async () => {
    const { user, stored } = setup();
    const lon = field("Longitude");
    await user.clear(lon);
    await user.type(lon, "-74.0");
    expect(stored().longitude).toBe(-74);
    expect(stored().latitude).toBe(38.9072);
  });

  it("says the range for a longitude past 180, then moves it to the limit when left", async () => {
    const { user, stored } = setup();
    const lon = field("Longitude");
    await user.clear(lon);
    await user.type(lon, "200");
    const error = screen.getByRole("alert");
    expect(error.textContent).toBe("Enter a number from -180 to 180.");
    expect(lon.getAttribute("aria-invalid")).toBe("true");
    expect(lon.getAttribute("aria-describedby")).toBe(error.id);
    await user.tab();
    expect(stored().longitude).toBe(180);
    expect(lon.value).toBe("180");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
