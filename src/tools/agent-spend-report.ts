/**
 * q402_agent_spend_report - per-Agent-Wallet spend breakdown over a window.
 * Read-only; Mode-C. Hits memory-by-key { action:"agent" }.
 *
 * Also includes outbound-x402 audit records from the local x402 audit store,
 * which are not visible through /api/relay Trust Receipts.
 */
import { z } from "zod";
import { callMemory } from "./memory-shared.js";
import { listX402AuditRecords } from "./x402-audit-store.js";

export const AgentSpendReportInputSchema = z.object({
  window: z.enum(["24h", "7d", "30d", "all"]).optional().describe("Time window: 24h | 7d | 30d | all. Default 7d."),
});
export type AgentSpendReportInput = z.infer<typeof AgentSpendReportInputSchema>;

export const AGENT_SPEND_REPORT_TOOL = {
  name: "q402_agent_spend_report",
  description:
    "Per-agent spend report: for each of the owner's Agent Wallets, the USD spent and tx count in the window, plus its " +
    "label and its daily / per-transaction caps. Answers 'what did my Research agent spend this week?' and 'which agent " +
    "is spending the most?'. Spend is attributed by the wallet that sent each payment, so it is precise for agents that " +
    "run on their own dedicated Agent Wallet. Read-only and free: any live API key (Trial or Multichain). " +
    "Also includes outbound x402 payments made via q402_x402_fetch (generic x402 client path), which are not " +
    "tracked by the relay Trust Receipt system.",
  inputSchema: {
    type: "object" as const,
    properties: {
      window: { type: "string" as const, enum: ["24h", "7d", "30d", "all"], description: "Time window. Default 7d." },
    },
    additionalProperties: false,
  },
};

export async function runAgentSpendReport(input: AgentSpendReportInput = {}): Promise<Record<string, unknown>> {
  const window = input.window ?? "7d";

  const [serverResult, x402Records] = await Promise.allSettled([
    callMemory("agent", { window }),
    Promise.resolve(listX402AuditRecords(window)),
  ]);

  const result: Record<string, unknown> =
    serverResult.status === "fulfilled" ? { ...(serverResult.value as object) } : {};

  const records = x402Records.status === "fulfilled" ? x402Records.value : [];
  const settled = records.filter(r => r.status === "settled");
  const blocked = records.filter(r => r.status !== "settled");
  const totalUsd = settled.reduce((sum, r) => sum + parseFloat(r.amountUsd), 0);

  result.outboundX402 = {
    window,
    settledCount: settled.length,
    blockedCount: blocked.length,
    totalUsd: totalUsd.toFixed(4),
    records,
  };

  return result;
}
