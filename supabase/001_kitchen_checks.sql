-- No Saints Kitchen Checks: records schema
-- One row per check. Rows can be added by staff but never edited or deleted (append-only),
-- so the archive shown to an inspector is exactly what was entered, with the server time it was stored.

create table if not exists public.staff (
  email      text primary key,
  name       text,
  added_at   timestamptz not null default now()
);
alter table public.staff enable row level security;
-- no policies on staff: the list is managed by the owner in the Supabase dashboard / SQL only.

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff s where lower(s.email) = lower(coalesce(auth.jwt() ->> 'email','')));
$$;
revoke all on function public.is_staff() from public;
grant execute on function public.is_staff() to authenticated;

create table if not exists public.kitchen_checks (
  id            text primary key check (char_length(id) between 4 and 64),
  day           date not null,
  recorded_at   timestamptz not null,           -- time on the phone when the check was entered
  entry         jsonb not null,                 -- the full check: reading, result, initials, action, product
  created_at    timestamptz not null default now(), -- time the server stored it
  created_by    uuid not null default auth.uid() references auth.users(id),
  created_email text default (auth.jwt() ->> 'email')
);
create index if not exists kitchen_checks_day_idx on public.kitchen_checks (day, recorded_at);
alter table public.kitchen_checks enable row level security;

create policy "staff read records" on public.kitchen_checks
  for select to authenticated using (public.is_staff());
create policy "staff add records" on public.kitchen_checks
  for insert to authenticated with check (public.is_staff() and created_by = auth.uid());

revoke update, delete, truncate on public.kitchen_checks from anon, authenticated;
revoke all on public.kitchen_checks from anon;

create or replace function public.kitchen_checks_append_only() returns trigger
language plpgsql set search_path = public as $$
begin
  raise exception 'Kitchen records are append-only. Record a correction as a new check instead.';
end $$;
drop trigger if exists kitchen_checks_no_change on public.kitchen_checks;
create trigger kitchen_checks_no_change before update or delete on public.kitchen_checks
  for each row execute function public.kitchen_checks_append_only();
