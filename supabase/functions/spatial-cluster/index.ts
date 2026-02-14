import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

interface SpatialClusterRequest {
  lat: number;
  lon: number;
  radius_m?: number;
  cluster_distance_m?: number;
  min_points?: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const {
      lat,
      lon,
      radius_m = 5000,
      cluster_distance_m = 500,
      min_points = 1,
    }: SpatialClusterRequest = await req.json();

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

    if (radius_m <= 0 || radius_m > 100000) {
      return new Response(
        JSON.stringify({ error: "'radius_m' must be between 1 and 100000 meters" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (cluster_distance_m <= 0 || cluster_distance_m > radius_m) {
      return new Response(
        JSON.stringify({ error: "'cluster_distance_m' must be between 1 and radius_m" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Use caller's JWT so RLS policies are enforced
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } },
    );

    const { data, error } = await supabase.rpc("spatial_clusters", {
      lat,
      lon,
      radius_m,
      cluster_distance_m,
      min_points,
    });

    if (error) {
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Parse GeoJSON center strings and format response
    const clusters = (data ?? []).map(
      (row: {
        cluster_id: number;
        cluster_center: string;
        point_count: number;
        addresses: string[];
        avg_confidence: number;
      }) => ({
        ...row,
        cluster_center: JSON.parse(row.cluster_center),
      }),
    );

    return new Response(
      JSON.stringify({ count: clusters.length, clusters }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
