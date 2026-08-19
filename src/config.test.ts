/**
 * Tests for isTrialChain window-aware routing.
 *
 * AC-2  Mantle is a trial chain within the window and not outside it.
 * AC-4  BNB is permanently a trial chain; Avalanche trial has ended.
 * AC-5  Base is a permanent trial chain (joined in 0.11.23).
 * AC-7  avax uses an ended-window implementation (end date is in the past).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  isTrialChain,
  AVAX_TRIAL_END_EXCLUSIVE_UTC,
  MANTLE_TRIAL_START_UTC,
  MANTLE_TRIAL_END_EXCLUSIVE_UTC,
} from "./config.js";

// ── AC-4 / AC-7: BNB is permanent; avax trial ended ─────────────────────────

describe("AC-4: BNB permanent trial chain", () => {
  const anyTime = new Date("2026-08-24T00:00:00.000Z");
  const futureTime = new Date("2030-01-01T00:00:00.000Z");

  test("bnb is trial at any time", () => {
    assert.equal(isTrialChain("bnb", anyTime), true);
  });
  test("bnb is trial at future time", () => {
    assert.equal(isTrialChain("bnb", futureTime), true);
  });
});

// ── AC-5: Base is a permanent trial chain ────────────────────────────────────

describe("AC-5: Base permanent trial chain", () => {
  const anyTime = new Date("2026-08-24T00:00:00.000Z");
  const futureTime = new Date("2030-01-01T00:00:00.000Z");

  test("base is trial at any time", () => {
    assert.equal(isTrialChain("base", anyTime), true);
  });
  test("base is trial at future time", () => {
    assert.equal(isTrialChain("base", futureTime), true);
  });
});

describe("AC-7: avax trial ended (ended-window implementation)", () => {
  // 1 ms before avax trial ended → still in trial
  const justBeforeEnd = new Date(AVAX_TRIAL_END_EXCLUSIVE_UTC.getTime() - 1);
  // exactly at avax trial end (exclusive) → no longer in trial
  const atEnd = new Date(AVAX_TRIAL_END_EXCLUSIVE_UTC.getTime());
  // current / future times → no longer in trial
  const afterEnd = new Date("2026-09-01T00:00:00.000Z");

  test("avax IS trial 1 ms before end (exclusive end)", () => {
    assert.equal(isTrialChain("avax", justBeforeEnd), true);
  });
  test("avax is NOT trial at end timestamp (exclusive)", () => {
    assert.equal(isTrialChain("avax", atEnd), false);
  });
  test("avax is NOT trial after end", () => {
    assert.equal(isTrialChain("avax", afterEnd), false);
  });
  test("avax is NOT trial at current time (trial has ended)", () => {
    // 2026-08-14T15:00:00Z is in the past relative to 2026-08-18
    assert.equal(isTrialChain("avax", new Date("2026-08-18T00:00:00.000Z")), false);
  });
});

// ── AC-2: Mantle is time-gated ──────────────────────────────────────────────

describe("AC-2: Mantle limited-time trial window", () => {
  // 1 ms before window opens
  const justBefore = new Date(MANTLE_TRIAL_START_UTC.getTime() - 1);
  // exactly at window open (inclusive)
  const atStart = new Date(MANTLE_TRIAL_START_UTC.getTime());
  // mid-window
  const midWindow = new Date("2026-08-24T12:00:00.000Z");
  // 1 ms before window closes (still inside, exclusive end)
  const justBeforeEnd = new Date(MANTLE_TRIAL_END_EXCLUSIVE_UTC.getTime() - 1);
  // exactly at window close (exclusive — NOT inside)
  const atEnd = new Date(MANTLE_TRIAL_END_EXCLUSIVE_UTC.getTime());
  // well after window
  const afterWindow = new Date("2026-09-01T00:00:00.000Z");

  test("mantle is NOT trial 1 ms before window", () => {
    assert.equal(isTrialChain("mantle", justBefore), false);
  });
  test("mantle IS trial at window start (inclusive)", () => {
    assert.equal(isTrialChain("mantle", atStart), true);
  });
  test("mantle IS trial mid-window", () => {
    assert.equal(isTrialChain("mantle", midWindow), true);
  });
  test("mantle IS trial 1 ms before window end", () => {
    assert.equal(isTrialChain("mantle", justBeforeEnd), true);
  });
  test("mantle is NOT trial at window end (exclusive)", () => {
    assert.equal(isTrialChain("mantle", atEnd), false);
  });
  test("mantle is NOT trial after window", () => {
    assert.equal(isTrialChain("mantle", afterWindow), false);
  });
});

// ── Non-trial chains are never trial ────────────────────────────────────────

describe("non-trial chains", () => {
  const duringWindow = new Date("2026-08-24T00:00:00.000Z");

  test("eth is not a trial chain even during window", () => {
    assert.equal(isTrialChain("eth", duringWindow), false);
  });
  test("arbitrum is not a trial chain", () => {
    assert.equal(isTrialChain("arbitrum", duringWindow), false);
  });
});
