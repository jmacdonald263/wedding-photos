# Wedding photo uploader: implementation brief

A guest photo uploader for Hannah and Jamie's wedding (Westray, Orkney, 18 July 2026). Guests open a link in any mobile browser, pick photos or videos, and tap upload. Every file lands in one Google Drive folder owned by Jamie, so downloading everything afterwards is a select-all in Drive. No guest login, no app, works on iPhone and Android.

## Coding conventions (follow throughout)

- British English in all user-facing copy.
- No em dashes anywhere.
- Verbose, fully spelled-out variable names (for example `uploadEndpointUrl`, not `epUrl`).
- No meta comments explaining changes. Comments only for genuinely non-obvious logic (the CORS workaround is the one place a short comment is warranted).
- Plain static frontend, no build step. A single `index.html` with inline CSS and JS so GitHub Pages serves it directly.

## Architecture

Two pieces:

1. Static frontend on GitHub Pages: a single `index.html` upload page.
2. Google Apps Script web app as the backend: receives each file and writes it into a Drive folder.

The frontend POSTs each file to the Apps Script `/exec` URL. The script runs as Jamie, so all files are owned by his account and collected in one folder. Guests authenticate against nothing.

### The one technical gotcha: CORS

GitHub Pages and Apps Script are different origins, and Apps Script web apps do not handle CORS preflight (OPTIONS) requests. The proven workaround is to make the request a CORS "simple request" so the browser skips the preflight entirely:

- Send the POST with `Content-Type: text/plain;charset=utf-8`.
- Put everything (file as base64, plus metadata) in a JSON string in the body.
- Apps Script reads the raw body via `e.postData.contents` and `JSON.parse`s it.

This works against an "Anyone" web-app deployment in current Apps Script and the JSON response is readable by the frontend. Verify this in the test pass (see checklist); if response reading ever fails, fall back to treating a completed request as optimistic success.

## Repository structure

```
wedding-photos/
  index.html        <- GitHub Pages frontend
  apps-script/
    Code.gs         <- paste into the Apps Script editor (not served by Pages)
  README.md         <- deployment + test steps (can be this brief, trimmed)
```

## File 1: index.html (frontend)

### Design direction

Match the wedding stationery so this feels like part of the set, not a generic form. The seating board already uses dark teal and burnt orange with Cormorant Garamond, so reuse that. Light background, because guests will be using this outdoors in July daylight and legibility matters more than mood.

Design tokens:

- Colour:
  - `--parchment` `#F6EFE2` (warm cream background)
  - `--ink` `#123A3A` (deep teal, primary text and structure)
  - `--teal` `#1C4E4A` (secondary teal)
  - `--ember` `#C2562A` (burnt orange, primary action and accent)
  - `--ember-soft` `#D97A4E` (hover / progress)
  - `--stone` `#8A8073` (muted captions and secondary text)
- Type:
  - Display and the couple's names: Cormorant Garamond (use the italic for the names), loaded from Google Fonts.
  - UI, body, captions, progress: a quiet humanist sans (Inter from Google Fonts, or `system-ui` if you would rather not pull a second font). Keep the controls in the sans for legibility; keep Cormorant for the headings only.
- Signature element: one restrained motif, a fine hand-drawn-feel line or coastline wave used as a divider under the names. Keep it disciplined, a single thin SVG stroke in `--ember`. Do not over-animate.

Layout, mobile-first single centred column:

```
        [ eyebrow: 18 July 2026 . Westray, Orkney ]
              Hannah & Jamie         (Cormorant italic, large)
              ~~~~~ (thin divider motif) ~~~~~
        one warm line of instruction (sans, --stone)

        [  large tap target: Choose photos or videos  ]   (--ember)
        [  Your name (optional)  ]                         (text input)

        --- upload list appears here as files are added ---
        filename .......... progress / done / failed
```

### Behaviour

- One config constant at the very top of the script: `const uploadEndpointUrl = "PASTE_APPS_SCRIPT_EXEC_URL_HERE";`
- File input accepts `image/*` and `video/*`, `multiple`. The big button triggers the hidden file input. Drag and drop is a nice-to-have on desktop but not required for mobile.
- Optional uploader name field. If filled, it is sent with each file and used in the stored filename so the couple can see who sent what.
- Upload files sequentially, one at a time, not in parallel. Island signal can be patchy and sequential with a single retry per file is the most reliable choice.
- Per-file progress in the list: pending, uploading, done (tick in `--ember`), or failed with a short reason and a retry affordance.
- Reading each file: use `FileReader.readAsDataURL`, then strip the `data:...;base64,` prefix to get the base64 payload.
- Request: `fetch(uploadEndpointUrl, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ fileName, mimeType, fileData, uploaderName }) })`. Parse the JSON response and check `status === "success"`. On failure, retry once, then mark the file failed.
- Size cap: skip any file whose original size exceeds about 35 MB and show a clear message on that row. Reason: the Apps Script POST limit is 50 MB and base64 inflates the payload by roughly a third, so around 35 MB of original is the safe ceiling. This is fine for photos; very long 4K videos will exceed it, which is an acceptable trade-off for a photo-first uploader. State the cap plainly in the skipped-file message rather than failing silently.
- Do not downscale or re-encode images. Upload originals at full resolution.

### Copy (write in the interface's voice, British English)

- Eyebrow: `18 July 2026 . Westray, Orkney`
- Instruction line, warm and plain, for example: `Share your photos and videos from the day. Pick as many as you like.`
- Button: `Choose photos or videos`
- Name field placeholder: `Your name (optional)`
- Done state per file: `Uploaded`
- Failed state: explain what to do, for example `Upload failed. Tap to try again.`
- Skipped (too large): `This file is too large to upload here.`
- Empty state under the list before anything is chosen: a single quiet line, for example `Your photos will appear here as they upload.`

### Quality floor

- Responsive down to a narrow phone viewport.
- Visible keyboard focus on the button and input.
- Respect `prefers-reduced-motion`.
- Large, thumb-friendly tap targets.

## File 2: apps-script/Code.gs (backend)

- One config constant at the top: `const uploadFolderId = "PASTE_DRIVE_FOLDER_ID_HERE";`
- Implement `doPost(e)`:
  - `JSON.parse(e.postData.contents)` to get `fileName`, `mimeType`, `fileData` (base64), `uploaderName`.
  - `Utilities.base64Decode(fileData)` to bytes, then `Utilities.newBlob(bytes, mimeType, storedFileName)`.
  - Get the folder with `DriveApp.getFolderById(uploadFolderId)` and `folder.createFile(blob)`.
  - Stored filename convention to aid attribution and sorting: `uploaderNameOrGuest_yyyyMMdd-HHmmss_originalFileName`. Sanitise the uploader name to a safe token. Drive permits duplicate names within a folder (it keys on file ID), so there is no overwrite risk, but the prefix keeps things tidy.
  - Return `ContentService.createTextOutput(JSON.stringify({ status: "success", fileId }))` with `setMimeType(ContentService.MimeType.JSON)`.
  - Wrap the whole thing in try/catch and on error return `{ status: "error", message }` as JSON.
- No `doGet` is needed unless you want a health-check endpoint, which is optional.

## Deployment steps

1. Drive folder: create the folder in Jamie's Drive, open it, and copy the ID from the URL (the part after `/folders/`). Paste it into `uploadFolderId` in `Code.gs`.
2. Apps Script: go to script.google.com, new project, paste `Code.gs`. Deploy, New deployment, type Web app. Set Execute as: Me. Set Who has access: Anyone. Authorise when prompted (it will warn because the script writes to Drive; that is expected). Copy the resulting `/exec` URL.
3. Frontend: paste that `/exec` URL into `uploadEndpointUrl` in `index.html`.
4. GitHub Pages: push the repo to GitHub, then in the repo Settings, Pages, set the source to the `main` branch root. Wait for the published URL.
5. Share: put the Pages URL behind a short link or a QR code on the table cards at Harray Hall. A QR is the lowest-friction option for guests.

Note: if you redeploy the Apps Script with code changes, use Manage deployments and edit the existing deployment so the `/exec` URL stays the same, otherwise you will get a new URL and have to update the frontend.

## Test checklist (do this before the day)

- Upload from iPhone Safari and from Android Chrome. Both must work.
- Upload a HEIC photo from an iPhone. iPhones shoot HEIC by default, so files will arrive as `.heic`. They store and download fine from Drive; preview support varies, but the archive is intact. No conversion needed. Just confirm it lands.
- Upload a short video and confirm it lands.
- Upload a file over the 35 MB cap and confirm it is skipped with the clear message rather than failing silently or hanging.
- Upload several files at once and confirm sequential progress and the per-file done state.
- Kill the connection mid-upload and confirm the retry and failed states behave.
- Confirm every test file appears in the Drive folder, then select all in Drive and download as a single zip to confirm the bulk-download flow.
- Confirm the response is readable (success ticks appear). If success never confirms despite files landing, that is the CORS response-reading edge case: switch to optimistic success on request completion.
