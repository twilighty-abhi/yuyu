import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

/** Rounded, bordered table that scrolls inside its own box on small screens (docs/DESIGN.md §4.8). */
export function Table({ className, children, label, ...props }: HTMLAttributes<HTMLTableElement> & { label?: string }) {
  return (
    <div className="relative w-full overflow-x-auto rounded-lg border border-line bg-canvas" role="region" aria-label={label} tabIndex={label ? 0 : undefined}>
      <table className={cn("w-full border-collapse text-left text-body-ui", className)} {...props}>
        {children}
      </table>
    </div>
  );
}

export function THead({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn("bg-subtle", className)} {...props} />;
}

export function TBody({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn("[&>tr:last-child>td]:border-b-0", className)} {...props} />;
}

export function TR({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn("transition-colors hover:bg-subtle/60", className)} {...props} />;
}

export function TH({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return <th scope="col" className={cn("whitespace-nowrap border-b border-line px-4 py-3 text-[13px] font-semibold text-ink-muted", className)} {...props} />;
}

export function TD({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("border-b border-emphasis px-4 py-3 align-middle text-ink", className)} {...props} />;
}
