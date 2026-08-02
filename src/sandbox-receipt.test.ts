/**
 * Unit tests for the sandbox Trust Receipt flow.
 *
 * Covers AC-1 through AC-6 from the implementation spec:
 *   AC-1 sandboxPay returns receiptId matching ^rct_[0-9a-f]{24}$, sandbox:true, success:false
 *   AC-2 That receiptId is persisted with correct fields
 *   AC-3 q402_receipt returns notFound!==true, receipt.sandbox===true, receiptId correct
 *   AC-4 q402_receipt returns verified===false and explorerUrl===null
 *   AC-5 local miss → relay fetch branch is exercised
 *   AC-6 size/count cap and safe degradation on missing/corrupt store
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";

import { readStore, getSandboxReceipt, saveSandboxReceipt, SANDBOX_STORE_PATH } from "./sandbox-store.js";
import { sandboxPay } from "./client.js";
import { runReceipt, ReceiptShape } from "./tools/receipt.js";
import { getChain } from "./chains.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeTmpStorePath(): string {
  const dir = join(tmpdir(), `q402-sandbox-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return join(dir, "sandbox-receipts.json");
}

/** Remove a key from the real default store (best-effort cleanup). */
function cleanupRealStore(receiptId: string): void {
  try {
    const map = readStore();
    if (!(receiptId in map)) return;
    delete (map as Record<string, unknown>)[receiptId];
    mkdirSync(join(homedir(), ".q402"), { recursive: true });
    writeFileSync(SANDBOX_STORE_PATH, JSON.stringify(map, null, 2), "utf-8");
  } catch { /* best-effort */ }
}

const BNB = getChain("bnb");
const RECIPIENT = "0x1111111111111111111111111111111111111111";

// ── AC-1: sandboxPay return value ──────────────────────────────────────────

describe("sandboxPay return value (AC-1)", () => {
  let rid1: string;
  let rid2: string;

  after(() => {
    if (rid1) cleanupRealStore(rid1);
    if (rid2) cleanupRealStore(rid2);
  });

  test("receiptId matches ^rct_[0-9a-f]{24}$", () => {
    const result = sandboxPay(BNB, { to: RECIPIENT, amount: "5.00", token: "USDC" });
    rid1 = result.receiptId!;
    assert.ok(typeof result.receiptId === "string", "receiptId is a string");
    assert.match(result.receiptId!, /^rct_[0-9a-f]{24}$/, "receiptId matches pattern");
  });

  test("sandbox:true and success:false", () => {
    const result = sandboxPay(BNB, { to: RECIPIENT, amount: "1.00", token: "USDT" });
    rid2 = result.receiptId!;
    assert.strictEqual(result.sandbox, true, "sandbox is true");
    assert.strictEqual(result.success, false, "success is false");
  });
});

// ── AC-2: sandbox store persistence ───────────────────────────────────────

describe("sandbox store persistence (AC-2)", () => {
  test("saveSandboxReceipt / getSandboxReceipt round-trip (temp store)", () => {
    const path = makeTmpStorePath();
    const record = {
      receiptId:      "rct_aabbccdd00112233aabbccdd",
      createdAt:      "2026-01-01T00:00:00.000Z",
      txHash:         "0x" + "ab".repeat(32),
      chain:          "bnb",
      payer:          "0x0000000000000000000000000000000000000000",
      recipient:      RECIPIENT,
      token:          "USDC",
      tokenAmount:    "5.00",
      tokenAmountRaw: "5000000000000000000",
      method:         "sandbox",
      sandbox:        true as const,
    };
    saveSandboxReceipt(record, path);
    const retrieved = getSandboxReceipt(record.receiptId, path);
    assert.ok(retrieved !== null, "record is found after save");
    assert.strictEqual(retrieved!.sandbox, true, "sandbox:true preserved");
    assert.strictEqual(retrieved!.payer, record.payer, "payer preserved");
    assert.strictEqual(retrieved!.recipient, record.recipient, "recipient preserved");
    assert.strictEqual(retrieved!.token, record.token, "token preserved");
    assert.strictEqual(retrieved!.tokenAmount, record.tokenAmount, "tokenAmount preserved");
    assert.strictEqual(retrieved!.chain, record.chain, "chain preserved");
    assert.strictEqual(retrieved!.method, record.method, "method preserved");
  });

  test("sandboxPay persists record with correct fields to default store", () => {
    const result = sandboxPay(BNB, { to: RECIPIENT, amount: "3.50", token: "USDT" });
    const rid = result.receiptId!;
    try {
      const stored = getSandboxReceipt(rid);
      assert.ok(stored !== null, "persisted record is found");
      assert.strictEqual(stored!.sandbox, true, "sandbox:true");
      assert.strictEqual(stored!.recipient, RECIPIENT, "recipient matches input.to");
      assert.strictEqual(stored!.token, "USDT", "token matches");
      assert.strictEqual(stored!.tokenAmount, "3.50", "tokenAmount matches input amount");
      assert.strictEqual(stored!.chain, "bnb", "chain matches");
      assert.strictEqual(stored!.method, "sandbox", "method is sandbox");
    } finally {
      cleanupRealStore(rid);
    }
  });
});

// ── AC-3 + AC-4: q402_receipt for sandbox receiptId ───────────────────────

describe("q402_receipt sandbox lookup (AC-3, AC-4)", () => {
  // Use the real default store so runReceipt (which calls getSandboxReceipt())
  // can find the record without any mocking.
  const KNOWN_ID = "rct_cafebabe01234567cafebabe";

  before(() => {
    saveSandboxReceipt({
      receiptId:      KNOWN_ID,
      createdAt:      "2026-01-01T00:00:00.000Z",
      txHash:         "0x" + "de".repeat(32),
      chain:          "bnb",
      payer:          "0x0000000000000000000000000000000000000000",
      recipient:      RECIPIENT,
      token:          "USDC",
      tokenAmount:    "7.00",
      tokenAmountRaw: "7000000000000000000",
      method:         "sandbox",
      sandbox:        true,
    });
  });

  after(() => {
    cleanupRealStore(KNOWN_ID);
  });

  test("notFound is not true and receipt.sandbox===true (AC-3)", async () => {
    const summary = await runReceipt({ receiptId: KNOWN_ID });
    assert.notStrictEqual(summary.notFound, true, "notFound is not true");
    assert.ok(summary.receipt !== null, "receipt is not null");
    assert.strictEqual(summary.receipt!.sandbox, true, "receipt.sandbox is true");
    assert.strictEqual(summary.receipt!.receiptId, KNOWN_ID, "receiptId matches");
  });

  test("receipt passes ReceiptShape zod parse (AC-3 - no required-field regressions)", async () => {
    const summary = await runReceipt({ receiptId: KNOWN_ID });
    assert.doesNotThrow(
      () => ReceiptShape.parse(summary.receipt),
      "ReceiptShape.parse succeeds",
    );
  });

  test("verified:false and explorerUrl:null (AC-4)", async () => {
    const summary = await runReceipt({ receiptId: KNOWN_ID });
    assert.strictEqual(summary.verified, false, "verified is false");
    assert.strictEqual(summary.explorerUrl, null, "explorerUrl is null");
  });
});

// ── AC-5: local miss → relay fetch ────────────────────────────────────────

describe("local miss falls through to relay fetch (AC-5)", () => {
  test("unknown receiptId is not in local store and relay 404 → notFound:true", async () => {
    const unknownId = "rct_000000000000000000000000";
    // Confirm it's not in the local store.
    assert.strictEqual(getSandboxReceipt(unknownId), null, "id not in local store");

    // Patch globalThis.fetch to return a 404, confirming the relay path was taken.
    const originalFetch = globalThis.fetch;
    let fetchCalled = false;
    globalThis.fetch = async (_url: unknown) => {
      fetchCalled = true;
      return new Response(null, { status: 404 }) as Response;
    };
    try {
      const summary = await runReceipt({ receiptId: unknownId });
      assert.strictEqual(fetchCalled, true, "relay fetch was called (local miss fell through)");
      assert.strictEqual(summary.notFound, true, "relay 404 → notFound:true");
      assert.strictEqual(summary.receipt, null, "receipt is null on notFound");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// ── AC-6: size/count cap and safe degradation ──────────────────────────────

describe("store size/count cap and safe degradation (AC-6)", () => {
  test("getSandboxReceipt returns null for missing file (no exception)", () => {
    const nonExistent = join(tmpdir(), `q402-test-missing-${Date.now()}.json`);
    const result = getSandboxReceipt("rct_000000000000000000000000", nonExistent);
    assert.strictEqual(result, null, "returns null when file is missing");
  });

  test("getSandboxReceipt returns null for corrupt file (no exception)", () => {
    const path = makeTmpStorePath();
    writeFileSync(path, "{{ not valid json {{", "utf-8");
    const result = getSandboxReceipt("rct_000000000000000000000000", path);
    assert.strictEqual(result, null, "returns null on corrupt JSON");
  });

  test("getSandboxReceipt returns null when file exceeds size cap (no exception)", () => {
    const path = makeTmpStorePath();
    // Write a file clearly over 512 KB.
    const fakeId = "rct_" + "0".repeat(24);
    writeFileSync(path, JSON.stringify({ [fakeId]: { x: "a".repeat(600 * 1024) } }), "utf-8");
    const result = getSandboxReceipt(fakeId, path);
    assert.strictEqual(result, null, "returns null when file exceeds size cap");
  });

  test("readStore returns empty object for corrupt file (no exception)", () => {
    const path = makeTmpStorePath();
    writeFileSync(path, "not json", "utf-8");
    const map = readStore(path);
    assert.deepStrictEqual(map, {}, "returns empty object on corrupt file");
  });

  test("saveSandboxReceipt evicts oldest entries when count exceeds cap", () => {
    const path = makeTmpStorePath();
    // Write 1001 entries to trigger eviction (cap is 1000).
    for (let i = 0; i < 1001; i++) {
      saveSandboxReceipt({
        receiptId:      `rct_${i.toString(16).padStart(24, "0")}`,
        createdAt:      new Date(i * 1000).toISOString(),
        txHash:         "0x" + "ab".repeat(32),
        chain:          "bnb",
        payer:          "0x0000000000000000000000000000000000000000",
        recipient:      RECIPIENT,
        token:          "USDC",
        tokenAmount:    "1.00",
        tokenAmountRaw: "1000000000000000000",
        method:         "sandbox",
        sandbox:        true,
      }, path);
    }
    const map = readStore(path);
    assert.ok(Object.keys(map).length <= 1000, "entry count stays at or below 1000 after eviction");
  });

  test("saveSandboxReceipt does not throw on write error (corrupt directory)", () => {
    // Use a path where the parent is a file, not a directory — mkdir will fail.
    const file = makeTmpStorePath();
    writeFileSync(file, "placeholder", "utf-8");
    // Point store at a path whose parent is the file we just created (impossible dir).
    const badPath = join(file, "sub", "store.json");
    assert.doesNotThrow(
      () => saveSandboxReceipt({
        receiptId:      "rct_" + "ff".repeat(12),
        createdAt:      new Date().toISOString(),
        txHash:         "0x" + "cc".repeat(32),
        chain:          "bnb",
        payer:          "0x0000000000000000000000000000000000000000",
        recipient:      RECIPIENT,
        token:          "USDC",
        tokenAmount:    "1.00",
        tokenAmountRaw: "1000000000000000000",
        method:         "sandbox",
        sandbox:        true,
      }, badPath),
      "saveSandboxReceipt swallows write error",
    );
  });
});
