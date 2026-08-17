import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Wallet, hexlify, randomBytes } from "ethers";

const tw = readFileSync(join(homedir(), ".q402", "test-wallet.env"), "utf8");
const wallet = new Wallet(tw.match(/^Q402_TEST_PRIVATE_KEY=(.+)$/m)[1].trim());

const URL_T = "https://weather.payapi.market/current?city=Singapore";
// 先拉它的 402 报价拿 payTo/amount/network 命名
const chal = await (await fetch(URL_T)).json();
const acc = chal.accepts.find(a => (a.network||"").includes("8453") || a.network==="base");
console.log("challenge accepts[0]:", JSON.stringify({network:acc.network, amount:acc.maxAmountRequired||acc.amount, payTo:acc.payTo, extra:acc.extra}).slice(0,220));
const AMOUNT = acc.maxAmountRequired || acc.amount;
const PAY_TO = acc.payTo;
const USDC = acc.asset;
const name = acc.extra?.name || "USD Coin", version = acc.extra?.version || "2";

const domain = { name, version, chainId: 8453, verifyingContract: USDC };
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
const payload = s => ({ signature: s.sig, authorization: { from: s.from, to: PAY_TO, value: AMOUNT, validAfter: "0", validBefore: s.validBefore, nonce: s.nonce } });
const variants = {
  "toplevel_net_as_challenge": s => ({ x402Version: 2, scheme: "exact", network: acc.network, payload: payload(s) }),
  "toplevel_v1_base": s => ({ x402Version: 1, scheme: "exact", network: "base", payload: payload(s) }),
  "accepted_wrapper_v2": s => ({ x402Version: 2, accepted: { scheme: "exact", network: acc.network, payload: payload(s) } }),
};
for (const [n, b] of Object.entries(variants)) {
  const s = await sign();
  const h = Buffer.from(JSON.stringify(b(s))).toString("base64");
  const r = await fetch(URL_T, { headers: { "X-PAYMENT": h } });
  const body = await r.text();
  console.log(`[${n}] HTTP ${r.status} :: ${body.slice(0, 200).replace(/\n/g," ")}`);
  if (r.status === 200) { console.log("payment-response:", (r.headers.get("payment-response")||r.headers.get("x-payment-response")||"").slice(0,200)); break; }
}
