import "dotenv/config";
import { readFileSync } from "fs";
import { resolve } from "path";
import { parseDappConfig } from "./dappConfigParse";
import type { MethodConfig } from "./dappConfigTypes";

export type { DappConfig, MethodConfig } from "./dappConfigTypes";

function loadDappConfig() {
  const configPath = process.env.DAPP_CONFIG_PATH
    ? resolve(process.env.DAPP_CONFIG_PATH)
    : resolve(process.cwd(), "dappConfig.json");

  try {
    const raw = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    return parseDappConfig(parsed);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Failed to load dappConfig from "${configPath}": ${msg}`);
  }
}

export const dappConfig = loadDappConfig();

export function getMethodConfig(
  targetDapp: string,
  methodName: string
): MethodConfig | null {
  const dapp = dappConfig[targetDapp];
  if (!dapp) return null;
  const method = dapp[methodName];
  if (!method) return null;
  return method;
}

export { parseDappConfig } from "./dappConfigParse";
