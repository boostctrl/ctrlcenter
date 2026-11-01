// Next.js startup hook (runs once when the server process boots). Used to start
// the background uptime poller so /status history accrues independent of page
// views. Node runtime only — the poller uses fs and outbound fetch.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startStatusPoller } = await import("./lib/status-poller");
  startStatusPoller();
  await tightenConfigFiles();
  await logSecurityWarnings();
}

// Files beside the config made before #386 could be world-readable through
// the bind mount, and some are never rewritten (#408): tighten them once.
async function tightenConfigFiles() {
  try {
    const [{ CONFIG_FILE }, { tightenPrivateFiles }] = await Promise.all([
      import("./lib/config/store"),
      import("./lib/config/files"),
    ]);
    await tightenPrivateFiles(CONFIG_FILE);
  } catch {
    // Best effort; the files are still usable as they were.
  }
}

// The security checklist's red rows (#367), in the server log where someone
// setting the container up will look: a fresh install without ADMIN_PASSWORD
// can't be signed into (#275), two-factor authentication is off, the session
// secret fell back to the password, actions are on without the second
// factor. The rows that need a sign-in to judge (HTTPS, proxy hops) wait for
// Settings → Security.
async function logSecurityWarnings() {
  try {
    const [{ readConfigInternal }, { collectSecurityFacts, securityChecklist }, { log }] =
      await Promise.all([import("./lib/config"), import("./lib/security-checklist"), import("./lib/log")]);
    const config = await readConfigInternal();
    const rows = securityChecklist(await collectSecurityFacts(config, { sessions: false }));
    for (const row of rows) {
      if (row.level === "bad") log.warn(`${row.title}: ${row.detail}`);
    }
  } catch {
    // An unreadable config surfaces on the first request; don't fail boot here.
  }
}
