// Time-of-day greeting. Lives in a plain module (no "use client") so it can be
// called from both the server Header and the client HeaderTime.
export function greetingFor(hour: number): string {
  if (hour < 5) return "Good night";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}
