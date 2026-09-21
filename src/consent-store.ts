/**
 * Local persistent store for consent token records.
 *
 * Each call to issueConsentToken writes one record here. On consumption,
 * consumedAt is stamped. Records survive process restarts so tokens cannot be
 * replayed across sessions (AC-4).
 *
 * Follows the same defensive posture as x402-audit-store.ts:
 *   - Missing or corrupt file → empty map (no uncaught exception)
 *   - Size cap: refuse to grow past MAX_STORE_BYTES (256 KB)
 *   - Count cap: evict oldest entries when MAX_STORE_ENTRIES is exceeded
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

export const CONSENT_STORE_PATH = join(homedir(), ".q402", "consent-tokens.json");

const MAX_STORE_BYTES = 256 * 1024;
const MAX_STORE_ENTRIES = 5000;

/** Consent TTL: tokens older than this are rejected. */
export const CONSENT_TTL_MS = 120_000;

/** Hard gate: consumption faster than this is rejected and marked. */
export const CONSENT_MIN_AGE_MS = 2_000;

export interface ConsentRecord {
  token: string;
  /** sha256 hex (with 0x prefix) of canonicalIntent */
  intentHash: string;
  issuedAt: string;
  consumedAt?: string;
  /** true when the token was rejected because it was consumed too quickly */
  tooFast?: boolean;
}

type StoreMap = Record<string, ConsentRecord>;

export function readConsentStore(path = CONSENT_STORE_PATH): StoreMap {
  try {
    if (!existsSync(path)) return {};
    const size = statSync(path).size;
    if (size > MAX_STORE_BYTES) {
      process.stderr.write(`[q402-mcp] consent store too large (${size} bytes); skipping read\n`);
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

function writeConsentStore(map: StoreMap, path = CONSENT_STORE_PATH): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(map, null, 2), "utf-8");
  } catch (e) {
    process.stderr.write(
      `[q402-mcp] consent store write failed: ${e instanceof Error ? e.message : String(e)}\n`,
    );
  }
}

export function saveConsentRecord(record: ConsentRecord, path = CONSENT_STORE_PATH): void {
  const map = readConsentStore(path);
  map[record.token] = record;

  const keys = Object.keys(map);
  if (keys.length > MAX_STORE_ENTRIES) {
    const sorted = keys.sort((a, b) => {
      const ta = map[a]?.issuedAt ?? "";
      const tb = map[b]?.issuedAt ?? "";
      return ta < tb ? -1 : ta > tb ? 1 : 0;
    });
    for (const k of sorted.slice(0, keys.length - MAX_STORE_ENTRIES)) {
      delete map[k];
    }
  }

  const serialized = JSON.stringify(map, null, 2);
  if (Buffer.byteLength(serialized, "utf-8") > MAX_STORE_BYTES) {
    process.stderr.write("[q402-mcp] consent store would exceed size cap; skipping write\n");
    return;
  }
  writeConsentStore(map, path);
}

export function lookupConsentRecord(
  token: string,
  path = CONSENT_STORE_PATH,
): ConsentRecord | undefined {
  return readConsentStore(path)[token];
}

export function updateConsentRecord(
  token: string,
  updates: { consumedAt: string; tooFast?: boolean },
  path = CONSENT_STORE_PATH,
): void {
  const map = readConsentStore(path);
  const existing = map[token];
  if (!existing) return;
  map[token] = { ...existing, ...updates };
  writeConsentStore(map, path);
}
