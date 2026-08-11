/**
 * Tests for the structured self-heal guidance on delegated-wallet paths.
 *
 * AC-1  q402_pay x402-path: X402_WALLET_DELEGATED → recommendedAction contains
 *       (a) why reason, (b) q402_wallet_status confirm step, (c) q402_clear_delegation fix step;
 *       response has no auto-clear.
 * AC-2  q402_x402_fetch: eth_getCode returns 7702 delegation prefix → short-circuit before signing,
 *       returns delegationBlocked with (a)/(b)/(c), writes blocked_by_guard(wallet_delegated) audit.
 * AC-3  q402_x402_fetch: eth_getCode returns non-delegated code → detection passes, proceeds normally.
 * AC-4  Neither path triggers any clearing execution — guidance is informational only.
 */

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  runX402Fetch,
  resetSessionSpendUsd,
  _setDelegationCheck,
} from "./x402-fetch.js";
import { CONFIG } from "../config.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const SELLER    = "0xdEAD000000000000000042069420694206942069";

function make402Body(): string {
  return JSON.stringify({
    version: 2,
    accepts: [{
      scheme: "exact", network: "base", asset: BASE_USDC,
      amount: "100", payTo: SELLER, maxTimeoutSeconds: 300,
    }],
  });
}

type FetchHandler = (url: unknown, init?: unknown) => Promise<Response>;

function stubFetch(responses: FetchHandler[]): () => void {
  const orig = globalThis.fetch;
  let idx = 0;
  globalThis.fetch = async (url: unknown, init?: unknown): Promise<Response> => {
    const handler = responses[idx++];
    if (!handler) throw new Error(`stubFetch: no more responses (got call ${idx})`);
    return handler(url, init);
  };
  return () => { globalThis.fetch = orig; };
}

function makeResponse(status: number, body: string): Response {
  return new Response(body, { status, headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  _setDelegationCheck(null);
  resetSessionSpendUsd();
});

// ── AC-1: pay path self-heal guidance completeness ────────────────────────────

describe("AC-1: q402_pay x402-path recommendedAction includes all three components", () => {
  test("X402_WALLET_DELEGATED relay response: recommendedAction has why, wallet_status step, clear_delegation step", async () => {
    // Temporarily patch CONFIG to simulate a live agentic-server session.
    // CONFIG is a module-level const object — its properties can be mutated
    // at test time; each test file runs in an isolated Node.js worker so
    // mutations here do not bleed into other test files.
    const origApiKey           = CONFIG.apiKey;
    const origMultichainApiKey = CONFIG.multichainApiKey;
    const origRealPay          = CONFIG.realPaymentsRequested;

    const cfgMut = CONFIG as unknown as Record<string, unknown>;
    cfgMut["apiKey"]                = "q402_live_test_key";
    cfgMut["multichainApiKey"]      = "q402_live_test_key";
    cfgMut["realPaymentsRequested"] = true;

    const { runPay }      = await import("./pay.js");
    const { checkConsent } = await import("../consent.js");

    const payArgs = {
      to:         SELLER,
      amount:     "0.01",
      token:      "USDC" as const,
      chain:      "base" as const,
      rail:       "x402" as const,
      walletMode: "agentic-server" as const,
      confirm:    true as const,
    };

    try {
      // First call: no consent token → returns needsConsent without hitting relay.
      const first = await runPay(payArgs);
      assert.ok(
        first.needsConsent !== undefined,
        `first call must return needsConsent; got: ${JSON.stringify(first)}`,
      );
      const token = first.needsConsent!.consentToken;

      // Second call: with consent token → relay fetch fires.
      // Mock the relay to return X402_WALLET_DELEGATED.
      const restore = stubFetch([
        () => Promise.resolve(makeResponse(200, JSON.stringify({ error: "X402_WALLET_DELEGATED" }))),
      ]);
      try {
        const second = await runPay({ ...payArgs, consentToken: token });

        assert.ok(
          second.recommendedAction !== undefined,
          `recommendedAction must be set; result: ${JSON.stringify(second)}`,
        );
        const ra = second.recommendedAction!;

        // (a) reason is present
        assert.ok(typeof ra.why === "string" && ra.why.length > 0, "why (reason) must be a non-empty string");

        // (b) q402_wallet_status confirm step
        const wsStep = ra.steps.find(s => s.tool === "q402_wallet_status");
        assert.ok(wsStep !== undefined, "steps must include q402_wallet_status confirm step");
        assert.ok(wsStep!.step >= 1, "wallet_status step must have a step number >= 1");
        assert.ok(
          typeof wsStep!.purpose === "string" && wsStep!.purpose.length > 0,
          "wallet_status step must have a purpose string",
        );

        // (c) q402_clear_delegation fix step — must come after wallet_status
        const cdStep = ra.steps.find(s => s.tool === "q402_clear_delegation");
        assert.ok(cdStep !== undefined, "steps must include q402_clear_delegation fix step");
        assert.ok(cdStep!.step > wsStep!.step, "clear_delegation step must come after wallet_status step");
        assert.ok(
          typeof cdStep!.purpose === "string" && cdStep!.purpose.length > 0,
          "clear_delegation step must have a purpose string",
        );

        // AC-4: no auto-clear — payment must not have succeeded, no auto-clear markers.
        assert.strictEqual(second.result?.success, false, "payment must not have succeeded");
        const resultObj = second as unknown as Record<string, unknown>;
        assert.ok(!("autoClearedDelegation" in resultObj), "must not have autoClearedDelegation");
        assert.ok(!("clearanceExecuted" in resultObj), "must not have clearanceExecuted");
      } finally {
        restore();
      }
    } finally {
      cfgMut["apiKey"]                = origApiKey;
      cfgMut["multichainApiKey"]      = origMultichainApiKey;
      cfgMut["realPaymentsRequested"] = origRealPay;
    }
  });
});

// ── AC-2: x402_fetch delegation detection blocks before signing ───────────────

describe("AC-2: q402_x402_fetch blocks on 7702-delegated wallet before signing", () => {
  test("eth_getCode returns 7702 prefix → short-circuit with delegationBlocked, no signing", async () => {
    const origEnable = process.env["Q402_ENABLE_REAL_PAYMENTS"];
    const origPk     = process.env["Q402_AGENTIC_PRIVATE_KEY"];
    process.env["Q402_ENABLE_REAL_PAYMENTS"] = "1";
    process.env["Q402_AGENTIC_PRIVATE_KEY"] =
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

    // Inject a delegation checker that always reports delegated.
    _setDelegationCheck(async () => true);

    // Provide a consent token so we pass the consent gate and reach the delegation check.
    const { checkConsent } = await import("../consent.js");
    const consentIntent = {
      t: "x402_fetch",
      url: "https://x402.example/delegated-test",
      method: "GET",
      payTo: SELLER.toLowerCase(),
      amountAtomic: "100",
      asset: BASE_USDC.toLowerCase(),
      network: "base",
    };
    const { expected: token } = checkConsent(consentIntent, undefined);

    let signWasCalled = false;
    // Only the 402 response is needed. A second fetch (the retry) would
    // indicate signing happened — we assert it was NOT called.
    const restore = stubFetch([
      () => Promise.resolve(makeResponse(402, make402Body())),
      async () => { signWasCalled = true; return makeResponse(200, "should not reach"); },
    ]);

    try {
      resetSessionSpendUsd();
      const result = await runX402Fetch({
        url: "https://x402.example/delegated-test",
        confirm: true,
        consentToken: token,
      });

      assert.strictEqual(result.success, false, "must not succeed");
      assert.strictEqual(result.statusCode, 402, "statusCode must be 402");

      // Must have delegationBlocked with all three components.
      assert.ok(result.delegationBlocked !== undefined, "delegationBlocked must be set");
      const db = result.delegationBlocked!;

      // (a) reason
      assert.ok(typeof db.why === "string" && db.why.length > 0, "delegationBlocked.why must be non-empty");

      // (b) q402_wallet_status confirm step
      const wsStep = db.steps.find(s => s.tool === "q402_wallet_status");
      assert.ok(wsStep !== undefined, "delegationBlocked.steps must include q402_wallet_status");
      assert.ok(wsStep!.step >= 1);
      assert.ok(typeof wsStep!.purpose === "string" && wsStep!.purpose.length > 0);

      // (c) q402_clear_delegation fix step
      const cdStep = db.steps.find(s => s.tool === "q402_clear_delegation");
      assert.ok(cdStep !== undefined, "delegationBlocked.steps must include q402_clear_delegation");
      assert.ok(cdStep!.step > wsStep!.step, "clear_delegation must come after wallet_status");

      // Must have an auditId (audit was written)
      assert.ok(typeof result.auditId === "string", "auditId must be set");

      // AC-4: no signing happened — retry fetch was never called
      assert.strictEqual(signWasCalled, false, "retry/signing fetch must not have been called");

    } finally {
      restore();
      if (origEnable !== undefined) process.env["Q402_ENABLE_REAL_PAYMENTS"] = origEnable;
      else delete process.env["Q402_ENABLE_REAL_PAYMENTS"];
      if (origPk !== undefined) process.env["Q402_AGENTIC_PRIVATE_KEY"] = origPk;
      else delete process.env["Q402_AGENTIC_PRIVATE_KEY"];
    }
  });

  test("delegation guard result error message mentions EIP-7702/delegation", async () => {
    const origEnable = process.env["Q402_ENABLE_REAL_PAYMENTS"];
    const origPk     = process.env["Q402_AGENTIC_PRIVATE_KEY"];
    process.env["Q402_ENABLE_REAL_PAYMENTS"] = "1";
    process.env["Q402_AGENTIC_PRIVATE_KEY"] =
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

    _setDelegationCheck(async () => true);

    const { checkConsent } = await import("../consent.js");
    const consentIntent = {
      t: "x402_fetch",
      url: "https://x402.example/delegated-audit",
      method: "GET",
      payTo: SELLER.toLowerCase(),
      amountAtomic: "100",
      asset: BASE_USDC.toLowerCase(),
      network: "base",
    };
    const { expected: token } = checkConsent(consentIntent, undefined);

    const restore = stubFetch([
      () => Promise.resolve(makeResponse(402, make402Body())),
    ]);

    try {
      resetSessionSpendUsd();
      const result = await runX402Fetch({
        url: "https://x402.example/delegated-audit",
        confirm: true,
        consentToken: token,
      });

      assert.strictEqual(result.success, false);
      assert.ok(
        result.error?.includes("delegated") || result.error?.includes("EIP-7702"),
        `error must mention delegation: ${result.error}`,
      );
      assert.ok(result.delegationBlocked !== undefined, "delegationBlocked must be set");
      assert.ok(typeof result.auditId === "string", "auditId must be set");
    } finally {
      restore();
      if (origEnable !== undefined) process.env["Q402_ENABLE_REAL_PAYMENTS"] = origEnable;
      else delete process.env["Q402_ENABLE_REAL_PAYMENTS"];
      if (origPk !== undefined) process.env["Q402_AGENTIC_PRIVATE_KEY"] = origPk;
      else delete process.env["Q402_AGENTIC_PRIVATE_KEY"];
    }
  });
});

// ── AC-3: non-delegated wallet passes detection and proceeds ──────────────────

describe("AC-3: non-delegated wallet passes detection and proceeds to signing", () => {
  test("eth_getCode returns empty/EOA code → detection passes, reaches signing and succeeds", async () => {
    const origEnable = process.env["Q402_ENABLE_REAL_PAYMENTS"];
    const origPk     = process.env["Q402_AGENTIC_PRIVATE_KEY"];
    process.env["Q402_ENABLE_REAL_PAYMENTS"] = "1";
    process.env["Q402_AGENTIC_PRIVATE_KEY"] =
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

    // Inject a delegation checker that always reports NOT delegated.
    _setDelegationCheck(async () => false);

    const { checkConsent } = await import("../consent.js");
    const consentIntent = {
      t: "x402_fetch",
      url: "https://x402.example/normal-wallet",
      method: "GET",
      payTo: SELLER.toLowerCase(),
      amountAtomic: "100",
      asset: BASE_USDC.toLowerCase(),
      network: "base",
    };
    const { expected: token } = checkConsent(consentIntent, undefined);

    // Stub two fetches: 402, then 200 (settlement succeeds)
    const restore = stubFetch([
      () => Promise.resolve(makeResponse(402, make402Body())),
      () => Promise.resolve(makeResponse(200, '{"ok":"settled"}')),
    ]);

    try {
      resetSessionSpendUsd();
      const result = await runX402Fetch({
        url: "https://x402.example/normal-wallet",
        confirm: true,
        consentToken: token,
      });

      // Must NOT be blocked by delegation
      assert.ok(
        result.delegationBlocked === undefined,
        "delegationBlocked must NOT be set for a non-delegated wallet",
      );

      // Should proceed to signing and succeed
      assert.strictEqual(result.success, true, `must succeed: ${result.error}`);
      assert.strictEqual(result.paid, true, "must be marked as paid");

    } finally {
      restore();
      if (origEnable !== undefined) process.env["Q402_ENABLE_REAL_PAYMENTS"] = origEnable;
      else delete process.env["Q402_ENABLE_REAL_PAYMENTS"];
      if (origPk !== undefined) process.env["Q402_AGENTIC_PRIVATE_KEY"] = origPk;
      else delete process.env["Q402_AGENTIC_PRIVATE_KEY"];
      resetSessionSpendUsd();
    }
  });
});

// ── AC-4: no auto-clear in either path ───────────────────────────────────────

describe("AC-4: neither path auto-clears delegation", () => {
  test("x402_fetch delegation block result contains only suggestions, no auto-execution markers", async () => {
    const origEnable = process.env["Q402_ENABLE_REAL_PAYMENTS"];
    const origPk     = process.env["Q402_AGENTIC_PRIVATE_KEY"];
    process.env["Q402_ENABLE_REAL_PAYMENTS"] = "1";
    process.env["Q402_AGENTIC_PRIVATE_KEY"] =
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

    _setDelegationCheck(async () => true);

    const { checkConsent } = await import("../consent.js");
    const consentIntent = {
      t: "x402_fetch",
      url: "https://x402.example/ac4-test",
      method: "GET",
      payTo: SELLER.toLowerCase(),
      amountAtomic: "100",
      asset: BASE_USDC.toLowerCase(),
      network: "base",
    };
    const { expected: token } = checkConsent(consentIntent, undefined);

    const restore = stubFetch([
      () => Promise.resolve(makeResponse(402, make402Body())),
    ]);

    try {
      resetSessionSpendUsd();
      const result = await runX402Fetch({
        url: "https://x402.example/ac4-test",
        confirm: true,
        consentToken: token,
      });

      // delegationBlocked is purely informational — lists tools to call, does NOT call them.
      assert.ok(result.delegationBlocked !== undefined);

      // No execution-side-effect fields on the result.
      const resultObj = result as unknown as Record<string, unknown>;
      assert.ok(!("delegationCleared" in resultObj), "must not have delegationCleared");
      assert.ok(!("clearResult" in resultObj), "must not have clearResult");

      // Each step is a suggestion (tool name + purpose), not an execution result.
      for (const step of result.delegationBlocked!.steps) {
        assert.ok(typeof step.tool === "string", "step.tool is a string (tool name)");
        assert.ok(!("result" in step), "step must not contain a result (no auto-execution)");
        assert.ok(!("executed" in step), "step must not contain an executed flag");
      }
    } finally {
      restore();
      if (origEnable !== undefined) process.env["Q402_ENABLE_REAL_PAYMENTS"] = origEnable;
      else delete process.env["Q402_ENABLE_REAL_PAYMENTS"];
      if (origPk !== undefined) process.env["Q402_AGENTIC_PRIVATE_KEY"] = origPk;
      else delete process.env["Q402_AGENTIC_PRIVATE_KEY"];
    }
  });
});
