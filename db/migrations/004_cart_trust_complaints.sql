-- Multi-unit resource reservations, temporary cart holds, trust identity and
-- booking-linked complaint history. Existing booking rows remain the lifecycle
-- records; booking_requests groups the per-resource rows from one cart submit.

alter table profiles
  add column trust_id text not null default ('LL-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)));
create unique index profiles_trust_id_unique on profiles (trust_id);

alter table resources
  add column units_available integer not null default 1 check (units_available > 0);

create table booking_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles on delete restrict,
  created_at timestamptz not null default now(),
  unique (id, user_id)
);
create index booking_requests_user_created on booking_requests (user_id, created_at desc);

alter table bookings
  add column quantity integer not null default 1 check (quantity > 0),
  add column request_group_id uuid,
  add constraint bookings_request_owner_fk foreign key (request_group_id, user_id)
    references booking_requests (id, user_id) on delete restrict,
  add constraint bookings_trust_owner_ref unique (id, user_id),
  add constraint bookings_request_item_ref unique (id, request_group_id, resource_id, quantity, user_id);

-- Capacity is enforced by a serialized trigger instead of the former one-booking
-- exclusion constraint, so a resource with multiple units can accept overlapping
-- reservations up to its configured quantity.
alter table bookings drop constraint if exists no_overlap;

create table cart_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles on delete cascade,
  resource_id uuid not null references resources on delete cascade,
  quantity integer not null check (quantity > 0),
  start_at timestamptz not null,
  end_at timestamptz not null,
  turnaround_min integer not null check (turnaround_min >= 0),
  slot tstzrange not null,
  purpose_category text not null check (purpose_category in ('COURSEWORK','RESEARCH','PROJECT','SELF_LEARNING')),
  purpose_text text not null,
  team_code text,
  hold_expires_at timestamptz not null default (now() + interval '12 minutes'),
  created_at timestamptz not null default now(),
  check (end_at > start_at),
  check (not isempty(slot)),
  check (slot = tstzrange(start_at, end_at + make_interval(mins => turnaround_min), '[)'))
);
create index cart_items_expiry on cart_items (hold_expires_at);
create index cart_items_resource_slot on cart_items (resource_id, hold_expires_at);
create index cart_items_user_expiry on cart_items (user_id, hold_expires_at);
create index cart_items_slot_gist on cart_items using gist (slot);
create index bookings_holding_slot_gist on bookings using gist (slot)
  where status in ('APPROVED','OFFERED','IN_USE','OVERDUE');

create table booking_items (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  booking_id uuid not null unique,
  resource_id uuid not null,
  quantity integer not null check (quantity > 0),
  user_id uuid not null,
  created_at timestamptz not null default now(),
  foreign key (request_id, user_id) references booking_requests (id, user_id) on delete restrict,
  foreign key (booking_id, request_id, resource_id, quantity, user_id)
    references bookings (id, request_group_id, resource_id, quantity, user_id) on delete cascade
);
create index booking_items_request on booking_items (request_id);

-- Returns peak concurrent units already held in a requested time range. The
-- function is used by the UI and the booking trigger; range endpoints are [).
create function labloop_resource_peak(
  p_resource_id uuid,
  p_window tstzrange,
  p_skip_booking uuid default null,
  p_skip_cart uuid default null,
  p_only_carts boolean default false,
  p_only_bookings boolean default false,
  p_skip_user uuid default null
) returns integer
language sql volatile as $$
  with occupancy as (
    select b.slot, b.quantity
    from bookings b
    where not p_only_carts
      and b.resource_id = p_resource_id
      and b.id is distinct from p_skip_booking
      and b.status in ('APPROVED','OFFERED','IN_USE','OVERDUE')
      and b.slot && p_window
    union all
    select c.slot, c.quantity
    from cart_items c
    where not p_only_bookings
      and c.resource_id = p_resource_id
      and c.id is distinct from p_skip_cart
      and (p_skip_user is null or c.user_id <> p_skip_user)
      and c.hold_expires_at > now()
      and c.slot && p_window
  ),
  points as (
    select lower(p_window) as at
    union
    select lower(o.slot) from occupancy o
      where lower(o.slot) > lower(p_window) and lower(o.slot) < upper(p_window)
  ),
  used as (
    select p.at, coalesce(sum(o.quantity) filter (where o.slot @> p.at), 0)::integer as quantity
    from points p left join occupancy o on true
    group by p.at
  )
  select coalesce(max(quantity), 0)::integer from used
$$;

create function labloop_guard_resource_units() returns trigger
language plpgsql as $$
begin
  if new.units_available >= old.units_available then
    return new;
  end if;
  if exists (
    select 1 from (
      select slot from bookings where resource_id = old.id and status in ('APPROVED','OFFERED','IN_USE','OVERDUE')
      union all
      select slot from cart_items where resource_id = old.id and hold_expires_at > now()
    ) occupied_windows
    where labloop_resource_peak(old.id, occupied_windows.slot, null, null, false, false, null) > new.units_available
  ) then
    raise exception 'Unit count cannot be reduced below capacity already held by bookings or active carts.' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger resources_capacity_guard
  before update of units_available on resources
  for each row execute function labloop_guard_resource_units();

create function labloop_guard_resource_capacity() returns trigger
language plpgsql as $$
declare
  capacity integer;
  occupied integer;
begin
  if new.status not in ('APPROVED','OFFERED','IN_USE','OVERDUE') then
    return new;
  end if;

  -- Serialize approvals and checkouts for a resource so simultaneous requests
  -- cannot both observe the same remaining capacity.
  select units_available into capacity
    from resources where id = new.resource_id for update;
  if capacity is null then
    raise exception 'Resource no longer exists.' using errcode = '23503';
  end if;

  occupied := labloop_resource_peak(new.resource_id, new.slot, new.id, null, false, false, null);
  if occupied + new.quantity > capacity then
    raise exception 'Only % unit(s) are available for that time; % are already allocated.',
      greatest(capacity - occupied, 0), occupied using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger bookings_capacity_guard
  before insert or update on bookings
  for each row execute function labloop_guard_resource_capacity();

create table complaint_tickets (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings on delete cascade,
  opened_by uuid not null references profiles on delete restrict,
  issue_type text not null check (issue_type in ('DAMAGED_ITEM','MISSING_ACCESSORY','UNSAFE_SPACE','BOOKING_CONFLICT','ACCESSIBILITY','OTHER')),
  status text not null default 'OPEN' check (status in ('OPEN','OWNER_REVIEWING','ACTION_TAKEN','RESOLVED','ESCALATED','CLOSED')),
  ai_summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (booking_id, opened_by) references bookings (id, user_id) on delete cascade
);
create index complaint_tickets_booking on complaint_tickets (booking_id, created_at desc);
create index complaint_tickets_status on complaint_tickets (status, updated_at desc);

-- Messages are also the immutable status history: a status entry has status set
-- and a human-readable body; evidence remains private to booking participants.
create table complaint_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references complaint_tickets on delete cascade,
  author_id uuid references profiles on delete restrict,
  body text not null check (char_length(body) between 1 and 5000),
  status text check (status is null or status in ('OPEN','OWNER_REVIEWING','ACTION_TAKEN','RESOLVED','ESCALATED','CLOSED')),
  evidence text,
  created_at timestamptz not null default now()
);
create index complaint_messages_ticket_created on complaint_messages (ticket_id, created_at);

create function complaint_message_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'Complaint message and status history is append-only.';
end $$;
create trigger complaint_messages_immutable before update or delete on complaint_messages
  for each row execute function complaint_message_immutable();

alter table booking_requests enable row level security;
alter table booking_items enable row level security;
alter table cart_items enable row level security;
alter table complaint_tickets enable row level security;
alter table complaint_messages enable row level security;

-- The application uses the server-only database role and remains subject to the
-- app's explicit authorization checks. Add grants only when the role exists.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'labloop_app') then
    execute 'grant select, insert on booking_requests, booking_items to labloop_app';
    execute 'grant select, insert, update, delete on cart_items to labloop_app';
    execute 'grant select, insert, update on complaint_tickets to labloop_app';
    execute 'grant select, insert on complaint_messages to labloop_app';
    execute 'grant select on profiles, resources, bookings to labloop_app';
    execute 'grant usage, select on all sequences in schema public to labloop_app';
    execute 'grant execute on function labloop_resource_peak(uuid, tstzrange, uuid, uuid, boolean, boolean, uuid), labloop_guard_resource_units(), labloop_guard_resource_capacity(), complaint_message_immutable() to labloop_app';
  end if;
end $$;
