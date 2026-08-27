/*
 * DACS certificates follow the real backend workflow: ONE Certificate
 * of Attendance per account, auto-approved with an SEM-YYYY-NNNNNN
 * number after completing Seminar Modules 1-3, then physically ISSUED
 * by DACS staff (file upload + explicit issue) which starts its 2-year
 * validity. This service adapts GET /api/seminars/certificates/me into
 * the two display shapes the account pages render:
 *
 *   - fetchApprovedCertificates — every APPROVED request (the seminar
 *     completion pages link their composite certificate view from it).
 *   - fetchIssuedCertificates — only certificates staff have officially
 *     issued with a real downloadable file; these are what the DACS
 *     Certificates section on /account lists.
 */
import {
  fetchMyCertificateFile,
  listMyCertificateRequests,
  type ApiCertificateRequest,
} from "@/lib/api/seminars";
import type {
  DacsCertificateView,
  IssuedDacsCertificateView,
} from "@/types/certificate";

const CERTIFICATE_TITLE = "DACS Seminar Certificate of Attendance";

export async function fetchApprovedCertificates(): Promise<
  DacsCertificateView[]
> {
  const requests = await listMyCertificateRequests();
  return requests
    .filter(
      (request) =>
        request.status === "APPROVED" && request.certificateNumber !== null
    )
    .map((request) => ({
      id: request.id,
      title: CERTIFICATE_TITLE,
      certificateNumber: request.certificateNumber as string,
      issuedAt: request.certificateIssuedAt ?? request.requestedAt,
    }));
}

export async function fetchApprovedCertificateById(
  id: string
): Promise<DacsCertificateView | undefined> {
  const certificates = await fetchApprovedCertificates();
  return certificates.find((certificate) => certificate.id === id);
}

function toIssuedView(
  request: ApiCertificateRequest
): IssuedDacsCertificateView {
  return {
    id: request.id,
    title: CERTIFICATE_TITLE,
    certificateNumber: request.certificateNumber ?? "",
    issuedAt: request.issuedAt as string,
    validUntil: request.validUntil as string,
    fileName: request.certificateFileName,
    mimeType: request.certificateFileMimeType,
  };
}

/*
 * Certificates that exist as real staff-issued files. An uploaded-but-
 * not-issued file never appears here — issuance is the moment the
 * certificate reaches the account.
 */
export async function fetchIssuedCertificates(): Promise<
  IssuedDacsCertificateView[]
> {
  const requests = await listMyCertificateRequests();
  return requests
    .filter(
      (request) =>
        request.status === "APPROVED" &&
        request.issuedAt !== null &&
        request.validUntil !== null &&
        request.hasCertificateFile
    )
    .map(toIssuedView);
}

export async function fetchIssuedCertificateById(
  id: string
): Promise<IssuedDacsCertificateView | undefined> {
  const certificates = await fetchIssuedCertificates();
  return certificates.find((certificate) => certificate.id === id);
}

/*
 * Derived at render time from validUntil (never stored): valid strictly
 * before the expiry instant, expired on/after it — so a certificate
 * flips to Expired automatically with no staff action.
 */
export function certificateValidityLabel(
  validUntil: string
): "Valid" | "Expired" {
  return Date.now() < Date.parse(validUntil) ? "Valid" : "Expired";
}

/* Fetches the real issued file (ownership enforced by the backend). */
export async function fetchIssuedCertificateBlob(
  certificate: IssuedDacsCertificateView
): Promise<Blob> {
  return fetchMyCertificateFile(certificate.id);
}

/*
 * The one way this app writes a file to the device.
 *
 * Both certificate downloads run after an await (the authenticated file
 * fetch, or the canvas render), so the click that starts them is no
 * longer the user's own gesture. A detached <a> clicked in that state is
 * dropped without a word — which is why the Download button used to do
 * nothing at all. Anchored in the document, with an object URL rather
 * than a multi-hundred-KB data: URL, the save actually happens.
 */
function saveBlobToDevice(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/* Saves the actual staff-uploaded certificate file to the device. */
export async function downloadIssuedCertificate(
  certificate: IssuedDacsCertificateView
): Promise<void> {
  const blob = await fetchIssuedCertificateBlob(certificate);
  saveBlobToDevice(
    blob,
    certificate.fileName ??
      `dacs-certificate-${certificate.certificateNumber || certificate.id}.pdf`
  );
}

/*
 * ---------- Composite certificate (approved, not yet staff-issued) -------
 *
 * The template image carries baked-in placeholders; the account's real
 * details are painted over them at the same percentages the on-screen
 * certificate uses, so the saved file is the certificate the farmer is
 * looking at — same name, same SEM number, same issue date, same design.
 *
 * Placeholder geometry inside certificate.jpg, as % of the image box
 * (pixel-measured): "Name" band 26.3-29.3%, "ID# 2510-01" 32.3-33.8%,
 * the date line 56.6-59.1%. Each patch covers exactly its band — the
 * engraved "is awarded to" (21.2-23.2%), the CZ logo box (top border
 * 60.1%) and the signature (from 61.6%) stay untouched.
 */
export const CERTIFICATE_TEMPLATE_URL = "/images/certificate.jpg";

const OVERLAYS = {
  name: { top: 25, left: 25, width: 50, height: 5 },
  id: { top: 31.8, left: 30, width: 40, height: 2.6 },
  date: { top: 56, left: 25, width: 50, height: 3.5 },
} as const;

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error("The certificate design could not be loaded."));
    image.src = source;
  });
}

/** Renders the earned certificate (template + this account's details). */
export async function buildCompositeCertificateBlob(
  certificate: DacsCertificateView,
  recipientName: string,
  issuedAtLabel: string
): Promise<Blob> {
  const image = await loadImage(CERTIFICATE_TEMPLATE_URL);

  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("The certificate could not be rendered.");
  ctx.drawImage(image, 0, 0);

  const { width: w, height: h } = canvas;
  const patch = (
    box: { top: number; left: number; width: number; height: number },
    text: string,
    fontHeightPct: number,
    italic: boolean
  ) => {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(
      (w * box.left) / 100,
      (h * box.top) / 100,
      (w * box.width) / 100,
      (h * box.height) / 100
    );
    ctx.fillStyle = "#000000";
    ctx.font = `${italic ? "italic " : ""}${Math.round((h * fontHeightPct) / 100)}px Georgia, serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, w / 2, (h * (box.top + box.height / 2)) / 100);
  };

  patch(OVERLAYS.name, recipientName, 3.6, false);
  patch(OVERLAYS.id, `ID# ${certificate.certificateNumber}`, 1.7, false);
  patch(OVERLAYS.date, `on ${issuedAtLabel}`, 2.2, true);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error("The certificate file could not be created.")),
      "image/jpeg",
      0.92
    );
  });
}

/* Saves the personalized composite — the raw template still carries the
   baked placeholders, so only this rendered copy is worth downloading. */
export async function downloadCompositeCertificate(
  certificate: DacsCertificateView,
  recipientName: string,
  issuedAtLabel: string
): Promise<void> {
  const blob = await buildCompositeCertificateBlob(
    certificate,
    recipientName,
    issuedAtLabel
  );
  saveBlobToDevice(
    blob,
    `dacs-certificate-${certificate.certificateNumber}.jpg`
  );
}

/*
 * Downloads THIS account's certificate by its backend id, picking the
 * same source the viewer shows: the staff-issued file when one exists,
 * otherwise the composite of the approved record. Ownership is enforced
 * server-side — the lookups only ever see the caller's own requests, so
 * another account's id simply resolves to nothing.
 */
export async function downloadCertificateById(
  certificateId: string,
  recipientName: string,
  formatIssuedAt: (isoDate: string) => string
): Promise<void> {
  const issued = await fetchIssuedCertificateById(certificateId);
  if (issued) {
    await downloadIssuedCertificate(issued);
    return;
  }

  const approved = await fetchApprovedCertificateById(certificateId);
  if (!approved) {
    throw new Error("This certificate is not available for your account.");
  }

  await downloadCompositeCertificate(
    approved,
    recipientName,
    formatIssuedAt(approved.issuedAt)
  );
}
