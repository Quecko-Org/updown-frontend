"use client";

import { useAtomValue } from "jotai";
import { encodeFunctionData, parseUnits } from "viem";
import { erc20Abi } from "@/utils/erc20Abi";
import {
  userSmartAccount,
  userSmartAccountClient,
  userPublicClient,
} from "@/store/atoms";
import { useSessionPermissions } from "@/hooks/useSessionPermissions";
import { handleCheckSession } from "@/utils/walletHelpers";
import { usdt_token } from "@/config/environment";
import {
  USDT_DECIMALS,
  USDT_MOCK_VALUE,
  sendGasFeeAsUsdt,
  sendSmartAccountTx,
  isSessionNotFoundError,
  clearStaleSession,
} from "@/utils/transaction";

export interface WithdrawResult {
  receipt: unknown;
  txHash: string | null;
  error: Error | null;
}

/**
 * Speed-market–style withdraw: smart account transfers USDT to `recipientAddress`
 * (typically the user's EOA), with a second call paying gas fee to the paymaster.
 * Signed by the session key — no wallet popup after session grant.
 */
export function useWithdraw() {
  const smartAccount = useAtomValue(userSmartAccount);
  const smartAccountClient = useAtomValue(userSmartAccountClient);
  const publicClient = useAtomValue(userPublicClient);
  const { grantPermissions } = useSessionPermissions();

  const withdraw = async (
    recipientAddress: string,
    amount: number,
    balance: number
  ): Promise<WithdrawResult> => {
    if (!smartAccount || !smartAccountClient || !publicClient) {
      return {
        receipt: null,
        txHash: null,
        error: new Error("Wallet not connected"),
      };
    }

    try {
      const amountInWei = parseUnits(amount.toFixed(6), USDT_DECIMALS);
      const balanceInWei = parseUnits(balance.toFixed(6), USDT_DECIMALS);
      const gasFeeUsdt = USDT_MOCK_VALUE;
      const gasFeeInWei = parseUnits(gasFeeUsdt.toFixed(6), USDT_DECIMALS);

      // If the user tries to withdraw their entire balance, subtract gas fee
      let finalAmountInWei = amountInWei;
      const totalCost = amountInWei + gasFeeInWei;
      if (balanceInWei < totalCost) {
        finalAmountInWei = amountInWei - gasFeeInWei;
        if (finalAmountInWei <= BigInt(0)) {
          return {
            receipt: null,
            txHash: null,
            error: new Error("Insufficient balance to cover gas fees"),
          };
        }
      }

      // Ensure a valid session key is present (may prompt once per 7 days)
      await handleCheckSession();
      const permResult = await grantPermissions();
      if (!permResult) {
        return {
          receipt: null,
          txHash: null,
          error: new Error("Failed to grant session permissions"),
        };
      }
      let { userPermissions: permissions, userSessionKey: sessionKey } = permResult;

      const buildCalls = () => [
        {
          to: usdt_token as `0x${string}`,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: "transfer",
            args: [recipientAddress as `0x${string}`, finalAmountInWei],
          }),
        },
        {
          to: usdt_token as `0x${string}`,
          data: sendGasFeeAsUsdt(gasFeeUsdt),
        },
      ];

      try {
        const { txHash, receipt } = await sendSmartAccountTx({
          calls: buildCalls(),
          smartAccount,
          smartAccountClient: smartAccountClient as Parameters<typeof sendSmartAccountTx>[0]["smartAccountClient"],
          publicClient: publicClient as Parameters<typeof sendSmartAccountTx>[0]["publicClient"],
          permissions,
          sessionKey,
        });
        return { txHash, receipt, error: null };
      } catch (err) {
        // Retry once if the session is reported missing on the backend
        if (isSessionNotFoundError(err)) {
          await clearStaleSession();
          const fresh = await grantPermissions();
          if (!fresh) throw new Error("Failed to refresh session permissions");
          permissions = fresh.userPermissions;
          sessionKey = fresh.userSessionKey;
          const { txHash, receipt } = await sendSmartAccountTx({
            calls: buildCalls(),
            smartAccount,
            smartAccountClient: smartAccountClient as Parameters<typeof sendSmartAccountTx>[0]["smartAccountClient"],
            publicClient: publicClient as Parameters<typeof sendSmartAccountTx>[0]["publicClient"],
            permissions,
            sessionKey,
          });
          return { txHash, receipt, error: null };
        }
        throw err;
      }
    } catch (error) {
      console.error("Withdraw error:", error);
      return {
        receipt: null,
        txHash: null,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  };

  return { withdraw };
}
