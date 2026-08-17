# Instant vs. Escrowed Payments on Base — Decision Guide for Agents

Q402 supports two payment patterns on Base. This page helps agents (and their operators) choose the right tool for a given situation.

---

## The two patterns

### Instant: `q402_pay` (with `chain="base"`)

- Funds move **immediately and irreversibly** from the Agent Wallet to the recipient.
- Settled on-chain in a single EIP-7702 gasless transaction.
- Use when: you trust the counterparty, the service has already been rendered, or the payment is a tip / pre-agreed fee.
- Token support on Base: USDC (native Circle), USDT (bridged).
- No lock period, no arbiter, no dispute path.

### Escrowed: `q402_escrow_create` + `q402_escrow_lock` (with `chain="base"` or `chain="base-sepolia"`)

- Funds are **locked in a non-custodial vault** and held until explicitly released, refunded, or resolved.
- Release requires a buyer-signed EIP-712 message; refund is permissionless after the deadline.
- Use when: delivery is uncertain, the service is complex / multi-step, the counterparty is new, or the amount is large enough to warrant protection.
- Optional arbiter enables dispute resolution (a third party who can split or redirect the funds).
- Chain availability: BNB mainnet (live), Base Sepolia (testnet, for testing), Base mainnet (pending deploy — use BNB for production until mainnet launch).

---

## Decision tree

```
Payment needed
│
├── Has the service already been fully delivered and verified?
│   └── YES → q402_pay (instant, irrevocable)
│
├── Is this a small tip, fee, or pre-agreed fixed amount with a known vendor?
│   └── YES → q402_pay (instant)
│
├── Is delivery conditional, multi-step, or uncertain?
│   └── YES → q402_escrow_create + q402_escrow_lock
│       │
│       ├── Do you want recourse if a dispute arises?
│       │   └── YES → supply an `arbiter` address in escrow_create
│       │
│       └── What's the deadline?
│           └── Set `releaseDays` (default 7, max 90 days)
│
└── Are you testing on Base?
    └── Use chain="base-sepolia" (testnet; no real funds)
```

---

## When NOT to use escrow

- **Small routine payments** (API fees, per-call charges): the overhead of create → lock → release is not worth it. Use `q402_pay`.
- **x402-gated APIs**: use `q402_x402_fetch` — it pays the API's HTTP 402 challenge inline, no escrow needed.
- **Base mainnet production** (as of August 2026): the escrow vault is not yet deployed on Base mainnet. Use `chain="bnb"` for production escrow or `chain="base-sepolia"` for testnet. Track the deploy in the ops runbook (`docs/ESCROW-BASE-DEPLOY-RUNBOOK.md`).

---

## Chain selection guide

| Situation | Recommended chain | Tool |
|-----------|-------------------|------|
| Production instant payment on Base | `base` | `q402_pay` |
| Production escrowed payment | `bnb` | `q402_escrow_*` |
| Testnet escrow on Base | `base-sepolia` | `q402_escrow_*` |
| Production escrow on Base (future) | `base` (after mainnet deploy) | `q402_escrow_*` |

---

## Key differences at a glance

| Property | Instant (`q402_pay`) | Escrowed (`q402_escrow_*`) |
|----------|---------------------|---------------------------|
| Funds move at | Call time | Lock time (escrow_lock) |
| Reversible? | No | Yes (refund after deadline, or dispute) |
| Requires local key? | No (Mode C) | Yes for buyer-EOA path; No for Agent Wallet path |
| Arbiter supported? | No | Yes (optional) |
| Gas | Sponsored by Q402 | Sponsored by Q402 relayer |
| Base mainnet | Live | Pending deploy (use BNB) |
| Base Sepolia | Live (testnet) | Live (testnet) |

---

## Example: choosing escrow for a freelance task

```
Scenario: Agent A hires Agent B to write a research report for 50 USDC on Base.

1. Agent A: q402_escrow_create(chain="bnb", amount="50", token="USDC",
     seller=<Agent B address>, releaseDays=14, arbiter=<neutral address>)
   → returns escrowId

2. Agent A: q402_escrow_lock(escrowId=..., confirm=true)
   → funds locked, Agent B can verify on-chain

3. Agent B delivers the report.

4. Agent A reviews; if satisfied:
   q402_escrow_release(escrowId=..., confirm=true)
   → 50 USDC → Agent B

   If Agent A disputes:
   q402_escrow_dispute(escrowId=..., confirm=true)
   → arbiter decides off-tool

   If Agent A is unresponsive after 14 days:
   q402_escrow_refund(escrowId=..., confirm=true)
   → 50 USDC → Agent A (permissionless)
```

> Once Base mainnet escrow is deployed, replace `chain="bnb"` with `chain="base"` in the above flow.

---

## Links

- Instant payments docs: [README.md](../README.md)
- Base chain details: [docs/BASE.md](BASE.md)
- Base mainnet deploy runbook: [docs/ESCROW-BASE-DEPLOY-RUNBOOK.md](ESCROW-BASE-DEPLOY-RUNBOOK.md)
