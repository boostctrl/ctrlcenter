import { peekRateLimit, rateLimit, type RateLimitResult } from "./rate-limit";

// The budgets sign-in, the step-up confirmation and the password change share
// (#158, #392). Each route also throttles per client (clientKey), which stops
// one source; the global counters here stop a run spread over many.

export const WINDOW_MS = 5 * 60 * 1000;
// Attempts one client gets per window before its lockout (escalating, #369).
export const PER_CLIENT_MAX_ATTEMPTS = 5;

// Wrong passwords from every address together. Charged, and enforced, only
// after a wrong password: a correct one never touches it, so a stranger can't
// spend it to lock the real admin out of login (#158).
const GLOBAL_PASSWORD_KEY = "login:global";
export const GLOBAL_MAX_ATTEMPTS = 50;

// Wrong authentication codes from every address together. Only a caller who
// has the password reaches the code check, so only such a caller can spend
// this. Once it's spent, code checks pause for the window (longer each time,
// like a client lockout) rather than letting the six digits be worked through
// from many addresses at the password-hashing rate.
const GLOBAL_CODE_KEY = "login:global-totp";
export const GLOBAL_CODE_MAX_ATTEMPTS = 20;

// Charge one wrong password; `allowed: false` means the shared budget is spent
// and the caller answers 429.
export function chargeWrongPassword(): RateLimitResult {
  return rateLimit(GLOBAL_PASSWORD_KEY, GLOBAL_MAX_ATTEMPTS, WINDOW_MS);
}

// Charge one wrong code. True when this one used the budget up: the moment to
// say so, once.
export function chargeWrongCode(): boolean {
  const r = rateLimit(GLOBAL_CODE_KEY, GLOBAL_CODE_MAX_ATTEMPTS, WINDOW_MS, { escalate: true });
  return r.allowed && r.remaining === 0;
}

// Seconds until code checks resume; 0 while they're running.
export function codeChecksPausedFor(): number {
  const r = peekRateLimit(GLOBAL_CODE_KEY, GLOBAL_CODE_MAX_ATTEMPTS);
  return r.allowed ? 0 : r.retryAfterSeconds;
}
