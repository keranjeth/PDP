"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import * as React from "react";
import { DayPicker } from "react-day-picker";

import { cn } from "@/lib/utils";

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  components: userComponents,
  ...props
}: CalendarProps) {
  const defaultClassNames = {
    months: "relative flex flex-col sm:flex-row gap-4",
    month: "w-full",
    month_grid: "w-full border-collapse p-0",
    weeks: "",
    week: "",
    weekdays: "",
    month_caption: "relative mx-10 mb-1 flex h-9 items-center justify-center z-20",
    caption_label: "text-sm font-medium",
    nav: "absolute top-0 flex w-full justify-between z-10",
    button_previous:
      "h-9 w-9 text-slate-600 hover:text-slate-900 p-0 inline-flex items-center justify-center rounded-lg hover:bg-slate-100",
    button_next:
      "h-9 w-9 text-slate-600 hover:text-slate-900 p-0 inline-flex items-center justify-center rounded-lg hover:bg-slate-100",
    weekday: "h-9 w-9 p-0 text-xs font-semibold text-slate-600",
    day_button:
      "relative z-0 flex h-9 w-9 items-center justify-center whitespace-nowrap rounded-full p-0 text-slate-900 outline-offset-2 group-[[data-selected]:not(.range-middle)]:[transition-property:color,background-color,border-radius,box-shadow] group-[[data-selected]:not(.range-middle)]:duration-150 focus:outline-none group-data-[disabled]:pointer-events-none focus-visible:z-10 hover:bg-slate-100 hover:text-slate-900 group-data-[selected]:bg-[var(--primary)] group-data-[selected]:text-white group-data-[selected]:hover:bg-[var(--primary)] group-data-[disabled]:text-slate-400 group-data-[disabled]:line-through group-data-[outside]:text-slate-500 group-data-[outside]:hover:bg-slate-50 group-data-[outside]:hover:text-slate-700 group-data-[outside]:group-data-[selected]:bg-[var(--primary)] group-data-[outside]:group-data-[selected]:text-white group-data-[today]:bg-[var(--primary)] group-data-[today]:font-semibold group-data-[today]:text-white group-data-[today]:shadow-none group-data-[today]:hover:bg-[var(--primary-hover)] group-data-[today]:hover:text-white group-data-[today]:group-data-[outside]:bg-[var(--primary)] group-data-[today]:group-data-[outside]:text-white group-data-[today]:group-data-[outside]:hover:bg-[var(--primary-hover)] group-data-[today]:group-data-[selected]:bg-[var(--primary)] group-data-[today]:group-data-[selected]:text-white group-data-[today]:group-data-[selected]:hover:bg-[var(--primary)]",
    day: "group relative h-9 w-9 px-0 py-0.5 text-sm text-slate-900",
    range_start: "range-start",
    range_end: "range-end",
    range_middle: "range-middle",
    today:
      "after:pointer-events-none after:absolute after:bottom-0 after:left-1/2 after:z-10 after:h-[3px] after:w-[3px] after:-translate-x-1/2 after:rounded-full after:bg-[var(--primary)] after:transition-colors [&[data-selected]]:after:bg-[var(--primary)] [&[data-disabled]]:after:bg-slate-400",
    outside: "text-slate-500 data-selected:bg-slate-100 data-selected:text-slate-700",
    hidden: "invisible",
    week_number: "h-9 w-9 p-0 text-xs font-medium text-slate-600",
  };

  const mergedClassNames: typeof defaultClassNames = Object.keys(defaultClassNames).reduce(
    (acc, key) => ({
      ...acc,
      [key]: classNames?.[key as keyof typeof classNames]
        ? cn(
            defaultClassNames[key as keyof typeof defaultClassNames],
            classNames[key as keyof typeof classNames],
          )
        : defaultClassNames[key as keyof typeof defaultClassNames],
    }),
    {} as typeof defaultClassNames,
  );

  const defaultComponents = {
    Chevron: (props: {
      className?: string;
      size?: number;
      disabled?: boolean;
      orientation?: 'left' | 'right' | 'up' | 'down';
    }) => {
      if (props.orientation === "left") {
        return <ChevronLeft size={16} strokeWidth={2} className={props.className} aria-hidden="true" />;
      }
      return <ChevronRight size={16} strokeWidth={2} className={props.className} aria-hidden="true" />;
    },
  };

  const mergedComponents = {
    ...defaultComponents,
    ...userComponents,
  };

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("w-fit", className)}
      classNames={mergedClassNames}
      components={mergedComponents}
      {...props}
    />
  );
}

Calendar.displayName = "Calendar";

export { Calendar };

