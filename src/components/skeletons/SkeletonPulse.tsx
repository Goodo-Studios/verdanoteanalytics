import { cn } from "@/lib/utils";
import { CSSProperties } from "react";

export function SkeletonPulse({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <div
      className={cn(
        "rounded-md bg-cream-dark animate-pulse",
        className
      )}
      style={style}
    />
  );
}
