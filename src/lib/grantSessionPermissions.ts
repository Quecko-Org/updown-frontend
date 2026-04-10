import { LocalAccountSigner } from "@aa-sdk/core";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { getSessionExpirySec } from "@/config/environment";
import { saveIndexKey, getIndexKey } from "@/utils/indexDb";
import { handleCheckSession } from "@/utils/walletHelpers";

export type SessionKeyData = {
  privateKey: `0x${string}`;
  permissions: unknown;
};

type GrantClient = {
  grantPermissions: (p: {
    account: string;
    expirySec: number;
    key: { publicKey: string; type: string };
    permissions: { type: string }[];
  }) => Promise<unknown>;
};

/**
 * Root session + IndexedDB persistence (speed-market `useSessionPermissions`).
 */
export async function grantRootSessionIfNeeded(
  smartAccountClient: unknown,
  smartAccount: string
): Promise<void> {
  if (!smartAccountClient || !smartAccount) return;

  try {
    const stored = await getIndexKey<SessionKeyData>("sessionKeyData");
    const isSessionExpired = await handleCheckSession();

    if (isSessionExpired) {
      const expirySec = getSessionExpirySec();
      const privateKey = generatePrivateKey();
      const account = privateKeyToAccount(privateKey);
      const sessionKey = new LocalAccountSigner(account);

      const permissions = await (smartAccountClient as GrantClient).grantPermissions({
        account: smartAccount,
        expirySec,
        key: {
          publicKey: await sessionKey.getAddress(),
          type: "secp256k1",
        },
        permissions: [{ type: "root" }],
      });

      localStorage.setItem("sessionExpiryTime", String(expirySec));
      await saveIndexKey("sessionKeyData", { privateKey, permissions });
    } else if (stored) {
      // Valid session key already in IDB
    }
  } catch (error) {
    console.error("Error granting session permissions:", error);
  }
}
