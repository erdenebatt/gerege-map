import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

type Action = "create" | "check" | "entries" | "list";

interface CreatePayload {
  action: "create";
  name: string;
  description?: string;
  polygon: [number, number][]; // [lon, lat] pairs, first and last must match
  metadata?: Record<string, unknown>;
}

interface CheckPayload {
  action: "check";
  lat: number;
  lon: number;
}

interface EntriesPayload {
  action: "entries";
  fence_id: string;
  max_results?: number;
}

interface ListPayload {
  action: "list";
}

type RequestPayload = CreatePayload | CheckPayload | EntriesPayload | ListPayload;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function buildPolygonWKT(polygon: [number, number][]): string {
  const coords = polygon.map(([lon, lat]) => `${lon} ${lat}`).join(", ");
  return `SRID=4326;POLYGON((${coords}))`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const payload: RequestPayload = await req.json();
    const authHeader = req.headers.get("Authorization")!;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    switch (payload.action) {
      // --- CREATE a geofence ---
      case "create": {
        const { name, description, polygon, metadata } = payload;

        if (!name || typeof name !== "string") {
          return jsonResponse({ error: "'name' is required" }, 400);
        }

        if (!Array.isArray(polygon) || polygon.length < 4) {
          return jsonResponse(
            { error: "'polygon' must have at least 4 coordinate pairs (closed ring)" },
            400,
          );
        }

        const first = polygon[0];
        const last = polygon[polygon.length - 1];
        if (first[0] !== last[0] || first[1] !== last[1]) {
          return jsonResponse(
            { error: "Polygon must be closed (first and last coordinate must match)" },
            400,
          );
        }

        // Use service role for insert so created_by is set via RLS default
        const serviceClient = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        );

        // Resolve user from JWT
        const { data: { user } } = await supabase.auth.getUser();

        const { data, error } = await serviceClient
          .from("geofences")
          .insert({
            name,
            description: description ?? null,
            boundary: buildPolygonWKT(polygon),
            metadata: metadata ?? {},
            created_by: user?.id ?? null,
          })
          .select("id, name, description, metadata, created_at")
          .single();

        if (error) return jsonResponse({ error: error.message }, 500);
        return jsonResponse(data, 201);
      }

      // --- CHECK which geofences contain a point ---
      case "check": {
        const { lat, lon } = payload;

        if (typeof lat !== "number" || typeof lon !== "number") {
          return jsonResponse({ error: "'lat' and 'lon' must be numbers" }, 400);
        }

        if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
          return jsonResponse(
            { error: "Coordinates out of range (lat: -90..90, lon: -180..180)" },
            400,
          );
        }

        const { data, error } = await supabase.rpc("geofence_check", { lat, lon });

        if (error) return jsonResponse({ error: error.message }, 500);

        const fences = (data ?? []).map(
          (row: { boundary: string; [key: string]: unknown }) => ({
            ...row,
            boundary: JSON.parse(row.boundary),
          }),
        );

        return jsonResponse({ inside: fences.length > 0, count: fences.length, fences });
      }

      // --- ENTRIES: find geo_registry rows inside a geofence ---
      case "entries": {
        const { fence_id, max_results = 100 } = payload;

        if (!fence_id) {
          return jsonResponse({ error: "'fence_id' is required" }, 400);
        }

        const { data, error } = await supabase.rpc("geofence_entries", {
          fence_id,
          max_results: Math.min(max_results, 500),
        });

        if (error) return jsonResponse({ error: error.message }, 500);

        const entries = (data ?? []).map(
          (row: { coordinates: string; [key: string]: unknown }) => ({
            ...row,
            coordinates: JSON.parse(row.coordinates),
          }),
        );

        return jsonResponse({ count: entries.length, entries });
      }

      // --- LIST all geofences ---
      case "list": {
        const { data, error } = await supabase
          .from("geofences")
          .select("id, name, description, metadata, created_at")
          .order("created_at", { ascending: false });

        if (error) return jsonResponse({ error: error.message }, 500);
        return jsonResponse({ count: (data ?? []).length, geofences: data });
      }

      default:
        return jsonResponse(
          { error: "Invalid action. Use: create, check, entries, or list" },
          400,
        );
    }
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
