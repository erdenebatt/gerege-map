-- RPC function for spatial clustering using PostGIS ST_ClusterDBSCAN
create or replace function spatial_clusters(
  lat double precision,
  lon double precision,
  radius_m double precision default 5000,
  cluster_distance_m double precision default 500,
  min_points int default 1
)
returns table (
  cluster_id int,
  cluster_center text,
  point_count bigint,
  addresses text[],
  avg_confidence float
)
language sql stable
as $$
  with clustered as (
    select
      g.id,
      g.raw_address,
      g.coordinates,
      g.confidence_score,
      st_clusterdbscan(
        g.coordinates::geometry,
        eps := cluster_distance_m / 111320.0,  -- approximate degrees from meters
        minpoints := min_points
      ) over () as cid
    from geo_registry g
    where st_dwithin(g.coordinates, st_point(lon, lat)::geography, radius_m)
  )
  select
    c.cid as cluster_id,
    st_asgeojson(
      st_centroid(st_collect(c.coordinates::geometry))::geography
    )::text as cluster_center,
    count(*) as point_count,
    array_agg(c.raw_address) as addresses,
    round(avg(c.confidence_score)::numeric, 2)::float as avg_confidence
  from clustered c
  where c.cid is not null
  group by c.cid
  order by point_count desc;
$$;
