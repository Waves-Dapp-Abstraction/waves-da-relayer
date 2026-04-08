/**

 * Per dApp / per method relayer policy.

 *

 * - `useOrigin` — false = REGULAR (relayer sends tx; optional fee refund to relayer).

 *   true = VERIFIER (DA sends; `sponsorFee` must not be true).

 * - `sponsorFee` — when true in REGULAR mode, the relayer pays the network fee without

 *   requiring a refund from the DA (no refund guard). When false (default), the relayer

 *   sets `reimburseFee=true` on the built tx and may run the refund guard (if enabled).

 */

export type MethodConfig = {

  useOrigin: boolean;

  sponsorFee: boolean;

};



export type DappConfig = {

  [dappAddress: string]: {

    [methodName: string]: MethodConfig;

  };

};

