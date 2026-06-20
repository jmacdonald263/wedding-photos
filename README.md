# Wedding photo uploader

A guest photo uploader for Hannah and Jamie's wedding (Westray, Orkney, 18 July 2026). Guests open a link in any mobile browser, pick photos or videos, and tap upload. Every file lands in one Google Drive folder owned by Jamie, so downloading everything afterwards is a select-all in Drive.

## How it works

- `index.html` is a single static page served by GitHub Pages. It uploads each file to a Google Apps Script web app and shows a gallery of everything uploaded so far.
- `apps-script/Code.gs` is the backend. It runs as Jamie and writes every file into one Drive folder. Because the script executes as Jamie, every file is owned by his account regardless of which guest uploaded it. Guests authenticate against nothing.

All requests to the script are sent as CORS "simple requests" (`Content-Type: text/plain;charset=utf-8`, everything in a JSON string body) so the browser skips the preflight that Apps Script web apps cannot answer.

### Uploads

- **Files up to 35 MB** go up whole in one base64 POST.
- **Larger files** (long videos) are split into 8 MB chunks. The browser cannot upload to Drive directly because Drive's resumable endpoint sends no CORS headers, so each chunk is POSTed to the script, which forwards it to a Drive resumable session server-to-server (no CORS, no size limit). Progress is reported per chunk.

### Gallery

A "View all photos" toggle fetches the folder listing (`doGet`) and shows a thumbnail grid. Tapping a tile opens a lightbox with prev/next, keyboard and swipe navigation, and a play/pause slideshow; videos play inline. Each uploaded file is shared "anyone with link" so its thumbnail renders. The folder itself stays private, and the file IDs are long and unguessable.

## Deployment

### 1. Drive folder

Sign in to Drive as **jmacd263@gmail.com**, create the folder, open it, and copy the ID from the URL (the part after `/folders/`). Paste it into `uploadFolderId` in `apps-script/Code.gs`.

### 2. Apps Script web app

1. Go to script.google.com (signed in as **jmacd263@gmail.com**), New project.
2. Paste the contents of `apps-script/Code.gs` over the default `Code.gs`.
3. Deploy, New deployment, type **Web app**.
4. Set **Execute as: Me**.
5. Set **Who has access: Anyone**.
6. Authorise when prompted. It warns because the script writes to Drive and makes external requests (the chunked-upload path calls the Drive API); that is expected. Click through Advanced, Go to project, Allow. Make sure the consent screen is for the account that owns the Drive folder.
7. Copy the resulting `/exec` URL.

### 3. Frontend

Paste the `/exec` URL into `uploadEndpointUrl` at the top of the `index.html` script.

### 4. GitHub Pages

Push the repo to GitHub, then in repo Settings, Pages, set the source to the `main` branch root. Wait for the published URL.

### 5. Share

Put the Pages URL behind a short link or a QR code on the table cards at Harray Hall. A QR is the lowest-friction option for guests.

### Redeploying

If you change `Code.gs` later, use **Manage deployments**, edit the existing deployment, and in the **Version** dropdown choose **New version** before clicking Deploy. This keeps the same `/exec` URL while actually serving the new code. Leaving the version unchanged silently keeps serving the old code; creating a fresh deployment gives a new URL and means updating the frontend again.

If a change adds a new permission (for example the first time the chunked-upload code calls the Drive API), the running web app needs that scope authorised. Editing a deployment does not always prompt for it. The reliable way to grant it: in the editor, pick any function and click **Run**, then complete the authorisation popup (allow popups for `script.google.com` if nothing appears).

## What I need from you

The Drive and Apps Script steps above are manual browser steps signed in as **jmacd263@gmail.com**. I cannot automate them. Once you have the `/exec` URL and the folder ID, paste them into the two config constants:

- `uploadEndpointUrl` in `index.html`
- `uploadFolderId` in `apps-script/Code.gs`

## Test checklist (do before the day)

- Upload from iPhone Safari and from Android Chrome. Both must work.
- Upload a HEIC photo from an iPhone. They store and download fine from Drive; preview support varies but the archive is intact. Confirm it lands.
- Upload a short video and confirm it lands.
- Upload a large video (over 35 MB) and confirm the chunked path runs (progress percentage climbs) and it lands at full size.
- Upload several files at once and confirm sequential progress and the per-file done state.
- Kill the connection mid-upload and confirm the retry and failed states behave.
- Open "View all photos" and confirm the gallery loads, the lightbox opens, the slideshow plays, and a video plays inline.
- Confirm every test file appears in the Drive folder, then select all in Drive and download as a single zip to confirm the bulk-download flow.
- Delete any test files from the Drive folder before the day so they do not appear in the gallery.
