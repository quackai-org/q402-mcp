/**
 * Local persistent store for outbound-x402 payment audit records.
 *
 * Each invocation of q402_x402_fetch that encounters a 402 response writes
 * one record here — whether or not the payment ultimately settles. Blocked
 * attempts (guard-rejected) are also recorded so the spend report can surface
 * the full picture of what the agent tried to pay.
 *
 * Follows the same defensive posture as sandbox-store.ts:
 *   - Missing or corrupt file → empty map (no uncaught exception)
 *   - Size cap: refuse to grow the file past MAX_STORE_BYTES (512 KB)
 *   - Count cap: evict oldest entries when MAX_STORE_ENTRIES is exceeded
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

export const X402_AUDIT_PATH = join(homedir(), ".q402", "x402-audit.json");

const MAX_STORE_BYTES = 512 * 1024;
const MAX_STORE_ENTRIES = 5000;

export type X402AuditStatus =
  | "blocked_by_guard"
  | "sign_failed"
  | "retry_failed"
  | "settled";

export interface X402AuditRecord {
  id: string;
  timestamp: string;
  url: string;
  method: string;
  payTo: string;
  asset: string;
  network: string;
  amountAtomic: string;
  amountUsd: string;
  status: X402AuditStatus;
  blockedReason?: string;
  settlementStatusCode?: number;
  responseExcerpt?: string;
}

type StoreMap = Record<string, X402AuditRecord>;

export function readX402Audit(path = X402_AUDIT_PATH): StoreMap {
  try {
    if (!existsSync(path)) return {};
    const size = statSync(path).size;
    if (size > MAX_STORE_BYTES) {
      process.stderr.write(`[q402-mcp] x402 audit too large (${size} bytes); skipping read\n`);
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

function writeX402Audit(map: StoreMap, path = X402_AUDIT_PATH): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(map, null, 2), "utf-8");
  } catch (e) {
    process.stderr.write(
      `[q402-mcp] x402 audit write failed: ${e instanceof Error ? e.message : String(e)}\n`,
    );
  }
}

export function saveX402AuditRecord(record: X402AuditRecord, path = X402_AUDIT_PATH): void {
  const map = readX402Audit(path);
  map[record.id] = record;

  const keys = Object.keys(map);
  if (keys.length > MAX_STORE_ENTRIES) {
    const sorted = keys.sort((a, b) => {
      const ta = map[a]?.timestamp ?? "";
      const tb = map[b]?.timestamp ?? "";
      return ta < tb ? -1 : ta > tb ? 1 : 0;
    });
    for (const k of sorted.slice(0, keys.length - MAX_STORE_ENTRIES)) {
      delete map[k];
    }
  }

  const serialized = JSON.stringify(map, null, 2);
  if (Buffer.byteLength(serialized, "utf-8") > MAX_STORE_BYTES) {
    process.stderr.write("[q402-mcp] x402 audit would exceed size cap; skipping write\n");
    return;
  }
  writeX402Audit(map, path);
}

export function listX402AuditRecords(
  window: "24h" | "7d" | "30d" | "all" = "7d",
  path = X402_AUDIT_PATH,
): X402AuditRecord[] {
  const map = readX402Audit(path);
  const all = Object.values(map);
  if (window === "all") return all.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  const windowMs: Record<string, number> = {
    "24h": 24 * 60 * 60 * 1000,
    "7d":  7  * 24 * 60 * 60 * 1000,
    "30d": 30 * 24 * 60 * 60 * 1000,
  };
  const cutoff = new Date(Date.now() - (windowMs[window] ?? windowMs["7d"]!)).toISOString();
  return all
    .filter(r => r.timestamp >= cutoff)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}
