// What a provider sign-in that didn't work says (#504), on the sign-in
// form and in the confirmation dialog. Client-safe.
export function oidcFailureMessage(error: string | null | undefined, name?: string | null): string {
  switch (error) {
    case "off":
      return "Signing in through a provider is turned off.";
    case "expired":
      return "The sign-in took too long. Try again.";
    case "denied":
      return "The provider didn't sign you in.";
    case "name":
      return "The provider didn't give a sign-in name CtrlCenter can use.";
    case "no-account":
      return name
        ? `There's no account named ${name} here. Ask an admin to add one.`
        : "There's no account with that name here. Ask an admin to add one.";
    case "disabled":
      return "That account is disabled.";
    case "mismatch":
      return "That was a different account from the one signed in here.";
    case "no-header":
      return "Your reverse proxy didn't say who you are, or CtrlCenter doesn't trust it yet.";
    default:
      return "Couldn't sign in through the provider. Try again, or use your password.";
  }
}

// The provider's sign-in in a popup: open it, and settle with whether it
// signed in (or confirmed). The popup's last page reports on a
// BroadcastChannel and by postMessage (lib/oidc-responses.ts). Resolves
// { ok: false, error: "closed" } when the window is shut first, and
// "blocked" when it couldn't open.
export function providerPopup(purpose: "signin" | "reauth"): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const w = window.open(`/api/auth/oidc/start?purpose=${purpose}&popup=1`, "ctrlcenter-oidc", "popup,width=520,height=700");
    if (!w) {
      resolve({ ok: false, error: "blocked" });
      return;
    }
    let channel: BroadcastChannel | null = null;
    const done = (result: { ok: boolean; error?: string }) => {
      window.removeEventListener("message", onMessage);
      channel?.close();
      clearInterval(timer);
      resolve(result);
    };
    const read = (data: unknown) => {
      const d = data as { type?: unknown; ok?: unknown; error?: unknown } | null;
      if (d?.type !== "ctrlcenter:oidc") return;
      done({ ok: d.ok === true, ...(typeof d.error === "string" ? { error: d.error } : {}) });
    };
    const onMessage = (e: MessageEvent) => {
      if (e.origin === window.location.origin) read(e.data);
    };
    window.addEventListener("message", onMessage);
    try {
      channel = new BroadcastChannel("ctrlcenter-oidc");
      channel.onmessage = (e) => read(e.data);
    } catch {
      // postMessage alone, then.
    }
    const timer = setInterval(() => {
      if (w.closed) done({ ok: false, error: "closed" });
    }, 500);
  });
}
