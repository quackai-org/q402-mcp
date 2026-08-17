// X-PAYMENT header format variant tester — finds which shape the facilitator accepts.
// Failed settles cost nothing; the first success IS the real A2 payment ($0.02).
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Wallet, hexlify, randomBytes } from "ethers";

const tw = readFileSync(join(homedir(), ".q402", "test-wallet.env"), "utf8");
const key = tw.match(/^Q402_TEST_PRIVATE_KEY=(.+)$/m)[1].trim();
const wallet = new Wallet(key);

const URL_T = "https://q402.quackai.ai/api/x402/agent-trust/0x0000000000000000000000000000000000000001";
const PAY_TO = "0x9bbbb98e11e7be968bf4a02701c6e29fffd51d6b";
const AMOUNT = "20000";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

const domain = { name: "USD Coin", version: "2", chainId: 8453, verifyingContract: USDC };
const types = { TransferWithAuthorization: [
  { name: "from", type: "address" }, { name: "to", type: "address" },
  { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" },
  { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
]};

async function sign() {
  const nonce = hexlify(randomBytes(32));
  const validBefore = BigInt(Math.floor(Date.now()/1000) + 300);
  const from = await wallet.getAddress();
  const sig = await wallet.signTypedData(domain, types, { from, to: PAY_TO, value: BigInt(AMOUNT), validAfter: 0n, validBefore, nonce });
  return { from, sig, nonce, validBefore: validBefore.toString() };
}

function payload(s) {
  return { signature: s.sig, authorization: { from: s.from, to: PAY_TO, value: AMOUNT, validAfter: "0", validBefore: s.validBefore, nonce: s.nonce } };
}

const variants = {
  "B_v2_toplevel_caip2": (s) => ({ x402Version: 2, scheme: "exact", network: "eip155:8453", payload: payload(s) }),
  "C_v1_toplevel_caip2": (s) => ({ x402Version: 1, scheme: "exact", network: "eip155:8453", payload: payload(s) }),
  "D_v1_toplevel_base":  (s) => ({ x402Version: 1, scheme: "exact", network: "base", payload: payload(s) }),
};

for (const [name, build] of Object.entries(variants)) {
  const s = await sign();  // fresh nonce per attempt
  const header = Buffer.from(JSON.stringify(build(s))).toString("base64");
  const resp = await fetch(URL_T, { headers: { "X-PAYMENT": header } });
  const body = await resp.text();
  const payResp = resp.headers.get("payment-response") || resp.headers.get("x-payment-response") || "";
  console.log(`[${name}] HTTP ${resp.status}`);
  if (resp.status === 200) {
    console.log("  ✓ SETTLED. payment-response:", payResp.slice(0, 200));
    console.log("  body:", body.slice(0, 300));
    break;
  } else {
    try { const j = JSON.parse(body); console.log("  err:", (j.error||"").slice(0,120)); } catch { console.log("  body:", body.slice(0,120)); }
  }
}
