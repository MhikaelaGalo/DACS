/*
 * The DACS Certificate of Attendance, rendered for staff View/Download.
 *
 * DACS generates one certificate per account automatically when Seminar
 * Modules 1-3 are complete; the backend stores the record (name, SEM
 * number, issue date) rather than a file, and every client paints those
 * details onto the shared template. This is a port of the customer
 * site's src/services/certificate.service.ts — same template image
 * (public/certificate-template.jpg is byte-identical to the website's
 * public/images/certificate.jpg), same placeholder geometry, same JPEG
 * encoding — so what staff open here is the certificate the farmer sees
 * and downloads, not a second design.
 *
 * Placeholder geometry inside the template, as % of the image box:
 * "Name" band 26.3-29.3%, "ID# 2510-01" 32.3-33.8%, the date line
 * 56.6-59.1%. Each patch covers exactly its band, leaving the engraved
 * "is awarded to", the CZ logo box and the signature untouched.
 */

export const CERTIFICATE_TEMPLATE_URL = "/certificate-template.jpg";

const OVERLAYS = {
  name: { top: 25, left: 25, width: 50, height: 5 },
  id: { top: 31.8, left: 30, width: 40, height: 2.6 },
  date: { top: 56, left: 25, width: 50, height: 3.5 },
} as const;

export interface CertificateDetails {
  /* Recipient, exactly as the customer profile spells it. */
  recipientName: string;
  /* SEM-YYYY-NNNNNN. */
  certificateNumber: string;
  /* Already formatted for display, e.g. "August 27, 2026". */
  issuedAtLabel: string;
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error("The certificate design could not be loaded."));
    image.src = source;
  });
}

/** Renders the certificate (template + this customer's details). */
export async function buildCertificateBlob(
  details: CertificateDetails
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

  patch(OVERLAYS.name, details.recipientName, 3.6, false);
  patch(OVERLAYS.id, `ID# ${details.certificateNumber}`, 1.7, false);
  patch(OVERLAYS.date, `on ${details.issuedAtLabel}`, 2.2, true);

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

/*
 * Opens a blob in a new tab (View) or writes it to disk (Download).
 * The anchor is attached to the document before it is clicked: both
 * callers run after an await, so a detached anchor would be dropped
 * silently by the browser and the button would appear to do nothing.
 */
export function presentBlob(
  blob: Blob,
  fileName: string,
  download: boolean
): void {
  const url = URL.createObjectURL(blob);
  if (download) {
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.rel = "noopener";
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
  } else {
    window.open(url, "_blank", "noopener");
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/*
 * Matches the customer site's formatDate (en-US, long month, parsed
 * from the full ISO instant) so the date painted on the certificate is
 * character-identical in both apps.
 */
export function certificateDateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
