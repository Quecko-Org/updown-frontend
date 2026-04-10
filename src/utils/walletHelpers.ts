import { getIndexKey } from "./indexDb";

export function getFormattedAddress(address: string): string {
  if (!address || address.length < 10) return address || "";
  return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
}

/** True when session should be renewed (expired or no stored key). */
export async function handleCheckSession(): Promise<boolean> {
  const currentTime = Math.floor(Date.now() / 1000);
  const sessionExpiryTime = Number(localStorage.getItem("sessionExpiryTime") ?? 0);
  const stored = await getIndexKey<{ privateKey: string }>("sessionKeyData");
  return currentTime >= sessionExpiryTime || !stored;
}
