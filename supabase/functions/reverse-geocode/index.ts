import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

interface ReverseGeocodeRequest {
  lat: number;
  lon: number;
  source?: string;
}

interface NominatimReverseResult {
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { lat, lon, source }: ReverseGeocodeRequest = await req.json();

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

    // Reverse geocode via OpenStreetMap Nominatim
    const nominatimUrl =
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&addressdetails=1`;

    const geoRes = await fetch(nominatimUrl, {
      headers: { "User-Agent": "map.gerege.ai/1.0" },
    });

    if (!geoRes.ok) {
      return new Response(
        JSON.stringify({ error: "Reverse geocoding service request failed" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const result: NominatimReverseResult & { error?: string } = await geoRes.json();

    if (result.error) {
      return new Response(
        JSON.stringify({ error: "No results found for the given coordinates" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Build standardized address from Nominatim components
    const standardized_address = {
      house_number: result.address.house_number ?? null,
      road: result.address.road ?? null,
      city: result.address.city ?? null,
      state: result.address.state ?? null,
      postcode: result.address.postcode ?? null,
      country: result.address.country ?? null,
      country_code: result.address.country_code ?? null,
      formatted: result.display_name,
    };

    // Confidence heuristic: how many address components were resolved
    const fields = [
      result.address.house_number,
      result.address.road,
      result.address.city,
      result.address.state,
      result.address.postcode,
      result.address.country,
    ];
    const filled = fields.filter(Boolean).length;
    const confidence_score = parseFloat((filled / fields.length).toFixed(2));

    // Insert into geo_registry using the service role
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Extract the calling user's JWT so we can set created_by
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

    const { data, error } = await supabase
      .from("geo_registry")
      .insert({
        raw_address: result.display_name,
        standardized_address,
        coordinates: `SRID=4326;POINT(${lon} ${lat})`,
        source: source ?? "nominatim_reverse",
        confidence_score,
        created_by,
      })
      .select()
      .single();

    if (error) {
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify(data),
      { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
