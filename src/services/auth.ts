import { verifySignature, address } from "@waves/ts-lib-crypto";
import crypto from "crypto";
import { config } from "../config";

/**
 * Keeper's signMessage format adds a prefix to the message
 */
const KEEPER_MESSAGE_PREFIX = Buffer.from([255, 255, 255, 1]);

/**
 * Generate a challenge nonce for the EOA to sign
 */
export function generateChallenge(): { nonce: string; expiresAt: number } {
  const nonce = crypto.randomBytes(32).toString("hex");
  const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes
  return { nonce, expiresAt };
}

/**
 * Generate a JWT-like token (simple implementation for dev)
 * Format: base64(header.payload.signature)
 */
export function generateToken(eoa: string, publicKey: string): {
  token: string;
  expiresAt: number;
} {
  const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
  const header = Buffer.from(JSON.stringify({ alg: "HMAC", typ: "JWT" })).toString(
    "base64"
  );
  const payload = Buffer.from(
    JSON.stringify({
      eoa,
      publicKey,
      iat: Date.now(),
      exp: expiresAt,
    })
  ).toString("base64");

  // HMAC signature using the configured JWT_SECRET
  const secret = config.jwtSecret || "dev-secret-change-in-production";
  const signature = crypto
    .createHmac("sha256", secret)
    .update(`${header}.${payload}`)
    .digest("base64");

  const token = `${header}.${payload}.${signature}`;
  return { token, expiresAt };
}

/**
 * Verify a JWT token
 */
export function verifyToken(
  token: string
): { valid: boolean; eoa?: string; publicKey?: string; error?: string } {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) {
      return { valid: false, error: "Invalid token format" };
    }

    const [headerB64, payloadB64, signatureB64] = parts;

    // Verify signature using the configured JWT_SECRET
    const secret = config.jwtSecret || "dev-secret-change-in-production";
    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(`${headerB64}.${payloadB64}`)
      .digest("base64");

    if (signatureB64 !== expectedSignature) {
      return { valid: false, error: "Invalid token signature" };
    }

    // Decode and validate payload
    const payload = JSON.parse(Buffer.from(payloadB64, "base64").toString("utf-8"));

    if (payload.exp < Date.now()) {
      return { valid: false, error: "Token expired" };
    }

    return { valid: true, eoa: payload.eoa, publicKey: payload.publicKey };
  } catch (err) {
    return { valid: false, error: `Token verification failed: ${err}` };
  }
}

/**
 * Verify a signed message from Keeper
 * Message format: challenge nonce
 * Signature verification uses Keeper's message prefix
 */
export function verifySignedMessage(params: {
  eoa: string;
  publicKey: string;
  message: string;
  signature: string;
  chainId: number;
}): boolean {
  try {
    // Derive address from public key
    const derivedAddress = address({ publicKey: params.publicKey }, params.chainId);

    if (derivedAddress !== params.eoa) {
      console.warn(
        `Address mismatch: derived ${derivedAddress}, expected ${params.eoa}`
      );
      return false;
    }

    // Prefix message like Keeper does
    const messageBytes = Buffer.from(params.message, "utf-8");
    const prefixedMessage = Buffer.concat([KEEPER_MESSAGE_PREFIX, messageBytes]);

    // Verify signature
    const isValid = verifySignature(params.publicKey, prefixedMessage, params.signature);

    if (!isValid) {
      console.warn(`Signature verification failed for ${params.eoa}`);
    }

    return isValid;
  } catch (err) {
    console.error("Error verifying signature:", err);
    return false;
  }
}
