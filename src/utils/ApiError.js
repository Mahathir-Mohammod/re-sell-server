export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
    // drop this constructor from the stack trace
    Error.captureStackTrace?.(this, ApiError);
  }
}