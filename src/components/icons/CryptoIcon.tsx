import Image from "next/image";

/**
 * PR-4: single import surface for crypto-asset icons. Renders the
 * brand-correct SVG from public/icons/crypto/{symbol}.svg with the
 * given size. Pre-PR-4 we were drawing BTC via lucide's outline icon
 * and ETH via the Unicode Ξ glyph — both fine for a placeholder, both
 * wrong for the consumer-grade pass.
 *
 * Source files live at:
 *   /public/icons/crypto/btc.svg
 *   /public/icons/crypto/eth.svg
 *   /public/icons/crypto/usdt.svg
 *   /public/icons/crypto/arbitrum.svg
 *
 * Add a new symbol by dropping the .svg into that directory and
 * extending the union type below — no other code changes.
 */

export type CryptoSymbol = "BTC" | "ETH" | "USDT" | "ARB";

export type CryptoIconProps = {
  symbol: CryptoSymbol;
  size?: number;
  className?: string;
};

const SOURCES: Record<CryptoSymbol, string> = {
  BTC: "/icons/crypto/btc.svg",
  ETH: "/icons/crypto/eth.svg",
  USDT: "/icons/crypto/usdt.svg",
  ARB: "/icons/crypto/arbitrum.svg",
};

export function CryptoIcon({ symbol, size = 18, className }: CryptoIconProps) {
  return (
    <Image
      src={SOURCES[symbol]}
      alt={`${symbol} logo`}
      width={size}
      height={size}
      className={className}
      // SVGs are static brand marks; no responsive sizing concerns and
      // no priority/preload needed (header asset icons are above-the-fold
      // but small enough that next/image's default heuristics work).
    />
  );
}
