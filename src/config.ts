import "dotenv/config";

function parseBool(v: string | undefined, defaultValue: boolean): boolean {
  if (v === undefined || v === "") return defaultValue;
  return !["0", "false", "no", "off"].includes(v.toLowerCase());
}

function parseCorsOrigins(raw: string | undefined): string[] | true {
  const trimmed = (raw ?? "").trim();
  if (!trimmed || trimmed === "*") return true;
  const list = trimmed
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length > 0 ? list : true;
}

const production = parseBool(process.env.PRODUCTION, false);

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
  refundGuardEnabled: parseBool(process.env.REFUND_GUARD_ENABLED, true),
  production,
  redisUrl: (process.env.REDIS_URL || "").trim(),
  corsOrigins: parseCorsOrigins(process.env.CORS_ORIGINS),
  rateLimitMax: Number(process.env.RATE_LIMIT_MAX || 100),
  rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000),
};

if (!config.registryAddress) throw new Error("Missing REGISTRY_ADDRESS");
if (!config.relayerSeed) throw new Error("Missing RELAYER_SEED");

if (production) {
  if (!config.jwtSecret || config.jwtSecret.length < 32) {
    throw new Error(
      "PRODUCTION=true requires JWT_SECRET (32+ random characters). See relayer/.env.mainnet.example"
    );
  }
  if (config.corsOrigins === true) {
    throw new Error(
      "PRODUCTION=true requires CORS_ORIGINS (comma-separated HTTPS origins, not *)"
    );
  }
  if (!config.redisUrl) {
    console.warn(
      "⚠️  PRODUCTION=true without REDIS_URL — auth challenges are in-memory (not safe for multiple instances)"
    );
  }
} else if (!config.jwtSecret) {
  console.warn(
    "⚠️  JWT_SECRET not set. Using default 'dev-secret-change-in-production'. Set JWT_SECRET in .env for production."
  );
}
