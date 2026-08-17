#!/usr/bin/env node
// Q402 Connect — x402 payment runner (test wallet, Base USDC)
// Usage: node pay.mjs <url> [method] [jsonBody]
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Load test wallet key into process env BEFORE importing the client
// (process env overrides ~/.q402/mcp.env values; mcp.env is untouched).
const tw = readFileSync(join(homedir(), ".q402", "test-wallet.env"), "utf8");
const m = tw.match(/^Q402_TEST_PRIVATE_KEY=(.+)$/m);
if (!m) { console.error("test wallet key not found"); process.exit(1); }
process.env.Q402_AGENTIC_PRIVATE_KEY = m[1].trim();
process.env.Q402_ENABLE_REAL_PAYMENTS = "1";
process.env.Q402_BUILDER_CODE = "bc_fu2v7kgf";

const { runX402Fetch } = await import("./dist-runner/x402-runner.js");

const [url, method = "GET", body] = process.argv.slice(2);
if (!url) { console.error("usage: node pay.mjs <url> [method] [jsonBody]"); process.exit(1); }

console.log(`→ ${method} ${url}`);
const input = { url, method, confirm: true, ...(body ? { body } : {}) };
const first = await runX402Fetch(input);

if (first.needsConsent) {
  console.log(`  402 Payment Required — ${first.needsConsent.preview.replace(/\n/g, "\n  ")}`);
  console.log("  paying with Q402 Connect (x402 exact / Base USDC) ...");
  const second = await runX402Fetch({ ...input, consentToken: first.needsConsent.consentToken });
  report(second);
} else {
  report(first);
}

function report(r) {
  if (r.delegationBlocked) { console.log("  BLOCKED:", r.delegationBlocked.why); process.exit(2); }
  console.log(`  status: ${r.statusCode}  paid: ${r.paid ?? false}  amount: $${r.amountUsd ?? "0"}  payTo: ${r.payTo ?? "-"}`);
  if (r.error) console.log("  error:", r.error);
  if (r.body) {
    const trimmed = r.body.length > 400 ? r.body.slice(0, 400) + " …" : r.body;
    console.log("  response:", trimmed);
  }
  console.log(r.success && r.paid ? "  ✓ PAYMENT SETTLED" : (r.success ? "  ✓ OK (no payment needed)" : "  ✗ FAILED"));
}
