create table if not exists public.balances (
 user_id uuid not null references auth.users(id) on delete cascade,
 program_id text not null,
 balance bigint not null check (balance >= 0),
 source text not null check (source in ('manual','gmail')),
 verified_at timestamptz,
 evidence text,
 primary key(user_id,program_id)
);
alter table public.balances enable row level security;
create policy "read own balances" on public.balances for select to authenticated using ((select auth.uid())=user_id);
create policy "insert own balances" on public.balances for insert to authenticated with check ((select auth.uid())=user_id);
create policy "update own balances" on public.balances for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
