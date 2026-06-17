import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker } from "react-day-picker";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

function Calendar({ className, classNames, showOutsideDays = true, ...props }: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-3 pointer-events-auto", className)}
      classNames={{
        months: "flex flex-col sm:flex-row sm:space-x-3",
        month: "space-y-1",
        caption: "flex justify-center pt-0.5 relative items-center",
        caption_label: "font-heading text-[15px] text-forest",
        nav: "space-x-0.5 flex items-center",
        nav_button: cn(
          buttonVariants({ variant: "outline" }),
          "h-6 w-6 bg-transparent p-0 opacity-50 hover:opacity-100",
        ),
        nav_button_previous: "absolute left-0",
        nav_button_next: "absolute right-0",
        table: "w-full border-collapse",
        head_row: "flex",
        head_cell: "font-label text-[9px] uppercase tracking-wide text-sage rounded-md w-8 font-medium mb-0.5",
        row: "flex w-full mt-0.5",
        cell: "h-8 w-8 text-center text-sm p-0 relative [&:has([aria-selected].day-range-end)]:rounded-r-md [&:has([aria-selected].day-outside)]:bg-accent/50 [&:has([aria-selected])]:bg-accent first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md focus-within:relative focus-within:z-20",
        day: cn(buttonVariants({ variant: "ghost" }), "h-8 w-8 p-0 font-data text-[17px] font-medium text-charcoal aria-selected:opacity-100"),
        day_range_end: "day-range-end",
        day_selected:
          "bg-verdant text-white hover:bg-verdant hover:text-white focus:bg-verdant focus:text-white rounded-full",
        // "Today" must read differently from a selected day — a ring, not a
        // fill. When today is also selected/in-range, day_selected's solid fill
        // applies on top and wins.
        day_today: "ring-1 ring-inset ring-verdant/50 text-verdant font-semibold rounded-full",
        day_outside:
          "day-outside text-sage opacity-50 aria-selected:bg-accent/50 aria-selected:text-muted-foreground aria-selected:opacity-30",
        day_disabled: "text-muted-foreground opacity-50",
        day_range_middle: "aria-selected:bg-sage-light aria-selected:text-forest",
        day_hidden: "invisible",
        ...classNames,
      }}
      components={{
        IconLeft: ({ ..._props }) => <ChevronLeft className="h-4 w-4" />,
        IconRight: ({ ..._props }) => <ChevronRight className="h-4 w-4" />,
      }}
      {...props}
    />
  );
}
Calendar.displayName = "Calendar";

export { Calendar };
