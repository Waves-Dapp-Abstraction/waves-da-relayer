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
    "recordIntStrBool": { "useVerifierMode": false, "sponsorFee": false }
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `useVerifierMode` | boolean | `false` → **REGULAR**. `true` → **VERIFIER** (correct `originCaller` on targets; DA pays fee). |
| `sponsorFee` | boolean | Only for REGULAR (`useVerifierMode: false`). `true` = relayer pays network fee, no refund-from-DA requirement. `false` = relayer sets `reimburseFee: true` on the built tx; refund guard may apply. **Invalid** if `useVerifierMode` is `true`. |

Only `useVerifierMode` and `sponsorFee` are allowed per method. Invalid combinations or unknown keys cause a **startup error**.

Detailed fee/refund semantics: **[`FEE_AND_REFUND.md`](FEE_AND_REFUND.md)**.

---

## Authentication

**All protected endpoints require an `Authorization: Bearer {token}` header.**

The relayer authenticates EOAs via a challenge-response flow. **Use the SDK client for seamless auth:**

```ts
import { RelayerAuthClient, RelayerSession } from "waves-da-sdk";
import { Signer } from "@waves/signer";
import { ProviderKeeper } from "@waves/provider-keeper";

const signer = new Signer({ NODE_URL: "https://nodes-testnet.wavesnodes.com" });
signer.setProvider(new ProviderKeeper());

const authClient = new RelayerAuthClient("http://localhost:3000");
const session = new RelayerSession();

// One call: login + authenticate (token cached for reuse)
const auth = await authClient.loginAndAuthenticate(signer, session);

// Use token in all requests
const res = await fetch("http://localhost:3000/invoke", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${auth.token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    eoa: auth.eoa,
    targetDapp: "3P...",
    function: "myMethod",
    args: [],
  }),
});
```

**Manual flow** (if you prefer step-by-step control):

1. **Client**: `GET /auth/challenge/{eoa}` → receive nonce
2. **Client**: Sign nonce with wallet
3. **Client**: `POST /auth/verify` with signature → receive JWT token
4. **Client**: Include token in all `/invoke` requests

**Full details:** [`AUTH.md`](AUTH.md)

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
| `args` | array | No | All Waves callable arg types are supported (default `[]`). See arg encoding table below. |
| `payments` | array | No | `{ "amount": number, "assetId"?: string }`, max **2** entries |

**Arg encoding**

All Waves callable argument types are supported:

| Waves type | JSON encoding | Example |
|------------|--------------|---------|
| `Int` | `number` | `42` |
| `String` | `string` | `"hello"` |
| `Boolean` | `boolean` | `true` |
| `ByteVector` | `{ "binary": "base64string" }` | `{ "binary": "AQID" }` |
| `List[...]` | `{ "list": [...scalars] }` | `{ "list": ["a", "b"] }` |

List elements can be any scalar type (Int, String, Boolean, ByteVector). Nested lists are not allowed by the Waves protocol.

The relayer does **not** accept client-controlled execution mode or fee settings: **`useVerifierMode` and `sponsorFee` come only from `dappConfig.json`.**

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

#### Example: Call a dApp via `/invoke` (JavaScript)

```js
// After authentication (use RelayerAuthClient from SDK for seamless login)
const token = auth.token;
const eoa = auth.eoa;

// Call a dApp method via the relayer
const response = await fetch("http://localhost:3000/invoke", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    eoa: eoa,
    targetDapp: "3N5peeTj1jpFnBMtvTzGjDRvb3GJ99CEUnX",
    function: "recordIntStrBool",
    args: [1, "hello", true],
    payments: []
  }),
});

const result = await response.json();
if (result.ok) {
  console.log("Transaction ID:", result.txId);
  console.log("Mode:", result.mode); // "regular" or "verifier"
} else {
  console.error("Error:", result.code, result.error);
}
```

#### Example: With binary and list arguments

```js
// ByteVector: encode as base64
const binaryData = new Uint8Array([1, 2, 3, 4, 5]);
const base64Binary = Buffer.from(binaryData).toString("base64");

// List[String]: encode as { list: [...] }
const tags = ["nft", "art", "rare"];

const response = await fetch("http://localhost:3000/invoke", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    eoa: eoa,
    targetDapp: "3N5peeTj1jpFnBMtvTzGjDRvb3GJ99CEUnX",
    function: "mintNFT",
    args: [
      42,                           // Int
      "My NFT",                     // String
      { binary: base64Binary },     // ByteVector
      { list: tags },               // List[String]
      { list: [100, 200, 300] },    // List[Int]
    ],
    payments: [{ amount: 1000000 }]
  }),
});

const result = await response.json();
if (result.ok) {
  console.log("Transaction ID:", result.txId);
}
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
- [`FEE_AND_REFUND.md`](FEE_AND_REFUND.md) — `sponsorFee` and refund guard
- [waves-da-sdk](https://www.npmjs.com/package/waves-da-sdk) — SDK for client-side integration
- [Waves DA Documentation](https://waves-da.com/docs) — full integration and protocol guides
