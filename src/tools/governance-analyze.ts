import { z } from "zod";
import { CONFIG } from "../config.js";
import { runX402Fetch } from "./x402-fetch.js";
import type { X402FetchResult } from "./x402-fetch.js";

// ── Input schema ───────────────────────────────────────────────────────────────

const WeightsSchema = z.object({
  riskControl:       z.number().int().min(0).max(100),
  decentralization:  z.number().int().min(0).max(100),
  sustainability:    z.number().int().min(0).max(100),
  communityImpact:   z.number().int().min(0).max(100),
}).strict();

export const GovernanceAnalyzeInputSchema = z.object({
  dao:          z.string().optional().describe("DAO identifier (e.g. \"moonwell\", \"aave\")."),
  proposalId:   z.string().optional().describe("On-chain proposal ID or Snapshot ID."),
  proposalText: z.string().optional().describe("Raw proposal text or description."),
  weights:      WeightsSchema.optional().describe(
    "Custom priority weights (0-100 integer each): riskControl, decentralization, sustainability, communityImpact. Mutually exclusive with persona.",
  ),
  persona:      z.string().optional().describe(
    "Named analysis persona. Mutually exclusive with weights.",
  ),
  confirm:      z.literal(true).describe(
    "MUST be true. This tool triggers a paid x402 request; caller attests the user approved.",
  ),
  consentToken: z.string().optional().describe(
    "Two-phase consent token from a prior needs_confirmation response. Omit on first call.",
  ),
});
export type GovernanceAnalyzeInput = z.infer<typeof GovernanceAnalyzeInputSchema>;

// ── Result shape ───────────────────────────────────────────────────────────────

export interface GovernanceAnalyzeResult {
  success: boolean;
  voteChoice?:  string;
  reasoning?:   string;
  dimensions?:  unknown[];
  cached?:      boolean;
  receipt?:     unknown;
  priceUsdc?:   unknown;
  needsConsent?: X402FetchResult["needsConsent"];
  error?:       string;
  // Pass-through fields from runX402Fetch for settlement outcomes
  status?:      X402FetchResult["status"];
  fundsMoved?:  boolean;
  fundsMovedUnknown?: boolean;
  retrySafe?:   boolean;
  txHash?:      string | null;
  recipient?:   string;
  amount?:      string;
  guidance?:    string;
  auditId?:     string;
}

// ── Validation ─────────────────────────────────────────────────────────────────

function validateInput(input: GovernanceAnalyzeInput): string | null {
  const hasProposalText = typeof input.proposalText === "string" && input.proposalText.length > 0;
  const hasDaoAndId = typeof input.dao === "string" && input.dao.length > 0 &&
                      typeof input.proposalId === "string" && input.proposalId.length > 0;

  if (!hasProposalText && !hasDaoAndId) {
    return "Must provide proposalText, or both dao and proposalId.";
  }
  if (input.weights !== undefined && input.persona !== undefined) {
    return "weights and persona are mutually exclusive — provide one or neither, not both.";
  }
  return null;
}

// ── Body builder ───────────────────────────────────────────────────────────────

function buildBody(input: GovernanceAnalyzeInput): string {
  const body: Record<string, unknown> = {};

  if (typeof input.proposalText === "string" && input.proposalText.length > 0) {
    body["Proposal_Content"] = input.proposalText;
  } else {
    body["dao"]        = input.dao;
    body["proposalId"] = input.proposalId;
  }

  if (input.weights !== undefined) {
    body["Risk_Control"]     = input.weights.riskControl;
    body["Decentralization"] = input.weights.decentralization;
    body["Sustainability"]   = input.weights.sustainability;
    body["Community_Impact"] = input.weights.communityImpact;
  }

  if (input.persona !== undefined) {
    body["customPrompt"] = input.persona;
  }

  return JSON.stringify(body);
}

// ── Main runner ────────────────────────────────────────────────────────────────

export async function runGovernanceAnalyze(
  input: GovernanceAnalyzeInput,
): Promise<GovernanceAnalyzeResult> {
  const validationError = validateInput(input);
  if (validationError) {
    return { success: false, error: validationError };
  }

  const url = `${CONFIG.relayBaseUrl}/x402/governance/analyze`;

  const fetchResult = await runX402Fetch({
    url,
    method: "POST",
    body:   buildBody(input),
    confirm: true,
    ...(input.consentToken !== undefined ? { consentToken: input.consentToken } : {}),
  });

  if (!fetchResult.success) {
    return {
      success:      false,
      needsConsent: fetchResult.needsConsent,
      error:        fetchResult.error,
      status:       fetchResult.status,
      fundsMoved:   fetchResult.fundsMoved,
      fundsMovedUnknown: fetchResult.fundsMovedUnknown,
      retrySafe:    fetchResult.retrySafe,
      txHash:       fetchResult.txHash,
      recipient:    fetchResult.recipient,
      amount:       fetchResult.amount,
      guidance:     fetchResult.guidance,
      auditId:      fetchResult.auditId,
    };
  }

  // Parse the response body
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(fetchResult.body ?? "{}") as Record<string, unknown>;
  } catch {
    return {
      success: false,
      error: "governance analyze: response body is not valid JSON",
      auditId: fetchResult.auditId,
    };
  }

  return {
    success:    true,
    voteChoice: parsed["vote_choice"] as string | undefined,
    reasoning:  parsed["final_reasoning"] as string | undefined,
    dimensions: parsed["dimensions"] as unknown[] | undefined,
    cached:     parsed["cached"] as boolean | undefined,
    receipt:    parsed["receipt"],
    priceUsdc:  parsed["priceUsdc"],
    auditId:    fetchResult.auditId,
  };
}

// ── Tool descriptor ────────────────────────────────────────────────────────────

const TOOL_DESCRIPTION =
  "Paid governance proposal analysis. Send a Snapshot proposal (or raw text) and priority " +
  "weights; get a vote recommendation (For / Against / Abstain), five dimension ratings, " +
  "and the reasoning. $0.05 USDC per call on Base via x402.";

export const GOVERNANCE_ANALYZE_TOOL = {
  name: "q402_governance_analyze",
  description: TOOL_DESCRIPTION,
  inputSchema: {
    type: "object" as const,
    properties: {
      dao: {
        type: "string",
        description: "DAO identifier (e.g. \"moonwell\", \"aave\").",
      },
      proposalId: {
        type: "string",
        description: "On-chain proposal ID or Snapshot ID.",
      },
      proposalText: {
        type: "string",
        description: "Raw proposal text or description.",
      },
      weights: {
        type: "object",
        description: "Custom priority weights (0-100 integer each). Mutually exclusive with persona.",
        properties: {
          riskControl:      { type: "number", description: "Risk control priority (0-100)." },
          decentralization: { type: "number", description: "Decentralization priority (0-100)." },
          sustainability:   { type: "number", description: "Sustainability priority (0-100)." },
          communityImpact:  { type: "number", description: "Community impact priority (0-100)." },
        },
        required: ["riskControl", "decentralization", "sustainability", "communityImpact"],
        additionalProperties: false,
      },
      persona: {
        type: "string",
        description: "Named analysis persona. Mutually exclusive with weights.",
      },
      confirm: {
        type: "boolean",
        const: true,
        description:
          "MUST be true. This tool triggers a paid x402 request; caller attests the user approved.",
      },
      consentToken: {
        type: "string",
        description:
          "Two-phase consent token. Omit on first call; re-call with the token if needs_confirmation is returned.",
      },
    },
    required: ["confirm"],
    additionalProperties: false,
  },
} as const;
