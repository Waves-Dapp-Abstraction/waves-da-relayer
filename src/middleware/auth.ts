import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { verifyToken, extractToken } from "../routes/auth";
import { ErrorCode, makeError } from "../errors";

export interface AuthenticatedRequest extends FastifyRequest {
  auth?: {
    eoa: string;
    publicKey: string;
  };
}

/**
 * Middleware to verify Bearer token in Authorization header
 * Attaches auth info to request if valid
 * Returns 401 if token is missing or invalid
 */
export async function authMiddleware(
  request: AuthenticatedRequest,
  reply: FastifyReply
) {
  const authHeader = request.headers.authorization;
  const token = extractToken(authHeader);

  if (!token) {
    reply.code(401);
    return reply.send(
      makeError(ErrorCode.VALIDATION_ERROR, "Missing Authorization header with Bearer token")
    );
  }

  const result = verifyToken(token);

  if (!result.valid) {
    reply.code(401);
    return reply.send(
      makeError(ErrorCode.VALIDATION_ERROR, result.error || "Invalid token")
    );
  }

  // Attach authenticated user info to request
  request.auth = {
    eoa: result.eoa!,
    publicKey: result.publicKey!,
  };
}

/**
 * Register auth middleware for protected routes
 */
export function registerAuthMiddleware(app: FastifyInstance) {
  // You can use this to protect specific routes by adding it as a preHandler
  // Example: app.post<{ Body: any }>("/invoke", { preHandler: authMiddleware }, async (request, reply) => { ... })
  return authMiddleware;
}
