import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageShellProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  children: ReactNode;
  /** Use the full width of the app area. Meant for pages built around a wide table. */
  wide?: boolean;
}

/**
 * The one page wrapper for staff pages. The app layout already adds the outer
 * padding, so the shell adds none: every page starts at the same left edge and top.
 * Standard pages stop at one max width; `wide` pages use the whole app area.
 */
export function PageShell({ wide = false, className, children, ...rest }: PageShellProps) {
  return (
    <div
      data-page-shell={wide ? "wide" : "standard"}
      className={cn("w-full min-w-0 space-y-4", wide ? "max-w-none" : "max-w-6xl", className)}
      {...rest}
    >
      {children}
    </div>
  );
}
