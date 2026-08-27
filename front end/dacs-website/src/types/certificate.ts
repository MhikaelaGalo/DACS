/**
 * An APPROVED DACS Certificate of Attendance (from the backend's
 * certificate-request workflow), shaped for the account pages. The
 * rendered certificate composites the recipient's name, the certificate
 * number and the issue date onto the template image client-side — the
 * data itself is the staff-approved backend record.
 */
export interface DacsCertificateView {
  /** Backend certificate-request id (used in /account/certificates/[id]). */
  id: string;
  title: string;
  /** SEM-YYYY-NNNNNN, assigned by DACS staff on approval. */
  certificateNumber: string;
  issuedAt: string;
}

/**
 * A certificate staff have officially ISSUED: the physical file from
 * Dominant Asia Poultry Genetics, uploaded by staff and explicitly
 * issued to this account. Only these appear in the account's DACS
 * Certificates section, and only these are downloadable. Validity runs
 * exactly 2 years from issuedAt (validUntil comes from the backend);
 * expired certificates stay listed as history.
 */
export interface IssuedDacsCertificateView {
  /** Backend certificate-request id (ownership enforced server-side). */
  id: string;
  title: string;
  certificateNumber: string;
  /** Official issuance date — the start of the 2-year validity window. */
  issuedAt: string;
  validUntil: string;
  fileName: string | null;
  mimeType: string | null;
}
