// tiktok-list-connections — Supabase Edge Function
//
// Returns all active TikTok connections for the account manager UI.
// NEVER returns access_token or refresh_token.
// Returns open_id (not a secret — it is a public user identifier) so the
// frontend can supply it to functions that still require it (status-check,
// create-video-upload).  masked_open_id is the display-safe version.
//
// Required secrets:
//   SUPABASE_URL              — project REST base URL
//   SUPABASE_SERVICE_ROLE_KEY — service role key; server-side only, never returned
//   ALLOWED_ORIGIN            — frontend origin for CORS (required — no wildcard fallback)

const DB_TABLE = "creatorflow_tiktok_connections";

interface ConnectionRow {
  id?: string;
  display_name?: string | null;
  avatar_url?: string | null;
  open_id?: string | null;
  scope?: string | null;
  is_active?: boolean;
  last_used_at?: string | null;
  created_at?: string | null;
}

function maskOpenId(openId?: string | null): string | null {
  if (!openId) return null;
  if (openId.length <= 10) return openId.slice(0, 3) + "...";
  return openId.slice(0, 6) + "..." + openId.slice(-4);
}

Deno.serve(async (req: Request): Promise<Response> => {
  const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN");
  if (!allowedOrigin) {
    console.error("[tiktok-list-connections] ALLOWED_ORIGIN is not configured");
    return new Response(
      JSON.stringify({ ok: false, error: "Server configuration error" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const allowedOrigins = allowedOrigin.split(",").map((o) => o.trim()).filter(Boolean);
  const requestOrigin = req.headers.get("origin") ?? "";
  const effectiveOrigin = allowedOrigins.includes(requestOrigin)
    ? requestOrigin
    : allowedOrigins[0] ?? allowedOrigin;

  const corsHeaders: Record<string, string> = {
    "Access-Control-Allow-Origin": effectiveOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Vary": "Origin",
  };

  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    console.error("[tiktok-list-connections] Missing required secrets");
    return json({ ok: false, error: "Server configuration error" }, 500);
  }

  try {
    const dbUrl = new URL(`/rest/v1/${DB_TABLE}`, supabaseUrl);
    dbUrl.searchParams.set(
      "select",
      "id,display_name,avatar_url,open_id,scope,is_active,last_used_at,created_at",
    );
    dbUrl.searchParams.set("is_active", "eq.true");
    // Most recently used first, then newest first
    dbUrl.searchParams.set("order", "last_used_at.desc.nullslast,created_at.desc");

    const dbRes = await fetch(dbUrl.toString(), {
      headers: {
        "apikey": serviceRoleKey,
        "Authorization": `Bearer ${serviceRoleKey}`,
        "Accept": "application/json",
      },
    });

    if (!dbRes.ok) {
      console.error(`[tiktok-list-connections] DB fetch failed: HTTP ${dbRes.status}`);
      return json({ ok: false, error: "Failed to load connections" }, 500);
    }

    const rows = (await dbRes.json()) as ConnectionRow[];

    // open_id is the TikTok public user identifier — not a token, safe to return.
    // masked_open_id is the display version shown in the UI.
    const connections = rows.map((row) => ({
      id: row.id ?? null,
      display_name: row.display_name ?? null,
      avatar_url: row.avatar_url ?? null,
      open_id: row.open_id ?? null,
      masked_open_id: maskOpenId(row.open_id),
      scope: row.scope ?? null,
      is_active: row.is_active ?? true,
      last_used_at: row.last_used_at ?? null,
      created_at: row.created_at ?? null,
    }));

    return json({ ok: true, connections });
  } catch {
    console.error("[tiktok-list-connections] DB fetch threw an exception");
    return json({ ok: false, error: "Failed to load connections" }, 502);
  }
});
