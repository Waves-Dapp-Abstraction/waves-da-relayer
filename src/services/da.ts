import { publicKey } from "@waves/ts-lib-crypto";
import { buildInvokeViaDA } from "waves-da-sdk";
import type { ProxyArg, ScalarArg } from "waves-da-sdk";
import { config } from "../config";
import { getMethodConfig } from "../dappConfig";
import type { InvokeRequestParsed } from "../schemas/invokeSchema";

/**
 * Convert a base64 string from the HTTP API into a Uint8Array for the SDK.
 */
function base64ToUint8Array(b64: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(b64, "base64"));
  }
  const binaryStr = atob(b64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  return bytes;
}

/**
 * Convert a single scalar arg from JSON wire format to SDK format:
 *   { binary: "base64..." } → Uint8Array
 *   number | string | boolean → pass through
 */
function convertScalar(arg: number | string | boolean | { binary: string }): ScalarArg {
  if (typeof arg === "object" && "binary" in arg) {
    return base64ToUint8Array(arg.binary);
  }
  return arg;
}

/**
 * Convert all args from JSON wire format to SDK format.
 *   { binary: "base64..." }  → Uint8Array           (ByteVector)
 *   { list: [...scalars] }   → ScalarArg[]           (List)
 *   number | string | boolean → pass through
 */
function processArgs(
  args: Array<number | string | boolean | { binary: string } | { list: Array<number | string | boolean | { binary: string }> }>
): ProxyArg[] {
  return args.map((arg) => {
    if (typeof arg === "object" && "list" in arg) {
      return arg.list.map(convertScalar);
    }
    return convertScalar(arg as number | string | boolean | { binary: string });
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
