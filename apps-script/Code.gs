const uploadFolderId = "1-ErnuCRc3-m6-Ebku__DVpRCZm7IIRWn";

// Reject anything that is not a photo or video, and anything larger than the
// Apps Script POST ceiling, so a stranger who finds the URL cannot dump
// arbitrary files into the folder.
const maximumFileSizeInBytes = 50 * 1024 * 1024;

function doPost(e) {
  try {
    const requestBody = JSON.parse(e.postData.contents);
    const fileName = requestBody.fileName;
    const mimeType = requestBody.mimeType;
    const fileData = requestBody.fileData;

    if (!isAllowedMimeType(mimeType)) {
      return jsonResponse({ status: "error", message: "Unsupported file type." });
    }

    const decodedBytes = Utilities.base64Decode(fileData);

    if (decodedBytes.length > maximumFileSizeInBytes) {
      return jsonResponse({ status: "error", message: "File is too large." });
    }

    const storedFileName = buildStoredFileName(fileName);
    const fileBlob = Utilities.newBlob(decodedBytes, mimeType, storedFileName);

    const uploadFolder = DriveApp.getFolderById(uploadFolderId);
    const createdFile = uploadFolder.createFile(fileBlob);

    // Make the file viewable by anyone with the link so its thumbnail renders
    // in the shared gallery. The folder itself stays private and the file IDs
    // are long and unguessable.
    createdFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    return jsonResponse({ status: "success", fileId: createdFile.getId() });
  } catch (error) {
    return jsonResponse({ status: "error", message: String(error) });
  }
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
