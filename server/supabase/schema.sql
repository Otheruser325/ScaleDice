-- Scale Dice online storage schema.
-- Run this once in the Supabase SQL editor for the project referenced by
-- SUPABASE_URL. The server uses the service-role key, so no public policies are
-- needed; RLS is enabled to deny accidental anon/client access.

create table if not exists public.users (
  id text primary key,
  name text not null,
  type text not null default 'guest',
  guest_password text,
  oauth_provider text,
  oauth_provider_id text,
  avatar text,
  country text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists users_name_lower_idx on public.users (lower(name));
create index if not exists users_oauth_provider_id_idx on public.users (oauth_provider_id);

alter table public.users enable row level security;

create table if not exists public.lobbies (
  code text primary key,
  host_user_id text not null,
  host_socket_id text,
  players jsonb not null default '[]'::jsonb,
  config jsonb not null default '{}'::jsonb,
  starting boolean not null default false,
  finished boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists lobbies_updated_at_idx on public.lobbies (updated_at);

alter table public.lobbies enable row level security;
