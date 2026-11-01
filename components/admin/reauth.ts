"use client";

// Step-up re-authentication on the client (#366). A sensitive route answers
// 403 with `reauthRequired` when the session's credentials haven't been
// proved recently; fetchWithReauth catches that, asks the mounted
// <ReauthDialog> to collect the password (and code), posts /api/reauth, and
// retries the request once. Call sites keep plain fetch semantics.
//
// The dialog registers itself here rather than through a context, so the
// helpers in plain modules (settingsApi, the monitor actions) can use it
// without a provider threading through every page.

// What the dialog is for: a step-up confirmation (403 reauthRequired), or a
// fresh sign-in after the session ended or idled out (401, #399), which
// keeps the admin's draft and retries the save once they're back in.
export type ReauthMode = "confirm" | "signin";
type Prompt = (totpRequired: boolean, mode: ReauthMode) => Promise<boolean>;

let prompt: Prompt | null = null;
let pending: Promise<boolean> | null = null;

export function registerReauthPrompt(p: Prompt | null): void {
  prompt = p;
}

// Ask the admin to confirm their credentials. Concurrent callers (two
// autosaves in flight) share one dialog. False when there's no dialog
// mounted or the admin cancelled.
export function requestReauth(totpRequired = false, mode: ReauthMode = "confirm"): Promise<boolean> {
  if (!prompt) return Promise.resolve(false);
  if (!pending) {
    pending = prompt(totpRequired, mode).finally(() => {
      pending = null;
    });
  }
  return pending;
}

type ReauthBody = { reauthRequired?: boolean; totpRequired?: boolean };

export async function fetchWithReauth(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  // The session is gone (signed out elsewhere, idled out, #399): ask for the
  // password again through the same dialog and retry, so an edit made after
  // the timeout isn't lost on the next reload.
  if (res.status === 401) {
    const ok = await requestReauth(false, "signin");
    if (!ok) return res;
    return fetch(input, init);
  }
  if (res.status !== 403) return res;
  const body = (await res
    .clone()
    .json()
    .catch(() => null)) as ReauthBody | null;
  if (!body?.reauthRequired) return res;
  const ok = await requestReauth(body.totpRequired === true);
  if (!ok) return res;
  return fetch(input, init);
}
