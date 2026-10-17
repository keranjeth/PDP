-- Per-row status flags + editable divisors for monthly/daily pension formulas.

ALTER TABLE public.pension_rules
  ADD COLUMN IF NOT EXISTS monthly_divisor numeric NOT NULL DEFAULT 12,
  ADD COLUMN IF NOT EXISTS daily_divisor numeric NOT NULL DEFAULT 360,
  ADD COLUMN IF NOT EXISTS line_active_eligibility boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS line_active_monthly boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS line_active_daily boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS line_active_include_gross boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS line_active_pension_tax boolean NOT NULL DEFAULT true;

ALTER TABLE public.pension_rules
  DROP CONSTRAINT IF EXISTS pension_rules_monthly_divisor_chk;

ALTER TABLE public.pension_rules
  ADD CONSTRAINT pension_rules_monthly_divisor_chk CHECK (monthly_divisor > 0);

ALTER TABLE public.pension_rules
  DROP CONSTRAINT IF EXISTS pension_rules_daily_divisor_chk;

ALTER TABLE public.pension_rules
  ADD CONSTRAINT pension_rules_daily_divisor_chk CHECK (daily_divisor > 0);

-- Migrate legacy single is_active to all line flags when column exists.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'pension_rules'
      AND column_name = 'is_active'
  ) THEN
    UPDATE public.pension_rules
    SET
      line_active_eligibility = is_active,
      line_active_monthly = is_active,
      line_active_daily = is_active,
      line_active_include_gross = is_active,
      line_active_pension_tax = is_active
    WHERE true;

    ALTER TABLE public.pension_rules DROP COLUMN is_active;
  END IF;
END $$;

COMMENT ON COLUMN public.pension_rules.monthly_divisor IS 'Divisor for monthly accrual (Basic Salary ÷ monthly_divisor).';
COMMENT ON COLUMN public.pension_rules.daily_divisor IS 'Divisor for daily arrears rate (Basic Salary ÷ daily_divisor).';
COMMENT ON COLUMN public.pension_rules.line_active_eligibility IS 'HR toggle: eligibility rule row active.';
COMMENT ON COLUMN public.pension_rules.line_active_monthly IS 'HR toggle: monthly accrual formula row active.';
COMMENT ON COLUMN public.pension_rules.line_active_daily IS 'HR toggle: daily rate formula row active.';
COMMENT ON COLUMN public.pension_rules.line_active_include_gross IS 'HR toggle: include-in-gross rule row active.';
COMMENT ON COLUMN public.pension_rules.line_active_pension_tax IS 'HR toggle: pension tax allocation rule row active.';
