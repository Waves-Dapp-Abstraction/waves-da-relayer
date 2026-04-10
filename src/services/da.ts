import { publicKey } from "@waves/ts-lib-crypto";
import { buildInvokeViaDA } from "waves-da-sdk";
import { config } from "../config";
import { getMethodConfig } from "../dappConfig";
import type { InvokeRequestParsed } from "../schemas/invokeSchema";

/**
 * Convert args from JSON format to SDK format
 * - { binary: "base64string" } → Uint8Array
 */
function processArgs(
  args: Array<number | string | boolean | { binary: string }>
): Array<number | string | boolean | Uint8Array> {
  return args.map((arg) => {
    if (arg === null || arg === undefined) {
      throw new Error("Null or undefined arguments not supported");
    }
    if (typeof arg === "object" && "binary" in arg) {
      // Convert base64 to Uint8Array
      const base64Str = arg.binary;
      if (typeof Buffer !== "undefined") {
        return new Uint8Array(Buffer.from(base64Str, "base64"));
      }
      // Browser fallback
      const binaryStr = atob(base64Str);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
      return bytes;
    }
    return arg;
  });
}

export async function buildDaInvokeTx(input: InvokeRequestParsed) {
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

  // Convert binary args from JSON format to SDK format
  const processedArgs = processArgs(input.args);

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
      args: processedArgs,
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