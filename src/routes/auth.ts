import type { FastifyInstance } from "fastify";
import {
  generateChallenge,
  generateToken,
  verifyToken,
  verifySignedMessage,
} from "../services/auth";
import type { ChallengeStore } from "../services/challengeStore";
import { ChallengeRequestSchema, AuthVerifyRequestSchema } from "../schemas/authSchema";
import { ErrorCode, makeError } from "../errors";
import { config } from "../config";

// Re-export verifyToken for use in middleware
export { verifyToken };

export async function registerAuthRoutes(
  app: FastifyInstance,
  challengeStore: ChallengeStore
) {
  /**
   * GET /auth/challenge/{eoa}
   * Returns a challenge nonce for the EOA to sign
   */
  app.get<{ Params: { eoa: string } }>("/auth/challenge/:eoa", async (request, reply) => {
    const parsed = ChallengeRequestSchema.safeParse({ eoa: request.params.eoa });
    if (!parsed.success) {
      reply.code(400);
      return makeError(
        ErrorCode.VALIDATION_ERROR,
        "Invalid eoa parameter",
        parsed.error.flatten().fieldErrors
      );
    }

    const { eoa } = parsed.data;
    const { nonce, expiresAt } = generateChallenge();

    await challengeStore.set(nonce, { eoa, expiresAt });

    return {
      ok: true,
      nonce,
      expiresAt,
      message: `Sign this message to authenticate: ${nonce}`,
    };
  });

  /**
   * POST /auth/verify
   * Verify the signed challenge and return a JWT token
   */
  app.post<{ Body: any }>("/auth/verify", async (request, reply) => {
    const parsed = AuthVerifyRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return makeError(
        ErrorCode.VALIDATION_ERROR,
        "Invalid request body",
        parsed.error.flatten().fieldErrors
      );
    }

    const { eoa, publicKey, message, signature } = parsed.data;

    const nonceMatch = message.match(/Sign this message to authenticate: (.+)$/);
    if (!nonceMatch) {
      reply.code(400);
      return makeError(ErrorCode.VALIDATION_ERROR, "Invalid message format");
    }

    const nonce = nonceMatch[1];

    const challenge = await challengeStore.get(nonce);
    if (!challenge) {
      reply.code(401);
      return makeError(ErrorCode.VALIDATION_ERROR, "Challenge not found or expired");
    }

    if (challenge.expiresAt < Date.now()) {
      await challengeStore.delete(nonce);
      reply.code(401);
      return makeError(ErrorCode.VALIDATION_ERROR, "Challenge expired");
    }

    if (challenge.eoa !== eoa) {
      reply.code(401);
      return makeError(ErrorCode.VALIDATION_ERROR, "EOA does not match challenge");
    }

    const isValid = verifySignedMessage({
      eoa,
      publicKey,
      message,
      signature,
      chainId: config.chainId,
    });

    if (!isValid) {
      reply.code(401);
      return makeError(ErrorCode.VALIDATION_ERROR, "Invalid signature");
    }

    await challengeStore.delete(nonce);

    const { token, expiresAt } = generateToken(eoa, publicKey);

    return {
      ok: true,
      token,
      expiresAt,
      eoa,
    };
  });

  /**
   * POST /auth/verify-token
   */
  app.post<{ Body: { token: string } }>("/auth/verify-token", async (request, reply) => {
    const { token } = request.body;

    if (!token || typeof token !== "string") {
      reply.code(400);
      return makeError(ErrorCode.VALIDATION_ERROR, "token must be a non-empty string");
    }

    const result = verifyToken(token);

    if (!result.valid) {
      reply.code(401);
      return makeError(ErrorCode.VALIDATION_ERROR, result.error || "Invalid token");
    }

    return {
      ok: true,
      eoa: result.eoa,
      publicKey: result.publicKey,
    };
  });
}

/**
 * Extract token from Authorization header
 */
export function extractToken(authHeader?: string): string | null {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/);
  return match ? match[1] : null;
}
