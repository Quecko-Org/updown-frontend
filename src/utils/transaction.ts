import { encodeFunctionData, parseUnits } from "viem";
import { signPreparedCalls } from "@account-kit/wallet-client";
import { erc20Abi } from "./erc20Abi";
import { usdt_token, PAYMASTER_ADDRESS } from "@/config/environment";
import { saveIndexKey } from "./indexDb";

export const USDT_DECIMALS = 6;
export const USDT_MOCK_VALUE = 0.2;

/** Encodes a USDT transfer to the paymaster for gas fee payment. */
export function sendGasFeeAsUsdt(usdtForGas: number): `0x${string}` {
  const amountInWei = parseUnits(usdtForGas.toFixed(6), USDT_DECIMALS);
  return encodeFunctionData({
    abi: erc20Abi,
    functionName: "transfer",
    args: [PAYMASTER_ADDRESS as `0x${string}`, amountInWei],
  });
}

type SmartAccountClient = {
  prepareCalls: (p: unknown) => Promise<unknown>;
  sendPreparedCalls: (p: unknown) => Promise<{ preparedCallIds: string[] }>;
  getCallsStatus: (id: string) => Promise<Record<string, unknown>>;
};

type PublicClientLike = {
  getTransactionReceipt: (p: { hash: string }) => Promise<unknown>;
};

/** Poll smart account client for tx hash, then public client for receipt. */
export async function getTxHashAndReceipt({
  preparedCallId,
  smartAccountClient,
  publicClient,
  timeout = 60_000,
  interval = 2000,
}: {
  preparedCallId: string;
  smartAccountClient: SmartAccountClient;
  publicClient: PublicClientLike;
  timeout?: number;
  interval?: number;
}) {
  const startTime = Date.now();
  let txHash: string | null = null;

  while (Date.now() - startTime < timeout) {
    const status = (await smartAccountClient.getCallsStatus(preparedCallId)) as Record<
      string,
      unknown
    >;
    const possibleHashes = [
      status.transactionHash,
      status.txHash,
      status.hash,
      (status.receipt as { transactionHash?: string } | undefined)?.transactionHash,
      (status.receipts as { transactionHash?: string }[] | undefined)?.[0]?.transactionHash,
      (status.userOperationReceipt as { transactionHash?: string } | undefined)
        ?.transactionHash,
      (status.result as { transactionHash?: string } | undefined)?.transactionHash,
      (status.data as { transactionHash?: string } | undefined)?.transactionHash,
    ].filter(Boolean) as string[];
    txHash = possibleHashes[0] ?? null;
    if (txHash) break;
    await new Promise((r) => setTimeout(r, interval));
  }

  if (!txHash) throw new Error("Transaction hash not found within timeout");

  let receipt: unknown = null;
  const receiptStart = Date.now();
  while (Date.now() - receiptStart < timeout) {
    try {
      receipt = await publicClient.getTransactionReceipt({ hash: txHash });
      if (receipt) break;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, interval));
  }

  if (!receipt) throw new Error("Transaction receipt not found within timeout");

  return { txHash, receipt };
}

/** Prepare + sign (with session key) + send a batch of calls via smart account. */
export async function sendSmartAccountTx({
  calls,
  smartAccount,
  smartAccountClient,
  publicClient,
  permissions,
  sessionKey,
}: {
  calls: { to: `0x${string}`; data: `0x${string}` }[];
  smartAccount: string;
  smartAccountClient: SmartAccountClient;
  publicClient: PublicClientLike;
  permissions: unknown;
  sessionKey: unknown;
}) {
  const preparedCalls = await smartAccountClient.prepareCalls({
    calls,
    from: smartAccount,
    capabilities: { permissions },
  });

  const signedCalls = await signPreparedCalls(
    sessionKey as Parameters<typeof signPreparedCalls>[0],
    preparedCalls as Parameters<typeof signPreparedCalls>[1]
  );

  const sendResult = await smartAccountClient.sendPreparedCalls({
    ...(signedCalls as object),
    capabilities: { permissions },
  });

  const { preparedCallIds } = sendResult;

  const { txHash, receipt } = await getTxHashAndReceipt({
    preparedCallId: preparedCallIds[0],
    smartAccountClient,
    publicClient,
  });

  return { txHash, receipt };
}

export function isSessionNotFoundError(error: unknown): boolean {
  const err = error as { message?: string; details?: string };
  const message = err?.message || err?.details || "";
  return message.includes("Session not found");
}

export async function clearStaleSession() {
  localStorage.removeItem("sessionExpiryTime");
  await saveIndexKey("sessionKeyData", null);
}
