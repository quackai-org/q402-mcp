// src/tools/x402-fetch.ts
import { Wallet, hexlify, randomBytes } from "ethers";
import { z } from "zod";

// src/config.ts
import { existsSync, readFileSync, statSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { isAddress } from "ethers";
var Q402_ENV_FILE = join(homedir(), ".q402", "mcp.env");
var lastReadError = null;
var MAX_ENV_FILE_BYTES = 64 * 1024;
function loadQ402EnvFileFromPath(path) {
  lastReadError = null;
  if (!existsSync(path)) return {};
  if (process.platform !== "win32") {
    try {
      const mode = statSync(path).mode & 511;
      if (mode & 63) {
        process.stderr.write(
          `[q402-mcp] warning: ${path} is readable by group/other (mode ${mode.toString(8)}). Run: chmod 600 ${path}
`
        );
      }
    } catch {
    }
  }
  try {
    const size = statSync(path).size;
    if (size > MAX_ENV_FILE_BYTES) {
      const msg = `file is ${size} bytes (max ${MAX_ENV_FILE_BYTES}); refusing to load. Check ~/.q402/mcp.env - is it a misdirected log file or symlink?`;
      lastReadError = msg;
      process.stderr.write(`[q402-mcp] warning: ${msg}
`);
      return {};
    }
  } catch {
  }
  const out = {};
  let raw;
  try {
    raw = readFileSync(path, "utf-8");
  } catch (e) {
    const msg = `could not read ${path}: ${e instanceof Error ? e.message : String(e)}`;
    lastReadError = msg;
    process.stderr.write(`[q402-mcp] warning: ${msg}
`);
    return {};
  }
  if (raw.charCodeAt(0) === 65279) raw = raw.slice(1);
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    if (!k.startsWith("Q402_")) continue;
    let rawVal = t.slice(eq + 1).trim();
    const quoted = /^(['"])(.*)\1\s*(?:#.*)?$/.exec(rawVal);
    if (quoted) {
      rawVal = quoted[2];
    } else {
      const hashIdx = rawVal.search(/\s#/);
      if (hashIdx >= 0) rawVal = rawVal.slice(0, hashIdx).trimEnd();
    }
    if (rawVal === "") continue;
    out[k] = rawVal;
  }
  return out;
}
function loadQ402EnvFile() {
  return loadQ402EnvFileFromPath(Q402_ENV_FILE);
}
var FILE_ENV = loadQ402EnvFile();
var ENV = Object.freeze({
  ...FILE_ENV,
  ...process.env
});
var Q402_ENV_FILE_PRESENT = existsSync(Q402_ENV_FILE);
var Q402_ENV_FILE_KEYS = Object.freeze(
  new Set(
    Object.keys(FILE_ENV).filter((k) => process.env[k] === void 0)
  )
);
var Q402_ENV_FILE_KEYS_ALL = Object.freeze(
  new Set(Object.keys(FILE_ENV))
);
var DEFAULT_RELAY_BASE = "https://q402.quackai.ai/api";
var DEFAULT_MAX_AMOUNT = 200;
function classifyApiKey(k) {
  if (!k) return "missing";
  if (k.startsWith("q402_live_")) return "live";
  if (k.startsWith("q402_test_")) return "test";
  return "missing";
}
function parseAllowedRecipients(raw) {
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim().toLowerCase()).filter((s) => s.length > 0 && isAddress(s));
}
function parseMaxAmount(raw) {
  if (!raw) return DEFAULT_MAX_AMOUNT;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_MAX_AMOUNT;
  return n;
}
function loadConfig() {
  const trialApiKey = ENV.Q402_TRIAL_API_KEY ?? null;
  const multichainApiKey = ENV.Q402_MULTICHAIN_API_KEY ?? null;
  const legacyApiKey = ENV.Q402_API_KEY ?? null;
  const apiKey = multichainApiKey ?? trialApiKey ?? legacyApiKey;
  const apiKeyKind = classifyApiKey(apiKey);
  const privateKey = ENV.Q402_PRIVATE_KEY ?? null;
  const agenticPrivateKey = ENV.Q402_AGENTIC_PRIVATE_KEY ?? null;
  const walletIdRaw = ENV.Q402_AGENT_WALLET_ADDRESS ?? ENV.Q402_WALLET_ID;
  if (!ENV.Q402_AGENT_WALLET_ADDRESS && ENV.Q402_WALLET_ID) {
    process.stderr.write(
      "[q402-mcp] Q402_WALLET_ID is deprecated - rename to Q402_AGENT_WALLET_ADDRESS. Old name will be removed in a future release.\n"
    );
  }
  const walletId = typeof walletIdRaw === "string" && walletIdRaw.length > 0 ? walletIdRaw.toLowerCase() : null;
  const realPaymentsRequested = ENV.Q402_ENABLE_REAL_PAYMENTS === "1";
  const anyLiveKey = classifyApiKey(trialApiKey) === "live" || classifyApiKey(multichainApiKey) === "live" || classifyApiKey(legacyApiKey) === "live";
  const live = realPaymentsRequested && anyLiveKey;
  const travelMode = process.env["TRAVEL_MODE"] === "live" ? "live" : "mock";
  const travalaAgentId = process.env["TRAVALA_AGENT_ID"] ?? null;
  const travalaRewardWallet = process.env["TRAVALA_REWARD_WALLET"] ?? null;
  const builderCodeRaw = ENV.Q402_BUILDER_CODE ?? null;
  const builderCode = builderCodeRaw !== null && /^[a-z0-9_]{1,32}$/.test(builderCodeRaw) ? builderCodeRaw : null;
  return {
    trialApiKey,
    multichainApiKey,
    legacyApiKey,
    apiKey,
    apiKeyKind,
    privateKey,
    agenticPrivateKey,
    walletId,
    realPaymentsRequested,
    mode: live ? "live" : "sandbox",
    relayBaseUrl: (ENV.Q402_RELAY_BASE_URL ?? DEFAULT_RELAY_BASE).replace(/\/$/, ""),
    maxAmountPerCallUsd: parseMaxAmount(ENV.Q402_MAX_AMOUNT_PER_CALL),
    allowedRecipients: parseAllowedRecipients(ENV.Q402_ALLOWED_RECIPIENTS),
    travelMode,
    travalaAgentId,
    travalaRewardWallet,
    builderCode
  };
}
var CONFIG = loadConfig();
var PRIVATE_KEY_RE = /^0x[a-fA-F0-9]{64}$/;
var isValidPrivateKey = (s) => typeof s === "string" && PRIVATE_KEY_RE.test(s);

// src/consent.ts
import { sha256, toUtf8Bytes } from "ethers";
function canonicalIntent(intent) {
  const sortValue = (v) => {
    if (Array.isArray(v)) return v.map(sortValue);
    if (v && typeof v === "object") {
      const src = v;
      const out = {};
      for (const k of Object.keys(src).sort()) out[k] = sortValue(src[k]);
      return out;
    }
    if (typeof v === "number") return String(v);
    return v;
  };
  return JSON.stringify(sortValue(intent));
}
function consentTokenFor(intent) {
  return "ct_" + sha256(toUtf8Bytes(canonicalIntent(intent))).slice(2, 18);
}
function checkConsent(intent, provided) {
  const expected = consentTokenFor(intent);
  return { ok: provided === expected, expected };
}

// src/guards.ts
function dynEnv(key) {
  return process.env[key] ?? ENV[key];
}
function maxAmountGuard(amount, cap) {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric)) {
    throw new Error(`unparseable amount "${amount}"`);
  }
  if (numeric > cap) {
    throw new Error(
      `amount $${amount} exceeds the per-call cap of $${cap}. Set Q402_MAX_AMOUNT_PER_CALL to a higher value if intentional.`
    );
  }
}
var _sessionSpendUsd = 0;
function getSessionSpendUsd() {
  return _sessionSpendUsd;
}
function resetSessionSpendUsd() {
  _sessionSpendUsd = 0;
}
function addSessionSpend(amount) {
  _sessionSpendUsd += amount;
}
function getSessionCapUsd() {
  const raw = dynEnv("Q402_X402_SESSION_CAP_USD");
  const n = raw !== void 0 ? parseFloat(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 5;
}

// src/tools/x402-audit-store.ts
import { existsSync as existsSync2, readFileSync as readFileSync2, writeFileSync, mkdirSync, statSync as statSync2 } from "fs";
import { homedir as homedir2 } from "os";
import { join as join2, dirname } from "path";
var X402_AUDIT_PATH = join2(homedir2(), ".q402", "x402-audit.json");
var MAX_STORE_BYTES = 512 * 1024;
var MAX_STORE_ENTRIES = 5e3;
function readX402Audit(path = X402_AUDIT_PATH) {
  try {
    if (!existsSync2(path)) return {};
    const size = statSync2(path).size;
    if (size > MAX_STORE_BYTES) {
      process.stderr.write(`[q402-mcp] x402 audit too large (${size} bytes); skipping read
`);
      return {};
    }
    const raw = readFileSync2(path, "utf-8");
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}
function writeX402Audit(map, path = X402_AUDIT_PATH) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(map, null, 2), "utf-8");
  } catch (e) {
    process.stderr.write(
      `[q402-mcp] x402 audit write failed: ${e instanceof Error ? e.message : String(e)}
`
    );
  }
}
function saveX402AuditRecord(record, path = X402_AUDIT_PATH) {
  const map = readX402Audit(path);
  map[record.id] = record;
  const keys = Object.keys(map);
  if (keys.length > MAX_STORE_ENTRIES) {
    const sorted = keys.sort((a, b) => {
      const ta = map[a]?.timestamp ?? "";
      const tb = map[b]?.timestamp ?? "";
      return ta < tb ? -1 : ta > tb ? 1 : 0;
    });
    for (const k of sorted.slice(0, keys.length - MAX_STORE_ENTRIES)) {
      delete map[k];
    }
  }
  const serialized = JSON.stringify(map, null, 2);
  if (Buffer.byteLength(serialized, "utf-8") > MAX_STORE_BYTES) {
    process.stderr.write("[q402-mcp] x402 audit would exceed size cap; skipping write\n");
    return;
  }
  writeX402Audit(map, path);
}

// src/tools/x402-fetch.ts
var BASE_CHAIN_ID = 8453;
var BASE_USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
var BASE_USDC_ADDRESS_LC = BASE_USDC_ADDRESS.toLowerCase();
var BASE_USDC_DECIMALS = 6;
var EIP7702_PREFIX = "0xef0100";
var BASE_RPC_URL = "https://mainnet.base.org";
var EIP3009_DOMAIN = {
  name: "USD Coin",
  version: "2",
  chainId: BASE_CHAIN_ID,
  verifyingContract: BASE_USDC_ADDRESS
};
var EIP3009_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" }
  ]
};
var _delegationCheckOverride = null;
function _setDelegationCheck(fn) {
  _delegationCheckOverride = fn;
}
async function checkEip7702Delegation(address) {
  if (_delegationCheckOverride !== null) {
    return await _delegationCheckOverride(address) ? "delegated" : "clear";
  }
  try {
    const resp = await fetch(BASE_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getCode",
        params: [address, "latest"]
      }),
      signal: AbortSignal.timeout(5e3)
    });
    if (!resp.ok) return "check_skipped";
    const data = await resp.json();
    const code = (data.result ?? "").toLowerCase();
    return code.startsWith(EIP7702_PREFIX) ? "delegated" : "clear";
  } catch {
    return "check_skipped";
  }
}
function dynEnv2(key) {
  return process.env[key] ?? ENV[key];
}
var X402FetchInputSchema = z.object({
  url: z.string().min(1).describe("Target URL to fetch (GET/POST/\u2026)."),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).optional(),
  body: z.string().optional().describe("Request body for POST/PUT/PATCH (string)."),
  confirm: z.literal(true).describe(
    "MUST be true. This tool can trigger on-chain payments; caller attests the user approved."
  ),
  consentToken: z.string().optional().describe(
    "Two-phase payment consent. Omit on first call when you don't yet know a 402 will be returned \u2014 the tool responds with needs_confirmation + a token if a 402 is encountered. Re-call with the same args plus this token to authorise the payment."
  )
});
var X402RequirementSchema = z.object({
  scheme: z.string(),
  network: z.string(),
  asset: z.string(),
  amount: z.string().optional(),
  maxAmountRequired: z.string().optional(),
  payTo: z.string(),
  maxTimeoutSeconds: z.number().optional()
}).passthrough().refine((a) => (a.amount ?? a.maxAmountRequired) !== void 0, {
  message: "requirement needs amount (v2) or maxAmountRequired (v1)"
});
var X402ResponseSchema = z.object({
  x402Version: z.number().optional(),
  version: z.number().optional(),
  resource: z.record(z.unknown()).optional(),
  extensions: z.record(z.unknown()).optional(),
  accepts: z.array(X402RequirementSchema).min(1)
}).passthrough();
function atomicToUsd(atomicStr) {
  const raw = BigInt(atomicStr);
  return Number(raw) / 10 ** BASE_USDC_DECIMALS;
}
function makeAuditId() {
  return "x4_" + hexlify(randomBytes(12)).slice(2);
}
function writeAudit(fields, path) {
  const record = {
    ...fields,
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  };
  saveX402AuditRecord(record, path);
}
async function signEip3009(privateKey, payTo, amountAtomic, deadlineSeconds) {
  const wallet = new Wallet(privateKey);
  const from = await wallet.getAddress();
  const nonce = hexlify(randomBytes(32));
  const validBefore = BigInt(Math.floor(Date.now() / 1e3) + deadlineSeconds);
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
      nonce
    }
  );
  return { from, signature, nonce, validBefore: validBefore.toString() };
}
var BUILDER_CODE_RE = /^[a-z0-9_]{1,32}$/;
function getBuilderCode() {
  const raw = dynEnv2("Q402_BUILDER_CODE");
  if (!raw || !BUILDER_CODE_RE.test(raw)) return void 0;
  return raw;
}
function buildXPaymentHeader(params) {
  const accepted = {
    ...params.requirement,
    amount: params.amountAtomic
  };
  const extensions = { ...params.challengeExtensions ?? {} };
  if (params.builderCode) {
    const declared = extensions["builder-code"];
    extensions["builder-code"] = typeof declared === "object" && declared !== null ? { ...declared, s: params.builderCode } : { s: params.builderCode };
  }
  const authorization = {
    from: params.from,
    to: params.payTo,
    value: params.amountAtomic,
    validAfter: "0",
    validBefore: params.validBefore,
    nonce: params.nonce
  };
  if (params.challengeVersion >= 2) {
    const header = {
      x402Version: 2,
      ...params.resource ? { resource: params.resource } : {},
      accepted,
      payload: { signature: params.signature, authorization },
      ...Object.keys(extensions).length > 0 ? { extensions } : {}
    };
    return {
      headerName: "PAYMENT-SIGNATURE",
      value: Buffer.from(JSON.stringify(header)).toString("base64")
    };
  }
  const v1Header = {
    x402Version: 1,
    scheme: "exact",
    network: params.requirement.network,
    payload: { signature: params.signature, authorization },
    ...Object.keys(extensions).length > 0 ? { extensions } : {}
  };
  return {
    headerName: "X-PAYMENT",
    value: Buffer.from(JSON.stringify(v1Header)).toString("base64")
  };
}
function pickSigningKey() {
  const agentKey = dynEnv2("Q402_AGENTIC_PRIVATE_KEY") ?? null;
  if (isValidPrivateKey(agentKey)) return agentKey;
  const eoaKey = dynEnv2("Q402_PRIVATE_KEY") ?? null;
  if (isValidPrivateKey(eoaKey)) return eoaKey;
  return null;
}
function isRealPaymentsEnabled() {
  return dynEnv2("Q402_ENABLE_REAL_PAYMENTS") === "1";
}
function selectRequirement(accepts) {
  return accepts.find(
    (a) => a.scheme === "exact" && (a.network === "base" || a.network === "base-mainnet" || a.network === "eip155:8453") && a.asset.toLowerCase() === BASE_USDC_ADDRESS_LC
  ) ?? null;
}
async function runX402Fetch(input) {
  const method = input.method ?? "GET";
  let initialResp;
  try {
    initialResp = await fetch(input.url, {
      method,
      headers: { "Content-Type": "application/json" },
      ...input.body !== void 0 ? { body: input.body } : {},
      signal: AbortSignal.timeout(3e4)
    });
  } catch (e) {
    return {
      success: false,
      error: `fetch failed: ${e instanceof Error ? e.message : String(e)}`
    };
  }
  if (initialResp.status !== 402) {
    let body = "";
    try {
      body = await initialResp.text();
    } catch {
    }
    return {
      success: initialResp.ok,
      statusCode: initialResp.status,
      body
    };
  }
  let raw402 = null;
  try {
    raw402 = await initialResp.json();
  } catch {
  }
  if (raw402 === null || typeof raw402 !== "object" || !("accepts" in raw402)) {
    const prHeader = initialResp.headers.get("payment-required");
    if (prHeader) {
      try {
        raw402 = JSON.parse(Buffer.from(prHeader, "base64").toString("utf8"));
      } catch {
      }
    }
  }
  if (raw402 === null) {
    return {
      success: false,
      statusCode: 402,
      error: "x402: 402 response has neither a JSON body nor a PAYMENT-REQUIRED header"
    };
  }
  const parsed = X402ResponseSchema.safeParse(raw402);
  if (!parsed.success) {
    return {
      success: false,
      statusCode: 402,
      error: `x402: malformed payment requirements: ${parsed.error.message}`
    };
  }
  const selected = selectRequirement(parsed.data.accepts);
  const req = selected === null ? null : { ...selected, amount: selected.amount ?? selected.maxAmountRequired };
  if (!req) {
    const seen = parsed.data.accepts.map((a) => `scheme=${a.scheme}/network=${a.network}/asset=${a.asset}`).join(", ");
    return {
      success: false,
      statusCode: 402,
      error: `x402: no supported payment option. Only scheme=exact + network=base|base-mainnet|eip155:8453 + asset=${BASE_USDC_ADDRESS} (Base USDC) is supported. Server offered: [${seen}]`
    };
  }
  const amountUsd = atomicToUsd(req.amount).toFixed(6);
  const humanAmount = amountUsd;
  const auditId = makeAuditId();
  try {
    maxAmountGuard(humanAmount, CONFIG.maxAmountPerCallUsd);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    writeAudit({
      id: auditId,
      url: input.url,
      method,
      payTo: req.payTo,
      asset: req.asset,
      network: req.network,
      amountAtomic: req.amount,
      amountUsd,
      status: "blocked_by_guard",
      blockedReason: reason
    });
    return { success: false, statusCode: 402, error: reason, auditId };
  }
  const sessionCap = getSessionCapUsd();
  const amountNum = parseFloat(humanAmount);
  if (getSessionSpendUsd() + amountNum > sessionCap) {
    const reason = `x402: per-session cumulative spend cap of $${sessionCap} would be exceeded (already spent $${getSessionSpendUsd().toFixed(4)}, this request is $${humanAmount}). Set Q402_X402_SESSION_CAP_USD to a higher value if intentional.`;
    writeAudit({
      id: auditId,
      url: input.url,
      method,
      payTo: req.payTo,
      asset: req.asset,
      network: req.network,
      amountAtomic: req.amount,
      amountUsd,
      status: "blocked_by_guard",
      blockedReason: reason
    });
    return { success: false, statusCode: 402, error: reason, auditId };
  }
  const signingKey = pickSigningKey();
  if (!signingKey) {
    const reason = "x402: no signing key configured. Set Q402_AGENTIC_PRIVATE_KEY or Q402_PRIVATE_KEY to enable payments.";
    writeAudit({
      id: auditId,
      url: input.url,
      method,
      payTo: req.payTo,
      asset: req.asset,
      network: req.network,
      amountAtomic: req.amount,
      amountUsd,
      status: "blocked_by_guard",
      blockedReason: reason
    });
    return { success: false, statusCode: 402, error: reason, auditId };
  }
  if (!isRealPaymentsEnabled()) {
    const reason = "x402: sandbox mode \u2014 set Q402_ENABLE_REAL_PAYMENTS=1 to authorise real payments.";
    writeAudit({
      id: auditId,
      url: input.url,
      method,
      payTo: req.payTo,
      asset: req.asset,
      network: req.network,
      amountAtomic: req.amount,
      amountUsd,
      status: "blocked_by_guard",
      blockedReason: reason
    });
    return { success: false, statusCode: 402, error: reason, auditId };
  }
  const consentIntent = {
    t: "x402_fetch",
    url: input.url,
    method,
    payTo: req.payTo.toLowerCase(),
    amountAtomic: req.amount,
    asset: req.asset.toLowerCase(),
    network: req.network
  };
  const consent = checkConsent(consentIntent, input.consentToken);
  if (!consent.ok) {
    writeAudit({
      id: auditId,
      url: input.url,
      method,
      payTo: req.payTo,
      asset: req.asset,
      network: req.network,
      amountAtomic: req.amount,
      amountUsd,
      status: "blocked_by_guard",
      blockedReason: "consent_required"
    });
    return {
      success: false,
      statusCode: 402,
      auditId,
      needsConsent: {
        status: "needs_confirmation",
        preview: `Fetching ${input.url} requires payment of $${humanAmount} USDC to ${req.payTo} on Base. Confirm with the user, then re-call q402_x402_fetch with the same args plus consentToken="${consent.expected}".`,
        consentToken: consent.expected
      }
    };
  }
  const signerAddress = new Wallet(signingKey).address;
  const delegationStatus = await checkEip7702Delegation(signerAddress);
  if (delegationStatus === "delegated") {
    writeAudit({
      id: auditId,
      url: input.url,
      method,
      payTo: req.payTo,
      asset: req.asset,
      network: req.network,
      amountAtomic: req.amount,
      amountUsd,
      status: "blocked_by_guard",
      blockedReason: "wallet_delegated"
    });
    return {
      success: false,
      statusCode: 402,
      error: "x402: signing wallet is EIP-7702 delegated to the q402 rail \u2014 EIP-3009 signatures from delegated EOAs fail settlement on Base USDC V2.2. Run q402_wallet_status to confirm, then q402_clear_delegation to fix (gasless on Base).",
      auditId,
      delegationBlocked: {
        why: "The signing key's EOA is EIP-7702 delegated to the q402 contract. Base USDC V2.2 routes EIP-3009 signatures from delegated accounts through ERC-1271, which the q402 implementation does not support, causing the seller's payment settlement to reject. The delegation must be cleared before EIP-3009 can be used.",
        steps: [
          {
            step: 1,
            tool: "q402_wallet_status",
            purpose: "Confirm which chains are currently delegated and that this wallet is affected."
          },
          {
            step: 2,
            tool: "q402_clear_delegation",
            purpose: "Clear the EIP-7702 delegation (gasless on Base), then retry q402_x402_fetch."
          }
        ]
      }
    };
  }
  let signed;
  try {
    signed = await signEip3009(
      signingKey,
      req.payTo,
      req.amount,
      req.maxTimeoutSeconds ?? 300
    );
  } catch (e) {
    const reason = `x402: signing failed: ${e instanceof Error ? e.message : String(e)}`;
    writeAudit({
      id: auditId,
      url: input.url,
      method,
      payTo: req.payTo,
      asset: req.asset,
      network: req.network,
      amountAtomic: req.amount,
      amountUsd,
      status: "sign_failed",
      blockedReason: reason
    });
    return { success: false, statusCode: 402, error: reason, auditId };
  }
  const xPayment = buildXPaymentHeader({
    from: signed.from,
    payTo: req.payTo,
    amountAtomic: req.amount,
    validBefore: signed.validBefore,
    nonce: signed.nonce,
    signature: signed.signature,
    requirement: req,
    resource: parsed.data.resource,
    challengeExtensions: parsed.data.extensions,
    challengeVersion: parsed.data.x402Version ?? parsed.data.version ?? 1,
    builderCode: getBuilderCode()
  });
  let retryResp;
  try {
    retryResp = await fetch(input.url, {
      method,
      headers: {
        "Content-Type": "application/json",
        [xPayment.headerName]: xPayment.value
      },
      ...input.body !== void 0 ? { body: input.body } : {},
      signal: AbortSignal.timeout(3e4)
    });
  } catch (e) {
    const reason = `x402: retry fetch failed: ${e instanceof Error ? e.message : String(e)}`;
    writeAudit({
      id: auditId,
      url: input.url,
      method,
      payTo: req.payTo,
      asset: req.asset,
      network: req.network,
      amountAtomic: req.amount,
      amountUsd,
      status: "retry_failed",
      blockedReason: reason
    });
    return { success: false, statusCode: 402, error: reason, auditId };
  }
  let responseBody = "";
  try {
    responseBody = await retryResp.text();
  } catch {
  }
  const excerpt = responseBody.slice(0, 200);
  if (!retryResp.ok) {
    writeAudit({
      id: auditId,
      url: input.url,
      method,
      payTo: req.payTo,
      asset: req.asset,
      network: req.network,
      amountAtomic: req.amount,
      amountUsd,
      status: "retry_failed",
      settlementStatusCode: retryResp.status,
      responseExcerpt: excerpt
    });
    const delegationHint = delegationStatus === "check_skipped" ? " Delegation check was skipped (RPC unavailable) \u2014 if this repeats, the signing wallet may be EIP-7702 delegated: run q402_wallet_status to verify and q402_clear_delegation to fix." : "";
    return {
      success: false,
      statusCode: retryResp.status,
      error: `x402: retry returned HTTP ${retryResp.status}.${delegationHint}`,
      body: responseBody,
      auditId
    };
  }
  addSessionSpend(amountNum);
  writeAudit({
    id: auditId,
    url: input.url,
    method,
    payTo: req.payTo,
    asset: req.asset,
    network: req.network,
    amountAtomic: req.amount,
    amountUsd,
    status: "settled",
    settlementStatusCode: retryResp.status,
    responseExcerpt: excerpt
  });
  return {
    success: true,
    statusCode: retryResp.status,
    body: responseBody,
    paid: true,
    payTo: req.payTo,
    amountUsd: humanAmount,
    auditId
  };
}
var X402_FETCH_TOOL = {
  name: "q402_x402_fetch",
  description: "Generic x402 client. Fetches any URL with GET/POST and handles x402 payment-required (HTTP 402) responses automatically: parses the x402 v2 payment requirements, validates the payment option (Base USDC only), guards against excess spend, signs an EIP-3009 TransferWithAuthorization, and retries with the X-PAYMENT header. Non-402 responses are passed through directly, so this also serves as a regular fetch tool. \n\nSUPPORTED: scheme=exact + network=base (i.e. CAIP-2 eip155:8453; also accepted: base-mainnet) + asset=Base USDC only. Any other scheme/network/asset returns an explicit rejection without signing. \n\nGUARDS: per-call max-amount cap (Q402_MAX_AMOUNT_PER_CALL), per-session cumulative cap (Q402_X402_SESSION_CAP_USD, default $5), and two-phase consent. First call without consentToken returns needs_confirmation + preview; re-call with consentToken to pay. \n\nAUDIT: every 402 attempt (including blocked ones) is written to the local x402 audit log and included in q402_agent_spend_report output. \n\nREQUIRES Q402_ENABLE_REAL_PAYMENTS=1 and Q402_AGENTIC_PRIVATE_KEY (or Q402_PRIVATE_KEY). No calls to /api/relay \u2014 the signed authorization goes directly to the seller/facilitator. \n\nATTRIBUTION: set Q402_BUILDER_CODE (1-32 lowercase letters/numbers/underscores) to include your Base Builder Code as the client/intermediary service code in every payment, enabling onchain attribution via ERC-8021 at the facilitator settlement step.",
  inputSchema: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "Target URL to fetch."
      },
      method: {
        type: "string",
        enum: ["GET", "POST", "PUT", "PATCH", "DELETE"],
        description: "HTTP method. Default GET."
      },
      body: {
        type: "string",
        description: "Request body string (for POST/PUT/PATCH)."
      },
      confirm: {
        type: "boolean",
        const: true,
        description: "MUST be true. This tool can trigger on-chain payments; caller attests the user approved."
      },
      consentToken: {
        type: "string",
        description: "Two-phase consent token. Omit on first call; the tool returns needs_confirmation with a token if a 402 is encountered. Re-call with the same args plus this token to pay."
      }
    },
    required: ["url", "confirm"],
    additionalProperties: false
  }
};
export {
  X402FetchInputSchema,
  X402_FETCH_TOOL,
  _setDelegationCheck,
  getSessionSpendUsd,
  resetSessionSpendUsd,
  runX402Fetch
};
