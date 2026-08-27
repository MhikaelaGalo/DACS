/*
 * Shared API client for the DACS backend (Express, /api/*).
 *
 * Every helper attaches "Authorization: Bearer <Firebase ID token>",
 * parses the backend's wrapped JSON shape and converts failures into
 * ApiError instances whose `message` is safe to show in a toast — raw
 * stack traces, Prisma/SQL details and Firebase internals never reach
 * the UI (the backend already guarantees this for its own messages).
 *
 * Backend response conventions (see back end/src/app.ts):
 *   success: { success: true, message?, data?, count?, ... }
 *   failure: { success: false, message, field? }
 */
import { getIdTokenOrNull } from "./firebase";
import { forceSignOut } from "./sessionExpiry";

const BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:5000";

export class ApiError extends Error {
  readonly status: number;
  readonly field?: string;

  constructor(status: number, message: string, field?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.field = field;
  }
}

export const SESSION_EXPIRED_MESSAGE =
  "Your session has expired. Please sign in again.";

/*
 * 400/403/404/409 messages are authored for people on the backend
 * (validation text, business rules such as "You cannot change your own
 * role.") and pass through. 401 and 5xx bodies are replaced wholesale.
 */
function friendlyMessage(status: number, serverMessage?: string): string {
  if (status === 401) return SESSION_EXPIRED_MESSAGE;
  if (status >= 500) {
    return "Something went wrong on the server. Please try again.";
  }
  if (serverMessage) return serverMessage;
  if (status === 404) return "The requested record was not found.";
  if (status === 403) {
    return "You do not have permission to perform this action.";
  }
  return "The request could not be completed. Please try again.";
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  /* JSON-serialized request body. */
  body?: unknown;
  /* Multipart body (file uploads); mutually exclusive with `body`. */
  formData?: FormData;
  /* Query parameters; undefined/null/empty-string entries are skipped. */
  query?: Record<string, string | number | boolean | null | undefined>;
  /* Set false for the few public endpoints (health, published FAQs). */
  auth?: boolean;
}

export async function apiFetch<T>(
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const url = new URL(path, BASE_URL);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }

  const headers: Record<string, string> = {};
  if (options.auth !== false) {
    const token = await getIdTokenOrNull();
    if (!token) {
      /* Firebase lost the sign-in (cleared data, revoked account). */
      forceSignOut("expired");
      throw new ApiError(401, SESSION_EXPIRED_MESSAGE);
    }
    headers.Authorization = `Bearer ${token}`;
  }

  let body: BodyInit | undefined;
  if (options.formData) {
    body = options.formData;
  } else if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? "GET",
      headers,
      body,
    });
  } catch {
    throw new ApiError(
      0,
      "Cannot reach the DACS server. Please check that the backend is running."
    );
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    /* Empty or non-JSON body; payload stays null. */
  }

  if (!response.ok) {
    /*
     * A 401 on an authenticated call means the token itself was
     * rejected (the staff session passed its absolute lifetime, or the
     * account's Firebase state was revoked) — no retry can succeed, so
     * return to sign-in rather than leaving a dead session up.
     */
    if (response.status === 401 && options.auth !== false) {
      forceSignOut("expired");
    }
    const failure = payload as { message?: unknown; field?: unknown } | null;
    throw new ApiError(
      response.status,
      friendlyMessage(
        response.status,
        typeof failure?.message === "string" ? failure.message : undefined
      ),
      typeof failure?.field === "string" ? failure.field : undefined
    );
  }

  return payload as T;
}

export const api = {
  get<T>(path: string, query?: RequestOptions["query"]): Promise<T> {
    return apiFetch<T>(path, { query });
  },
  post<T>(path: string, body?: unknown): Promise<T> {
    return apiFetch<T>(path, { method: "POST", body });
  },
  patch<T>(path: string, body?: unknown): Promise<T> {
    return apiFetch<T>(path, { method: "PATCH", body });
  },
  put<T>(path: string, body?: unknown): Promise<T> {
    return apiFetch<T>(path, { method: "PUT", body });
  },
  del<T>(path: string): Promise<T> {
    return apiFetch<T>(path, { method: "DELETE" });
  },
  upload<T>(
    path: string,
    formData: FormData,
    method: "POST" | "PUT" | "PATCH" = "POST"
  ): Promise<T> {
    return apiFetch<T>(path, { method, formData });
  },
};

/* Toast-ready message for any error thrown by the api helpers. */
export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message;
  return fallback;
}

/*
 * Binary fetch for authenticated file endpoints (DACS-issued
 * certificates). Same auth and error conventions as apiFetch, but the
 * success body comes back as a Blob instead of parsed JSON.
 */
export async function apiFetchBlob(path: string): Promise<Blob> {
  const url = new URL(path, BASE_URL);

  const token = await getIdTokenOrNull();
  if (!token) {
    forceSignOut("expired");
    throw new ApiError(401, SESSION_EXPIRED_MESSAGE);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new ApiError(
      0,
      "Cannot reach the DACS server. Please check that the backend is running."
    );
  }

  if (!response.ok) {
    if (response.status === 401) {
      forceSignOut("expired");
    }
    let serverMessage: string | undefined;
    try {
      const payload = (await response.json()) as { message?: unknown };
      if (typeof payload?.message === "string") serverMessage = payload.message;
    } catch {
      /* Binary or empty error body. */
    }
    throw new ApiError(
      response.status,
      friendlyMessage(response.status, serverMessage)
    );
  }

  return response.blob();
}
