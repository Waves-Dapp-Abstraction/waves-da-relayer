// Relayer types

export type InvokeResponse = {
  ok: true;
  mode: "regular" | "verifier";
  txId: string;
} | {
  ok: false;
  code: string;
  error: string;
  details?: Record<string, unknown>;
};

// Authentication types
export type AuthChallenge = {
  nonce: string;
  expiresAt: number;
};

export type AuthSession = {
  eoa: string;
  publicKey: string;
  token: string;
  expiresAt: number;
};

export type AuthRequest = {
  eoa: string;
  publicKey: string;
  message: string;
  signature: string;
};
