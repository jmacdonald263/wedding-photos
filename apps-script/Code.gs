const uploadFolderId = "1-ErnuCRc3-m6-Ebku__DVpRCZm7IIRWn";

function doPost(e) {
  try {
    const requestBody = JSON.parse(e.postData.contents);
    const fileName = requestBody.fileName;
    const mimeType = requestBody.mimeType;
    const fileData = requestBody.fileData;
    const uploaderName = requestBody.uploaderName;

    const decodedBytes = Utilities.base64Decode(fileData);

    const storedFileName = buildStoredFileName(uploaderName, fileName);
    const fileBlob = Utilities.newBlob(decodedBytes, mimeType, storedFileName);

    const uploadFolder = DriveApp.getFolderById(uploadFolderId);
    const createdFile = uploadFolder.createFile(fileBlob);

    return jsonResponse({ status: "success", fileId: createdFile.getId() });
  } catch (error) {
    return jsonResponse({ status: "error", message: String(error) });
  }
}

function buildStoredFileName(uploaderName, originalFileName) {
  const sanitisedUploaderName = sanitiseToSafeToken(uploaderName);
  const timestamp = Utilities.formatDate(new Date(), "Europe/London", "yyyyMMdd-HHmmss");
  return sanitisedUploaderName + "_" + timestamp + "_" + originalFileName;
}

function sanitiseToSafeToken(rawName) {
  if (!rawName) {
    return "guest";
  }
  const safeToken = rawName.trim().replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return safeToken.length > 0 ? safeToken : "guest";
}

function jsonResponse(payloadObject) {
  return ContentService
    .createTextOutput(JSON.stringify(payloadObject))
    .setMimeType(ContentService.MimeType.JSON);
}
