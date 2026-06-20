const uploadFolderId = "1-ErnuCRc3-m6-Ebku__DVpRCZm7IIRWn";

function doPost(e) {
  try {
    const requestBody = JSON.parse(e.postData.contents);
    const fileName = requestBody.fileName;
    const mimeType = requestBody.mimeType;
    const fileData = requestBody.fileData;

    const decodedBytes = Utilities.base64Decode(fileData);

    const storedFileName = buildStoredFileName(fileName);
    const fileBlob = Utilities.newBlob(decodedBytes, mimeType, storedFileName);

    const uploadFolder = DriveApp.getFolderById(uploadFolderId);
    const createdFile = uploadFolder.createFile(fileBlob);

    return jsonResponse({ status: "success", fileId: createdFile.getId() });
  } catch (error) {
    return jsonResponse({ status: "error", message: String(error) });
  }
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
