import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
const tw = readFileSync(join(homedir(), ".q402", "test-wallet.env"), "utf8");
process.env.Q402_AGENTIC_PRIVATE_KEY = tw.match(/^Q402_TEST_PRIVATE_KEY=(.+)$/m)[1].trim();
process.env.Q402_ENABLE_REAL_PAYMENTS = "1";
process.env.Q402_BUILDER_CODE = "OFF-INVALID";

const origFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const h = new Headers(init?.headers || {});
  const xp = h.get("x-payment");
  if (xp) writeFileSync("/tmp/ours-xpayment.json", JSON.stringify(JSON.parse(Buffer.from(xp, "base64").toString()), null, 2));
  return origFetch(input, init);
};

const { runX402Fetch } = await import("./dist-runner/x402-runner.js");
const url = "https://api.bitrefill.com/x402/gift-cards/search?q=steam";
const first = await runX402Fetch({ url, method: "GET", confirm: true });
if (first.needsConsent) {
  const second = await runX402Fetch({ url, method: "GET", confirm: true, consentToken: first.needsConsent.consentToken });
  console.log("result:", second.statusCode, second.paid ? "PAID" : (second.error||"").slice(0,80));
}
