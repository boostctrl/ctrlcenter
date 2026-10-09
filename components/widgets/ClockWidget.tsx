import TimeWeather from "../TimeWeather";

// A standalone date + clock card — the header card's clock row on its own glass
// surface. Since 3.0 (#297) the header card's clock switch is its own; this
// widget always shows the clock, and hiding it is hiding the widget.
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
