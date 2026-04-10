import { useAtomValue } from "jotai";
import { userSmartAccount, userSmartAccountClient } from "@/store/atoms";
import { grantRootSessionIfNeeded } from "@/lib/grantSessionPermissions";

/**
 * Mirrors speed-market `useSessionPermissions`: re-grant root session when needed.
 */
export function useSessionPermissions() {
  const smartAccountClient = useAtomValue(userSmartAccountClient);
  const smartAccount = useAtomValue(userSmartAccount);

  const grantPermissions = async () => {
    await grantRootSessionIfNeeded(smartAccountClient, smartAccount);
  };

  return { grantPermissions };
}
