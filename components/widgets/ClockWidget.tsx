import TimeWeather from "../TimeWeather";

// A standalone date + clock card — the header card's clock row on its own glass
// surface. Content is gated by the same components.clock flag as the combined
// card, so "Date & clock" hides the clock everywhere at once.
export default function ClockWidget({
  initialDate,
  showClock,
}: {
  initialDate: string;
  showClock: boolean;
}) {
  if (!showClock) return null;
  return (
    <div className="glass-card @container flex w-full flex-col overflow-hidden">
      <TimeWeather
        initialDate={initialDate}
        weatherEnabled={false}
        showClock
        initial={null}
      />
    </div>
  );
}
