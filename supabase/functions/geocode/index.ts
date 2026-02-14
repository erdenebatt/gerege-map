import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

interface GeocodeRequest {
  address: string;
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

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { address, source }: GeocodeRequest = await req.json();

    if (!address || typeof address !== "string") {
      return new Response(
        JSON.stringify({ error: "A valid 'address' string is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Geocode via OpenStreetMap Nominatim
    const encoded = encodeURIComponent(address);
    const nominatimUrl =
      `https://nominatim.openstreetmap.org/search?q=${encoded}&format=json&addressdetails=1&limit=1`;

    const geoRes = await fetch(nominatimUrl, {
      headers: { "User-Agent": "map.gerege.ai/1.0" },
    });

    if (!geoRes.ok) {
      return new Response(
        JSON.stringify({ error: "Geocoding service request failed" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const results: NominatimResult[] = await geoRes.json();

    if (results.length === 0) {
      return new Response(
        JSON.stringify({ error: "No results found for the given address" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const top = results[0];
    const lat = parseFloat(top.lat);
    const lon = parseFloat(top.lon);

    // Build standardized address from Nominatim components
    const standardized_address = {
      house_number: top.address.house_number ?? null,
      road: top.address.road ?? null,
      city: top.address.city ?? null,
      state: top.address.state ?? null,
      postcode: top.address.postcode ?? null,
      country: top.address.country ?? null,
      country_code: top.address.country_code ?? null,
      formatted: top.display_name,
    };

    // Confidence heuristic: how many address components were resolved
    const fields = [
      top.address.house_number,
      top.address.road,
      top.address.city,
      top.address.state,
      top.address.postcode,
      top.address.country,
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
        raw_address: address,
        standardized_address,
        coordinates: `SRID=4326;POINT(${lon} ${lat})`,
        source: source ?? "nominatim",
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
