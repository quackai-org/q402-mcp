/**
 * Client-side pre-check module: runs a trust-check on the counterparty
 * before every outgoing payment in live mode.
 *
 * Trigger policy (AC-D1):
 *   Live mode + not opted out + (first-time counterparty OR amount >= $1)
 *
 * Cache (AC-D2):
 *   Verdict cached 7 days per counterparty address. Cache hits are returned
 *   without triggering a second charge/settlement.
 *
 * Opt-out (AC-D3):
 *   Q402_DISABLE_PRECHECK=1 disables pre-check entirely.
 *
 * Free-basic-verdict fallback (AC-D4):
 *   Only in two edge cases:
 *   (a) Wallet balance covers the main transfer but NOT transfer + $0.02 fee.
 *   (b) Wallet holds a rail-supported non-USDC token (e.g. USDT) but no USDC
 *       to pay the fee.
 *   In both cases: degrade to free basic verdict, show upgrade hint, log
 *   degradation reason. The main transaction is NEVER blocked.
 *
 * Trial users with USDC pay normally — no blanket free-check for trial plans.
 */

/** Environment variable to disable pre-check globally (opt-out). */
export const PRECHECK_OPT_OUT_ENV = "Q402_DISABLE_PRECHECK";

/** Trust-check fee in USD (AC-D4 boundary value). */
export const PRECHECK_FEE_USD = 0.02;

/** Verdict cache TTL: 7 days in milliseconds. */
const VERDICT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface PrecheckVerdict {
  address: string;
  risk: "low" | "medium" | "high" | "unknown";
  flags: string[];
  /** True when the verdict came from a free-basic-verdict fallback (no charge). */
  isFree: boolean;
  /** Populated only when isFree=true. */
  degradationReason?: "exact_balance" | "no_usdc_rail";
  /** User-visible upgrade hint, present when isFree=true. */
  upgradeHint?: string;
}

export interface PrecheckResult {
  /** Whether the pre-check actually ran (false = skipped entirely). */
  ran: boolean;
  reason: "sandbox" | "opt_out" | "not_triggered" | "cached" | "paid" | "degraded_free" | "error";
  verdict?: PrecheckVerdict;
  /** True when the verdict was served from cache (no charge). */
  fromCache: boolean;
  /** True when a paid trust-check was performed and a charge occurred. */
  charged: boolean;
}

export interface PrecheckContext {
  mode: "sandbox" | "live";
  counterpartyAddress: string;
  /** USD-equivalent amount of the main transfer. */
  amountUsd: number;
  /**
   * Wallet's total USDC balance in USD. When undefined (unknown), case (a)
   * of the fee-affordability check is skipped — only case (b) applies.
   */
  walletUsdcBalanceUsd?: number;
  /** Token being used for the main transfer. Used for case (b) detection. */
  payToken: string;
  /**
   * Whether the wallet has any USDC available for fees.
   * When payToken is "USDC" this is implicitly true; otherwise it must be
   * provided by the caller. Defaults to true when undefined (conservative —
   * avoids spurious free-fallback when we can't determine balance).
   */
  hasUsdc?: boolean;
}

/** Injected trust-check function type. Resolves with risk + flags on success. */
export type TrustCheckFn = (
  address: string,
) => Promise<Pick<PrecheckVerdict, "risk" | "flags">>;

// ── Internal state (module-level, reset in tests via resetPrecheckState) ───────

interface VerdictEntry {
  verdict: PrecheckVerdict;
  expiresAt: number;
}

const _verdictCache = new Map<string, VerdictEntry>();

export function getVerdictFromCache(address: string): PrecheckVerdict | null {
  const key = address.toLowerCase();
  const entry = _verdictCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    _verdictCache.delete(key);
    return null;
  }
  return entry.verdict;
}

export function setVerdictInCache(address: string, verdict: PrecheckVerdict): void {
  _verdictCache.set(address.toLowerCase(), {
    verdict,
    expiresAt: Date.now() + VERDICT_TTL_MS,
  });
}

/** Overwrite the cache entry's expiry for testing TTL expiry scenarios. */
export function expireVerdictInCache(address: string): void {
  const key = address.toLowerCase();
  const entry = _verdictCache.get(key);
  if (entry) {
    _verdictCache.set(key, { ...entry, expiresAt: Date.now() - 1 });
  }
}

export function resetPrecheckState(): void {
  _verdictCache.clear();
}

// ── Core logic ─────────────────────────────────────────────────────────────────

export function isPrecheckOptedOut(): boolean {
  return process.env[PRECHECK_OPT_OUT_ENV] === "1";
}

/**
 * Whether the pre-check should trigger for this payment.
 * "First-time counterparty" = no valid cached verdict for this address.
 */
export function shouldRunPrecheck(ctx: {
  mode: string;
  counterpartyAddress: string;
  amountUsd: number;
}): boolean {
  if (ctx.mode !== "live") return false;
  if (isPrecheckOptedOut()) return false;
  const isFirstTime = getVerdictFromCache(ctx.counterpartyAddress) === null;
  const isLargeAmount = ctx.amountUsd >= 1;
  return isFirstTime || isLargeAmount;
}

/**
 * Determine whether the free-basic-verdict fallback applies.
 * Returns the degradation reason or null (meaning: proceed with paid check).
 *
 * (a) Exact-balance: balance covers the main transfer but NOT transfer + $0.02.
 * (b) Non-USDC rail token and no USDC available for the fee.
 */
export function checkFeeAffordability(opts: {
  walletUsdcBalanceUsd: number | undefined;
  transferAmountUsd: number;
  payToken: string;
  hasUsdc: boolean;
}): "exact_balance" | "no_usdc_rail" | null {
  const { walletUsdcBalanceUsd, transferAmountUsd, payToken, hasUsdc } = opts;

  // Case (b): rail token is non-USDC and wallet has no USDC for the fee.
  const isNonUsdcRailToken =
    payToken === "USDT" ||
    payToken === "RLUSD" ||
    payToken === "USDG" ||
    payToken === "USDT0";
  if (isNonUsdcRailToken && !hasUsdc) {
    return "no_usdc_rail";
  }

  // Case (a): balance is known and covers the transfer but not transfer + fee.
  if (
    walletUsdcBalanceUsd !== undefined &&
    walletUsdcBalanceUsd >= transferAmountUsd &&
    walletUsdcBalanceUsd < transferAmountUsd + PRECHECK_FEE_USD
  ) {
    return "exact_balance";
  }

  return null;
}

/**
 * Run the pre-check. Never throws; never blocks the main transaction.
 *
 * @param ctx   Payment context.
 * @param trustCheckFn  Injected trust-check function (production: relay call;
 *                      tests: mock).
 */
export async function runPrecheck(
  ctx: PrecheckContext,
  trustCheckFn: TrustCheckFn,
): Promise<PrecheckResult> {
  if (ctx.mode !== "live") {
    return { ran: false, reason: "sandbox", fromCache: false, charged: false };
  }

  if (isPrecheckOptedOut()) {
    return { ran: false, reason: "opt_out", fromCache: false, charged: false };
  }

  const addr = ctx.counterpartyAddress.toLowerCase();
  const isFirstTime = getVerdictFromCache(addr) === null;
  const isLargeAmount = ctx.amountUsd >= 1;

  if (!isFirstTime && !isLargeAmount) {
    return { ran: false, reason: "not_triggered", fromCache: false, charged: false };
  }

  // Cache hit: return without charging.
  const cached = getVerdictFromCache(addr);
  if (cached) {
    return { ran: true, reason: "cached", verdict: cached, fromCache: true, charged: false };
  }

  // Determine fee affordability before attempting the paid check.
  const hasUsdc = ctx.hasUsdc ?? (ctx.payToken === "USDC");
  const degradationReason = checkFeeAffordability({
    walletUsdcBalanceUsd: ctx.walletUsdcBalanceUsd,
    transferAmountUsd: ctx.amountUsd,
    payToken: ctx.payToken,
    hasUsdc,
  });

  if (degradationReason !== null) {
    process.stderr.write(
      `[q402-mcp] precheck degraded to free basic verdict` +
      ` (reason: ${degradationReason}) for counterparty ${addr}\n`,
    );
    const upgradeHint =
      degradationReason === "exact_balance"
        ? `Pre-check used free basic verdict: wallet balance covers the transfer ` +
          `but not the $${PRECHECK_FEE_USD} trust-check fee. ` +
          `Top up your USDC balance (~$1 covers ~50 checks) to enable full paid pre-checks.`
        : `Pre-check used free basic verdict: wallet holds non-USDC rail tokens ` +
          `but no USDC to pay the $${PRECHECK_FEE_USD} trust-check fee. ` +
          `Add USDC to your wallet to enable full paid pre-checks.`;
    const verdict: PrecheckVerdict = {
      address: addr,
      risk: "unknown",
      flags: [],
      isFree: true,
      degradationReason,
      upgradeHint,
    };
    return { ran: true, reason: "degraded_free", verdict, fromCache: false, charged: false };
  }

  // Paid trust check.
  try {
    const raw = await trustCheckFn(addr);
    const verdict: PrecheckVerdict = { ...raw, address: addr, isFree: false };
    setVerdictInCache(addr, verdict);
    return { ran: true, reason: "paid", verdict, fromCache: false, charged: true };
  } catch (err) {
    // Never block the main transaction on pre-check failure.
    process.stderr.write(
      `[q402-mcp] precheck error (${err instanceof Error ? err.message : String(err)}); ` +
      `main transaction proceeds\n`,
    );
    return { ran: false, reason: "error", fromCache: false, charged: false };
  }
}

/**
 * Build the production TrustCheckFn that calls the Q402 relay.
 * Exported so pay.ts can wire it in without importing CONFIG directly.
 */
export function makeRelayTrustCheckFn(opts: {
  apiKey: string;
  relayBaseUrl: string;
}): TrustCheckFn {
  return async (address: string) => {
    const resp = await fetch(`${opts.relayBaseUrl}/trust/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: opts.apiKey, address }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`trust/check HTTP ${resp.status}: ${body}`);
    }
    const data = (await resp.json()) as { risk?: string; flags?: string[] };
    const risk = (["low", "medium", "high"].includes(data.risk ?? "") ? data.risk : "unknown") as
      PrecheckVerdict["risk"];
    return { risk, flags: Array.isArray(data.flags) ? data.flags : [] };
  };
}
