-- Run this complete file once in Supabase Dashboard → SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.races (
  id text primary key,
  status text not null check (status in ('lobby', 'running', 'finished')),
  start_at bigint,
  ends_at bigint,
  created_at timestamptz not null default now()
);

create table if not exists public.participants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  lead_name text not null default '',
  lead_phone text not null default '',
  car_color text not null default '#e83e32',
  session_token_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.results (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id),
  race_id text not null references public.races(id),
  status text not null check (status in ('ready', 'racing', 'finished', 'dnf')),
  start_at bigint not null default 0,
  finish_at bigint,
  elapsed_ms bigint,
  faults integer not null default 0,
  correct_answers integer not null default 0,
  incorrect_attempts integer not null default 0,
  final_score integer not null default 0,
  qualified_at bigint,
  retry_at bigint,
  created_at timestamptz not null default now(),
  unique (participant_id, race_id)
);

create table if not exists public.faults (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id),
  race_id text not null references public.races(id),
  fault_type text not null,
  question_id text not null,
  triggered_at bigint not null,
  repaired_at bigint,
  attempts integer not null default 0
);

create index if not exists results_race_id_idx on public.results(race_id);
create index if not exists faults_participant_race_idx on public.faults(participant_id, race_id);

-- Ensure all concurrent serverless requests converge on the same active race.
create or replace function public.ensure_active_race()
returns setof public.races
language plpgsql
security definer
set search_path = public
as $$
declare
  active_row public.races%rowtype;
begin
  perform pg_advisory_xact_lock(681923041);
  select * into active_row from public.races order by created_at desc limit 1;
  if not found or active_row.status = 'finished' then
    insert into public.races (id, status)
    values ('main-event-' || gen_random_uuid()::text, 'lobby')
    returning * into active_row;
  end if;
  return next active_row;
end;
$$;
revoke all on function public.ensure_active_race() from public, anon, authenticated;
grant execute on function public.ensure_active_race() to service_role;

-- Clients use only the Supabase anon key for authenticated Realtime subscriptions.
-- All reads and writes to application tables go through the Vercel API using the
-- service role key, which must never be placed in public files or browser config.
alter table public.races enable row level security;
alter table public.participants enable row level security;
alter table public.results enable row level security;
alter table public.faults enable row level security;

-- Race Realtime channels are intentionally public because players join without accounts.
-- Application data tables remain protected by RLS and have no anon policies.
