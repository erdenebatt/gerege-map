-- Geofences table for defining geographic boundaries
create table geofences (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  boundary geography(polygon, 4326) not null,
  metadata jsonb default '{}',
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz default now()
);

-- GIST index for fast spatial containment checks
create index idx_geofences_boundary on geofences using gist (boundary);

-- Enable RLS
alter table geofences enable row level security;

create policy "Authenticated users can view geofences"
  on geofences for select to authenticated using (true);

create policy "Authenticated users can insert geofences"
  on geofences for insert to authenticated
  with check (auth.uid() = created_by);

create policy "Users can update own geofences"
  on geofences for update to authenticated
  using (auth.uid() = created_by)
  with check (auth.uid() = created_by);

create policy "Users can delete own geofences"
  on geofences for delete to authenticated
  using (auth.uid() = created_by);

-- RPC: check which geofences contain a given point
create or replace function geofence_check(
  lat double precision,
  lon double precision
)
returns table (
  id uuid,
  name text,
  description text,
  metadata jsonb,
  boundary text
)
language sql stable
as $$
  select
    g.id,
    g.name,
    g.description,
    g.metadata,
    st_asgeojson(g.boundary)::text as boundary
  from geofences g
  where st_covers(g.boundary, st_point(lon, lat)::geography);
$$;

-- RPC: find geo_registry entries inside a geofence
create or replace function geofence_entries(
  fence_id uuid,
  max_results int default 100
)
returns table (
  id uuid,
  raw_address text,
  standardized_address jsonb,
  coordinates text,
  source text,
  confidence_score float,
  created_at timestamptz
)
language sql stable
as $$
  select
    r.id,
    r.raw_address,
    r.standardized_address,
    st_asgeojson(r.coordinates)::text as coordinates,
    r.source,
    r.confidence_score,
    r.created_at
  from geo_registry r
  inner join geofences g on g.id = fence_id
  where st_covers(g.boundary, r.coordinates)
  limit max_results;
$$;
