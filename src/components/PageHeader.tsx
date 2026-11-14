import { cn } from "@/lib/utils";
import { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  description?: string;
  badge?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({ title, description, badge, actions, className }: PageHeaderProps) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3 mb-6", className)}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="gos-page-title">{title}</h1>
          {badge}
        </div>
        {description && (
          <p className="mt-2 max-w-[72ch] text-[14px] leading-relaxed text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  );
}
