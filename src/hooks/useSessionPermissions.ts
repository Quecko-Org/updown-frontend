import { LocalAccountSigner } from "@aa-sdk/core";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { useAtomValue } from "jotai";
import { userSmartAccount, userSmartAccountClient } from "@/store/atoms";
import { getIndexKey, saveIndexKey } from "@/utils/indexDb";
import { handleCheckSession } from "@/utils/walletHelpers";
import { getSessionExpirySec } from "@/config/environment";

export interface SessionResult {
  userPermissions: unknown;
  userSessionKey: LocalAccountSigner<ReturnType<typeof privateKeyToAccount>>;
}

interface SessionKeyData {
  privateKey: `0x${string}`;
  permissions: unknown;
}

/**
 * Mirrors speed-market `useSessionPermissions`:
 * returns session key + permissions for signing transactions via smart account.
 */
export function useSessionPermissions() {
  const smartAccountClient = useAtomValue(userSmartAccountClient);
  const smartAccount = useAtomValue(userSmartAccount);

  const grantPermissions = async (): Promise<SessionResult | undefined> => {
    if (!smartAccountClient || !smartAccount) {
      console.error("smartAccountClient or smartAccount is not ready yet");
      return;
    }

    try {
      const stored = await getIndexKey<SessionKeyData>("sessionKeyData");
      const isSessionExpired = await handleCheckSession();

      if (isSessionExpired) {
        const sessionTime = getSessionExpirySec();
        const privateKey = generatePrivateKey();
        const account = privateKeyToAccount(privateKey);
        const sessionKey = new LocalAccountSigner(account);

        const permissions = await (smartAccountClient as {
          grantPermissions: (p: unknown) => Promise<unknown>;
        }).grantPermissions({
          account: smartAccount,
          expirySec: sessionTime,
          key: {
            publicKey: await sessionKey.getAddress(),
            type: "secp256k1",
          },
          permissions: [{ type: "root" }],
        });

        localStorage.setItem("sessionExpiryTime", String(sessionTime));
        await saveIndexKey("sessionKeyData", { privateKey, permissions });

        return { userPermissions: permissions, userSessionKey: sessionKey };
      } else if (stored) {
        const account = privateKeyToAccount(stored.privateKey);
        const sessionKey = new LocalAccountSigner(account);
        return {
          userPermissions: stored.permissions,
          userSessionKey: sessionKey,
        };
      }
    } catch (error) {
      console.error("Error granting permissions:", error);
    }
  };

  return { grantPermissions };
}
