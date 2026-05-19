import { useEffect, useState } from 'react';
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
  'https://potucky.github.io/creatorflow-studio/test-videos/tiktok-sandbox-tiny-test.mp4';
const DEFAULT_TITLE = 'Creator video upload';
const GOOGLE_SHEET_WEBHOOK_URL =
  'https://script.google.com/macros/s/AKfycbztz1c-8Hy4pk6mQ8CYBWYXCoTPmmcJXnJ77GVk4w8mVs0-Kt2PA_uQ0sN-msEyx73I8w/exec';
const CREATOR_INFO_URL =
  'https://ggeoggxygoiydnxwclcn.supabase.co/functions/v1/tiktok-creator-info';

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
}

// Safe fields only — upload_url, access_token, refresh_token intentionally absent
interface PublishResult {
  ok?: boolean;
  publishId?: string | null;
  binaryUploadOk?: boolean | null;
  binaryUploadStatus?: string | null;
  statusCheckOk?: boolean | null;
  publishStatus?: string | null;
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
  statusCheckOk?: boolean;
  publishId?: string | null;
  publishStatus?: string | null;
  failReason?: string | null;
  uploadedBytes?: number | null;
  tikTokErrorCode?: string;
  tikTokErrorMessage?: string;
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
  avatarUrl: string | null;
  maxVideoDurationSec: number | null;
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
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
    if (exchangeStatus !== 'done' || !tokenResult?.ok || !tokenResult?.openId) return;
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
        setCreatorInfo({
          privacyLevelOptions: Array.isArray(data.privacy_level_options) ? data.privacy_level_options : [],
          nickname: data.nickname ?? null,
          avatarUrl: data.avatar_url ?? null,
          maxVideoDurationSec: data.max_video_post_duration_sec ?? null,
          commentDisabled: data.comment_disabled ?? false,
          duetDisabled: data.duet_disabled ?? false,
          stitchDisabled: data.stitch_disabled ?? false,
        });
        setCreatorInfoStatus('done');
      })
      .catch(() => setCreatorInfoStatus('error'));
  }, [exchangeStatus, tokenResult]);

  const clientKey = import.meta.env.VITE_TIKTOK_CLIENT_KEY as string | undefined;
  const redirectUri = import.meta.env.VITE_TIKTOK_REDIRECT_URI as string | undefined;
  const missingConfig = !clientKey || !redirectUri;

  function handleConnect() {
    if (!clientKey || !redirectUri) return;
    window.location.href = buildAuthUrl(clientKey, redirectUri);
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
        setCreatorInfo({
          privacyLevelOptions: Array.isArray(data.privacy_level_options) ? data.privacy_level_options : [],
          nickname: data.nickname ?? null,
          avatarUrl: data.avatar_url ?? null,
          maxVideoDurationSec: data.max_video_post_duration_sec ?? null,
          commentDisabled: data.comment_disabled ?? false,
          duetDisabled: data.duet_disabled ?? false,
          stitchDisabled: data.stitch_disabled ?? false,
        });
        setCreatorInfoStatus('done');
      })
      .catch(() => setCreatorInfoStatus('error'));
  }

  async function logToGoogleSheet(result: PublishResult, videoTitle: string, notes = ''): Promise<boolean> {
    const now = new Date().toISOString();
    const payload = {
      ok: result.ok ?? null,
      binaryUploadOk: result.binaryUploadOk ?? null,
      binaryUploadStatus: result.binaryUploadStatus ?? null,
      statusCheckOk: result.statusCheckOk ?? null,
      publishStatus: result.publishStatus ?? null,
      videoTitle,
      publishId: result.publishId ?? null,
      uploadedBytes: result.uploadedBytes ?? null,
      environment: 'sandbox',
      videoUrl: TEST_VIDEO_URL,
      errorMessage: result.error ?? null,
      connectionOpenIdMasked: result.connectionOpenIdMasked ?? null,
      connectionScope: result.connectionScope ?? null,
      connectionLastTokenExchangeAt: result.connectionLastTokenExchangeAt ?? null,
      connectionFound: result.connectionFound ?? null,
      tokenAvailable: result.tokenAvailable ?? null,
      openIdPresent: result.openIdPresent ?? null,
      createdAt: now,
      updatedAt: now,
      notes,
    };
    try {
      const res = await fetch(GOOGLE_SHEET_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async function handlePublish() {
    setPublishState('loading');
    setPublishResult(null);
    setSheetSyncStatus('idle');
    let result: PublishResult;
    try {
      const publishBody: Record<string, unknown> = {
        open_id: tokenResult?.openId ?? undefined,
        upload_mode: 'FILE_UPLOAD',
        upload_binary: true,
        check_status: true,
        video_url: TEST_VIDEO_URL,
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
    setPublishResult(result);
    setPublishState('done');
    // Reset any previous refresh when a new upload is done
    setStatusRefreshState('idle');
    setStatusRefreshResult(null);
    setStatusRefreshSheetSync('idle');

    // Fire-and-forget: must not block or affect the upload result
    setSheetSyncStatus('loading');
    logToGoogleSheet(result, title)
      .then((synced) => setSheetSyncStatus(synced ? 'saved' : 'failed'))
      .catch(() => setSheetSyncStatus('failed'));
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

    // Fire-and-forget: log refresh result to Google Sheet
    setStatusRefreshSheetSync('loading');
    const asPublishResult: PublishResult = {
      ok: result.ok,
      publishId: result.publishId,
      statusCheckOk: result.statusCheckOk,
      publishStatus: result.publishStatus,
      uploadedBytes: result.uploadedBytes,
      error: result.error,
      connectionOpenIdMasked: result.connectionOpenIdMasked,
      connectionScope: result.connectionScope,
      connectionLastTokenExchangeAt: result.connectionLastTokenExchangeAt,
      connectionFound: result.connectionFound,
      tokenAvailable: result.tokenAvailable,
      openIdPresent: result.openIdPresent,
    };
    logToGoogleSheet(asPublishResult, title, 'status_refresh')
      .then((synced) => setStatusRefreshSheetSync(synced ? 'saved' : 'failed'))
      .catch(() => setStatusRefreshSheetSync('failed'));
  }

  const isSelfOnly = privacyLevel === 'SELF_ONLY';
  const privacyBrandedConflict = brandContent && isSelfOnly;
  const disclosureOptionSelected = brandOrganic || brandContent;
  const declarationText = brandContent
    ? "By posting, you agree to TikTok's Branded Content Policy and Music Usage Confirmation."
    : "By posting, you agree to TikTok's Music Usage Confirmation";
  const auditDeclarationLabel = brandContent
    ? 'Branded Content Policy and Music Usage Confirmation agreed'
    : 'Music Usage Confirmation agreed';
  const privacyOptionLabels: Record<PrivacyLevel, string> = {
    PUBLIC_TO_EVERYONE: 'Public',
    MUTUAL_FOLLOW_FRIENDS: 'Friends',
    FOLLOWER_OF_CREATOR: 'Followers',
    SELF_ONLY: 'Private',
  };
  const availablePrivacyOptions = (
    creatorInfo?.privacyLevelOptions && creatorInfo.privacyLevelOptions.length > 0
      ? creatorInfo.privacyLevelOptions
      : (['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY'] as PrivacyLevel[])
  ).map((value) => ({ value, label: privacyOptionLabels[value] }));

  const auditItems = [
    { label: 'Official website and brand visible', pass: true },
    { label: 'Terms and Privacy links in header', pass: true },
    { label: 'TikTok OAuth connected', pass: tokenResult?.ok === true },
    { label: 'Connected account identity visible', pass: !!(tokenResult?.openId) },
    { label: 'Creator info loaded from TikTok', pass: creatorInfoStatus === 'done' && creatorInfo !== null },
    { label: 'Privacy manually selected from TikTok options', pass: privacyLevel !== '' },
    { label: 'Interaction controls visible', pass: true },
    { label: auditDeclarationLabel, pass: consent },
    { label: 'Commercial disclosure handled', pass: !disclosureEnabled || (disclosureOptionSelected && !privacyBrandedConflict) },
    { label: 'Video preview visible', pass: true },
    { label: 'User consent confirmed', pass: consent },
    { label: 'Tokens stored server-side only', pass: true },
  ];

  if (path.includes('/terms')) {
    return (
      <main className="page">
        <section className="card">
          <div className="page-header-row">
            <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="CreatorFlow Studio" className="app-icon" />
            <span className="brand-name">CreatorFlow Studio</span>
          </div>
          <hr className="brand-divider" />
          <h1>Terms of Service</h1>
          <p className="muted">Last updated: May 4, 2026</p>

          <h2>Purpose</h2>
          <p>
            CreatorFlow Studio is a creator tool intended to help the account
            owner connect their own TikTok account, review their creator-owned videos,
            and send them to TikTok for publishing through TikTok's official Content
            Posting API.
          </p>

          <h2>Authorized Use</h2>
          <p>
            The application may only be used by the authorized account owner for
            content that they own or have permission to publish.
          </p>

          <h2>Prohibited Use</h2>
          <p>
            The application must not be used for scraping, spam, artificial engagement,
            unauthorized posting, impersonation, misleading activity, or any activity
            that violates TikTok's policies or applicable law.
          </p>

          <h2>User Responsibility</h2>
          <p>
            The user is responsible for reviewing all content, captions, and publishing
            settings before posting.
          </p>

          <a href={import.meta.env.BASE_URL}>Back to home</a>
        </section>
      </main>
    );
  }

  if (path.includes('/privacy')) {
    return (
      <main className="page">
        <section className="card">
          <div className="page-header-row">
            <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="CreatorFlow Studio" className="app-icon" />
            <span className="brand-name">CreatorFlow Studio</span>
          </div>
          <hr className="brand-divider" />
          <h1>Privacy Policy</h1>
          <p className="muted">Last updated: May 4, 2026</p>

          <h2>Overview</h2>
          <p>
            CreatorFlow Studio is a creator tool that helps the account owner connect
            their own TikTok account and send creator-owned short-form videos to TikTok
            for review and publishing through TikTok's official Content Posting API.
          </p>

          <h2>Information We May Access</h2>
          <p>
            With user authorization, the application may access basic TikTok account
            information and permissions required to upload or publish video content.
          </p>

          <h2>How Information Is Used</h2>
          <p>
            Information is used only to authenticate the account owner and perform
            authorized content upload or publishing actions through TikTok's API.
          </p>

          <h2>Data Sharing</h2>
          <p>
            The application does not sell personal information. Data is not shared with
            third parties except as required to operate the integration with TikTok's API.
          </p>

          <h2>Data Storage</h2>
          <p>
            API credentials and access tokens must be stored securely and must not be
            exposed publicly or committed to public repositories.
          </p>

          <a href={import.meta.env.BASE_URL}>Back to home</a>
        </section>
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
        <section className="card tt-section">
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
              <span className="tt-value">
                {creatorInfo?.nickname
                  ? creatorInfo.nickname.toUpperCase()
                  : `${tokenResult.openId.slice(0, 6)}…${tokenResult.openId.slice(-4)}`}
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
            <span className="tt-value">user.info.basic · video.publish</span>
          </div>

          <button
            type="button"
            className="tt-btn"
            onClick={handleConnect}
            disabled={missingConfig}
          >
            Connect TikTok
          </button>

          <p className="tt-warning">
            <strong>Privacy note:</strong> CreatorFlow Studio connects securely to TikTok.
            Your account credentials are never stored in your browser.
          </p>

          {callbackResult && (
            <details className="tt-details">
              <summary className="tt-details-summary">OAuth Callback</summary>

              <div className="tt-status-row">
                <span className="tt-label">Authorization code</span>
                <span className={`tt-badge ${callbackResult.code ? 'tt-ok' : 'tt-fail'}`}>
                  {callbackResult.code ? 'present' : 'missing'}
                </span>
              </div>

              <div className="tt-status-row">
                <span className="tt-label">State</span>
                {callbackResult.returnedState === null ? (
                  <span className="tt-badge tt-warn">not returned</span>
                ) : callbackResult.savedState === null ? (
                  <span className="tt-badge tt-warn">no saved state</span>
                ) : callbackResult.returnedState === callbackResult.savedState ? (
                  <span className="tt-badge tt-ok">matches</span>
                ) : (
                  <span className="tt-badge tt-fail">does not match</span>
                )}
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
            </details>
          )}

          {exchangeStatus !== 'idle' && (
            <details className="tt-details" open>
              <summary className="tt-details-summary">Token Exchange</summary>

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
                    <span className="tt-label">Status</span>
                    <span className={`tt-badge ${tokenResult.ok ? 'tt-ok' : 'tt-fail'}`}>
                      {tokenResult.ok ? 'ok' : 'error'}
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
                        <span className="tt-label">Open ID received</span>
                        <span className={`tt-badge ${tokenResult.openIdReceived ? 'tt-ok' : 'tt-fail'}`}>
                          {tokenResult.openIdReceived ? 'yes' : 'no'}
                        </span>
                      </div>

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
          )}
        </section>

        {/* ── Column 2: Publish Video ── */}
        <section className="card tt-section">
          <h2>Publish Video</h2>

          <div className="tt-video-preview">
            <video
              src={TEST_VIDEO_URL}
              controls
              muted
              className="tt-preview-video"
            />
            <div className="tt-video-choose-row">
              <p className="tt-preview-label">tiktok-sandbox-tiny-test.mp4</p>
              <button type="button" className="tt-btn-choose" disabled>Choose video</button>
            </div>
          </div>

          <div className="tt-section-heading">Creator &amp; Privacy</div>

          {tokenResult?.ok && !creatorInfo && creatorInfoStatus !== 'loading' && creatorInfoStatus !== 'error' && (
            <div>
              <p className="tt-helper-warn">Creator info required to confirm available privacy options.</p>
              <button
                type="button"
                className="tt-btn-secondary"
                onClick={handleLoadCreatorInfo}
              >
                Load Creator Info
              </button>
            </div>
          )}

          {creatorInfoStatus === 'loading' && (
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

          <div className="tt-field-row">
            <label className="tt-label" htmlFor="publish-title">Title</label>
            <input
              id="publish-title"
              className="tt-input"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
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
              <p className="tt-helper-warn">Branded content visibility cannot be set to private.</p>
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
            <div className="tt-disclosure-options">
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
                <p className="tt-helper-warn">Branded content visibility cannot be set to private.</p>
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

          <p className="tt-declaration">{declarationText}</p>

          <label className="tt-consent">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            I confirm I want to publish to my connected TikTok account.
          </label>

          <div>
            <button
              type="button"
              className="tt-btn"
              onClick={handlePublish}
              disabled={
                !consent ||
                publishState === 'loading' ||
                !privacyLevel ||
                privacyBrandedConflict ||
                (disclosureEnabled && !disclosureOptionSelected)
              }
            >
              {publishState === 'loading' ? 'Publishing…' : 'Publish to TikTok'}
            </button>
          </div>
        </section>

        {/* ── Column 3: Publish Status / Audit Readiness ── */}
        <section className="card tt-section">
          <h2>Publish Status</h2>

          {publishState === 'idle' && (
            <p className="tt-status-idle">Publish result will appear here after upload.</p>
          )}

          {publishState !== 'idle' && (
            <div className="tt-exchange">
              {publishState === 'loading' && (
                <p className="tt-exchange-loading">Publishing video…</p>
              )}

              {publishState === 'done' && publishResult && (
                <>
                  <div className="tt-status-row">
                    <span className="tt-label">ok</span>
                    <span className={`tt-badge ${publishResult.ok ? 'tt-ok' : 'tt-fail'}`}>
                      {String(publishResult.ok)}
                    </span>
                  </div>

                  {publishResult.error && (
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
                      <span className="tt-label">statusCheckOk</span>
                      <span className={`tt-badge ${publishResult.statusCheckOk ? 'tt-ok' : 'tt-fail'}`}>
                        {String(publishResult.statusCheckOk)}
                      </span>
                    </div>
                  )}

                  {publishResult.publishStatus != null && (
                    <>
                      <div className="tt-status-row">
                        <span className="tt-label">publishStatus</span>
                        <span className={`tt-badge ${
                          publishResult.publishStatus === 'PUBLISH_COMPLETE'
                            ? 'tt-ok'
                            : publishResult.publishStatus === 'SEND_TO_USER_INBOX'
                            ? 'tt-warn'
                            : publishResult.publishStatus === 'FAILED'
                            ? 'tt-fail'
                            : 'tt-warn'
                        }`}>
                          {publishResult.publishStatus === 'SEND_TO_USER_INBOX'
                            ? 'SEND_TO_USER_INBOX — not Direct Post'
                            : publishResult.publishStatus}
                        </span>
                      </div>
                      {publishResult.publishStatus === 'SEND_TO_USER_INBOX' && (
                        <p className="tt-helper-warn">
                          SEND_TO_USER_INBOX means content was routed to inbox, not published directly.
                          This is a legacy/incompatible response for Direct Post.
                        </p>
                      )}
                    </>
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
                  {sheetSyncStatus === 'loading' && 'Google Sheet sync: syncing…'}
                  {sheetSyncStatus === 'saved' && 'Google Sheet sync: saved'}
                  {sheetSyncStatus === 'failed' && 'Google Sheet sync: skipped/failed'}
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
                        <span className="tt-label">ok</span>
                        <span className={`tt-badge ${statusRefreshResult.ok ? 'tt-ok' : 'tt-fail'}`}>
                          {String(statusRefreshResult.ok)}
                        </span>
                      </div>

                      {statusRefreshResult.publishStatus != null && (
                        <>
                          <div className="tt-status-row">
                            <span className="tt-label">publishStatus</span>
                            <span className={`tt-badge ${
                              statusRefreshResult.publishStatus === 'PUBLISH_COMPLETE'
                                ? 'tt-ok'
                                : statusRefreshResult.publishStatus === 'SEND_TO_USER_INBOX'
                                ? 'tt-warn'
                                : statusRefreshResult.publishStatus === 'FAILED'
                                ? 'tt-fail'
                                : 'tt-warn'
                            }`}>
                              {statusRefreshResult.publishStatus === 'SEND_TO_USER_INBOX'
                                ? 'SEND_TO_USER_INBOX — not Direct Post'
                                : statusRefreshResult.publishStatus}
                            </span>
                          </div>
                          {statusRefreshResult.publishStatus === 'SEND_TO_USER_INBOX' && (
                            <p className="tt-helper-warn">
                              SEND_TO_USER_INBOX means content was routed to inbox, not published directly.
                              This is incompatible with Direct Post.
                            </p>
                          )}
                        </>
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

                      {statusRefreshResult.tikTokErrorCode && (
                        <div className="tt-meta-row">
                          <span className="tt-label">tikTokErrorCode</span>
                          <span className="tt-code">{statusRefreshResult.tikTokErrorCode}</span>
                        </div>
                      )}

                      {statusRefreshResult.tikTokErrorMessage && (
                        <div className="tt-meta-row">
                          <span className="tt-label">tikTokErrorMessage</span>
                          <span className="tt-code">{statusRefreshResult.tikTokErrorMessage}</span>
                        </div>
                      )}

                      {statusRefreshResult.error && (
                        <div className="tt-meta-row">
                          <span className="tt-label">error</span>
                          <span className="tt-code">{statusRefreshResult.error}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {statusRefreshSheetSync !== 'idle' && (
                    <p className={`tt-sheet-sync${statusRefreshSheetSync === 'saved' ? ' tt-sheet-sync--ok' : statusRefreshSheetSync === 'failed' ? ' tt-sheet-sync--fail' : ''}`}>
                      {statusRefreshSheetSync === 'loading' && 'Google Sheet sync: syncing…'}
                      {statusRefreshSheetSync === 'saved' && 'Google Sheet sync: saved'}
                      {statusRefreshSheetSync === 'failed' && 'Google Sheet sync: skipped/failed'}
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
              <div key={item.label} className="tt-audit-item">
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
                <span className="tt-code">tiktok-sandbox-tiny-test.mp4</span>
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
