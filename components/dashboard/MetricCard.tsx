'use client';

interface MetricCardProps {
  title: string;
  headerMetric: React.ReactNode;
  primaryLine: React.ReactNode;
  secondaryLine?: React.ReactNode;
  icon?: React.ReactNode;
}

export default function MetricCard({
  title,
  headerMetric,
  primaryLine,
  secondaryLine,
  icon,
}: MetricCardProps) {
  return (
    <div className="group relative bg-white rounded-2xl shadow-sm border border-gray-200 hover:shadow-md transition-all duration-300 overflow-hidden">
      {/* Subtle gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-br from-[var(--analytics-budget)]/0 via-[var(--analytics-budget)]/0 to-[var(--analytics-budget)]/6 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
      
      <div className="relative p-4 sm:p-5 space-y-3">
        {/* Header: Icon + Title + Header Metric */}
        <div className="flex items-center justify-between gap-2 sm:gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {icon && (
              <div className="flex-shrink-0 w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-[var(--analytics-budget-background)] text-[var(--analytics-budget)] flex items-center justify-center group-hover:bg-[var(--analytics-actual-soft)] transition-colors">
                <div className="w-4 h-4 sm:w-5 sm:h-5 flex items-center justify-center">{icon}</div>
              </div>
            )}
            <div className="text-xs sm:text-sm font-medium text-gray-600 whitespace-nowrap">
              {title} | {headerMetric}
            </div>
          </div>
        </div>

        {/* Primary Metric - Main Focus */}
        <div className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-900 leading-tight">
          {primaryLine}
        </div>

        {/* Secondary Info */}
        {secondaryLine && (
          <div className="text-xs sm:text-sm text-gray-500/80 leading-tight">
            {secondaryLine}
          </div>
        )}
      </div>
    </div>
  );
}
