import { useEffect, useRef, useState } from 'react';
import './App.css';

const TIKTOK_AUTH_BASE = 'https://www.tiktok.com/v2/auth/authorize/';
const SCOPE = 'user.info.basic,video.publish';
const SESSION_STATE_KEY = 'tiktok_oauth_state';
const EDGE_FUNCTION_URL =
  'https://ggeoggxygoiydnxwclcn.supabase.co/functions/v1/tiktok-token-exchange';
const PUBLISH_URL =
  'https://ggeoggxygoiydnxwclcn.supabase.co/functions/v1/tiktok-publish-video';
const STATUS_CHECK_URL =
  'https://ggeoggxygoiydnxwclcn.supabase.co/functions/v1/tiktok-status-check';
const TEST_VIDEO_URL =
  'https://app.usgoit.com/test-videos/tiktok-sandbox-tiny-test.mp4';
const DEFAULT_TITLE = 'Creator video upload';
const MAX_TIKTOK_TITLE_LENGTH = 2200;
const REVIEW_AUDIT_LOGGING_ENABLED = false;
const CREATOR_INFO_URL =
  'https://ggeoggxygoiydnxwclcn.supabase.co/functions/v1/tiktok-creator-info';
const CREATE_UPLOAD_URL =
  'https://ggeoggxygoiydnxwclcn.supabase.co/functions/v1/tiktok-create-video-upload';
const MUSIC_USAGE_CONFIRMATION_URL =
  'https://www.tiktok.com/legal/page/global/music-usage-confirmation/en';
const BRANDED_CONTENT_POLICY_URL =
  'https://www.tiktok.com/legal/page/global/bc-policy/en';

interface CallbackResult {
  code: string | null;
  returnedState: string | null;
  savedState: string | null;
  error: string | null;
  errorDescription: string | null;
}

// Safe fields only — access_token and refresh_token are intentionally absent
interface TokenExchangeResult {
  ok: boolean;
  tokenReceived?: boolean;
  openIdReceived?: boolean;
  openId?: string | null;
  scope?: string | null;
  tokenType?: string | null;
  expiresIn?: number | null;
  error?: string;
  error_description?: string | null;
  log_id?: string | null;
  display_name?: string | null;
  displayName?: string | null;
  username?: string | null;
}

// Safe fields only — upload_url, access_token, refresh_token intentionally absent
interface PublishResult {
  ok?: boolean;
  initOk?: boolean;
  uploadOk?: boolean;
  publishId?: string | null;
  binaryUploadOk?: boolean | null;
  binaryUploadStatus?: string | null;
  checkOk?: boolean | null;
  statusCheckOk?: boolean | null;
  publishStatus?: string | null;
  finalPublishComplete?: boolean;
  pending?: boolean;
  failed?: boolean;
  status?: string | null;
  failReason?: string | null;
  uploadedBytes?: number | null;
  error?: string;
  connectionOpenIdMasked?: string | null;
  connectionScope?: string | null;
  connectionLastTokenExchangeAt?: string | null;
  connectionFound?: boolean | null;
  tokenAvailable?: boolean | null;
  openIdPresent?: boolean | null;
}

// Safe fields only — access_token intentionally absent
interface StatusRefreshResult {
  ok: boolean;
  checkOk?: boolean;
  statusCheckOk?: boolean;
  publishId?: string | null;
  publishStatus?: string | null;
  finalPublishComplete?: boolean;
  pending?: boolean;
  failed?: boolean;
  status?: string | null;
  failReason?: string | null;
  uploadedBytes?: number | null;
  error?: string;
  connectionOpenIdMasked?: string | null;
  connectionScope?: string | null;
  connectionLastTokenExchangeAt?: string | null;
  connectionFound?: boolean | null;
  tokenAvailable?: boolean | null;
  openIdPresent?: boolean | null;
}

type ExchangeStatus = 'idle' | 'loading' | 'done' | 'skipped';
type PublishStatus = 'idle' | 'loading' | 'done';
type StatusRefreshState = 'idle' | 'loading' | 'done';
type SheetSyncStatus = 'idle' | 'loading' | 'saved' | 'failed';
type PrivacyLevel = 'PUBLIC_TO_EVERYONE' | 'MUTUAL_FOLLOW_FRIENDS' | 'FOLLOWER_OF_CREATOR' | 'SELF_ONLY';

interface CreatorInfo {
  privacyLevelOptions: PrivacyLevel[];
  nickname: string | null;
  creator_username: string | null;
  creator_nickname: string | null;
  avatarUrl: string | null;
  maxVideoDurationSec: number | null;
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
}

interface CreatorInfoResult {
  creatorUsername?: unknown;
  creatorNickname?: unknown;
  avatarUrl?: unknown;
  privacyLevelOptions?: unknown;
  commentDisabled?: unknown;
  duetDisabled?: unknown;
  stitchDisabled?: unknown;
  maxVideoPostDurationSec?: unknown;
  creator_username?: unknown;
  creator_nickname?: unknown;
  nickname?: unknown;
  avatar_url?: unknown;
  privacy_level_options?: unknown;
  comment_disabled?: unknown;
  duet_disabled?: unknown;
  stitch_disabled?: unknown;
  max_video_post_duration_sec?: unknown;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function booleanOrFalse(value: unknown): boolean {
  return typeof value === 'boolean' ? value : false;
}

function asPrivacyLevels(value: unknown): PrivacyLevel[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is PrivacyLevel =>
    item === 'PUBLIC_TO_EVERYONE' ||
    item === 'MUTUAL_FOLLOW_FRIENDS' ||
    item === 'FOLLOWER_OF_CREATOR' ||
    item === 'SELF_ONLY',
  );
}

function mapCreatorInfoResult(data: CreatorInfoResult): CreatorInfo {
  const privacyLevelOptions = asPrivacyLevels(data.privacyLevelOptions);
  const legacyPrivacyLevelOptions = asPrivacyLevels(data.privacy_level_options);
  const creatorUsername = stringOrNull(data.creatorUsername) ?? stringOrNull(data.creator_username);
  const creatorNickname =
    stringOrNull(data.creatorNickname) ??
    stringOrNull(data.creator_nickname) ??
    stringOrNull(data.nickname);

  return {
    privacyLevelOptions: privacyLevelOptions.length > 0 ? privacyLevelOptions : legacyPrivacyLevelOptions,
    nickname: creatorNickname,
    creator_username: creatorUsername,
    creator_nickname: creatorNickname,
    avatarUrl: stringOrNull(data.avatarUrl) ?? stringOrNull(data.avatar_url),
    maxVideoDurationSec: numberOrNull(data.maxVideoPostDurationSec) ?? numberOrNull(data.max_video_post_duration_sec),
    commentDisabled: booleanOrFalse(data.commentDisabled ?? data.comment_disabled),
    duetDisabled: booleanOrFalse(data.duetDisabled ?? data.duet_disabled),
    stitchDisabled: booleanOrFalse(data.stitchDisabled ?? data.stitch_disabled),
  };
}

type PublishSemantics = Pick<
  PublishResult,
  'ok' | 'publishStatus' | 'finalPublishComplete' | 'pending' | 'failed' | 'status' | 'error' | 'failReason'
>;

function finalPublishComplete(result: PublishSemantics | null | undefined): boolean {
  return result?.finalPublishComplete === true || result?.publishStatus === 'PUBLISH_COMPLETE';
}

function publishFailed(result: PublishSemantics | null | undefined): boolean {
  return (
    result?.failed === true ||
    result?.publishStatus === 'FAILED' ||
    result?.status === 'failed' ||
    (result?.ok === false && result?.pending !== true && result?.finalPublishComplete !== true)
  );
}

function publishPending(result: PublishSemantics | null | undefined): boolean {
  if (!result || finalPublishComplete(result) || publishFailed(result)) return false;
  return result.pending === true || result.status === 'pending' || !!result.publishStatus || result.ok === true;
}

function publishOutcomeClass(result: PublishSemantics | null | undefined): string {
  if (finalPublishComplete(result)) return 'tt-ok';
  if (publishFailed(result)) return 'tt-fail';
  return 'tt-warn';
}

function publishOutcomeLabel(result: PublishSemantics | null | undefined): string {
  if (finalPublishComplete(result)) return 'Published';
  if (publishFailed(result)) return 'Failed';
  if (publishPending(result)) return 'Submitted / processing';
  return 'Pending';
}

function publishStatusLabel(status: string | null | undefined): string {
  if (!status) return 'PENDING';
  if (status === 'PUBLISH_COMPLETE') return 'PUBLISH_COMPLETE';
  if (status === 'FAILED') return 'FAILED';
  if (status === 'SEND_TO_USER_INBOX') return 'SEND_TO_USER_INBOX (processing)';
  if (status === 'PENDING_INIT') return 'PENDING_INIT (submitted)';
  return `${status} (processing)`;
}

function buildAuthUrl(clientKey: string, redirectUri: string): string {
  const state = crypto.randomUUID();
  sessionStorage.setItem(SESSION_STATE_KEY, state);
  const params = new URLSearchParams({
    client_key: clientKey,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPE,
    state,
  });
  return `${TIKTOK_AUTH_BASE}?${params.toString()}`;
}

function parseCallback(): CallbackResult | null {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const error = params.get('error');
  if (!code && !error) return null;
  return {
    code,
    returnedState: params.get('state'),
    savedState: sessionStorage.getItem(SESSION_STATE_KEY),
    error,
    errorDescription: params.get('error_description'),
  };
}

function App() {
  const path = window.location.pathname;
  // Lazy init from URL params — no effect needed; URL params don't change after mount
  const [callbackResult] = useState<CallbackResult | null>(parseCallback);
  // Derive initial status synchronously — avoids any synchronous setState in effects
  const [exchangeStatus, setExchangeStatus] = useState<ExchangeStatus>(() => {
    const cb = parseCallback();
    if (!cb?.code) return 'idle';
    const valid =
      cb.returnedState !== null &&
      cb.savedState !== null &&
      cb.returnedState === cb.savedState;
    return valid ? 'loading' : 'skipped';
  });
  const [tokenResult, setTokenResult] = useState<TokenExchangeResult | null>(null);

  const [title, setTitle] = useState(DEFAULT_TITLE);
  const [consent, setConsent] = useState(false);
  const [musicUsageConfirmed, setMusicUsageConfirmed] = useState(false);
  const [publishState, setPublishState] = useState<PublishStatus>('idle');
  const [publishResult, setPublishResult] = useState<PublishResult | null>(null);
  const [sheetSyncStatus, setSheetSyncStatus] = useState<SheetSyncStatus>('idle');
  const [statusRefreshState, setStatusRefreshState] = useState<StatusRefreshState>('idle');
  const [statusRefreshResult, setStatusRefreshResult] = useState<StatusRefreshResult | null>(null);
  const [statusRefreshSheetSync, setStatusRefreshSheetSync] = useState<SheetSyncStatus>('idle');
  const [privacyLevel, setPrivacyLevel] = useState<PrivacyLevel | ''>('');
  const [disclosureEnabled, setDisclosureEnabled] = useState(false);
  const [brandOrganic, setBrandOrganic] = useState(false);
  const [brandContent, setBrandContent] = useState(false);
  const [creatorInfo, setCreatorInfo] = useState<CreatorInfo | null>(null);
  const [creatorInfoStatus, setCreatorInfoStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [allowComments, setAllowComments] = useState(false);
  const [allowDuet, setAllowDuet] = useState(false);
  const [allowStitch, setAllowStitch] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedObjectUrl, setSelectedObjectUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (path.includes('/terms')) {
      document.title = 'CreatorFlow Studio | Terms';
    } else if (path.includes('/privacy')) {
      document.title = 'CreatorFlow Studio | Privacy';
    } else {
      document.title = 'CreatorFlow Studio';
    }
  }, [path]);

  useEffect(() => {
    if (!callbackResult?.code) return;

    const stateValid =
      callbackResult.returnedState !== null &&
      callbackResult.savedState !== null &&
      callbackResult.returnedState === callbackResult.savedState;

    if (!stateValid) return;

    fetch(EDGE_FUNCTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: callbackResult.code,
        state: callbackResult.returnedState,
      }),
    })
      .then((res) => res.json())
      .then((data) => setTokenResult(data as TokenExchangeResult))
      .catch(() =>
        setTokenResult({
          ok: false,
          error: 'Network error',
          error_description: 'Failed to reach the token exchange endpoint.',
          log_id: null,
        }),
      )
      .finally(() => setExchangeStatus('done'));
  }, [callbackResult]);

  useEffect(() => {
    const openId = tokenResult?.openId;
    if (exchangeStatus !== 'done' || !tokenResult?.ok || !openId) return;
    fetch(CREATOR_INFO_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ open_id: openId }),
    })
      .then((res) => {
        if (!res.ok) throw new Error('not ok');
        return res.json();
      })
      .then((data) => {
        setCreatorInfo(mapCreatorInfoResult(data));
        setCreatorInfoStatus('done');
      })
      .catch(() => setCreatorInfoStatus('error'));
  }, [exchangeStatus, tokenResult?.ok, tokenResult?.openId]);

  const clientKey = import.meta.env.VITE_TIKTOK_CLIENT_KEY as string | undefined;
  const redirectUri = import.meta.env.VITE_TIKTOK_REDIRECT_URI as string | undefined;
  const missingConfig = !clientKey || !redirectUri;

  function handleConnect() {
    if (!clientKey || !redirectUri) return;
    window.location.href = buildAuthUrl(clientKey, redirectUri);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    if (selectedObjectUrl) URL.revokeObjectURL(selectedObjectUrl);
    if (file) {
      setSelectedFile(file);
      setSelectedObjectUrl(URL.createObjectURL(file));
    } else {
      setSelectedFile(null);
      setSelectedObjectUrl(null);
    }
  }

  function handleLoadCreatorInfo() {
    if (!tokenResult?.openId || creatorInfoStatus === 'loading') return;
    setCreatorInfoStatus('loading');
    fetch(CREATOR_INFO_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ open_id: tokenResult.openId }),
    })
      .then((res) => {
        if (!res.ok) throw new Error('not ok');
        return res.json();
      })
      .then((data) => {
        setCreatorInfo(mapCreatorInfoResult(data));
        setCreatorInfoStatus('done');
      })
      .catch(() => setCreatorInfoStatus('error'));
  }

  async function logReviewAudit(result: PublishResult, videoTitle: string, notes = '', videoSource = TEST_VIDEO_URL): Promise<boolean> {
    void result;
    void videoTitle;
    void notes;
    void videoSource;
    return false;
  }

  async function handlePublish() {
    if (!canPublish) return;
    setPublishState('loading');
    setPublishResult(null);
    setSheetSyncStatus('idle');

    let result: PublishResult;
    // Safe source label for optional local audit logging - never a signed URL or token.
    let videoSource = TEST_VIDEO_URL;

    const publishBody: Record<string, unknown> = {
      open_id: tokenResult?.openId ?? undefined,
      upload_mode: 'FILE_UPLOAD',
      upload_binary: true,
      check_status: true,
      title,
      privacy_level: privacyLevel,
    };
    if (disclosureEnabled) {
      publishBody.brand_organic_toggle = brandOrganic;
      publishBody.brand_content_toggle = brandContent;
    }
    publishBody.disable_comment = !allowComments;
    publishBody.disable_duet = !allowDuet;
    publishBody.disable_stitch = !allowStitch;

    // ── Stage local file if one is selected ──────────────────────────────────
    let stagingError: string | null = null;
    if (selectedFile) {
      try {
        // 1. Request a signed upload target from the edge function
        const createRes = await fetch(CREATE_UPLOAD_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            open_id: tokenResult?.openId ?? undefined,
            file_name: selectedFile.name,
            content_type: selectedFile.type || 'video/mp4',
            file_size: selectedFile.size,
          }),
        });

        if (!createRes.ok) {
          const errData = await createRes.json().catch(() => ({})) as { error?: string };
          stagingError = errData.error || `Upload staging failed (HTTP ${createRes.status})`;
        } else {
          const uploadInfo = await createRes.json() as {
            bucket: string;
            path: string;
            signedUploadUrl: string;
            sourceFilename: string;
          };

          // 2. PUT the file directly to Supabase Storage via the signed URL
          const putRes = await fetch(uploadInfo.signedUploadUrl, {
            method: 'PUT',
            headers: { 'Content-Type': selectedFile.type || 'video/mp4' },
            body: selectedFile,
          });

          if (!putRes.ok) {
            stagingError = `Video staging upload failed (HTTP ${putRes.status}). Please try again.`;
          } else {
            // 3. Pass storage location to publish — no signed URL forwarded
            publishBody.storage_bucket = uploadInfo.bucket;
            publishBody.storage_path = uploadInfo.path;
            publishBody.video_size = selectedFile.size;
            publishBody.source_filename = uploadInfo.sourceFilename;
            videoSource = uploadInfo.sourceFilename;
          }
        }
      } catch {
        stagingError = 'Network error — could not prepare video upload.';
      }
    } else {
      // No local file selected — keep existing TEST_VIDEO_URL path unchanged
      publishBody.video_url = TEST_VIDEO_URL;
    }

    if (stagingError) {
      result = { ok: false, error: stagingError };
    } else {
      try {
        const res = await fetch(PUBLISH_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(publishBody),
        });
        const data = await res.json();
        result = data as PublishResult;
      } catch {
        result = { ok: false, error: 'Network error — could not reach publish endpoint.' };
      }
    }

    setPublishResult(result);
    setPublishState('done');
    // Reset any previous refresh when a new upload is done
    setStatusRefreshState('idle');
    setStatusRefreshResult(null);
    setStatusRefreshSheetSync('idle');

    if (REVIEW_AUDIT_LOGGING_ENABLED) {
      // Fire-and-forget: must not block or affect the upload result.
      setSheetSyncStatus('loading');
      logReviewAudit(result, title, '', videoSource)
        .then((synced) => setSheetSyncStatus(synced ? 'saved' : 'failed'))
        .catch(() => setSheetSyncStatus('failed'));
    }
  }

  async function handleRefreshStatus() {
    const publishId = publishResult?.publishId;
    if (!publishId) return;

    setStatusRefreshState('loading');
    setStatusRefreshResult(null);
    setStatusRefreshSheetSync('idle');

    let result: StatusRefreshResult;
    try {
      const res = await fetch(STATUS_CHECK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          open_id: tokenResult?.openId ?? undefined,
          publish_id: publishId,
        }),
      });
      const data = await res.json();
      result = data as StatusRefreshResult;
    } catch {
      result = { ok: false, error: 'Network error — could not reach status check endpoint.' };
    }
    setStatusRefreshResult(result);
    setStatusRefreshState('done');

    const asPublishResult: PublishResult = {
      ok: result.ok,
      checkOk: result.checkOk,
      publishId: result.publishId,
      statusCheckOk: result.statusCheckOk,
      publishStatus: result.publishStatus,
      finalPublishComplete: result.finalPublishComplete,
      pending: result.pending,
      failed: result.failed,
      status: result.status,
      failReason: result.failReason,
      uploadedBytes: result.uploadedBytes,
      error: result.error,
      connectionOpenIdMasked: result.connectionOpenIdMasked,
      connectionScope: result.connectionScope,
      connectionLastTokenExchangeAt: result.connectionLastTokenExchangeAt,
      connectionFound: result.connectionFound,
      tokenAvailable: result.tokenAvailable,
      openIdPresent: result.openIdPresent,
    };
    if (REVIEW_AUDIT_LOGGING_ENABLED) {
      // Fire-and-forget optional audit logging, disabled in the review build.
      setStatusRefreshSheetSync('loading');
      logReviewAudit(asPublishResult, title, 'status_refresh')
        .then((synced) => setStatusRefreshSheetSync(synced ? 'saved' : 'failed'))
        .catch(() => setStatusRefreshSheetSync('failed'));
    }
  }

  const isSelfOnly = privacyLevel === 'SELF_ONLY';
  const privacyBrandedConflict = brandContent && isSelfOnly;
  const disclosureOptionSelected = brandOrganic || brandContent;
  const privacyOptionLabels: Record<PrivacyLevel, string> = {
    PUBLIC_TO_EVERYONE: 'Public',
    MUTUAL_FOLLOW_FRIENDS: 'Friends',
    FOLLOWER_OF_CREATOR: 'Followers',
    SELF_ONLY: 'Private',
  };
  const availablePrivacyOptions = (
    creatorInfo?.privacyLevelOptions && creatorInfo.privacyLevelOptions.length > 0
      ? creatorInfo.privacyLevelOptions
      : []
  ).map((value) => ({ value, label: privacyOptionLabels[value] }));

  // Priority: creator_username → creator_nickname → tokenResult display fields → nickname
  const accountDisplayName =
    creatorInfo?.creator_username ||
    creatorInfo?.creator_nickname ||
    tokenResult?.display_name ||
    tokenResult?.displayName ||
    tokenResult?.username ||
    creatorInfo?.nickname ||
    null;
  const tokenExchangeSucceeded = tokenResult?.ok === true;
  const hasSafeConnectedIdentity = !!(accountDisplayName || tokenResult?.openId);
  const hasConnectedTikTok = tokenExchangeSucceeded && hasSafeConnectedIdentity;
  const grantedScopes = (tokenResult?.scope ?? '').split(/[\s,]+/).filter(Boolean);
  const hasVideoPublishScope = grantedScopes.includes('video.publish');
  const creatorInfoReady = creatorInfoStatus === 'done' && creatorInfo !== null;
  const creatorInfoAutoLoading =
    exchangeStatus === 'done' &&
    tokenResult?.ok === true &&
    !!tokenResult.openId &&
    creatorInfoStatus === 'idle';
  const creatorInfoLoading = creatorInfoStatus === 'loading' || creatorInfoAutoLoading;
  const privacySelected = privacyLevel !== '';
  const privacyAllowed = privacySelected && availablePrivacyOptions.some(({ value }) => value === privacyLevel);
  const selectedVideoReady =
    selectedFile !== null &&
    selectedObjectUrl !== null &&
    selectedFile.type.startsWith('video/') &&
    selectedFile.size > 0;
  const trimmedTitle = title.trim();
  const titleTooLong = title.length > MAX_TIKTOK_TITLE_LENGTH;
  const titleReady = trimmedTitle.length > 0 && !titleTooLong;
  const disclosureReady = !disclosureEnabled || disclosureOptionSelected;
  const agreementsReady = musicUsageConfirmed && consent;
  const canPublish =
    !missingConfig &&
    hasConnectedTikTok &&
    hasVideoPublishScope &&
    creatorInfoReady &&
    privacySelected &&
    privacyAllowed &&
    selectedVideoReady &&
    titleReady &&
    disclosureReady &&
    !privacyBrandedConflict &&
    agreementsReady &&
    publishState !== 'loading';

  const auditItems = [
    { label: 'Official website and brand visible', pass: true },
    { label: 'Terms and Privacy links in header', pass: true },
    { label: 'TikTok OAuth connected', pass: tokenExchangeSucceeded },
    { label: 'Connected account identity visible', pass: hasSafeConnectedIdentity },
    { label: 'TikTok video.publish scope granted', pass: hasVideoPublishScope },
    { label: 'Creator info loaded from TikTok', pass: creatorInfoReady },
    { label: 'Privacy manually selected from TikTok options', pass: privacySelected && privacyAllowed },
    { label: 'Interaction controls loaded from creator info', pass: creatorInfoReady },
    { label: 'Music Usage Confirmation checked', pass: musicUsageConfirmed },
    { label: 'Commercial disclosure handled', pass: disclosureReady && !privacyBrandedConflict },
    { label: 'Video preview visible', pass: selectedVideoReady },
    { label: 'User consent confirmed', pass: consent },
  ];

  if (path.includes('/terms')) {
    return (
      <main className="page">
        <div className="legal-wrap">
          <div className="legal-hero">
            <div className="legal-hero-brand">
              <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="CreatorFlow Studio" className="app-icon" />
              <span className="brand-name">CreatorFlow Studio</span>
            </div>
            <h1 className="legal-hero-title">Terms of Service</h1>
            <span className="legal-hero-date">Last updated: May 24, 2026</span>
          </div>

          <div className="legal-grid">
            <div className="legal-sec">
              <h2>The Service</h2>
              <p>
                CreatorFlow Studio helps a creator connect their own TikTok account
                and submit creator-owned short-form videos through TikTok's official
                Content Posting API. You are the publisher. The app is the tool.
              </p>
              <p>
                The tool is intended for owner-operated posting workflows, including
                content review and demo publishing. It is not a third-party account
                management service and must not be used to manage accounts you do not
                own or control.
              </p>
            </div>

            <div className="legal-sec">
              <h2>Account &amp; User Responsibility</h2>
              <p>
                You must own or control the TikTok account you connect. By connecting
                an account, you confirm you are authorized to publish to it. You are
                responsible for all content, captions, settings, and actions taken
                through the app.
              </p>
              <p>
                Keep access to your connected TikTok account secure. Do not connect
                accounts you do not own or are not authorized to operate.
              </p>
            </div>

            <div className="legal-sec">
              <h2>Authorized Publishing &amp; Confirmation</h2>
              <p>
                The app only submits a video to TikTok when you explicitly authorize
                the action. It does not post without your confirmation. You are
                responsible for reviewing all publish settings before confirming.
              </p>
              <p>
                Review settings including title, privacy level, commercial disclosure,
                and interaction controls before each publish action.
              </p>
            </div>

            <div className="legal-sec">
              <h2>Commercial Disclosure &amp; Media Rights</h2>
              <p>
                You are responsible for accurately indicating whether your content is
                promotional, branded, or a paid partnership, as required by TikTok's
                policies. You are also responsible for having rights to all content,
                music, video clips, and media you publish. The app provides disclosure
                fields — use them correctly.
              </p>
            </div>

            <div className="legal-sec">
              <h2>TikTok Compliance</h2>
              <p>
                You must comply with TikTok's Community Guidelines, Terms of Service,
                and Developer Policies, as well as applicable laws. The app must not
                be used for scraping, spam, artificial engagement, unauthorized
                account access, impersonation, or misleading activity.
              </p>
              <p>
                Content submitted through the app may be rejected, limited, or removed
                by TikTok in accordance with TikTok's platform policies and content
                review processes.
              </p>
            </div>

            <div className="legal-sec">
              <h2>Availability, Limits &amp; Contact</h2>
              <p>
                The service may be updated, paused, or discontinued at any time,
                provided as-is without warranties. TikTok API changes, rate limits,
                or policy updates may affect functionality; CreatorFlow Studio is not
                liable for publishing failures or TikTok content decisions.
              </p>
              <p>
                Terms may be updated from time to time — continued use means you
                accept the updates. CreatorFlow Studio is independent and not
                affiliated with or endorsed by TikTok. For questions, contact the
                app owner via the project repository.
              </p>
            </div>
          </div>

          <div className="legal-footer">
            <a href={import.meta.env.BASE_URL}>← Back to home</a>
          </div>
        </div>
      </main>
    );
  }

  if (path.includes('/privacy')) {
    return (
      <main className="page">
        <div className="legal-wrap">
          <div className="legal-hero">
            <div className="legal-hero-brand">
              <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="CreatorFlow Studio" className="app-icon" />
              <span className="brand-name">CreatorFlow Studio</span>
            </div>
            <h1 className="legal-hero-title">Privacy Policy</h1>
            <span className="legal-hero-date">Last updated: May 24, 2026</span>
          </div>

          <div className="legal-grid">
            <div className="legal-sec">
              <h2>What CreatorFlow Studio Does</h2>
              <p>
                CreatorFlow Studio is a creator-owned TikTok publishing tool. Connect
                your own TikTok account and submit creator-owned short-form videos
                through TikTok's official Content Posting API. The app is for use by
                the account owner — not a third-party posting service.
              </p>
              <p>
                You control which video and settings are submitted — the app takes no
                action until you explicitly authorize publishing.
              </p>
            </div>

            <div className="legal-sec">
              <h2>Information We Access</h2>
              <p>With your authorization, the app may access:</p>
              <ul>
                <li>Your TikTok account identifier (open_id) to identify the connected account</li>
                <li>Your display name and avatar to show account identity in the app</li>
                <li>Publishing permissions from TikTok OAuth (user.info.basic, video.publish)</li>
                <li>Video title, privacy level, disclosure, and interaction settings you provide</li>
              </ul>
            </div>

            <div className="legal-sec">
              <h2>How Information Is Used</h2>
              <p>Information is used solely to:</p>
              <ul>
                <li>Authenticate your connected TikTok account</li>
                <li>Display your connected account identity in the app</li>
                <li>Submit videos you authorize for publishing through TikTok's API</li>
                <li>Check and display the status of your publish requests</li>
                <li>Support audit and troubleshooting of authorized actions</li>
              </ul>
            </div>

            <div className="legal-sec">
              <h2>Token Handling &amp; Storage</h2>
              <p>
                Access and refresh tokens are handled server-side and are not stored
                in or exposed to the browser. Client secrets are never transmitted to
                the frontend. No credentials are exposed in publicly accessible code
                or storage.
              </p>
              <p>
                Tokens are used only to operate authorized TikTok API requests on your
                behalf and are not displayed in the app interface.
              </p>
            </div>

            <div className="legal-sec">
              <h2>Data Sharing &amp; User Control</h2>
              <p>
                Your data is not sold and is not shared with unrelated third parties.
                Information is sent to TikTok only as required for the authorized API
                integration. You can revoke access at any time through TikTok's
                connected apps settings. To request data deletion or access, contact
                the app owner via the project repository.
              </p>
            </div>

            <div className="legal-sec">
              <h2>Security &amp; TikTok Affiliation</h2>
              <p>
                Reasonable technical safeguards protect the app and its integrations.
                No credentials or tokens are exposed publicly. No system can guarantee
                perfect security — use the app over a secure connection. CreatorFlow
                Studio is an independent creator tool, not affiliated with, endorsed
                by, or sponsored by TikTok or its parent company.
              </p>
            </div>
          </div>

          <div className="legal-footer">
            <a href={import.meta.env.BASE_URL}>← Back to home</a>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="page">
      <header className="app-header">
        <div className="app-header-brand">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="CreatorFlow Studio" className="app-icon" />
          <div className="app-header-text">
            <span className="brand-name">CreatorFlow Studio</span>
            <span className="brand-sub">TikTok Content Publishing</span>
          </div>
        </div>
        <div className="app-header-account">
          {tokenResult?.ok && (accountDisplayName || tokenResult?.openId) ? (
            <div className="ui-account-chip">
              {creatorInfo?.avatarUrl ? (
                <img src={creatorInfo.avatarUrl} alt={accountDisplayName || 'Account'} className="ui-account-avatar" />
              ) : (
                <span className="ui-account-placeholder">
                  {accountDisplayName ? accountDisplayName[0].toUpperCase() : '?'}
                </span>
              )}
              <span className="ui-account-name">
                {accountDisplayName
                  ? accountDisplayName.toUpperCase()
                  : `${tokenResult.openId!.slice(0, 6)}…${tokenResult.openId!.slice(-4)}`}
              </span>
            </div>
          ) : (
            <span className="ui-chip-idle">No TikTok account connected</span>
          )}
        </div>

        <div className="app-header-meta">
          <span className={`conn-status ${tokenResult?.ok ? 'conn-ok' : 'conn-idle'}`}>
            {tokenResult?.ok ? '● Connected' : '○ Not connected'}
          </span>
          <a href={`${import.meta.env.BASE_URL}terms/`}>Terms</a>
          <a href={`${import.meta.env.BASE_URL}privacy/`}>Privacy</a>
        </div>
      </header>

      <div className="dashboard">

        {/* ── Column 1: TikTok Connection ── */}
        <section className="card tt-section tt-connection-panel">
          <h2>TikTok Connection</h2>

          <div className="tt-status-row">
            <span className="tt-label">Status</span>
            <span className={`tt-badge ${tokenResult?.ok ? 'tt-ok' : 'conn-idle'}`}>
              {tokenResult?.ok ? '● Connected' : '○ Not connected'}
            </span>
          </div>

          {tokenResult?.openId && (
            <div className="tt-meta-row">
              <span className="tt-label">Account</span>
              <span className="tt-account-value">
                {creatorInfo?.avatarUrl ? (
                  <img src={creatorInfo.avatarUrl} alt={accountDisplayName || 'Account'} className="tt-account-value-avatar" />
                ) : (
                  <span className="tt-account-value-placeholder">
                    {accountDisplayName ? accountDisplayName[0].toUpperCase() : '?'}
                  </span>
                )}
                <span className="tt-account-value-name">
                  {accountDisplayName
                    ? accountDisplayName.toUpperCase()
                    : `${tokenResult.openId.slice(0, 6)}…${tokenResult.openId.slice(-4)}`}
                </span>
              </span>
            </div>
          )}

          {tokenResult?.openId && (
            <div className="tt-meta-row">
              <span className="tt-label">Connection ID</span>
              <span className="tt-code">
                {tokenResult.openId.slice(0, 6)}…{tokenResult.openId.slice(-4)}
              </span>
            </div>
          )}

          {clientKey && (
            <div className="tt-meta-row">
              <span className="tt-label">Client Key</span>
              <span className="tt-code">
                {clientKey.slice(0, 4)}…{clientKey.slice(-4)}
              </span>
            </div>
          )}

          <div className="tt-meta-row">
            <span className="tt-label">Scope</span>
            <span className="tt-scope-value">user.info.basic · video.publish</span>
          </div>

          <button
            type="button"
            className={`tt-btn${hasConnectedTikTok ? ' tt-btn--connected' : ''}`}
            onClick={handleConnect}
            disabled={missingConfig}
          >
            {hasConnectedTikTok ? 'Connected' : 'Connect TikTok'}
          </button>

          {missingConfig && (
            <p className="tt-warning">
              <strong>Config missing:</strong> Client key or redirect URI is not set.
              Connect TikTok is disabled until both are configured.
            </p>
          )}

          <p className="tt-warning">
            <strong>Privacy note:</strong> CreatorFlow Studio connects securely to TikTok.
            Your account credentials are never stored in your browser.
          </p>

          <details className="tt-details">
            <summary className="tt-details-summary">OAuth Callback</summary>

            {!callbackResult ? (
              <p className="tt-warning">No OAuth callback detected yet.</p>
            ) : (
              <>
                <div className="tt-status-row">
                  <span className="tt-label">Code present</span>
                  <span className={`tt-badge ${callbackResult.code ? 'tt-ok' : 'tt-fail'}`}>
                    {callbackResult.code ? 'yes' : 'no'}
                  </span>
                </div>

                <div className="tt-status-row">
                  <span className="tt-label">Returned state present</span>
                  <span className={`tt-badge ${callbackResult.returnedState !== null ? 'tt-ok' : 'tt-fail'}`}>
                    {callbackResult.returnedState !== null ? 'yes' : 'no'}
                  </span>
                </div>

                <div className="tt-status-row">
                  <span className="tt-label">Saved state present</span>
                  <span className={`tt-badge ${callbackResult.savedState !== null ? 'tt-ok' : 'tt-fail'}`}>
                    {callbackResult.savedState !== null ? 'yes' : 'no'}
                  </span>
                </div>

                <div className="tt-status-row">
                  <span className="tt-label">State match</span>
                  <span className={`tt-badge ${
                    callbackResult.returnedState !== null &&
                    callbackResult.savedState !== null &&
                    callbackResult.returnedState === callbackResult.savedState
                      ? 'tt-ok'
                      : 'tt-fail'
                  }`}>
                    {callbackResult.returnedState !== null &&
                     callbackResult.savedState !== null &&
                     callbackResult.returnedState === callbackResult.savedState
                      ? 'yes'
                      : 'no'}
                  </span>
                </div>

                {callbackResult.error && (
                  <>
                    <div className="tt-status-row">
                      <span className="tt-label">Error</span>
                      <span className="tt-badge tt-fail">{callbackResult.error}</span>
                    </div>
                    {callbackResult.errorDescription && (
                      <div className="tt-meta-row">
                        <span className="tt-label">Description</span>
                        <span className="tt-code">{callbackResult.errorDescription}</span>
                      </div>
                    )}
                  </>
                )}

                <p className="tt-warning tt-warning--callback">
                  <strong>Connecting securely:</strong> Your account is being authorized
                  via TikTok's official OAuth flow.
                </p>
              </>
            )}
          </details>

          <details className="tt-details" open={exchangeStatus !== 'idle'}>
            <summary className="tt-details-summary">Token Exchange</summary>

            <div className="tt-status-row">
              <span className="tt-label">Exchange status</span>
              <span className={`tt-badge ${
                exchangeStatus === 'done' && tokenResult?.ok
                  ? 'tt-ok'
                  : exchangeStatus === 'skipped' || (exchangeStatus === 'done' && tokenResult && !tokenResult.ok)
                  ? 'tt-fail'
                  : exchangeStatus === 'loading'
                  ? 'tt-warn'
                  : 'conn-idle'
              }`}>
                {exchangeStatus}
              </span>
            </div>

            {exchangeStatus === 'idle' && (
              <p className="tt-warning">No token exchange initiated yet.</p>
            )}

            {exchangeStatus === 'skipped' && (
              <p className="tt-warning">
                State mismatch — token exchange skipped for security.
              </p>
            )}

            {exchangeStatus === 'loading' && (
              <p className="tt-exchange-loading">Exchanging token with backend…</p>
            )}

            {exchangeStatus === 'done' && tokenResult && (
              <>
                <div className="tt-status-row">
                  <span className="tt-label">ok</span>
                  <span className={`tt-badge ${tokenResult.ok ? 'tt-ok' : 'tt-fail'}`}>
                    {tokenResult.ok ? 'yes' : 'no'}
                  </span>
                </div>

                {tokenResult.ok ? (
                  <>
                    <div className="tt-status-row">
                      <span className="tt-label">Token received</span>
                      <span className={`tt-badge ${tokenResult.tokenReceived ? 'tt-ok' : 'tt-fail'}`}>
                        {tokenResult.tokenReceived ? 'yes' : 'no'}
                      </span>
                    </div>

                    <div className="tt-status-row">
                      <span className="tt-label">open_id received</span>
                      <span className={`tt-badge ${tokenResult.openIdReceived ? 'tt-ok' : 'tt-fail'}`}>
                        {tokenResult.openIdReceived ? 'yes' : 'no'}
                      </span>
                    </div>

                    {tokenResult.openId && (
                      <div className="tt-meta-row">
                        <span className="tt-label">open_id</span>
                        <span className="tt-code">
                          {tokenResult.openId.slice(0, 6)}…{tokenResult.openId.slice(-4)}
                        </span>
                      </div>
                    )}

                    {tokenResult.scope && (
                      <div className="tt-meta-row">
                        <span className="tt-label">Scope</span>
                        <span className="tt-value">{tokenResult.scope}</span>
                      </div>
                    )}

                    {tokenResult.tokenType && (
                      <div className="tt-meta-row">
                        <span className="tt-label">Token type</span>
                        <span className="tt-value">{tokenResult.tokenType}</span>
                      </div>
                    )}

                    {tokenResult.expiresIn != null && (
                      <div className="tt-meta-row">
                        <span className="tt-label">Expires in</span>
                        <span className="tt-value">{tokenResult.expiresIn}s</span>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    {tokenResult.error && (
                      <div className="tt-status-row">
                        <span className="tt-label">Error</span>
                        <span className="tt-badge tt-fail">{tokenResult.error}</span>
                      </div>
                    )}

                    {tokenResult.error_description && (
                      <div className="tt-meta-row">
                        <span className="tt-label">Description</span>
                        <span className="tt-value">{tokenResult.error_description}</span>
                      </div>
                    )}

                    {tokenResult.log_id && (
                      <div className="tt-meta-row">
                        <span className="tt-label">Log ID</span>
                        <span className="tt-code">{tokenResult.log_id}</span>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </details>
        </section>

        {/* ── Column 2: Publish Video ── */}
        <section className="card tt-section tt-publish-panel">
          <h2>Publish Video</h2>

          <div className="tt-section-heading">Creator &amp; Privacy</div>

          {hasConnectedTikTok && !hasVideoPublishScope && (
            <p className="tt-helper-warn">TikTok video.publish scope is required before Direct Post publishing.</p>
          )}

          {tokenResult?.ok && !creatorInfoReady && !creatorInfoLoading && (
            <p className="tt-helper-warn">Creator info must be loaded before publishing.</p>
          )}

          {tokenResult?.ok && !creatorInfo && !creatorInfoLoading && creatorInfoStatus !== 'error' && (
            <div>
              <button
                type="button"
                className="tt-btn-secondary"
                onClick={handleLoadCreatorInfo}
              >
                Load Creator Info
              </button>
            </div>
          )}

          {creatorInfoLoading && (
            <p className="tt-exchange-loading">Loading creator info…</p>
          )}

          {creatorInfoStatus === 'error' && (
            <div>
              <p className="tt-warning">Could not load creator info from TikTok.</p>
              <button
                type="button"
                className="tt-btn-secondary"
                onClick={handleLoadCreatorInfo}
              >
                Retry Creator Info
              </button>
            </div>
          )}

          {creatorInfo && (
            <div className="tt-creator-row">
              {creatorInfo.avatarUrl && (
                <img
                  src={creatorInfo.avatarUrl}
                  alt={creatorInfo.nickname || 'Creator'}
                  className="tt-avatar"
                />
              )}
              <div className="tt-creator-info">
                <span className="tt-creator-name">{creatorInfo.nickname || 'Connected account'}</span>
                {creatorInfo.maxVideoDurationSec != null && (
                  <span className="tt-creator-detail">Max {creatorInfo.maxVideoDurationSec}s</span>
                )}
              </div>
            </div>
          )}

          <div className="tt-video-preview">
            <video
              src={selectedObjectUrl ?? TEST_VIDEO_URL}
              controls
              muted
              className="tt-preview-video"
            />
            <div className="tt-video-choose-row">
              <p className="tt-preview-label">{selectedFile?.name ?? 'tiktok-sandbox-tiny-test.mp4'}</p>
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*"
                aria-label="Choose video file"
                className="tt-file-input-hidden"
                disabled={publishState === 'loading'}
                onChange={handleFileChange}
              />
              <button
                type="button"
                className="tt-btn-choose"
                disabled={publishState === 'loading'}
                onClick={() => {
                  if (fileInputRef.current) {
                    fileInputRef.current.value = '';
                    fileInputRef.current.click();
                  }
                }}
              >
                Choose video
              </button>
            </div>
            {!selectedVideoReady && (
              <p className="tt-helper-warn">Choose a video before publishing.</p>
            )}
          </div>

          <div className="tt-field-row">
            <label className="tt-label" htmlFor="publish-title">Title</label>
            <input
              id="publish-title"
              className="tt-input"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            {trimmedTitle.length === 0 && (
              <p className="tt-helper-warn">Add a title before publishing.</p>
            )}
            {titleTooLong && (
              <p className="tt-helper-warn">Title is too long for TikTok publishing.</p>
            )}
          </div>

          <div className="tt-field-row">
            <label className="tt-label" htmlFor="privacy-level">Privacy</label>
            <select
              id="privacy-level"
              className="tt-select"
              value={privacyLevel}
              onChange={(e) => setPrivacyLevel(e.target.value as PrivacyLevel | '')}
            >
              <option value="" disabled>— Select privacy —</option>
              {availablePrivacyOptions.map(({ value, label }) => (
                <option key={value} value={value} disabled={value === 'SELF_ONLY' && brandContent}>
                  {label}
                </option>
              ))}
            </select>
            {brandContent && (
              <p className="tt-helper-warn">Branded content is unavailable while Privacy is set to Private.</p>
            )}
          </div>

          <div className="tt-interaction-section">
            <span className="tt-label">Interaction controls</span>
            <label className={`tt-consent${creatorInfo?.commentDisabled ? ' tt-consent--disabled' : ''}`}>
              <input
                type="checkbox"
                checked={allowComments}
                disabled={creatorInfo?.commentDisabled}
                onChange={(e) => setAllowComments(e.target.checked)}
              />
              Allow comments
            </label>
            {creatorInfo?.commentDisabled && (
              <p className="tt-helper-warn">Comments are disabled for your account.</p>
            )}
            <label className={`tt-consent${creatorInfo?.duetDisabled ? ' tt-consent--disabled' : ''}`}>
              <input
                type="checkbox"
                checked={allowDuet}
                disabled={creatorInfo?.duetDisabled}
                onChange={(e) => setAllowDuet(e.target.checked)}
              />
              Allow duet
            </label>
            {creatorInfo?.duetDisabled && (
              <p className="tt-helper-warn">Duet is disabled for your account.</p>
            )}
            <label className={`tt-consent${creatorInfo?.stitchDisabled ? ' tt-consent--disabled' : ''}`}>
              <input
                type="checkbox"
                checked={allowStitch}
                disabled={creatorInfo?.stitchDisabled}
                onChange={(e) => setAllowStitch(e.target.checked)}
              />
              Allow stitch
            </label>
            {creatorInfo?.stitchDisabled && (
              <p className="tt-helper-warn">Stitch is disabled for your account.</p>
            )}
          </div>

          <div className="tt-section-heading">Commercial Content Disclosure</div>

          <label className="tt-consent">
            <input
              type="checkbox"
              checked={disclosureEnabled}
              onChange={(e) => {
                setDisclosureEnabled(e.target.checked);
                if (!e.target.checked) {
                  setBrandOrganic(false);
                  setBrandContent(false);
                }
              }}
            />
            Disclose commercial content
          </label>

          {disclosureEnabled && (
            <div className={`tt-disclosure-options${!disclosureOptionSelected || privacyBrandedConflict ? ' tt-disclosure-options--invalid' : ''}`}>
              <label className="tt-consent">
                <input
                  type="checkbox"
                  checked={brandOrganic}
                  onChange={(e) => setBrandOrganic(e.target.checked)}
                />
                Your brand
              </label>
              <label className={`tt-consent${isSelfOnly ? ' tt-consent--disabled' : ''}`}>
                <input
                  type="checkbox"
                  checked={brandContent}
                  disabled={isSelfOnly}
                  onChange={(e) => setBrandContent(e.target.checked)}
                />
                Branded content
              </label>
              {isSelfOnly && (
                <p className="tt-helper-warn">Branded content is unavailable while Privacy is set to Private.</p>
              )}
              {disclosureOptionSelected ? (
                <p className="tt-declaration-label">
                  {brandContent
                    ? "Your photo/video will be labeled as 'Paid partnership'"
                    : "Your photo/video will be labeled as 'Promotional content'"}
                </p>
              ) : (
                <p className="tt-helper-warn">
                  You need to indicate if your content promotes yourself, a third party, or both.
                </p>
              )}
            </div>
          )}

          <label className="tt-consent">
            <input
              type="checkbox"
              checked={musicUsageConfirmed}
              onChange={(e) => setMusicUsageConfirmed(e.target.checked)}
            />
            <span>
              {brandContent ? (
                <>
                  By posting, you agree to TikTok's{' '}
                  <a
                    className="tt-policy-link"
                    href={BRANDED_CONTENT_POLICY_URL}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Branded Content Policy
                  </a>{' '}
                  and{' '}
                  <a
                    className="tt-policy-link"
                    href={MUSIC_USAGE_CONFIRMATION_URL}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Music Usage Confirmation
                  </a>
                </>
              ) : (
                <>
                  By posting, you agree to TikTok's{' '}
                  <a
                    className="tt-policy-link"
                    href={MUSIC_USAGE_CONFIRMATION_URL}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Music Usage Confirmation
                  </a>
                </>
              )}
            </span>
          </label>

          <label className="tt-consent">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            I confirm I want to publish to my connected TikTok account.
          </label>

          <p className="tt-declaration tt-processing-notice">
            After publishing, your content may take a few minutes to process and become visible on your TikTok profile.
          </p>

          <div>
            <button
              type="button"
              className="tt-btn"
              onClick={handlePublish}
              disabled={!canPublish}
            >
              {publishState === 'loading' ? 'Publishing…' : 'Publish to TikTok'}
            </button>
          </div>
        </section>

        {/* ── Column 3: Publish Status / Audit Readiness ── */}
        <section className="card tt-section tt-status-panel">
          <h2>Publish Status</h2>

          {publishState === 'idle' && (
            <p className="tt-status-idle">Publish results and status checks will appear here after upload.</p>
          )}

          {publishState !== 'idle' && (
            <div className="tt-exchange">
              {publishState === 'loading' && (
                <p className="tt-exchange-loading">Publishing video…</p>
              )}

              {publishState === 'done' && publishResult && (
                <>
                  <div className="tt-status-row">
                    <span className="tt-label">TikTok publish</span>
                    <span className={`tt-badge ${publishOutcomeClass(publishResult)}`}>
                      {publishOutcomeLabel(publishResult)}
                    </span>
                  </div>

                  {publishPending(publishResult) && (
                    <p className="tt-helper-warn">
                      Waiting for TikTok to report PUBLISH_COMPLETE.
                    </p>
                  )}

                  {publishResult.ok != null && (
                    <div className="tt-status-row">
                      <span className="tt-label">Request accepted</span>
                      <span className={`tt-badge ${publishResult.ok ? 'tt-ok' : 'tt-fail'}`}>
                        {publishResult.ok ? 'yes' : 'no'}
                      </span>
                    </div>
                  )}

                  {publishResult.initOk != null && (
                    <div className="tt-status-row">
                      <span className="tt-label">Init request</span>
                      <span className={`tt-badge ${publishResult.initOk ? 'tt-ok' : 'tt-fail'}`}>
                        {publishResult.initOk ? 'ok' : 'failed'}
                      </span>
                    </div>
                  )}

                  {publishResult.uploadOk != null && (
                    <div className="tt-status-row">
                      <span className="tt-label">Upload request</span>
                      <span className={`tt-badge ${publishResult.uploadOk ? 'tt-ok' : 'tt-fail'}`}>
                        {publishResult.uploadOk ? 'ok' : 'failed'}
                      </span>
                    </div>
                  )}

                  {publishResult.error && publishResult.error !== publishResult.failReason && (
                    <div className="tt-meta-row">
                      <span className="tt-label">error</span>
                      <span className="tt-code">{publishResult.error}</span>
                    </div>
                  )}

                  {publishResult.publishId != null && (
                    <div className="tt-meta-row">
                      <span className="tt-label">publishId</span>
                      <span className="tt-code">
                        {publishResult.publishId.length > 12
                          ? `${publishResult.publishId.slice(0, 8)}…${publishResult.publishId.slice(-4)}`
                          : publishResult.publishId}
                      </span>
                    </div>
                  )}

                  {publishResult.binaryUploadOk != null && (
                    <div className="tt-status-row">
                      <span className="tt-label">binaryUploadOk</span>
                      <span className={`tt-badge ${publishResult.binaryUploadOk ? 'tt-ok' : 'tt-fail'}`}>
                        {String(publishResult.binaryUploadOk)}
                      </span>
                    </div>
                  )}

                  {publishResult.binaryUploadStatus != null && (
                    <div className="tt-meta-row">
                      <span className="tt-label">binaryUploadStatus</span>
                      <span className="tt-value">{publishResult.binaryUploadStatus}</span>
                    </div>
                  )}

                  {publishResult.statusCheckOk != null && (
                    <div className="tt-status-row">
                      <span className="tt-label">Status check</span>
                      <span className={`tt-badge ${publishResult.statusCheckOk ? 'tt-ok' : 'tt-fail'}`}>
                        {publishResult.statusCheckOk ? 'ok' : 'failed'}
                      </span>
                    </div>
                  )}

                  {publishResult.publishStatus != null && (
                    <div className="tt-status-row">
                      <span className="tt-label">publishStatus</span>
                      <span className={`tt-badge ${publishOutcomeClass(publishResult)}`}>
                        {publishStatusLabel(publishResult.publishStatus)}
                      </span>
                    </div>
                  )}

                  {publishResult.failReason != null && (
                    <div className="tt-meta-row">
                      <span className="tt-label">failReason</span>
                      <span className="tt-code">{publishResult.failReason}</span>
                    </div>
                  )}

                  {publishResult.uploadedBytes != null && (
                    <div className="tt-meta-row">
                      <span className="tt-label">uploadedBytes</span>
                      <span className="tt-value">{publishResult.uploadedBytes.toLocaleString()}</span>
                    </div>
                  )}
                </>
              )}

              {sheetSyncStatus !== 'idle' && (
                <p className={`tt-sheet-sync${sheetSyncStatus === 'saved' ? ' tt-sheet-sync--ok' : sheetSyncStatus === 'failed' ? ' tt-sheet-sync--fail' : ''}`}>
                  {sheetSyncStatus === 'loading' && 'Review audit log: syncing…'}
                  {sheetSyncStatus === 'saved' && 'Review audit log: saved'}
                  {sheetSyncStatus === 'failed' && 'Review audit log: skipped/failed'}
                </p>
              )}

              {publishState === 'done' && publishResult?.publishId != null && (
                <>
                  <hr className="tt-divider" />

                  <button
                    type="button"
                    className="tt-btn-secondary"
                    onClick={handleRefreshStatus}
                    disabled={statusRefreshState === 'loading'}
                  >
                    {statusRefreshState === 'loading' ? 'Checking…' : 'Refresh Status'}
                  </button>

                  {statusRefreshState === 'done' && statusRefreshResult && (
                    <div className="tt-refresh-result">
                      <div className="tt-status-row">
                        <span className="tt-label">Final publish</span>
                        <span className={`tt-badge ${publishOutcomeClass(statusRefreshResult)}`}>
                          {publishOutcomeLabel(statusRefreshResult)}
                        </span>
                      </div>

                      {publishPending(statusRefreshResult) && (
                        <p className="tt-helper-warn">
                          Waiting for TikTok to report PUBLISH_COMPLETE.
                        </p>
                      )}

                      {(statusRefreshResult.checkOk ?? statusRefreshResult.statusCheckOk) != null && (
                        <div className="tt-status-row">
                          <span className="tt-label">Status check</span>
                          <span className={`tt-badge ${
                            (statusRefreshResult.checkOk ?? statusRefreshResult.statusCheckOk) ? 'tt-ok' : 'tt-fail'
                          }`}>
                            {(statusRefreshResult.checkOk ?? statusRefreshResult.statusCheckOk) ? 'ok' : 'failed'}
                          </span>
                        </div>
                      )}

                      {statusRefreshResult.publishStatus != null && (
                        <div className="tt-status-row">
                          <span className="tt-label">publishStatus</span>
                          <span className={`tt-badge ${publishOutcomeClass(statusRefreshResult)}`}>
                            {publishStatusLabel(statusRefreshResult.publishStatus)}
                          </span>
                        </div>
                      )}

                      {statusRefreshResult.failReason != null && (
                        <div className="tt-meta-row">
                          <span className="tt-label">failReason</span>
                          <span className="tt-code">{statusRefreshResult.failReason}</span>
                        </div>
                      )}

                      {statusRefreshResult.uploadedBytes != null && (
                        <div className="tt-meta-row">
                          <span className="tt-label">uploadedBytes</span>
                          <span className="tt-value">{statusRefreshResult.uploadedBytes.toLocaleString()}</span>
                        </div>
                      )}

                      {statusRefreshResult.error && statusRefreshResult.error !== statusRefreshResult.failReason && (
                        <div className="tt-meta-row">
                          <span className="tt-label">error</span>
                          <span className="tt-code">{statusRefreshResult.error}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {statusRefreshSheetSync !== 'idle' && (
                    <p className={`tt-sheet-sync${statusRefreshSheetSync === 'saved' ? ' tt-sheet-sync--ok' : statusRefreshSheetSync === 'failed' ? ' tt-sheet-sync--fail' : ''}`}>
                      {statusRefreshSheetSync === 'loading' && 'Review audit log: syncing…'}
                      {statusRefreshSheetSync === 'saved' && 'Review audit log: saved'}
                      {statusRefreshSheetSync === 'failed' && 'Review audit log: skipped/failed'}
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          <hr className="tt-divider" />

          <div className="tt-audit">
            <h4 className="tt-audit-title">Audit Readiness</h4>
            {auditItems.map((item) => (
              <div
                key={item.label}
                className={`tt-audit-item ${item.pass ? 'tt-audit-item--ok' : 'tt-audit-item--pending'}`}
              >
                <span className={`tt-audit-dot ${item.pass ? 'tt-audit-dot--ok' : 'tt-audit-dot--pending'}`} />
                <span>{item.label}</span>
              </div>
            ))}
          </div>

          <details className="tt-details">
            <summary className="tt-details-summary">Technical Details</summary>
            <div className="tt-tech-details">
              <div className="tt-meta-row">
                <span className="tt-label">OAuth scope</span>
                <span className="tt-value">user.info.basic · video.publish</span>
              </div>
              <div className="tt-meta-row">
                <span className="tt-label">Upload mode</span>
                <span className="tt-value">FILE_UPLOAD</span>
              </div>
              <div className="tt-meta-row">
                <span className="tt-label">Video</span>
                <span className="tt-code">{selectedFile?.name ?? 'tiktok-sandbox-tiny-test.mp4'}</span>
              </div>
              {publishResult?.connectionOpenIdMasked && (
                <div className="tt-meta-row">
                  <span className="tt-label">Connection open_id</span>
                  <span className="tt-code">{publishResult.connectionOpenIdMasked}</span>
                </div>
              )}
              {publishResult?.connectionScope && (
                <div className="tt-meta-row">
                  <span className="tt-label">Connection scope</span>
                  <span className="tt-value">{publishResult.connectionScope}</span>
                </div>
              )}
              {publishResult?.connectionLastTokenExchangeAt && (
                <div className="tt-meta-row">
                  <span className="tt-label">Last token exchange</span>
                  <span className="tt-code">{publishResult.connectionLastTokenExchangeAt}</span>
                </div>
              )}
              {publishResult?.connectionFound != null && (
                <div className="tt-status-row">
                  <span className="tt-label">Connection found</span>
                  <span className={`tt-badge ${publishResult.connectionFound ? 'tt-ok' : 'tt-fail'}`}>
                    {String(publishResult.connectionFound)}
                  </span>
                </div>
              )}
              {publishResult?.tokenAvailable != null && (
                <div className="tt-status-row">
                  <span className="tt-label">Token available</span>
                  <span className={`tt-badge ${publishResult.tokenAvailable ? 'tt-ok' : 'tt-fail'}`}>
                    {String(publishResult.tokenAvailable)}
                  </span>
                </div>
              )}
              {publishResult?.openIdPresent != null && (
                <div className="tt-status-row">
                  <span className="tt-label">open_id present</span>
                  <span className={`tt-badge ${publishResult.openIdPresent ? 'tt-ok' : 'tt-fail'}`}>
                    {String(publishResult.openIdPresent)}
                  </span>
                </div>
              )}
            </div>
          </details>

          <p className="tt-disclaimer">
            CreatorFlow Studio is an independent creator tool and is not affiliated with or endorsed by TikTok.
          </p>
        </section>

      </div>
    </main>
  );
}

export default App;
