-- Run once in Supabase SQL Editor (existing balances and discoveries are retained).
alter table public.balances add column if not exists membership_number text;
create table if not exists public.discovered_programs (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 program_name text not null, category text not null, membership_number text, balance bigint,
 evidence text, discovered_at timestamptz default now(), confirmed boolean not null default false,
 unique(user_id,program_name));
alter table public.discovered_programs enable row level security;
drop policy if exists "read discoveries" on public.discovered_programs;
create policy "read discoveries" on public.discovered_programs for select to authenticated using ((select auth.uid())=user_id);
drop policy if exists "update discoveries" on public.discovered_programs;
create policy "update discoveries" on public.discovered_programs for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create table if not exists public.gmail_scan_state (
 user_id uuid primary key references auth.users(id) on delete cascade,
 refresh_token_encrypted text not null, access_token_encrypted text, access_expires_at timestamptz,
 phase text not null default 'historical', page_token text, scanned_total integer not null default 0,
 started_at timestamptz default now(), last_scan_at timestamptz, last_error text,
 retry_after timestamptz, updated_at timestamptz default now());
alter table public.gmail_scan_state enable row level security;
-- Sensitive tokens are intentionally readable only by the service role, not the browser.
create table if not exists public.gmail_processed_messages (
 user_id uuid not null references auth.users(id) on delete cascade,
 message_id text not null, processed_at timestamptz not null default now(),
 primary key(user_id,message_id));
alter table public.gmail_processed_messages enable row level security;
-- Legacy five-year scan state is not used by the new worker.
