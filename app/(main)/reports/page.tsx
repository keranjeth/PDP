'use client';

export default function ReportsPage() {
  return (
    <div className="mx-auto max-w-7xl">
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="px-4 py-5 sm:px-6 sm:py-6">
          <h3 className="text-[18px] font-semibold text-slate-950">Reports</h3>
          <p className="mt-1 text-sm text-slate-500">
            Review professional development, training, and budget information.
          </p>
        </div>
        <div className="flex min-h-[240px] items-center justify-center border-t border-slate-200 px-4 py-12 text-center sm:px-6">
          <p className="max-w-md text-sm text-slate-500">
            Reports will become available when training and budget records are implemented.
          </p>
        </div>
      </div>
    </div>
  );
}
