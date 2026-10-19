-- Run against a project with an active super_admin and at least two training budgets.
-- Every test runs inside a transaction that is rolled back; no test records remain.
BEGIN;
SELECT set_config('request.jwt.claim.sub',user_id::text,true),
       set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'role','authenticated')::text,true),
       set_config('app.training_test_org',org_id::text,true)
FROM public.organization_members WHERE status='active' AND role='super_admin' LIMIT 1;
SET LOCAL ROLE authenticated;
DO $test$
DECLARE b record; dst record; t uuid; t2 uuid; old_balance numeric; n numeric; rejected boolean; result jsonb; payload jsonb;
BEGIN
  SELECT * INTO b FROM public.v_employee_budget_list WHERE org_id=current_setting('app.training_test_org')::uuid AND current_amount>=1000 LIMIT 1;
  IF b.id IS NULL THEN RAISE EXCEPTION 'No accessible test budget'; END IF;
  SELECT * INTO dst FROM public.v_employee_budget_list WHERE org_id=b.org_id AND id<>b.id AND currency=b.currency AND employee_id<>b.employee_id LIMIT 1;
  old_balance:=b.remaining_amount;
  INSERT INTO public.training_records(org_id,employee_id,budget_id,course_title,delivery_method,training_start_date,training_end_date,training_cost,additional_cost,additional_cost_note,currency,funding_sources)
  VALUES(b.org_id,b.employee_id,b.id,'Transaction-only training test','In Person','2026-10-01','2026-10-02',100,20,'Travel',b.currency,'[{"name":"Test funding","amount":120}]') RETURNING id INTO t;
  SELECT remaining_amount INTO n FROM public.v_employee_budget_list WHERE id=b.id;
  IF n<>old_balance-120 OR public.employee_budget_actual_training_cost(b.id)<>120 OR NOT public.employee_budget_has_transactions(b.id) THEN RAISE EXCEPTION 'Create cost/balance failed'; END IF;
  UPDATE public.training_records SET training_cost=150,funding_sources='[{"name":"Test funding","amount":170}]' WHERE id=t;
  SELECT remaining_amount INTO n FROM public.v_employee_budget_list WHERE id=b.id;
  IF n<>old_balance-170 THEN RAISE EXCEPTION 'Update deducted twice'; END IF;
  INSERT INTO public.training_records(org_id,employee_id,budget_id,course_title,delivery_method,training_start_date,training_end_date,training_cost,currency)
  VALUES(b.org_id,b.employee_id,b.id,'Transaction-only training test','Online','2026-10-03','2026-10-03',30,b.currency) RETURNING id INTO t2;
  SELECT remaining_amount INTO n FROM public.v_employee_budget_list WHERE id=b.id;
  IF n<>old_balance-200 THEN RAISE EXCEPTION 'Repeat participation failed'; END IF;
  rejected:=false;
  BEGIN
    INSERT INTO public.training_records(org_id,employee_id,budget_id,course_title,delivery_method,training_start_date,training_end_date,training_cost,currency)
    VALUES(b.org_id,b.employee_id,b.id,'Transaction-only training test','Online','2026-10-03','2026-10-03',30,b.currency);
  EXCEPTION WHEN unique_violation THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Duplicate participation accepted'; END IF;
  rejected:=false;
  BEGIN UPDATE public.training_records SET currency=CASE WHEN b.currency='AFN' THEN 'USD' ELSE 'AFN' END WHERE id=t;
  EXCEPTION WHEN invalid_parameter_value THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Mixed currency accepted'; END IF;
  rejected:=false;
  BEGIN UPDATE public.training_records SET funding_sources='[{"name":"Wrong total","amount":1}]' WHERE id=t;
  EXCEPTION WHEN invalid_parameter_value THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Invalid funding split accepted'; END IF;
  rejected:=false;
  BEGIN UPDATE public.training_records SET additional_cost_note='' WHERE id=t;
  EXCEPTION WHEN check_violation THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Additional cost note missing'; END IF;
  rejected:=false;
  BEGIN UPDATE public.training_records SET training_end_date='2026-09-01' WHERE id=t;
  EXCEPTION WHEN check_violation THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Invalid date range accepted'; END IF;
  IF dst.id IS NOT NULL THEN
    rejected:=false;
    BEGIN UPDATE public.training_records SET budget_id=dst.id WHERE id=t;
    EXCEPTION WHEN invalid_parameter_value THEN rejected:=true; END;
    IF NOT rejected THEN RAISE EXCEPTION 'Another employee budget accepted'; END IF;
    rejected:=false;
    BEGIN PERFORM public.reallocate_employee_budget(b.org_id,b.id,dst.id,old_balance-199,'Rollback-only test');
    EXCEPTION WHEN raise_exception THEN rejected:=true; END;
    IF NOT rejected THEN RAISE EXCEPTION 'Transfer spent budget accepted'; END IF;
  END IF;
  rejected:=false;
  BEGIN PERFORM public.adjust_employee_budget(b.org_id,b.id,'decrease',old_balance-199,'Rollback-only test');
  EXCEPTION WHEN raise_exception THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Decrease spent budget accepted'; END IF;
  payload:=jsonb_build_array(jsonb_build_object('employee_id',b.employee_id,'budget_id',b.id,'course_title','Atomic import test','delivery_method','Hybrid','training_start_date','2026-10-04','training_end_date','2026-10-04','training_cost',10,'currency',b.currency));
  result:=public.import_training_records(b.org_id,payload);
  IF (result->>'imported')::integer<>1 THEN RAISE EXCEPTION 'Import failed'; END IF;
  result:=public.import_training_records(b.org_id,payload);
  IF (result->>'imported')::integer<>0 OR (result->>'skipped')::integer<>1 THEN RAISE EXCEPTION 'Import retry duplicated cost'; END IF;
  rejected:=false;
  BEGIN PERFORM public.import_training_records(b.org_id,jsonb_build_array(
    (payload->0)||jsonb_build_object('course_title','Atomic rollback test'),
    (payload->0)||jsonb_build_object('course_title','Invalid import test','delivery_method','Invalid')));
  EXCEPTION WHEN check_violation THEN rejected:=true; END;
  IF NOT rejected OR EXISTS(SELECT 1 FROM public.training_records WHERE org_id=b.org_id AND course_title='Atomic rollback test') THEN RAISE EXCEPTION 'Invalid import did not roll back'; END IF;
  UPDATE public.training_records SET deleted_at=now() WHERE id IN(t,t2);
  SELECT remaining_amount INTO n FROM public.v_employee_budget_list WHERE id=b.id;
  IF n<>old_balance-10 OR EXISTS(SELECT 1 FROM public.v_training_record_list WHERE id IN(t,t2)) THEN RAISE EXCEPTION 'Soft deletion balance/list failed'; END IF;
END $test$;
SET LOCAL ROLE anon;
DO $anon$
DECLARE rejected boolean:=false;
BEGIN
  BEGIN PERFORM count(*) FROM public.training_records; EXCEPTION WHEN insufficient_privilege THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Anonymous training access allowed'; END IF;
END $anon$;
RESET ROLE;
SELECT 'Training create/edit/repeat dates/duplicates/funding/currency/date checks/budget guards/atomic import/deletion/anonymous access passed.' AS result;
ROLLBACK;

-- Regional HR must not read or modify another region's participation.
BEGIN;
SELECT set_config('request.jwt.claim.sub',user_id::text,true),
       set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'role','authenticated')::text,true),
       set_config('app.training_test_org',org_id::text,true)
FROM public.organization_members WHERE status='active' AND role='super_admin' LIMIT 1;
DO $setup$
DECLARE a record; b record;
BEGIN
  SELECT id,region INTO a FROM public.employees WHERE org_id=current_setting('app.training_test_org')::uuid AND deleted_at IS NULL AND coalesce(region,'')<>'' LIMIT 1;
  SELECT id,region INTO b FROM public.employees WHERE org_id=current_setting('app.training_test_org')::uuid AND deleted_at IS NULL AND coalesce(region,'')<>'' AND region<>a.region LIMIT 1;
  IF b.id IS NULL THEN RAISE EXCEPTION 'Two employee regions are required for RLS test'; END IF;
  PERFORM set_config('app.training_test_allowed',a.id::text,true);
  PERFORM set_config('app.training_test_denied',b.id::text,true);
  INSERT INTO public.training_records(org_id,employee_id,course_title,delivery_method,training_start_date,training_end_date,training_cost,currency)
    VALUES(current_setting('app.training_test_org')::uuid,a.id,'Regional access test','Online','2026-10-10','2026-10-10',0,'AFN'),
          (current_setting('app.training_test_org')::uuid,b.id,'Regional access test','Online','2026-10-10','2026-10-10',0,'AFN');
  DELETE FROM public.organization_member_regions WHERE org_id=current_setting('app.training_test_org')::uuid AND user_id=auth.uid();
  INSERT INTO public.organization_member_regions(org_id,user_id,region) VALUES(current_setting('app.training_test_org')::uuid,auth.uid(),a.region);
  UPDATE public.organization_members SET role='regional_hr' WHERE org_id=current_setting('app.training_test_org')::uuid AND user_id=auth.uid();
END $setup$;
SET LOCAL ROLE authenticated;
DO $regional$
DECLARE n integer; rejected boolean:=false;
BEGIN
  SELECT count(*) INTO n FROM public.v_training_record_list WHERE course_title='Regional access test';
  IF n<>1 THEN RAISE EXCEPTION 'Regional training view exposed another region'; END IF;
  BEGIN
    INSERT INTO public.training_records(org_id,employee_id,course_title,delivery_method,training_start_date,training_end_date,training_cost,currency)
      VALUES(current_setting('app.training_test_org')::uuid,current_setting('app.training_test_denied')::uuid,'Denied regional test','Online','2026-10-11','2026-10-11',0,'AFN');
  EXCEPTION WHEN insufficient_privilege THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Regional HR created another region training'; END IF;
  rejected:=false;
  BEGIN UPDATE public.training_records SET deleted_at=now() WHERE course_title='Regional access test';
  EXCEPTION WHEN insufficient_privilege THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Regional HR deleted training without delete permission'; END IF;
END $regional$;
RESET ROLE;
SELECT 'Regional read/write/delete restrictions passed; membership and test records rolled back.' AS result;
ROLLBACK;
