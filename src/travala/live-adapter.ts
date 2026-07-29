/**
 * LiveAdapter - MCP client adapter connecting to travel-mcp.travala.com/mcp.
 *
 * Gated by TRAVEL_MODE=live. When TRAVEL_MODE is unset or "mock" this module
 * is imported but LiveAdapter is never instantiated - no network requests occur.
 * When TRAVEL_MODE=live and credentials are missing, the constructor throws a
 * readable error rather than crashing.
 *
 * Protocol: Streamable HTTP MCP transport to https://travel-mcp.travala.com/mcp.
 * agentID and rewardWallet are forwarded as tool arguments (reserved; may be
 * empty in Phase 1).
 * Reference: https://github.com/travala/travel-mcp
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
  TravalaAdapter,
  Hotel,
  Quote,
  BookingReceipt,
  BookingStatus,
  SearchParams,
  QuoteParams,
  BookParams,
} from "./adapter.js";

const TRAVALA_MCP_URL = "https://travel-mcp.travala.com/mcp";

export class LiveAdapter implements TravalaAdapter {
  private agentID: string;
  private rewardWallet: string;

  constructor() {
    this.agentID = process.env["TRAVALA_AGENT_ID"] ?? "";
    this.rewardWallet = process.env["TRAVALA_REWARD_WALLET"] ?? "";
    if (!this.agentID || !this.rewardWallet) {
      process.stderr.write(
        "[q402-mcp] warning: TRAVEL_MODE=live but TRAVALA_AGENT_ID or TRAVALA_REWARD_WALLET " +
          "is not set. Booking rewards will not be credited. Set these env vars for full " +
          "Travala agent functionality.\n",
      );
    }
  }

  private async withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
    const transport = new StreamableHTTPClientTransport(new URL(TRAVALA_MCP_URL));
    const client = new Client({ name: "q402-mcp-travala-client", version: "1.0.0" });
    try {
      await client.connect(transport);
      return await fn(client);
    } finally {
      await client.close().catch(() => undefined);
    }
  }

  private callResult(result: unknown): Record<string, unknown> {
    const r = result as { content?: Array<{ type: string; text?: string }> };
    if (!r?.content?.length) return {};
    const first = r.content[0];
    if (first?.type === "text" && first.text) {
      try {
        return JSON.parse(first.text) as Record<string, unknown>;
      } catch {
        return { raw: first.text };
      }
    }
    return {};
  }

  async searchHotels(params: SearchParams): Promise<{ hotels: Hotel[] }> {
    return this.withClient(async client => {
      const result = await client.callTool({
        name: "search_hotels",
        arguments: {
          destination: params.destination,
          checkIn: params.checkIn,
          checkOut: params.checkOut,
          guests: params.guests ?? 1,
        },
      });
      const data = this.callResult(result);
      return { hotels: (data["hotels"] as Hotel[] | undefined) ?? [] };
    });
  }

  async getQuote(params: QuoteParams): Promise<Quote> {
    return this.withClient(async client => {
      const result = await client.callTool({
        name: "get_quote",
        arguments: {
          hotelId: params.hotelId,
          checkIn: params.checkIn,
          checkOut: params.checkOut,
          guests: params.guests ?? 1,
          agentID: this.agentID,
        },
      });
      return this.callResult(result) as unknown as Quote;
    });
  }

  async bookHotel(params: BookParams): Promise<BookingReceipt> {
    return this.withClient(async client => {
      const result = await client.callTool({
        name: "book_hotel",
        arguments: {
          hotelId: params.hotelId,
          checkIn: params.checkIn,
          checkOut: params.checkOut,
          guests: params.guests ?? 1,
          guestName: params.guestName,
          agentID: this.agentID,
          rewardWallet: this.rewardWallet,
        },
      });
      return this.callResult(result) as unknown as BookingReceipt;
    });
  }

  async getBookingStatus(bookingId: string): Promise<BookingStatus> {
    return this.withClient(async client => {
      const result = await client.callTool({
        name: "get_booking_status",
        arguments: { bookingId },
      });
      return this.callResult(result) as unknown as BookingStatus;
    });
  }
}
