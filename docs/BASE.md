# Q402 on Base

Stablecoin payments for AI agents on **Base** (chainId 8453), delivered through this MCP server.

## Settlement tracks on Base

Q402 supports two distinct settlement tracks on Base. They differ in signing scheme, gas path, and token scope.

### Track 1 — Q402-format x402 settlement (existing)

**Tool:** `q402_pay` (with `rail="x402"` and `walletMode="agentic-server"`)

The agent signs an **EIP-3009 `TransferWithAuthorization`** against Base USDC, then the Q402 facilitator submits the transaction on-chain and sponsors the gas. The signed authorization travels from the MCP client to the Q402 relay (`/api/relay`), which calls `USDC.transferWithAuthorization()` and pays gas from the Gas Tank.

- Token: **Base USDC only** (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`)
- Signing: EIP-3009 against USDC's own EIP-712 domain (`name="USD Coin"`, `version="2"`)
- Gas: sponsored by the Q402 facilitator (Gas Tank funded ETH)
- Wallet mode: **`agentic-server` only** — Q402 holds the encrypted key; no local private key needed
- Settlement: Q402 relay broadcasts and confirms on-chain

### Track 2 — Generic x402 client (new)

**Tool:** `q402_x402_fetch`

A buyer-side client for the open [x402 standard](https://x402.org). Makes HTTP requests to any x402-enabled API, handles HTTP 402 payment-required responses, and pays directly to the seller/facilitator without routing through Q402's relay.

- Token: **Base USDC only** (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`)
- Accepted: `scheme=exact`, `network=base` (or `base-mainnet`), asset = Base USDC address
- Signing: EIP-3009 `TransferWithAuthorization` signed locally with `Q402_AGENTIC_PRIVATE_KEY` or `Q402_PRIVATE_KEY`
- Gas: gas costs are borne by the seller's facilitator (or the seller directly), not by the buyer; the buyer only signs the authorization
- Relay: **none** — the signed authorization is base64-encoded into the `X-PAYMENT` header and sent directly to the seller in a retry request; Q402's `/api/relay` is not called
- Guards: per-call max-amount cap (`Q402_MAX_AMOUNT_PER_CALL`), per-session cumulative cap (`Q402_X402_SESSION_CAP_USD`, default $5), two-phase consent token

This tool also functions as a plain HTTP fetch (GET/POST/…) for non-402 URLs — the payment branch activates only when the server responds with HTTP 402 and a valid `accepts[]` payload.

## Proven on Base mainnet

Real mainnet transactions (not testnet):

| Rail | What it proves | Transaction |
|------|----------------|-------------|
| **x402** (EIP-3009, Q402 relay) | Q402 facilitator sponsoring gas on the x402 rail | [0x75c6d3a8…ab5cbde](https://basescan.org/tx/0x75c6d3a870bd1f6752bd597004aecccaf4130f8b0e15a219b007fe844ab5cbde) |
| **q402** (EIP-7702) | Set-code delegation, gasless settlement | [0xc2034668…d3b9ed](https://basescan.org/tx/0xc2034668a260526ef88ae3ab0d8d01bd82c62ea3c5136cbf0755dd1e87d3b9ed) |

## Contracts on Base

**Q402 implementation (verified on BaseScan):**
[0x2fb2B2D110b6c5664e701666B3741240242bf350](https://basescan.org/address/0x2fb2B2D110b6c5664e701666B3741240242bf350#code)

**Stablecoins:**

| Token | Address |
|-------|---------|
| USDC (native Circle) | [0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913](https://basescan.org/token/0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913) |
| USDT (bridged) | [0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2](https://basescan.org/token/0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2) |

## Configuration

| Env var | Applies to | Description |
|---------|-----------|-------------|
| `Q402_AGENTIC_PRIVATE_KEY` | Track 2 (`q402_x402_fetch`) | Local signing key for EIP-3009 auth |
| `Q402_PRIVATE_KEY` | Track 2 fallback | EOA private key, used if `Q402_AGENTIC_PRIVATE_KEY` is unset |
| `Q402_ENABLE_REAL_PAYMENTS=1` | Both tracks | Required to send real on-chain payments |
| `Q402_MAX_AMOUNT_PER_CALL` | Both tracks | Per-call USD cap (default $200) |
| `Q402_X402_SESSION_CAP_USD` | Track 2 only | Per-session cumulative spend cap (default $5) |

## Quick start

```
npx -y @quackai/q402-mcp
```

Per-client setup is in the main [README](../README.md).

## Links

- npm: https://www.npmjs.com/package/@quackai/q402-mcp
- Docs: https://q402.quackai.ai/docs
