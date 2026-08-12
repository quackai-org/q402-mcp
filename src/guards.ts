/**
 * Shared guard module for q402_pay and q402_x402_fetch.
 *
 * Centralises:
 *   - maxAmountGuard   — per-call USD cap (pay + x402_fetch)
 *   - recipientGuard   — allowlist check  (pay only; x402_fetch intentionally excludes it)
 *   - Session accumulator + cap (x402_fetch only; pay does not count against it)
 *   - consent re-export (thin pass-through to consent.ts)
 */

import { ENV } from "./config.js";
export { checkConsent } from "./consent.js";

// Read env dynamically so test overrides to process.env are respected.
function dynEnv(key: string): string | undefined {
  return process.env[key] ?? (ENV as Record<string, string | undefined>)[key];
}

export function maxAmountGuard(amount: string, cap: number): void {
  // amount comes pre-validated as `\d+(\.\d+)?` - Number() is safe here for
  // a comparison against the per-call USD cap (the cap is intentionally a
  // small UI-friendly value, so float precision is irrelevant for the check).
  const numeric = Number(amount);
  if (!Number.isFinite(numeric)) {
    throw new Error(`unparseable amount "${amount}"`);
  }
  if (numeric > cap) {
    throw new Error(
      `amount $${amount} exceeds the per-call cap of $${cap}. ` +
        `Set Q402_MAX_AMOUNT_PER_CALL to a higher value if intentional.`,
    );
  }
}

export function recipientGuard(to: string, allow: string[]): void {
  if (allow.length === 0) return;
  if (!allow.includes(to.toLowerCase())) {
    throw new Error(
      `recipient ${to} is not in Q402_ALLOWED_RECIPIENTS. ` +
        "Either add this address to the allowlist or unset the env var to disable the guard.",
    );
  }
}

// Per-session cumulative spend accumulator (module-level, reset on process restart).
// Used by x402_fetch only; q402_pay does not count against this cap.
let _sessionSpendUsd = 0;

export function getSessionSpendUsd(): number { return _sessionSpendUsd; }
export function resetSessionSpendUsd(): void  { _sessionSpendUsd = 0; }

export function addSessionSpend(amount: number): void {
  _sessionSpendUsd += amount;
}

export function getSessionCapUsd(): number {
  const raw = dynEnv("Q402_X402_SESSION_CAP_USD");
  const n = raw !== undefined ? parseFloat(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 5;
}
