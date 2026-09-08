#!/usr/bin/env node
/**
 * check-chain-copy.mjs
 * CI guard: rejects hardcoded chain-availability claims in user-facing source.
 *
 * Hard patterns (always rejected — these strings are stale the moment any
 * deployment state changes):
 *   "not yet deployed"  |  "vault is not deployed"  |
 *   "Live on BNB mainnet"  |  "enum wired"
 *
 * Contextual patterns (rejected when "escrow" or "vault" also appears on the
 * same line — chain names in escrow/vault descriptions become stale when vaults
 * are added or removed):
 *   "Base Sepolia"  |  "BNB Chain"  |  "Avalanche"
 *
 * Exemption: add  // chain-copy-allow: <reason>  on the offending line to
 * suppress the check. A bare "// chain-copy-allow:" with no reason is itself a
 * violation — the reason must be present so reviewers understand why the value
 * is safe to hardcode.
 *
 * On any hit the error message says:
 *   → Replace with a runtime read from /api/escrow/chains (or the relevant
 *     truth source).
 *
 * Usage: node scripts/check-chain-copy.mjs
 */
import { readFileSync, readdirSync, existsSync, statSync } from "fs";
import { join } from "path";

// ---------------------------------------------------------------------------
// Pattern definitions
// ---------------------------------------------------------------------------

const HARD = [
  { re: /not yet deployed/i,          label: '"not yet deployed"' },
  { re: /vault is not deployed/i,     label: '"vault is not deployed"' },
  { re: /\bLive on BNB mainnet\b/i,   label: '"Live on BNB mainnet"' },
  { re: /\benum wired\b/i,            label: '"enum wired"' },
  { re: /\btestnet only\b/i,          label: '"testnet only"' },
];

// Chain names that are suspicious when "escrow" or "vault" also appears on the
// same line — pairing chain names with those words bakes in a specific topology
// that will drift as vaults are added or removed.
const CHAIN_RES = [
  /\bBase Sepolia\b/,
  /\bBNB Chain\b/,
  /\bAvalanche\b/,
];
const CONTEXT_RE = /\b(escrow|vault)\b/i;

// Exemption markers for code files.
const ALLOW_RE      = /\/\/\s*chain-copy-allow:\s*\S/;
const ALLOW_BARE_RE = /\/\/\s*chain-copy-allow:\s*$/;

const FIX_HINT = "  → Replace with a runtime read from /api/escrow/chains (or the relevant truth source).";
const EXEMPT   = "  → To suppress: add  // chain-copy-allow: <reason>  on this line.";

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

function walk(dir, exts, excludes) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const rel of readdirSync(dir, { recursive: true })) {
    const full = join(dir, rel).replace(/\\/g, "/");
    try { if (statSync(full).isDirectory()) continue; } catch { continue; }
    if (!exts.some((e) => full.endsWith(e))) continue;
    if (excludes.some((ex) => full.includes(ex))) continue;
    out.push(full);
  }
  return out;
}

// Detect which repo we're running in by checking for well-known directories.
const isInstitutional = existsSync("app/api") && existsSync("app/components");

let files;
if (isInstitutional) {
  files = walk("app", [".tsx", ".ts"], [
    // escrow-contracts.ts is the truth-source config; scanning it would be
    // circular (chain names there are definitions, not availability claims).
    "app/lib/escrow-contracts.ts",
    "node_modules",
    ".next",
  ]);
} else {
  // q402-mcp: TypeScript sources + public README.
  files = [
    ...walk("src", [".ts"], ["node_modules", "/dist/", "/dist-test/"]),
    ...(existsSync("README.md") ? ["README.md"] : []),
  ];
}

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

let errors = 0;

for (const file of files) {
  let text;
  try { text = readFileSync(file, "utf8"); } catch { continue; }
  const lines = text.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const loc  = `${file}:${i + 1}`;

    // Bare allow comment (no reason) is itself a violation.
    if (ALLOW_BARE_RE.test(line)) {
      console.error(`${loc}: chain-copy-allow requires a reason after the colon`);
      console.error("  → // chain-copy-allow: <explain why this hardcoded value is safe>");
      errors++;
      continue;
    }
    // Line is explicitly exempted with a reason — skip all pattern checks.
    if (ALLOW_RE.test(line)) continue;

    // Hard patterns — always a violation regardless of context.
    let hit = false;
    for (const { re, label } of HARD) {
      if (!re.test(line)) continue;
      console.error(`${loc}: hardcoded availability claim ${label}`);
      console.error(FIX_HINT);
      console.error(EXEMPT);
      errors++;
      hit = true;
      break;
    }
    if (hit) continue;

    // Contextual check: chain name AND escrow/vault keyword on the same line.
    for (const cre of CHAIN_RES) {
      if (!cre.test(line)) continue;
      if (!CONTEXT_RE.test(line)) continue;
      const m = line.match(cre);
      console.error(`${loc}: hardcoded chain name "${m[0]}" in escrow/vault context`);
      console.error(FIX_HINT);
      console.error(EXEMPT);
      errors++;
      break;
    }
  }
}

if (errors > 0) {
  console.error(`\nchain-copy check: ${errors} violation(s) found.`);
  console.error("Fix them or add  // chain-copy-allow: <reason>  to suppress per-line.");
  process.exit(1);
}

console.log(`chain-copy check passed — ${files.length} file(s) scanned, 0 violations.`);
