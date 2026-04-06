import type { FastifyInstance } from "fastify";
import { buildDaInvokeTx } from "../services/da";
import { broadcastTx } from "../services/broadcaster";
import type { InvokeRequest, InvokeResponse } from "../types";

export async function registerInvokeRoute(app: FastifyInstance) {
  app.post<{ Body: InvokeRequest; Reply: InvokeResponse }>("/invoke", async (request, reply) => {
    try {
      const body = request.body;

      if (!body.eoa || !body.targetDapp || !body.function) {
        reply.code(400);
        return { ok: false, error: "Missing required fields" };
      }

      const { tx, mode } = await buildDaInvokeTx(body);
      const result = await broadcastTx(tx);

      return {
        ok: true,
        mode,
        txId: result.id,
      };
    } catch (e: any) {
      reply.code(500);
      return {
        ok: false,
        error: e?.message || "Unknown error",
      };
    }
  });
}