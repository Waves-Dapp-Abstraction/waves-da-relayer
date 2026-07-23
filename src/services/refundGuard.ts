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

export type RefundGuardSubCode =
  | "RELAYER_LOW_WAVES"
  | "DA_LOW_WAVES"
  | "DA_LOW_ASSET"
  | "DAPP_REJECTED"
  | "REFUND_TRACE_MISSING"
  | "SIMULATION_FAILED";

export type RefundGuardDetails = {
  stage: "precheck" | "simulate" | "refund_trace";
  subCode: RefundGuardSubCode;
  /** Short machine-oriented reason */
  reason: string;
  /** Actionable hint for operators / frontends */
  hint: string;
  relayerAddress?: string;
  relayerWavesBalance?: number;
  requiredFee?: number;
  expectedRefund?: { address: string; amount: number; assetId: string | null };
  traceSummary?: Array<{ address: string; amount: number; asset: string | null }>;
  traceError?: string;
  validateResponse?: unknown;
};

export type ValidateRefundOptions = {
  nodeUrl: string;
  /** Signed transaction JSON (e.g. InvokeScript) as returned by the SDK */
  tx: Record<string, unknown>;
  relayerAddress: string;
  /** Relayer WAVES balance in wavelets (optional — improves classification) */
  relayerWavesBalance?: number;
  /** If false, only checks that validate.valid === true (when requireValid) */
  expectRefund?: boolean;
  requireValid?: boolean;
};

export type ValidateRefundResult =
  | { ok: true; trace?: unknown[]; validateResponse?: unknown }
  | { ok: false; error: string; details: RefundGuardDetails };

const VALIDATE_RESPONSE_MAX_CHARS = 4000;
const TRACE_SUMMARY_LIMIT = 20;

export function waveletsToWaves(wavelets: number): string {
  return (wavelets / 1e8).toFixed(8).replace(/\.?0+$/, "") || "0";
}

export function truncateForDetails(value: unknown, maxChars = VALIDATE_RESPONSE_MAX_CHARS): unknown {
  try {
    const text = JSON.stringify(value);
    if (text.length <= maxChars) return value;
    return { _truncated: true, preview: text.slice(0, maxChars) + "…" };
  } catch {
    return { _truncated: true, preview: String(value).slice(0, maxChars) };
  }
}

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
    const assetNorm = t.asset == null ? null : String(t.asset);
    const addr = String(t.address);
    const amount = t.amount as number;
    if (
      addr === relayerAddress &&
      amount === feeAmount &&
      assetNorm === feeAssetIdNorm
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

export function collectTraceTransfers(
  trace: unknown[] | undefined,
  limit = TRACE_SUMMARY_LIMIT
): Array<{ address: string; amount: number; asset: string | null }> {
  const out: Array<{ address: string; amount: number; asset: string | null }> = [];

  function walk(step: Record<string, unknown>) {
    if (out.length >= limit) return;
    const result = step.result as Record<string, unknown> | undefined;
    const transfers = (result?.transfers as Array<Record<string, unknown>> | undefined) ?? [];
    for (const t of transfers) {
      if (out.length >= limit) break;
      out.push({
        address: String(t.address),
        amount: Number(t.amount),
        asset: t.asset == null ? null : String(t.asset),
      });
    }
    const invs = (step.invocations as Record<string, unknown>[] | undefined) ?? [];
    for (const inv of invs) walk(inv);
  }

  for (const step of trace ?? []) {
    if (step && typeof step === "object") walk(step as Record<string, unknown>);
  }
  return out;
}

export function findTraceErrorMessage(trace: unknown[] | undefined): string | undefined {
  let last: string | undefined;

  function walk(step: Record<string, unknown>) {
    const result = step.result as Record<string, unknown> | undefined;
    const err = result?.error as Record<string, unknown> | undefined;
    if (err?.message != null) last = String(err.message);
    if (result?.errorMessage != null) last = String(result.errorMessage);

    const invs = (step.invocations as Record<string, unknown>[] | undefined) ?? [];
    for (const inv of invs) walk(inv);
  }

  for (const step of trace ?? []) {
    if (step && typeof step === "object") walk(step as Record<string, unknown>);
  }
  return last;
}

function responseTextBlob(json: Record<string, unknown>): string {
  return JSON.stringify(json).toLowerCase();
}

/** Classify validate.valid=false using balance, trace, and node payload heuristics. */
export function classifySimulationFailure(opts: {
  validateResponse: Record<string, unknown>;
  trace?: unknown[];
  relayerAddress: string;
  feeAmount: number;
  relayerWavesBalance?: number;
}): Pick<RefundGuardDetails, "subCode" | "reason" | "hint" | "traceError"> {
  const { validateResponse, trace, relayerAddress, feeAmount, relayerWavesBalance } = opts;
  const traceError = findTraceErrorMessage(trace);
  const blob = responseTextBlob(validateResponse);
  const errLower = (traceError ?? "").toLowerCase();

  if (
    relayerWavesBalance !== undefined &&
    relayerWavesBalance < feeAmount
  ) {
    return {
      subCode: "RELAYER_LOW_WAVES",
      reason: "relayer_waves_balance_below_tx_fee",
      hint: `Fund relayer ${relayerAddress} with at least ${waveletsToWaves(feeAmount)} WAVES (balance ${waveletsToWaves(relayerWavesBalance)} WAVES, fee ${waveletsToWaves(feeAmount)} WAVES).`,
      traceError,
    };
  }

  if (
    blob.includes("negative waves balance") ||
    blob.includes("insufficient fee") ||
    (blob.includes("balance") && blob.includes("less than") && blob.includes(relayerAddress.toLowerCase()))
  ) {
    return {
      subCode: "RELAYER_LOW_WAVES",
      reason: "simulation_suggests_relayer_insufficient_waves",
      hint: `Relayer ${relayerAddress} may not have enough WAVES to pay the network fee (${waveletsToWaves(feeAmount)} WAVES). Fund the relayer account and retry.`,
      traceError,
    };
  }

  if (
    errLower.includes("asset") ||
    errLower.includes("payment") ||
    errLower.includes("token") ||
    blob.includes("asset balance") ||
    blob.includes("insufficient asset")
  ) {
    return {
      subCode: "DA_LOW_ASSET",
      reason: "simulation_suggests_da_insufficient_asset",
      hint: "The DA wallet may not hold enough of the required token for this invoke payment. Deposit the asset on the DA and retry.",
      traceError,
    };
  }

  if (
    errLower.includes("waves balance") ||
    errLower.includes("insufficient waves") ||
    blob.includes("negative waves balance") ||
    errLower.includes("reimburse")
  ) {
    return {
      subCode: "DA_LOW_WAVES",
      reason: "simulation_suggests_da_insufficient_waves",
      hint: "The DA wallet may not have enough WAVES to reimburse the relayer fee or pay attached costs. Deposit WAVES on the DA and retry.",
      traceError,
    };
  }

  if (
    traceError ||
    blob.includes("rejected") ||
    blob.includes("throw") ||
    blob.includes("execution failed")
  ) {
    return {
      subCode: "DAPP_REJECTED",
      reason: "target_dapp_or_da_script_rejected_invoke",
      hint: traceError
        ? `On-chain simulation failed: ${traceError}`
        : "The target dApp or DA permissions rejected this invoke. Check approveMethods, payment caps, args, and dApp logic.",
      traceError,
    };
  }

  return {
    subCode: "SIMULATION_FAILED",
    reason: "validate_valid_false",
    hint: traceError
      ? `Transaction simulation failed: ${traceError}`
      : "Transaction would fail on-chain. Inspect validateResponse in details or retry with a funded relayer and DA.",
    traceError,
  };
}

export function buildRelayerLowWavesFailure(
  relayerAddress: string,
  relayerWavesBalance: number,
  requiredFee: number
): { error: string; details: RefundGuardDetails } {
  const error = `Relayer account has insufficient WAVES to pay the network fee. Fund ${relayerAddress} with at least ${waveletsToWaves(requiredFee)} WAVES (current balance ${waveletsToWaves(relayerWavesBalance)} WAVES).`;
  return {
    error,
    details: {
      stage: "precheck",
      subCode: "RELAYER_LOW_WAVES",
      reason: "relayer_waves_balance_below_tx_fee",
      hint: `Fund relayer ${relayerAddress} with WAVES before retrying. Required fee: ${waveletsToWaves(requiredFee)} WAVES.`,
      relayerAddress,
      relayerWavesBalance,
      requiredFee,
    },
  };
}

export async function fetchWavesBalance(
  nodeUrl: string,
  accountAddress: string
): Promise<number> {
  const base = nodeUrl.replace(/\/$/, "");
  const res = await fetch(`${base}/addresses/balance/${accountAddress}`);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`balance HTTP ${res.status}: ${text}`);
  }
  const json = (await res.json()) as { balance?: number };
  return Number(json.balance ?? 0);
}

function buildSimulationFailure(
  validateResponse: Record<string, unknown>,
  trace: unknown[] | undefined,
  relayerAddress: string,
  feeAmount: number,
  relayerWavesBalance?: number
): { error: string; details: RefundGuardDetails } {
  const classified = classifySimulationFailure({
    validateResponse,
    trace,
    relayerAddress,
    feeAmount,
    relayerWavesBalance,
  });

  const error =
    classified.subCode === "RELAYER_LOW_WAVES"
      ? `Relayer account has insufficient WAVES to pay the network fee. Fund ${relayerAddress} with at least ${waveletsToWaves(feeAmount)} WAVES.`
      : classified.subCode === "DA_LOW_WAVES"
        ? "DA wallet has insufficient WAVES for this invoke (fee reimbursement or costs)."
        : classified.subCode === "DA_LOW_ASSET"
          ? "DA wallet has insufficient token balance for this invoke payment."
          : classified.subCode === "DAPP_REJECTED"
            ? classified.hint
            : classified.traceError
              ? `Transaction simulation failed: ${classified.traceError}`
              : "Transaction would fail on-chain during simulation.";

  return {
    error,
    details: {
      stage: "simulate",
      ...classified,
      relayerAddress,
      relayerWavesBalance,
      requiredFee: feeAmount,
      validateResponse: truncateForDetails(validateResponse),
    },
  };
}

function buildRefundTraceMissingFailure(
  relayerAddress: string,
  feeAmount: number,
  feeAssetIdNorm: string | null,
  trace: unknown[] | undefined,
  validateResponse: Record<string, unknown>
): { error: string; details: RefundGuardDetails } {
  const assetLabel = feeAssetIdNorm ?? "WAVES";
  const error = `Refund transfer not found in simulation trace: expected ${waveletsToWaves(feeAmount)} ${assetLabel} to relayer ${relayerAddress}. The DA may not reimburse the relayer fee (check DA WAVES balance and reimburseFee behavior).`;

  return {
    error,
    details: {
      stage: "refund_trace",
      subCode: "REFUND_TRACE_MISSING",
      reason: "expected_relayer_refund_not_in_trace",
      hint: `Ensure the DA wallet holds enough WAVES to refund the relayer fee (${waveletsToWaves(feeAmount)} ${assetLabel}) when using REGULAR mode with reimburseFee.`,
      relayerAddress,
      requiredFee: feeAmount,
      expectedRefund: {
        address: relayerAddress,
        amount: feeAmount,
        assetId: feeAssetIdNorm,
      },
      traceSummary: collectTraceTransfers(trace),
      traceError: findTraceErrorMessage(trace),
      validateResponse: truncateForDetails(validateResponse),
    },
  };
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
    relayerWavesBalance,
    requireValid = true,
    expectRefund = true,
  } = opts;

  if (!nodeUrl) {
    return {
      ok: false,
      error: "Refund guard misconfigured: missing nodeUrl",
      details: {
        stage: "simulate",
        subCode: "SIMULATION_FAILED",
        reason: "missing_node_url",
        hint: "Configure NODE_URL on the relayer.",
      },
    };
  }
  if (!tx || typeof tx !== "object") {
    return {
      ok: false,
      error: "Refund guard failed: missing transaction",
      details: {
        stage: "simulate",
        subCode: "SIMULATION_FAILED",
        reason: "missing_tx",
        hint: "Internal error building invoke transaction.",
      },
    };
  }
  if (!relayerAddress) {
    return {
      ok: false,
      error: "Refund guard misconfigured: missing relayer address",
      details: {
        stage: "simulate",
        subCode: "SIMULATION_FAILED",
        reason: "missing_relayer_address",
        hint: "Configure RELAYER_SEED on the relayer.",
      },
    };
  }

  if (typeof tx.fee !== "number") {
    return {
      ok: false,
      error: "Refund guard failed: transaction fee missing",
      details: {
        stage: "simulate",
        subCode: "SIMULATION_FAILED",
        reason: "tx_fee_missing",
        hint: "Internal error building invoke transaction.",
      },
    };
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
    return {
      ok: false,
      error: `Simulation request failed (HTTP ${res.status})`,
      details: {
        stage: "simulate",
        subCode: "SIMULATION_FAILED",
        reason: `debug_validate_http_${res.status}`,
        hint: "The Waves node rejected /debug/validate. Check NODE_URL or set REFUND_GUARD_ENABLED=false if the node disables debug routes.",
        validateResponse: truncateForDetails(text),
      },
    };
  }

  const json = (await res.json()) as {
    valid?: boolean;
    trace?: Record<string, unknown>[];
    [key: string]: unknown;
  };

  if (requireValid && !json.valid) {
    const failure = buildSimulationFailure(
      json,
      json.trace,
      relayerAddress,
      feeAmount,
      relayerWavesBalance
    );
    return { ok: false, ...failure };
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
    const failure = buildRefundTraceMissingFailure(
      relayerAddress,
      feeAmount,
      feeAssetIdNorm,
      trace,
      json
    );
    return { ok: false, ...failure };
  }

  return { ok: true, trace, validateResponse: json };
}
