// Cloudflare Worker that bridges anonymous browser uploads to Google Drive.
//
// The browser uploads with tus-js-client (resumable, chunked, retrying). This
// Worker implements the minimal tus 1.0.0 server surface and streams each
// chunk to a Google Drive resumable session server-to-server, so Drive's lack
// of CORS on its upload endpoint never reaches the browser. Files are owned by
// the account whose refresh token this Worker holds, and land in one folder.
//
// Required secrets / vars (see DEPLOY.md):
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN  (secrets)
//   STATE_SECRET        (secret) random string, signs the opaque upload tokens
//   DRIVE_FOLDER_ID     (var)    the app-created folder, from the /setup call
//   ALLOWED_ORIGIN      (var)    the GitHub Pages origin allowed by CORS
//   SETUP_SECRET        (secret) guards the one-time /setup folder creation

const TUS_VERSION = "1.0.0";
const DRIVE_FILES_ENDPOINT = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD_ENDPOINT = "https://www.googleapis.com/upload/drive/v3/files";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return corsResponse(request, env, new Response(null, { status: 204 }));
    }

    try {
      if (request.method === "GET" && url.pathname === "/gallery") {
        return corsResponse(request, env, await listGallery(env));
      }
      if (request.method === "GET" && url.pathname === "/setup") {
        return await setupFolder(request, env, url);
      }
      if (request.method === "POST" && url.pathname === "/") {
        return corsResponse(request, env, await createUpload(request, env, url));
      }
      if (url.pathname.startsWith("/u/")) {
        const uploadToken = url.pathname.slice("/u/".length);
        if (request.method === "HEAD") {
          return corsResponse(request, env, await headUpload(env, uploadToken));
        }
        if (request.method === "PATCH") {
          return corsResponse(request, env, await patchUpload(request, env, uploadToken));
        }
      }
      return corsResponse(request, env, new Response("Not found", { status: 404 }));
    } catch (error) {
      return corsResponse(request, env, new Response(String(error), { status: 500 }));
    }
  },
};

// --- CORS ---------------------------------------------------------------

// ALLOWED_ORIGIN is a comma-separated allowlist. Echo the request's origin when
// it is on the list so several origins (production plus local testing) work
// without weakening to a wildcard.
function resolveAllowedOrigin(request, env) {
  const allowList = (env.ALLOWED_ORIGIN || "*").split(",").map(function (entry) {
    return entry.trim();
  });
  if (allowList.indexOf("*") !== -1) {
    return "*";
  }
  const requestOrigin = request.headers.get("Origin");
  if (requestOrigin && allowList.indexOf(requestOrigin) !== -1) {
    return requestOrigin;
  }
  return allowList[0];
}

function corsResponse(request, env, response) {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", resolveAllowedOrigin(request, env));
  headers.set("Vary", "Origin");
  headers.set("Access-Control-Allow-Methods", "GET, POST, HEAD, PATCH, OPTIONS");
  headers.set(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type, Tus-Resumable, Upload-Length, Upload-Metadata, Upload-Offset, X-HTTP-Method-Override"
  );
  headers.set(
    "Access-Control-Expose-Headers",
    "Location, Tus-Resumable, Upload-Offset, Upload-Length"
  );
  headers.set("Tus-Resumable", TUS_VERSION);
  return new Response(response.body, { status: response.status, headers: headers });
}

// --- Google auth --------------------------------------------------------

let cachedAccessToken = null;
let cachedAccessTokenExpiry = 0;

async function getAccessToken(env) {
  const now = Date.now();
  if (cachedAccessToken && now < cachedAccessTokenExpiry) {
    return cachedAccessToken;
  }

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: env.GOOGLE_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });

  if (!tokenResponse.ok) {
    throw new Error("Could not refresh Google access token: " + (await tokenResponse.text()));
  }

  const tokenData = await tokenResponse.json();
  cachedAccessToken = tokenData.access_token;
  // Refresh a minute before the real expiry to avoid edge-of-life failures.
  cachedAccessTokenExpiry = now + (tokenData.expires_in - 60) * 1000;
  return cachedAccessToken;
}

// --- Opaque upload token (signed, prevents tampering / SSRF) ------------

async function signingKey(env) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.STATE_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

function toBase64Url(bytes) {
  let binary = "";
  for (const byteValue of bytes) {
    binary += String.fromCharCode(byteValue);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text) {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function encodeUploadToken(env, payloadObject) {
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payloadObject));
  const payloadPart = toBase64Url(payloadBytes);
  const signatureBytes = new Uint8Array(
    await crypto.subtle.sign("HMAC", await signingKey(env), payloadBytes)
  );
  return payloadPart + "." + toBase64Url(signatureBytes);
}

async function decodeUploadToken(env, uploadToken) {
  const separatorIndex = uploadToken.lastIndexOf(".");
  if (separatorIndex === -1) {
    throw new Error("Malformed upload token.");
  }
  const payloadPart = uploadToken.slice(0, separatorIndex);
  const signaturePart = uploadToken.slice(separatorIndex + 1);

  const payloadBytes = fromBase64Url(payloadPart);
  const signatureIsValid = await crypto.subtle.verify(
    "HMAC",
    await signingKey(env),
    fromBase64Url(signaturePart),
    payloadBytes
  );
  if (!signatureIsValid) {
    throw new Error("Upload token signature is invalid.");
  }
  return JSON.parse(new TextDecoder().decode(payloadBytes));
}

// --- tus: create a new upload (POST /) ----------------------------------

function isAllowedMimeType(mimeType) {
  return (
    typeof mimeType === "string" &&
    (mimeType.indexOf("image/") === 0 || mimeType.indexOf("video/") === 0)
  );
}

function decodeMetadataValue(encodedValue) {
  const binary = atob(encodedValue);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new TextDecoder().decode(bytes);
}

async function createUpload(request, env, url) {
  const totalLength = Number(request.headers.get("Upload-Length"));
  if (!Number.isFinite(totalLength) || totalLength <= 0) {
    return new Response("Missing Upload-Length", { status: 400 });
  }

  const metadata = {};
  const rawMetadata = request.headers.get("Upload-Metadata");
  if (rawMetadata) {
    for (const pair of rawMetadata.split(",")) {
      const [key, encodedValue] = pair.trim().split(" ");
      if (key && encodedValue) {
        metadata[key] = decodeMetadataValue(encodedValue);
      }
    }
  }

  const fileName = metadata.filename || "upload";
  const mimeType = metadata.filetype || "application/octet-stream";
  if (!isAllowedMimeType(mimeType)) {
    return new Response("Unsupported file type", { status: 415 });
  }

  const accessToken = await getAccessToken(env);
  const initiationResponse = await fetch(DRIVE_UPLOAD_ENDPOINT + "?uploadType=resumable", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + accessToken,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": mimeType,
      "X-Upload-Content-Length": String(totalLength),
    },
    body: JSON.stringify({
      name: buildStoredFileName(fileName),
      parents: [env.DRIVE_FOLDER_ID],
    }),
  });

  if (!initiationResponse.ok) {
    return new Response("Could not start Drive upload: " + (await initiationResponse.text()), {
      status: 502,
    });
  }

  const driveSessionUrl = initiationResponse.headers.get("Location");
  const uploadToken = await encodeUploadToken(env, {
    sessionUrl: driveSessionUrl,
    total: totalLength,
    mimeType: mimeType,
  });

  const locationUrl = url.origin + "/u/" + uploadToken;
  return new Response(null, {
    status: 201,
    headers: { Location: locationUrl, "Upload-Offset": "0" },
  });
}

// --- tus: report current offset (HEAD /u/:token) ------------------------

async function headUpload(env, uploadToken) {
  const session = await decodeUploadToken(env, uploadToken);
  const offset = await queryDriveOffset(session.sessionUrl, session.total);
  return new Response(null, {
    status: 200,
    headers: {
      "Upload-Offset": String(offset),
      "Upload-Length": String(session.total),
      "Cache-Control": "no-store",
    },
  });
}

async function queryDriveOffset(sessionUrl, total) {
  // A PUT with an unsatisfiable range asks Drive how many bytes it already has.
  const statusResponse = await fetch(sessionUrl, {
    method: "PUT",
    headers: { "Content-Range": "bytes */" + total, "Content-Length": "0" },
  });

  if (statusResponse.status === 200 || statusResponse.status === 201) {
    return total;
  }
  const rangeHeader = statusResponse.headers.get("Range");
  if (rangeHeader) {
    // Range looks like "bytes=0-1048575"; the next byte to send is end + 1.
    const lastByte = Number(rangeHeader.split("-")[1]);
    return lastByte + 1;
  }
  return 0;
}

// --- tus: append a chunk (PATCH /u/:token) ------------------------------

async function patchUpload(request, env, uploadToken) {
  const session = await decodeUploadToken(env, uploadToken);
  const offset = Number(request.headers.get("Upload-Offset"));
  if (!Number.isFinite(offset) || offset < 0) {
    return new Response("Missing Upload-Offset", { status: 400 });
  }

  const chunkBuffer = await request.arrayBuffer();
  const chunkLength = chunkBuffer.byteLength;
  if (chunkLength === 0) {
    return new Response("Empty chunk", { status: 400 });
  }

  const rangeEnd = offset + chunkLength - 1;
  const driveResponse = await fetch(session.sessionUrl, {
    method: "PUT",
    headers: {
      "Content-Range": "bytes " + offset + "-" + rangeEnd + "/" + session.total,
      "Content-Length": String(chunkLength),
    },
    body: chunkBuffer,
  });

  if (driveResponse.status === 200 || driveResponse.status === 201) {
    const uploadedFile = await driveResponse.json();
    await shareFile(env, uploadedFile.id);
    return new Response(null, {
      status: 204,
      headers: { "Upload-Offset": String(session.total) },
    });
  }

  if (driveResponse.status === 308) {
    const rangeHeader = driveResponse.headers.get("Range");
    const newOffset = rangeHeader ? Number(rangeHeader.split("-")[1]) + 1 : rangeEnd + 1;
    return new Response(null, {
      status: 204,
      headers: { "Upload-Offset": String(newOffset) },
    });
  }

  return new Response("Drive rejected chunk: " + (await driveResponse.text()), { status: 502 });
}

async function shareFile(env, fileId) {
  const accessToken = await getAccessToken(env);
  await fetch(DRIVE_FILES_ENDPOINT + "/" + fileId + "/permissions", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + accessToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ role: "reader", type: "anyone" }),
  });
}

// --- Gallery listing (GET /gallery) -------------------------------------

async function listGallery(env) {
  const accessToken = await getAccessToken(env);
  const query = encodeURIComponent("'" + env.DRIVE_FOLDER_ID + "' in parents and trashed = false");
  const fields = encodeURIComponent("files(id,name,mimeType,createdTime)");
  const listResponse = await fetch(
    DRIVE_FILES_ENDPOINT +
      "?q=" + query +
      "&fields=" + fields +
      "&orderBy=createdTime desc&pageSize=1000",
    { headers: { Authorization: "Bearer " + accessToken } }
  );

  if (!listResponse.ok) {
    return jsonResponse({ status: "error", message: "Could not list folder." }, 502);
  }

  const listData = await listResponse.json();
  const files = (listData.files || [])
    .filter(function (file) {
      return isAllowedMimeType(file.mimeType);
    })
    .map(function (file) {
      return { id: file.id, name: file.name, mimeType: file.mimeType };
    });

  return jsonResponse({ status: "success", files: files });
}

// --- One-time folder creation (GET /setup?secret=...&name=...) ----------

async function setupFolder(request, env, url) {
  if (url.searchParams.get("secret") !== env.SETUP_SECRET) {
    return new Response("Forbidden", { status: 403 });
  }

  const folderName = url.searchParams.get("name") || "Wedding photos";
  const accessToken = await getAccessToken(env);
  const createResponse = await fetch(DRIVE_FILES_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + accessToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: folderName,
      mimeType: "application/vnd.google-apps.folder",
    }),
  });

  if (!createResponse.ok) {
    return new Response("Could not create folder: " + (await createResponse.text()), {
      status: 502,
    });
  }

  const folder = await createResponse.json();
  return jsonResponse({
    status: "success",
    folderId: folder.id,
    note: "Set DRIVE_FOLDER_ID to this id and redeploy.",
  });
}

// --- helpers ------------------------------------------------------------

function buildStoredFileName(originalFileName) {
  const now = new Date();
  const pad = function (value) {
    return String(value).padStart(2, "0");
  };
  const timestamp =
    now.getUTCFullYear() +
    pad(now.getUTCMonth() + 1) +
    pad(now.getUTCDate()) +
    "-" +
    pad(now.getUTCHours()) +
    pad(now.getUTCMinutes()) +
    pad(now.getUTCSeconds());
  return timestamp + "_" + originalFileName;
}

function jsonResponse(payloadObject, status) {
  return new Response(JSON.stringify(payloadObject), {
    status: status || 200,
    headers: { "Content-Type": "application/json" },
  });
}
