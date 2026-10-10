// Sunrise and sunset for a place and a calendar date (#336): the standard
// sunrise equation (NOAA's simplified form), good to a minute or two, with
// no network — so a day/night theme schedule works offline and the same code
// runs on the server (first paint) and in the browser (the next switch).

export type SunTimes =
  // Both instants, as epoch milliseconds.
  | { kind: "normal"; sunrise: number; sunset: number }
  // The sun never sets (polar day) or never rises (polar night) that date.
  | { kind: "polar"; day: boolean };

const RAD = Math.PI / 180;
const J2000 = 2451545;
const MS_PER_DAY = 86400000;
// Civil sunrise/sunset: the sun's center 0.833° below the horizon (refraction
// and the solar disc).
const ALTITUDE = -0.833;
const OBLIQUITY = 23.4397;

const julianToMs = (j: number) => (j - 2440587.5) * MS_PER_DAY;

// `year`/`month` (1–12)/`day` are the calendar date at the place (its own time
// zone); longitude is east-positive.
export function sunTimes(
  year: number,
  month: number,
  day: number,
  latitude: number,
  longitude: number
): SunTimes {
  const lat = Math.min(89.9, Math.max(-89.9, latitude));
  const lon = Math.min(180, Math.max(-180, longitude));
  // Days since J2000 for the local date's noon, corrected for longitude.
  const noon = Date.UTC(year, month - 1, day, 12);
  const n = noon / MS_PER_DAY + 2440587.5 - J2000 + 0.0008;
  const jStar = n - lon / 360;
  const meanAnomaly = (357.5291 + 0.98560028 * jStar) % 360;
  const m = meanAnomaly * RAD;
  const center = 1.9148 * Math.sin(m) + 0.02 * Math.sin(2 * m) + 0.0003 * Math.sin(3 * m);
  const eclipticLon = ((meanAnomaly + center + 180 + 102.9372) % 360) * RAD;
  const transit = J2000 + jStar + 0.0053 * Math.sin(m) - 0.0069 * Math.sin(2 * eclipticLon);
  const declination = Math.asin(Math.sin(eclipticLon) * Math.sin(OBLIQUITY * RAD));
  const phi = lat * RAD;
  const cosHourAngle =
    (Math.sin(ALTITUDE * RAD) - Math.sin(phi) * Math.sin(declination)) /
    (Math.cos(phi) * Math.cos(declination));
  if (cosHourAngle >= 1) return { kind: "polar", day: false };
  if (cosHourAngle <= -1) return { kind: "polar", day: true };
  const hourAngle = Math.acos(cosHourAngle) / RAD / 360;
  return {
    kind: "normal",
    sunrise: Math.round(julianToMs(transit - hourAngle)),
    sunset: Math.round(julianToMs(transit + hourAngle)),
  };
}
