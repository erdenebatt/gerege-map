# map.gerege.ai

Location intelligence system built on Supabase and PostGIS.

## Architecture

- **Database**: PostgreSQL + PostGIS on Supabase
- **Auth**: Supabase Auth with Row Level Security
- **API**: Supabase Edge Functions (Deno)
- **Geocoding**: OpenStreetMap Nominatim

## Database Schema

### `geo_registry`

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `raw_address` | text | Original input address |
| `standardized_address` | jsonb | Structured address components |
| `coordinates` | geography(Point, 4326) | Spatial coordinates (GIST indexed) |
| `source` | text | Data source identifier |
| `confidence_score` | float | Geocoding confidence (0-1) |
| `created_by` | uuid | References `auth.users` |
| `created_at` | timestamptz | Row creation timestamp |

Row Level Security is enabled — authenticated users can read all entries but can only modify their own.

### `geofences`

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `name` | text | Geofence name |
| `description` | text | Optional description |
| `boundary` | geography(Polygon, 4326) | Polygon boundary (GIST indexed) |
| `metadata` | jsonb | Custom metadata |
| `created_by` | uuid | References `auth.users` |
| `created_at` | timestamptz | Row creation timestamp |

## Edge Functions

### `POST /geocode`

Forward geocode an address and store the result.

```json
{ "address": "Sukhbaatar Square, Ulaanbaatar", "source": "user_input" }
```

### `POST /reverse-geocode`

Reverse geocode coordinates and store the result.

```json
{ "lat": 47.9184, "lon": 106.9177 }
```

### `POST /nearby-search`

Find entries within a radius (meters) of a point.

```json
{ "lat": 47.9184, "lon": 106.9177, "radius_m": 5000, "max_results": 20 }
```

### `POST /batch-geocode`

Geocode up to 50 addresses in a single request.

```json
{ "addresses": ["Ulaanbaatar", "Darkhan", "Erdenet"], "source": "csv_import" }
```

### `POST /spatial-cluster`

Cluster nearby points using DBSCAN density-based algorithm.

```json
{ "lat": 47.9184, "lon": 106.9177, "radius_m": 10000, "cluster_distance_m": 1000, "min_points": 1 }
```

### `POST /geofence`

Manage geofences and check point containment. Uses an `action` field to select the operation:

**Create** a polygon geofence:
```json
{ "action": "create", "name": "Downtown UB", "polygon": [[106.9,47.91],[106.93,47.91],[106.93,47.93],[106.9,47.93],[106.9,47.91]] }
```

**Check** if a point is inside any geofence:
```json
{ "action": "check", "lat": 47.9184, "lon": 106.9177 }
```

**Entries** — find geo_registry rows inside a geofence:
```json
{ "action": "entries", "fence_id": "uuid-here" }
```

**List** all geofences:
```json
{ "action": "list" }
```

## Setup

```bash
# Install Supabase CLI
npm install -g supabase

# Link to your project
supabase link --project-ref <your-project-ref>

# Run migrations
supabase db push

# Deploy Edge Functions
supabase functions deploy geocode
supabase functions deploy reverse-geocode
supabase functions deploy nearby-search
supabase functions deploy batch-geocode
supabase functions deploy spatial-cluster
supabase functions deploy geofence
```

## Project Structure

```
supabase/
  migrations/
    20260214000000_create_geo_registry.sql    # PostGIS + geo_registry table
    20260214000001_geo_registry_rls.sql       # RLS policies
    20260214000002_nearby_search_rpc.sql      # Spatial search RPC
    20260214000003_spatial_clustering_rpc.sql  # DBSCAN clustering RPC
    20260214000004_geofences.sql              # Geofences table, RLS, and RPCs
  functions/
    _shared/cors.ts                           # Shared CORS headers
    geocode/index.ts                          # Forward geocoding
    reverse-geocode/index.ts                  # Reverse geocoding
    nearby-search/index.ts                    # Radius search
    batch-geocode/index.ts                    # Bulk geocoding
    spatial-cluster/index.ts                  # DBSCAN spatial clustering
    geofence/index.ts                         # Geofencing operations
```

## License

MIT
