import Fastify from "fastify";
import { publicKey, address } from "@waves/ts-lib-crypto";
import { config } from "./config";
import { registerInvokeRoute } from "./routes/invoke";

console.log("RELAYER_ADDRESS:", address(config.relayerSeed, config.chainId));
console.log("RELAYER_PUBKEY:", publicKey(config.relayerSeed));

const app = Fastify({ logger: true });

app.get("/health", async () => ({ ok: true }));
await registerInvokeRoute(app);

app.get("/info", async () => ({
  ok: true,
  registryAddress: config.registryAddress,
  relayerAddress: address(config.relayerSeed, config.chainId),
  relayerPubKey: publicKey(config.relayerSeed),
}));

app.listen({ port: config.port, host: "0.0.0.0" })
  .then(() => {
    app.log.info(`Relayer listening on :${config.port}`);
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });