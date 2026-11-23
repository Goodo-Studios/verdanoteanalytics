import * as React from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";
import { DayPicker } from "react-day-picker";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

// react-day-picker 9 (needed for React 19) renames the class slots and puts the selected, today,
// outside and range states on the day cell (the td, which also carries aria-selected) instead of
// the day button. The look is unchanged: the cell keeps the soft strip behind a selection and the
// button inside it takes the fill, ring or range colour, so those states style `[&>button]`.
function Calendar({ className, classNames, showOutsideDays = true, ...props }: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-3 pointer-events-auto", className)}
      classNames={{
        months: "relative flex flex-col sm:flex-row sm:space-x-3",
        month: "space-y-1",
        month_caption: "flex justify-center pt-0.5 relative items-center h-6",
        caption_label: "font-heading text-[15px] text-forest",
        nav: "absolute inset-x-0 top-0.5 z-10 flex items-center justify-between pointer-events-none",
        button_previous: cn(
          buttonVariants({ variant: "outline" }),
          "h-6 w-6 bg-transparent p-0 opacity-50 hover:opacity-100 pointer-events-auto",
        ),
        button_next: cn(
          buttonVariants({ variant: "outline" }),
          "h-6 w-6 bg-transparent p-0 opacity-50 hover:opacity-100 pointer-events-auto",
        ),
        month_grid: "w-full border-collapse",
        weekdays: "flex",
        weekday: "font-label text-[9px] uppercase tracking-wide text-sage rounded-md w-8 font-medium mb-0.5",
        week: "flex w-full mt-0.5",
        day: "h-8 w-8 text-center text-sm p-0 relative focus-within:relative focus-within:z-20",
        day_button: cn(
          buttonVariants({ variant: "ghost" }),
          "h-8 w-8 p-0 font-data text-[17px] font-medium text-charcoal aria-selected:opacity-100",
        ),
        range_start: "rounded-l-md",
        range_end: "rounded-r-md",
        selected:
          "bg-accent [&>button]:bg-verdant [&>button]:text-white [&>button:hover]:bg-verdant [&>button:hover]:text-white [&>button:focus]:bg-verdant [&>button:focus]:text-white [&>button]:rounded-full",
        // "Today" must read differently from a selected day: a ring, not a fill. When today is
        // also selected or in range, the solid fill of `selected` applies on top and wins.
        today: "[&>button]:ring-1 [&>button]:ring-inset [&>button]:ring-verdant/50 [&>button]:text-verdant [&>button]:font-semibold [&>button]:rounded-full",
        outside: "text-sage opacity-50 aria-selected:bg-accent/50 aria-selected:text-muted-foreground aria-selected:opacity-30",
        disabled: "text-muted-foreground opacity-50",
        range_middle: "[&>button]:!bg-sage-light [&>button]:!text-forest",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation }) => {
          const Icon = orientation === "left" ? ChevronLeft : orientation === "right" ? ChevronRight : orientation === "up" ? ChevronUp : ChevronDown;
          return <Icon className="h-4 w-4" />;
        },
      }}
      {...props}
    />
  );
}
Calendar.displayName = "Calendar";

export { Calendar };
