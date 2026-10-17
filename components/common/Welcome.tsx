'use client';

import React from 'react';
import { ChevronRight, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import Image from 'next/image';

interface WelcomeProps {
  positionTitle: string;
  onStart: () => void;
  showAuthenticatedOptions?: boolean;
  onGoToDashboard?: () => void;
  onGoToPolicies?: () => void;
  loading?: boolean;
}

const Welcome: React.FC<WelcomeProps> = ({
  onStart,
  showAuthenticatedOptions = false,
  onGoToDashboard,
  onGoToPolicies,
  loading = false,
}) => {
  return (
    <div className="h-screen bg-[#F0FAF4] relative overflow-hidden">
      {/* Diagonal background shape from top right to bottom left */}
      <div
        className="pointer-events-none absolute w-[180vw] h-[80vh] top-[-20vh] right-[-40vw] -rotate-12 z-0"
        style={{
          background:
            'linear-gradient(120deg, #BCE4D0 0%, #DCF1E6 60%, transparent 100%)',
          opacity: 0.55,
        }}
      />

      <div className="relative z-10 flex h-full items-center justify-center px-4 py-4 sm:py-6">
        <div className="z-10 w-full max-w-md md:max-w-lg lg:max-w-xl max-h-[calc(100vh-1.5rem)] overflow-hidden rounded-2xl bg-white/80 shadow-2xl backdrop-blur-sm">
          <div className="space-y-4 p-5 sm:p-6 lg:space-y-6 lg:p-8">
            {/* Zone 1 + 2: Logo/headline/subtitle (match sign-in typography) */}
            <div className="flex flex-col items-center justify-center gap-3 text-center lg:gap-4">
              <div className="relative h-16 w-16 lg:h-20 lg:w-20">
                <Image
                  src="/logo.svg"
                  alt="PD Plan logo"
                  fill
                  priority
                  unoptimized
                  className="object-contain"
                />
              </div>
              <div>
                <h1 className="text-xl font-semibold text-slate-900">
                  Professional Development Plan
                </h1>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  <span className="block">
                    Manage employee development plans, training budgets,
                  </span>
                  <span className="block">training records, and costs in one place.</span>
                </p>
              </div>
            </div>

            {/* Zone 3: Two compact cards (content-driven, no dead space) */}
            <div className="grid grid-cols-2 gap-3 lg:gap-4 text-left">
              <div className="bg-[#F0FAF4] rounded-lg px-3 py-2.5 lg:px-5 lg:py-4">
                <h3 className="font-semibold text-[var(--primary-strong)] mb-1.5 flex items-center gap-2 text-sm">
                  <Sparkles className="w-4 h-4" />
                  Core Functions
                </h3>
                <ul className="space-y-1 text-gray-600 text-sm leading-snug">
                  <li className="flex items-center gap-2">
                    <ChevronRight className="w-4 h-4 text-[var(--primary-strong)] shrink-0" />
                    Employee Management
                  </li>
                  <li className="flex items-center gap-2">
                    <ChevronRight className="w-4 h-4 text-[var(--primary-strong)] shrink-0" />
                    Training Budgets
                  </li>
                  <li className="flex items-center gap-2">
                    <ChevronRight className="w-4 h-4 text-[var(--primary-strong)] shrink-0" />
                    Training Records
                  </li>
                  <li className="flex items-center gap-2">
                    <ChevronRight className="w-4 h-4 text-[var(--primary-strong)] shrink-0" />
                    Training Costs
                  </li>
                </ul>
              </div>

              <div className="bg-[#F0FAF4] rounded-lg px-3 py-2.5 lg:px-5 lg:py-4">
                <h3 className="font-semibold text-[var(--primary-strong)] mb-1.5 flex items-center gap-2 text-sm">
                  <Sparkles className="w-4 h-4" />
                  Key Capabilities
                </h3>
                <ul className="space-y-1 text-gray-600 text-sm leading-snug">
                  <li className="flex items-center gap-2">
                    <ChevronRight className="w-4 h-4 text-[var(--primary-strong)] shrink-0" />
                    Budget Allocations
                  </li>
                  <li className="flex items-center gap-2">
                    <ChevronRight className="w-4 h-4 text-[var(--primary-strong)] shrink-0" />
                    Training Planning
                  </li>
                  <li className="flex items-center gap-2">
                    <ChevronRight className="w-4 h-4 text-[var(--primary-strong)] shrink-0" />
                    Cost Tracking
                  </li>
                  <li className="flex items-center gap-2">
                    <ChevronRight className="w-4 h-4 text-[var(--primary-strong)] shrink-0" />
                    Reporting
                  </li>
                </ul>
              </div>
            </div>

            {/* Zone 4: CTA + footer (same spacing rhythm as sign-in card) */}
            <div className="flex flex-col items-center gap-2 lg:gap-3">
              {!showAuthenticatedOptions ? (
                <Button
                  onClick={onStart}
                  disabled={loading}
                  className="bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white px-7 py-2.5 rounded-lg font-medium flex items-center gap-2 shadow-lg hover:shadow-xl transition-colors disabled:opacity-60"
                >
                  {loading ? 'Loading...' : 'Sign in'}
                  <ChevronRight className="w-5 h-5" />
                </Button>
              ) : (
                <div className="flex flex-col gap-2.5 w-full max-w-md">
                  {onGoToDashboard ? (
                    <Button
                      onClick={onGoToDashboard}
                      className="bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white px-7 py-2.5 rounded-lg font-medium flex items-center gap-2 shadow-lg hover:shadow-xl transition-colors"
                    >
                      Go to Dashboard
                      <ChevronRight className="w-5 h-5" />
                    </Button>
                  ) : null}
                  {onGoToPolicies ? (
                    <Button
                      onClick={onGoToPolicies}
                      variant="outline"
                      className="bg-white hover:bg-gray-50 text-[var(--primary-strong)] border border-[var(--primary)] px-7 py-2.5 rounded-lg font-medium flex items-center gap-2 shadow-lg hover:shadow-xl transition-colors"
                    >
                      Open workspace
                      <ChevronRight className="w-5 h-5" />
                    </Button>
                  ) : null}
                </div>
              )}

              <div className="w-full max-w-md">
                <div className="border-t border-gray-200 pt-3 lg:pt-4">
                  <p className="text-[10px] text-gray-500 text-center leading-snug">
                    By using this application, you agree to the organization&apos;s privacy and data
                    handling policies.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Welcome;
