import { HttpError } from "./httpError";

const PHONE_PATTERN = /^\+?\d[\d\s-]{5,19}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const POSTAL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 -]{1,9}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/*
 * Rejects malformed record IDs early so they never reach the database
 * lookup. Deliberately format-only (no UUID version check) so probe IDs
 * like all-zeros still produce a 404 from the lookup, not a 400.
 */
export function requiredUuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new HttpError(400, `${field} is not valid.`);
  }

  return value;
}

/*
 * Optional text fields distinguish three cases:
 *   undefined -> field was not supplied, leave it unchanged
 *   null      -> field was supplied as empty/null, clear it
 *   string    -> validated, trimmed value
 */
export function optionalString(
  value: unknown,
  field: string,
  maxLength: number
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;

  if (typeof value !== "string") {
    throw new HttpError(400, `${field} must be text.`);
  }

  const trimmed = value.trim();
  if (!trimmed) return null;

  if (trimmed.length > maxLength) {
    throw new HttpError(400, `${field} must be at most ${maxLength} characters.`);
  }

  return trimmed;
}

export function requiredString(
  value: unknown,
  field: string,
  maxLength: number
): string {
  const cleaned = optionalString(value, field, maxLength);

  if (!cleaned) {
    throw new HttpError(400, `${field} is required.`);
  }

  return cleaned;
}

export function optionalPhoneNumber(
  value: unknown,
  field: string
): string | null | undefined {
  const cleaned = optionalString(value, field, 20);

  if (cleaned && !PHONE_PATTERN.test(cleaned)) {
    throw new HttpError(400, `${field} is not a valid phone number.`);
  }

  return cleaned;
}

export function optionalEmail(
  value: unknown,
  field: string
): string | null | undefined {
  const cleaned = optionalString(value, field, 254);

  if (cleaned && !EMAIL_PATTERN.test(cleaned)) {
    throw new HttpError(400, `${field} is not a valid email address.`);
  }

  return cleaned ? cleaned.toLowerCase() : cleaned;
}

export function optionalPostalCode(
  value: unknown,
  field: string
): string | null | undefined {
  const cleaned = optionalString(value, field, 10);

  if (cleaned && !POSTAL_PATTERN.test(cleaned)) {
    throw new HttpError(400, `${field} is not a valid postal code.`);
  }

  return cleaned;
}

/*
 * Strict allowlist: any field the endpoint does not support is rejected
 * loudly instead of silently ignored, so frontend mistakes (or injection
 * attempts like customerProfileId / role) are caught immediately.
 */
export function rejectUnexpectedFields(
  body: Record<string, unknown>,
  allowedFields: readonly string[]
): void {
  const unexpectedField = Object.keys(body).find(
    (field) => !allowedFields.includes(field)
  );

  if (unexpectedField) {
    throw new HttpError(
      400,
      `The field "${unexpectedField}" is not allowed.`,
      unexpectedField
    );
  }
}

export function optionalBoolean(
  value: unknown,
  field: string
): boolean | undefined {
  if (value === undefined || value === null) return undefined;

  if (typeof value !== "boolean") {
    throw new HttpError(400, `${field} must be true or false.`);
  }

  return value;
}
