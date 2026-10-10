// Plain number formatting shared by server and client code (the home grid's
// System Stats, the Monitor tiles, and the board tiles built on the server,
// #301). No React, no "use client", so a server module can call these.

// "3.2 GB of 16 GB" style figures. Binary units (GiB semantics) shown with the
// everyday labels, one decimal under 10.
export function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let value = bytes;
  let u = 0;
  while (value >= 1024 && u < units.length - 1) {
    value /= 1024;
    u++;
  }
  const rounded = value >= 10 || u === 0 ? Math.round(value) : value.toFixed(1);
  return `${rounded} ${units[u]}`;
}

// "1.2 MB/s".
export function formatSpeed(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`;
}

// Compact remaining time: "1h 20m", "12m", "45s".
export function formatEta(seconds: number): string {
  if (seconds >= 3600) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  if (seconds >= 60) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds)}s`;
}
