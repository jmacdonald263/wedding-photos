const uploadFolderId = "1-ErnuCRc3-m6-Ebku__DVpRCZm7IIRWn";

// Smaller files arrive whole in one base64 POST, which the Apps Script body
// limits to about 50 MB; base64 inflates the payload by a third, so originals
// are capped here. Larger files are chunked instead and have no such limit.
const maximumBase64FileSizeInBytes = 35 * 1024 * 1024;

function doPost(e) {
  try {
    const requestBody = JSON.parse(e.postData.contents);

    if (requestBody.action === "startResumableUpload") {
      return startResumableUpload(requestBody);
    }
    if (requestBody.action === "uploadChunk") {
      return uploadChunk(requestBody);
    }
    return handleBase64Upload(requestBody);
  } catch (error) {
    return jsonResponse({ status: "error", message: String(error) });
  }
}

// Large files are uploaded in chunks. The browser cannot PUT to Drive directly
// (its resumable endpoint sends no CORS headers), so the browser sends each
// chunk to this script as a small base64 POST and the script forwards it to a
// Drive resumable session server-to-server, where no CORS rules apply.

// Open a Drive resumable session and remember its URL so the chunk requests
// that follow can stream into it.
function startResumableUpload(requestBody) {
  const mimeType = requestBody.mimeType;
  if (!isAllowedMimeType(mimeType)) {
    return jsonResponse({ status: "error", message: "Unsupported file type." });
  }

  const fileMetadata = {
    name: buildStoredFileName(requestBody.fileName),
    parents: [uploadFolderId],
  };

  const initiationResponse = UrlFetchApp.fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable",
    {
      method: "post",
      contentType: "application/json; charset=UTF-8",
      headers: {
        Authorization: "Bearer " + ScriptApp.getOAuthToken(),
        "X-Upload-Content-Type": mimeType,
      },
      payload: JSON.stringify(fileMetadata),
      muteHttpExceptions: true,
    }
  );

  if (initiationResponse.getResponseCode() !== 200) {
    return jsonResponse({ status: "error", message: "Could not start the upload." });
  }

  const responseHeaders = initiationResponse.getHeaders();
  const resumableUploadUrl = responseHeaders.Location || responseHeaders.location;

  const uploadId = Utilities.getUuid();
  CacheService.getScriptCache().put(
    cacheKeyForUpload(uploadId),
    JSON.stringify({ sessionUrl: resumableUploadUrl, mimeType: mimeType }),
    21600
  );

  return jsonResponse({ status: "success", uploadId: uploadId });
}

// Forward one chunk to the Drive resumable session. Drive returns 308 while
// more chunks are expected and 200/201 once the final chunk completes the file.
function uploadChunk(requestBody) {
  const cache = CacheService.getScriptCache();
  const storedSession = cache.get(cacheKeyForUpload(requestBody.uploadId));
  if (!storedSession) {
    return jsonResponse({ status: "error", message: "Upload session expired." });
  }
  const session = JSON.parse(storedSession);

  const chunkBytes = Utilities.base64Decode(requestBody.data);
  const rangeStart = requestBody.start;
  const rangeEnd = rangeStart + chunkBytes.length - 1;
  const totalSize = requestBody.total;

  const chunkResponse = UrlFetchApp.fetch(session.sessionUrl, {
    method: "put",
    contentType: session.mimeType,
    headers: {
      "Content-Range": "bytes " + rangeStart + "-" + rangeEnd + "/" + totalSize,
    },
    payload: chunkBytes,
    muteHttpExceptions: true,
  });

  const responseCode = chunkResponse.getResponseCode();

  if (responseCode === 200 || responseCode === 201) {
    const uploadedFile = JSON.parse(chunkResponse.getContentText());
    const createdFile = DriveApp.getFileById(uploadedFile.id);
    createdFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    cache.remove(cacheKeyForUpload(requestBody.uploadId));
    return jsonResponse({ status: "success", done: true, fileId: uploadedFile.id });
  }

  if (responseCode === 308) {
    return jsonResponse({ status: "success", done: false });
  }

  return jsonResponse({ status: "error", message: "Chunk upload failed (" + responseCode + ")." });
}

function cacheKeyForUpload(uploadId) {
  return "resumable_" + uploadId;
}

// Fallback path for smaller files: the whole file arrives base64-encoded in the
// POST body and is written to Drive here.
function handleBase64Upload(requestBody) {
  const mimeType = requestBody.mimeType;
  if (!isAllowedMimeType(mimeType)) {
    return jsonResponse({ status: "error", message: "Unsupported file type." });
  }

  const decodedBytes = Utilities.base64Decode(requestBody.fileData);
  if (decodedBytes.length > maximumBase64FileSizeInBytes) {
    return jsonResponse({ status: "error", message: "File is too large." });
  }

  const fileBlob = Utilities.newBlob(decodedBytes, mimeType, buildStoredFileName(requestBody.fileName));
  const uploadFolder = DriveApp.getFolderById(uploadFolderId);
  const createdFile = uploadFolder.createFile(fileBlob);
  createdFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  return jsonResponse({ status: "success", fileId: createdFile.getId() });
}

function doGet() {
  try {
    const uploadFolder = DriveApp.getFolderById(uploadFolderId);
    const fileIterator = uploadFolder.getFiles();

    const galleryItems = [];
    while (fileIterator.hasNext()) {
      const file = fileIterator.next();
      const mimeType = file.getMimeType();
      if (!isAllowedMimeType(mimeType)) {
        continue;
      }
      galleryItems.push({
        id: file.getId(),
        name: file.getName(),
        mimeType: mimeType,
        createdAt: file.getDateCreated().getTime(),
      });
    }

    galleryItems.sort(function (firstItem, secondItem) {
      return secondItem.createdAt - firstItem.createdAt;
    });

    return jsonResponse({ status: "success", files: galleryItems });
  } catch (error) {
    return jsonResponse({ status: "error", message: String(error) });
  }
}

function isAllowedMimeType(mimeType) {
  if (!mimeType) {
    return false;
  }
  return mimeType.indexOf("image/") === 0 || mimeType.indexOf("video/") === 0;
}

function buildStoredFileName(originalFileName) {
  const timestamp = Utilities.formatDate(new Date(), "Europe/London", "yyyyMMdd-HHmmss");
  return timestamp + "_" + originalFileName;
}

function jsonResponse(payloadObject) {
  return ContentService
    .createTextOutput(JSON.stringify(payloadObject))
    .setMimeType(ContentService.MimeType.JSON);
}
