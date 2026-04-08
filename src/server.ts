import Fastify from "fastify";
import cors from "@fastify/cors";
import { publicKey, address } from "@waves/ts-lib-crypto";
import { config } from "./config";
import { registerInvokeRoute } from "./routes/invoke";
import { registerAuthRoutes } from "./routes/auth";
import { ErrorCode, makeError } from "./errors";

const app = Fastify({ logger: true });

// --- CORS ---
await app.register(cors, {
  origin: true, // Allow all origins (change to specific URLs in production)
});

// --- Global error handler ---
// Catches unhandled errors and Fastify's own parse/validation errors (e.g. malformed JSON)
app.setErrorHandler((err: unknown, _request, reply) => {
  const error = err as { statusCode?: number; message?: string };
  // Fastify's built-in JSON parse error
  if (error.statusCode === 400 && error.message?.includes("JSON")) {
    reply.code(400).send(makeError(ErrorCode.VALIDATION_ERROR, "Malformed JSON body"));
    return;
  }
  // Any other unhandled error
  app.log.error(err);
  reply.code(500).send(makeError(ErrorCode.INTERNAL_ERROR, error.message ?? "Unexpected server error"));
});

// --- Routes ---
app.get("/health", async () => ({ ok: true }));

app.get("/info", async () => ({
  ok: true,
  registryAddress: config.registryAddress,
  relayerAddress: address(config.relayerSeed, config.chainId),
  relayerPubKey: publicKey(config.relayerSeed),
}));

// Auth routes (public)
await registerAuthRoutes(app);

// Protected routes (require Bearer token)
await registerInvokeRoute(app);

// --- Start ---
console.log("RELAYER_ADDRESS:", address(config.relayerSeed, config.chainId));
console.log("RELAYER_PUBKEY:", publicKey(config.relayerSeed));

app.listen({ port: config.port, host: "0.0.0.0" })
  .then(() => {
    app.log.info(`Relayer listening on :${config.port}`);
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
