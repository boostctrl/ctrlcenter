// Signing out, from any of the three places that offer it (the portal, the
// corner menu, the account page): the session ends on the server, then a
// full page load as a visitor — or, when the session came from a provider
// set to sign out there too (#504), on to the provider's sign-out page,
// which brings the browser back here.
export async function signOut(): Promise<void> {
  let next = "/";
  try {
    const res = await fetch("/api/logout", { method: "POST" });
    const body = (await res.json().catch(() => null)) as { redirect?: unknown } | null;
    if (typeof body?.redirect === "string" && /^https?:\/\//i.test(body.redirect)) next = body.redirect;
  } catch {
    // Signed out or not, the page reloads as whatever it now is.
  }
  // A full load on purpose: it drops the client state and router cache a
  // soft navigation would keep alive after sign-out.
  window.location.href = next;
}
