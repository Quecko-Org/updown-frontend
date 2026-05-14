"use client";

import { useCallback, useEffect, useState } from "react";
import { postThinWalletProvision, type ProvisionResponse } from "@/lib/api";

/**
 * Phase 4 / Gate ThinWallet — connect-time provisioning hook.
 *
 * Flow:
 *   1. Caller passes the connected EOA + an existing verify-wallet signature
 *      (the same `localStorage.getItem("sign")` value WalletContext stores
 *      during the personal_sign step).
 *   2. Hook POSTs `/thin-wallet/provision` with `{ eoa, signature }`.
 *   3. Backend's relayer fires `factory.deployWallet(eoa)` (idempotent — if
 *      TW already exists at the predicted CREATE2 address, the backend
 *      short-circuits with `deployed: true` and no `txHash`).
 *   4. Hook returns `{ twAddress, isProvisioning, error }`. Caller (typically
 *      WalletContext) writes `twAddress` into the `userSmartAccount` atom
 *      so downstream consumers (TradeForm, DepositModal, Header) route
 *      through the ThinWallet.
 *
 * Gas: zero on the user side. Relayer pays `factory.deployWallet`.
 *
 * Idempotency: safe to call repeatedly. Multiple calls for the same EOA
 * return the same `twAddress`; backend de-dupes concurrent deploys via
 * an in-process lock.
 *
 * Graceful degradation: if the backend's `/config` doesn't expose a
 * `thinWalletFactoryAddress` (e.g. pre-mainnet-deploy chain), caller
 * passes `enabled: false` and the hook stays idle — frontend falls back
 * to Path-1 EOA-direct trading.
 */

export type UseThinWalletResult = {
  /** The user's ThinWallet address. Undefined until provisioning completes. */
  twAddress: `0x${string}` | undefined;
  /** True while the POST /thin-wallet/provision is in flight. */
  isProvisioning: boolean;
  /** Set if provisioning failed; null otherwise. */
  error: Error | null;
  /** True iff backend reports a tx was broadcast (first-time deploy). */
  wasFirstDeploy: boolean;
};

export function useThinWallet(args: {
  eoa: `0x${string}` | undefined;
  verifySignature: string | null;
  /** Set to false to skip provisioning entirely (e.g. factory not deployed). */
  enabled?: boolean;
}): UseThinWalletResult {
  const { eoa, verifySignature, enabled = true } = args;
  const [twAddress, setTwAddress] = useState<`0x${string}` | undefined>(undefined);
  const [isProvisioning, setIsProvisioning] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [wasFirstDeploy, setWasFirstDeploy] = useState(false);

  const provision = useCallback(async () => {
    if (!eoa || !verifySignature) return;
    setError(null);
    setIsProvisioning(true);
    try {
      const result: ProvisionResponse = await postThinWalletProvision({
        eoa,
        signature: verifySignature,
      });
      setTwAddress(result.twAddress);
      setWasFirstDeploy(Boolean(result.txHash));
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setIsProvisioning(false);
    }
  }, [eoa, verifySignature]);

  useEffect(() => {
    if (!enabled) {
      setTwAddress(undefined);
      setError(null);
      setIsProvisioning(false);
      return;
    }
    if (!eoa || !verifySignature) {
      setTwAddress(undefined);
      return;
    }
    void provision();
  }, [enabled, eoa, verifySignature, provision]);

  return { twAddress, isProvisioning, error, wasFirstDeploy };
}
