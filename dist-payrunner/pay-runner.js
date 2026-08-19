// src/tools/pay.ts
import { isAddress as isAddress2, Wallet as Wallet3 } from "ethers";
import { z as z2 } from "zod";

// src/chains.ts
var CHAIN_KEYS = [
  "avax",
  "bnb",
  "eth",
  "xlayer",
  "stable",
  "mantle",
  "injective",
  "monad",
  "scroll",
  "arbitrum",
  "base",
  "robinhood"
];
var CHAIN_CONFIG = {
  avax: {
    key: "avax",
    name: "Avalanche C-Chain",
    chainId: 43114,
    domainName: "Q402 Avalanche",
    implContract: "0x96a8C74d95A35D0c14Ec60364c78ba6De99E9A4c",
    gasToken: "AVAX",
    explorer: "https://snowtrace.io",
    usdc: { address: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", decimals: 6 },
    usdt: { address: "0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7", decimals: 6 },
    supportedTokens: ["USDC", "USDT"],
    approxGasCostUsd: 3e-3
  },
  bnb: {
    key: "bnb",
    name: "BNB Chain",
    chainId: 56,
    domainName: "Q402 BNB Chain",
    implContract: "0x6cF4aD62C208b6494a55a1494D497713ba013dFa",
    gasToken: "BNB",
    explorer: "https://bscscan.com",
    usdc: { address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", decimals: 18 },
    usdt: { address: "0x55d398326f99059fF775485246999027B3197955", decimals: 18 },
    // Q (QuackAI) - BNB-only, 18 dec. Gasless agentic send via the standard
    // bnb TransferAuthorization; the relay allowlists Q on bnb.
    q: { address: "0xc07e1300dc138601FA6B0b59f8D0FA477e690589", decimals: 18 },
    supportedTokens: ["USDC", "USDT", "Q"],
    approxGasCostUsd: 1e-3
  },
  eth: {
    key: "eth",
    name: "Ethereum Mainnet",
    chainId: 1,
    domainName: "Q402 Ethereum",
    implContract: "0x8E67a64989CFcb0C40556b13ea302709CCFD6AaD",
    gasToken: "ETH",
    explorer: "https://etherscan.io",
    usdc: { address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 },
    usdt: { address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6 },
    // Ripple USD (RLUSD) - NY DFS regulated, decimals 18, UUPS proxy.
    // Ethereum-only; other chains' supportedTokens omits RLUSD.
    rlusd: { address: "0x8292Bb45bf1Ee4d140127049757C2E0fF06317eD", decimals: 18 },
    supportedTokens: ["USDC", "USDT", "RLUSD"],
    approxGasCostUsd: 1.2,
    note: "L1 - gas is volatile; quote is a snapshot, expect 5-10x swings during congestion. RLUSD supported here only."
  },
  xlayer: {
    key: "xlayer",
    name: "X Layer",
    chainId: 196,
    domainName: "Q402 X Layer",
    implContract: "0x8D854436ab0426F5BC6Cc70865C90576AD523E73",
    gasToken: "OKB",
    explorer: "https://www.oklink.com/xlayer",
    usdc: { address: "0x74b7F16337b8972027F6196A17a631aC6dE26d22", decimals: 6 },
    usdt: { address: "0x1E4a5963aBFD975d8c9021ce480b42188849D41D", decimals: 6 },
    supportedTokens: ["USDC", "USDT"],
    approxGasCostUsd: 2e-3
  },
  stable: {
    key: "stable",
    name: "Stable Chain",
    chainId: 988,
    domainName: "Q402 Stable",
    implContract: "0x2fb2B2D110b6c5664e701666B3741240242bf350",
    gasToken: "USDT0",
    explorer: "https://stable-explorer.io",
    // USDT0 (the only token on Stable) - both USDC and USDT API tokens resolve here.
    usdc: { address: "0x779ded0c9e1022225f8e0630b35a9b54be713736", decimals: 18 },
    usdt: { address: "0x779ded0c9e1022225f8e0630b35a9b54be713736", decimals: 18 },
    supportedTokens: ["USDC", "USDT"],
    approxGasCostUsd: 5e-4,
    note: "Gas is paid in USDT0; both USDC and USDT API inputs alias to USDT0."
  },
  mantle: {
    key: "mantle",
    name: "Mantle",
    chainId: 5e3,
    domainName: "Q402 Mantle",
    implContract: "0xE5b90D564650bdcE7C2Bb4344F777f6582e05699",
    gasToken: "MNT",
    explorer: "https://mantlescan.xyz",
    usdc: { address: "0x09Bc4E0D864854c6aFB6eB9A9cdF58aC190D0dF9", decimals: 6 },
    // USDT0 (LayerZero OFT) - Mantle ecosystem default since the 2025-11-27 migration.
    usdt: { address: "0x779Ded0c9e1022225f8E0630b35a9b54bE713736", decimals: 6 },
    supportedTokens: ["USDC", "USDT"],
    approxGasCostUsd: 2e-3
  },
  injective: {
    key: "injective",
    name: "Injective EVM",
    chainId: 1776,
    domainName: "Q402 Injective",
    implContract: "0xa9a7dcE76DEF2AC36057FeF0d8103dF10581d61e",
    gasToken: "INJ",
    explorer: "https://blockscout.injective.network",
    // Native Circle USDC (CCTP) + canonical Tether (USDT0), both 6 dec.
    usdc: { address: "0xa00C59fF5a080D2b954d0c75e46E22a0c371235a", decimals: 6 },
    usdt: { address: "0x88f7F2b685F9692caf8c478f5BADF09eE9B1Cc13", decimals: 6 },
    supportedTokens: ["USDC", "USDT"],
    approxGasCostUsd: 4e-3,
    note: "Native Circle USDC (CCTP) live since 2026-06; USDT0 also supported."
  },
  monad: {
    key: "monad",
    name: "Monad",
    chainId: 143,
    domainName: "Q402 Monad",
    implContract: "0xc5d4dFA6D2e545409C1abf86f336Dd43bb87621f",
    gasToken: "MON",
    explorer: "https://monadscan.com",
    // Native Circle USDC via CCTP V2 (not bridged) + USDT0 (LayerZero OFT).
    usdc: { address: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603", decimals: 6 },
    usdt: { address: "0xe7cd86e13AC4309349F30B3435a9d337750fC82D", decimals: 6 },
    supportedTokens: ["USDC", "USDT"],
    approxGasCostUsd: 2e-3
  },
  scroll: {
    key: "scroll",
    name: "Scroll",
    chainId: 534352,
    domainName: "Q402 Scroll",
    implContract: "0x7635F32D893B64b5944CB8cbF2AC4cd3dA41B2f1",
    gasToken: "ETH",
    explorer: "https://scrollscan.com",
    // Native Circle USDC + canonical Tether on Scroll mainnet (addresses
    // confirmed with Scroll team during integration handshake).
    usdc: { address: "0x06eFdBFf2a14a7c8E15944D1F4A48F9F95F663A4", decimals: 6 },
    usdt: { address: "0xf55BEC9cafDbE8730f096Aa55dad6D22d44099Df", decimals: 6 },
    supportedTokens: ["USDC", "USDT"],
    approxGasCostUsd: 1e-3,
    note: "zkEVM L2 - EIP-7702 live since the Euclid Phase 2 upgrade (2025-04-22). Data-availability cost dominates per-tx gas."
  },
  arbitrum: {
    key: "arbitrum",
    name: "Arbitrum One",
    chainId: 42161,
    domainName: "Q402 Arbitrum",
    implContract: "0x8D854436ab0426F5BC6Cc70865C90576AD523E73",
    gasToken: "ETH",
    explorer: "https://arbiscan.io",
    // Native Circle USDC (CCTP) + canonical Tether on Arbitrum One.
    // The legacy bridged USDC.e (0xFF970A61...) is intentionally NOT supported.
    usdc: { address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6 },
    usdt: { address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", decimals: 6 },
    supportedTokens: ["USDC", "USDT"],
    approxGasCostUsd: 1e-3,
    note: "Optimistic Rollup L2 - EIP-7702 live on Arbitrum One since ArbOS 40 'Callisto'; ArbOS 51 'Dia' (activated 2026-01-08) refined precompile delegation. Data-availability cost dominates per-tx gas."
  },
  base: {
    key: "base",
    name: "Base",
    chainId: 8453,
    domainName: "Q402 Base",
    implContract: "0x2fb2B2D110b6c5664e701666B3741240242bf350",
    gasToken: "ETH",
    explorer: "https://basescan.org",
    // Native Circle USDC + bridged Tether USD on Base, both 6 decimals.
    usdc: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
    usdt: { address: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2", decimals: 6 },
    supportedTokens: ["USDC", "USDT"],
    approxGasCostUsd: 1e-3,
    note: "OP Stack L2 - EIP-7702 live on Base mainnet via the Isthmus upgrade. Native Circle USDC; USDT is bridged. Data-availability cost dominates per-tx gas."
  },
  robinhood: {
    key: "robinhood",
    name: "Robinhood Chain",
    chainId: 4663,
    domainName: "Q402 Robinhood Chain",
    implContract: "0xa9a7dcE76DEF2AC36057FeF0d8103dF10581d61e",
    gasToken: "ETH",
    explorer: "https://robinhoodchain.blockscout.com",
    // USDG (Paxos Global Dollar) is the ONLY token on Robinhood Chain, 6 dec.
    // There is NO Circle USDC and NO Tether USDT here - the on-chain tokens with
    // those symbols are mock/scam and are intentionally not supported.
    usdg: { address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", decimals: 6 },
    supportedTokens: ["USDG"],
    approxGasCostUsd: 1e-3,
    note: "L2 - USDG (Paxos Global Dollar) is the only supported token; no Circle USDC or Tether USDT on this chain."
  }
};
var BNB_FOCUS_MODE = false;
var BNB_FOCUS_REJECTION_MESSAGE = 'BNB-only mode active: this chain/token is temporarily hidden. Full multi-chain support is the normal state. Pass chain: "bnb" with token "USDC" or "USDT".';
if (BNB_FOCUS_MODE) {
  for (const key of CHAIN_KEYS) {
    if (key !== "bnb") {
      CHAIN_CONFIG[key].supportedTokens = [];
    }
  }
}
function getChain(key) {
  const cfg = CHAIN_CONFIG[key];
  if (!cfg) throw new Error(`Unsupported chain: ${key}. Supported: ${CHAIN_KEYS.join(", ")}`);
  return cfg;
}
function tokenFor(cfg, token) {
  if (BNB_FOCUS_MODE && !(cfg.supportedTokens?.includes(token) ?? false)) {
    throw new Error(BNB_FOCUS_REJECTION_MESSAGE);
  }
  if (token === "RLUSD") {
    if (!cfg.rlusd) {
      throw new Error(
        `RLUSD is not supported on ${cfg.name} (key=${cfg.key}). RLUSD is currently Ethereum-only.`
      );
    }
    return cfg.rlusd;
  }
  if (token === "Q") {
    if (!cfg.q) {
      throw new Error(
        `Q (QuackAI) is not supported on ${cfg.name} (key=${cfg.key}). Q is currently BNB-only.`
      );
    }
    return cfg.q;
  }
  if (token === "USDG") {
    if (!cfg.usdg) {
      throw new Error(
        `USDG (Paxos Global Dollar) is not supported on ${cfg.name} (key=${cfg.key}). USDG is currently Robinhood-Chain-only.`
      );
    }
    return cfg.usdg;
  }
  const t = token === "USDC" ? cfg.usdc : cfg.usdt;
  if (!t) {
    throw new Error(
      `${token} is not supported on ${cfg.name} (key=${cfg.key}). Supported tokens: ${cfg.supportedTokens?.join(", ") ?? "none"}.`
    );
  }
  return t;
}

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
function detectAgenticModes(c = CONFIG) {
  const modeA = isValidPrivateKey(c.privateKey);
  const modeB = isValidPrivateKey(c.agenticPrivateKey);
  const modeC = c.apiKey !== null && c.apiKey.startsWith("q402_live_");
  let count = 0;
  if (modeA) count++;
  if (modeB) count++;
  if (modeC) count++;
  const primary = modeB ? "B" : modeA ? "A" : modeC ? "C" : null;
  return { modeA, modeB, modeC, count, primary };
}
var CONFIG = loadConfig();
var AVAX_TRIAL_END_EXCLUSIVE_UTC = /* @__PURE__ */ new Date("2026-08-14T15:00:00.000Z");
var MANTLE_TRIAL_START_UTC = /* @__PURE__ */ new Date("2026-08-20T15:00:00.000Z");
var MANTLE_TRIAL_END_EXCLUSIVE_UTC = /* @__PURE__ */ new Date("2026-08-28T15:00:00.000Z");
function isTrialChain(chain, atTime = /* @__PURE__ */ new Date()) {
  if (chain === "bnb" || chain === "base") return true;
  if (chain === "avax") {
    return atTime < AVAX_TRIAL_END_EXCLUSIVE_UTC;
  }
  if (chain === "mantle") {
    return atTime >= MANTLE_TRIAL_START_UTC && atTime < MANTLE_TRIAL_END_EXCLUSIVE_UTC;
  }
  return false;
}
function resolveApiKey(chain, scope = "auto") {
  const effectiveScope = scope === "auto" ? (
    // Unified rule for single + batch: trial-eligible chains (BNB and
    // Mantle within its limited-time window) prefer Trial when set;
    // everything else uses Multichain. Batch cap ambiguity handled in batch-pay.ts.
    isTrialChain(chain) && CONFIG.trialApiKey ? "trial" : "multichain"
  ) : scope;
  if (effectiveScope === "trial") {
    if (!isTrialChain(chain)) {
      return {
        apiKey: null,
        scope: "trial",
        fromLegacyFallback: false,
        sandboxReason: `keyScope="trial" requested but chain="${chain}" is not a trial-eligible chain at this time. Trial keys support BNB Chain (permanent) and Mantle (limited-time: 2026-08-21~08-28 UTC+9). Avalanche trial has ended. Drop keyScope (or set keyScope="multichain") to use the paid Multichain key on ${chain}.`
      };
    }
    const key2 = CONFIG.trialApiKey ?? CONFIG.legacyApiKey;
    if (!key2) {
      return {
        apiKey: null,
        scope: "trial",
        fromLegacyFallback: false,
        sandboxReason: "keyScope='trial' requested but neither Q402_TRIAL_API_KEY nor Q402_API_KEY is set. Get a free Trial key at https://q402.quackai.ai/event."
      };
    }
    return { apiKey: key2, scope: "trial", fromLegacyFallback: !CONFIG.trialApiKey };
  }
  const key = CONFIG.multichainApiKey ?? CONFIG.legacyApiKey;
  if (!key) {
    return {
      apiKey: null,
      scope: "multichain",
      fromLegacyFallback: false,
      sandboxReason: (scope === "multichain" ? "keyScope='multichain' requested but neither Q402_MULTICHAIN_API_KEY" : `chain="${chain}" routes to the Multichain scope but neither Q402_MULTICHAIN_API_KEY`) + " nor Q402_API_KEY is set. Activate a paid plan at https://q402.quackai.ai/payment to get one."
    };
  }
  return { apiKey: key, scope: "multichain", fromLegacyFallback: !CONFIG.multichainApiKey };
}
var PRIVATE_KEY_RE = /^0x[a-fA-F0-9]{64}$/;
function isLiveModeFor(resolved) {
  if (!resolved.apiKey) return false;
  if (!CONFIG.realPaymentsRequested) return false;
  const hasMode_A_Key = typeof CONFIG.privateKey === "string" && PRIVATE_KEY_RE.test(CONFIG.privateKey);
  const hasMode_B_Key = typeof CONFIG.agenticPrivateKey === "string" && PRIVATE_KEY_RE.test(CONFIG.agenticPrivateKey);
  if (!hasMode_A_Key && !hasMode_B_Key) return false;
  return resolved.apiKey.startsWith("q402_live_");
}
var isValidPrivateKey = (s) => typeof s === "string" && PRIVATE_KEY_RE.test(s);

// src/client.ts
import {
  JsonRpcProvider,
  Wallet,
  hexlify,
  parseUnits,
  randomBytes,
  toBigInt
} from "ethers";

// src/sandbox-store.ts
import { existsSync as existsSync2, readFileSync as readFileSync2, writeFileSync, mkdirSync, statSync as statSync2 } from "fs";
import { homedir as homedir2 } from "os";
import { join as join2, dirname } from "path";
var SANDBOX_STORE_PATH = join2(homedir2(), ".q402", "sandbox-receipts.json");
var MAX_STORE_BYTES = 512 * 1024;
var MAX_STORE_ENTRIES = 1e3;
function readStore(path = SANDBOX_STORE_PATH) {
  try {
    if (!existsSync2(path)) return {};
    const size = statSync2(path).size;
    if (size > MAX_STORE_BYTES) {
      process.stderr.write(`[q402-mcp] sandbox store too large (${size} bytes); skipping read
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
function writeStore(map, path = SANDBOX_STORE_PATH) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(map, null, 2), "utf-8");
  } catch (e) {
    process.stderr.write(
      `[q402-mcp] sandbox store write failed: ${e instanceof Error ? e.message : String(e)}
`
    );
  }
}
function saveSandboxReceipt(record, path = SANDBOX_STORE_PATH) {
  const map = readStore(path);
  map[record.receiptId] = record;
  const keys = Object.keys(map);
  if (keys.length > MAX_STORE_ENTRIES) {
    const sorted = keys.sort((a, b) => {
      const ta = map[a]?.createdAt ?? "";
      const tb = map[b]?.createdAt ?? "";
      return ta < tb ? -1 : ta > tb ? 1 : 0;
    });
    const excess = sorted.slice(0, keys.length - MAX_STORE_ENTRIES);
    for (const k of excess) delete map[k];
  }
  const serialized = JSON.stringify(map, null, 2);
  if (Buffer.byteLength(serialized, "utf-8") > MAX_STORE_BYTES) {
    process.stderr.write("[q402-mcp] sandbox store would exceed size cap; skipping write\n");
    return;
  }
  writeStore(map, path);
}

// src/client.ts
var DEFAULT_RPC = {
  1: "https://ethereum.publicnode.com",
  56: "https://bsc-dataseed1.binance.org/",
  143: "https://rpc.monad.xyz",
  196: "https://rpc.xlayer.tech",
  988: "https://rpc.stable.xyz",
  1776: "https://sentry.evm-rpc.injective.network/",
  5e3: "https://rpc.mantle.xyz",
  8453: "https://mainnet.base.org",
  42161: "https://arb1.arbitrum.io/rpc",
  43114: "https://api.avax.network/ext/bc/C/rpc",
  534352: "https://rpc.scroll.io"
};
var TRANSFER_AUTH_TYPES = {
  TransferAuthorization: [
    { name: "owner", type: "address" },
    { name: "facilitator", type: "address" },
    { name: "token", type: "address" },
    { name: "recipient", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" }
  ]
};
function toRawAmount(amount, decimals) {
  if (typeof amount !== "string" || amount.trim() === "") {
    throw new Error('amount must be a non-empty decimal string (e.g. "5.00")');
  }
  if (!/^\d+(\.\d+)?$/.test(amount)) {
    throw new Error(
      `invalid amount "${amount}" - use a positive decimal string (no sign, no scientific notation, no whitespace)`
    );
  }
  let raw;
  try {
    raw = parseUnits(amount, decimals);
  } catch {
    throw new Error(`amount "${amount}" exceeds ${decimals} decimal places`);
  }
  if (raw <= 0n) {
    throw new Error(`amount must be greater than zero (got "${amount}")`);
  }
  return raw.toString();
}
async function signAuthorization(wallet, args) {
  const auth = await wallet.authorize({
    chainId: args.chainId,
    address: args.address,
    nonce: args.nonce
  });
  return {
    chainId: Number(auth.chainId),
    address: auth.address,
    nonce: Number(auth.nonce),
    yParity: auth.signature.yParity,
    r: auth.signature.r,
    s: auth.signature.s
  };
}
var Q402NodeClient = class _Q402NodeClient {
  opts;
  constructor(opts) {
    this.opts = opts;
  }
  /**
   * Build a TX-shaped explorer URL from the chain's explorer base.
   */
  static explorerUrl(chain, txHash) {
    if (!txHash) return null;
    return `${chain.explorer.replace(/\/$/, "")}/tx/${txHash}`;
  }
  async fetchFacilitator() {
    const url = `${this.opts.relayBaseUrl.replace(/\/$/, "")}/relay/info`;
    let resp;
    try {
      resp = await fetch(url, { signal: AbortSignal.timeout(1e4) });
    } catch (e) {
      if (e instanceof Error && (e.name === "TimeoutError" || /aborted/i.test(e.message))) {
        throw new Error("Q402 relay didn't respond within 10s while reading facilitator info - the relay may be temporarily degraded. Safe to retry.");
      }
      throw e;
    }
    if (!resp.ok) {
      throw new Error(
        `failed to fetch relay facilitator info from ${url} (${resp.status})`
      );
    }
    const data = await resp.json();
    if (!data.facilitator || typeof data.facilitator !== "string") {
      throw new Error("relay/info did not return a facilitator address");
    }
    return data.facilitator;
  }
  async pay(input) {
    const { chain, relayBaseUrl, apiKey, privateKey } = this.opts;
    const tokenCfg = tokenFor(chain, input.token);
    if (chain.supportedTokens && !chain.supportedTokens.includes(input.token)) {
      throw new Error(
        `token ${input.token} is not supported on chain ${chain.key}. Supported: ${chain.supportedTokens.join(", ")}.`
      );
    }
    const amountRaw = toRawAmount(input.amount, tokenCfg.decimals);
    const deadline = Math.floor(Date.now() / 1e3) + 600;
    const rpcUrl = this.opts.rpcUrl ?? DEFAULT_RPC[chain.chainId];
    if (!rpcUrl) {
      throw new Error(
        `no RPC URL configured for chain ${chain.key} (chainId ${chain.chainId})`
      );
    }
    const provider = new JsonRpcProvider(rpcUrl);
    const wallet = new Wallet(privateKey, provider);
    const owner = await wallet.getAddress();
    const facilitator = await this.fetchFacilitator();
    const paymentNonce = toBigInt(randomBytes(32));
    const witnessSig = await wallet.signTypedData(
      {
        name: chain.domainName,
        version: "1",
        chainId: chain.chainId,
        verifyingContract: owner
        // EIP-7702: address(this) resolves to the EOA
      },
      TRANSFER_AUTH_TYPES,
      {
        owner,
        facilitator,
        token: tokenCfg.address,
        recipient: input.to,
        amount: BigInt(amountRaw),
        nonce: paymentNonce,
        deadline: BigInt(deadline)
      }
    );
    const authNonce = await provider.getTransactionCount(owner);
    const authorization = await signAuthorization(wallet, {
      chainId: chain.chainId,
      address: chain.implContract,
      nonce: authNonce
    });
    const baseBody = {
      apiKey,
      chain: chain.key,
      token: input.token,
      from: owner,
      to: input.to,
      amount: amountRaw,
      deadline,
      witnessSig,
      authorization,
      facilitator
    };
    const body = chain.key === "xlayer" ? { ...baseBody, xlayerNonce: paymentNonce.toString() } : chain.key === "stable" ? { ...baseBody, stableNonce: paymentNonce.toString() } : { ...baseBody, nonce: paymentNonce.toString() };
    let resp;
    try {
      resp = await fetch(`${relayBaseUrl.replace(/\/$/, "")}/relay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(3e4)
      });
    } catch (e) {
      if (e instanceof Error && (e.name === "TimeoutError" || /aborted/i.test(e.message))) {
        throw new Error("Q402 relay didn't respond within 30s - the relay may be temporarily degraded. Safe to retry.");
      }
      throw e;
    }
    const data = await resp.json();
    if (!resp.ok) {
      throw new Error(data.error ?? `relay failed (HTTP ${resp.status})`);
    }
    data.mode = "live";
    data.explorerUrl = _Q402NodeClient.explorerUrl(chain, data.txHash);
    return data;
  }
  /**
   * Multi-recipient settlement on a single chain + token. Trial keys can
   * fan out to at most 5 recipients per call; paid keys up to 20. The
   * server enforces the cap and rejects oversized batches with
   * `BATCH_TOO_LARGE`.
   *
   * Each recipient is independently authorised: one EIP-712
   * TransferAuthorization witness + one EIP-7702 authorization tuple
   * per row. The authorization nonces are issued sequentially starting
   * from the EOA's current on-chain nonce, so the EVM applies them
   * cleanly in batch order. Execution is sequential server-side; the
   * first transfer must succeed (it installs / re-confirms the
   * delegation), after which the remaining transfers are surfaced in
   * the result array even if individual ones fail.
   *
   * Signature shape: `{ token, recipients }`. The request body only ships
   * one token field, so a per-row token would be silently ignored. The
   * shape surfaces the constraint in the type so consumers can't
   * accidentally build a "mixed-token batch" that would quietly drop
   * the second token. Same chain + same token across one batch, full
   * stop.
   */
  async batchPay(input) {
    const { token, recipients: rows } = input;
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new Error("batchPay requires at least one recipient");
    }
    if (typeof token !== "string") {
      throw new Error("batchPay({ token, recipients }): token must be a string");
    }
    const { chain, relayBaseUrl, apiKey, privateKey } = this.opts;
    const tokenCfg = tokenFor(chain, token);
    if (chain.supportedTokens && !chain.supportedTokens.includes(token)) {
      throw new Error(
        `token ${token} is not supported on chain ${chain.key}. Supported: ${chain.supportedTokens.join(", ")}.`
      );
    }
    for (let i = 0; i < rows.length; i++) {
      try {
        toRawAmount(rows[i].amount, tokenCfg.decimals);
      } catch (e) {
        throw new Error(
          `recipient[${i}]: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }
    if (chain.key === "xlayer" || chain.key === "stable") {
      throw new Error(
        `batchPay does not yet support chain "${chain.key}". Supported batch chains: avax, bnb, eth, mantle, injective, monad, scroll (default EIP-7702 mode). For "${chain.key}" use pay() in a client-side loop.`
      );
    }
    const rpcUrl = this.opts.rpcUrl ?? DEFAULT_RPC[chain.chainId];
    if (!rpcUrl) {
      throw new Error(
        `no RPC URL configured for chain ${chain.key} (chainId ${chain.chainId})`
      );
    }
    const provider = new JsonRpcProvider(rpcUrl);
    const wallet = new Wallet(privateKey, provider);
    const owner = await wallet.getAddress();
    const facilitator = await this.fetchFacilitator();
    const baseAuthNonce = await provider.getTransactionCount(owner);
    const deadline = Math.floor(Date.now() / 1e3) + 600;
    const signedRows = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const amountRaw = toRawAmount(row.amount, tokenCfg.decimals);
      const paymentNonce = toBigInt(randomBytes(32));
      const witnessSig = await wallet.signTypedData(
        {
          name: chain.domainName,
          version: "1",
          chainId: chain.chainId,
          verifyingContract: owner
        },
        TRANSFER_AUTH_TYPES,
        {
          owner,
          facilitator,
          token: tokenCfg.address,
          recipient: row.to,
          amount: BigInt(amountRaw),
          nonce: paymentNonce,
          deadline: BigInt(deadline)
        }
      );
      const authorization = await signAuthorization(wallet, {
        chainId: chain.chainId,
        address: chain.implContract,
        nonce: baseAuthNonce + i
      });
      signedRows.push({
        from: owner,
        to: row.to,
        amount: amountRaw,
        nonce: paymentNonce.toString(),
        deadline,
        witnessSig,
        authorization
      });
    }
    let resp;
    try {
      resp = await fetch(`${relayBaseUrl.replace(/\/$/, "")}/relay/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey,
          chain: chain.key,
          token,
          facilitator,
          recipients: signedRows
        }),
        signal: AbortSignal.timeout(6e4)
      });
    } catch (e) {
      if (e instanceof Error && (e.name === "TimeoutError" || /aborted/i.test(e.message))) {
        throw new Error("Q402 relay didn't respond within 60s on the batch path - the relay may be temporarily degraded. Safe to retry.");
      }
      throw e;
    }
    const data = await resp.json();
    if (!resp.ok || data.ok === false) {
      const err = new BatchPayError(
        data.aborted ? `Batch aborted: recipient[0] failed (${data.results?.[0]?.error ?? "unknown"}). No transfers landed.` : data.totalFailed > 0 ? `Batch completed with ${data.totalFailed}/${data.results?.length ?? "?"} failed rows.` : data.error ?? `relay/batch failed (HTTP ${resp.status})`,
        {
          aborted: !!data.aborted,
          // Preserve the server's scope/limit so the MCP tool surface can
          // report the actual tier (trial vs paid) rather than guessing.
          // Falls back to "paid" / row count only when the failure didn't
          // come from the relay route (e.g. network-level error).
          scope: data.scope ?? "paid",
          limit: data.limit ?? signedRows.length,
          totalSuccess: data.totalSuccess ?? 0,
          totalFailed: data.totalFailed ?? signedRows.length,
          results: data.results ?? []
        }
      );
      throw err;
    }
    data.results = data.results.map((r) => ({
      ...r,
      ...r.success && r.txHash ? { explorerUrl: _Q402NodeClient.explorerUrl(chain, r.txHash) } : {}
    }));
    return data;
  }
};
var BatchPayError = class extends Error {
  aborted;
  scope;
  limit;
  totalSuccess;
  totalFailed;
  results;
  constructor(message, details) {
    super(message);
    this.name = "BatchPayError";
    this.aborted = details.aborted;
    this.scope = details.scope;
    this.limit = details.limit;
    this.totalSuccess = details.totalSuccess;
    this.totalFailed = details.totalFailed;
    this.results = details.results;
  }
};
function sandboxPay(chain, input, payer = "0x0000000000000000000000000000000000000000") {
  const tokenCfg = tokenFor(chain, input.token);
  const tokenAmountRaw = toRawAmount(input.amount, tokenCfg.decimals);
  const fakeHash = "0x" + hexlify(randomBytes(32)).slice(2);
  const receiptId = "rct_" + hexlify(randomBytes(12)).slice(2);
  const createdAt = (/* @__PURE__ */ new Date()).toISOString();
  saveSandboxReceipt({
    receiptId,
    createdAt,
    txHash: fakeHash,
    chain: chain.key,
    payer,
    recipient: input.to,
    token: input.token,
    tokenAmount: input.amount,
    tokenAmountRaw,
    method: "sandbox",
    sandbox: true
  });
  return {
    // `success: false` because no funds moved. The `sandbox: true` flag is
    // the canonical "this was a simulation" marker - downstream callers
    // should branch on EITHER field to avoid misreporting a settlement.
    success: false,
    sandbox: true,
    txHash: fakeHash,
    tokenAmount: input.amount,
    token: input.token,
    chain: chain.key,
    method: "sandbox",
    mode: "sandbox",
    explorerUrl: null,
    receiptId
  };
}

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
function recipientGuard(to, allow) {
  if (allow.length === 0) return;
  if (!allow.includes(to.toLowerCase())) {
    throw new Error(
      `recipient ${to} is not in Q402_ALLOWED_RECIPIENTS. Either add this address to the allowlist or unset the env var to disable the guard.`
    );
  }
}

// src/tools/precheck.ts
import { existsSync as existsSync4, readFileSync as readFileSync4, writeFileSync as writeFileSync3, mkdirSync as mkdirSync3 } from "fs";
import { homedir as homedir4 } from "os";
import { join as join4, dirname as dirname3 } from "path";

// src/tools/x402-fetch.ts
import { Wallet as Wallet2, hexlify as hexlify2, randomBytes as randomBytes2 } from "ethers";
import { z } from "zod";

// src/tools/x402-audit-store.ts
import { existsSync as existsSync3, readFileSync as readFileSync3, writeFileSync as writeFileSync2, mkdirSync as mkdirSync2, statSync as statSync3 } from "fs";
import { homedir as homedir3 } from "os";
import { join as join3, dirname as dirname2 } from "path";
var X402_AUDIT_PATH = join3(homedir3(), ".q402", "x402-audit.json");
var MAX_STORE_BYTES2 = 512 * 1024;

// src/tools/x402-fetch.ts
var BASE_CHAIN_ID = 8453;
var BASE_USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
var BASE_USDC_ADDRESS_LC = BASE_USDC_ADDRESS.toLowerCase();
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
function dynEnv(key) {
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
async function signEip3009(privateKey, payTo, amountAtomic, deadlineSeconds) {
  const wallet = new Wallet2(privateKey);
  const from = await wallet.getAddress();
  const nonce = hexlify2(randomBytes2(32));
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
  const raw = dynEnv("Q402_BUILDER_CODE");
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
  const agentKey = dynEnv("Q402_AGENTIC_PRIVATE_KEY") ?? null;
  if (isValidPrivateKey(agentKey)) return agentKey;
  const eoaKey = dynEnv("Q402_PRIVATE_KEY") ?? null;
  if (isValidPrivateKey(eoaKey)) return eoaKey;
  return null;
}
function selectRequirement(accepts) {
  return accepts.find(
    (a) => a.scheme === "exact" && (a.network === "base" || a.network === "base-mainnet" || a.network === "eip155:8453") && a.asset.toLowerCase() === BASE_USDC_ADDRESS_LC
  ) ?? null;
}

// src/tools/precheck.ts
var PRECHECK_OPT_OUT_ENV = "Q402_DISABLE_PRECHECK";
var PRECHECK_FEE_USD = 0.02;
var VERDICT_TTL_MS = 7 * 24 * 60 * 60 * 1e3;
var PRECHECK_CACHE_PATH = join4(homedir4(), ".q402", "precheck-cache.json");
var _verdictCache = /* @__PURE__ */ new Map();
var _cacheLoaded = false;
var _cachePathOverride = null;
function _effectiveCachePath() {
  return _cachePathOverride ?? PRECHECK_CACHE_PATH;
}
function _loadCacheFile() {
  if (_cacheLoaded) return;
  _cacheLoaded = true;
  try {
    const path = _effectiveCachePath();
    if (!existsSync4(path)) return;
    const raw = readFileSync4(path, "utf-8");
    const parsed = JSON.parse(raw);
    const now = Date.now();
    for (const [k, v] of Object.entries(parsed)) {
      if (v && typeof v.expiresAt === "number" && v.expiresAt > now) {
        _verdictCache.set(k, v);
      }
    }
  } catch {
  }
}
function _persistCacheFile() {
  try {
    const path = _effectiveCachePath();
    mkdirSync3(dirname3(path), { recursive: true });
    const obj = {};
    for (const [k, v] of _verdictCache.entries()) {
      obj[k] = v;
    }
    writeFileSync3(path, JSON.stringify(obj, null, 2), "utf-8");
  } catch (e) {
    process.stderr.write(
      `[q402-mcp] precheck cache write failed: ${e instanceof Error ? e.message : String(e)}
`
    );
  }
}
function getVerdictFromCache(address) {
  _loadCacheFile();
  const key = address.toLowerCase();
  const entry = _verdictCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    _verdictCache.delete(key);
    return null;
  }
  return entry.verdict;
}
function setVerdictInCache(address, verdict) {
  _loadCacheFile();
  _verdictCache.set(address.toLowerCase(), {
    verdict,
    expiresAt: Date.now() + VERDICT_TTL_MS
  });
  _persistCacheFile();
}
function isPrecheckOptedOut() {
  return process.env[PRECHECK_OPT_OUT_ENV] === "1";
}
function checkFeeAffordability(opts) {
  const { walletUsdcBalanceUsd, transferAmountUsd, payToken, hasUsdc } = opts;
  const isNonUsdcRailToken = payToken === "USDT" || payToken === "RLUSD" || payToken === "USDG" || payToken === "USDT0";
  if (isNonUsdcRailToken && !hasUsdc) {
    return "no_usdc_rail";
  }
  if (walletUsdcBalanceUsd !== void 0 && walletUsdcBalanceUsd >= transferAmountUsd && walletUsdcBalanceUsd < transferAmountUsd + PRECHECK_FEE_USD) {
    return "exact_balance";
  }
  return null;
}
async function runPrecheck(ctx, trustCheckFn) {
  if (ctx.mode !== "live") {
    return { ran: false, reason: "sandbox", fromCache: false, charged: false };
  }
  if (isPrecheckOptedOut()) {
    return { ran: false, reason: "opt_out", fromCache: false, charged: false };
  }
  const addr = ctx.counterpartyAddress.toLowerCase();
  const isFirstTime = getVerdictFromCache(addr) === null;
  const isLargeAmount = ctx.amountUsd >= 1;
  if (!isFirstTime && !isLargeAmount) {
    return { ran: false, reason: "not_triggered", fromCache: false, charged: false };
  }
  const cached = getVerdictFromCache(addr);
  if (cached) {
    return { ran: true, reason: "cached", verdict: cached, fromCache: true, charged: false };
  }
  const hasUsdc = ctx.hasUsdc ?? true;
  const degradationReason = checkFeeAffordability({
    walletUsdcBalanceUsd: ctx.walletUsdcBalanceUsd,
    transferAmountUsd: ctx.amountUsd,
    payToken: ctx.payToken,
    hasUsdc
  });
  if (degradationReason !== null) {
    process.stderr.write(
      `[q402-mcp] precheck degraded to free basic verdict (reason: ${degradationReason}) for counterparty ${addr}
`
    );
    const upgradeHint = degradationReason === "exact_balance" ? `Pre-check used free basic verdict: wallet balance covers the transfer but not the $${PRECHECK_FEE_USD} trust-check fee. Top up your USDC balance (~$1 covers ~50 checks) to enable full paid pre-checks.` : `Pre-check used free basic verdict: wallet holds non-USDC rail tokens but no USDC to pay the $${PRECHECK_FEE_USD} trust-check fee. Add USDC to your wallet to enable full paid pre-checks.`;
    const verdict = {
      address: addr,
      risk: "unknown",
      flags: [],
      isFree: true,
      degradationReason,
      upgradeHint
    };
    return { ran: true, reason: "degraded_free", verdict, fromCache: false, charged: false };
  }
  try {
    const raw = await trustCheckFn(addr);
    const verdict = {
      risk: raw.risk,
      flags: raw.flags,
      address: addr,
      isFree: false
    };
    setVerdictInCache(addr, verdict);
    return { ran: true, reason: "paid", verdict, fromCache: false, charged: raw.settled ?? true };
  } catch (err) {
    process.stderr.write(
      `[q402-mcp] precheck error (${err instanceof Error ? err.message : String(err)}); main transaction proceeds
`
    );
    return { ran: false, reason: "error", fromCache: false, charged: false };
  }
}
function riskFromFlags(flags) {
  if (flags.some((f) => f.severity === "high")) return "high";
  if (flags.some((f) => f.severity === "medium")) return "medium";
  if (flags.length > 0) return "low";
  return "low";
}
var BASE_USDC_ADDRESS_LC2 = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
function makeX402TrustCheckFn(opts) {
  return async (address) => {
    const url = `${opts.relayBaseUrl}/api/x402/agent-trust/${address}`;
    const resp1 = await fetch(url, {
      signal: AbortSignal.timeout(15e3)
    });
    if (resp1.status === 200) {
      const data = await resp1.json();
      const flags = Array.isArray(data.riskFlags) ? data.riskFlags : [];
      return { risk: riskFromFlags(flags), flags: flags.map((f) => f.flag), settled: false };
    }
    if (resp1.status !== 402) {
      const body = await resp1.text().catch(() => "");
      throw new Error(`trust-check HTTP ${resp1.status}: ${body.slice(0, 200)}`);
    }
    const raw402 = await resp1.json();
    const accepts = raw402.accepts ?? [];
    const selected = selectRequirement(accepts);
    if (!selected) {
      throw new Error("trust-check: 402 response has no supported Base USDC payment option");
    }
    const rawAmount = selected.amount ?? selected["maxAmountRequired"];
    if (!rawAmount) {
      throw new Error("trust-check: 402 requirement missing amount");
    }
    if (!selected.payTo || selected.asset.toLowerCase() !== BASE_USDC_ADDRESS_LC2) {
      throw new Error("trust-check: selected requirement is not a Base USDC payment");
    }
    const req = { ...selected, amount: rawAmount };
    const challengeVersion = raw402.x402Version ?? raw402.version ?? 1;
    const signingKey = pickSigningKey();
    if (!signingKey) {
      throw new Error(
        "trust-check: no signing key configured (set Q402_AGENTIC_PRIVATE_KEY or Q402_PRIVATE_KEY)"
      );
    }
    const signed = await signEip3009(
      signingKey,
      req.payTo,
      rawAmount,
      req.maxTimeoutSeconds ?? 300
    );
    const xPayment = buildXPaymentHeader({
      from: signed.from,
      payTo: req.payTo,
      amountAtomic: rawAmount,
      validBefore: signed.validBefore,
      nonce: signed.nonce,
      signature: signed.signature,
      requirement: req,
      resource: raw402.resource,
      challengeExtensions: raw402.extensions,
      challengeVersion,
      builderCode: getBuilderCode()
    });
    const resp2 = await fetch(url, {
      headers: { [xPayment.headerName]: xPayment.value },
      signal: AbortSignal.timeout(15e3)
    });
    if (!resp2.ok) {
      const body = await resp2.text().catch(() => "");
      throw new Error(`trust-check x402 retry HTTP ${resp2.status}: ${body.slice(0, 200)}`);
    }
    const data2 = await resp2.json();
    const flags2 = Array.isArray(data2.riskFlags) ? data2.riskFlags : [];
    return { risk: riskFromFlags(flags2), flags: flags2.map((f) => f.flag), settled: true };
  };
}

// src/tools/pay.ts
var PayInputSchema = z2.object({
  chain: z2.enum(["avax", "bnb", "eth", "xlayer", "stable", "mantle", "injective", "monad", "scroll", "arbitrum", "base", "robinhood"]),
  rail: z2.enum(["q402", "x402"]).optional().describe(
    'Settlement rail. Base only - leave unset everywhere else. "q402" (default) = Q402 gasless EIP-7702 (USDC + USDT). "x402" = the Coinbase x402 standard (EIP-3009 USDC transferWithAuthorization), settled gaslessly by the Q402 facilitator - Base USDC only, no Hooks. walletMode="agentic-server" only.'
  ),
  to: z2.string().refine(isAddress2, "to must be a valid 0x-prefixed EVM address").describe("Recipient EVM address (0x + 40 hex)."),
  amount: z2.string().regex(/^\d+(\.\d+)?$/, "amount must be a positive decimal string").describe('Human-readable decimal amount, e.g. "5.00".'),
  token: z2.enum(["USDC", "USDT", "RLUSD", "Q", "USDG"]).describe(
    "Token symbol. USDC / USDT supported on most chains. RLUSD (Ripple USD, NY DFS regulated, decimals 18) is Ethereum-only. Q (QuackAI, decimals 18) is BNB-only. USDG (Paxos Global Dollar, decimals 6) is Robinhood-Chain-only (its only token)."
  ),
  keyScope: z2.enum(["auto", "trial", "multichain"]).optional().describe(
    'Which API key to use. "auto" (default): trial-eligible chain + Q402_TRIAL_API_KEY set \u2192 Trial (free sponsored); else Multichain. "trial" forces the Trial sponsored key (BNB Chain permanently; Mantle limited-time 2026-08-21~08-28 UTC+9; Avalanche trial has ended). "multichain" forces the paid 12-chain key. Same rule applies to q402_batch_pay.'
  ),
  walletMode: z2.enum(["eoa", "agentic-local", "agentic-server"]).optional().describe(
    `Which wallet to spend from:
  "eoa"              - the user's real MetaMask/OKX EOA, signed locally with Q402_PRIVATE_KEY
  "agentic-local"    - the Agent Wallet's exported private key (Q402_AGENTIC_PRIVATE_KEY)
  "agentic-server"   - the server-managed Agent Wallet (Q402 holds the key; one-shot payments need any live key \u2014 Trial or Multichain)
When MORE THAN ONE wallet is configured in the user's environment, you MUST ask the user which to use before calling - do NOT guess. Phrase: "You have multiple wallets set up - pay from your EOA, or your Agent Wallet?" When only one wallet is configured this argument is optional and the tool routes there automatically.`
  ),
  walletId: z2.string().optional().describe(
    `Server-managed Agent Wallet only (walletMode="agentic-server"). Lowercased Agent Wallet address selecting which of the user's wallets to spend from when they hold more than one (max 10 per owner). Omit to use the user's default wallet. Ignored for walletMode="eoa" and "agentic-local" since those modes carry their own signing key.`
  ),
  confirm: z2.literal(true).describe(
    "MUST be true. Prove the user explicitly approved this exact payment in the conversation right before this tool was called. When hookParams is set you MUST confirm what it actually does to the money: the split RECIPIENTS and their shares (funds go to those addresses, not `to`), and any oracle condition gating the settlement - not just the top-level recipient and amount. Setting this to true on behalf of the user without that confirmation is a violation of the tool contract."
  ),
  consentToken: z2.string().optional().describe(
    'Two-phase consent. LEAVE THIS UNSET on the first call: the tool will NOT send - it returns status="needs_confirmation" with a human-readable `preview` of the exact payment and a `consentToken`. Relay that preview to the user verbatim, get their explicit yes, then call again with the SAME args plus this `consentToken`. The tool re-derives the token from the params it is about to execute and refuses on mismatch, so you cannot preview one payment and execute another. Never fabricate a token.'
  ),
  hookParams: z2.object({
    recipientAgentId: z2.string().optional().describe("ReputationGate: the recipient's ERC-8004 agent id."),
    condition: z2.object({
      kind: z2.enum(["price", "timestamp"]),
      feed: z2.string().optional().describe('Chainlink feed pair for kind="price", e.g. "BTC/USD".'),
      op: z2.enum([">=", "<=", ">", "<", "after", "before"]),
      value: z2.number().describe('USD price (kind="price") or unix seconds (kind="timestamp").')
    }).optional().describe('ConditionalOracle: settle only when this condition holds, e.g. { kind:"price", feed:"BTC/USD", op:">=", value:80000 }.'),
    splits: z2.array(z2.object({ recipient: z2.string(), bps: z2.number() })).optional().describe("MultiPayeeSplit: per-payment N-way split; bps must sum to 10000.")
  }).optional().describe(
    'Q402 Hook parameters (server-managed Agent Wallet path only). Attaches per-payment hook conditions: a ConditionalOracle price/time gate, a MultiPayeeSplit fan-out, or a ReputationGate recipient agent id. Honoured only on walletMode="agentic-server".'
  )
});
function logPayGuardBlock(guard, reason) {
  process.stderr.write(`[q402-mcp] pay guard blocked (${guard}): ${reason}
`);
}
async function runPay(input) {
  const chain = getChain(input.chain);
  tokenFor(chain, input.token);
  if (chain.supportedTokens && !chain.supportedTokens.includes(input.token)) {
    throw new Error(
      `token ${input.token} is not supported on chain ${chain.key}. Supported on this chain: ${chain.supportedTokens.join(", ")}.`
    );
  }
  const guardsApplied = [];
  function failureResult(method) {
    return {
      success: false,
      sandbox: false,
      txHash: "",
      tokenAmount: input.amount,
      token: input.token,
      chain: chain.key,
      method,
      explorerUrl: null
    };
  }
  const modes = detectAgenticModes(CONFIG);
  const available = [];
  if (modes.modeA && CONFIG.privateKey && isValidPrivateKey(CONFIG.privateKey)) {
    try {
      const addr = new Wallet3(CONFIG.privateKey).address;
      available.push({
        id: "eoa",
        label: "Your real MetaMask / OKX EOA",
        addressShort: `${addr.slice(0, 6)}\u2026${addr.slice(-4)}`,
        note: "Signs locally with Q402_PRIVATE_KEY. Your wallet becomes EIP-7702-delegated after the first payment on each chain."
      });
    } catch {
    }
  }
  if (modes.modeB && CONFIG.agenticPrivateKey && isValidPrivateKey(CONFIG.agenticPrivateKey)) {
    try {
      const addr = new Wallet3(CONFIG.agenticPrivateKey).address;
      available.push({
        id: "agentic-local",
        label: "Agent Wallet (local signing with exported key)",
        addressShort: `${addr.slice(0, 6)}\u2026${addr.slice(-4)}`,
        note: "Signs locally with Q402_AGENTIC_PRIVATE_KEY. Your MetaMask is never touched."
      });
    } catch {
    }
  }
  if (modes.modeC) {
    available.push({
      id: "agentic-server",
      label: "Agent Wallet (server-managed)",
      note: "Q402 holds the encrypted key; payment fires through /api/wallet/agentic/send. Dashboard caps bound USDC/USDT/RLUSD/USDG spend; Q is exempt by design (your own token), but the recipient allowlist + confirmation still apply."
    });
  }
  const requestedMode = input.walletMode;
  const requestedAvailable = requestedMode ? available.some((w) => w.id === requestedMode) : false;
  if (requestedMode && !requestedAvailable) {
    return {
      result: failureResult("wallet_mode_unavailable"),
      guardsApplied: [
        `wallet_modes_available=${available.length}`,
        `requested=${requestedMode}`
      ],
      ambiguousWalletChoice: {
        question: available.length === 0 ? `The "${requestedMode}" wallet isn't configured. None of the supported wallets are set up - see the doctor for setup instructions.` : `The "${requestedMode}" wallet isn't configured in this environment. Supported wallets here: ${available.map((w) => `"${w.id}"`).join(", ")}. Which would you like to use instead?`,
        available
      }
    };
  }
  if (available.length > 1 && !requestedMode) {
    return {
      result: failureResult("needs_wallet_choice"),
      guardsApplied: [`wallet_modes_available=${available.length}`],
      ambiguousWalletChoice: {
        question: available.length === 2 ? `You have ${available.length} wallets set up - which one should I pay from?` : `You have ${available.length} wallets set up. Which one should I pay from?`,
        available
      }
    };
  }
  const effectiveMode = requestedMode && requestedAvailable ? requestedMode : available.length === 1 && available[0] ? available[0].id : "eoa";
  const signingPk = effectiveMode === "eoa" ? CONFIG.privateKey : effectiveMode === "agentic-local" ? CONFIG.agenticPrivateKey : null;
  let senderWallet;
  if (signingPk && isValidPrivateKey(signingPk)) {
    try {
      const addr = new Wallet3(signingPk).address;
      senderWallet = {
        address: addr,
        addressShort: `${addr.slice(0, 6)}\u2026${addr.slice(-4)}`
      };
    } catch {
    }
  }
  if (input.token !== "Q") {
    try {
      maxAmountGuard(input.amount, CONFIG.maxAmountPerCallUsd);
    } catch (e) {
      logPayGuardBlock("max_amount", e instanceof Error ? e.message : String(e));
      throw e;
    }
    guardsApplied.push(`max_amount<=${CONFIG.maxAmountPerCallUsd}`);
  } else {
    guardsApplied.push("max_amount=exempt(Q)");
  }
  try {
    recipientGuard(input.to, CONFIG.allowedRecipients);
  } catch (e) {
    logPayGuardBlock("recipient", e instanceof Error ? e.message : String(e));
    throw e;
  }
  if (input.hookParams?.splits) {
    for (const leg of input.hookParams.splits) {
      try {
        recipientGuard(leg.recipient, CONFIG.allowedRecipients);
      } catch (e) {
        logPayGuardBlock("recipient(split)", e instanceof Error ? e.message : String(e));
        throw e;
      }
    }
  }
  if (CONFIG.allowedRecipients.length > 0) {
    guardsApplied.push(`recipient_allowlist[${CONFIG.allowedRecipients.length}]`);
  }
  const consentIntent = {
    t: "pay",
    chain: input.chain,
    to: input.to.toLowerCase(),
    amount: input.amount,
    token: input.token,
    // Bind the settlement RAIL. On Base the same (to, amount, token) settles
    // very differently under q402 (EIP-7702) vs x402 (EIP-3009) - different
    // signature scheme, gas path, and wallet-state constraints. Consenting to a
    // Q402-rail preview must NOT authorise an x402 execution on the same token,
    // so a rail change invalidates the consent and forces a fresh preview.
    rail: input.rail ?? "q402",
    // Bind the funding source too - the user is consenting to spend from THIS
    // wallet, so a different walletMode/walletId needs a fresh preview.
    wm: effectiveMode,
    wid: (input.walletId ?? "").toLowerCase(),
    ...input.hookParams?.splits ? { splits: input.hookParams.splits.map((s) => ({ r: s.recipient.toLowerCase(), bps: s.bps })) } : {},
    // Bind the settlement-gating hooks too - a ConditionalOracle gate or a
    // ReputationGate materially changes WHEN/IF money moves, so dropping or
    // altering them after the preview must invalidate consent.
    ...input.hookParams?.condition ? { cond: { kind: input.hookParams.condition.kind, op: input.hookParams.condition.op, value: input.hookParams.condition.value, feed: input.hookParams.condition.feed ?? null } } : {},
    ...input.hookParams?.recipientAgentId ? { ragent: input.hookParams.recipientAgentId } : {}
  };
  const consent = checkConsent(consentIntent, input.consentToken);
  if (!consent.ok) {
    const splitNote = input.hookParams?.splits ? ` - split ${input.hookParams.splits.length} ways; funds go to the split recipients, not ${input.to}` : "";
    const fromNote = senderWallet ? ` from ${senderWallet.addressShort}` : "";
    const railNote = input.rail === "x402" ? " via the x402 (EIP-3009) rail" : "";
    return {
      result: failureResult("consent"),
      guardsApplied: [...guardsApplied, "two_phase_consent"],
      senderWallet,
      needsConsent: {
        status: "needs_confirmation",
        preview: `Send ${input.amount} ${input.token} to ${input.to} on ${chain.key}${railNote}${fromNote}${splitNote}. Confirm with the user, then re-call q402_pay with the same args plus consentToken="${consent.expected}".`,
        consentToken: consent.expected
      }
    };
  }
  const scopeRequest = input.keyScope ?? "auto";
  const resolved = resolveApiKey(input.chain, scopeRequest);
  guardsApplied.push(`scope=${resolved.scope}${resolved.fromLegacyFallback ? "(legacy)" : ""}`);
  if (effectiveMode === "agentic-server") {
    if (input.token === "RLUSD") {
      return {
        result: failureResult("rlusd_not_supported_for_server_mode"),
        guardsApplied: [
          ...guardsApplied,
          "wallet=agentic-server",
          "token=RLUSD",
          "rejected_pre_relay"
        ],
        senderWallet,
        setupHint: 'RLUSD is not yet supported by the server-managed Agent Wallet (walletMode="agentic-server"). Switch to walletMode="eoa" or "agentic-local" (with a private key set), or pick USDC/USDT for this send.'
      };
    }
    if (!resolved.apiKey || !resolved.apiKey.startsWith("q402_live_")) {
      const result2 = sandboxPay(chain, {
        to: input.to,
        amount: input.amount,
        token: input.token
      });
      guardsApplied.push("mode=sandbox", "wallet=agentic-server");
      return {
        result: result2,
        guardsApplied,
        senderWallet,
        setupHint: resolved.sandboxReason ?? "Server-mediated Agent Wallet needs a live Q402_MULTICHAIN_API_KEY. Visit https://q402.quackai.ai/payment to activate a paid plan."
      };
    }
    if (!CONFIG.realPaymentsRequested) {
      const result2 = sandboxPay(chain, {
        to: input.to,
        amount: input.amount,
        token: input.token
      });
      guardsApplied.push("mode=sandbox", "wallet=agentic-server");
      return {
        result: result2,
        guardsApplied,
        senderWallet,
        setupHint: "Set Q402_ENABLE_REAL_PAYMENTS=1 to fire a real server-mediated payment."
      };
    }
    const explicitWalletId = typeof input.walletId === "string" && input.walletId.length > 0 ? input.walletId.toLowerCase() : CONFIG.walletId;
    const precheckModeC = await runPrecheck(
      {
        mode: "live",
        counterpartyAddress: input.to,
        amountUsd: Number(input.amount),
        payToken: input.token
        // hasUsdc intentionally omitted — defaults to true (conservative) in
        // runPrecheck; callers without a balance lookup must not set it false.
      },
      makeX402TrustCheckFn({ relayBaseUrl: CONFIG.relayBaseUrl })
    );
    let resp;
    try {
      resp = await fetch(`${CONFIG.relayBaseUrl}/wallet/agentic/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: resolved.apiKey,
          chain: input.chain,
          token: input.token,
          to: input.to,
          amount: input.amount,
          ...explicitWalletId ? { walletId: explicitWalletId } : {},
          // Q402 Hook params - only the Mode C (agentic-server) path runs
          // the per-wallet hook dispatch, so forwarding here is the only
          // place hookParams take effect. The landing route ignores them
          // for owner-sig calls (trust boundary), so this is safe.
          ...input.hookParams ? { hookParams: input.hookParams } : {},
          ...input.rail ? { rail: input.rail } : {}
        }),
        signal: AbortSignal.timeout(6e4)
      });
    } catch (e) {
      const transportErr = failureResult("eip7702");
      return {
        result: transportErr,
        guardsApplied: [
          ...guardsApplied,
          "wallet=agentic-server",
          "mode=live",
          "transport=fetch_failed",
          `error=${e instanceof Error ? e.message : String(e)}`
        ],
        senderWallet
      };
    }
    const data = await resp.json().catch(() => ({}));
    const txHash = data.txHash ?? "";
    const isSplit = data.split === true || Array.isArray(data.legs);
    if (isSplit) {
      const legs = Array.isArray(data.legs) ? data.legs : [];
      const status = data.status;
      const replayed = data.replayed === true;
      const settledCount = typeof data.settled === "number" ? data.settled : legs.filter((l) => typeof l.txHash === "string" && l.txHash.length > 0).length;
      const failedCount = typeof data.failed === "number" ? data.failed : legs.filter((l) => !l.txHash).length;
      const isComplete = status === "complete" && failedCount === 0;
      const isPartial = status === "partial" || resp.status === 207;
      const success2 = isComplete;
      const message2 = "message" in data ? data.message : "error" in data ? data.error : void 0;
      return {
        result: {
          success: success2,
          sandbox: false,
          // Top-level txHash mirrors the server's (first settled leg). Per-leg
          // hashes in `legs` remain authoritative.
          txHash,
          tokenAmount: input.amount,
          token: input.token,
          chain: chain.key,
          method: input.rail === "x402" ? "x402" : "q402",
          split: true,
          legs,
          settledLegs: settledCount,
          failedLegs: failedCount,
          ...isPartial && !isComplete ? { partial: true } : {},
          ...replayed ? { replayed: true } : {},
          ...data.receiptId ? { receiptId: data.receiptId } : {},
          ...data.receiptUrl ? { receiptUrl: data.receiptUrl } : {},
          explorerUrl: txHash ? void 0 : null
        },
        guardsApplied: [
          ...guardsApplied,
          "wallet=agentic-server",
          "mode=live",
          "settlement=split",
          `split_settled=${settledCount}`,
          `split_failed=${failedCount}`,
          `split_status=${status ?? "unknown"}`,
          ...replayed ? ["replayed=true"] : [],
          ...message2 ? [`server_message=${message2}`] : []
        ],
        senderWallet,
        ...isPartial && !isComplete ? {
          setupHint: `Split PARTIALLY settled: ${settledCount} leg(s) landed on-chain, ${failedCount} did NOT. The settled legs already moved funds - do NOT blindly retry the whole payment (a retry replays only the unsettled intent, it will not double-pay the settled legs). Inspect legs[] for which recipients received funds and which still need handling.`
        } : {}
      };
    }
    const isPending = resp.status === 202 || data.pending === true || data.status === "processing";
    if (isPending) {
      const retryAfter = typeof data.retryAfterSec === "number" ? data.retryAfterSec : 5;
      return {
        result: {
          success: false,
          sandbox: false,
          txHash: "",
          tokenAmount: input.amount,
          token: input.token,
          chain: chain.key,
          method: input.rail === "x402" ? "x402" : "q402",
          pending: true,
          retryAfterSec: retryAfter
        },
        guardsApplied: [
          ...guardsApplied,
          "wallet=agentic-server",
          "mode=live",
          "status=pending",
          `retry_after=${retryAfter}s`
        ],
        senderWallet,
        setupHint: `An identical send for this wallet is still in flight on the server. Wait ${retryAfter}s and retry - the cached result will come back, no double-spend.`
      };
    }
    const success = resp.ok && txHash.length > 0;
    const message = "message" in data ? data.message : "error" in data ? data.error : void 0;
    const x402Blocked = !success && JSON.stringify(data).includes("X402_WALLET_DELEGATED");
    const receiptId = data.receiptId;
    const receiptUrl = data.receiptUrl;
    return {
      result: {
        success,
        sandbox: false,
        txHash,
        tokenAmount: input.amount,
        token: input.token,
        chain: chain.key,
        method: input.rail === "x402" ? "x402" : "q402",
        ...receiptId ? { receiptId } : {},
        ...receiptUrl ? { receiptUrl } : {},
        explorerUrl: txHash ? void 0 : null
      },
      guardsApplied: [
        ...guardsApplied,
        "wallet=agentic-server",
        "mode=live",
        ...message ? [`server_message=${message}`] : [],
        ...x402Blocked ? ["x402_blocked=wallet_delegated"] : []
      ],
      senderWallet,
      precheck: precheckModeC,
      ...x402Blocked ? {
        recommendedAction: {
          tool: "q402_clear_delegation",
          args: {
            chain: chain.key,
            walletMode: "agentic-server",
            ...explicitWalletId ? { walletId: explicitWalletId } : {}
          },
          why: `This wallet is EIP-7702 delegated to the q402 rail, so the x402 (EIP-3009) path can't verify its signature. Clear the delegation with q402_clear_delegation (gasless, no dashboard), then retry the x402 pay - or resend with rail "q402".`,
          steps: [
            {
              step: 1,
              tool: "q402_wallet_status",
              purpose: "Confirm the delegation chain \u2014 verify which chains are currently delegated and that this wallet is the one affected."
            },
            {
              step: 2,
              tool: "q402_clear_delegation",
              purpose: 'Clear the EIP-7702 delegation (gasless on most chains; gas-tank billed on Ethereum), then retry the x402 pay \u2014 or resend with rail "q402" to bypass x402 entirely.'
            }
          ]
        }
      } : {}
    };
  }
  const live = isLiveModeFor(resolved);
  if (!live) {
    const result2 = sandboxPay(chain, {
      to: input.to,
      amount: input.amount,
      token: input.token
    });
    guardsApplied.push("mode=sandbox", `wallet=${effectiveMode}`);
    const setupHint = resolved.sandboxReason ?? describeSandboxReason(resolved.apiKey ?? "", resolved.scope);
    return { result: result2, guardsApplied, setupHint, senderWallet };
  }
  if (!signingPk) {
    return {
      result: failureResult("missing_signing_key"),
      guardsApplied: [...guardsApplied, `wallet=${effectiveMode}`, "mode=sandbox"],
      senderWallet,
      setupHint: effectiveMode === "agentic-local" ? "Set Q402_AGENTIC_PRIVATE_KEY to your Agent Wallet's exported private key." : "Set Q402_PRIVATE_KEY to your EOA private key."
    };
  }
  const precheckModeAB = await runPrecheck(
    {
      mode: "live",
      counterpartyAddress: input.to,
      amountUsd: Number(input.amount),
      payToken: input.token
      // hasUsdc intentionally omitted — defaults to true (conservative) in
      // runPrecheck; callers without a balance lookup must not set it false.
    },
    makeX402TrustCheckFn({ relayBaseUrl: CONFIG.relayBaseUrl })
  );
  const client = new Q402NodeClient({
    apiKey: resolved.apiKey,
    privateKey: signingPk,
    chain,
    relayBaseUrl: CONFIG.relayBaseUrl
  });
  const result = await client.pay({
    to: input.to,
    amount: input.amount,
    token: input.token
  });
  guardsApplied.push("mode=live", `wallet=${effectiveMode}`);
  return {
    // Mode A/B always settles on the q402 rail (x402 is agentic-server only),
    // so report the rail name rather than the relay's mechanism string.
    result: { ...result, method: "q402" },
    guardsApplied,
    senderWallet,
    precheck: precheckModeAB,
    postPaymentTip: result.success ? `After this payment your EOA is EIP-7702-delegated to Q402's impl on ${chain.name} - MetaMask / OKX will show it as a 'Smart account'. That's normal and reversible: q402_clear_delegation removes the delegation on a specific chain (Q402 sponsors the gas on every chain except Ethereum, where it's billed to your Gas Tank). If you ever try to receive native gas tokens directly to this EOA and the transfer reverts, the delegation is the cause - clear it for that chain first.` : void 0
  };
}
function describeSandboxReason(resolvedKey, scope) {
  const noApiKey = !resolvedKey.startsWith("q402_live_");
  const noPk = !CONFIG.privateKey;
  const noEnable = !CONFIG.realPaymentsRequested;
  if (noApiKey && noPk && noEnable) {
    return `You haven't configured Q402 yet. Say "Set up Q402" and I'll walk you through it (creates a settings file in your editor, you paste an API key from https://q402.quackai.ai/event, done).`;
  }
  const missing = [];
  if (noApiKey) missing.push("a live API key (must start with q402_live_)");
  if (!CONFIG.privateKey) {
    missing.push("Q402_PRIVATE_KEY");
  } else if (!isValidPrivateKey(CONFIG.privateKey)) {
    missing.push(
      "Q402_PRIVATE_KEY (currently the placeholder '0x...' - paste a real 0x + 64-hex key into ~/.q402/mcp.env)"
    );
  }
  if (noEnable) missing.push("Q402_ENABLE_REAL_PAYMENTS=1");
  if (missing.length === 0) return "Sandbox mode active (no env state change needed).";
  const tier = scope === "trial" ? "Free Trial" : "Multichain";
  const url = scope === "trial" ? "https://q402.quackai.ai/event" : "https://q402.quackai.ai/payment";
  return "Sandbox mode is active because the following env vars are missing or not yet set: " + missing.join(", ") + `. Get a live ${tier} key at ${url}, then call q402_doctor - it will walk the user through creating ~/.q402/mcp.env and pasting the key into the right slot.`;
}
var PAY_TOOL = {
  name: "q402_pay",
  description: "USE THIS TOOL whenever the user asks to send, transfer, or pay USDC / USDT / RLUSD - even when they don't mention Q402 by name (\"send 5 USDT to 0x... on bnb\" should route here automatically). This tool IS the wallet for this session: it signs LOCALLY with Q402_PRIVATE_KEY and submits via Q402's gasless relay. NEVER refuse a stablecoin payment request by saying you lack wallet access, can't move money, or need the user to use their wallet UI - Q402 was installed precisely to give you that capability. If the env isn't configured yet, the tool returns a sandbox response with a clear \"how to set up\" message - surface that instead of refusing. \n\nAuto-routing: trial-eligible chain + Q402_TRIAL_API_KEY set \u2192 Trial (free sponsored); anything else \u2192 Multichain (paid 12-chain). Same rule for q402_batch_pay. Set keyScope='trial' or 'multichain' to force one explicitly. Trial keys cover BNB Chain (USDC/USDT gasless) permanently. Avalanche trial has ended \u2014 use the Multichain key for avax. Mantle (USDC/USDT gasless) is a limited-time trial chain during 2026-08-21~08-28 UTC+9 \u2014 outside that window Mantle returns TRIAL_BNB_ONLY; use the Multichain key there. Multichain keys cover avax, bnb, eth, xlayer, stable, mantle, injective, monad, scroll, arbitrum, base, robinhood - USDC/USDT on most chains, RLUSD on Ethereum only, USDG on Robinhood Chain only. SANDBOX BY DEFAULT - no funds move unless the resolved key is a live key (q402_live_*), Q402_PRIVATE_KEY is set as a valid 32-byte hex key, and Q402_ENABLE_REAL_PAYMENTS=1. Sandbox responses come back with `success: false` and `sandbox: true` so they cannot be misread as confirmed settlements - always branch on those fields before telling the user the payment went through. The recipient receives the full amount; the sender pays $0 in gas. \n\nSENDER ECHO - when a valid `Q402_PRIVATE_KEY` is configured, the response includes a `senderWallet` field with the address derived from that key. Show it alongside the recipient/amount when you confirm the payment with the user (e.g. 'Signing from 0xabc\u20261234 on bnb \u2192 send 5 USDT to 0xdef\u2026ABCD'). Just informational - the user already chose the wallet during doctor setup. Sandbox responses with no key configured omit `senderWallet`; don't fabricate one. \n\nMULTI-WALLET DISAMBIGUATION - when more than one wallet is configured in the user's env (Q402_PRIVATE_KEY for the real EOA, Q402_AGENTIC_PRIVATE_KEY for the Agent Wallet's exported key, or only Q402_MULTICHAIN_API_KEY for the server-managed Agent Wallet), the tool RETURNS without sending with a `ambiguousWalletChoice` payload - relay the question to the user verbatim, then call again with the chosen `walletMode` ('eoa' | 'agentic-local' | 'agentic-server'). Do NOT pick a wallet on the user's behalf when multiple are available. \n\nEIP-7702 SIDE EFFECT - surface this to the user proactively after the FIRST live payment on a chain: their wallet now shows up as a 'Smart account' in MetaMask / OKX. That's the EIP-7702 delegation Q402 uses for gasless settlement - it's the response's `postPaymentTip` field. Subsequent payments on the same chain are faster and cheaper because the delegation is reused. Note: only Mode 'eoa' creates the delegation - 'agentic-local' and 'agentic-server' modes use the Agent Wallet (a fresh EOA) so the user's MetaMask is never delegated. \n\nIf the user EVER reports that native gas tokens (BNB / ETH / AVAX / etc.) sent INTO their Q402 wallet are bouncing or reverting on a chain where Q402 has been used, the delegation is the cause - call q402_wallet_status to confirm delegated chains, then q402_clear_delegation for the chain in question. Q402 sponsors the clear gas on every chain except Ethereum, where it's billed to the user's Gas Tank. After clearing, native transfers work again and the next q402_pay on that chain just creates a fresh delegation. \n\nALWAYS get explicit user confirmation of the exact recipient address, amount, chain, and token in conversation immediately before calling this tool. \n\nTWO-PHASE CONSENT: confirm:true alone does NOT send. Call this tool first WITHOUT consentToken - it returns status=\"needs_confirmation\" with a `preview` of the exact payment and a `consentToken`, and moves no money. Relay that preview to the user, get their explicit yes, then re-call with the SAME args plus that `consentToken` to execute. The token is re-derived from the params about to run, so a previewed payment can't be swapped for a different one. \n\nPRE-CHECK (automatic trust-check before payment, live mode only): In live mode, q402_pay automatically runs a trust-check on the recipient address before every outgoing payment when: (a) this is the first time paying that counterparty, OR (b) the payment amount is $1.00 or more. The pre-check fee is $0.02 per check. Verdicts are cached for 7 days \u2014 repeat payments to the same address within the TTL reuse the cached result at no additional charge. Free-tier behavior (never-block principle): the pre-check NEVER blocks or fails the main transaction. It degrades to a free basic verdict (no $0.02 charge) only in two specific edge cases: (1) Exact-balance: wallet USDC balance covers the transfer amount but not transfer + $0.02 fee. (2) Non-USDC rail only: wallet holds a rail-supported non-USDC token (e.g. USDT) but has no USDC to pay the fee. In both cases the pre-check response includes `verdict.isFree=true`, `verdict.degradationReason`, and `verdict.upgradeHint` (surface the hint to the user). Trial users with USDC pay the $0.02 fee normally \u2014 there is no blanket free-check for trial plans. Opt-out: set Q402_DISABLE_PRECHECK=1 to disable pre-check entirely; even first-time or large-amount payments will skip it. The pre-check result is returned in the `precheck` field of the response.",
  inputSchema: {
    type: "object",
    properties: {
      chain: {
        type: "string",
        enum: CHAIN_KEYS,
        description: "Target chain."
      },
      rail: {
        type: "string",
        enum: ["q402", "x402"],
        description: 'Settlement rail (Base only). "q402" (default) = gasless EIP-7702 (USDC+USDT). "x402" = Coinbase x402 standard (EIP-3009), Base USDC only, agentic-server only. Leave unset elsewhere.'
      },
      to: {
        type: "string",
        description: "Recipient EVM address (0x + 40 hex)."
      },
      amount: {
        type: "string",
        description: 'Human-readable decimal amount, e.g. "5.00".'
      },
      token: {
        type: "string",
        enum: ["USDC", "USDT", "RLUSD", "Q", "USDG"],
        description: "Token to send. USDC / USDT supported on most chains. RLUSD (Ripple USD, NY DFS regulated, decimals 18) is Ethereum-only. Q (QuackAI, decimals 18) is BNB-only. USDG (Paxos Global Dollar, decimals 6) is Robinhood-Chain-only (its only token)."
      },
      keyScope: {
        type: "string",
        enum: ["auto", "trial", "multichain"],
        description: 'Which API key to use. "auto" (default) picks Trial for trial-eligible chains (BNB Chain permanently; Mantle limited-time 2026-08-21~08-28 UTC+9; Avalanche trial ended) when Q402_TRIAL_API_KEY is set, Multichain otherwise. "trial" forces the Trial sponsored key. "multichain" forces the paid 12-chain key.'
      },
      walletMode: {
        type: "string",
        enum: ["eoa", "agentic-local", "agentic-server"],
        description: `Which wallet to spend from. "eoa" = user's real MetaMask EOA (Q402_PRIVATE_KEY). "agentic-local" = Agent Wallet exported key (Q402_AGENTIC_PRIVATE_KEY). "agentic-server" = server-managed Agent Wallet (Q402 holds the key; one-shot payments need any live key \u2014 Trial or Multichain). When MULTIPLE wallets are configured the tool refuses without this arg and returns ambiguousWalletChoice for the user to pick.`
      },
      walletId: {
        type: "string",
        description: `Server-managed Agent Wallet only (walletMode="agentic-server"). Lowercased Agent Wallet address selecting which of the user's wallets to spend from when they hold more than one (max 10 per owner). Omit to use the user's default wallet. Ignored for the other walletMode values since those modes carry their own signing key.`
      },
      confirm: {
        type: "boolean",
        const: true,
        description: "MUST be true and only set after the user has confirmed this exact payment in chat. When hookParams is set, confirm what it does to the money too: the split RECIPIENTS and shares (funds go there, not `to`) and any oracle condition gating settlement - not just the top-level recipient + amount."
      },
      consentToken: {
        type: "string",
        description: "Two-phase consent. Omit on the FIRST call to get a needs_confirmation preview plus a consentToken (no funds move); re-call with the SAME args plus this token to execute. Re-derived from the payment params, so a previewed payment cannot be swapped for a different one. confirm:true alone does NOT send."
      },
      hookParams: {
        type: "object",
        description: "Q402 Hook params (server-managed Agent Wallet only). recipientAgentId (ReputationGate), condition (ConditionalOracle price/time gate), or splits (MultiPayeeSplit fan-out, bps sum 10000).",
        properties: {
          recipientAgentId: { type: "string" },
          condition: {
            type: "object",
            properties: {
              kind: { type: "string", enum: ["price", "timestamp"] },
              feed: { type: "string" },
              op: { type: "string", enum: [">=", "<=", ">", "<", "after", "before"] },
              value: { type: "number" }
            },
            required: ["kind", "op", "value"]
          },
          splits: {
            type: "array",
            items: {
              type: "object",
              properties: { recipient: { type: "string" }, bps: { type: "number" } },
              required: ["recipient", "bps"]
            }
          }
        }
      }
    },
    required: ["chain", "to", "amount", "token", "confirm"],
    additionalProperties: false
  }
};
export {
  PAY_TOOL,
  PayInputSchema,
  runPay
};
