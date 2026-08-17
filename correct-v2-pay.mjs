// Correct x402 v2 payment per official @x402/core schema.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Wallet, hexlify, randomBytes } from "ethers";

const tw = readFileSync(join(homedir(), ".q402", "test-wallet.env"), "utf8");
const wallet = new Wallet(tw.match(/^Q402_TEST_PRIVATE_KEY=(.+)$/m)[1].trim());
const url = process.argv[2];
const method = process.argv[3] || "GET";
const body = process.argv[4];

// 1. Get challenge (body JSON or PAYMENT-REQUIRED header)
const init = { method, ...(body ? { headers: {"Content-Type":"application/json"}, body } : {}) };
const chalResp = await fetch(url, init);
let chal;
const hdr = chalResp.headers.get("payment-required");
if (hdr) chal = JSON.parse(Buffer.from(hdr, "base64").toString());
else chal = await chalResp.json();
if (chalResp.status !== 402) { console.log("no 402, got", chalResp.status); process.exit(1); }

const acc = chal.accepts.find(a => a.network === "eip155:8453" || a.network === "base");
const amount = acc.amount ?? acc.maxAmountRequired;
console.log(`challenge: v${chal.x402Version} amount=${amount} payTo=${acc.payTo}`);

// 2. Sign EIP-3009
const extra = acc.extra || {};
const domain = { name: extra.name || "USD Coin", version: extra.version || "2", chainId: 8453, verifyingContract: acc.asset };
const types = { TransferWithAuthorization: [
  { name: "from", type: "address" }, { name: "to", type: "address" },
  { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" },
  { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
]};
const nonce = hexlify(randomBytes(32));
const now = Math.floor(Date.now()/1000);
const validBefore = BigInt(now + Math.max(600, (acc.maxTimeoutSeconds||300)*2));
const from = wallet.address;
const sig = await wallet.signTypedData(domain, types, { from, to: acc.payTo, value: BigInt(amount), validAfter: 0n, validBefore, nonce });

// 3. Build official v2 PaymentPayload: accepted = chosen requirements VERBATIM, payload top-level
const paymentPayload = {
  x402Version: 2,
  ...(chal.resource ? { resource: chal.resource } : {}),
  accepted: acc,
  payload: { signature: sig, authorization: { from, to: acc.payTo, value: String(amount), validAfter: "0", validBefore: validBefore.toString(), nonce } },
  extensions: { "builder-code": { s: "bc_fu2v7kgf" } },
};
const xp = Buffer.from(JSON.stringify(paymentPayload)).toString("base64");

// 4. Retry with X-PAYMENT
const resp2 = await fetch(url, { ...init, headers: { ...(init.headers||{}), "X-PAYMENT": xp } });
console.log("HTTP", resp2.status);
const pr = resp2.headers.get("payment-response") || resp2.headers.get("x-payment-response");
if (pr) { try { console.log("payment-response:", Buffer.from(pr,"base64").toString().slice(0,350)); } catch { console.log("pr:", pr.slice(0,200)); } }
console.log("body:", (await resp2.text()).slice(0, 250).replace(/\n/g," "));
