"use client";

import { useCallback } from "react";
import { signTypedData as signTypedDataViem } from "viem/accounts";
import { getIndexKey } from "@/utils/indexDb";
import { handleCheckSession } from "@/utils/walletHelpers";
import { useSessionPermissions } from "./useSessionPermissions";

interface SessionKeyData {
  privateKey: `0x${string}`;
  permissions: unknown;
}

type TypedData = {
  domain: Record<string, unknown>;
  types: Record<string, ReadonlyArray<{ name: string; type: string }>>;
  primaryType: string;
  message: Record<string, unknown>;
};

/**
 * Signs EIP-712 typed data using the session key (no wallet popup).
 * Mirrors speed-market's pattern of using session key for all transactions.
 */
export function useSessionSign() {
  const { grantPermissions } = useSessionPermissions();

  const signTypedDataAsync = useCallback(
    async (typedData: TypedData): Promise<`0x${string}`> => {
      // Ensure session key exists (grant if expired/missing)
      const needsPermission = await handleCheckSession();
      if (needsPermission) {
        const result = await grantPermissions();
        if (!result) throw new Error("Failed to grant session permissions");
      }

      // Load the session key private key from IndexedDB
      const stored = await getIndexKey<SessionKeyData>("sessionKeyData");
      if (!stored?.privateKey) {
        throw new Error("No session key found");
      }

      // Sign locally with session key — no MetaMask popup
      const signature = await signTypedDataViem({
        privateKey: stored.privateKey,
        domain: typedData.domain,
        types: typedData.types,
        primaryType: typedData.primaryType,
        message: typedData.message,
      } as Parameters<typeof signTypedDataViem>[0]);

      return signature;
    },
    [grantPermissions]
  );

  return { signTypedDataAsync };
}
