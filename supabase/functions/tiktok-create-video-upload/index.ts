// tiktok-create-video-upload — Supabase Edge Function
//
// Validates caller, verifies open_id against DB, creates a Supabase Storage
// signed upload URL for the tiktok-video-staging private bucket.
//
// Returns only: bucket, path, signedUploadUrl, sourceFilename.
// Service-role key is NEVER returned or logged.
//
// Required secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ALLOWED_ORIGIN

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const DB_TABLE = "creatorflow_tiktok_connections";
const ALLOWED_BUCKET = "tiktok-video-staging";
const MAX_FILE_SIZE = 104857600; // 100 MB — matches bucket file_size_limit

interface ConnectionRecord {
  open_id?: string;
  [key: string]: unknown;
}

Deno.serve(async (req: Request): Promise<Response> => {
  // ── ALLOWED_ORIGIN is required — no wildcard fallback ──────────────────────
  const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN");
  if (!allowedOrigin) {
    console.error("[tiktok-create-video-upload] ALLOWED_ORIGIN is not configured");
    return new Response(
      JSON.stringify({ ok: false, error: "Server configuration error" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const corsHeaders: Record<string, string> = {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
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
  let requestOpenId: string | undefined;
  let fileName: string | undefined;
  let contentType: string | undefined;
  let fileSize: number | undefined;

  try {
    const raw = await req.json();
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return json({ ok: false, error: "Request body must be a JSON object" }, 400);
    }
    const body = raw as Record<string, unknown>;
    const ALLOWED_FIELDS = new Set(["open_id", "file_name", "content_type", "file_size"]);
    for (const key of Object.keys(body)) {
      if (!ALLOWED_FIELDS.has(key)) {
        return json({ ok: false, error: `Unknown field: ${key}` }, 400);
      }
    }
    requestOpenId = body.open_id as string | undefined;
    fileName = body.file_name as string | undefined;
    contentType = body.content_type as string | undefined;
    fileSize = body.file_size as number | undefined;
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  // ── Input validation ────────────────────────────────────────────────────────
  if (typeof requestOpenId !== "string" || !requestOpenId) {
    return json({ ok: false, error: "open_id must be a non-empty string" }, 400);
  }
  if (typeof fileName !== "string" || !fileName) {
    return json({ ok: false, error: "file_name must be a non-empty string" }, 400);
  }
  if (typeof contentType !== "string" || !contentType.startsWith("video/")) {
    return json({ ok: false, error: "content_type must be a string starting with video/" }, 400);
  }
  if (
    typeof fileSize !== "number" ||
    !Number.isFinite(fileSize) ||
    !Number.isInteger(fileSize) ||
    fileSize <= 0
  ) {
    return json({ ok: false, error: "file_size must be a finite positive integer" }, 400);
  }
  if (fileSize > MAX_FILE_SIZE) {
    return json(
      { ok: false, error: `file_size exceeds maximum of ${MAX_FILE_SIZE} bytes` },
      400,
    );
  }

  // Sanitize filename: keep alphanumeric, dots, hyphens, underscores only
  const sanitizedName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200);
  if (!sanitizedName) {
    return json({ ok: false, error: "file_name could not be sanitized" }, 400);
  }

  // ── Read secrets ────────────────────────────────────────────────────────────
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    const missing = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]
      .filter((k) => !Deno.env.get(k))
      .join(", ");
    console.error(`[tiktok-create-video-upload] Missing secrets: ${missing}`);
    return json({ ok: false, error: "Server configuration error" }, 500);
  }

  // ── Verify open_id exists in DB ─────────────────────────────────────────────
  let connectionFound = false;
  try {
    const dbRes = await fetch(
      `${supabaseUrl}/rest/v1/${DB_TABLE}?open_id=eq.${encodeURIComponent(requestOpenId)}&select=open_id&limit=1`,
      {
        headers: {
          "apikey": serviceRoleKey,
          "Authorization": `Bearer ${serviceRoleKey}`,
          "Accept": "application/json",
        },
      },
    );

    if (!dbRes.ok) {
      console.error(`[tiktok-create-video-upload] DB fetch failed: HTTP ${dbRes.status}`);
      return json({ ok: false, error: "Failed to verify TikTok connection" }, 500);
    }

    const rows = (await dbRes.json()) as ConnectionRecord[];
    connectionFound = rows.length > 0;
  } catch {
    console.error("[tiktok-create-video-upload] DB fetch error");
    return json({ ok: false, error: "Failed to verify TikTok connection" }, 502);
  }

  if (!connectionFound) {
    return json(
      { ok: false, error: "No TikTok connection found for the provided open_id" },
      404,
    );
  }

  // ── Generate unique sanitized storage path ──────────────────────────────────
  const uuid = crypto.randomUUID();
  const openIdPrefix = requestOpenId.slice(0, 6).replace(/[^a-zA-Z0-9]/g, "_");
  const storagePath = `uploads/${openIdPrefix}/${uuid}/${sanitizedName}`;

  // ── Create signed upload URL via official Supabase JS Storage client ────────
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data: signData, error: signError } = await supabase.storage
    .from(ALLOWED_BUCKET)
    .createSignedUploadUrl(storagePath);

  if (signError || !signData?.signedUrl) {
    console.error(
      "[tiktok-create-video-upload] createSignedUploadUrl failed:",
      signError?.message ?? "no signedUrl returned",
    );
    return json({ ok: false, error: "Failed to create upload target" }, 502);
  }

  // ── Return safe upload info — service-role key never included ───────────────
  return json({
    ok: true,
    bucket: ALLOWED_BUCKET,
    path: storagePath,
    signedUploadUrl: signData.signedUrl,
    sourceFilename: sanitizedName,
  });
});
