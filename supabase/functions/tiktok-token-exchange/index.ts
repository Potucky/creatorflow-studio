// tiktok-token-exchange — Supabase Edge Function
//
// Exchanges a TikTok authorization code for tokens server-side, then persists
// them to public.creatorflow_tiktok_connections via the Supabase REST API
// (service role).  Tokens are NEVER returned to the browser.
//
// After a successful exchange, attempts to fetch creator info (display_name,
// avatar_url) inline so account manager UI can display them without a second
// round-trip.  Creator-info failure does not abort the token exchange.
//
// Required secrets (set via `supabase secrets set`):
//   TIKTOK_CLIENT_KEY         — app client_key from TikTok Developer Portal
//   TIKTOK_CLIENT_SECRET      — never logged, never returned to caller
//   TIKTOK_REDIRECT_URI       — must exactly match TikTok Developer Portal
//   ALLOWED_ORIGIN            — frontend origin for CORS (required — no wildcard fallback)
//   SUPABASE_URL              — project REST base URL, e.g. https://<ref>.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY — service role key; used only server-side, never returned

const TIKTOK_TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";
const TIKTOK_CREATOR_INFO_URL =
  "https://open.tiktokapis.com/v2/post/publish/creator_info/query/";
const DB_TABLE = "creatorflow_tiktok_connections";

// TikTok v2 token endpoint response shape
interface TikTokTokenResponse {
  access_token?: string;
  refresh_token?: string;
  open_id?: string;
  scope?: string;
  token_type?: string;
  expires_in?: number;
  refresh_expires_in?: number;
  error?: string;
  error_description?: string;
  log_id?: string;
}

interface TikTokCreatorInfoData {
  creator_avatar_url?: unknown;
  creator_username?: unknown;
  creator_nickname?: unknown;
}

interface TikTokCreatorInfoResponse {
  data?: TikTokCreatorInfoData;
  error?: { code?: string };
}

function maskOpenId(openId?: string | null): string | null {
  if (!openId) return null;
  if (openId.length <= 10) return openId.slice(0, 3) + "...";
  return openId.slice(0, 6) + "..." + openId.slice(-4);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

interface ConnectionIdRow {
  id?: string;
}

Deno.serve(async (req: Request): Promise<Response> => {
  // ── ALLOWED_ORIGIN is required — no wildcard fallback ──────────────────────
  const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN");
  if (!allowedOrigin) {
    console.error("[tiktok-token-exchange] ALLOWED_ORIGIN is not configured");
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

  // ── CORS preflight ──────────────────────────────────────────────────────────
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // ── Method guard ────────────────────────────────────────────────────────────
  if (req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  // ── Parse body ──────────────────────────────────────────────────────────────
  let code: string | undefined;
  try {
    const body = (await req.json()) as { code?: string; state?: string };
    code = body.code;
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  if (!code) {
    return json({ ok: false, error: "Missing required field: code" }, 400);
  }

  // ── Read secrets ────────────────────────────────────────────────────────────
  // SECURITY: values are never logged or returned to the caller.
  const clientKey = Deno.env.get("TIKTOK_CLIENT_KEY");
  const clientSecret = Deno.env.get("TIKTOK_CLIENT_SECRET");
  const redirectUri = Deno.env.get("TIKTOK_REDIRECT_URI");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!clientKey || !clientSecret || !redirectUri || !supabaseUrl || !serviceRoleKey) {
    const required = [
      "TIKTOK_CLIENT_KEY",
      "TIKTOK_CLIENT_SECRET",
      "TIKTOK_REDIRECT_URI",
      "SUPABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
    ];
    const missing = required.filter((k) => !Deno.env.get(k)).join(", ");
    console.error(`[tiktok-token-exchange] Missing secrets: ${missing}`);
    return json({ ok: false, error: "Server configuration error" }, 500);
  }

  // ── Exchange code → token ───────────────────────────────────────────────────
  const formBody = new URLSearchParams({
    client_key: clientKey,
    client_secret: clientSecret, // server-side only — never logged, never returned
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });

  let tikTokData: TikTokTokenResponse;
  try {
    const tikTokRes = await fetch(TIKTOK_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody.toString(),
    });
    tikTokData = (await tikTokRes.json()) as TikTokTokenResponse;
  } catch {
    console.error("[tiktok-token-exchange] Fetch to TikTok threw an exception");
    return json({ ok: false, error: "Failed to reach TikTok token endpoint" }, 502);
  }

  // ── TikTok returned an error ────────────────────────────────────────────────
  if (tikTokData.error) {
    return json(
      {
        ok: false,
        error: tikTokData.error,
        error_description: tikTokData.error_description ?? null,
        log_id: tikTokData.log_id ?? null,
      },
      400,
    );
  }

  // ── Optionally fetch creator info to get display_name and avatar_url ────────
  // Best-effort: failure here does not abort the token exchange.
  // access_token is used only here and in the upsert; it never reaches the caller.
  let displayName: string | null = null;
  let avatarUrl: string | null = null;
  const accessToken = tikTokData.access_token;

  if (accessToken) {
    try {
      const ciRes = await fetch(TIKTOK_CREATOR_INFO_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
        },
      });
      if (ciRes.ok) {
        const ciData = (await ciRes.json()) as TikTokCreatorInfoResponse;
        const ciTikTokOk = !ciData.error?.code || ciData.error.code === "ok";
        if (ciTikTokOk && ciData.data) {
          displayName =
            stringOrNull(ciData.data.creator_nickname) ??
            stringOrNull(ciData.data.creator_username);
          avatarUrl = stringOrNull(ciData.data.creator_avatar_url);
        }
      }
    } catch {
      // Non-fatal — creator info will be fetched again by the frontend
      console.log("[tiktok-token-exchange] Creator info fetch skipped");
    }
  }

  // ── Persist tokens server-side ─────────────────────────────────────────────
  // SECURITY: access_token and refresh_token are written to DB but never
  // returned to the browser.  serviceRoleKey is never logged or returned.
  const now = Date.now();
  const expiresIn = tikTokData.expires_in ?? 0;
  const refreshExpiresIn = tikTokData.refresh_expires_in;

  const record: Record<string, unknown> = {
    open_id: tikTokData.open_id,
    scope: tikTokData.scope ?? null,
    token_type: tikTokData.token_type ?? null,
    access_token: tikTokData.access_token,          // stored server-side only
    refresh_token: tikTokData.refresh_token ?? null, // stored server-side only
    expires_in: expiresIn,
    access_token_expires_at: new Date(now + expiresIn * 1000).toISOString(),
    last_token_exchange_at: new Date(now).toISOString(),
    updated_at: new Date(now).toISOString(),
    is_active: true,
    ...(displayName !== null && { display_name: displayName }),
    ...(avatarUrl !== null && { avatar_url: avatarUrl }),
    ...(refreshExpiresIn != null && {
      refresh_expires_in: refreshExpiresIn,
      refresh_token_expires_at: new Date(now + refreshExpiresIn * 1000).toISOString(),
    }),
  };

  try {
    const dbRes = await fetch(`${supabaseUrl}/rest/v1/${DB_TABLE}?on_conflict=open_id`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": serviceRoleKey,
        "Authorization": `Bearer ${serviceRoleKey}`,
        "Prefer": "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(record),
    });

    if (!dbRes.ok) {
      console.error(`[tiktok-token-exchange] DB upsert failed: HTTP ${dbRes.status}`);
      return json({ ok: false, error: "token_storage_failed" }, 500);
    }
  } catch {
    console.error("[tiktok-token-exchange] DB upsert threw an exception");
    return json({ ok: false, error: "token_storage_failed" }, 502);
  }

  // ── Retrieve the connection id for this open_id ────────────────────────────
  // Separate SELECT so we never risk returning access_token via return=representation.
  let connectionId: string | null = null;
  try {
    const dbUrl = new URL(`/rest/v1/${DB_TABLE}`, supabaseUrl);
    dbUrl.searchParams.set("open_id", `eq.${tikTokData.open_id}`);
    dbUrl.searchParams.set("select", "id");
    dbUrl.searchParams.set("limit", "1");

    const idRes = await fetch(dbUrl.toString(), {
      headers: {
        "apikey": serviceRoleKey,
        "Authorization": `Bearer ${serviceRoleKey}`,
        "Accept": "application/json",
      },
    });

    if (idRes.ok) {
      const rows = (await idRes.json()) as ConnectionIdRow[];
      connectionId = rows[0]?.id ?? null;
    }
  } catch {
    // Non-fatal: connectionId stays null; frontend falls back to openId-based flow
    console.log("[tiktok-token-exchange] Failed to fetch connection id");
  }

  // ── Return safe fields only ────────────────────────────────────────────────
  // openId is not a secret — it is the public TikTok user identifier.
  // access_token and refresh_token are intentionally absent.
  return json({
    ok: true,
    tokenReceived: !!tikTokData.access_token,
    openIdReceived: !!tikTokData.open_id,
    openId: tikTokData.open_id ?? null,
    connectionId,                          // stable UUID reference for account manager
    maskedOpenId: maskOpenId(tikTokData.open_id),
    displayName,
    avatarUrl,
    stored: true,
    scope: tikTokData.scope ?? null,
    tokenType: tikTokData.token_type ?? null,
    expiresIn: expiresIn || null,
  });
});
