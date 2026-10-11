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

type Prompt = (totpRequired: boolean) => Promise<boolean>;

let prompt: Prompt | null = null;
let pending: Promise<boolean> | null = null;

export function registerReauthPrompt(p: Prompt | null): void {
  prompt = p;
}

// Ask the admin to confirm their credentials. Concurrent callers (two
// autosaves in flight) share one dialog. False when there's no dialog
// mounted or the admin cancelled.
export function requestReauth(totpRequired = false): Promise<boolean> {
  if (!prompt) return Promise.resolve(false);
  if (!pending) {
    pending = prompt(totpRequired).finally(() => {
      pending = null;
    });
  }
  return pending;
}

type ReauthBody = { reauthRequired?: boolean; totpRequired?: boolean };

export async function fetchWithReauth(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
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
