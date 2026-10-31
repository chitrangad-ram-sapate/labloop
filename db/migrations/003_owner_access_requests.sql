-- Host users may ask an administrator to grant resource-owner access.
-- Role changes remain restricted to the authenticated admin review action.
create table owner_access_requests (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles on delete cascade,
  department_id uuid not null references departments,
  reason text not null check (char_length(reason) between 20 and 1000),
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED')),
  reviewed_by uuid references profiles,
  reviewed_at timestamptz,
  decision_reason text,
  created_at timestamptz not null default now(),
  check ((status = 'PENDING' and reviewed_by is null and reviewed_at is null)
      or (status <> 'PENDING' and reviewed_by is not null and reviewed_at is not null))
);
create unique index owner_access_one_pending_per_profile
  on owner_access_requests (profile_id) where status = 'PENDING';
create index owner_access_requests_status_created
  on owner_access_requests (status, created_at);

alter table owner_access_requests enable row level security;

-- Migration 002 grants access to this dedicated server role. Add the new table
-- to its grants when that role exists; local postgres deployments need no extra grant.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'labloop_app') then
    execute 'grant select, insert, update on owner_access_requests to labloop_app';
  end if;
end $$;
