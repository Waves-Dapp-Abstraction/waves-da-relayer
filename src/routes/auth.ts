import type { FastifyInstance } from "fastify";
import {
  generateChallenge,
  generateToken,
  verifyToken,
  verifySignedMessage,
} from "../services/auth";
import { ChallengeRequestSchema, AuthVerifyRequestSchema } from "../schemas/authSchema";
import { ErrorCode, makeError } from "../errors";
import { config } from "../config";

/**
 * In-memory challenge store (use Redis in production)
 * Maps: nonce -> { eoa, expiresAt }
 */
const challengeStore = new Map<string, { eoa: string; expiresAt: number }>();

/**
 * Cleanup expired challenges periodically
 */
setInterval(() => {
  const now = Date.now();
  for (const [nonce, data] of challengeStore.entries()) {
    if (data.expiresAt < now) {
      challengeStore.delete(nonce);
    }
  }
}, 60000); // Clean every minute

export async function registerAuthRoutes(app: FastifyInstance) {
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

    // Store challenge
    challengeStore.set(nonce, { eoa, expiresAt });

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
  app.post<{ Body: any }>(
    "/auth/verify",
    async (request, reply) => {
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

      // Extract nonce from message
      const nonceMatch = message.match(/Sign this message to authenticate: (.+)$/);
      if (!nonceMatch) {
        reply.code(400);
        return makeError(ErrorCode.VALIDATION_ERROR, "Invalid message format");
      }

      const nonce = nonceMatch[1];

      // Check if challenge exists and is not expired
      const challenge = challengeStore.get(nonce);
      if (!challenge) {
        reply.code(401);
        return makeError(ErrorCode.VALIDATION_ERROR, "Challenge not found or expired");
      }

      if (challenge.expiresAt < Date.now()) {
        challengeStore.delete(nonce);
        reply.code(401);
        return makeError(ErrorCode.VALIDATION_ERROR, "Challenge expired");
      }

      if (challenge.eoa !== eoa) {
        reply.code(401);
        return makeError(
          ErrorCode.VALIDATION_ERROR,
          "EOA does not match challenge"
        );
      }

      // Verify the signature
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

      // Consume the challenge (prevent replay)
      challengeStore.delete(nonce);

      // Generate JWT token
      const { token, expiresAt } = generateToken(eoa, publicKey);

      return {
        ok: true,
        token,
        expiresAt,
        eoa,
      };
    }
  );

  /**
   * POST /auth/verify-token
   * Verify a token (for client-side verification before sending requests)
   */
  app.post<{ Body: { token: string } }>(
    "/auth/verify-token",
    async (request, reply) => {
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
    }
  );
}

/**
 * Extract token from Authorization header
 */
export function extractToken(authHeader?: string): string | null {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/);
  return match ? match[1] : null;
}
