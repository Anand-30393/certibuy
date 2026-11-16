-- Supabase-only SQL (docs/architecture.md §7). Idempotent: safe to run more than once.
-- On another Postgres, skip this file and redefine app.current_user_id() for that platform.

-- "Who is calling" = the Supabase Auth user.
CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS text
  LANGUAGE sql STABLE AS $$ SELECT auth.uid()::text $$;

-- profiles.id holds the auth user id as text (portable across auth providers). A foreign key to
-- auth.users (uuid) is not possible across types; the trigger below keeps the two in step.

-- Role bootstrap (X-02): a new auth user gets a profile with app_role = customer, once.
CREATE OR REPLACE FUNCTION app.handle_new_auth_user() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, app_role, updated_date)
  VALUES (
    NEW.id::text,
    NEW.email,
    coalesce(NEW.raw_user_meta_data ->> 'full_name', ''),
    'customer',
    now()
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION app.handle_new_auth_user();

-- Supabase roles that evaluate RLS policies or fire the auth trigger need the app schema.
GRANT USAGE ON SCHEMA app TO anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO anon, authenticated, service_role, supabase_auth_admin;

-- Storage: private personal media (signed URLs only) and public catalogue images.
INSERT INTO storage.buckets (id, name, public)
VALUES ('private-media', 'private-media', false), ('catalogue', 'catalogue', true)
ON CONFLICT (id) DO NOTHING;
-- No storage.objects policies for private-media: only the server (service role) issues
-- signed upload/download URLs after an application policy check.

-- Prisma's bookkeeping table is not business data; keep it out of the public Data API.
ALTER TABLE public._prisma_migrations ENABLE ROW LEVEL SECURITY;
