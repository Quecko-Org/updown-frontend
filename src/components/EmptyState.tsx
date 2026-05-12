import type { LucideIcon } from "lucide-react";
import { ArrowLeftRight, LineChart, List, Wallet } from "lucide-react";
import { cn } from "@/lib/cn";

const ICONS: Record<string, LucideIcon> = {
  wallet: Wallet,
  chart: LineChart,
  trade: ArrowLeftRight,
  list: List,
};

export function EmptyState({
  icon,
  title,
  subtitle,
  children,
  className,
}: {
  icon?: keyof typeof ICONS | string;
  title?: string;
  subtitle?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  const Icon = icon ? ICONS[icon] : null;

  return (
    <div
      className={cn(
        "flex min-h-[200px] flex-col items-center justify-center rounded-[var(--r-lg)] border border-dashed px-6 py-12 text-center",
        className,
      )}
      style={{ borderColor: "var(--border-0)", background: "var(--bg-1)" }}
    >
      {Icon && (
        <div
          className="mb-4 flex h-14 w-14 items-center justify-center rounded-[var(--r-md)]"
          style={{ background: "var(--bg-2)", color: "var(--fg-2)" }}
        >
          <Icon size={24} strokeWidth={1.5} />
        </div>
      )}
      {title && <p className="pp-h3">{title}</p>}
      {subtitle && (
        <p className="pp-body mt-2 max-w-sm" style={{ color: "var(--fg-2)" }}>
          {subtitle}
        </p>
      )}
      {children && (
        <div className="mt-4 flex w-full max-w-md flex-col items-center gap-2">{children}</div>
      )}
    </div>
  );
}
