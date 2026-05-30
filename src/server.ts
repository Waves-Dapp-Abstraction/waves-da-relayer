import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { publicKey, address } from "@waves/ts-lib-crypto";
import { config } from "./config";
import { registerInvokeRoute } from "./routes/invoke";
import { registerAuthRoutes } from "./routes/auth";
import { ErrorCode, makeError } from "./errors";
import { getChallengeStore, closeChallengeStore } from "./services/challengeStore";

const app = Fastify({ logger: true });

const challengeStore = await getChallengeStore(config.redisUrl);

// --- CORS ---
await app.register(cors, {
  origin: config.corsOrigins,
  credentials: true,
});

// --- Rate limiting (global; stricter on auth/invoke via route hooks if needed) ---
await app.register(rateLimit, {
  max: config.rateLimitMax,
  timeWindow: config.rateLimitWindowMs,
  keyGenerator: (request) => request.ip,
});

// --- Global error handler ---
app.setErrorHandler((err: unknown, _request, reply) => {
  const error = err as { statusCode?: number; message?: string };
  if (error.statusCode === 400 && error.message?.includes("JSON")) {
    reply.code(400).send(makeError(ErrorCode.VALIDATION_ERROR, "Malformed JSON body"));
    return;
  }
  app.log.error(err);
  reply
    .code(500)
    .send(makeError(ErrorCode.INTERNAL_ERROR, error.message ?? "Unexpected server error"));
});

// --- Routes ---
app.get("/health", async () => ({ ok: true }));

app.get("/info", async () => ({
  ok: true,
  registryAddress: config.registryAddress,
  relayerAddress: address(config.relayerSeed, config.chainId),
  relayerPubKey: publicKey(config.relayerSeed),
  chainId: config.chainId,
  production: config.production,
}));

await registerAuthRoutes(app, challengeStore);
await registerInvokeRoute(app);

console.log("RELAYER_ADDRESS:", address(config.relayerSeed, config.chainId));
console.log("RELAYER_PUBKEY:", publicKey(config.relayerSeed));
if (config.production) {
  console.log("PRODUCTION mode: JWT_SECRET and CORS_ORIGINS enforced");
}

const shutdown = async () => {
  await closeChallengeStore();
  await app.close();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

app.listen({ port: config.port, host: "0.0.0.0" }).then(() => {
  app.log.info(`Relayer listening on :${config.port} (chainId=${config.chainId})`);
}).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
