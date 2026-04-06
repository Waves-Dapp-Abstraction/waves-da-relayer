import { publicKey } from "@waves/ts-lib-crypto";
import { buildInvokeViaDA } from "waves-da-sdk";
import { config } from "../config";
import type { InvokeRequest } from "../types";

export async function buildDaInvokeTx(input: InvokeRequest) {
  const relayerPubKey = publicKey(config.relayerSeed);

  const tx = await buildInvokeViaDA(
    config.nodeUrl,
    {
      chainId: config.chainId,
      registry: config.registryAddress,
      eoa: input.eoa,
      useOrigin: input.useOrigin,
      feeRegular: config.feeRegular,
      feeVerifier: config.feeVerifier,
    },
    {
      targetDapp: input.targetDapp,
      function: input.function,
      args: input.args,
      reimburseFee: input.reimburseFee ?? false,
      payments: input.payments ?? [],
      relayerPubKeyBase58: input.useOrigin ? relayerPubKey : "",
    },
    config.relayerSeed
  );

  return {
    tx,
    mode: input.useOrigin ? "verifier" : "regular" as const,
  };
}