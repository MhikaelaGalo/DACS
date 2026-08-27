import type { NextFunction, Request, Response } from "express";
import multer from "multer";

const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_PROOF_SIZE_BYTES = 8 * 1024 * 1024; // 8 MB (receipts can be PDFs)

function singleFileUploader(
  fieldName: string,
  maxSizeBytes: number,
  sizeMessage: string
) {
  const handler = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxSizeBytes, files: 1 },
  }).single(fieldName);

  return (request: Request, response: Response, next: NextFunction): void => {
    handler(request, response, (error: unknown) => {
      if (!error) {
        next();
        return;
      }

      if (error instanceof multer.MulterError) {
        if (error.code === "LIMIT_FILE_SIZE") {
          response.status(400).json({
            success: false,
            message: sizeMessage,
          });
          return;
        }

        response.status(400).json({
          success: false,
          message: `Upload failed: ${error.message}`,
        });
        return;
      }

      next(error);
    });
  };
}

/*
 * Accepts a single uploaded file from the given multipart field and
 * translates multer's errors into DACS-style JSON responses.
 */
export function uploadSingleImage(fieldName: string) {
  return singleFileUploader(
    fieldName,
    MAX_IMAGE_SIZE_BYTES,
    "The image must not exceed 5 MB."
  );
}

export function uploadSinglePaymentProof(fieldName: string) {
  return singleFileUploader(
    fieldName,
    MAX_PROOF_SIZE_BYTES,
    "The payment proof must not exceed 8 MB."
  );
}

const MAX_SPREADSHEET_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB

export function uploadSingleSpreadsheet(fieldName: string) {
  return singleFileUploader(
    fieldName,
    MAX_SPREADSHEET_SIZE_BYTES,
    "The spreadsheet must not exceed 25 MB."
  );
}

/*
 * Seminar video uploads. Kept deliberately modest for the local-disk
 * storage setup — the buffer passes through memory once before being
 * written to uploads/seminar-videos.
 */
const MAX_VIDEO_SIZE_BYTES = 100 * 1024 * 1024;

export function uploadSingleVideo(fieldName: string) {
  return singleFileUploader(
    fieldName,
    MAX_VIDEO_SIZE_BYTES,
    "The video must not exceed 100 MB."
  );
}
