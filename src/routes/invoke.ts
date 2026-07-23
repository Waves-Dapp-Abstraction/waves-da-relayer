import type { FastifyInstance } from "fastify";
import { address } from "@waves/ts-lib-crypto";
import { buildDaInvokeTx } from "../services/da";
import { broadcastTx } from "../services/broadcaster";
import {
  buildRelayerLowWavesFailure,
  fetchWavesBalance,
  validateRefundOrFail,
} from "../services/refundGuard";
import { config } from "../config";
import { dappConfig, getMethodConfig } from "../dappConfig";
import { ErrorCode, makeError, RelayerError } from "../errors";
import { InvokeRequestSchema } from "../schemas/invokeSchema";
import type { InvokeResponse } from "../types";
import { authMiddleware, type AuthenticatedRequest } from "../middleware/auth";

export async function registerInvokeRoute(app: FastifyInstance) {
  app.post<{ Reply: InvokeResponse }>(
    "/invoke",
    { preHandler: authMiddleware },
    async (request: AuthenticatedRequest, reply) => {
    // --- Input validation ---
    const parsed = InvokeRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return makeError(
        ErrorCode.VALIDATION_ERROR,
        "Invalid request body",
        parsed.error.flatten().fieldErrors
      );
    }

    const body = parsed.data;

    // --- Verify EOA from token matches request ---
    if (request.auth?.eoa !== body.eoa) {
      reply.code(401);
      return makeError(
        ErrorCode.VALIDATION_ERROR,
        `EOA mismatch: token claims ${request.auth?.eoa}, request has ${body.eoa}`
      );
    }

    // --- Whitelist check (dApp level, then method level) ---
    const methodCfg = getMethodConfig(body.targetDapp, body.function);
    if (!methodCfg) {
      const dappExists = body.targetDapp in dappConfig;
      reply.code(403);
      if (!dappExists) {
        return makeError(
          ErrorCode.DAPP_NOT_WHITELISTED,
          `dApp "${body.targetDapp}" is not whitelisted by this relayer`
        );
      }
      return makeError(
        ErrorCode.METHOD_NOT_ALLOWED,
        `Method "${body.function}" is not whitelisted by this relayer for dApp "${body.targetDapp}"`
      );
    }

    // --- Build tx ---
    let tx: any;
    let mode: "regular" | "verifier";
    try {
      ({ tx, mode } = await buildDaInvokeTx(body));
    } catch (e: any) {
      if (e instanceof RelayerError) {
        reply.code(422);
        return makeError(e.code, e.message, e.details);
      }
      if (e?.message?.includes("DA not found") || e?.message?.includes("activeDA")) {
        reply.code(422);
        return makeError(ErrorCode.DA_NOT_FOUND, `No DA wallet found for EOA "${body.eoa}"`);
      }
      reply.code(500);
      return makeError(ErrorCode.BUILD_TX_FAILED, e?.message ?? "Failed to build transaction");
    }

    // Refund guard: REGULAR + non-sponsored → verify trace on node (VERIFIER: DA pays fee)
    if (
      mode === "regular" &&
      !methodCfg.sponsorFee &&
      config.refundGuardEnabled
    ) {
      const relayerAddress = address(config.relayerSeed, config.chainId);
      const txFee = Number((tx as { fee?: number }).fee ?? 0);

      let relayerWavesBalance: number | undefined;
      try {
        relayerWavesBalance = await fetchWavesBalance(config.nodeUrl, relayerAddress);
        if (relayerWavesBalance < txFee) {
          const low = buildRelayerLowWavesFailure(
            relayerAddress,
            relayerWavesBalance,
            txFee
          );
          reply.code(422);
          return makeError(ErrorCode.REFUND_GUARD_FAILED, low.error, low.details);
        }
      } catch (e: unknown) {
        request.log.warn(
          { err: e, relayerAddress },
          "Could not pre-check relayer WAVES balance; continuing with simulation"
        );
      }

      const guard = await validateRefundOrFail({
        nodeUrl: config.nodeUrl,
        tx: tx as Record<string, unknown>,
        relayerAddress,
        relayerWavesBalance,
        expectRefund: true,
      });
      if (!guard.ok) {
        reply.code(422);
        return makeError(ErrorCode.REFUND_GUARD_FAILED, guard.error, guard.details);
      }
    }

    // --- Broadcast ---
    try {
      const result = await broadcastTx(tx);
      return { ok: true, mode, txId: result.id };
    } catch (e: any) {
      const nodeMsg: string =
        e?.response?.data?.message ?? e?.message ?? "Broadcast failed";
      reply.code(502);
      return makeError(ErrorCode.BROADCAST_FAILED, nodeMsg);
    }
  });
}
