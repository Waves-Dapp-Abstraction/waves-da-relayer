# Fee sponsorship and refund guard

## `dappConfig.json`

Each whitelisted method has:

| Field | Meaning |
|--------|--------|
| `useVerifierMode` | `false` = REGULAR (relayer is `i.caller` on the DA). `true` = VERIFIER (DA is sender; correct `originCaller` on targets). |
| `sponsorFee` | Only meaningful when `useVerifierMode` is `false`. If `true`, the relayer accepts paying the network fee with no on-chain refund from the DA (no refund guard). If `false` (default), the relayer sets **`reimburseFee: true`** on the built `proxy` tx and runs the refund guard (unless disabled). HTTP clients do not send `reimburseFee`. |

`sponsorFee: true` is **invalid** when `useVerifierMode: true` (VERIFIER): the DA pays the transaction fee; relayer “sponsorship” does not apply.

## Refund guard

When `sponsorFee` is `false`, REGULAR mode, and `REFUND_GUARD_ENABLED` is not set to `false`, the relayer:

1. Builds the invoke with **`reimburseFee: true`** (derived from config, not from the client).
2. After building the signed invoke transaction, calls **`POST {NODE_URL}/debug/validate`** with the same JSON the node would accept for broadcast, and inspects the **execution trace** for a transfer to the relayer address matching `tx.fee` and `tx.feeAssetId`.

This matches what a malicious DA could not fake at the HTTP layer: the trace is produced from the current on-chain script.

### Node requirement

The Waves node must expose **`/debug/validate`**. Most public testnet nodes do; if yours does not, set `REFUND_GUARD_ENABLED=false` and accept that only the `reimburseFee` flag is enforced (no trace proof).

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `REFUND_GUARD_ENABLED` | `true` | Set to `false`, `0`, `no`, or `off` to skip `/debug/validate` (e.g. restricted node). |
