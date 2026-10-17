"use client";

import * as React from "react";
import { addMonths, format, isValid } from "date-fns";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { Calendar } from "@/components/ui/Calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/Popover";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/Select";

type DatePickerProps = {
  value?: Date;
  onChange: (date?: Date) => void;
  placeholder?: string;
  disabled?: boolean;
  fromDate?: Date;
  toDate?: Date;
  className?: string;
};

const monthOptions = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function DatePicker({
  value,
  onChange,
  placeholder = "dd/mm/yyyy",
  disabled,
  fromDate,
  toDate,
  className,
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false);
  const initialMonth = value ?? new Date();
  const [currentMonth, setCurrentMonth] = React.useState<Date>(initialMonth);
  const [textValue, setTextValue] = React.useState<string>(
    value ? format(value, "dd/MM/yyyy") : ""
  );
  const [syncedValue, setSyncedValue] = React.useState(value);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  if (value !== syncedValue) {
    setSyncedValue(value);
    if (value) setCurrentMonth(value);
    setTextValue(value ? format(value, "dd/MM/yyyy") : "");
  }

  const years = React.useMemo(() => {
    const currentYear = new Date().getFullYear();
    const minYear = 2000;
    const maxYear = currentYear + 1;
    return Array.from({ length: maxYear - minYear + 1 }, (_, i) => minYear + i);
  }, []);

  const handleSelect = (date?: Date) => {
    if (!date) return;
    onChange?.(date);
    setOpen(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const goToPrevMonth = () => setCurrentMonth((prev) => addMonths(prev, -1));
  const goToNextMonth = () => setCurrentMonth((prev) => addMonths(prev, 1));

  const handleMonthChange = (monthIndex: number) => {
    setCurrentMonth((prev) => new Date(prev.getFullYear(), monthIndex, 1));
  };

  const handleYearChange = (year: number) => {
    setCurrentMonth((prev) => new Date(year, prev.getMonth(), 1));
  };

  const withinRange = React.useCallback(
    (d: Date) => {
      if (fromDate && d < fromDate) return false;
      if (toDate && d > toDate) return false;
      return true;
    },
    [fromDate, toDate]
  );

  const parseLooseDate = React.useCallback((raw: string): Date | null => {
    const cleaned = raw.trim();
    if (!cleaned) return null;

    const parts = cleaned.split("/").map((p) => p.trim());
    if (parts.length !== 3) return null;
    const [ddRaw, mmRaw, yyRaw] = parts;
    const dd = Number(ddRaw);
    const mm = Number(mmRaw);
    if (!Number.isInteger(dd) || !Number.isInteger(mm)) return null;
    if (dd < 1 || dd > 31 || mm < 1 || mm > 12) return null;

    let year = Number(yyRaw);
    if (!Number.isInteger(year)) return null;

    // Normalize 2-digit years (e.g. 26 -> 2026), never 0026.
    if (yyRaw.length <= 2) {
      year = 2000 + year;
    }
    if (year < 1900 || year > 2100) return null;

    const d = new Date(year, mm - 1, dd);
    if (!isValid(d)) return null;
    // Guard against Date overflow (e.g. 31/02/2026 becomes March).
    if (d.getFullYear() !== year || d.getMonth() !== mm - 1 || d.getDate() !== dd) return null;
    return d;
  }, []);

  const commitText = React.useCallback(
    (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed) {
        onChange?.(undefined);
        return;
      }
      const parsed = parseLooseDate(trimmed);
      if (!parsed) {
        // keep text; don't clobber user's input
        return;
      }
      if (!withinRange(parsed)) {
        return;
      }
      onChange?.(parsed);
    },
    [onChange, parseLooseDate, withinRange]
  );

  return (
    <Popover open={open} onOpenChange={(next) => !disabled && setOpen(next)}>
      <div className={cn("relative w-full", className)}>
        <input
          ref={inputRef}
          disabled={disabled}
          value={textValue}
          placeholder={placeholder}
          onChange={(e) => setTextValue(e.target.value)}
          onBlur={() => commitText(textValue)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              commitText(textValue);
              setOpen(false);
              (e.target as HTMLInputElement).blur();
            }
          }}
          className={cn(
            "h-10 w-full rounded-lg border border-[var(--primary-border)] bg-white px-3 pr-10 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-[var(--primary)] focus:ring-0 disabled:cursor-not-allowed disabled:opacity-50"
          )}
          inputMode="numeric"
        />
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            aria-label="Open calendar"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-2 text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700 disabled:opacity-50"
            onClick={() => setOpen(true)}
          >
            <CalendarIcon className="h-4 w-4" />
          </button>
        </PopoverTrigger>
      </div>

      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={6}
        className="w-[280px] rounded-xl border border-[var(--primary-border)] bg-white p-0 shadow-lg"
      >
        <div className="flex items-center justify-between px-3 pt-3">
          <Button
            type="button"
            variant="ghost"
            className="h-7 w-7 rounded-full px-0 text-muted-foreground hover:bg-slate-100"
            onClick={goToPrevMonth}
            disabled={disabled}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>

          <div className="flex items-center gap-1 text-sm font-medium">
            <Select
              value={currentMonth.getMonth().toString()}
              onValueChange={(val) => handleMonthChange(Number(val))}
              disabled={disabled}
            >
              <SelectTrigger className="h-7 w-[120px] border-none bg-transparent px-2 text-center shadow-none hover:bg-slate-100 focus:ring-0 focus:ring-offset-0">
                <SelectValue>{monthOptions[currentMonth.getMonth()]}</SelectValue>
              </SelectTrigger>
              <SelectContent align="center" className="max-h-64 min-w-[120px]">
                {monthOptions.map((label, idx) => (
                  <SelectItem key={label} value={idx.toString()} className="min-w-[120px]">
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={currentMonth.getFullYear().toString()}
              onValueChange={(val) => handleYearChange(Number(val))}
              disabled={disabled}
            >
              <SelectTrigger className="h-7 w-[80px] border-none bg-transparent px-2 text-center shadow-none hover:bg-slate-100 focus:ring-0 focus:ring-offset-0">
                <SelectValue>{currentMonth.getFullYear()}</SelectValue>
              </SelectTrigger>
              <SelectContent align="center" className="max-h-64 min-w-[80px]">
                {years.map((year) => (
                  <SelectItem key={year} value={year.toString()}>
                    {year}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button
            type="button"
            variant="ghost"
            className="h-7 w-7 rounded-full px-0 text-muted-foreground hover:bg-slate-100"
            onClick={goToNextMonth}
            disabled={disabled}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <div className="px-3 pb-3">
          <Calendar
            mode="single"
            selected={value}
            onSelect={handleSelect}
            month={currentMonth}
            onMonthChange={setCurrentMonth}
            fromDate={fromDate}
            toDate={toDate}
            showOutsideDays
            className="rounded-2xl bg-white"
            classNames={{
              months: "flex flex-col space-y-0",
              month: "space-y-0",
              month_caption: "hidden",
              caption_label: "hidden",
              nav: "hidden",
              month_grid: "w-full border-collapse border-spacing-0",
              weekdays: "border-b border-[var(--primary-border)]",
              weekday:
                "h-9 w-9 p-0 text-center text-[11px] font-semibold text-[var(--primary-strong)]",
              weeks: "w-full",
              week: "[&>td]:p-0",
              day: "group relative w-full px-0 py-0.5 text-center text-sm text-slate-900",
              day_button: cn(
                "relative z-0 mx-auto flex h-8 w-8 min-h-8 min-w-8 items-center justify-center rounded-full text-xs font-medium tabular-nums",
                "text-slate-900",
                "transition-colors hover:bg-[var(--primary-light)] hover:text-slate-900",
                "group-data-[outside]:text-slate-500 group-data-[outside]:hover:text-slate-700",
                "group-data-[disabled]:text-slate-400",
                "group-data-[selected]:bg-[var(--primary)] group-data-[selected]:text-white group-data-[selected]:hover:bg-[var(--primary)]",
              ),
              outside: "text-slate-500",
              hidden: "invisible",
            }}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

