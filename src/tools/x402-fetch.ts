/**
 * q402_x402_fetch — generic x402 client tool.
 *
 * Flow:
 *   1. GET/POST target URL.
 *   2. Non-402 response → return body directly (pass-through fetch).
 *   3. 402 response → parse x402 v2 `accepts[]`, validate scheme/network/asset.
 *   4. Run guards: per-call maxAmountGuard, per-session cumulative cap, consentToken.
 *   5. Sign EIP-3009 TransferWithAuthorization against Base USDC domain.
 *   6. Encode payment payload and retry: v2 challenge → PAYMENT-SIGNATURE header; v1 → X-PAYMENT.
 *   7. Return 200 response body.
 *
 * Every 402 attempt (blocked or settled) is written to the local x402 audit
 * store and surfaced via q402_agent_spend_report.
 *
 * Security constraints:
 *   - recipientGuard is intentionally NOT applied (payTo is a third-party seller).
 *   - No call to /api/relay — the signed EIP-3009 auth goes to the seller/facilitator.
 *   - Real payments only when Q402_ENABLE_REAL_PAYMENTS=1 AND a local signing key is set.
 */

import { Wallet, hexlify, parseUnits, randomBytes } from "ethers";
import { z } from "zod";
import { CONFIG, isValidPrivateKey, ENV } from "../config.js";
import {
  checkConsent,
  maxAmountGuard,
  getSessionSpendUsd,
  resetSessionSpendUsd,
  addSessionSpend,
  getSessionCapUsd,
} from "../guards.js";
import {
  saveX402AuditRecord,
  type X402AuditRecord,
  type X402AuditStatus,
} from "./x402-audit-store.js";

// ── Constants ──────────────────────────────────────────────────────────────────

const BASE_CHAIN_ID = 8453;
const BASE_USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const BASE_USDC_ADDRESS_LC = BASE_USDC_ADDRESS.toLowerCase();
const BASE_USDC_DECIMALS = 6;

// EIP-7702 delegation bytecode prefix (3 bytes): designates an EOA that has
// delegated its code to a contract via SET_CODE_TX (EIP-7702).
const EIP7702_PREFIX = "0xef0100";
// Canonical Base mainnet RPC — mirrors DEFAULT_RPC[8453] in client.ts.
const BASE_RPC_URL = "https://mainnet.base.org";

// EIP-712 domain for Base USDC (Circle V2.2)
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
};

// Re-export session helpers so existing test imports from this module still resolve.
export { getSessionSpendUsd, resetSessionSpendUsd } from "../guards.js";

// ── EIP-7702 delegation guard ──────────────────────────────────────────────────
// Overridable in tests — null re-enables the real eth_getCode path.
let _delegationCheckOverride: ((address: string) => Promise<boolean>) | null = null;

/** Inject a stub in tests; pass null to restore the real eth_getCode check. */
export function _setDelegationCheck(fn: ((address: string) => Promise<boolean>) | null): void {
  _delegationCheckOverride = fn;
}

type DelegationStatus = "delegated" | "clear" | "check_skipped";

/**
 * Returns "delegated" if eth_getCode for the address on Base starts with the
 * EIP-7702 prefix (0xef0100), "clear" if it does not, or "check_skipped" if
 * the RPC call fails — in which case the caller should proceed but add a
 * delegation possibility hint to any subsequent settlement failure.
 */
async function checkEip7702Delegation(address: string): Promise<DelegationStatus> {
  if (_delegationCheckOverride !== null) {
    return (await _delegationCheckOverride(address)) ? "delegated" : "clear";
  }
  try {
    const resp = await fetch(BASE_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getCode",
        params: [address, "latest"],
      }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!resp.ok) return "check_skipped";
    const data = await resp.json() as { result?: string };
    const code = (data.result ?? "").toLowerCase();
    return code.startsWith(EIP7702_PREFIX) ? "delegated" : "clear";
  } catch {
    return "check_skipped";
  }
}

// Read env dynamically so test overrides to process.env are respected.
// Falls back to ENV (which contains ~/.q402/mcp.env values loaded at startup).
function dynEnv(key: string): string | undefined {
  return process.env[key] ?? (ENV as Record<string, string | undefined>)[key];
}

// ── Input schema ───────────────────────────────────────────────────────────────

export const X402FetchInputSchema = z.object({
  url: z.string().min(1).describe("Target URL to fetch (GET/POST/…)."),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).optional(),
  body: z.string().optional().describe("Request body for POST/PUT/PATCH (string)."),
  confirm: z.literal(true).describe(
    "MUST be true. This tool can trigger on-chain payments; caller attests the user approved.",
  ),
  consentToken: z.string().optional().describe(
    "Two-phase payment consent. Omit on first call when you don't yet know a 402 will be " +
    "returned — the tool responds with needs_confirmation + a token if a 402 is encountered. " +
    "Re-call with the same args plus this token to authorise the payment.",
  ),
});
export type X402FetchInput = z.infer<typeof X402FetchInputSchema>;

// ── x402 v2 response schema ────────────────────────────────────────────────────

// `.passthrough()` keeps fields we don't model (extra, mimeType, description…):
// the v2 X-PAYMENT header must echo the chosen requirement VERBATIM under
// `accepted`, so dropping unknown keys corrupts the payment. `amount` is the
// v2 name; v1-era sellers send `maxAmountRequired` — accept either.
const X402RequirementSchema = z.object({
  scheme:             z.string(),
  network:            z.string(),
  asset:              z.string(),
  amount:             z.string().optional(),
  maxAmountRequired:  z.string().optional(),
  payTo:              z.string(),
  maxTimeoutSeconds:  z.number().optional(),
}).passthrough().refine(a => (a.amount ?? a.maxAmountRequired) !== undefined, {
  message: "requirement needs amount (v2) or maxAmountRequired (v1)",
});

const X402ResponseSchema = z.object({
  x402Version: z.number().optional(),
  version: z.number().optional(),
  resource: z.record(z.unknown()).optional(),
  extensions: z.record(z.unknown()).optional(),
  accepts: z.array(X402RequirementSchema).min(1),
}).passthrough();
type X402Requirement = z.infer<typeof X402RequirementSchema>;

// ── Result shape ───────────────────────────────────────────────────────────────

export interface X402FetchResult {
  success: boolean;
  statusCode?: number;
  body?: string;
  paid?: boolean;
  payTo?: string;
  amountUsd?: string;
  error?: string;
  needsConsent?: {
    status: "needs_confirmation";
    preview: string;
    consentToken: string;
  };
  auditId?: string;
  /** Set when the signing wallet is EIP-7702 delegated and signing was blocked. */
  delegationBlocked?: {
    why: string;
    steps: Array<{ step: number; tool: string; purpose: string }>;
  };
}

// ── Guard helpers ──────────────────────────────────────────────────────────────

function atomicToUsd(atomicStr: string): number {
  // Base USDC has 6 decimals; atomic 1000000 = $1.00 USD
  const raw = BigInt(atomicStr);
  return Number(raw) / 10 ** BASE_USDC_DECIMALS;
}

function makeAuditId(): string {
  return "x4_" + hexlify(randomBytes(12)).slice(2);
}

function writeAudit(fields: {
  id:     string;
  url:    string;
  method: string;
  payTo:  string;
  asset:  string;
  network: string;
  amountAtomic: string;
  amountUsd:    string;
  status:        X402AuditStatus;
  blockedReason?: string;
  settlementStatusCode?: number;
  responseExcerpt?:      string;
}, path?: string): void {
  const record: X402AuditRecord = {
    ...fields,
    timestamp: new Date().toISOString(),
  };
  saveX402AuditRecord(record, path);
}

// ── Signing ────────────────────────────────────────────────────────────────────

export async function signEip3009(
  privateKey: string,
  payTo: string,
  amountAtomic: string,
  deadlineSeconds: number,
): Promise<{ from: string; signature: string; nonce: string; validBefore: string }> {
  const wallet = new Wallet(privateKey);
  const from = await wallet.getAddress();
  const nonce = hexlify(randomBytes(32));
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + deadlineSeconds);
  const amountRaw = BigInt(amountAtomic);

  const signature = await wallet.signTypedData(
    EIP3009_DOMAIN,
    EIP3009_TYPES,
    {
      from,
      to: payTo,
      value: amountRaw,
      validAfter: 0n,
      validBefore,
      nonce,
    },
  );

  return { from, signature, nonce, validBefore: validBefore.toString() };
}

// Validates the builder code format: 1-32 lowercase letters/numbers/underscores.
const BUILDER_CODE_RE = /^[a-z0-9_]{1,32}$/;

export function getBuilderCode(): string | undefined {
  const raw = dynEnv("Q402_BUILDER_CODE");
  if (!raw || !BUILDER_CODE_RE.test(raw)) return undefined;
  return raw;
}

export function buildXPaymentHeader(params: {
  from:        string;
  payTo:       string;
  amountAtomic: string;
  validBefore:  string;
  nonce:        string;
  signature:    string;
  requirement:  X402Requirement;
  resource?:    Record<string, unknown>;
  challengeExtensions?: Record<string, unknown>;
  challengeVersion: number;
  builderCode?: string;
}): { headerName: string; value: string } {
  // Official x402 v2 PaymentPayload (@x402/core): `accepted` = the CHOSEN
  // requirement echoed verbatim, `payload` = {signature, authorization} at the
  // TOP level, and the challenge's `resource`/`extensions` echoed back. Sellers
  // and facilitators validate against this shape — nesting payload inside
  // `accepted` (our previous layout) fails verification everywhere.
  const accepted: Record<string, unknown> = {
    ...params.requirement,
    amount: params.amountAtomic,
  };
  // Field `s` = service/client code; `a` (app) omitted unless the server declares it.
  // The challenge's extensions must round-trip VERBATIM — sellers enforce this
  // (observed: Bitrefill rejects with `extension_echo_mismatch` otherwise). So:
  // never replace a declared extension, only merge our `s` into a declared
  // builder-code slot; add a fresh builder-code entry only when the seller
  // declared none (CDP tolerates additive client extensions).
  const extensions: Record<string, unknown> = { ...(params.challengeExtensions ?? {}) };
  if (params.builderCode) {
    const declared = extensions["builder-code"];
    extensions["builder-code"] =
      typeof declared === "object" && declared !== null
        ? { ...(declared as Record<string, unknown>), s: params.builderCode }
        : { s: params.builderCode };
  }
  const authorization = {
    from:        params.from,
    to:          params.payTo,
    value:       params.amountAtomic,
    validAfter:  "0",
    validBefore: params.validBefore,
    nonce:       params.nonce,
  };
  // Wire format is VERSION-SPECIFIC, including the HTTP header NAME:
  //   v2 → PaymentPayload {x402Version:2, resource?, accepted, payload, extensions?}
  //        sent under `PAYMENT-SIGNATURE`
  //   v1 → {x402Version:1, scheme, network, payload} sent under `X-PAYMENT`
  // Sending a v2 body under the v1 header name fails verification at every
  // v2 seller (their middleware reads PAYMENT-SIGNATURE only).
  if (params.challengeVersion >= 2) {
    const header: Record<string, unknown> = {
      x402Version: 2,
      ...(params.resource ? { resource: params.resource } : {}),
      accepted,
      payload: { signature: params.signature, authorization },
      ...(Object.keys(extensions).length > 0 ? { extensions } : {}),
    };
    return {
      headerName: "PAYMENT-SIGNATURE",
      value: Buffer.from(JSON.stringify(header)).toString("base64"),
    };
  }
  const v1Header: Record<string, unknown> = {
    x402Version: 1,
    scheme: "exact",
    network: params.requirement.network,
    payload: { signature: params.signature, authorization },
    ...(Object.keys(extensions).length > 0 ? { extensions } : {}),
  };
  return {
    headerName: "X-PAYMENT",
    value: Buffer.from(JSON.stringify(v1Header)).toString("base64"),
  };
}

// ── Main runner ────────────────────────────────────────────────────────────────

export function pickSigningKey(): string | null {
  const agentKey = dynEnv("Q402_AGENTIC_PRIVATE_KEY") ?? null;
  if (isValidPrivateKey(agentKey)) return agentKey;
  const eoaKey = dynEnv("Q402_PRIVATE_KEY") ?? null;
  if (isValidPrivateKey(eoaKey)) return eoaKey;
  return null;
}

function isRealPaymentsEnabled(): boolean {
  return dynEnv("Q402_ENABLE_REAL_PAYMENTS") === "1";
}

function selectRequirement(accepts: X402Requirement[]): X402Requirement | null {
  return accepts.find(a =>
    a.scheme === "exact" &&
    (a.network === "base" || a.network === "base-mainnet" || a.network === "eip155:8453") &&
    a.asset.toLowerCase() === BASE_USDC_ADDRESS_LC,
  ) ?? null;
}

export async function runX402Fetch(input: X402FetchInput): Promise<X402FetchResult> {
  const method = input.method ?? "GET";

  // ── Step 1: initial fetch ────────────────────────────────────────────────────
  let initialResp: Response;
  try {
    initialResp = await fetch(input.url, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(input.body !== undefined ? { body: input.body } : {}),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    return {
      success: false,
      error: `fetch failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  // ── Step 2: non-402 pass-through ────────────────────────────────────────────
  if (initialResp.status !== 402) {
    let body = "";
    try { body = await initialResp.text(); } catch { /* ignore */ }
    return {
      success: initialResp.ok,
      statusCode: initialResp.status,
      body,
    };
  }

  // ── Step 3: parse the challenge — JSON body, or PAYMENT-REQUIRED header ─────
  // Body-based challenges are the common case; some sellers (header-based x402
  // middlewares) put the base64 PaymentRequired JSON in a PAYMENT-REQUIRED
  // response header instead, with a non-JSON or requirement-free body.
  let raw402: unknown = null;
  try {
    raw402 = await initialResp.json();
  } catch { /* fall through to header */ }
  if (raw402 === null || typeof raw402 !== "object" || !("accepts" in (raw402 as Record<string, unknown>))) {
    const prHeader = initialResp.headers.get("payment-required");
    if (prHeader) {
      try {
        raw402 = JSON.parse(Buffer.from(prHeader, "base64").toString("utf8"));
      } catch { /* keep body value; schema error below reports it */ }
    }
  }
  if (raw402 === null) {
    return {
      success: false,
      statusCode: 402,
      error: "x402: 402 response has neither a JSON body nor a PAYMENT-REQUIRED header",
    };
  }

  const parsed = X402ResponseSchema.safeParse(raw402);
  if (!parsed.success) {
    return {
      success: false,
      statusCode: 402,
      error: `x402: malformed payment requirements: ${parsed.error.message}`,
    };
  }

  // ── Step 4: select a supported requirement ───────────────────────────────────
  const selected = selectRequirement(parsed.data.accepts);
  // Normalize v1's maxAmountRequired onto `amount` so every downstream use —
  // guards, audit, consent, signing, the accepted echo — sees one field.
  const req = selected === null
    ? null
    : { ...selected, amount: selected.amount ?? selected.maxAmountRequired! };
  if (!req) {
    const seen = parsed.data.accepts
      .map(a => `scheme=${a.scheme}/network=${a.network}/asset=${a.asset}`)
      .join(", ");
    return {
      success: false,
      statusCode: 402,
      error:
        `x402: no supported payment option. ` +
        `Only scheme=exact + network=base|base-mainnet|eip155:8453 + asset=${BASE_USDC_ADDRESS} (Base USDC) is supported. ` +
        `Server offered: [${seen}]`,
    };
  }

  const amountUsd = atomicToUsd(req.amount).toFixed(6);
  const humanAmount = amountUsd;
  const auditId = makeAuditId();

  // ── Step 5: guards ───────────────────────────────────────────────────────────

  // 5a: per-call max amount guard (reuses pay.ts guard)
  try {
    maxAmountGuard(humanAmount, CONFIG.maxAmountPerCallUsd);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    writeAudit({
      id: auditId, url: input.url, method, payTo: req.payTo, asset: req.asset,
      network: req.network, amountAtomic: req.amount, amountUsd,
      status: "blocked_by_guard", blockedReason: reason,
    });
    return { success: false, statusCode: 402, error: reason, auditId };
  }

  // 5b: per-session cumulative cap
  const sessionCap = getSessionCapUsd();
  const amountNum = parseFloat(humanAmount);
  if (getSessionSpendUsd() + amountNum > sessionCap) {
    const reason =
      `x402: per-session cumulative spend cap of $${sessionCap} would be exceeded ` +
      `(already spent $${getSessionSpendUsd().toFixed(4)}, this request is $${humanAmount}). ` +
      `Set Q402_X402_SESSION_CAP_USD to a higher value if intentional.`;
    writeAudit({
      id: auditId, url: input.url, method, payTo: req.payTo, asset: req.asset,
      network: req.network, amountAtomic: req.amount, amountUsd,
      status: "blocked_by_guard", blockedReason: reason,
    });
    return { success: false, statusCode: 402, error: reason, auditId };
  }

  // 5c: signing key check (before showing consent preview)
  const signingKey = pickSigningKey();
  if (!signingKey) {
    const reason =
      "x402: no signing key configured. Set Q402_AGENTIC_PRIVATE_KEY or Q402_PRIVATE_KEY to enable payments.";
    writeAudit({
      id: auditId, url: input.url, method, payTo: req.payTo, asset: req.asset,
      network: req.network, amountAtomic: req.amount, amountUsd,
      status: "blocked_by_guard", blockedReason: reason,
    });
    return { success: false, statusCode: 402, error: reason, auditId };
  }

  // 5d: live-mode gate
  if (!isRealPaymentsEnabled()) {
    const reason =
      "x402: sandbox mode — set Q402_ENABLE_REAL_PAYMENTS=1 to authorise real payments.";
    writeAudit({
      id: auditId, url: input.url, method, payTo: req.payTo, asset: req.asset,
      network: req.network, amountAtomic: req.amount, amountUsd,
      status: "blocked_by_guard", blockedReason: reason,
    });
    return { success: false, statusCode: 402, error: reason, auditId };
  }

  // 5e: two-phase consent token
  const consentIntent = {
    t: "x402_fetch",
    url: input.url,
    method,
    payTo: req.payTo.toLowerCase(),
    amountAtomic: req.amount,
    asset: req.asset.toLowerCase(),
    network: req.network,
  };
  const consent = checkConsent(consentIntent, input.consentToken);
  if (!consent.ok) {
    writeAudit({
      id: auditId, url: input.url, method, payTo: req.payTo, asset: req.asset,
      network: req.network, amountAtomic: req.amount, amountUsd,
      status: "blocked_by_guard", blockedReason: "consent_required",
    });
    return {
      success: false,
      statusCode: 402,
      auditId,
      needsConsent: {
        status: "needs_confirmation",
        preview:
          `Fetching ${input.url} requires payment of $${humanAmount} USDC ` +
          `to ${req.payTo} on Base. ` +
          `Confirm with the user, then re-call q402_x402_fetch with the same args plus ` +
          `consentToken="${consent.expected}".`,
        consentToken: consent.expected,
      },
    };
  }

  // ── Step 5f: EIP-7702 delegation guard ───────────────────────────────────────
  // Derive the signing address without making any RPC call (sync from private key).
  const signerAddress = new Wallet(signingKey).address;
  const delegationStatus = await checkEip7702Delegation(signerAddress);
  if (delegationStatus === "delegated") {
    writeAudit({
      id: auditId, url: input.url, method, payTo: req.payTo, asset: req.asset,
      network: req.network, amountAtomic: req.amount, amountUsd,
      status: "blocked_by_guard", blockedReason: "wallet_delegated",
    });
    return {
      success: false,
      statusCode: 402,
      error:
        "x402: signing wallet is EIP-7702 delegated to the q402 rail — " +
        "EIP-3009 signatures from delegated EOAs fail settlement on Base USDC V2.2. " +
        "Run q402_wallet_status to confirm, then q402_clear_delegation to fix (gasless on Base).",
      auditId,
      delegationBlocked: {
        why:
          "The signing key's EOA is EIP-7702 delegated to the q402 contract. " +
          "Base USDC V2.2 routes EIP-3009 signatures from delegated accounts through ERC-1271, " +
          "which the q402 implementation does not support, causing the seller's payment " +
          "settlement to reject. The delegation must be cleared before EIP-3009 can be used.",
        steps: [
          {
            step: 1,
            tool: "q402_wallet_status",
            purpose:
              "Confirm which chains are currently delegated and that this wallet is affected.",
          },
          {
            step: 2,
            tool: "q402_clear_delegation",
            purpose:
              "Clear the EIP-7702 delegation (gasless on Base), then retry q402_x402_fetch.",
          },
        ],
      },
    };
  }

  // ── Step 6: sign EIP-3009 ────────────────────────────────────────────────────
  let signed: Awaited<ReturnType<typeof signEip3009>>;
  try {
    signed = await signEip3009(
      signingKey,
      req.payTo,
      req.amount,
      req.maxTimeoutSeconds ?? 300,
    );
  } catch (e) {
    const reason = `x402: signing failed: ${e instanceof Error ? e.message : String(e)}`;
    writeAudit({
      id: auditId, url: input.url, method, payTo: req.payTo, asset: req.asset,
      network: req.network, amountAtomic: req.amount, amountUsd,
      status: "sign_failed", blockedReason: reason,
    });
    return { success: false, statusCode: 402, error: reason, auditId };
  }

  // ── Step 7: build X-PAYMENT and retry ────────────────────────────────────────
  const xPayment = buildXPaymentHeader({
    from:         signed.from,
    payTo:        req.payTo,
    amountAtomic: req.amount,
    validBefore:  signed.validBefore,
    nonce:        signed.nonce,
    signature:    signed.signature,
    requirement:  req,
    resource:     parsed.data.resource,
    challengeExtensions: parsed.data.extensions,
    challengeVersion: parsed.data.x402Version ?? parsed.data.version ?? 1,
    builderCode:  getBuilderCode(),
  });

  let retryResp: Response;
  try {
    retryResp = await fetch(input.url, {
      method,
      headers: {
        "Content-Type": "application/json",
        [xPayment.headerName]: xPayment.value,
      },
      ...(input.body !== undefined ? { body: input.body } : {}),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    const reason = `x402: retry fetch failed: ${e instanceof Error ? e.message : String(e)}`;
    writeAudit({
      id: auditId, url: input.url, method, payTo: req.payTo, asset: req.asset,
      network: req.network, amountAtomic: req.amount, amountUsd,
      status: "retry_failed", blockedReason: reason,
    });
    return { success: false, statusCode: 402, error: reason, auditId };
  }

  let responseBody = "";
  try { responseBody = await retryResp.text(); } catch { /* ignore */ }
  const excerpt = responseBody.slice(0, 200);

  if (!retryResp.ok) {
    writeAudit({
      id: auditId, url: input.url, method, payTo: req.payTo, asset: req.asset,
      network: req.network, amountAtomic: req.amount, amountUsd,
      status: "retry_failed",
      settlementStatusCode: retryResp.status,
      responseExcerpt: excerpt,
    });
    const delegationHint =
      delegationStatus === "check_skipped"
        ? " Delegation check was skipped (RPC unavailable) — if this repeats, " +
          "the signing wallet may be EIP-7702 delegated: run q402_wallet_status " +
          "to verify and q402_clear_delegation to fix."
        : "";
    return {
      success: false,
      statusCode: retryResp.status,
      error: `x402: retry returned HTTP ${retryResp.status}.${delegationHint}`,
      body: responseBody,
      auditId,
    };
  }

  // ── Step 8: settle accumulator and write audit ────────────────────────────────
  addSessionSpend(amountNum);
  writeAudit({
    id: auditId, url: input.url, method, payTo: req.payTo, asset: req.asset,
    network: req.network, amountAtomic: req.amount, amountUsd,
    status: "settled",
    settlementStatusCode: retryResp.status,
    responseExcerpt: excerpt,
  });

  return {
    success: true,
    statusCode: retryResp.status,
    body: responseBody,
    paid: true,
    payTo: req.payTo,
    amountUsd: humanAmount,
    auditId,
  };
}

// ── Tool descriptor ────────────────────────────────────────────────────────────

export const X402_FETCH_TOOL = {
  name: "q402_x402_fetch",
  description:
    "Generic x402 client. Fetches any URL with GET/POST and handles x402 payment-required " +
    "(HTTP 402) responses automatically: parses the x402 v2 payment requirements, validates " +
    "the payment option (Base USDC only), guards against excess spend, signs an EIP-3009 " +
    "TransferWithAuthorization, and retries with PAYMENT-SIGNATURE (v2 servers) or X-PAYMENT (v1 legacy). Non-402 responses " +
    "are passed through directly, so this also serves as a regular fetch tool. " +
    "\n\n" +
    "SUPPORTED: scheme=exact + network=base (i.e. CAIP-2 eip155:8453; also accepted: " +
    "base-mainnet) + asset=Base USDC only. Any other scheme/network/asset returns an " +
    "explicit rejection without signing. " +
    "\n\n" +
    "GUARDS: per-call max-amount cap (Q402_MAX_AMOUNT_PER_CALL), per-session cumulative " +
    "cap (Q402_X402_SESSION_CAP_USD, default $5), and two-phase consent. First call without " +
    "consentToken returns needs_confirmation + preview; re-call with consentToken to pay. " +
    "\n\n" +
    "AUDIT: every 402 attempt (including blocked ones) is written to the local x402 audit " +
    "log and included in q402_agent_spend_report output. " +
    "\n\n" +
    "REQUIRES Q402_ENABLE_REAL_PAYMENTS=1 and Q402_AGENTIC_PRIVATE_KEY (or Q402_PRIVATE_KEY). " +
    "No calls to /api/relay — the signed authorization goes directly to the seller/facilitator. " +
    "\n\n" +
    "ATTRIBUTION: set Q402_BUILDER_CODE (1-32 lowercase letters/numbers/underscores) to include " +
    "your Base Builder Code as the client/intermediary service code in every payment, enabling " +
    "onchain attribution via ERC-8021 at the facilitator settlement step.",
  inputSchema: {
    type: "object" as const,
    properties: {
      url: {
        type: "string",
        description: "Target URL to fetch.",
      },
      method: {
        type: "string",
        enum: ["GET", "POST", "PUT", "PATCH", "DELETE"],
        description: "HTTP method. Default GET.",
      },
      body: {
        type: "string",
        description: "Request body string (for POST/PUT/PATCH).",
      },
      confirm: {
        type: "boolean",
        const: true,
        description:
          "MUST be true. This tool can trigger on-chain payments; caller attests the user approved.",
      },
      consentToken: {
        type: "string",
        description:
          "Two-phase consent token. Omit on first call; the tool returns needs_confirmation with " +
          "a token if a 402 is encountered. Re-call with the same args plus this token to pay.",
      },
    },
    required: ["url", "confirm"],
    additionalProperties: false,
  },
} as const;
