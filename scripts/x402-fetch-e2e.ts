/**
 * x402-fetch e2e script — Base mainnet, real payment.
 *
 * Demonstrates the full 402 → sign → retry → 200 flow against a live x402
 * endpoint. Private key stays in process memory only (never written to disk).
 *
 * Usage:
 *   X402_PRIVATE_KEY=0x<64-hex> npx ts-node scripts/x402-fetch-e2e.ts [URL]
 *
 * Default URL: https://weather.payapi.market/current (real x402 ecosystem endpoint,
 * uses POST + JSON body; accepts network=eip155:8453 / base / base-mainnet + Base USDC).
 * You can substitute any Base x402 endpoint that returns a valid 402 with
 * scheme=exact / network=base|base-mainnet|eip155:8453 / asset=Base USDC.
 *
 * NOTE: This script sends a REAL on-chain USDC payment on Base mainnet.
 *       Run only when you intend to spend real funds.
 *       Lynn runs this locally for mainnet acceptance; the agent does NOT
 *       execute this script autonomously.
 *
 * Output is designed to be copy-pasteable for the PR description.
 */

import { Wallet, hexlify, randomBytes } from "ethers";

const BASE_CHAIN_ID = 8453;
const BASE_USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const BASE_USDC_DECIMALS = 6;

const EIP3009_DOMAIN = {
  name: "USD Coin",
  version: "2",
  chainId: BASE_CHAIN_ID,
  verifyingContract: BASE_USDC_ADDRESS,
} as const;

const EIP3009_TYPES = {
  TransferWithAuthorization: [
    { name: "from",        type: "address" },
    { name: "to",          type: "address" },
    { name: "value",       type: "uint256" },
    { name: "validAfter",  type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce",       type: "bytes32" },
  ],
} as const;

function log(msg: string): void {
  process.stdout.write(msg + "\n");
}

function separator(): void {
  log("─".repeat(60));
}

async function main(): Promise<void> {
  const privateKey = process.env["X402_PRIVATE_KEY"];
  if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    log("ERROR: X402_PRIVATE_KEY env var is required (0x + 64 hex chars).");
    log("  X402_PRIVATE_KEY=0x<key> npx ts-node scripts/x402-fetch-e2e.ts [URL]");
    process.exit(1);
  }

  const targetUrl = process.argv[2] ?? "https://weather.payapi.market/current";
  // weather.payapi.market/current requires POST with a JSON body; fall back to GET for other URLs.
  const isWeatherDefault = targetUrl === "https://weather.payapi.market/current";
  const method = isWeatherDefault ? "POST" : "GET";
  const requestBody = isWeatherDefault ? JSON.stringify({ location: "San Francisco" }) : undefined;

  const wallet = new Wallet(privateKey);
  const walletAddress = await wallet.getAddress();

  separator();
  log("q402_x402_fetch — Base mainnet e2e");
  separator();
  log(`Target URL  : ${targetUrl}`);
  log(`Payer wallet: ${walletAddress}`);
  log(`Chain       : Base (${BASE_CHAIN_ID})`);
  log(`Asset       : Base USDC (${BASE_USDC_ADDRESS})`);
  separator();

  // ── Step 1: initial fetch ──────────────────────────────────────────────────
  log("Step 1: initial fetch");
  let resp1: Response;
  try {
    resp1 = await fetch(targetUrl, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(requestBody !== undefined ? { body: requestBody } : {}),
    });
  } catch (e) {
    log(`FAIL: initial fetch threw: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
  log(`  HTTP ${resp1.status} ${resp1.statusText}`);

  if (resp1.status !== 402) {
    const body = await resp1.text();
    log(`  Non-402 response — no payment needed.`);
    log(`  Body: ${body.slice(0, 300)}`);
    process.exit(0);
  }

  // ── Step 2: parse 402 body ─────────────────────────────────────────────────
  log("Step 2: parse payment requirements");
  let payReq: {
    version?: number;
    accepts: Array<{
      scheme: string; network: string; asset: string;
      amount: string; payTo: string; maxTimeoutSeconds?: number;
    }>;
  };
  try {
    payReq = (await resp1.json()) as typeof payReq;
  } catch {
    log("FAIL: 402 body is not valid JSON");
    process.exit(1);
  }

  if (!Array.isArray(payReq.accepts) || payReq.accepts.length === 0) {
    log("FAIL: 402 body missing accepts[]");
    process.exit(1);
  }

  log(`  x402 version: ${payReq.version ?? "(unset)"}`);
  log(`  accepts count: ${payReq.accepts.length}`);
  for (const a of payReq.accepts) {
    log(`    scheme=${a.scheme} network=${a.network} asset=${a.asset} amount=${a.amount} payTo=${a.payTo}`);
  }

  // ── Step 3: select supported option ───────────────────────────────────────
  const req = payReq.accepts.find(
    a => a.scheme === "exact" &&
         (a.network === "base" || a.network === "base-mainnet" || a.network === "eip155:8453") &&
         a.asset.toLowerCase() === BASE_USDC_ADDRESS.toLowerCase(),
  );
  if (!req) {
    log("FAIL: no supported payment option (need scheme=exact + network=base|base-mainnet|eip155:8453 + Base USDC)");
    process.exit(1);
  }

  const amountUsd = (Number(req.amount) / 10 ** BASE_USDC_DECIMALS).toFixed(6);
  log(`\nSelected: $${amountUsd} USDC → ${req.payTo}`);
  separator();

  // ── Step 4: sign EIP-3009 ─────────────────────────────────────────────────
  log("Step 3: sign EIP-3009 TransferWithAuthorization");
  const nonce = hexlify(randomBytes(32));
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + (req.maxTimeoutSeconds ?? 300));
  const amountRaw = BigInt(req.amount);

  let signature: string;
  try {
    signature = await wallet.signTypedData(
      EIP3009_DOMAIN,
      EIP3009_TYPES,
      {
        from: walletAddress,
        to: req.payTo,
        value: amountRaw,
        validAfter: 0n,
        validBefore,
        nonce,
      },
    );
  } catch (e) {
    log(`FAIL: signing failed: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
  log(`  from       : ${walletAddress}`);
  log(`  to         : ${req.payTo}`);
  log(`  value      : ${req.amount} (atomic USDC)`);
  log(`  validBefore: ${validBefore}`);
  log(`  nonce      : ${nonce}`);
  log(`  signature  : ${signature.slice(0, 20)}…`);

  // ── Step 5: build X-PAYMENT header ────────────────────────────────────────
  log("\nStep 4: build X-PAYMENT header (x402 v2)");
  const payloadObj = {
    x402Version: 2,
    accepted: {
      scheme: "exact",
      network: req.network,
      payload: {
        signature,
        authorization: {
          from:        walletAddress,
          to:          req.payTo,
          value:       req.amount,
          validAfter:  "0",
          validBefore: validBefore.toString(),
          nonce,
        },
      },
    },
  };
  const xPayment = Buffer.from(JSON.stringify(payloadObj)).toString("base64");
  log(`  X-PAYMENT (first 60 chars): ${xPayment.slice(0, 60)}…`);

  // ── Step 6: retry with payment ────────────────────────────────────────────
  log("\nStep 5: retry with X-PAYMENT header");
  let resp2: Response;
  try {
    resp2 = await fetch(targetUrl, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-PAYMENT": xPayment,
      },
      ...(requestBody !== undefined ? { body: requestBody } : {}),
    });
  } catch (e) {
    log(`FAIL: retry fetch threw: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
  log(`  HTTP ${resp2.status} ${resp2.statusText}`);

  const body2 = await resp2.text();

  separator();
  if (resp2.ok) {
    log("PASS: 402 → sign → retry → 200");
    log(`Response body:\n${body2.slice(0, 500)}`);
  } else {
    log(`FAIL: retry returned HTTP ${resp2.status}`);
    log(`Response body:\n${body2.slice(0, 500)}`);
    process.exit(1);
  }
  separator();
  log(`Paid $${amountUsd} USDC to ${req.payTo} via EIP-3009 on Base`);
  log(`Payer: ${walletAddress}`);
  separator();
}

main().catch(err => {
  process.stderr.write(`fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
