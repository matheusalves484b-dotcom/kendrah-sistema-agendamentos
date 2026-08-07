-- ============ Base schema (recreated) ============
CREATE TABLE public.profiles (
  id UUID NOT NULL PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  business_name TEXT,
  business_logo_url TEXT,
  whatsapp_number TEXT,
  slug TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.profiles TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own profile" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "Users can insert their own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can update their own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
CREATE POLICY "Public can view profiles for booking" ON public.profiles FOR SELECT TO anon USING (true);

CREATE TABLE public.services (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  duration INTEGER NOT NULL,
  price DECIMAL(10,2),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.services TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.services TO authenticated;
GRANT ALL ON public.services TO service_role;
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their own services" ON public.services FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Public can view services for booking" ON public.services FOR SELECT TO anon USING (true);

CREATE TABLE public.appointments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  service_id UUID NOT NULL REFERENCES public.services(id),
  service_name TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','confirmed','cancelled','completed')),
  notes TEXT,
  reminder_sent BOOLEAN NOT NULL DEFAULT false,
  user_id UUID NOT NULL REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT INSERT ON public.appointments TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.appointments TO authenticated;
GRANT ALL ON public.appointments TO service_role;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own appointments" ON public.appointments FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can update their own appointments" ON public.appointments FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete their own appointments" ON public.appointments FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Visitors can create valid appointments" ON public.appointments FOR INSERT TO anon, authenticated
WITH CHECK (
  status = 'confirmed'
  AND start_time > now()
  AND end_time > start_time
  AND end_time <= (start_time + '12:00:00'::interval)
  AND start_time < (now() + '1 year'::interval)
  AND service_id IS NOT NULL
  AND user_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.services s WHERE s.id = appointments.service_id AND s.user_id = appointments.user_id AND s.name = appointments.service_name)
  AND length(trim(both from customer_name)) BETWEEN 2 AND 100
  AND length(customer_email) BETWEEN 5 AND 255
  AND customer_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  AND length(regexp_replace(customer_phone, '\D', '', 'g')) BETWEEN 8 AND 15
  AND (notes IS NULL OR length(notes) <= 1000)
);

CREATE TABLE public.availability_slots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles(id),
  day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  is_available BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.availability_slots TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.availability_slots TO authenticated;
GRANT ALL ON public.availability_slots TO service_role;
ALTER TABLE public.availability_slots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their own availability" ON public.availability_slots FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Public can view availability for booking" ON public.availability_slots FOR SELECT TO anon USING (true);

-- ============ Functions & triggers ============
CREATE OR REPLACE FUNCTION public.generate_slug(input_text text)
RETURNS text LANGUAGE plpgsql SET search_path TO 'public' AS $function$
DECLARE base_slug TEXT; final_slug TEXT; counter INTEGER := 1;
BEGIN
  base_slug := LOWER(TRIM(REGEXP_REPLACE(input_text, '[^a-zA-Z0-9\s]', '', 'g')));
  base_slug := REGEXP_REPLACE(base_slug, '\s+', '-', 'g');
  base_slug := TRIM(base_slug, '-');
  IF base_slug = '' OR base_slug IS NULL THEN base_slug := 'user'; END IF;
  final_slug := base_slug;
  WHILE EXISTS(SELECT 1 FROM public.profiles WHERE slug = final_slug) LOOP
    final_slug := base_slug || '-' || counter; counter := counter + 1;
  END LOOP;
  RETURN final_slug;
END; $function$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE user_name TEXT; generated_slug TEXT;
BEGIN
  user_name := COALESCE(new.raw_user_meta_data ->> 'name', SPLIT_PART(new.email, '@', 1));
  generated_slug := public.generate_slug(user_name);
  INSERT INTO public.profiles (id, business_name, slug) VALUES (new.id, user_name, generated_slug);
  RETURN new;
END; $function$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

CREATE OR REPLACE FUNCTION public.prevent_appointment_overlap()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
  IF NEW.status IS DISTINCT FROM 'cancelled' AND EXISTS (
    SELECT 1 FROM public.appointments a
    WHERE a.user_id = NEW.user_id
      AND a.id IS DISTINCT FROM NEW.id
      AND COALESCE(a.status, 'confirmed') <> 'cancelled'
      AND a.start_time < NEW.end_time
      AND a.end_time > NEW.start_time
  ) THEN
    RAISE EXCEPTION 'APPOINTMENT_CONFLICT: horario ja ocupado' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END; $function$;

DROP TRIGGER IF EXISTS trg_prevent_appointment_overlap ON public.appointments;
CREATE TRIGGER trg_prevent_appointment_overlap
BEFORE INSERT OR UPDATE OF start_time, end_time, status, user_id ON public.appointments
FOR EACH ROW EXECUTE FUNCTION public.prevent_appointment_overlap();

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.generate_slug(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_appointment_overlap() FROM PUBLIC, anon, authenticated;

-- ============ Monthly report automation ============
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE TABLE public.report_settings (
  user_id UUID NOT NULL PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT true,
  recipient_email TEXT,
  include_csv BOOLEAN NOT NULL DEFAULT true,
  include_pdf BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.report_settings TO authenticated;
GRANT ALL ON public.report_settings TO service_role;
ALTER TABLE public.report_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own report settings" ON public.report_settings FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.monthly_reports (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  period TEXT NOT NULL,
  appointments_count INTEGER NOT NULL DEFAULT 0,
  csv_path TEXT,
  pdf_path TEXT,
  email_status TEXT NOT NULL DEFAULT 'pending',
  email_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, period)
);
GRANT SELECT ON public.monthly_reports TO authenticated;
GRANT ALL ON public.monthly_reports TO service_role;
ALTER TABLE public.monthly_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view their own monthly reports" ON public.monthly_reports FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $function$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $function$;

CREATE TRIGGER trg_report_settings_updated_at
BEFORE UPDATE ON public.report_settings
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

SELECT cron.schedule(
  'monthly-appointments-report',
  '0 11 1 * *',
  $$
  SELECT net.http_post(
    url := 'https://eplbavaaougnvyhlhbqy.supabase.co/functions/v1/monthly-report',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{"source":"cron"}'::jsonb
  );
  $$
);