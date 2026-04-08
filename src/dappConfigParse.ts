import type { DappConfig, MethodConfig } from "./dappConfigTypes";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Parse and validate `dappConfig.json` structure. No I/O.
 * @throws if `useOrigin===true` and `sponsorFee===true`, or on invalid shape.
 */
export function parseDappConfig(raw: unknown): DappConfig {
  if (!isPlainObject(raw)) {
    throw new Error("dappConfig root must be a JSON object");
  }

  const out: DappConfig = {};

  for (const [dappAddr, methodsVal] of Object.entries(raw)) {
    if (!isPlainObject(methodsVal)) {
      throw new Error(`dappConfig["${dappAddr}"] must be an object of methods`);
    }

    const methods: Record<string, MethodConfig> = {};

    for (const [methodName, methodVal] of Object.entries(methodsVal)) {
      if (!isPlainObject(methodVal)) {
        throw new Error(`dappConfig["${dappAddr}"]["${methodName}"] must be an object`);
      }

      if (typeof methodVal.useOrigin !== "boolean") {
        throw new Error(
          `dappConfig["${dappAddr}"]["${methodName}"].useOrigin must be a boolean`
        );
      }

      let sponsorFee = false;
      if (methodVal.sponsorFee !== undefined) {
        if (typeof methodVal.sponsorFee !== "boolean") {
          throw new Error(
            `dappConfig["${dappAddr}"]["${methodName}"].sponsorFee must be a boolean`
          );
        }
        sponsorFee = methodVal.sponsorFee;
      }

      if (methodVal.useOrigin && sponsorFee) {
        throw new Error(
          `dappConfig["${dappAddr}"]["${methodName}"]: sponsorFee cannot be true when useOrigin is true (VERIFIER mode; DA pays the fee — relayer sponsorship does not apply)`
        );
      }

      const extraKeys = Object.keys(methodVal).filter(
        (k) => k !== "useOrigin" && k !== "sponsorFee"
      );
      if (extraKeys.length > 0) {
        throw new Error(
          `dappConfig["${dappAddr}"]["${methodName}"]: unknown keys: ${extraKeys.join(", ")}`
        );
      }

      methods[methodName] = { useOrigin: methodVal.useOrigin, sponsorFee };
    }

    out[dappAddr] = methods;
  }

  return out;
}
