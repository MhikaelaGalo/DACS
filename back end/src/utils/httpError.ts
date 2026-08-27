export class HttpError extends Error {
  readonly statusCode: number;
  readonly field?: string;

  constructor(statusCode: number, message: string, field?: string) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
    this.field = field;
  }
}
