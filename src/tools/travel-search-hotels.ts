import { z } from "zod";
import { getTravelMode } from "../travala/adapter.js";
import { MockAdapter } from "../travala/mock-adapter.js";
import { LiveAdapter } from "../travala/live-adapter.js";

export const SearchHotelsInputSchema = z.object({
  destination: z.string().describe("City, region, or address to search for hotels."),
  checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "checkIn must be YYYY-MM-DD").describe("Check-in date (YYYY-MM-DD)."),
  checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "checkOut must be YYYY-MM-DD").describe("Check-out date (YYYY-MM-DD)."),
  guests: z.number().int().min(1).optional().describe("Number of guests (default 1)."),
});

export type SearchHotelsInput = z.infer<typeof SearchHotelsInputSchema>;

export async function runSearchHotels(input: SearchHotelsInput) {
  const adapter = getTravelMode() === "live" ? new LiveAdapter() : new MockAdapter();
  return adapter.searchHotels(input);
}

export const TRAVEL_SEARCH_HOTELS_TOOL = {
  name: "travel_search_hotels",
  description:
    "Search for available hotels at a destination for a given date range. " +
    "Returns a list of hotels with IDs, names, locations, ratings, and nightly prices. " +
    "Use the returned hotelId with travel_get_quote to get an exact booking price. " +
    "In mock mode (default) returns deterministic fixture hotels.",
  inputSchema: {
    type: "object" as const,
    properties: {
      destination: { type: "string", description: "City, region, or address." },
      checkIn:     { type: "string", description: "Check-in date (YYYY-MM-DD)." },
      checkOut:    { type: "string", description: "Check-out date (YYYY-MM-DD)." },
      guests:      { type: "number", description: "Number of guests (default 1)." },
    },
    required: ["destination", "checkIn", "checkOut"],
    additionalProperties: false,
  },
} as const;
