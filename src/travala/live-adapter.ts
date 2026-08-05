/**
 * LiveAdapter - MCP client for travel-mcp.travala.com with OAuth 2.0.
 *
 * Gated by TRAVEL_MODE=live. When TRAVEL_MODE is unset or "mock" this module
 * is imported but LiveAdapter is never instantiated — no network requests occur.
 *
 * OAuth (client_credentials):
 *   POST https://travel-mcp.travala.com/oauth/token
 *   Credentials: TRAVALA_CLIENT_ID / TRAVALA_CLIENT_SECRET (required; readable
 *   error thrown at construct time if missing — not a crash).
 *   Token cached in memory; refreshed 30 s before expiry. Token NOT written to disk.
 *
 * MCP endpoint: https://travel-mcp.travala.com/mcp
 *   Transport: Streamable HTTP MCP, Authorization: Bearer <token>.
 *   Tool names: travala_search_hotel / travala_search_package / travala_book / travala_book_status
 *
 * Fixed env values (not hardcoded):
 *   TRAVALA_AGENT_ID       — e.g. "quackai-q402"
 *   TRAVALA_REWARD_WALLET  — e.g. "0xfDaACE6016EAfC30aC0a5d2d5a333bD1Ed68B3Cb" (Base)
 *
 * 402 Payment leg (Phase A — default still mock):
 *   travala_book may return { status: 402, next_action: {...} } requiring payment.
 *   The adapter enforces spend-limit + two-phase consent before calling the PaymentLeg.
 *   Real settlement is NOT yet implemented (no real 402 sample available).
 *   Target when wired: q402_pay x402 / agentic-server / Base USDC (src/tools/pay.ts).
 *   defaultPaymentLeg returns a structured "not yet implemented" error — no crash,
 *   no silent success.
 *
 * Testability seams (LiveAdapterDeps):
 *   fetchFn    — replaces global fetch for OAuth token requests.
 *   mcpCallFn  — receives (bearerToken, toolName, args); replaces the real MCP SDK
 *                call. When injected, OAuth is still performed so AC-4/AC-5 token
 *                assertions can inspect the bearer token passed to the stub.
 *   paymentLeg — injectable payment leg for AC-11/AC-12 assertions.
 *   nowFn      — injectable clock for AC-5 token-expiry simulation.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { checkConsent } from "../consent.js";
import { CONFIG } from "../config.js";
import type {
  TravalaAdapter,
  Hotel,
  Quote,
  BookingReceipt,
  BookingStatus,
  SearchParams,
  QuoteParams,
  BookParams,
  PaymentRequired,
  PaymentLeg,
  PaymentLegResult,
} from "./adapter.js";
import { TravalaPaymentRequiredError } from "./adapter.js";

const TRAVALA_MCP_URL = "https://travel-mcp.travala.com/mcp";
const TRAVALA_OAUTH_URL = "https://travel-mcp.travala.com/oauth/token";
const OAUTH_SCOPE = "mcp:read mcp:book mcp:cancel";
const TOKEN_REFRESH_BUFFER_MS = 30_000;

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Injectable MCP tool-call seam.
 * Receives the bearer token so tests can assert it matches the token returned
 * by their stubbed OAuth endpoint (AC-4 assertion: MCP calls carry Bearer).
 * When NOT injected, the real MCP SDK path is used with the bearer token set
 * in the Authorization header of StreamableHTTPClientTransport.requestInit.
 */
export type MCPCallFn = (
  bearerToken: string,
  name: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

export interface LiveAdapterDeps {
  /** Replaces global fetch for OAuth /token requests. */
  fetchFn?: FetchFn;
  /**
   * Replaces the entire MCP + auth flow for a single tool call.
   * OAuth is still performed (getToken() is called) so that AC-4/AC-5
   * tests can observe the bearer token flowing through.
   */
  mcpCallFn?: MCPCallFn;
  /** Replaces defaultPaymentLeg for 402 payment handling (AC-11/AC-12). */
  paymentLeg?: PaymentLeg;
  /** Replaces Date.now() for token-expiry simulation (AC-5). */
  nowFn?: () => number;
}

interface TokenCache {
  token: string;
  expiresAt: number; // ms epoch using nowFn
}

/**
 * Default payment leg: real settlement not yet implemented (Phase A).
 *
 * Target when real Travala 402 samples are available:
 *   q402_pay with rail="x402", chain="base", walletMode="agentic-server", token="USDC"
 *   Extract amount/recipient from PaymentRequired.next_action (exact shape TBD).
 *
 * Network selection:
 *   TRAVEL_PAYMENT_TESTNET=1  → Base Sepolia testnet path (configurable)
 *   TRAVEL_PAYMENT_MAINNET=1  → Base mainnet (explicit opt-in; off by default)
 *   default                   → "none" (no network selected)
 */
export const defaultPaymentLeg: PaymentLeg = async (
  payment: PaymentRequired,
): Promise<PaymentLegResult> => {
  const useTestnet = process.env["TRAVEL_PAYMENT_TESTNET"] === "1";
  // Mainnet is disabled by default — requires explicit TRAVEL_PAYMENT_MAINNET=1.
  const useMainnet = process.env["TRAVEL_PAYMENT_MAINNET"] === "1";
  const network: PaymentLegResult["network"] = useMainnet
    ? "mainnet"
    : useTestnet
      ? "testnet"
      : "none";
  return {
    success: false,
    network,
    error:
      "Payment settlement not yet implemented for this phase. " +
      `Network selection: ${network}. ` +
      (useMainnet
        ? "WARNING: mainnet path selected (TRAVEL_PAYMENT_MAINNET=1 is set). "
        : "Mainnet path is disabled by default (set TRAVEL_PAYMENT_MAINNET=1 to enable). ") +
      "When real Travala 402 samples are available, wire next_action to " +
      "q402_pay (rail=x402 / walletMode=agentic-server / chain=base / token=USDC). " +
      "Received next_action: " +
      JSON.stringify(payment.next_action),
  };
};

function getMaxBookingUsd(): number {
  const raw = process.env["TRAVALA_MAX_BOOKING_USD"];
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return CONFIG.maxAmountPerCallUsd;
}

export class LiveAdapter implements TravalaAdapter {
  private readonly agentId: string;
  private readonly rewardWallet: string;
  private readonly fetchFn: FetchFn;
  private readonly _mcpCallFn: MCPCallFn | undefined;
  private readonly paymentLegFn: PaymentLeg;
  private readonly nowFn: () => number;
  private tokenCache: TokenCache | null = null;

  constructor(deps?: LiveAdapterDeps) {
    const clientId = process.env["TRAVALA_CLIENT_ID"];
    const clientSecret = process.env["TRAVALA_CLIENT_SECRET"];
    if (!clientId || !clientSecret) {
      const missing = [
        !clientId && "TRAVALA_CLIENT_ID",
        !clientSecret && "TRAVALA_CLIENT_SECRET",
      ]
        .filter(Boolean)
        .join(", ");
      throw new Error(
        `[q402-mcp] TRAVEL_MODE=live requires ${missing}. ` +
          "Set these environment variables to enable live Travala integration: " +
          `${missing}=<value>. ` +
          "Register credentials at https://travel-mcp.travala.com/oauth/register " +
          "(POST with no auth, returns client_id and client_secret).",
      );
    }
    this.agentId = process.env["TRAVALA_AGENT_ID"] ?? "";
    this.rewardWallet = process.env["TRAVALA_REWARD_WALLET"] ?? "";
    this.fetchFn = deps?.fetchFn ?? ((url, init) => fetch(url, init));
    this._mcpCallFn = deps?.mcpCallFn;
    this.paymentLegFn = deps?.paymentLeg ?? defaultPaymentLeg;
    this.nowFn = deps?.nowFn ?? (() => Date.now());
  }

  /**
   * Fetch (or return cached) a valid OAuth bearer token.
   * Exported for direct testing of AC-4/AC-5 token-fetch behavior.
   */
  async getToken(): Promise<string> {
    const now = this.nowFn();
    if (
      this.tokenCache &&
      this.tokenCache.expiresAt - TOKEN_REFRESH_BUFFER_MS > now
    ) {
      return this.tokenCache.token;
    }

    const clientId = process.env["TRAVALA_CLIENT_ID"]!;
    const clientSecret = process.env["TRAVALA_CLIENT_SECRET"]!;

    const resp = await this.fetchFn(TRAVALA_OAUTH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
        scope: OAUTH_SCOPE,
      }).toString(),
    });

    if (!resp.ok) {
      throw new Error(
        `[q402-mcp] Travala OAuth token request failed: HTTP ${resp.status}. ` +
          "Verify TRAVALA_CLIENT_ID and TRAVALA_CLIENT_SECRET are correct.",
      );
    }

    const data = (await resp.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!data.access_token) {
      throw new Error(
        "[q402-mcp] Travala OAuth response is missing access_token.",
      );
    }

    const ttlMs = (data.expires_in ?? 3600) * 1000;
    this.tokenCache = {
      token: data.access_token,
      expiresAt: now + ttlMs,
    };
    return data.access_token;
  }

  private async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const token = await this.getToken();
    if (this._mcpCallFn) {
      return this._mcpCallFn(token, name, args);
    }
    return this.callWithMCPSdk(token, name, args);
  }

  private async callWithMCPSdk(
    bearerToken: string,
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const transport = new StreamableHTTPClientTransport(
      new URL(TRAVALA_MCP_URL),
      {
        requestInit: {
          headers: { Authorization: `Bearer ${bearerToken}` },
        },
      },
    );
    const client = new Client({
      name: "q402-mcp-travala-client",
      version: "1.0.0",
    });
    try {
      await client.connect(transport);
      return await client.callTool({ name, arguments: args });
    } finally {
      await client.close().catch(() => undefined);
    }
  }

  private callResult(result: unknown): Record<string, unknown> {
    const r = result as {
      content?: Array<{ type: string; text?: string }>;
    };
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
    const result = await this.callTool("travala_search_hotel", {
      destination: params.destination,
      checkIn: params.checkIn,
      checkOut: params.checkOut,
      guests: params.guests ?? 1,
    });
    const data = this.callResult(result);
    return { hotels: (data["hotels"] as Hotel[] | undefined) ?? [] };
  }

  async getQuote(params: QuoteParams): Promise<Quote> {
    const result = await this.callTool("travala_search_package", {
      hotelId: params.hotelId,
      checkIn: params.checkIn,
      checkOut: params.checkOut,
      guests: params.guests ?? 1,
    });
    return this.callResult(result) as unknown as Quote;
  }

  async bookHotel(params: BookParams): Promise<BookingReceipt> {
    // Build travala_book request body with all required keys (AC-1, AC-3).
    // agentId and rewardWallet come from env (not hardcoded) per AC-1.
    const bookArgs: Record<string, unknown> = {
      agentId: this.agentId,
      rewardWallet: this.rewardWallet,
      packageId: params.packageId ?? "",
      sessionId: params.sessionId ?? "",
      hotelId: params.hotelId,
      roomTypeId: params.roomTypeId ?? "",
      roomName: params.roomName ?? "",
      price: params.price ?? 0,
      currency: params.currency ?? "USD",
      customer: params.customer ?? { name: params.guestName },
    };

    const result = await this.callTool("travala_book", bookArgs);
    const data = this.callResult(result);

    // 402 detection: Travala signals payment required via { status: 402, next_action: {...} }.
    // next_action structure is passed through as-is (no fabrication; real shape TBD from sample).
    if (data["status"] === 402 && data["next_action"] !== undefined) {
      const paymentRequired: PaymentRequired = {
        status: 402,
        next_action: data["next_action"] as Record<string, unknown>,
      };
      // Always throws — the return after this is unreachable.
      return this.handlePaymentRequired(paymentRequired, params);
    }

    return data as unknown as BookingReceipt;
  }

  private async handlePaymentRequired(
    paymentRequired: PaymentRequired,
    params: BookParams,
  ): Promise<never> {
    // Spend-limit check (AC-11). Use amount from next_action if available, else from BookParams.
    const paymentAmount =
      typeof paymentRequired.next_action["amount"] === "number"
        ? (paymentRequired.next_action["amount"] as number)
        : (params.price ?? 0);

    const cap = getMaxBookingUsd();
    if (paymentAmount > 0 && paymentAmount > cap) {
      throw new TravalaPaymentRequiredError(
        paymentRequired,
        undefined,
        `payment amount $${paymentAmount} exceeds the spend limit of $${cap}. ` +
          "Set TRAVALA_MAX_BOOKING_USD to a higher value to allow larger payments.",
      );
    }

    // Two-phase consent check (AC-11). Reuses checkConsent from consent.ts.
    // Intent is bound to hotelId + next_action content so the previewed payment
    // cannot be swapped for a different one.
    const paymentIntent = {
      t: "travala_payment",
      hotelId: params.hotelId,
      next_action: paymentRequired.next_action,
    };
    const consent = checkConsent(paymentIntent, params.paymentConsentToken);
    if (!consent.ok) {
      throw new TravalaPaymentRequiredError(paymentRequired, {
        preview:
          `Travala booking requires payment to complete. ` +
          `Payment details: ${JSON.stringify(paymentRequired.next_action)}. ` +
          `Confirm with the user, then re-call travel_book_hotel with the same args plus ` +
          `paymentConsentToken="${consent.expected}".`,
        consentToken: consent.expected,
      });
    }

    // Consent passed — call the injectable payment leg (AC-12).
    const legResult = await this.paymentLegFn(paymentRequired);
    throw new TravalaPaymentRequiredError(
      paymentRequired,
      undefined,
      undefined,
      legResult,
    );
  }

  async getBookingStatus(bookingId: string): Promise<BookingStatus> {
    const result = await this.callTool("travala_book_status", { bookingId });
    return this.callResult(result) as unknown as BookingStatus;
  }
}
