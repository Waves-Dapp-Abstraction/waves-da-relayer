export type InvokeRequest = {
  eoa: string;
  targetDapp: string;
  function: string;
  args: Array<number | string | boolean>;
  payments?: Array<{
    assetId?: string;
    amount: number;
  }>;
  useOrigin: boolean;
  reimburseFee?: boolean;
};

export type InvokeResponse =
  | {
      ok: true;
      mode: "regular" | "verifier";
      txId: string;
    }
  | {
      ok: false;
      error: string;
    };