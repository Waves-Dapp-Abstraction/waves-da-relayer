export const ErrorCode = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  METHOD_NOT_ALLOWED: "METHOD_NOT_ALLOWED",
  DAPP_NOT_WHITELISTED: "DAPP_NOT_WHITELISTED",
  DA_NOT_FOUND: "DA_NOT_FOUND",
  BUILD_TX_FAILED: "BUILD_TX_FAILED",
  BROADCAST_FAILED: "BROADCAST_FAILED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  /** debug/validate did not show a matching fee refund to the relayer */
  REFUND_GUARD_FAILED: "REFUND_GUARD_FAILED",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export type ErrorResponse = {
  ok: false;
  code: ErrorCode;
  error: string;
  details?: unknown;
};

export function makeError(
  code: ErrorCode,
  message: string,
  details?: unknown
): ErrorResponse {
  return { ok: false, code, error: message, ...(details !== undefined ? { details } : {}) };
}

export class RelayerError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "RelayerError";
  }
}
