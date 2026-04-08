import { publicKey } from "@waves/ts-lib-crypto";
import { buildInvokeViaDA } from "waves-da-sdk";
import { config } from "../config";
import { getMethodConfig } from "../dappConfig";
import type { InvokeRequest } from "../types";

export async function buildDaInvokeTx(input: InvokeRequest) {
  const methodCfg = getMethodConfig(input.targetDapp, input.function);
  if (!methodCfg) {
    throw new Error(
      `dApp "${input.targetDapp}" or method "${input.function}" is not whitelisted in relayer config`
    );
  }

  const useVerifierMode = methodCfg.useVerifierMode;
  const relayerPubKey = publicKey(config.relayerSeed);

  // Policy from dappConfig only — clients cannot choose (would let a malicious client skip DA fee refund).
  const reimburseFee = !methodCfg.useVerifierMode && !methodCfg.sponsorFee;

  const tx = await buildInvokeViaDA(
    config.nodeUrl,
    {
      chainId: config.chainId,
      registry: config.registryAddress,
      eoa: input.eoa,
      useVerifierMode,
      feeRegular: config.feeRegular,
      feeVerifier: config.feeVerifier,
    },
    {
      targetDapp: input.targetDapp,
      function: input.function,
      args: input.args,
      reimburseFee,
      payments: input.payments ?? [],
      relayerPubKeyBase58: useVerifierMode ? relayerPubKey : "",
    },
    config.relayerSeed
  );

  return {
    tx,
    mode: (useVerifierMode ? "verifier" : "regular") as "verifier" | "regular",
  };
}