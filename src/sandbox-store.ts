/**
 * Local sandbox receipt store.
 *
 * Persists sandbox Trust Receipts to ~/.q402/sandbox-receipts.json so
 * q402_receipt can retrieve them without a relay round-trip. Real relay
 * traffic is completely unaffected.
 *
 * Safety invariants:
 *   - Missing or corrupt store file → empty map (no uncaught exception)
 *   - Size cap: refuse to grow the file past MAX_STORE_BYTES (512 KB)
 *   - Count cap: evict oldest entries when MAX_STORE_ENTRIES is exceeded
 *   - No production keys or relayer signatures are ever written here
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

export const SANDBOX_STORE_PATH = join(homedir(), ".q402", "sandbox-receipts.json");

/** 512 KB hard cap — same defensive posture as config.ts MAX_ENV_FILE_BYTES. */
const MAX_STORE_BYTES = 512 * 1024;
const MAX_STORE_ENTRIES = 1000;

export interface SandboxReceiptRecord {
  receiptId: string;
  createdAt: string;
  txHash: string;
  chain: string;
  payer: string;
  recipient: string;
  token: string;
  tokenAmount: string;
  tokenAmountRaw: string;
  method: string;
  sandbox: true;
}

type StoreMap = Record<string, SandboxReceiptRecord>;

/** Read the store, returning an empty map on any error (missing, corrupt, oversized). */
export function readStore(path = SANDBOX_STORE_PATH): StoreMap {
  try {
    if (!existsSync(path)) return {};
    const size = statSync(path).size;
    if (size > MAX_STORE_BYTES) {
      process.stderr.write(`[q402-mcp] sandbox store too large (${size} bytes); skipping read\n`);
      return {};
    }
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return parsed as StoreMap;
  } catch {
    return {};
  }
}

/** Persist the store map, swallowing write errors (best-effort). */
function writeStore(map: StoreMap, path = SANDBOX_STORE_PATH): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(map, null, 2), "utf-8");
  } catch (e) {
    process.stderr.write(
      `[q402-mcp] sandbox store write failed: ${e instanceof Error ? e.message : String(e)}\n`,
    );
  }
}

/** Retrieve a sandbox receipt by id, or null on miss. */
export function getSandboxReceipt(
  receiptId: string,
  path = SANDBOX_STORE_PATH,
): SandboxReceiptRecord | null {
  const map = readStore(path);
  return map[receiptId] ?? null;
}

/** Persist a sandbox receipt, applying size and count caps. */
export function saveSandboxReceipt(
  record: SandboxReceiptRecord,
  path = SANDBOX_STORE_PATH,
): void {
  const map = readStore(path);
  map[record.receiptId] = record;

  // Count cap: evict oldest entries by createdAt when over limit.
  const keys = Object.keys(map);
  if (keys.length > MAX_STORE_ENTRIES) {
    const sorted = keys.sort((a, b) => {
      const ta = map[a]?.createdAt ?? "";
      const tb = map[b]?.createdAt ?? "";
      return ta < tb ? -1 : ta > tb ? 1 : 0;
    });
    const excess = sorted.slice(0, keys.length - MAX_STORE_ENTRIES);
    for (const k of excess) delete map[k];
  }

  // Size guard: if the serialized map would exceed the cap, skip the write.
  const serialized = JSON.stringify(map, null, 2);
  if (Buffer.byteLength(serialized, "utf-8") > MAX_STORE_BYTES) {
    process.stderr.write("[q402-mcp] sandbox store would exceed size cap; skipping write\n");
    return;
  }

  writeStore(map, path);
}
