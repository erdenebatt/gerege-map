-- RPC function for spatial radius search on geo_registry
create or replace function nearby_search(
  lat double precision,
  lon double precision,
  radius_m double precision default 1000,
  max_results int default 50
)
returns table (
  id uuid,
  raw_address text,
  standardized_address jsonb,
  coordinates text,
  source text,
  confidence_score float,
  created_at timestamptz,
  distance_m double precision
)
language sql stable
as $$
  select
    g.id,
    g.raw_address,
    g.standardized_address,
    st_asgeojson(g.coordinates)::text as coordinates,
    g.source,
    g.confidence_score,
    g.created_at,
    st_distance(g.coordinates, st_point(lon, lat)::geography) as distance_m
  from geo_registry g
  where st_dwithin(g.coordinates, st_point(lon, lat)::geography, radius_m)
  order by distance_m asc
  limit max_results;
$$;
