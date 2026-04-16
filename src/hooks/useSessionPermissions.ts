import { useAtomValue } from "jotai";
import { userSmartAccount, userSmartAccountClient, apiConfigAtom } from "@/store/atoms";
import { grantScopedSessionIfNeeded } from "@/lib/grantSessionPermissions";
import { SESSION_USDT_ALLOWANCE_BASE_UNITS, SESSION_GAS_LIMIT } from "@/config/environment";

export function useSessionPermissions() {
  const smartAccountClient = useAtomValue(userSmartAccountClient);
  const smartAccount = useAtomValue(userSmartAccount);
  const apiConfig = useAtomValue(apiConfigAtom);

  const grantPermissions = async () => {
    if (!smartAccountClient || !smartAccount || !apiConfig) return null;
    return grantScopedSessionIfNeeded(smartAccountClient, smartAccount, {
      settlementAddress: apiConfig.eip712.domain.verifyingContract,
      usdtAddress: apiConfig.usdtAddress as `0x${string}`,
      usdtAllowance: SESSION_USDT_ALLOWANCE_BASE_UNITS,
      gasLimit: SESSION_GAS_LIMIT,
    });
  };

  return { grantPermissions };
}
