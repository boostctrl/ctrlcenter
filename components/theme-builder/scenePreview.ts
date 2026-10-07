import type { SceneId } from "@/lib/theme";

// A small representative gradient for each scene's picker swatch, recolored live
// by the active accent. The base is the live surface (`var(--background)`), so
// every swatch tracks the current light/dark mode.
export function scenePreview(id: SceneId, from: string, to: string): string {
  const mix = (c: string, pct: number) =>
    `color-mix(in srgb, ${c} ${pct}%, transparent)`;
  const bg = "var(--background)";
  switch (id) {
    case "abyss":
      return `radial-gradient(120% 90% at 50% -10%, ${from}, transparent 60%), ${bg}`;
    case "nebula":
      return `radial-gradient(45% 55% at 22% 28%, ${from}, transparent 60%), radial-gradient(50% 60% at 75% 68%, ${to}, transparent 60%), radial-gradient(40% 50% at 55% 45%, ${from}, transparent 65%), radial-gradient(35% 45% at 40% 80%, ${to}, transparent 65%), ${bg}`;
    case "grid":
      return `linear-gradient(to top, ${mix(from, 50)}, transparent 55%), repeating-linear-gradient(90deg, ${mix(from, 55)} 0 1px, transparent 1px 9px), repeating-linear-gradient(0deg, ${mix(from, 55)} 0 1px, transparent 1px 9px), ${bg}`;
    case "starfield":
      return `linear-gradient(54deg, transparent 48%, ${mix(from, 45)} 49% 51%, transparent 52%), radial-gradient(1.5px 1.5px at 22% 32%, ${from}, transparent), radial-gradient(2px 2px at 50% 80%, ${from}, transparent), radial-gradient(1.5px 1.5px at 62% 58%, ${to}, transparent), radial-gradient(2px 2px at 82% 26%, ${from}, transparent), radial-gradient(1.5px 1.5px at 42% 78%, ${to}, transparent), ${bg}`;
    case "traces":
      return [
        `radial-gradient(circle, ${from} 55%, transparent 60%) 12% 40% / 7px 7px no-repeat`,
        `radial-gradient(circle, ${to} 55%, transparent 60%) 84% 78% / 7px 7px no-repeat`,
        `linear-gradient(${mix(from, 55)}, ${mix(from, 55)}) 12% 40% / 44% 2px no-repeat`,
        `linear-gradient(${mix(from, 55)}, ${mix(from, 55)}) 56% 40% / 2px 40% no-repeat`,
        `linear-gradient(${mix(to, 50)}, ${mix(to, 50)}) 40% 78% / 44% 2px no-repeat`,
        bg,
      ].join(", ");
    case "rays":
      return `repeating-conic-gradient(from 0deg at 50% -12%, ${mix(from, 65)} 0 3deg, transparent 3deg 12deg), ${bg}`;
    case "waves":
      return `linear-gradient(to top, ${mix(from, 52)}, transparent 45%), linear-gradient(to top, ${mix(to, 32)}, transparent 65%), ${bg}`;
    case "dots":
      return `radial-gradient(${mix(from, 70)} 1px, transparent 1.5px) 0 0 / 6px 6px, ${bg}`;
    case "horizon":
      return `linear-gradient(${mix(from, 90)}, ${mix(from, 90)}) 0 62% / 100% 1px no-repeat, radial-gradient(circle at 50% 68%, ${from}, ${mix(to, 55)} 32%, transparent 52%), linear-gradient(to top, ${mix(to, 25)} 38%, transparent 38%), ${bg}`;
    case "orbit":
      return `radial-gradient(circle at 72% 34%, ${from} 4%, transparent 5.5%, transparent 17%, ${mix(from, 70)} 18%, transparent 19.5%, transparent 37%, ${mix(to, 55)} 38%, transparent 39.5%, transparent 57%, ${mix(from, 45)} 58%, transparent 59.5%), ${bg}`;
    case "peaks":
      return `linear-gradient(155deg, transparent 52%, ${mix(to, 30)} 52.5%), linear-gradient(205deg, transparent 55%, ${mix(from, 45)} 55.5%), linear-gradient(160deg, transparent 68%, ${mix(from, 65)} 68.5%), ${bg}`;
    case "rain":
      return `repeating-linear-gradient(100deg, transparent 0 5px, ${mix(from, 55)} 5px 6px, transparent 6px 13px, ${mix(to, 40)} 13px 14px), ${bg}`;
    case "fireflies":
      return `radial-gradient(4px 4px at 24% 38%, ${from}, transparent), radial-gradient(3px 3px at 64% 26%, ${to}, transparent), radial-gradient(4.5px 4.5px at 82% 66%, ${from}, transparent), radial-gradient(3px 3px at 44% 74%, ${to}, transparent), radial-gradient(2.5px 2.5px at 12% 72%, ${from}, transparent), ${bg}`;
    case "blueprint":
      return `radial-gradient(circle at 70% 42%, transparent 26%, ${mix(to, 70)} 27%, transparent 29%), repeating-linear-gradient(90deg, ${mix(from, 35)} 0 1px, transparent 1px 7px), repeating-linear-gradient(0deg, ${mix(from, 35)} 0 1px, transparent 1px 7px), ${bg}`;
    case "prisms":
      return `conic-gradient(from 205deg at 30% 42%, ${mix(from, 60)} 0 55deg, transparent 55deg), conic-gradient(from 20deg at 68% 64%, ${mix(to, 50)} 0 48deg, transparent 48deg), conic-gradient(from 120deg at 84% 22%, ${mix(from, 40)} 0 60deg, transparent 60deg), ${bg}`;
    case "petals":
      return `radial-gradient(5px 3px at 22% 30%, ${from} 70%, transparent), radial-gradient(4px 2.5px at 46% 62%, ${mix(from, 75)} 70%, transparent), radial-gradient(5px 3px at 68% 26%, ${to} 70%, transparent), radial-gradient(4px 2.5px at 84% 70%, ${mix(from, 70)} 70%, transparent), radial-gradient(4.5px 3px at 32% 82%, ${mix(to, 70)} 70%, transparent), radial-gradient(4px 2.5px at 58% 44%, ${mix(from, 60)} 70%, transparent), ${bg}`;
    case "comets":
      return `radial-gradient(2.5px 2.5px at 30% 38%, ${from}, transparent), linear-gradient(150deg, transparent 30%, ${mix(from, 65)} 36%, transparent 39%) no-repeat 0 0 / 62% 76%, radial-gradient(2px 2px at 72% 64%, ${to}, transparent), linear-gradient(150deg, transparent 56%, ${mix(to, 50)} 62%, transparent 65%) no-repeat 40% 100% / 60% 100%, ${bg}`;
    case "aurora":
    default:
      return `radial-gradient(60% 70% at 30% 20%, ${from}, transparent 60%), radial-gradient(60% 70% at 75% 80%, ${to}, transparent 60%), ${bg}`;
  }
}
