import {
  readUserStorage,
  USER_STORAGE_KEYS,
  writeUserStorage,
} from "@/lib/storage/local-storage";

/**
 * Safe metadata for a certification document uploaded on the Personal
 * Information page. Only metadata is persisted in the mock frontend — raw
 * files are never written to localStorage.
 * TODO: Upload certification document to DACS backend storage
 */
export interface CertificationDocumentMeta {
  id: string;
  name: string;
  type: string;
  size: number;
  uploadedAt: string;
}

// Stored per authenticated user, so one account's uploads never list on
// another account's Personal Information page.
const CERTIFICATION_DOCS_KEY = USER_STORAGE_KEYS.certificationDocuments;

export function getCertificationDocuments(): CertificationDocumentMeta[] {
  return readUserStorage<CertificationDocumentMeta[]>(
    CERTIFICATION_DOCS_KEY,
    []
  );
}

export function saveCertificationDocuments(
  documents: CertificationDocumentMeta[]
): void {
  writeUserStorage(CERTIFICATION_DOCS_KEY, documents);
}
