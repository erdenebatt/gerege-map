import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

interface NearbySearchRequest {
  lat: number;
  lon: number;
  radius_m?: number;
  max_results?: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const {
      lat,
      lon,
      radius_m = 1000,
      max_results = 50,
    }: NearbySearchRequest = await req.json();

    if (typeof lat !== "number" || typeof lon !== "number") {
      return new Response(
        JSON.stringify({ error: "'lat' and 'lon' must be numbers" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return new Response(
        JSON.stringify({ error: "Coordinates out of range (lat: -90..90, lon: -180..180)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (radius_m <= 0 || radius_m > 50000) {
      return new Response(
        JSON.stringify({ error: "'radius_m' must be between 1 and 50000 meters" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Use the caller's JWT so RLS policies are enforced
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } },
    );

    const { data, error } = await supabase.rpc("nearby_search", {
      lat,
      lon,
      radius_m,
      max_results: Math.min(max_results, 100),
    });

    if (error) {
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Parse the GeoJSON coordinate strings returned by the RPC
    const results = (data ?? []).map(
      (row: { coordinates: string; distance_m: number; [key: string]: unknown }) => ({
        ...row,
        coordinates: JSON.parse(row.coordinates),
        distance_m: Math.round(row.distance_m * 100) / 100,
      }),
    );

    return new Response(
      JSON.stringify({ count: results.length, results }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
