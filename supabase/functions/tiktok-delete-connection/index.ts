// tiktok-delete-connection — Supabase Edge Function
//
// Soft-deletes a saved TikTok connection by setting is_active = false.
// Does NOT touch the real TikTok account — the user's TikTok account is
// unaffected.  Only the locally saved connection record is deactivated.
// Tokens are never returned.
//
// Required secrets:
//   SUPABASE_URL              — project REST base URL
//   SUPABASE_SERVICE_ROLE_KEY — service role key; server-side only, never returned
//   ALLOWED_ORIGIN            — frontend origin for CORS (required — no wildcard fallback)

const DB_TABLE = "creatorflow_tiktok_connections";

Deno.serve(async (req: Request): Promise<Response> => {
  const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN");
  if (!allowedOrigin) {
    console.error("[tiktok-delete-connection] ALLOWED_ORIGIN is not configured");
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

  let connectionId: string | undefined;
  try {
    const body = (await req.json()) as { connectionId?: string };
    connectionId = typeof body.connectionId === "string" ? body.connectionId : undefined;
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  if (!connectionId) {
    return json({ ok: false, error: "Missing required field: connectionId" }, 400);
  }

  // Basic UUID format guard — prevents injection via the query parameter
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(connectionId)) {
    return json({ ok: false, error: "Invalid connectionId format" }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    console.error("[tiktok-delete-connection] Missing required secrets");
    return json({ ok: false, error: "Server configuration error" }, 500);
  }

  try {
    const dbUrl = new URL(`/rest/v1/${DB_TABLE}`, supabaseUrl);
    dbUrl.searchParams.set("id", `eq.${connectionId}`);

    const dbRes = await fetch(dbUrl.toString(), {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "apikey": serviceRoleKey,
        "Authorization": `Bearer ${serviceRoleKey}`,
        "Prefer": "return=minimal",
      },
      body: JSON.stringify({
        is_active: false,
        updated_at: new Date().toISOString(),
      }),
    });

    if (!dbRes.ok) {
      console.error(`[tiktok-delete-connection] DB patch failed: HTTP ${dbRes.status}`);
      return json({ ok: false, error: "Failed to remove connection" }, 500);
    }

    return json({ ok: true });
  } catch {
    console.error("[tiktok-delete-connection] DB patch threw an exception");
    return json({ ok: false, error: "Failed to remove connection" }, 502);
  }
});
