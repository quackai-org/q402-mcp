/**
 * q402_yield_cancel - WRITE. Cancels a PENDING Zircuit Finance withdraw request
 * for the Agent Wallet. Zircuit (Q402 Yield on base, USDC) pays withdrawals out
 * through a queue: q402_yield_withdraw files a request, and until Zircuit
 * processes it the request can be canceled, which returns the queued vault shares
 * to the wallet's Zircuit position (nothing is paid out).
 *
 * Server-mediated (Mode C): the live Multichain API key travels in the JSON body;
 * the server holds the Agent Wallet's encrypted key, signs the cancel and sponsors
 * gas. Same two-phase consent + sandbox gates as q402_yield_withdraw, since it
 * changes the wallet's on-chain position.
 */

import { z } from "zod";
import { CONFIG, resolveApiKey } from "../config.js";
import { consentGate } from "../consent.js";

export const YieldCancelInputSchema = z.object({
  requestId: z
    .string()
    .regex(/^\d{1,30}$/, "requestId must be the numeric id of the withdraw request")
    .describe("The pending withdraw request to cancel, from q402_yield_withdraw's result or q402_yield_positions' pendingWithdrawals."),
  chain: z
    .enum(["base"])
    .default("base")
    .describe("Chain of the request. Zircuit withdraw requests live on 'base'."),
  walletId: z
    .string()
    .optional()
    .describe(
      "Optional Agent Wallet address that filed the request. Omit to use Q402_AGENT_WALLET_ADDRESS " +
        "env, then the owner's default wallet (resolved server-side from the API key).",
    ),
  confirm: z
    .boolean()
    .optional()
    .describe("MUST be true to actually cancel. Set only after the user approved canceling this exact request."),
  consentToken: z
    .string()
    .optional()
    .describe("Two-phase consent. Leave unset on the first call to get a preview + token; re-call with confirm:true AND this token."),
});

export const YIELD_CANCEL_TOOL = {
  name: "q402_yield_cancel",
  description:
    "WRITE - cancels a PENDING Zircuit Finance withdraw request (Q402 Yield on base, USDC). " +
    "Zircuit withdrawals are queued: q402_yield_withdraw files a request that pays out later " +
    "(usually within 24 hours, up to 14 days). While it is still pending, this cancels it and the " +
    "queued shares go back into the wallet's Zircuit position; no USDC is paid out. A request that " +
    "was already processed or canceled can't be canceled (the server says which). " +
    "Find request ids in q402_yield_positions (pendingWithdrawals) or in q402_yield_withdraw's result. " +
    "Server-managed Agent Wallet path (Mode C): authenticated by the configured live Multichain API key. " +
    "\n\n" +
    "REQUIRES CONFIRMATION - call FIRST without confirm to get a preview and a consentToken, show it to " +
    "the user, get explicit approval, THEN re-call with confirm:true AND the consentToken. " +
    "\n\n" +
    "SANDBOX BY DEFAULT - nothing happens on-chain unless a live Multichain key (q402_live_*) is " +
    "configured AND Q402_ENABLE_REAL_PAYMENTS=1.",
  inputSchema: {
    type: "object" as const,
    properties: {
      requestId: {
        type: "string" as const,
        description: "The pending withdraw request id (digits), from q402_yield_positions pendingWithdrawals or the withdraw result.",
      },
      chain: {
        type: "string" as const,
        enum: ["base"],
        description: "Chain of the request. Zircuit withdraw requests live on 'base'.",
      },
      walletId: {
        type: "string" as const,
        description: "Optional Agent Wallet address that filed the request. Defaults to Q402_AGENT_WALLET_ADDRESS, then the owner's default wallet.",
      },
      confirm: {
        type: "boolean" as const,
        description: "MUST be true to actually cancel - only after the user approved canceling this exact request.",
      },
      consentToken: {
        type: "string" as const,
        description: "Two-phase consent token from the preview call. Bound to (chain, requestId, wallet).",
      },
    },
    required: ["requestId"],
    additionalProperties: false,
  },
};

interface CancelData {
  status?: string;
  action?: string;
  protocol?: string;
  chain?: string;
  requestId?: string;
  restoredAmount?: string | null;
  txHash?: string;
  error?: string;
  message?: string;
}

export async function runYieldCancel(input: z.infer<typeof YieldCancelInputSchema>) {
  const walletId =
    typeof input.walletId === "string" && input.walletId.length > 0
      ? input.walletId.toLowerCase()
      : CONFIG.walletId ?? undefined;

  const consent = consentGate(
    { t: "yield-cancel", chain: input.chain, protocol: "zircuit", requestId: input.requestId, walletId: walletId ?? null },
    input.consentToken,
  );
  const previewToken = consent.ok ? "" : consent.newToken;
  if (input.confirm !== true || !consent.ok) {
    const walletDesc = walletId ? `wallet ${walletId}` : "your default Agent Wallet";
    return {
      content: [{
        type: "text" as const,
        text:
          `Will cancel pending Zircuit withdraw request #${input.requestId} on ${input.chain} for ${walletDesc}. ` +
          "The queued shares go back into the Zircuit position and nothing is paid out. Confirm with the " +
          `user, then re-call with confirm:true AND consentToken="${previewToken}".`,
      }],
    };
  }

  const resolved = resolveApiKey(input.chain, "multichain");
  if (!resolved.apiKey || !resolved.apiKey.startsWith("q402_live_")) {
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          configured: false,
          status: "error",
          setupHint:
            resolved.sandboxReason ??
            "No live Q402 Multichain API key configured. Set Q402_MULTICHAIN_API_KEY to a " +
              "q402_live_… key from https://q402.quackai.ai/payment, or run q402_doctor.",
        }, null, 2),
      }],
      isError: true,
    };
  }

  if (!CONFIG.realPaymentsRequested) {
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          sandbox: true,
          success: false,
          status: "sandbox",
          action: "yield_withdraw_cancel",
          chain: input.chain,
          requestId: input.requestId,
          walletId: walletId ?? null,
          setupHint: "Sandbox mode - set Q402_ENABLE_REAL_PAYMENTS=1 to cancel for real. Nothing changed on-chain.",
        }, null, 2),
      }],
    };
  }

  let res: Response;
  try {
    res = await fetch(`${CONFIG.relayBaseUrl}/wallet/agentic/yield/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKey: resolved.apiKey,
        chain: input.chain,
        protocol: "zircuit",
        requestId: input.requestId,
        ...(walletId ? { walletId } : {}),
      }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (e) {
    // The cancel may or may not have reached the server. A repeat is safe to try:
    // an already-canceled request is refused (REQUEST_CANCELED), never double-applied.
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          status: "uncertain",
          success: false,
          action: "yield_withdraw_cancel",
          requestId: input.requestId,
          error: e instanceof Error ? e.message : String(e),
          message:
            "Network error before a confirmed response. Check q402_yield_positions: if the request is no " +
            "longer pending, the cancel landed (or it was processed). Retrying is safe; a canceled request is refused.",
        }, null, 2),
      }],
      isError: true,
    };
  }

  const data = (await res.json().catch(() => ({}))) as CancelData;
  if (!res.ok) {
    return {
      content: [{
        type: "text" as const,
        text: `Yield cancel failed (HTTP ${res.status}): ${JSON.stringify(data)}`,
      }],
      isError: true,
    };
  }

  const summary =
    `Canceled Zircuit withdraw request #${data.requestId ?? input.requestId} on ${data.chain ?? input.chain}. ` +
    "The shares are back in the Zircuit position" +
    (data.restoredAmount ? ` (about ${data.restoredAmount} USDC)` : "") +
    (data.txHash ? `. txHash ${data.txHash}.` : ".");

  return {
    content: [
      { type: "text" as const, text: summary },
      { type: "text" as const, text: JSON.stringify(data, null, 2) },
    ],
  };
}
