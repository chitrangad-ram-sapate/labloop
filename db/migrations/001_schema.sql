-- LabLoop schema. Applied in order; RLS is on everywhere with no policies,
-- so only the server's own connection (postgres role) can read or write.
create extension if not exists btree_gist with schema extensions;
create extension if not exists pgcrypto with schema extensions;

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null check (kind in ('HOST','PARTNER_COLLEGE','STARTUP')),
  email_domain text unique,
  agreement_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table departments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique
);

create table profiles (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  full_name text not null,
  org_id uuid not null references organizations,
  department_id uuid references departments,
  role text not null check (role in ('user','external','manager','owner','admin')),
  identity_status text not null default 'NOT_REQUIRED'
    check (identity_status in ('NOT_REQUIRED','PENDING','VERIFIED','REJECTED')),
  id_doc text,              -- data URL, visible to managers only
  id_ai_check jsonb,
  identity_reason text,
  team_code text,
  suspended_until timestamptz,
  created_at timestamptz not null default now()
);

create table credential_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text not null default '',
  validity_days int
);

create table user_credentials (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles on delete cascade,
  credential_type_id uuid not null references credential_types,
  status text not null check (status in ('PENDING','VERIFIED','REJECTED')),
  evidence text,            -- data URL
  ai_check jsonb,
  decided_by uuid references profiles,
  decision_reason text,
  decided_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table resources (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references departments,
  owner_id uuid not null references profiles,
  name text not null,
  category text not null check (category in ('space','equipment','computing','media')),
  description text not null default '',
  location text not null default '',
  photo text,
  usage_rules text not null default '',
  checklist text[] not null default '{}',
  open_from time not null default '09:00',
  open_to time not null default '18:00',
  max_duration_min int not null default 180,
  turnaround_min int not null default 15,
  advance_days int not null default 14,
  requires_supervision boolean not null default false,
  supervise_externals boolean not null default true,
  open_to_externals boolean not null default true,
  deposit_note text,
  high_demand boolean not null default false,
  max_hours_week int not null default 6,
  cooldown_hours int not null default 0,
  external_max_pct int not null default 30,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','MAINTENANCE','RETIRED')),
  qr_token text not null unique default encode(extensions.gen_random_bytes(9), 'hex'),
  created_at timestamptz not null default now()
);

create table resource_requirements (
  resource_id uuid not null references resources on delete cascade,
  credential_type_id uuid not null references credential_types,
  primary key (resource_id, credential_type_id)
);

create table bookings (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references resources,
  user_id uuid not null references profiles,
  start_at timestamptz not null,
  end_at timestamptz not null,
  slot tstzrange not null,  -- [start, end + turnaround)
  purpose_category text not null
    check (purpose_category in ('COURSEWORK','RESEARCH','PROJECT','SELF_LEARNING')),
  purpose_text text not null,
  team_code text,
  status text not null check (status in ('PENDING_REVIEW','APPROVED','REJECTED','WAITLISTED','OFFERED',
    'CANCELLED','IN_USE','OVERDUE','RETURNED','CLOSED','DISPUTED','NO_SHOW')),
  decision_reason text,
  decided_by uuid references profiles,
  score numeric,
  score_breakdown jsonb,
  offer_expires_at timestamptz,
  requested_end_at timestamptz,   -- pending extension request
  checked_out_at timestamptz,
  returned_at timestamptz,
  reminded_at timestamptz,
  created_at timestamptz not null default now(),
  check (end_at > start_at),
  -- the double-booking guard: two holding bookings can never overlap
  constraint no_overlap exclude using gist (resource_id with =, slot with &&)
    where (status in ('APPROVED','OFFERED','IN_USE','OVERDUE'))
);
create index on bookings (resource_id, start_at);
create index on bookings (user_id, status);

create table condition_reports (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings on delete cascade,
  phase text not null check (phase in ('CHECKOUT','RETURN')),
  checklist jsonb not null,       -- {"Lens clean": "ok" | "issue"}
  photo text,
  notes text not null default '',
  recorded_by uuid not null references profiles,
  ai_diff jsonb,
  created_at timestamptz not null default now(),
  unique (booking_id, phase)
);

create table incidents (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references bookings,
  resource_id uuid not null references resources,
  reported_by uuid not null references profiles,
  type text not null check (type in ('DAMAGE','DELAY','CONFLICT','MISUSE','SAFETY')),
  severity text not null check (severity in ('LOW','MEDIUM','HIGH')),
  description text not null,
  ai_summary text,
  status text not null default 'OPEN' check (status in ('OPEN','RESOLVED')),
  resolution text,
  penalty text check (penalty in ('NONE','WARNING','STRIKE','SUSPEND_7D')),
  reviewed_by uuid references profiles,
  appeal_text text,
  appeal_status text check (appeal_status in ('PENDING','UPHELD','OVERTURNED')),
  created_at timestamptz not null default now()
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles on delete cascade,
  title text not null,
  body text not null default '',
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index on notifications (user_id, created_at desc);

-- Append-only, hash-chained audit log
create table audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor_id uuid references profiles,
  actor_role text,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  reason text,
  data jsonb,
  prev_hash text not null default '',
  hash text not null default ''
);
create index on audit_log (entity_type, entity_id);

create function audit_hash(p_prev text, p_at timestamptz, p_actor uuid, p_action text,
  p_etype text, p_eid uuid, p_reason text, p_data jsonb) returns text
language sql immutable as $$
  select encode(extensions.digest(concat_ws('|', p_prev, extract(epoch from p_at)::text,
    coalesce(p_actor::text,''), p_action, p_etype, coalesce(p_eid::text,''),
    coalesce(p_reason,''), coalesce(p_data::text,'')), 'sha256'), 'hex')
$$;

create function audit_chain() returns trigger language plpgsql as $$
begin
  perform pg_advisory_xact_lock(4242);
  select hash into new.prev_hash from audit_log order by id desc limit 1;
  new.prev_hash := coalesce(new.prev_hash, 'GENESIS');
  new.hash := audit_hash(new.prev_hash, new.at, new.actor_id, new.action,
    new.entity_type, new.entity_id, new.reason, new.data);
  return new;
end $$;
create trigger audit_chain before insert on audit_log for each row execute function audit_chain();

create function audit_immutable() returns trigger language plpgsql as $$
begin raise exception 'audit_log is append-only'; end $$;
create trigger audit_immutable before update or delete on audit_log
  for each row execute function audit_immutable();

create function audit_verify() returns table (ok boolean, broken_id bigint, checked bigint)
language plpgsql as $$
declare r record; prev text := 'GENESIS'; n bigint := 0;
begin
  for r in select * from audit_log order by id loop
    n := n + 1;
    if r.prev_hash <> prev or r.hash <> audit_hash(r.prev_hash, r.at, r.actor_id, r.action,
        r.entity_type, r.entity_id, r.reason, r.data) then
      return query select false, r.id, n; return;
    end if;
    prev := r.hash;
  end loop;
  return query select true, null::bigint, n;
end $$;

alter table organizations enable row level security;
alter table departments enable row level security;
alter table profiles enable row level security;
alter table credential_types enable row level security;
alter table user_credentials enable row level security;
alter table resources enable row level security;
alter table resource_requirements enable row level security;
alter table bookings enable row level security;
alter table condition_reports enable row level security;
alter table incidents enable row level security;
alter table notifications enable row level security;
alter table audit_log enable row level security;
