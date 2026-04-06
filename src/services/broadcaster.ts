import { broadcast } from "@waves/waves-transactions";
import { config } from "../config";

export async function broadcastTx(tx: any) {
  return broadcast(tx, config.nodeUrl);
}