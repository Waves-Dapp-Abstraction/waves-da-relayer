import "dotenv/config";

export const config = {
  port: Number(process.env.PORT || 3000),
  nodeUrl: (process.env.NODE_URL || "https://nodes-testnet.wavesnodes.com").trim(),
  chainId: Number(process.env.CHAIN_ID || 84),
  registryAddress: process.env.REGISTRY_ADDRESS || "",
  relayerSeed: process.env.RELAYER_SEED || "",
  feeRegular: Number(process.env.FEE_REGULAR || 500000),
  feeVerifier: Number(process.env.FEE_VERIFIER || 900000),
};

if (!config.registryAddress) throw new Error("Missing REGISTRY_ADDRESS");
if (!config.relayerSeed) throw new Error("Missing RELAYER_SEED");