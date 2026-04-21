import { LocalAccountSigner } from "@aa-sdk/core";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { toFunctionSelector, toHex } from "viem";
import { getSessionExpirySec } from "@/config/environment";
import { isValidPermissionsContext } from "@/lib/derivations";
import { OPTION_C_ENABLED } from "@/lib/env";
import { saveIndexKey, getIndexKey } from "@/utils/indexDb";
import {
  generateAndStoreSessionKeypair,
  deleteSessionKeypair,
} from "@/utils/sessionKeypair";
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
  /** Option C — SEC1 uncompressed P-256 pubkey; omitted under Option B. */
  sessionPublicKey?: `0x${string}`;
};

/** Payload returned to WalletContext / register; same shape whether from IDB or fresh grant. */
export type ScopedSessionArtifact = {
  privateKey: `0x${string}`;
  sessionExpiry: number;
  permissionsContext: string;
  functionSelector: `0x${string}`;
  /**
   * Option C — SEC1 uncompressed P-256 public key when the non-custodial
   * flow is active. Undefined under Option B (the default). The matching
   * private half lives only in IndexedDB as a non-extractable CryptoKey.
   */
  sessionPublicKey?: `0x${string}`;
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
    o.functionSelector.startsWith("0x") &&
    // sessionPublicKey is optional — present under Option C, absent under B.
    (o.sessionPublicKey === undefined ||
      (typeof o.sessionPublicKey === "string" && o.sessionPublicKey.startsWith("0x04")))
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
    ...(stored.sessionPublicKey ? { sessionPublicKey: stored.sessionPublicKey } : {}),
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
        ...(stored.sessionPublicKey ? { sessionPublicKey: stored.sessionPublicKey } : {}),
      };
    }

    const expirySec = getSessionExpirySec();
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    const sessionSigner = new LocalAccountSigner(account);

    // Option C: generate a non-extractable P-256 keypair in IndexedDB and
    // use its public key as the session signer. The secp256k1 `privateKey`
    // generated above is kept only to satisfy the register body shape
    // (backend still requires `sessionKey`) and is never authorized on-chain
    // under Option C — the grantPermissions `key` below points at the P-256
    // public key instead, so the secp256k1 half is a powerless placeholder.
    // Under Option B (flag off) the secp256k1 key is the authorized signer,
    // matching the pre-PR flow.
    let sessionPublicKey: `0x${string}` | undefined;
    if (OPTION_C_ENABLED) {
      sessionPublicKey = await generateAndStoreSessionKeypair(smartAccount);
    }

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
      key: OPTION_C_ENABLED && sessionPublicKey
        ? { publicKey: sessionPublicKey, type: "ecdsa" }
        : { publicKey: await sessionSigner.getAddress(), type: "secp256k1" },
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
      ...(sessionPublicKey ? { sessionPublicKey } : {}),
    });

    return {
      privateKey,
      sessionExpiry: expirySec,
      permissionsContext,
      functionSelector: ENTER_POSITION_SELECTOR,
      sessionPublicKey,
    };
  } catch (error) {
    console.error("Error granting scoped session permissions:", error);
    // If grantPermissions failed mid-way under Option C, drop the orphaned
    // keypair — it's useless without a matching on-chain grant, and leaving
    // it behind would make the next retry think a session already exists.
    if (OPTION_C_ENABLED) {
      await deleteSessionKeypair(smartAccount).catch(() => undefined);
    }
    return null;
  }
}

export async function grantRootSessionIfNeeded(): Promise<never> {
  throw new Error("grantRootSessionIfNeeded is deprecated; use grantScopedSessionIfNeeded");
}
