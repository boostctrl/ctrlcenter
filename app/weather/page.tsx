import type { Metadata } from "next";
import { getSettings } from "@/lib/config";
import { fetchForecast } from "@/lib/weather";
import WeatherDetails from "@/components/WeatherDetails";
import BackHome from "@/components/BackHome";
import FloatingSettings from "@/components/FloatingSettings";

export const metadata: Metadata = { title: "Weather" };
export const dynamic = "force-dynamic";

export default async function WeatherPage() {
  const { weather, components } = await getSettings();
  const initial = weather.enabled
    ? await fetchForecast(weather.latitude, weather.longitude, weather.units)
    : null;

  return (
    <>
      <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-8 px-6 py-12 sm:px-10 lg:py-16">
        <div>
          <BackHome />
          <h1 className="mt-3 text-3xl font-bold">Weather</h1>
        </div>

        {weather.enabled ? (
          <WeatherDetails initial={initial} />
        ) : (
          <p className="text-fg/50">
            The weather widget is turned off in settings.
          </p>
        )}
      </main>
      {components.settingsButton && <FloatingSettings />}
    </>
  );
}
