import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const MAX_BATCH_SIZE = 50;
const NOMINATIM_DELAY_MS = 1100; // Nominatim requires ~1 req/sec

interface BatchGeocodeRequest {
  addresses: string[];
  source?: string;
}

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
  address: {
    house_number?: string;
    road?: string;
    city?: string;
    state?: string;
    postcode?: string;
    country?: string;
    country_code?: string;
  };
}

interface GeocodedRow {
  raw_address: string;
  standardized_address: Record<string, unknown>;
  coordinates: string;
  source: string;
  confidence_score: number;
  created_by: string | null;
}

interface ResultItem {
  address: string;
  status: "success" | "not_found" | "error";
  data?: Record<string, unknown>;
  error?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildStandardized(address: NominatimResult["address"], formatted: string) {
  return {
    house_number: address.house_number ?? null,
    road: address.road ?? null,
    city: address.city ?? null,
    state: address.state ?? null,
    postcode: address.postcode ?? null,
    country: address.country ?? null,
    country_code: address.country_code ?? null,
    formatted,
  };
}

function computeConfidence(address: NominatimResult["address"]): number {
  const fields = [
    address.house_number,
    address.road,
    address.city,
    address.state,
    address.postcode,
    address.country,
  ];
  const filled = fields.filter(Boolean).length;
  return parseFloat((filled / fields.length).toFixed(2));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { addresses, source }: BatchGeocodeRequest = await req.json();

    if (!Array.isArray(addresses) || addresses.length === 0) {
      return new Response(
        JSON.stringify({ error: "'addresses' must be a non-empty array of strings" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (addresses.length > MAX_BATCH_SIZE) {
      return new Response(
        JSON.stringify({ error: `Batch size exceeds maximum of ${MAX_BATCH_SIZE}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Resolve the calling user
    const authHeader = req.headers.get("Authorization");
    let created_by: string | null = null;

    if (authHeader) {
      const userClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } },
      );
      const { data: { user } } = await userClient.auth.getUser();
      created_by = user?.id ?? null;
    }

    const results: ResultItem[] = [];
    const rowsToInsert: GeocodedRow[] = [];

    // Geocode each address sequentially to respect Nominatim rate limits
    for (let i = 0; i < addresses.length; i++) {
      const address = addresses[i];

      if (typeof address !== "string" || address.trim() === "") {
        results.push({ address, status: "error", error: "Invalid address string" });
        continue;
      }

      try {
        if (i > 0) await sleep(NOMINATIM_DELAY_MS);

        const encoded = encodeURIComponent(address);
        const nominatimUrl =
          `https://nominatim.openstreetmap.org/search?q=${encoded}&format=json&addressdetails=1&limit=1`;

        const geoRes = await fetch(nominatimUrl, {
          headers: { "User-Agent": "map.gerege.ai/1.0" },
        });

        if (!geoRes.ok) {
          results.push({ address, status: "error", error: "Geocoding service request failed" });
          continue;
        }

        const nominatimResults: NominatimResult[] = await geoRes.json();

        if (nominatimResults.length === 0) {
          results.push({ address, status: "not_found" });
          continue;
        }

        const top = nominatimResults[0];
        const lat = parseFloat(top.lat);
        const lon = parseFloat(top.lon);
        const standardized_address = buildStandardized(top.address, top.display_name);
        const confidence_score = computeConfidence(top.address);

        rowsToInsert.push({
          raw_address: address,
          standardized_address,
          coordinates: `SRID=4326;POINT(${lon} ${lat})`,
          source: source ?? "nominatim_batch",
          confidence_score,
          created_by,
        });

        results.push({
          address,
          status: "success",
          data: {
            standardized_address,
            lat,
            lon,
            confidence_score,
          },
        });
      } catch {
        results.push({ address, status: "error", error: "Unexpected geocoding failure" });
      }
    }

    // Bulk insert all successful results in a single database call
    let inserted = 0;
    if (rowsToInsert.length > 0) {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );

      const { error } = await supabase.from("geo_registry").insert(rowsToInsert);

      if (error) {
        return new Response(
          JSON.stringify({
            error: `Geocoding succeeded but database insert failed: ${error.message}`,
            results,
          }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      inserted = rowsToInsert.length;
    }

    const summary = {
      total: addresses.length,
      succeeded: results.filter((r) => r.status === "success").length,
      not_found: results.filter((r) => r.status === "not_found").length,
      failed: results.filter((r) => r.status === "error").length,
      inserted,
    };

    return new Response(
      JSON.stringify({ summary, results }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
