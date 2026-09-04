/**
 * Unit tests for the wallet-mismatch detection added in the key-rotation UX fix.
 *
 * AC-1: When Q402_AGENTIC_PRIVATE_KEY derives an address that differs from the
 *       current API key's server-side default Agent Wallet, detectWalletMismatch
 *       returns a warning string containing "WALLET MISMATCH".
 * AC-2: When the derived address matches the server wallet, no warning is returned.
 */

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Wallet } from "ethers";

import { detectWalletMismatch } from "./doctor.js";

// Two deterministic test private keys (valid 32-byte hex).
const KEY_A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const KEY_B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const ADDR_A = new Wallet(KEY_A).address.toLowerCase();
const ADDR_B = new Wallet(KEY_B).address.toLowerCase();
const LIVE_API_KEY = "q402_live_test_key_for_unit_tests";
const RELAY = "https://q402.quackai.ai/api";

function mockFetch(serverWalletAddress: string): typeof globalThis.fetch {
  return (async (_url, _opts) => {
    return new Response(
      JSON.stringify({ wallet: { address: serverWalletAddress } }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof globalThis.fetch;
}

let savedFetch: typeof globalThis.fetch;

beforeEach(() => {
  savedFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = savedFetch;
});

describe("AC-1: mismatch → warning returned", () => {
  test("local key A vs server wallet B produces WALLET MISMATCH warning", async () => {
    globalThis.fetch = mockFetch(ADDR_B); // server returns wallet B
    const warning = await detectWalletMismatch(KEY_A, null, LIVE_API_KEY, RELAY);
    assert.ok(warning !== null, "expected a non-null warning");
    assert.ok(
      warning.includes("WALLET MISMATCH"),
      `warning must contain 'WALLET MISMATCH', got: ${warning}`,
    );
    assert.ok(warning.includes(ADDR_A), `warning must mention local address ${ADDR_A}`);
    assert.ok(warning.includes(ADDR_B), `warning must mention server address ${ADDR_B}`);
  });

  test("Q402_AGENT_WALLET_ADDRESS mismatch also triggers warning", async () => {
    globalThis.fetch = mockFetch(ADDR_B);
    const warning = await detectWalletMismatch(null, ADDR_A, LIVE_API_KEY, RELAY);
    assert.ok(warning !== null, "expected a non-null warning for walletId mismatch");
    assert.ok(warning.includes("WALLET MISMATCH"), `warning must contain 'WALLET MISMATCH', got: ${warning}`);
  });
});

describe("AC-2: match → no warning", () => {
  test("local key A vs server wallet A returns null", async () => {
    globalThis.fetch = mockFetch(ADDR_A); // server returns same address
    const warning = await detectWalletMismatch(KEY_A, null, LIVE_API_KEY, RELAY);
    assert.strictEqual(warning, null, "expected null when addresses match");
  });

  test("Q402_AGENT_WALLET_ADDRESS matching server returns null", async () => {
    globalThis.fetch = mockFetch(ADDR_A);
    const warning = await detectWalletMismatch(null, ADDR_A, LIVE_API_KEY, RELAY);
    assert.strictEqual(warning, null);
  });
});

describe("edge cases: returns null without making a request", () => {
  test("null agenticPrivateKey and no walletId → null", async () => {
    let called = false;
    globalThis.fetch = (async () => { called = true; return new Response("{}", { status: 200 }); }) as typeof globalThis.fetch;
    const warning = await detectWalletMismatch(null, null, LIVE_API_KEY, RELAY);
    assert.strictEqual(warning, null);
    assert.ok(!called, "fetch must not be called when no local wallet is configured");
  });

  test("non-live API key → null", async () => {
    let called = false;
    globalThis.fetch = (async () => { called = true; return new Response("{}", { status: 200 }); }) as typeof globalThis.fetch;
    const warning = await detectWalletMismatch(KEY_A, null, "q402_test_key", RELAY);
    assert.strictEqual(warning, null);
    assert.ok(!called, "fetch must not be called for non-live keys");
  });

  test("null API key → null", async () => {
    const warning = await detectWalletMismatch(KEY_A, null, null, RELAY);
    assert.strictEqual(warning, null);
  });

  test("invalid private key format → null (no wallet derivable)", async () => {
    const warning = await detectWalletMismatch("0x...", null, LIVE_API_KEY, RELAY);
    assert.strictEqual(warning, null);
  });

  test("server returns non-OK response → null (graceful degradation)", async () => {
    globalThis.fetch = (async () => new Response("{}", { status: 500 })) as typeof globalThis.fetch;
    const warning = await detectWalletMismatch(KEY_A, null, LIVE_API_KEY, RELAY);
    assert.strictEqual(warning, null, "non-OK server response must not block doctor");
  });

  test("fetch throws network error → null (graceful degradation)", async () => {
    globalThis.fetch = (async () => { throw new Error("ENOTFOUND"); }) as typeof globalThis.fetch;
    const warning = await detectWalletMismatch(KEY_A, null, LIVE_API_KEY, RELAY);
    assert.strictEqual(warning, null, "network error must not throw");
  });
});
