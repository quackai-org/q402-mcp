/**
 * Client-side pre-check module: runs a trust-check on the counterparty
 * before every outgoing payment in live mode.
 *
 * Trigger policy (AC-D1):
 *   Live mode + not opted out + (first-time counterparty OR amount >= $1)
 *
 * Cache (AC-D2):
 *   Verdict cached 7 days per counterparty address. Cache hits are returned
 *   without triggering a second charge/settlement. Cache is persisted to
 *   ~/.q402/precheck-cache.json so it survives MCP restarts.
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

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

import {
  signEip3009,
  buildXPaymentHeader,
  getBuilderCode,
  pickSigningKey,
} from "./x402-fetch.js";

/** Environment variable to disable pre-check globally (opt-out). */
export const PRECHECK_OPT_OUT_ENV = "Q402_DISABLE_PRECHECK";

/** Trust-check fee in USD (AC-D4 boundary value). */
export const PRECHECK_FEE_USD = 0.02;

/** Verdict cache TTL: 7 days in milliseconds. */
const VERDICT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Default path for the persistent verdict cache file. */
export const PRECHECK_CACHE_PATH = join(homedir(), ".q402", "precheck-cache.json");

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
  /** True when a paid trust-check was performed and an on-chain settlement occurred. */
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
   * When undefined, defaults to true (conservative — avoids spurious
   * free-fallback when we can't determine balance). Only set to false
   * when the caller has confirmed no USDC is available.
   */
  hasUsdc?: boolean;
}

/**
 * Injected trust-check function type.
 * settled=true when an x402 payment actually settled on-chain.
 * settled=false when the server returned a verdict without charging (e.g. cached server-side).
 * settled=undefined (from test mocks) defaults to true for backwards-compat.
 */
export type TrustCheckFn = (
  address: string,
) => Promise<Pick<PrecheckVerdict, "risk" | "flags"> & { settled?: boolean }>;

// ── Persistent verdict cache ───────────────────────────────────────────────────

interface VerdictEntry {
  verdict: PrecheckVerdict;
  expiresAt: number;
}

const _verdictCache = new Map<string, VerdictEntry>();
let _cacheLoaded = false;

// Injected by tests to avoid touching ~/.q402/precheck-cache.json during test runs.
let _cachePathOverride: string | null = null;

/** Tests only: override the cache file path (null restores the default). */
export function _overrideCachePath(p: string | null): void {
  _cachePathOverride = p;
  _verdictCache.clear();
  _cacheLoaded = false;
}

function _effectiveCachePath(): string {
  return _cachePathOverride ?? PRECHECK_CACHE_PATH;
}

function _loadCacheFile(): void {
  if (_cacheLoaded) return;
  _cacheLoaded = true;
  try {
    const path = _effectiveCachePath();
    if (!existsSync(path)) return;
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, VerdictEntry>;
    const now = Date.now();
    for (const [k, v] of Object.entries(parsed)) {
      if (v && typeof v.expiresAt === "number" && v.expiresAt > now) {
        _verdictCache.set(k, v);
      }
    }
  } catch {
    // corrupt or missing file — start with empty cache
  }
}

function _persistCacheFile(): void {
  try {
    const path = _effectiveCachePath();
    mkdirSync(dirname(path), { recursive: true });
    const obj: Record<string, VerdictEntry> = {};
    for (const [k, v] of _verdictCache.entries()) {
      obj[k] = v;
    }
    writeFileSync(path, JSON.stringify(obj, null, 2), "utf-8");
  } catch (e) {
    process.stderr.write(
      `[q402-mcp] precheck cache write failed: ${e instanceof Error ? e.message : String(e)}\n`,
    );
  }
}

export function getVerdictFromCache(address: string): PrecheckVerdict | null {
  _loadCacheFile();
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
  _loadCacheFile();
  _verdictCache.set(address.toLowerCase(), {
    verdict,
    expiresAt: Date.now() + VERDICT_TTL_MS,
  });
  _persistCacheFile();
}

/** Overwrite the cache entry's expiry for testing TTL expiry scenarios. */
export function expireVerdictInCache(address: string): void {
  const key = address.toLowerCase();
  const entry = _verdictCache.get(key);
  if (entry) {
    _verdictCache.set(key, { ...entry, expiresAt: Date.now() - 1 });
    _persistCacheFile();
  }
}

export function resetPrecheckState(): void {
  _verdictCache.clear();
  _cacheLoaded = false;
  // Write empty cache to disk so tests don't leak state across runs.
  try {
    const path = _effectiveCachePath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{}", "utf-8");
  } catch {
    // best-effort — if we can't write, cache will just be re-read next time
  }
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
 * @param trustCheckFn  Injected trust-check function (production: x402 call;
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
  // Default hasUsdc to true (conservative) when not specified — avoids
  // spurious case-b degradation when the caller doesn't know the USDC balance.
  const hasUsdc = ctx.hasUsdc ?? true;
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
    const verdict: PrecheckVerdict = {
      risk: raw.risk,
      flags: raw.flags,
      address: addr,
      isFree: false,
    };
    setVerdictInCache(addr, verdict);
    // charged=true only when an actual on-chain settlement occurred.
    // raw.settled=undefined (legacy mocks) → treat as charged.
    return { ran: true, reason: "paid", verdict, fromCache: false, charged: raw.settled ?? true };
  } catch (err) {
    // Never block the main transaction on pre-check failure.
    process.stderr.write(
      `[q402-mcp] precheck error (${err instanceof Error ? err.message : String(err)}); ` +
      `main transaction proceeds\n`,
    );
    return { ran: false, reason: "error", fromCache: false, charged: false };
  }
}

// ── x402 trust-check Base USDC constants ──────────────────────────────────────

const BASE_USDC_ADDRESS_LC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

interface TrustCheckX402Req {
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds?: number;
}

function selectTrustCheckReq(accepts: TrustCheckX402Req[]): TrustCheckX402Req | null {
  return accepts.find(a =>
    a.scheme === "exact" &&
    (a.network === "base" || a.network === "base-mainnet" || a.network === "eip155:8453") &&
    a.asset.toLowerCase() === BASE_USDC_ADDRESS_LC,
  ) ?? null;
}

/**
 * Build the production TrustCheckFn using the x402 payment protocol.
 *
 * Flow:
 *   1. GET {relayBaseUrl}/api/x402/agent-trust/{address}
 *   2. 200 → return verdict immediately (settled=false, no charge)
 *   3. 402 → parse x402 body, sign EIP-3009 for Base USDC, retry with X-PAYMENT
 *   4. 200 retry → return verdict (settled=true, charge occurred)
 *
 * Never blocks the main transaction — errors propagate to runPrecheck's catch.
 */
export function makeX402TrustCheckFn(opts: {
  relayBaseUrl: string;
}): TrustCheckFn {
  return async (address: string) => {
    const url = `${opts.relayBaseUrl}/api/x402/agent-trust/${address}`;

    // Step 1: initial GET
    const resp1 = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
    });

    if (resp1.status === 200) {
      // Server returned a verdict without requiring payment (cached or free tier).
      const data = (await resp1.json()) as { risk?: string; flags?: string[] };
      const risk = (["low", "medium", "high"].includes(data.risk ?? "") ? data.risk : "unknown") as
        PrecheckVerdict["risk"];
      return { risk, flags: Array.isArray(data.flags) ? data.flags : [], settled: false };
    }

    if (resp1.status !== 402) {
      const body = await resp1.text().catch(() => "");
      throw new Error(`trust-check HTTP ${resp1.status}: ${body.slice(0, 200)}`);
    }

    // Step 2: parse x402 body
    const raw402 = (await resp1.json()) as { accepts?: unknown[] };
    const req = selectTrustCheckReq((raw402.accepts ?? []) as TrustCheckX402Req[]);
    if (!req) {
      throw new Error("trust-check: 402 response has no supported Base USDC payment option");
    }

    // Step 3: get signing key
    const signingKey = pickSigningKey();
    if (!signingKey) {
      throw new Error(
        "trust-check: no signing key configured " +
        "(set Q402_AGENTIC_PRIVATE_KEY or Q402_PRIVATE_KEY)",
      );
    }

    // Step 4: sign EIP-3009
    const signed = await signEip3009(
      signingKey,
      req.payTo,
      req.amount,
      req.maxTimeoutSeconds ?? 300,
    );

    // Step 5: build X-PAYMENT header with builder-code attribution
    const xPayment = buildXPaymentHeader({
      from:         signed.from,
      payTo:        req.payTo,
      amountAtomic: req.amount,
      validBefore:  signed.validBefore,
      nonce:        signed.nonce,
      signature:    signed.signature,
      network:      req.network,
      builderCode:  getBuilderCode(),
    });

    // Step 6: retry GET with X-PAYMENT header
    const resp2 = await fetch(url, {
      headers: { "X-PAYMENT": xPayment },
      signal: AbortSignal.timeout(15_000),
    });

    if (!resp2.ok) {
      const body = await resp2.text().catch(() => "");
      throw new Error(`trust-check x402 retry HTTP ${resp2.status}: ${body.slice(0, 200)}`);
    }

    const data2 = (await resp2.json()) as { risk?: string; flags?: string[] };
    const risk = (["low", "medium", "high"].includes(data2.risk ?? "") ? data2.risk : "unknown") as
      PrecheckVerdict["risk"];
    return { risk, flags: Array.isArray(data2.flags) ? data2.flags : [], settled: true };
  };
}
