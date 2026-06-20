# Wedding photo uploader

A guest photo and video uploader for Hannah and Jamie's wedding (18 July 2026). Guests open a link in any mobile browser, pick photos or videos, and tap upload. Every file lands in one Google Drive folder owned by Jamie, so downloading everything afterwards is a select-all in Drive.

## How it works

Two pieces:

1. **Frontend** (`index.html`) — a single static page served by GitHub Pages. Uploads use [tus-js-client](https://github.com/tus/tus-js-client), which chunks each file and resumes after a dropped connection. A "View all photos" gallery shows everything uploaded so far, with a lightbox slideshow.
2. **Backend** (`worker/`) — a Cloudflare Worker. It implements the tus protocol and streams each chunk into a Google Drive resumable upload session server-to-server. It holds Jamie's Google OAuth refresh token as a secret, so every file is owned by Jamie's account and lands in one folder. Guests authenticate against nothing.

### Why a Worker, not the browser talking to Drive directly

Google Drive's resumable upload endpoint sends no CORS headers, so a browser cannot upload to it cross-origin. Giving the browser an OAuth token would expose full Drive access to every guest. The Worker solves both: it holds the token server-side and does the Drive upload itself, while exposing a clean, CORS-enabled tus endpoint to the browser. Large videos work because the Worker streams chunks rather than buffering whole files.

The earlier `apps-script/Code.gs` backend is retired (kept for reference). It hit Apps Script's ~50 MB POST limit on large videos; the Worker has no such limit.

## Deploying the backend (Cloudflare Worker)

See [worker/DEPLOY.md](worker/DEPLOY.md) for the full click-by-click. In short:

1. **Google**: create a project, enable the Drive API, set the OAuth consent screen to Production, create an OAuth web client, and mint a refresh token with the `drive.file` scope. (`drive.file` is non-sensitive, so Production needs no Google verification and the refresh token does not expire.)
2. **Cloudflare**: `wrangler login`, set the secrets (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `STATE_SECRET`, `SETUP_SECRET`), then `wrangler deploy`.
3. **Folder**: call `…/setup?secret=…&name=…` once to create the Drive folder, put the returned id in `worker/wrangler.toml` as `DRIVE_FOLDER_ID`, and `wrangler deploy` again.

`ALLOWED_ORIGIN` in `wrangler.toml` is a comma-separated CORS allowlist (the GitHub Pages origin, plus localhost for testing).

## Deploying the frontend (GitHub Pages)

1. Put the Worker URL into `workerBaseUrl` at the top of the `index.html` script.
2. Push to GitHub; in repo Settings, Pages, set the source to the `main` branch root.
3. Put the published URL behind a QR code on the table cards. (See `wedding-photos-qr.*`.)

## Test checklist (do before the day)

- Upload from iPhone Safari and from Android Chrome. Both must work.
- Upload a HEIC photo from an iPhone. They store and download fine from Drive; preview support varies but the archive is intact. Confirm it lands.
- Upload a large video (hundreds of MB) and confirm the progress percentage climbs and it lands at full size.
- On weak signal, confirm a dropped upload resumes rather than restarting (tus handles this).
- Upload several files at once and confirm sequential progress and the per-file done state.
- Open "View all photos" and confirm the gallery loads, the lightbox opens, the slideshow plays, and a video plays inline.
- Select all in the Drive folder and download as a single zip to confirm the bulk-download flow.
- Delete any test files from the Drive folder before the day so they do not appear in the gallery.
