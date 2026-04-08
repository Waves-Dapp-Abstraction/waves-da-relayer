# Relayer — Waves DA

HTTP service that:

- resolves the user's **active DA** from the **Registry**
- builds `DA.proxy(...)` transactions with **`waves-da-sdk`**
- enforces **per–dApp / per–method** policy from **`dappConfig.json`** (REGULAR vs VERIFIER, fee sponsorship rules)
- optionally runs a **refund guard** on REGULAR txs (trace validation via the node's `/debug/validate`)
- **signs** with a configured relayer seed and **broadcasts** to the Waves node
- **authenticates** EOAs via cryptographic signature verification (challenge-response + JWT tokens)

> The relayer is suitable for development and testnet validation. Harden with rate limits, TLS, operational monitoring, and strong `JWT_SECRET` before any production deployment.

---

## Setup

### Install

```bash
cd relayer
npm install
```

### Environment (`.env`)

Copy `relayer/.env.example` to `.env` and set:

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Listen port (default `3000`) |
| `NODE_URL` | No | Waves node REST API (default public testnet) |
| `CHAIN_ID` | No | `84` testnet, `87` mainnet |
| `REGISTRY_ADDRESS` | **Yes** | Registry dApp address (base58) |
| `RELAYER_SEED` | **Yes** | Relayer account seed (signs invokes) |
| `JWT_SECRET` | **Yes (prod)** | Secret for JWT token signatures. Use a strong random string (32+ chars) in production. Warnings logged if missing. |
| `FEE_REGULAR` | No | Fee in smallest units for REGULAR (default `500000`) |
| `FEE_VERIFIER` | No | Fee for VERIFIER (default `900000`) |
| `REFUND_GUARD_ENABLED` | No | Default **on**. Set to `false`, `0`, `no`, or `off` to skip `/debug/validate` checks (e.g. nodes without debug API) |
| `DAPP_CONFIG_PATH` | No | Absolute or cwd-relative path to `dappConfig.json` (default `./dappConfig.json`) |

The process exits on startup if `REGISTRY_ADDRESS` or `RELAYER_SEED` is missing.

### `dappConfig.json`

Whitelist of target dApps and callables. Loaded at startup from `DAPP_CONFIG_PATH` or `relayer/dappConfig.json`.

Shape:

```json
{
  "3N5peeTj1jpFnBMtvTzGjDRvb3GJ99CEUnX": {
    "recordIntStrBool": { "useOrigin": false, "sponsorFee": false }
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `useOrigin` | boolean | `false` → **REGULAR**. `true` → **VERIFIER** (correct `originCaller` on targets; DA pays fee). |
| `sponsorFee` | boolean | Only for REGULAR (`useOrigin: false`). `true` = relayer pays network fee, no refund-from-DA requirement. `false` = relayer sets `reimburseFee: true` on the built tx; refund guard may apply. **Invalid** if `useOrigin` is `true`. |

Only `useOrigin` and `sponsorFee` are allowed per method. Invalid combinations or unknown keys cause a **startup error**.

Detailed fee/refund semantics: **[`FEE_AND_REFUND.md`](FEE_AND_REFUND.md)**.

---

## Authentication

**All protected endpoints require an `Authorization: Bearer {token}` header.**

The relayer authenticates EOAs via a challenge-response flow:

1. **Client**: `GET /auth/challenge/{eoa}` → receive nonce
2. **Client**: Sign nonce with Keeper
3. **Client**: `POST /auth/verify` with signature → receive JWT token
4. **Client**: Include token in all `/invoke` requests

**Full details:** [`AUTH.md`](AUTH.md) and [`../sdk/examples/authFlow.ts`](../sdk/examples/authFlow.ts)

---

## HTTP API

Base URL assumed: `http://localhost:3000` (adjust `PORT`).

### Public endpoints (no auth required)

#### `GET /health`

Liveness probe.

**Response 200**

```json
{ "ok": true }
```

#### `GET /info`

Public configuration useful for clients (registry, relayer identity).

**Response 200**

```json
{
  "ok": true,
  "registryAddress": "3P...",
  "relayerAddress": "3P...",
  "relayerPubKey": "..."
}
```

#### `GET /auth/challenge/{eoa}`

Initiate authentication for an EOA. Returns a challenge nonce to be signed.

**Parameters**

- `{eoa}` (path): User's Waves address (base58)

**Response 200**

```json
{
  "ok": true,
  "nonce": "a1b2c3d4...",
  "expiresAt": 1700086400000,
  "message": "Sign this message to authenticate: a1b2c3d4..."
}
```

**Errors**

- `400` if `eoa` is invalid

#### `POST /auth/verify`

Verify a signed challenge and receive a JWT token.

**Request body**

```json
{
  "eoa": "3N...",
  "publicKey": "base58PublicKey...",
  "message": "Sign this message to authenticate: a1b2c3d4...",
  "signature": "base58Signature..."
}
```

**Response 200**

```json
{
  "ok": true,
  "token": "eyJhbGc...",
  "expiresAt": 1700086400000,
  "eoa": "3N..."
}
```

**Errors**

- `400` if signature verification fails or message is malformed
- `401` if challenge is expired or EOA mismatch

#### `POST /auth/verify-token`

Verify a token is still valid (optional client-side check).

**Request body**

```json
{
  "token": "eyJhbGc..."
}
```

**Response 200**

```json
{
  "ok": true,
  "eoa": "3N...",
  "publicKey": "base58PublicKey..."
}
```

### Protected endpoints (require Bearer token)

#### `POST /invoke`

Submits a proxied call through the user's DA. **Requires `Authorization: Bearer {token}` header.**

**Request headers**

```
Authorization: Bearer {token}
Content-Type: application/json
```

**Request body (JSON)**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `eoa` | string | Yes | User address (base58); must match the `eoa` in the token |
| `targetDapp` | string | Yes | Target dApp address (must appear in `dappConfig.json`) |
| `function` | string | Yes | Callable name (must be whitelisted for that dApp) |
| `args` | array | No | Arguments: numbers, strings, or booleans only (default `[]`). For binary args, use the SDK directly. |
| `payments` | array | No | `{ "amount": number, "assetId"?: string }`, max **2** entries |

The relayer does **not** accept a client-controlled execution mode or fee-refund flag: **`useOrigin` / `sponsorFee` (and thus `reimburseFee` on the built tx) come only from `dappConfig.json`.** A legacy `reimburseFee` field in JSON, if present, is **stripped** and ignored.

**Success response 200**

```json
{
  "ok": true,
  "mode": "regular",
  "txId": "..."
}
```

`mode` is `"regular"` or `"verifier"` depending on the matched method config.

**Error responses**

Errors use `ok: false` and a stable `code` string (see below). HTTP status varies: `400` (validation), `401` (auth failed), `403` (whitelist), `422` (business / guard / DA missing), `500` / `502` (server / node).

Example validation error:

```json
{
  "ok": false,
  "code": "VALIDATION_ERROR",
  "error": "Invalid request body",
  "details": { ... }
}
```

Example auth error:

```json
{
  "ok": false,
  "code": "VALIDATION_ERROR",
  "error": "Missing Authorization header with Bearer token"
}
```

#### Example: Complete flow with `curl`

```bash
# 1. Get challenge
curl -s http://localhost:3000/auth/challenge/3N... | jq '.message' > message.txt
MESSAGE=$(cat message.txt)

# 2. Sign with Keeper (in your app via @waves/signer)
# SIGNATURE=$(signer.signMessage(MESSAGE))
# For now, assume you got: SIGNATURE="base58Sig..."

# 3. Verify and get token
TOKEN=$(curl -s -X POST http://localhost:3000/auth/verify \
  -H "Content-Type: application/json" \
  -d '{
    "eoa": "3N...",
    "publicKey": "base58PubKey...",
    "message": '"$MESSAGE"',
    "signature": "base58Sig..."
  }' | jq -r '.token')

# 4. Use token in invoke
curl -s -X POST http://localhost:3000/invoke \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "eoa": "3N...",
    "targetDapp": "3N5peeTj1jpFnBMtvTzGjDRvb3GJ99CEUnX",
    "function": "recordIntStrBool",
    "args": [1, "hello", true]
  }'
```

Replace addresses and method names with values present in your `dappConfig.json` and on-chain permissions.

---

## Error codes

All codes are uppercase strings on `ErrorResponse.code`.

| Code | Typical HTTP | Meaning |
|------|----------------|--------|
| `VALIDATION_ERROR` | 400 | Body failed schema validation, malformed JSON, or auth missing |
| `DAPP_NOT_WHITELISTED` | 403 | `targetDapp` not a key in `dappConfig.json` |
| `METHOD_NOT_ALLOWED` | 403 | `function` not configured for that dApp |
| `REFUND_GUARD_FAILED` | 422 | Trace validation did not show a fee refund to the relayer |
| `DA_NOT_FOUND` | 422 | No active DA in the registry for `eoa` |
| `BUILD_TX_FAILED` | 500 | Transaction build failed (unexpected) |
| `BROADCAST_FAILED` | 502 | Node rejected or failed broadcast |
| `INTERNAL_ERROR` | 500 | Unhandled server error |

Implementation: `relayer/src/errors.ts`.

---

## Run

```bash
npm start
```

Logs include `RELAYER_ADDRESS` and `RELAYER_PUBKEY` at startup (for allowlisting on the DA).

---

## See also

- [`AUTH.md`](AUTH.md) — detailed authentication and challenge-response flow
- [`../docs/REGISTRY.md`](../docs/REGISTRY.md) — canonical `REGISTRY_ADDRESS` (one per network)
- [`../docs/QUICKSTART.md`](../docs/QUICKSTART.md) — minimal setup + front `fetch` snippet
- [`../docs/SPEC.md`](../docs/SPEC.md) — protocol specification
- [`../docs/INTEGRATION.md`](../docs/INTEGRATION.md) — dApp integration guide
- [`../sdk/README.md`](../sdk/README.md) — SDK used internally + `RelayerAuthClient`
- [`FEE_AND_REFUND.md`](FEE_AND_REFUND.md) — `sponsorFee` and refund guard
