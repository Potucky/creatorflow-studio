// tiktok-creator-info - Supabase Edge Function
//
// Fetches TikTok Content Posting API creator info using the stored access token.
// access_token is used server-side only; never logged, never returned to caller.
// The TikTok raw response is not logged or forwarded to the frontend.
//
// Accepts either:
//   connectionId — UUID from tiktok-list-connections (preferred)
//   open_id      — legacy TikTok user identifier (backward compat)
//
// Required secrets:
//   SUPABASE_URL              - project REST base URL
//   SUPABASE_SERVICE_ROLE_KEY - service role key; server-side only
//   ALLOWED_ORIGIN            - frontend origin for CORS (required - no wildcard fallback)

const DB_TABLE = "creatorflow_tiktok_connections";
const TIKTOK_CREATOR_INFO_URL =
  "https://open.tiktokapis.com/v2/post/publish/creator_info/query/";

interface ConnectionRecord {
  open_id?: string;
  access_token?: string;
  scope?: string;
  last_token_exchange_at?: string;
}

interface TikTokCreatorInfoData {
  creator_avatar_url?: unknown;
  creator_username?: unknown;
  creator_nickname?: unknown;
  privacy_level_options?: unknown;
  comment_disabled?: unknown;
  duet_disabled?: unknown;
  stitch_disabled?: unknown;
  max_video_post_duration_sec?: unknown;
}

interface TikTokCreatorInfoResponse {
  data?: TikTokCreatorInfoData;
  error?: {
    code?: string;
    message?: string;
    log_id?: string;
  };
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

Deno.serve(async (req: Request): Promise<Response> => {
  const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN");
  if (!allowedOrigin) {
    console.error("[tiktok-creator-info] ALLOWED_ORIGIN is not configured");
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

  console.log("[tiktok-creator-info] creator-info request started");

  let requestOpenId: string | undefined;
  let requestConnectionId: string | undefined;
  try {
    const body = (await req.json()) as {
      open_id?: unknown;
      openId?: unknown;
      connectionId?: unknown;
    };
    if (typeof body.connectionId === "string") {
      requestConnectionId = body.connectionId;
    }
    if (typeof body.open_id === "string") {
      requestOpenId = body.open_id;
    } else if (typeof body.openId === "string") {
      requestOpenId = body.openId;
    }
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  if (!requestConnectionId && !requestOpenId) {
    return json(
      {
        ok: false,
        error:
          "Missing required field: connectionId or open_id. Caller must supply one.",
      },
      400,
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    const missing = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]
      .filter((key) => !Deno.env.get(key))
      .join(", ");
    console.error(`[tiktok-creator-info] Missing secrets: ${missing}`);
    return json({ ok: false, error: "Server configuration error" }, 500);
  }

  let connection: ConnectionRecord | null;
  try {
    const dbUrl = new URL(`/rest/v1/${DB_TABLE}`, supabaseUrl);

    // Prefer connectionId lookup; fall back to open_id for backward compat
    if (requestConnectionId) {
      dbUrl.searchParams.set("id", `eq.${requestConnectionId}`);
    } else {
      dbUrl.searchParams.set("open_id", `eq.${requestOpenId}`);
    }
    dbUrl.searchParams.set("select", "open_id,access_token,scope,last_token_exchange_at");
    dbUrl.searchParams.set("limit", "1");

    const dbRes = await fetch(dbUrl.toString(), {
      headers: {
        "apikey": serviceRoleKey,
        "Authorization": `Bearer ${serviceRoleKey}`,
        "Accept": "application/json",
      },
    });

    if (!dbRes.ok) {
      console.error(`[tiktok-creator-info] DB fetch failed: HTTP ${dbRes.status}`);
      return json({ ok: false, error: "Failed to load TikTok connection" }, 500);
    }

    const rows = (await dbRes.json()) as ConnectionRecord[];
    connection = rows.length > 0 ? rows[0] : null;
  } catch {
    console.error("[tiktok-creator-info] DB fetch threw an exception");
    return json({ ok: false, error: "Failed to load TikTok connection" }, 502);
  }

  const accessToken =
    typeof connection?.access_token === "string" && connection.access_token
      ? connection.access_token
      : null;

  console.log(`[tiktok-creator-info] token found ${accessToken ? "yes" : "no"}`);

  if (!connection) {
    return json({ ok: false, error: "No TikTok connection found" }, 404);
  }
  if (!accessToken) {
    return json({ ok: false, error: "TikTok access token unavailable" }, 401);
  }

  try {
    const creatorRes = await fetch(TIKTOK_CREATOR_INFO_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
    });

    console.log(`[tiktok-creator-info] TikTok status code ${creatorRes.status}`);

    let creatorData: TikTokCreatorInfoResponse = {};
    try {
      creatorData = (await creatorRes.json()) as TikTokCreatorInfoResponse;
    } catch {
      creatorData = {};
    }

    if (!creatorRes.ok) {
      return json(
        {
          ok: false,
          error: "TikTok creator info request failed",
          rawStatus: creatorRes.status,
        },
        502,
      );
    }

    const tikTokOk = !creatorData.error?.code || creatorData.error.code === "ok";
    if (!tikTokOk) {
      return json(
        {
          ok: false,
          error: "TikTok creator info request was rejected",
          rawStatus: creatorRes.status,
        },
        502,
      );
    }

    const data = creatorData.data ?? {};
    const privacyLevelOptions = stringArray(data.privacy_level_options);
    const commentDisabled = Boolean(data.comment_disabled);
    const duetDisabled = Boolean(data.duet_disabled);
    const stitchDisabled = Boolean(data.stitch_disabled);

    console.log(`[tiktok-creator-info] privacy option count ${privacyLevelOptions.length}`);
    console.log(
      `[tiktok-creator-info] capability booleans comment_disabled=${commentDisabled} duet_disabled=${duetDisabled} stitch_disabled=${stitchDisabled}`,
    );

    return json({
      ok: true,
      creatorUsername: stringOrNull(data.creator_username),
      creatorNickname: stringOrNull(data.creator_nickname),
      avatarUrl: stringOrNull(data.creator_avatar_url),
      privacyLevelOptions,
      commentDisabled,
      duetDisabled,
      stitchDisabled,
      maxVideoPostDurationSec: numberOrNull(data.max_video_post_duration_sec),
    });
  } catch {
    console.error("[tiktok-creator-info] Creator info fetch threw an exception");
    return json({ ok: false, error: "Failed to reach TikTok API" }, 502);
  }
});
