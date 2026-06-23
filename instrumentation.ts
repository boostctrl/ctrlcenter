// Next.js startup hook (runs once when the server process boots). Used to start
// the background uptime poller so /status history accrues independent of page
// views. Node runtime only — the poller uses fs and outbound fetch.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startStatusPoller } = await import("./lib/status-poller");
  startStatusPoller();
}
