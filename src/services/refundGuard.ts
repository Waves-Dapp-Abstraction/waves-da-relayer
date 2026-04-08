/**
 * Refund guard: validates a signed InvokeScript tx via `POST /debug/validate` and checks
 * that the execution trace contains a transfer to the relayer matching the tx fee
 * (same amount and fee asset). This is stronger than trusting `reimburseFee` alone,
 * because a malicious or buggy DA script could ignore that flag.
 *
 * **Node requirement:** the Waves node must expose `POST /debug/validate` (most public
 * testnet nodes do; some restricted deployments may disable debug routes — set
 * `REFUND_GUARD_ENABLED=false` in that case, knowing you lose on-chain proof of refund).
 */

export type ValidateRefundOptions = {
  nodeUrl: string;
  /** Signed transaction JSON (e.g. InvokeScript) as returned by the SDK */
  tx: Record<string, unknown>;
  relayerAddress: string;
  /** If false, only checks that validate.valid === true (when requireValid) */
  expectRefund?: boolean;
  requireValid?: boolean;
};

export type ValidateRefundResult =
  | { ok: true; trace?: unknown[]; validateResponse?: unknown }
  | {
      ok: false;
      reason: string;
      trace?: unknown[];
      validateResponse?: unknown;
    };

function normalizeFeeAsset(feeAssetId: unknown): string | null {
  return feeAssetId == null ? null : String(feeAssetId);
}

function traceHasRefund(
  step: Record<string, unknown>,
  relayerAddress: string,
  feeAmount: number,
  feeAssetIdNorm: string | null
): boolean {
  const result = step.result as Record<string, unknown> | undefined;
  const transfers = (result?.transfers as Array<Record<string, unknown>> | undefined) ?? [];
  for (const t of transfers) {
    const assetNorm = t.asset == null ? null : t.asset;
    const addr = String(t.address);
    const amount = t.amount as number;
    if (
      addr === relayerAddress &&
      amount === feeAmount &&
      (assetNorm == null ? null : String(assetNorm)) === feeAssetIdNorm
    ) {
      return true;
    }
  }

  const invs = (step.invocations as Record<string, unknown>[] | undefined) ?? [];
  for (const inv of invs) {
    if (traceHasRefund(inv, relayerAddress, feeAmount, feeAssetIdNorm)) return true;
  }
  return false;
}

/**
 * Validate an InvokeScript tx via the node's `/debug/validate` and optionally require
 * a fee refund ScriptTransfer to the relayer in the trace.
 */
export async function validateRefundOrFail(
  opts: ValidateRefundOptions
): Promise<ValidateRefundResult> {
  const {
    nodeUrl,
    tx,
    relayerAddress,
    requireValid = true,
    expectRefund = true,
  } = opts;

  if (!nodeUrl) return { ok: false, reason: "Missing nodeUrl" };
  if (!tx || typeof tx !== "object") return { ok: false, reason: "Missing tx" };
  if (!relayerAddress) return { ok: false, reason: "Missing relayerAddress" };

  if (typeof tx.fee !== "number") {
    return { ok: false, reason: "tx.fee missing or invalid" };
  }

  const feeAmount = tx.fee;
  const feeAssetIdNorm = normalizeFeeAsset(tx.feeAssetId);

  const base = nodeUrl.replace(/\/$/, "");
  const res = await fetch(`${base}/debug/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(tx),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, reason: `debug/validate HTTP ${res.status}: ${text}` };
  }

  const json = (await res.json()) as {
    valid?: boolean;
    trace?: Record<string, unknown>[];
    [key: string]: unknown;
  };

  if (requireValid && !json.valid) {
    return {
      ok: false,
      reason: "Transaction would fail on-chain (validate.valid=false)",
      validateResponse: json,
    };
  }

  if (!expectRefund) {
    return { ok: true, trace: json.trace, validateResponse: json };
  }

  const trace = json.trace ?? [];
  let found = false;
  for (const step of trace) {
    if (traceHasRefund(step, relayerAddress, feeAmount, feeAssetIdNorm)) {
      found = true;
      break;
    }
  }

  if (!found) {
    return {
      ok: false,
      reason: `Refund transfer not found in trace: expected transfer to ${relayerAddress} for amount=${feeAmount} (fee asset: ${feeAssetIdNorm ?? "WAVES"})`,
      trace,
      validateResponse: json,
    };
  }

  return { ok: true, trace, validateResponse: json };
}
