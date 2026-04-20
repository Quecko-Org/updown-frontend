import { LocalAccountSigner } from "@aa-sdk/core";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { toFunctionSelector, toHex } from "viem";
import { getSessionExpirySec } from "@/config/environment";
import { isValidPermissionsContext } from "@/lib/derivations";
import { saveIndexKey, getIndexKey } from "@/utils/indexDb";
import { handleCheckSession } from "@/utils/walletHelpers";

const ENTER_POSITION_SELECTOR = toFunctionSelector(
  "enterPosition(uint256,uint8,uint256)"
) as `0x${string}`;

export type SessionKeyData = {
  privateKey: `0x${string}`;
  permissions: unknown;
  sessionExpiry: number;
  permissionsContext: string;
  functionSelector: `0x${string}`;
};

/** Payload returned to WalletContext / register; same shape whether from IDB or fresh grant. */
export type ScopedSessionArtifact = {
  privateKey: `0x${string}`;
  sessionExpiry: number;
  permissionsContext: string;
  functionSelector: `0x${string}`;
};

type GrantClient = {
  grantPermissions: (p: {
    account: string;
    expirySec: number;
    key: { publicKey: string; type: string };
    permissions: readonly unknown[];
  }) => Promise<unknown>;
};

function isCompleteScopedSessionData(x: unknown): x is SessionKeyData {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.privateKey === "string" &&
    o.privateKey.startsWith("0x") &&
    typeof o.sessionExpiry === "number" &&
    typeof o.permissionsContext === "string" &&
    o.permissionsContext.length > 0 &&
    typeof o.functionSelector === "string" &&
    o.functionSelector.startsWith("0x")
  );
}

/**
 * Valid scoped session in IDB + not expired (same rules as handleCheckSession for expiry).
 * Does not call Alchemy.
 */
export async function readStoredScopedSessionIfValid(): Promise<ScopedSessionArtifact | null> {
  const needsRenewal = await handleCheckSession();
  if (needsRenewal) return null;
  const stored = await getIndexKey<unknown>("sessionKeyData");
  if (!isCompleteScopedSessionData(stored)) return null;
  return {
    privateKey: stored.privateKey,
    sessionExpiry: stored.sessionExpiry,
    permissionsContext: stored.permissionsContext,
    functionSelector: stored.functionSelector,
  };
}

export async function grantScopedSessionIfNeeded(
  smartAccountClient: unknown,
  smartAccount: string,
  scope: {
    settlementAddress: `0x${string}`;
    usdtAddress: `0x${string}`;
    usdtAllowance: bigint;
    gasLimit: bigint;
  }
): Promise<ScopedSessionArtifact | null> {
  if (!smartAccountClient || !smartAccount) return null;

  try {
    const needsRenewal = await handleCheckSession();
    const stored = await getIndexKey<unknown>("sessionKeyData");

    if (!needsRenewal && isCompleteScopedSessionData(stored)) {
      return {
        privateKey: stored.privateKey,
        sessionExpiry: stored.sessionExpiry,
        permissionsContext: stored.permissionsContext,
        functionSelector: stored.functionSelector,
      };
    }

    const expirySec = getSessionExpirySec();
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    const sessionSigner = new LocalAccountSigner(account);

    const permissionsPayload = [
      {
        type: "functions-on-contract",
        data: {
          address: scope.settlementAddress,
          functions: [ENTER_POSITION_SELECTOR],
        },
      },
      {
        type: "erc20-token-transfer",
        data: {
          address: scope.usdtAddress,
          allowance: toHex(scope.usdtAllowance),
        },
      },
      {
        type: "gas-limit",
        data: { limit: toHex(scope.gasLimit) },
      },
    ];

    const response = await (smartAccountClient as GrantClient).grantPermissions({
      account: smartAccount,
      expirySec,
      key: {
        publicKey: await sessionSigner.getAddress(),
        type: "secp256k1",
      },
      permissions: permissionsPayload,
    });

    const r = response as { context?: string; permissionsContext?: string } | null;
    const fromContext = r?.context != null && r.context !== "" ? String(r.context) : "";
    const fromAlt = r?.permissionsContext != null && r.permissionsContext !== "" ? String(r.permissionsContext) : "";
    const candidate = fromContext || fromAlt;
    if (!isValidPermissionsContext(candidate)) {
      console.error("[grantPermissions] No hex context in Alchemy response — SDK shape may have changed.", {
        hasContext: Boolean(fromContext),
        hasAlt: Boolean(fromAlt),
        responseKeys: response && typeof response === "object" ? Object.keys(response as object) : null,
      });
      throw new Error(
        "Alchemy did not return a permissions context (expected 0x-prefixed hex). Try reconnecting your wallet."
      );
    }
    const permissionsContext: `0x${string}` = candidate;

    localStorage.setItem("sessionExpiryTime", String(expirySec));
    await saveIndexKey("sessionKeyData", {
      privateKey,
      permissions: response,
      sessionExpiry: expirySec,
      permissionsContext,
      functionSelector: ENTER_POSITION_SELECTOR,
    });

    return {
      privateKey,
      sessionExpiry: expirySec,
      permissionsContext,
      functionSelector: ENTER_POSITION_SELECTOR,
    };
  } catch (error) {
    console.error("Error granting scoped session permissions:", error);
    return null;
  }
}

export async function grantRootSessionIfNeeded(): Promise<never> {
  throw new Error("grantRootSessionIfNeeded is deprecated; use grantScopedSessionIfNeeded");
}
