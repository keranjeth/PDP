CREATE OR REPLACE FUNCTION public.normalize_payroll_month_key_before_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  raw_value text;
  year_text text;
  month_text text;
  normalized text;
BEGIN
  raw_value := btrim(COALESCE(NEW.month_key, ''));
  raw_value := regexp_replace(raw_value, '^[\uFEFF]+', '', 'g');
  raw_value := translate(raw_value, E'‐‑‒–—―−﹘﹣－', '----------');
  raw_value := regexp_replace(raw_value, '[\u200E\u200F\u202A-\u202E]', '', 'g');

  IF raw_value ~ '^\d{4}-\d{1,2}$' THEN
    year_text := substring(raw_value from '^(\d{4})');
    month_text := substring(raw_value from '^\d{4}-(\d{1,2})$');
  ELSIF raw_value ~ '^\d{4}-\d{1,2}-\d{1,2}([Tt ].*)?$' THEN
    year_text := substring(raw_value from '^(\d{4})');
    month_text := substring(raw_value from '^\d{4}-(\d{1,2})');
  ELSIF raw_value ~ '^\d{4}[./]\d{1,2}([./]\d{1,2})?([Tt ].*)?$' THEN
    year_text := substring(raw_value from '^(\d{4})');
    month_text := substring(raw_value from '^\d{4}[./](\d{1,2})');
  ELSE
    RETURN NEW;
  END IF;

  IF month_text::int BETWEEN 1 AND 12 THEN
    normalized := year_text || '-' || lpad(month_text, 2, '0');
    NEW.month_key := normalized;
  END IF;

  RETURN NEW;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public.payroll_months'::regclass
      AND tgname = 'trg_payroll_months_normalize_key'
  ) THEN
    CREATE TRIGGER trg_payroll_months_normalize_key
      BEFORE INSERT OR UPDATE OF month_key ON public.payroll_months
      FOR EACH ROW
      EXECUTE FUNCTION public.normalize_payroll_month_key_before_write();
  END IF;
END $$;

