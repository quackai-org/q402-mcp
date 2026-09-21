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
  url:          z.string().optional().describe(
    "Snapshot proposal URL (snapshot.org or snapshot.box) or bare 0x proposal ID (64 hex chars). " +
    "Mutually exclusive with proposalId and proposalText.",
  ),
  dao:          z.string().optional().describe(
    "DAO identifier (e.g. \"moonwell\", \"aave\"). Optional, inferred from url when provided; " +
    "defaults to \"snapshot\" when only proposalId is given.",
  ),
  proposalId:   z.string().optional().describe("On-chain proposal ID or Snapshot ID."),
  proposalText: z.string().optional().describe("Raw proposal text or description."),
  weights:      WeightsSchema.optional().describe(
    "Custom priority weights (0-100 integer each): riskControl, decentralization, sustainability, communityImpact. Mutually exclusive with persona.",
  ),
  persona:      z.string().optional().describe(
    "Named analysis persona. Mutually exclusive with weights.",
  ),
  language:     z.string().optional().describe(
    "BCP-47 language code for result display. Set to the user's conversation language: " +
    "\"zh\" for Chinese, \"en\" for English (or omit; server default). " +
    "Passed to the server and used to localize returned fields.",
  ),
  confirm:      z.literal(true).describe(
    "MUST be true. This tool triggers a paid x402 request; caller attests the user approved.",
  ),
  consentToken: z.string().optional().describe(
    "Two-phase consent. Omit on first call — the tool returns needs_confirmation with a quote of " +
    "the $0.05 USDC charge and a consentToken. Present the quote to the user and wait for their " +
    "NEXT INDEPENDENT message. Then re-call with the SAME args plus this token. Single-use, " +
    "expires in ~120s, rejected if consumed within 2s of issuance.",
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

// ── URL parsing ────────────────────────────────────────────────────────────────

export function parseSnapshotUrl(
  rawUrl: string,
): { proposalId: string; space?: string } | { error: string } {
  const trimmed = rawUrl.trim();

  // Bare 0x 64-char hex proposal ID
  if (/^0x[0-9a-fA-F]{64}$/.test(trimmed)) {
    return { proposalId: trimmed };
  }

  // snapshot.org/#/<space>/proposal/<id>
  const orgMatch = trimmed.match(
    /snapshot\.org\/#\/([^/?#]+)\/proposal\/(0x[0-9a-fA-F]+)/i,
  );
  if (orgMatch) {
    return { proposalId: orgMatch[2]!, space: orgMatch[1]! };
  }

  // snapshot.box/#/<prefix:>?<space>/proposal/<id>
  // Any colon-separated prefix (s:, sn:, etc.) is stripped; take the part after the colon.
  const boxMatch = trimmed.match(
    /snapshot\.box\/#\/(?:[^:/?#]+:)?([^/?#]+)\/proposal\/(0x[0-9a-fA-F]+)/i,
  );
  if (boxMatch) {
    return { proposalId: boxMatch[2]!, space: boxMatch[1]! };
  }

  return {
    error:
      "Invalid Snapshot link. Please paste a URL from snapshot.org or snapshot.box, or a bare 0x proposal ID.",
  };
}

export function spaceToDaoName(space: string): string {
  return space.endsWith(".eth") ? space.slice(0, -4) : space;
}

// ── Title fetch (optional, fail-silent) ───────────────────────────────────────

async function fetchProposalTitle(proposalId: string): Promise<string | null> {
  try {
    const resp = await fetch("https://hub.snapshot.org/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: "query ($id: String!) { proposal(id: $id) { title } }",
        variables: { id: proposalId },
      }),
      signal: AbortSignal.timeout(3_000),
    });
    if (!resp.ok) return null;
    const data = await resp.json() as { data?: { proposal?: { title?: string } | null } };
    return data?.data?.proposal?.title ?? null;
  } catch {
    return null;
  }
}

// ── Validation ─────────────────────────────────────────────────────────────────

function validateInput(input: GovernanceAnalyzeInput): string | null {
  const hasUrl          = typeof input.url === "string"          && input.url.length > 0;
  const hasProposalText = typeof input.proposalText === "string" && input.proposalText.length > 0;
  const hasProposalId   = typeof input.proposalId === "string"   && input.proposalId.length > 0;

  if (!hasUrl && !hasProposalText && !hasProposalId) {
    return "Must provide one of: url (Snapshot proposal link or 0x ID), proposalText, or proposalId.";
  }
  if ([hasUrl, hasProposalText, hasProposalId].filter(Boolean).length > 1) {
    return "url, proposalText, and proposalId are mutually exclusive: provide exactly one.";
  }
  if (input.weights !== undefined && input.persona !== undefined) {
    return "weights and persona are mutually exclusive: provide one or neither, not both.";
  }
  return null;
}

// ── Body builder ───────────────────────────────────────────────────────────────

interface ResolvedParams {
  dao?:          string;
  proposalId?:   string;
  proposalText?: string;
  weights?:      GovernanceAnalyzeInput["weights"];
  persona?:      string;
  language?:     string;
}

function buildBody(params: ResolvedParams): string {
  const body: Record<string, unknown> = {};

  if (typeof params.proposalText === "string" && params.proposalText.length > 0) {
    body["Proposal_Content"] = params.proposalText;
  } else {
    body["dao"]        = params.dao;
    body["proposalId"] = params.proposalId;
  }

  if (params.weights !== undefined) {
    body["Risk_Control"]     = params.weights.riskControl;
    body["Decentralization"] = params.weights.decentralization;
    body["Sustainability"]   = params.weights.sustainability;
    body["Community_Impact"] = params.weights.communityImpact;
  }

  if (params.persona !== undefined) {
    body["customPrompt"] = params.persona;
  }

  if (params.language !== undefined) {
    body["language"] = params.language;
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

  // Resolve proposal identifier → dao + proposalId (or proposalText pass-through)
  let resolvedProposalId:   string | undefined;
  let resolvedDao:          string | undefined;
  let resolvedProposalText: string | undefined;

  if (input.url) {
    const parsed = parseSnapshotUrl(input.url);
    if ("error" in parsed) {
      return { success: false, error: parsed.error };
    }
    resolvedProposalId = parsed.proposalId;
    resolvedDao        = parsed.space ? spaceToDaoName(parsed.space) : "snapshot";
  } else if (input.proposalId) {
    resolvedProposalId = input.proposalId;
    resolvedDao        = input.dao ?? "snapshot";
  } else {
    resolvedProposalText = input.proposalText;
  }

  const url = `${CONFIG.relayBaseUrl}/x402/governance/analyze`;

  const fetchResult = await runX402Fetch({
    url,
    method: "POST",
    body: buildBody({
      dao:          resolvedDao,
      proposalId:   resolvedProposalId,
      proposalText: resolvedProposalText,
      weights:      input.weights,
      persona:      input.persona,
      language:     input.language,
    }),
    confirm: true,
    ...(input.consentToken !== undefined ? { consentToken: input.consentToken } : {}),
  });

  if (!fetchResult.success) {
    // Replace the generic x402 preview with a user-friendly confirmation message.
    if (fetchResult.needsConsent) {
      const title   = resolvedProposalId ? await fetchProposalTitle(resolvedProposalId) : null;
      const subject = title ? `"${title}"` : "this governance proposal";
      const preview = `Analyze ${subject}: $0.05 USDC. Confirm to start the analysis.`;
      return {
        success: false,
        needsConsent: {
          status:       "needs_confirmation",
          preview,
          consentToken: fetchResult.needsConsent.consentToken,
        },
        status:            fetchResult.status,
        fundsMoved:        fetchResult.fundsMoved,
        fundsMovedUnknown: fetchResult.fundsMovedUnknown,
        retrySafe:         fetchResult.retrySafe,
        txHash:            fetchResult.txHash,
        recipient:         fetchResult.recipient,
        amount:            fetchResult.amount,
        guidance:          fetchResult.guidance,
        auditId:           fetchResult.auditId,
      };
    }
    return {
      success:           false,
      needsConsent:      fetchResult.needsConsent,
      error:             fetchResult.error,
      status:            fetchResult.status,
      fundsMoved:        fetchResult.fundsMoved,
      fundsMovedUnknown: fetchResult.fundsMovedUnknown,
      retrySafe:         fetchResult.retrySafe,
      txHash:            fetchResult.txHash,
      recipient:         fetchResult.recipient,
      amount:            fetchResult.amount,
      guidance:          fetchResult.guidance,
      auditId:           fetchResult.auditId,
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
  "Paid governance proposal analysis. Paste a Snapshot link (or raw text) and optionally describe " +
  "your priority in plain language; get a vote recommendation (For / Against / Abstain), five " +
  "dimension ratings, and the reasoning. $0.05 USDC per call on Base via x402.\n\n" +
  "INPUT: provide exactly one of:\n" +
  "  • url: a snapshot.org or snapshot.box proposal link, or a bare 0x proposal ID (64 hex chars).\n" +
  "  • proposalText: raw proposal body text.\n" +
  "  • proposalId: a Snapshot proposal ID you already have (dao defaults to \"snapshot\" when omitted).\n" +
  "When the user pastes a link, use the url field. Do NOT ask the user for a proposal ID or dao name.\n\n" +
  "LANGUAGE: set `language` to the user's conversation language code.\n" +
  "  • User writes in Chinese (Simplified or Traditional) → language: \"zh\"\n" +
  "  • User writes in English → language: \"en\" (or omit; server default)\n" +
  "  • Other languages → use the BCP-47 code (e.g. \"ja\", \"ko\", \"fr\")\n" +
  "The server uses this field to localize certain response fields.\n\n" +
  "DISPLAY: when presenting results to the user, apply the mapping table below; do NOT expose raw English enum values:\n" +
  "  vote_choice:  For → 赞成  |  Against → 反对  |  Abstain → 弃权\n" +
  "  rating:       Poor → 差  |  Adequate → 及格  |  Good → 良好  |  Excellent → 优秀\n" +
  "  dimensions:   Impact → 影响力  |  Feasibility & Alignment → 可行性与战略契合\n" +
  "                Value & Sustainability → 价值与可持续性  |  Innovation & Differentiation → 创新与差异化\n" +
  "                Risk & Mitigation → 风险与缓解\n" +
  "  weight names: Risk Control → 风险管控  |  Decentralization → 去中心化  |  Sustainability → 可持续性\n" +
  "                Community Impact → 社区影响力\n\n" +
  "FREE-TEXT LOCALIZATION: when presenting final_reasoning or any dimension justification text, " +
  "scan for the English dimension names above (the five returned by the API plus the four weight names) " +
  "and English rating words (Poor, Adequate, Good, Excellent) and replace each with the mapped equivalent above. " +
  "Example: 'Feasibility & Alignment rated Excellent' must become '可行性与战略契合评为优秀'; " +
  "'Risk Control(80) rated Good' must become '风险管控(80)评为良好'. " +
  "No English dimension name or rating word may appear in any user-facing output.\n\n" +
  "TENDENCY → WEIGHTS (interpret the user's stated priority; omit weights entirely if neutral/unstated):\n" +
  "  • Risk-focused / conservative / \"from a risk angle\" → riskControl: 80, others: 50\n" +
  "  • Growth / aggressive / bullish on innovation → sustainability: 80, communityImpact: 70, riskControl: 40, decentralization: 50\n" +
  "  • Decentralization-first / governance principles → decentralization: 80, others: 50\n" +
  "  • Neutral / not stated → omit weights (server defaults all to 50)\n" +
  "weights and persona are mutually exclusive.";

export const GOVERNANCE_ANALYZE_TOOL = {
  name: "q402_governance_analyze",
  description: TOOL_DESCRIPTION,
  inputSchema: {
    type: "object" as const,
    properties: {
      url: {
        type: "string",
        description:
          "Snapshot proposal URL (snapshot.org or snapshot.box) or bare 0x proposal ID. " +
          "Use this when the user pastes a link; do not ask for proposal ID or dao.",
      },
      dao: {
        type: "string",
        description:
          "DAO identifier (e.g. \"moonwell\", \"aave\"). Optional, inferred from url when provided; " +
          "defaults to \"snapshot\" when only proposalId is given.",
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
      language: {
        type: "string",
        description:
          "BCP-47 language code for result display. Set to the user's conversation language: " +
          "\"zh\" for Chinese, \"en\" for English (or omit). " +
          "Controls server-side localization and instructs Claude to apply the display mapping table when presenting results.",
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
          "Two-phase consent. Omit on the FIRST call — the tool returns needs_confirmation with " +
          "a preview quoting the $0.05 USDC charge and a consentToken. Present that quote to " +
          "the user and wait for their NEXT INDEPENDENT message. Then re-call with the SAME " +
          "args plus this token. Single-use, expires in ~120s, rejected if consumed within 2s.",
      },
    },
    required: ["confirm"],
    additionalProperties: false,
  },
} as const;
