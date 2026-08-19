/**
 * Unit tests for the client-side pre-check module.
 *
 * AC-D1: Default trigger conditions (live mode, first-time OR >= $1).
 * AC-D2: Verdict cache TTL — cache hit: no charge; expiry: re-query.
 * AC-D3: Env opt-out (Q402_DISABLE_PRECHECK=1).
 * AC-D4: Free-basic-verdict fallback — two edge cases only; main tx never blocked.
 */

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  runPrecheck,
  shouldRunPrecheck,
  checkFeeAffordability,
  isPrecheckOptedOut,
  setVerdictInCache,
  expireVerdictInCache,
  resetPrecheckState,
  _overrideCachePath,
  makeX402TrustCheckFn,
  PRECHECK_OPT_OUT_ENV,
  PRECHECK_FEE_USD,
  type PrecheckContext,
  type TrustCheckFn,
} from "./precheck.js";

const TEST_CACHE_PATH = join(tmpdir(), `q402-precheck-test-${process.pid}.json`);

// ── Test helpers ────────────────────────────────────────────────────────────────

const ADDR_A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const ADDR_B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function makeMockTrustCheck(
  result: Awaited<ReturnType<TrustCheckFn>> = { risk: "low", flags: [] },
  shouldFail = false,
): { fn: TrustCheckFn; callCount: () => number } {
  let calls = 0;
  const fn: TrustCheckFn = async (_address) => {
    calls++;
    if (shouldFail) throw new Error("trust-check network error");
    return result;
  };
  return { fn, callCount: () => calls };
}

function makeCtx(overrides: Partial<PrecheckContext> = {}): PrecheckContext {
  return {
    mode: "live",
    counterpartyAddress: ADDR_A,
    amountUsd: 0.5,
    payToken: "USDC",
    hasUsdc: true,
    ...overrides,
  };
}

// ── Setup / teardown ───────────────────────────────────────────────────────────

beforeEach(() => {
  _overrideCachePath(TEST_CACHE_PATH);
  resetPrecheckState();
  delete process.env[PRECHECK_OPT_OUT_ENV];
});

afterEach(() => {
  resetPrecheckState();
  _overrideCachePath(null);
  delete process.env[PRECHECK_OPT_OUT_ENV];
});

// ── AC-D1: Trigger conditions ──────────────────────────────────────────────────

describe("AC-D1: default trigger conditions", () => {
  test("first-time counterparty + small amount (< $1) triggers pre-check", async () => {
    const { fn, callCount } = makeMockTrustCheck();
    const result = await runPrecheck(makeCtx({ amountUsd: 0.50 }), fn);
    assert.ok(result.ran, "should have run");
    assert.strictEqual(result.reason, "paid");
    assert.strictEqual(callCount(), 1);
  });

  test("non-first-time counterparty + large amount (>= $1) triggers pre-check (uses cache)", async () => {
    const { fn: fn1 } = makeMockTrustCheck({ risk: "low", flags: [] });
    // First call: establishes cache entry
    await runPrecheck(makeCtx({ amountUsd: 0.50 }), fn1);

    const { fn: fn2, callCount: count2 } = makeMockTrustCheck();
    // Second call: non-first-time + large amount → triggers but hits cache
    const result = await runPrecheck(makeCtx({ amountUsd: 5.00 }), fn2);
    assert.ok(result.ran, "should have run (large amount triggers)");
    assert.ok(result.fromCache, "should serve from cache (no double charge)");
    assert.strictEqual(count2(), 0, "trust-check must not be called again (cache hit)");
  });

  test("non-first-time counterparty + small amount (< $1) does NOT trigger", async () => {
    const { fn: fn1 } = makeMockTrustCheck();
    // Seed cache
    await runPrecheck(makeCtx({ amountUsd: 0.50 }), fn1);

    const { fn: fn2, callCount: count2 } = makeMockTrustCheck();
    const result = await runPrecheck(makeCtx({ amountUsd: 0.50 }), fn2);
    assert.ok(!result.ran, "should NOT have run");
    assert.strictEqual(result.reason, "not_triggered");
    assert.strictEqual(count2(), 0);
  });

  test("sandbox mode never triggers pre-check", async () => {
    const { fn, callCount } = makeMockTrustCheck();
    const result = await runPrecheck(makeCtx({ mode: "sandbox" }), fn);
    assert.ok(!result.ran);
    assert.strictEqual(result.reason, "sandbox");
    assert.strictEqual(callCount(), 0);
  });

  test("shouldRunPrecheck: first-time returns true", () => {
    assert.ok(shouldRunPrecheck({ mode: "live", counterpartyAddress: ADDR_A, amountUsd: 0.5 }));
  });

  test("shouldRunPrecheck: sandbox returns false regardless of amount", () => {
    assert.ok(!shouldRunPrecheck({ mode: "sandbox", counterpartyAddress: ADDR_A, amountUsd: 100 }));
  });

  test("shouldRunPrecheck: non-first-time + small amount returns false", () => {
    setVerdictInCache(ADDR_A, { address: ADDR_A, risk: "low", flags: [], isFree: false });
    assert.ok(!shouldRunPrecheck({ mode: "live", counterpartyAddress: ADDR_A, amountUsd: 0.5 }));
  });

  test("shouldRunPrecheck: non-first-time + large amount returns true", () => {
    setVerdictInCache(ADDR_A, { address: ADDR_A, risk: "low", flags: [], isFree: false });
    assert.ok(shouldRunPrecheck({ mode: "live", counterpartyAddress: ADDR_A, amountUsd: 1.0 }));
  });

  test("$1.00 exact threshold triggers pre-check (boundary)", async () => {
    // Seed cache first to remove first-time condition
    setVerdictInCache(ADDR_A, { address: ADDR_A, risk: "low", flags: [], isFree: false });
    const { fn, callCount } = makeMockTrustCheck();
    const result = await runPrecheck(makeCtx({ amountUsd: 1.00 }), fn);
    // Large amount triggered it, but cache exists → fromCache
    assert.ok(result.ran, "should trigger at exactly $1.00");
    assert.ok(result.fromCache);
    assert.strictEqual(callCount(), 0);
  });

  test("$0.99 does NOT trigger for non-first-time counterparty (boundary)", () => {
    setVerdictInCache(ADDR_A, { address: ADDR_A, risk: "low", flags: [], isFree: false });
    assert.ok(!shouldRunPrecheck({ mode: "live", counterpartyAddress: ADDR_A, amountUsd: 0.99 }));
  });
});

// ── AC-D2: Cache TTL and no double charge ─────────────────────────────────────

describe("AC-D2: verdict cache TTL and no double charge", () => {
  test("cache hit (within TTL): fromCache=true, charged=false", async () => {
    const { fn: fn1 } = makeMockTrustCheck({ risk: "medium", flags: ["OFAC_LIST"] });
    await runPrecheck(makeCtx({ amountUsd: 5.00 }), fn1);

    // Force re-trigger via large amount on ADDR_B (so not first-time issue)
    // For ADDR_A, it was already checked. Use large amount to trigger again.
    const { fn: fn2, callCount: count2 } = makeMockTrustCheck();
    const result = await runPrecheck(makeCtx({ amountUsd: 5.00 }), fn2);

    assert.ok(result.ran);
    assert.ok(result.fromCache, "must serve from cache");
    assert.ok(!result.charged, "must not charge again within TTL");
    assert.strictEqual(result.verdict?.risk, "medium");
    assert.strictEqual(count2(), 0, "trust-check must not be called on cache hit");
  });

  test("cache hit does not charge even for large amounts", async () => {
    // Seed cache for ADDR_A with a prior check
    const { fn: fn1 } = makeMockTrustCheck({ risk: "low", flags: [] });
    await runPrecheck(makeCtx({ amountUsd: 0.50 }), fn1);

    const { fn: fn2, callCount: count2 } = makeMockTrustCheck();
    // Large amount re-triggers, but cache exists → no second charge
    const result = await runPrecheck(makeCtx({ amountUsd: 100.00 }), fn2);
    assert.ok(result.fromCache);
    assert.ok(!result.charged);
    assert.strictEqual(count2(), 0);
  });

  test("cache expiry triggers re-query (charged again after TTL)", async () => {
    const { fn: fn1 } = makeMockTrustCheck({ risk: "low", flags: [] });
    await runPrecheck(makeCtx({ amountUsd: 0.50 }), fn1);

    // Expire the cache entry
    expireVerdictInCache(ADDR_A);

    // Now ADDR_A is first-time again (cache expired)
    const { fn: fn2, callCount: count2 } = makeMockTrustCheck({ risk: "low", flags: [] });
    const result = await runPrecheck(makeCtx({ amountUsd: 0.50 }), fn2);
    assert.ok(result.ran, "should run after cache expiry");
    assert.ok(!result.fromCache, "must NOT be from cache after expiry");
    assert.ok(result.charged, "must charge again after TTL");
    assert.strictEqual(count2(), 1, "trust-check must be called again after expiry");
  });

  test("two distinct counterparties are cached independently", async () => {
    const { fn: fn1 } = makeMockTrustCheck({ risk: "low", flags: [] });
    const { fn: fn2 } = makeMockTrustCheck({ risk: "high", flags: ["BLACKLIST"] });

    const r1 = await runPrecheck(makeCtx({ counterpartyAddress: ADDR_A, amountUsd: 0.50 }), fn1);
    const r2 = await runPrecheck(makeCtx({ counterpartyAddress: ADDR_B, amountUsd: 0.50 }), fn2);

    assert.strictEqual(r1.verdict?.risk, "low");
    assert.strictEqual(r2.verdict?.risk, "high");
    // Each was charged once
    assert.ok(r1.charged);
    assert.ok(r2.charged);
  });
});

// ── AC-D3: Env opt-out ─────────────────────────────────────────────────────────

describe("AC-D3: env opt-out", () => {
  test("Q402_DISABLE_PRECHECK=1 disables pre-check", async () => {
    process.env[PRECHECK_OPT_OUT_ENV] = "1";
    const { fn, callCount } = makeMockTrustCheck();
    // Even first-time + large amount
    const result = await runPrecheck(makeCtx({ amountUsd: 100 }), fn);
    assert.ok(!result.ran);
    assert.strictEqual(result.reason, "opt_out");
    assert.strictEqual(callCount(), 0);
  });

  test("isPrecheckOptedOut returns true when env is set", () => {
    process.env[PRECHECK_OPT_OUT_ENV] = "1";
    assert.ok(isPrecheckOptedOut());
  });

  test("isPrecheckOptedOut returns false when env is unset", () => {
    delete process.env[PRECHECK_OPT_OUT_ENV];
    assert.ok(!isPrecheckOptedOut());
  });

  test("isPrecheckOptedOut returns false for non-'1' values", () => {
    process.env[PRECHECK_OPT_OUT_ENV] = "true";
    assert.ok(!isPrecheckOptedOut(), "only '1' opts out");
    process.env[PRECHECK_OPT_OUT_ENV] = "0";
    assert.ok(!isPrecheckOptedOut());
  });

  test("shouldRunPrecheck returns false when opted out", () => {
    process.env[PRECHECK_OPT_OUT_ENV] = "1";
    assert.ok(
      !shouldRunPrecheck({ mode: "live", counterpartyAddress: ADDR_A, amountUsd: 100 }),
      "shouldRunPrecheck must respect opt-out",
    );
  });

  test("opt-out setting does not block main transaction", async () => {
    process.env[PRECHECK_OPT_OUT_ENV] = "1";
    const { fn } = makeMockTrustCheck();
    // Must not throw
    const result = await runPrecheck(makeCtx({ amountUsd: 100 }), fn);
    assert.strictEqual(result.ran, false);
    assert.strictEqual(result.charged, false);
  });
});

// ── AC-D4: Free basic verdict fallback ────────────────────────────────────────

describe("AC-D4: free-basic-verdict fallback — two edge cases only", () => {
  describe("checkFeeAffordability", () => {
    test("exact-balance: balance covers transfer but not transfer + fee → case (a)", () => {
      const reason = checkFeeAffordability({
        walletUsdcBalanceUsd: 5.00,
        transferAmountUsd: 5.00,
        payToken: "USDC",
        hasUsdc: true,
      });
      assert.strictEqual(reason, "exact_balance");
    });

    test("exact-balance boundary: balance = transfer amount exactly", () => {
      const transferAmt = 10.00;
      const balance = 10.00; // exactly covers transfer, not transfer + $0.02
      const reason = checkFeeAffordability({
        walletUsdcBalanceUsd: balance,
        transferAmountUsd: transferAmt,
        payToken: "USDC",
        hasUsdc: true,
      });
      assert.strictEqual(reason, "exact_balance");
    });

    test("funded user: balance covers transfer + fee → no degradation", () => {
      const reason = checkFeeAffordability({
        walletUsdcBalanceUsd: 5.02, // covers $5.00 transfer + $0.02 fee
        transferAmountUsd: 5.00,
        payToken: "USDC",
        hasUsdc: true,
      });
      assert.strictEqual(reason, null, "must return null for adequately funded user");
    });

    test("USDT-only user (no USDC) → case (b)", () => {
      const reason = checkFeeAffordability({
        walletUsdcBalanceUsd: undefined,
        transferAmountUsd: 50.00,
        payToken: "USDT",
        hasUsdc: false,
      });
      assert.strictEqual(reason, "no_usdc_rail");
    });

    test("USDT user WITH USDC available → no degradation", () => {
      const reason = checkFeeAffordability({
        walletUsdcBalanceUsd: 1.00,
        transferAmountUsd: 50.00,
        payToken: "USDT",
        hasUsdc: true,
      });
      assert.strictEqual(reason, null);
    });

    test("USDC user, balance unknown → no degradation (conservative default)", () => {
      const reason = checkFeeAffordability({
        walletUsdcBalanceUsd: undefined,
        transferAmountUsd: 5.00,
        payToken: "USDC",
        hasUsdc: true,
      });
      assert.strictEqual(reason, null, "unknown balance should not trigger degradation");
    });
  });

  test("exact-balance transfer: main tx not blocked, precheck degraded (upgrade hint + log)", async () => {
    const stderrChunks: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk: string | Uint8Array, ...rest: unknown[]) => {
      if (typeof chunk === "string") stderrChunks.push(chunk);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (origWrite as (...a: any[]) => boolean)(chunk, ...rest);
    };

    try {
      const { fn, callCount } = makeMockTrustCheck();
      const result = await runPrecheck(
        makeCtx({
          amountUsd: 5.00,
          walletUsdcBalanceUsd: 5.00, // exactly covers transfer, not + fee
          payToken: "USDC",
          hasUsdc: true,
        }),
        fn,
      );

      // AC-D4: main transaction must NOT be blocked
      assert.ok(result.ran, "pre-check ran (degraded)");
      assert.strictEqual(result.reason, "degraded_free");
      assert.ok(!result.charged, "must not charge on free fallback");
      assert.ok(result.verdict?.isFree, "verdict must be marked as free");
      assert.strictEqual(result.verdict?.degradationReason, "exact_balance");
      assert.ok(
        typeof result.verdict?.upgradeHint === "string" && result.verdict.upgradeHint.length > 0,
        "upgrade hint must be present",
      );
      // Trust-check API must not be called (no charge)
      assert.strictEqual(callCount(), 0, "trust-check must not be invoked on free fallback");

      // Degradation reason must be logged
      const logged = stderrChunks.join("");
      assert.ok(
        logged.includes("exact_balance"),
        `degradation reason must be logged, got: ${logged}`,
      );
    } finally {
      process.stderr.write = origWrite;
    }
  });

  test("USDT-only user: degraded to free basic verdict, main tx not blocked", async () => {
    const { fn, callCount } = makeMockTrustCheck();
    const result = await runPrecheck(
      makeCtx({
        amountUsd: 50.00,
        payToken: "USDT",
        hasUsdc: false,
      }),
      fn,
    );

    assert.ok(result.ran);
    assert.strictEqual(result.reason, "degraded_free");
    assert.ok(!result.charged);
    assert.strictEqual(result.verdict?.degradationReason, "no_usdc_rail");
    assert.ok(result.verdict?.upgradeHint?.includes("USDC"));
    assert.strictEqual(callCount(), 0);
  });

  test("funded user with USDC (including trial): normal paid check, not free", async () => {
    const { fn, callCount } = makeMockTrustCheck({ risk: "low", flags: [] });
    const result = await runPrecheck(
      makeCtx({
        amountUsd: 5.00,
        walletUsdcBalanceUsd: 100.00, // plenty of USDC
        payToken: "USDC",
        hasUsdc: true,
      }),
      fn,
    );

    assert.ok(result.ran);
    assert.strictEqual(result.reason, "paid");
    assert.ok(result.charged, "must charge a funded user (including trial users with USDC)");
    assert.ok(!result.verdict?.isFree, "verdict must NOT be free for funded user");
    assert.strictEqual(callCount(), 1);
  });

  test("trial user with USDC pays normally (no free pass for trial plans)", async () => {
    // The isTrial flag is not a concept in precheck — it only cares about USDC availability.
    // This test verifies that having USDC results in a paid check regardless of plan type.
    const { fn, callCount } = makeMockTrustCheck({ risk: "low", flags: [] });
    const result = await runPrecheck(
      makeCtx({
        amountUsd: 0.50,
        payToken: "USDC",
        hasUsdc: true,
        walletUsdcBalanceUsd: 10.00,
      }),
      fn,
    );
    assert.ok(result.charged, "trial user with USDC must be charged normally");
    assert.strictEqual(callCount(), 1);
  });

  describe("main transaction never blocked in any branch", () => {
    test("paid check failure: pre-check silently skipped, no throw", async () => {
      const { fn } = makeMockTrustCheck({ risk: "low", flags: [] }, true /* shouldFail */);
      // Must not throw
      const result = await runPrecheck(makeCtx({ amountUsd: 5.00 }), fn);
      assert.strictEqual(result.ran, false, "ran=false on error (pre-check skipped)");
      assert.strictEqual(result.reason, "error");
      assert.ok(!result.charged);
    });

    test("exact-balance fallback: runPrecheck returns without throwing", async () => {
      const { fn } = makeMockTrustCheck();
      let threw = false;
      try {
        await runPrecheck(
          makeCtx({ amountUsd: 5.00, walletUsdcBalanceUsd: 5.00, payToken: "USDC" }),
          fn,
        );
      } catch {
        threw = true;
      }
      assert.ok(!threw, "must not throw in exact-balance degradation path");
    });

    test("USDT-only fallback: runPrecheck returns without throwing", async () => {
      const { fn } = makeMockTrustCheck();
      let threw = false;
      try {
        await runPrecheck(makeCtx({ amountUsd: 5.00, payToken: "USDT", hasUsdc: false }), fn);
      } catch {
        threw = true;
      }
      assert.ok(!threw, "must not throw in USDT-only degradation path");
    });

    test("opt-out: runPrecheck returns without throwing", async () => {
      process.env[PRECHECK_OPT_OUT_ENV] = "1";
      const { fn } = makeMockTrustCheck();
      let threw = false;
      try {
        await runPrecheck(makeCtx({ amountUsd: 100 }), fn);
      } catch {
        threw = true;
      }
      assert.ok(!threw, "must not throw when opted out");
    });
  });
});

// ── PRECHECK_FEE_USD is $0.02 (AC-PRICE) ──────────────────────────────────────

describe("AC-PRICE: pre-check fee value", () => {
  test("PRECHECK_FEE_USD is $0.02", () => {
    assert.strictEqual(PRECHECK_FEE_USD, 0.02);
  });
});

// ── makeX402TrustCheckFn: URL must not double /api ──────────────────────────

describe("makeX402TrustCheckFn: trust-check URL construction", () => {
  const TEST_ADDR = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

  test("default relayBaseUrl (ends in /api) produces exactly one /api segment", async () => {
    const capturedUrls: string[] = [];
    // Intercept fetch to capture the URL without making a real network call.
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request) => {
      capturedUrls.push(url.toString());
      return new Response(JSON.stringify({ riskFlags: [] }), { status: 200 });
    }) as typeof globalThis.fetch;
    try {
      const fn = makeX402TrustCheckFn({ relayBaseUrl: "https://q402.quackai.ai/api" });
      await fn(TEST_ADDR);
    } finally {
      globalThis.fetch = origFetch;
    }
    assert.strictEqual(capturedUrls.length, 1);
    const url = capturedUrls[0]!;
    // Must contain exactly one occurrence of "/api" in the path prefix.
    const apiCount = (url.match(/\/api\//g) ?? []).length;
    assert.strictEqual(apiCount, 1, `URL "${url}" contains ${apiCount} /api/ segments, expected 1`);
    assert.ok(url.includes("/api/x402/agent-trust/"), `URL "${url}" must include /api/x402/agent-trust/`);
    assert.ok(!url.includes("/api/api/"), `URL "${url}" must NOT contain double /api/api/`);
  });

  test("relayBaseUrl without trailing /api is unaffected", async () => {
    const capturedUrls: string[] = [];
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request) => {
      capturedUrls.push(url.toString());
      return new Response(JSON.stringify({ riskFlags: [] }), { status: 200 });
    }) as typeof globalThis.fetch;
    try {
      const fn = makeX402TrustCheckFn({ relayBaseUrl: "https://relay.example.com" });
      await fn(TEST_ADDR);
    } finally {
      globalThis.fetch = origFetch;
    }
    const url = capturedUrls[0]!;
    assert.ok(url.startsWith("https://relay.example.com/api/x402/agent-trust/"), `Unexpected URL: ${url}`);
  });
});
