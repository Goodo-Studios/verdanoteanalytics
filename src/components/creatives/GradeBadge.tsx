import { cn } from "@/lib/utils";
import { GRADE_STYLES, type Grade } from "@/lib/creativeGrading";

interface GradeBadgeProps {
  grade: Grade;
  className?: string;
}

export function GradeBadge({ grade, className }: GradeBadgeProps) {
  const style = GRADE_STYLES[grade];
  return (
    <span
      className={cn(
        "font-label text-[9px] font-bold uppercase tracking-[0.08em] leading-none rounded-[3px] px-1.5 py-[3px]",
        style.bg,
        style.text,
        className
      )}
    >
      {grade}
    </span>
  );
}
