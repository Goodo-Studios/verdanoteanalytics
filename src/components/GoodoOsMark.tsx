import { APP_NAME } from "@/lib/brand";

/** The Goodo OS name mark: an ink tile with a serif italic G, then the name (OS-005). */
export function GoodoOsMark({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const tile = size === "lg" ? "h-14 w-14 text-[28px] rounded-[16px]" : size === "sm" ? "h-6 w-6 text-[13px] rounded-[7px]" : "h-[30px] w-[30px] text-[15px] rounded-[9px]";
  const text = size === "lg" ? "text-[28px]" : size === "sm" ? "text-[15px]" : "text-[17px]";
  return (
    <span className="inline-flex items-center gap-2.5" data-testid="app-name">
      <span aria-hidden="true" className={`grid place-items-center bg-foreground text-background font-serif italic leading-none ${tile}`}>
        G
      </span>
      {size === "lg" ? null : <span className={`font-semibold tracking-[-0.02em] text-foreground ${text}`}>{APP_NAME}</span>}
    </span>
  );
}
