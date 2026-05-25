# TikTok App Review Text

Use this text in the TikTok App Review section for the current Direct Post
resubmission.

## Explain how each product and scope works

CreatorFlow Studio uses TikTok Login Kit and the Content Posting API Direct
Post flow to help creators publish original short-form videos to their own
connected TikTok account.

The `user.info.basic` scope is used to identify the authorized creator account
and display safe account identity information during the posting flow.

The `video.publish` scope is used for Direct Post. Before publishing, the app
queries creator information through `/v2/post/publish/creator_info/query/` and
uses TikTok's returned `privacy_level_options`, account identity, interaction
settings, and max video duration data in the review page.

Users must manually choose a privacy option, choose a local video, see a video
preview, enter or edit the title, choose interaction settings, complete
Commercial Content Disclosure when applicable, confirm TikTok's Music Usage
Confirmation, and separately confirm that they want to publish to the connected
TikTok account. The publish button remains disabled until those requirements are
met.

Publishing is initialized through `/v2/post/publish/video/init/`, and status is
checked through `/v2/post/publish/status/fetch/`. The app displays processing
states honestly and does not show final success unless TikTok reports
`PUBLISH_COMPLETE`.

TikTok access and refresh tokens are exchanged and stored server-side through
Supabase Edge Functions. Tokens and client secrets are not returned to the
browser.

The app does not scrape content, automate engagement, add promotional
watermarks, or post without user consent. Users control the content, metadata,
and the final publish action. The app displays post status after submission.

## Important

Do not submit for review until the app has a real posting flow and a demo video.

A fake demo video is risky. The demo video should show the real website/app
where the Content Posting API integration is implemented.
