// Next.js startup hook (runs once when the server process boots). Used to start
// the background uptime poller so /status history accrues independent of page
// views. Node runtime only — the poller uses fs and outbound fetch.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startStatusPoller } = await import("./lib/status-poller");
  startStatusPoller();
  await warnIfNoAdminPassword();
}

// A fresh install without ADMIN_PASSWORD can't be signed into; say so in the
// server log, where someone debugging "Invalid password" will look (#275).
async function warnIfNoAdminPassword() {
  try {
    const [{ readConfigInternal }, { adminPasswordConfigured, NO_PASSWORD_MESSAGE }, { log }] =
      await Promise.all([import("./lib/config"), import("./lib/auth"), import("./lib/log")]);
    const { auth } = await readConfigInternal();
    if (!adminPasswordConfigured(auth)) log.warn(NO_PASSWORD_MESSAGE);
  } catch {
    // An unreadable config surfaces on the first request; don't fail boot here.
  }
}
