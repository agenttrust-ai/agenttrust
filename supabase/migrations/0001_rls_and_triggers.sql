-- Row-level security and the profile-bootstrap trigger.
--
-- Kept separate from the Drizzle-managed schema (src/lib/db/schema.ts +
-- drizzle/migrations/) because both touch things Drizzle doesn't model:
-- RLS policies and a trigger on Supabase's own `auth.users` table. Run this
-- after the Drizzle migration, via the Supabase SQL editor or CLI.

-- ---------------------------------------------------------------------------
-- Profile bootstrap: every auth.users row gets a matching public.profiles row.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- A stock Supabase project already sets ALTER DEFAULT PRIVILEGES so new
-- tables in `public` are automatically granted to anon/authenticated/
-- service_role. These statements are belt-and-suspenders, not a
-- workaround: idempotent, and make this migration correct on its own
-- rather than depending on that project-level default having been (or
-- staying) configured. RLS is still what actually decides row visibility —
-- these grants only establish that the roles may attempt the operation.
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public
  to authenticated;
grant select on all tables in schema public to anon;
grant all on all tables in schema public to service_role;

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.agents enable row level security;
alter table public.api_keys enable row level security;
alter table public.health_checks enable row level security;
alter table public.incidents enable row level security;
alter table public.reliability_scores enable row level security;
alter table public.usage_counters enable row level security;
alter table public.audit_log enable row level security;

-- profiles: a user can read and update only their own row.
create policy "profiles: read own" on public.profiles
  for select using (id = auth.uid());
create policy "profiles: update own" on public.profiles
  for update using (id = auth.uid());

-- agents: owners have full control; the public can read active+public agents.
create policy "agents: owners manage" on public.agents
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "agents: public reads active public agents" on public.agents
  for select using (visibility = 'public' and lifecycle_status = 'active');

-- api_keys: owner-only, never publicly readable (only the hash is stored,
-- but the row also carries the key's name and scopes).
create policy "api_keys: owner manages" on public.api_keys
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- health_checks / incidents / reliability_scores: readable when the parent
-- agent is public+active, or owned by the requester. Writes happen only via
-- the service-role client (cron jobs, once built) — no insert/update/delete
-- policy is defined for regular users, so RLS denies those by default.
create policy "health_checks: read if agent visible" on public.health_checks
  for select using (
    exists (
      select 1 from public.agents a
      where a.id = health_checks.agent_id
        and (a.owner_id = auth.uid()
             or (a.visibility = 'public' and a.lifecycle_status = 'active'))
    )
  );

create policy "incidents: read if agent visible" on public.incidents
  for select using (
    exists (
      select 1 from public.agents a
      where a.id = incidents.agent_id
        and (a.owner_id = auth.uid()
             or (a.visibility = 'public' and a.lifecycle_status = 'active'))
    )
  );

create policy "reliability_scores: read if agent visible" on public.reliability_scores
  for select using (
    exists (
      select 1 from public.agents a
      where a.id = reliability_scores.agent_id
        and (a.owner_id = auth.uid()
             or (a.visibility = 'public' and a.lifecycle_status = 'active'))
    )
  );

-- usage_counters: owner can view their own key's usage; no user-facing writes.
create policy "usage_counters: owner reads own" on public.usage_counters
  for select using (
    exists (
      select 1 from public.api_keys k
      where k.id = usage_counters.api_key_id and k.owner_id = auth.uid()
    )
  );

-- audit_log: owner can read entries about their own agents/actions; no
-- user-facing writes — only the service role writes audit entries.
create policy "audit_log: owner reads own" on public.audit_log
  for select using (actor_id = auth.uid());
