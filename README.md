# Wedding photo uploader

A guest photo uploader for Hannah and Jamie's wedding (Westray, Orkney, 18 July 2026). Guests open a link in any mobile browser, pick photos or videos, and tap upload. Every file lands in one Google Drive folder owned by Jamie, so downloading everything afterwards is a select-all in Drive.

## How it works

- `index.html` is a single static page served by GitHub Pages. It reads each file, base64-encodes it, and POSTs it to a Google Apps Script web app.
- `apps-script/Code.gs` is the backend. It runs as Jamie, decodes each file, and writes it into one Drive folder. Because the script executes as Jamie, every file is owned by his account regardless of which guest uploaded it. Guests authenticate against nothing.

The POST is sent as a CORS "simple request" (`Content-Type: text/plain;charset=utf-8`, everything in a JSON string body) so the browser skips the preflight that Apps Script web apps cannot answer.

## Deployment

### 1. Drive folder

Sign in to Drive as **jmacd263@gmail.com**, create the folder, open it, and copy the ID from the URL (the part after `/folders/`). Paste it into `uploadFolderId` in `apps-script/Code.gs`.

### 2. Apps Script web app

1. Go to script.google.com (signed in as **jmacd263@gmail.com**), New project.
2. Paste the contents of `apps-script/Code.gs` over the default `Code.gs`.
3. Deploy, New deployment, type **Web app**.
4. Set **Execute as: Me**.
5. Set **Who has access: Anyone**.
6. Authorise when prompted. It warns because the script writes to Drive; that is expected. Click through Advanced, Go to project, Allow.
7. Copy the resulting `/exec` URL.

### 3. Frontend

Paste the `/exec` URL into `uploadEndpointUrl` at the top of the `index.html` script.

### 4. GitHub Pages

Push the repo to GitHub, then in repo Settings, Pages, set the source to the `main` branch root. Wait for the published URL.

### 5. Share

Put the Pages URL behind a short link or a QR code on the table cards at Harray Hall. A QR is the lowest-friction option for guests.

### Redeploying

If you change `Code.gs` later, use **Manage deployments** and edit the existing deployment so the `/exec` URL stays the same. Creating a fresh deployment gives a new URL and means updating the frontend again.

## What I need from you

The Drive and Apps Script steps above are manual browser steps signed in as **jmacd263@gmail.com**. I cannot automate them. Once you have the `/exec` URL and the folder ID, paste them into the two config constants:

- `uploadEndpointUrl` in `index.html`
- `uploadFolderId` in `apps-script/Code.gs`

## Test checklist (do before the day)

- Upload from iPhone Safari and from Android Chrome. Both must work.
- Upload a HEIC photo from an iPhone. They store and download fine from Drive; preview support varies but the archive is intact. Confirm it lands.
- Upload a short video and confirm it lands.
- Upload a file over the 35 MB cap and confirm it is skipped with the clear message.
- Upload several files at once and confirm sequential progress and the per-file done state.
- Kill the connection mid-upload and confirm the retry and failed states behave.
- Confirm every test file appears in the Drive folder, then select all in Drive and download as a single zip to confirm the bulk-download flow.
- Confirm the success ticks appear. If files land but success never confirms, the frontend already falls back to optimistic success on request completion.
