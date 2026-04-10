import { MarketPageClient } from "./MarketPageClient";

export default async function MarketPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  return <MarketPageClient address={address} />;
}
