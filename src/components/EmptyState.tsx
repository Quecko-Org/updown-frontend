import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

const ICONS: Record<string, ReactNode> = {
  wallet: (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-brand">
      <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
      <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
      <path d="M18 12a2 2 0 0 0 0 4h4v-4h-4Z" />
    </svg>
  ),
  chart: (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-brand">
      <path d="M3 3v18h18" />
      <path d="m19 9-5 5-4-4-3 3" />
    </svg>
  ),
  trade: (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-brand">
      <path d="m16 3 4 4-4 4" />
      <path d="M20 7H4" />
      <path d="m8 21-4-4 4-4" />
      <path d="M4 17h16" />
    </svg>
  ),
  list: (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-brand">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M7 9h10" />
      <path d="M7 13h6" />
    </svg>
  ),
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
  const iconEl = icon && ICONS[icon] ? ICONS[icon] : null;

  return (
    <div
      className={cn(
        "flex min-h-[200px] flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface-muted/40 px-6 py-12 text-center",
        className,
      )}
    >
      {iconEl && <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-brand-subtle">{iconEl}</div>}
      {title && (
        <p className="font-display text-lg font-bold text-foreground">{title}</p>
      )}
      {subtitle && (
        <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted">{subtitle}</p>
      )}
      {children && (
        <div className="mt-4 flex w-full max-w-md flex-col items-center gap-2">{children}</div>
      )}
    </div>
  );
}
