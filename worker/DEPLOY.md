# Worker deployment

This Cloudflare Worker receives browser uploads (via tus-js-client) and streams them into one Google Drive folder, owned by your account. It replaces the Apps Script backend for uploads and the gallery listing.

You do these steps once. Everything is on free tiers.

## Part A — Google OAuth (get a refresh token)

The Worker uploads to Drive as you, using a long-lived refresh token. We use the `drive.file` scope, which is non-sensitive, so the OAuth app can be published to Production (needed for a non-expiring refresh token) without Google verification.

1. Go to https://console.cloud.google.com — sign in as **jmacd263@gmail.com**.
2. Create a project (top bar project picker, New project). Name it anything.
3. **Enable the Drive API:** APIs & Services, Library, search "Google Drive API", Enable.
4. **OAuth consent screen:** APIs & Services, OAuth consent screen.
   - User type: **External**, Create.
   - App name, your email for support + developer contact. Save and continue.
   - Scopes: Save and continue (we request the scope at token time).
   - Test users: add **jmacd263@gmail.com**. Save.
   - Back on the OAuth consent screen, click **Publish app → Confirm** so the status is **In production**. (With only `drive.file` this needs no verification.)
5. **Create credentials:** APIs & Services, Credentials, Create credentials, **OAuth client ID**.
   - Application type: **Web application**.
   - Authorised redirect URIs: add `https://developers.google.com/oauthplayground`.
   - Create. Copy the **Client ID** and **Client secret**.
6. **Mint the refresh token** with the OAuth Playground:
   - Go to https://developers.google.com/oauthplayground.
   - Click the gear (top right), tick **Use your own OAuth credentials**, paste the Client ID and Client secret.
   - In the left "Input your own scopes" box, enter: `https://www.googleapis.com/auth/drive.file`
   - Click **Authorize APIs**, sign in as jmacd263@gmail.com, allow.
   - Click **Exchange authorization code for tokens**.
   - Copy the **Refresh token** (starts with `1//`).

You now have: Client ID, Client secret, Refresh token.

## Part B — Deploy the Worker

1. Install wrangler if needed: `npm install -g wrangler` (or use `npx wrangler` for each command).
2. From this `worker/` directory, log in: `wrangler login` (opens the browser; sign in to / create a free Cloudflare account).
3. Set the secrets (each prompts for the value, paste and Enter):
   ```
   wrangler secret put GOOGLE_CLIENT_ID
   wrangler secret put GOOGLE_CLIENT_SECRET
   wrangler secret put GOOGLE_REFRESH_TOKEN
   wrangler secret put STATE_SECRET      # any long random string
   wrangler secret put SETUP_SECRET      # any long random string
   ```
4. Deploy: `wrangler deploy`. Copy the Worker URL it prints (like `https://wedding-photos-uploader.<subdomain>.workers.dev`).

## Part C — Create the Drive folder

`drive.file` scope can only use folders the app itself created, so create one via the Worker:

1. Visit (replace the secret and pick a name):
   ```
   https://wedding-photos-uploader.<subdomain>.workers.dev/setup?secret=YOUR_SETUP_SECRET&name=Hannah%20and%20Jamie%20wedding%20photos
   ```
2. It returns `{ "folderId": "..." }`. Copy that id.
3. Put it in `wrangler.toml` as `DRIVE_FOLDER_ID`, then redeploy: `wrangler deploy`.

The folder appears in your Drive; everything uploaded lands there for select-all download.

## Part D — Point the frontend at the Worker

Give me the Worker URL and I will set it in `index.html`, then test and push.

## Redeploying later

Just `wrangler deploy` again. Secrets persist; no re-auth. The refresh token stays valid as long as the OAuth app is in Production and you do not revoke access.
