import type { Metadata } from "next";
import { readPublicConfig } from "@/lib/api-auth";
import { fetchForecast } from "@/lib/weather";
import WeatherDetails from "@/components/WeatherDetails";
import PageNav from "@/components/PageNav";
import FloatingNav from "@/components/FloatingNav";
import { navPages } from "@/lib/nav";

export const metadata: Metadata = { title: "Weather" };
export const dynamic = "force-dynamic";

export default async function WeatherPage() {
  const { config: site, isAdmin } = await readPublicConfig();
  const { settings } = site;
  const { weather } = settings;
  const initial = weather.enabled
    ? await fetchForecast(weather.latitude, weather.longitude, weather.units)
    : null;

  return (
    <>
      <main id="main-content" className="mx-auto flex min-h-screen w-full max-w-8xl flex-col gap-8 px-6 pt-12 pb-24 sm:px-10 lg:pt-16">
        <div>
          <PageNav current="weather" {...navPages(site, isAdmin)} />
          <h1 className="mt-3 text-3xl font-bold">Weather</h1>
        </div>

        {weather.enabled ? (
          <WeatherDetails initial={initial} />
        ) : (
          <p className="text-ink-50">
            The weather widget is turned off in settings.
          </p>
        )}
      </main>
      {settings.settingsButton && <FloatingNav {...navPages(site, isAdmin)} />}
    </>
  );
}
