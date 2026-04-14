export const API_BASE =
  typeof window !== "undefined"
    ? (process.env.NEXT_PUBLIC_API_BASE_URL ?? "https://api-updown.quecko.org")
    : (process.env.NEXT_PUBLIC_API_BASE_URL ?? "https://api-updown.quecko.org");

export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? "42161");

export function wsStreamUrl(): string {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL ?? "https://api-updown.quecko.org";
  const u = new URL(base);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  u.pathname = "/stream";
  u.search = "";
  u.hash = "";
  return u.toString();
}
