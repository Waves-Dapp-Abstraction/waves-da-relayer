# Authentication — Waves DA Relayer

The Waves DA Relayer uses a **challenge-response** authentication scheme to verify that API requests come from the legitimate EOA (account owner), not an impersonator.

## Overview

Authentication prevents unauthorized users from impersonating others and making calls on their behalf. The flow is:

1. **Challenge**: Client requests a nonce from the relayer
2. **Sign**: Client signs the nonce with their Waves private key (via Keeper)
3. **Verify**: Relayer verifies the signature and returns a JWT token
4. **Request**: Client includes the token in subsequent requests via the `Authorization: Bearer {token}` header

## Authentication Flow

### Step 1: Get Challenge

```bash
GET /auth/challenge/{eoa}
```

**Parameters**

- `{eoa}` — User's Waves address (e.g., `3N...`)

**Response (200)**

```json
{
  "ok": true,
  "nonce": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
  "expiresAt": 1700086400000,
  "message": "Sign this message to authenticate: a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"
}
```

Store the `message` — you'll sign it in the next step.

### Step 2: Sign with Keeper

Use the Waves Signer (Keeper) to sign the message:

```typescript
import { Signer } from "@waves/signer";
import { ProviderKeeper } from "@waves/provider-keeper";

const signer = new Signer({ NODE_URL: "https://nodes-testnet.wavesnodes.com" });
signer.setProvider(new ProviderKeeper());

// From Step 1
const { message } = challengeResponse;

// Sign with Keeper
const signature = await signer.signMessage(message);
const signerState = await signer.login(); // Get publicKey
```

### Step 3: Exchange Signature for Token

```bash
POST /auth/verify
Content-Type: application/json

{
  "eoa": "3N...",
  "publicKey": "base58PublicKey...",
  "message": "Sign this message to authenticate: a1b2c3d4...",
  "signature": "base58Signature..."
}
```

**Response (200)**

```json
{
  "ok": true,
  "token": "eyJhbGc...",
  "expiresAt": 1700086400000,
  "eoa": "3N..."
}
```

**Error responses**

- `400` — Invalid signature or message format
- `401` — Challenge expired or EOA mismatch

### Step 4: Use Token in Protected Requests

Include the token in the `Authorization` header:

```bash
POST /invoke
Authorization: Bearer eyJhbGc...
Content-Type: application/json

{
  "eoa": "3N...",
  "targetDapp": "3P...",
  "function": "myMethod",
  "args": [1, "hello", true]
}
```

The relayer verifies:
- The token is valid and not expired
- The `eoa` in the request matches the `eoa` in the token

## Complete Example (TypeScript)

```typescript
import { Signer } from "@waves/signer";
import { ProviderKeeper } from "@waves/provider-keeper";
import { RelayerAuthClient, RelayerSession } from "waves-da-sdk";

const RELAYER_URL = "http://localhost:3000";
const NODE_URL = "https://nodes-testnet.wavesnodes.com";

const signer = new Signer({ NODE_URL });
signer.setProvider(new ProviderKeeper());

const authClient = new RelayerAuthClient(RELAYER_URL);
const session = new RelayerSession(); // Saves token to localStorage

async function main() {
  // Step 1: Connect to Keeper
  const signerState = await signer.login();
  const userAddress = signerState.address;

  // Step 2: Get challenge
  const { message } = await authClient.getChallenge(userAddress);

  // Step 3: Sign challenge
  const signature = await signer.signMessage(message);

  // Step 4: Exchange signature for token
  const auth = await authClient.verifySignature({
    eoa: userAddress,
    publicKey: signerState.publicKey,
    message,
    signature,
  });

  // Step 5: Save token
  session.save({
    token: auth.token,
    eoa: auth.eoa,
    expiresAt: auth.expiresAt,
  });

  // Step 6: Use token in invoke
  const token = session.getToken();
  const invokeResult = await fetch(`${RELAYER_URL}/invoke`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({
      eoa: userAddress,
      targetDapp: "3P...",
      function: "myMethod",
      args: [1, "hello"],
    }),
  });

  console.log(await invokeResult.json());
}

main();
```

## Token Lifetime

- **Challenge expires in**: 5 minutes (from `/auth/challenge`)
- **Token expires in**: 24 hours (from `/auth/verify`)

Challenges cannot be reused (one-time use). If a challenge expires, request a new one.

## Security Notes

- **Never share your private key or seed** — signing happens in Keeper, not the relayer
- **Use HTTPS in production** — tokens and messages should only travel over encrypted connections
- **JWT_SECRET must be strong** — Set `JWT_SECRET` in `.env` to a random 32+ character string in production
- **Signature verification is cryptographic** — The relayer verifies that the signature matches the claimed public key and EOA address on the Waves blockchain

## Opt-out (Development Only)

For development without auth, you can patch out the `authMiddleware` check in `routes/invoke.ts`. **Never do this in production.**

---

See also:
- [`QUICKSTART.md`](../docs/QUICKSTART.md) — quick setup guide
- [`../sdk/examples/authFlow.ts`](../sdk/examples/authFlow.ts) — complete working example
