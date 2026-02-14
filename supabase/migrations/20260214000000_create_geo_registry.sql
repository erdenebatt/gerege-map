-- Enable PostGIS extension for spatial data support
create extension if not exists postgis with schema extensions;

-- Create geo_registry table for location intelligence
create table geo_registry (
  id uuid primary key default gen_random_uuid(),
  raw_address text not null,
  standardized_address jsonb,
  coordinates geography(point, 4326),
  source text,
  confidence_score float,
  created_at timestamptz default now()
);

-- GIST index on coordinates for efficient spatial queries
create index idx_geo_registry_coordinates
  on geo_registry using gist (coordinates);
