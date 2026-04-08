import "dotenv/config";

/**
 * `refundGuardEnabled` — when true (default), REGULAR calls with `sponsorFee: false`
 * run `POST /debug/validate` on the built tx and require a trace transfer to the
 * relayer matching the fee. Disable only if your node blocks `/debug/validate`.
 */
export const config = {
  port: Number(process.env.PORT || 3000),
  nodeUrl: (process.env.NODE_URL || "https://nodes-testnet.wavesnodes.com").trim(),
  chainId: Number(process.env.CHAIN_ID || 84),
  registryAddress: process.env.REGISTRY_ADDRESS || "",
  relayerSeed: process.env.RELAYER_SEED || "",
  jwtSecret: process.env.JWT_SECRET || "",
  feeRegular: Number(process.env.FEE_REGULAR || 500000),
  feeVerifier: Number(process.env.FEE_VERIFIER || 900000),
  refundGuardEnabled: !["0", "false", "no", "off"].includes(
    (process.env.REFUND_GUARD_ENABLED || "").toLowerCase()
  ),
};

if (!config.registryAddress) throw new Error("Missing REGISTRY_ADDRESS");
if (!config.relayerSeed) throw new Error("Missing RELAYER_SEED");
if (!config.jwtSecret) {
  console.warn(
    "⚠️  JWT_SECRET not set. Using default 'dev-secret-change-in-production'. Set JWT_SECRET in .env for production."
  );
}