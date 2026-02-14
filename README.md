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
```

## Project Structure

```
supabase/
  migrations/
    20260214000000_create_geo_registry.sql    # PostGIS + geo_registry table
    20260214000001_geo_registry_rls.sql       # RLS policies
    20260214000002_nearby_search_rpc.sql      # Spatial search RPC
  functions/
    _shared/cors.ts                           # Shared CORS headers
    geocode/index.ts                          # Forward geocoding
    reverse-geocode/index.ts                  # Reverse geocoding
    nearby-search/index.ts                    # Radius search
    batch-geocode/index.ts                    # Bulk geocoding
```

## License

MIT
