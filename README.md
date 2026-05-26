# CreatorFlow Studio

A creator tool for managing short-form video publishing workflows through TikTok's official Content Posting API.

## What it does

CreatorFlow Studio lets the authorized account owner connect their own TikTok account and send creator-owned short-form videos to TikTok for review and publishing through TikTok's official Content Posting API.

The app does **not** perform scraping, follower automation, mass liking, mass commenting, artificial engagement, or unauthorized posting.

## Official URLs

| Page | URL |
| --- | --- |
| Public site | <https://app.usgoit.com/> |
| Terms of Service | <https://app.usgoit.com/terms/> |
| Privacy Policy | <https://app.usgoit.com/privacy/> |
| Redirect URI | <https://app.usgoit.com/> |

## TikTok integration

- **API**: TikTok Content Posting API Direct Post
- **OAuth scopes**: `user.info.basic`, `video.publish`
- **Creator info**: loaded through `/v2/post/publish/creator_info/query/` before publishing so the app can show the connected identity, allowed privacy options, interaction controls, and max video duration returned by TikTok
- **Direct Post endpoint**: `/v2/post/publish/video/init/`
- **Status endpoint**: `/v2/post/publish/status/fetch/`; the UI treats `PUBLISH_COMPLETE` as final success and keeps processing states visibly pending
- **User controls**: users manually select privacy, choose a video, review the preview/title/interactions, complete commercial disclosure, confirm Music Usage, and give final publish consent before the publish button is enabled
- **Tokens**: access and refresh tokens are stored server-side in Supabase only; they are never returned to the browser

## Review status

CreatorFlow Studio is prepared for TikTok Content Posting API Direct Post review. The remaining known architecture risk is that the browser still receives the TikTok `open_id` and Supabase functions use that caller-supplied identifier to load the stored connection. Tokens remain server-side, but a future hardening pass should replace this with an opaque session-bound connection handle.

## Production review

The TikTok app is currently submitted for production review. Do not recall the review or change production app settings, scopes, URLs, or products while the review is pending.

## Stack

- React + TypeScript + Vite (frontend, GitHub Pages)
- Supabase Edge Functions (token exchange, publish, status check)
- TikTok Content Posting API v2

## Environment variables

Create a `.env.local` file in the project root (never commit real values):

```env
VITE_TIKTOK_CLIENT_KEY=your_client_key_here
VITE_TIKTOK_REDIRECT_URI=https://app.usgoit.com/
```

Supabase Edge Function secrets are set via `supabase secrets set` — see [SANDBOX_CHECKLIST.md](SANDBOX_CHECKLIST.md) for the full list.

## Security

- `client_secret` is server-side only; never in frontend code or logs
- `access_token` and `refresh_token` are stored in Supabase and never returned to the browser
- `SUPABASE_SERVICE_ROLE_KEY` is server-side only
- No real secrets in `.env.example` or any committed file
