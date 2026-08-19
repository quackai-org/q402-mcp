// AC-B3 live verification: trial-sponsored gasless USDC transfer on Base.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
const tw = readFileSync(join(homedir(), ".q402", "test-wallet.env"), "utf8");
process.env.Q402_AGENTIC_PRIVATE_KEY = tw.match(/^Q402_TEST_PRIVATE_KEY=(.+)$/m)[1].trim();
process.env.Q402_ENABLE_REAL_PAYMENTS = "1";
const { runPay } = await import("./dist-payrunner/pay-runner.js");
const input = { to: "0x9bbBB98E11E7bE968bF4A02701C6e29fFFD51D6B", amount: "0.01", token: "USDC", chain: "base", keyScope: "trial", walletMode: "agentic-local", confirm: true };
const first = await runPay(input);
if (first.needsConsent) {
  console.log("preview ok, paying with TRIAL key on BASE ...");
  const second = await runPay({ ...input, consentToken: first.needsConsent.consentToken });
  const r = second.result ?? second;
  console.log(JSON.stringify(second, null, 1).slice(0, 1800));
} else {
  console.log(JSON.stringify(first).slice(0,400));
}
