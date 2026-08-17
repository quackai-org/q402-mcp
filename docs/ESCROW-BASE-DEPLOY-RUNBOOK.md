# Escrow on Base Mainnet — Deploy Runbook

**Audience:** engineering hands only. This runbook moves funds on production infrastructure.
**Agents must NOT execute this runbook.** Every step requires a human operator with direct access to the private keys, BaseScan verifier credentials, and the Q402 admin panel.

---

## Prerequisites

| Item | Notes |
|------|-------|
| Base mainnet RPC | e.g. `https://mainnet.base.org` or a private node |
| Deployer EOA | holds ETH for gas; must be distinct from the relayer wallet |
| Q402EscrowVault bytecode + ABI | compiled from `q402-avalanche` (contract source; verify commit hash against the audited artifact) |
| Q402EscrowLockImpl bytecode + ABI | same source tree |
| BaseScan API key | for `--verify` flag |
| Relayer EOA | the address that will relay lock txs; needs ETH for gas |
| USDC address on Base | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (native Circle) |
| USDT address on Base | `0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2` (bridged) |

---

## Step 1 — Deploy Q402EscrowLockImpl

```bash
# Example using cast / forge deploy script from q402-avalanche repo
forge script script/DeployLockImpl.s.sol \
  --rpc-url https://mainnet.base.org \
  --broadcast \
  --verify \
  --etherscan-api-key $BASESCAN_API_KEY \
  --chain-id 8453
```

Record the deployed `lockImpl` address. Verify on [BaseScan](https://basescan.org):

```
cast code <lockImpl-address> --rpc-url https://mainnet.base.org | wc -c
# Must be > 2 (non-empty)
```

---

## Step 2 — Deploy Q402EscrowVault

```bash
forge script script/DeployVault.s.sol \
  --rpc-url https://mainnet.base.org \
  --broadcast \
  --verify \
  --etherscan-api-key $BASESCAN_API_KEY \
  --chain-id 8453
```

Constructor args (example — check the actual contract):

| Arg | Value |
|-----|-------|
| `_facilitator` | Q402 relayer EOA address |
| `_lockImpl` | lockImpl address from Step 1 |
| `_usdc` | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| `_usdt` | `0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2` |

Record the deployed `vault` address.

---

## Step 3 — Verify contracts on BaseScan

Both contracts should be source-verified automatically via `--verify` above. Confirm:

- `https://basescan.org/address/<vault>#code` → "Contract Source Code Verified"
- `https://basescan.org/address/<lockImpl>#code` → "Contract Source Code Verified"

If auto-verify failed, run `forge verify-contract` manually.

---

## Step 4 — Fund the relayer with Base ETH

The relayer EOA sponsors gas for lock transactions. Seed it with enough ETH for your expected transaction volume. A minimum of 0.1 ETH is recommended for initial smoke testing.

```bash
cast send <relayer-address> --value 0.1ether \
  --rpc-url https://mainnet.base.org \
  --private-key $DEPLOYER_PRIVATE_KEY
```

Confirm balance:

```bash
cast balance <relayer-address> --rpc-url https://mainnet.base.org
```

---

## Step 5 — Update server config (`ESCROW_CHAINS`)

In `Q402-Institutional` (server), add the Base mainnet entry to the escrow chain config (the path is `app/lib/escrow-contracts.ts` or equivalent — confirm with AC-2 when that gate opens). The MCP client already accepts `chain="base"` in its enum; the server is the authoritative gating layer.

**This step is PARKED on AC-0 (contract artifacts must be confirmed) and AC-2 (server config round). Do not modify the server config until both gates are open.**

---

## Step 6 — Smoke test (create → lock → release, tiny amount)

Once the server config is live, run a minimal e2e:

1. `q402_escrow_create` with `chain="base"`, `amount="0.01"`, `token="USDC"`, a test seller address.
2. `q402_escrow_lock` with `confirm:true` — verify tx appears on [basescan.org](https://basescan.org).
3. `q402_escrow_release` with `confirm:true` — verify seller balance increased.

Confirm all three txs are type-4 (EIP-7702 set-code) on BaseScan.

---

## Step 7 — Flip `ESCROW_ENABLED_CHAINS` (server feature flag)

Add `"base"` to the server-side `ESCROW_ENABLED_CHAINS` env var (or equivalent config key). This enables live traffic for Base mainnet escrows.

---

## Rollback

If the vault address is wrong or contracts misbehave:

1. Remove `"base"` from `ESCROW_ENABLED_CHAINS` in server config — traffic gates closed immediately.
2. The MCP client enum (`"base"` / `"base-sepolia"`) can remain in place; the server's `/escrow/info` endpoint will return an error for any un-deployed chain.
3. File an issue in the internal tracker with BaseScan tx links and the error observed.

---

## Ops checklist

- [ ] lockImpl deployed and verified on BaseScan
- [ ] vault deployed and verified on BaseScan
- [ ] Relayer EOA funded with ≥ 0.1 ETH Base ETH
- [ ] Server config updated with Base addresses (AC-2)
- [ ] Smoke test: create → lock → release completed with real tx links
- [ ] `ESCROW_ENABLED_CHAINS` includes `"base"`
- [ ] `company-brain/quack-ai/kb/product-canon.md` updated (ops owner action)
