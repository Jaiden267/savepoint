import { Errors } from "@pinecone-database/pinecone";

const MAX_ERROR_CHARS = 200;

/**
 * Defense-in-depth scrub applied to the small, fixed set of strings this
 * module ever produces. The primary safety mechanism is allow-listed
 * classification below (never the SDK's own `.message`, which can embed
 * request URLs) — this regex pass exists only to catch anything an editor
 * might accidentally interpolate into a label in the future.
 */
function scrub(text: string): string {
  return text
    .replace(/https?:\/\/[^\s@/]+:[^\s@/]+@\S+/gi, "[redacted-url]")
    .replace(/(authorization|api-key)\s*:\s*\S+/gi, "$1: [redacted]")
    .replace(/bearer\s+[a-z0-9\-._~+/]+=*/gi, "bearer [redacted]")
    .replace(/\b[a-z0-9_-]{32,}\b/gi, "[redacted]");
}

function hasStringProperty(
  value: unknown,
  key: string,
): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    key in value &&
    typeof (value as Record<string, unknown>)[key] === "string"
  );
}

/**
 * Allow-listed error classification, not blacklist redaction: known
 * Pinecone SDK error types map to a fixed, static, human-readable label.
 * The SDK's own `.message`/`.body` are never read or stored — some of them
 * embed request URLs. Unrecognized errors fall back to one static string,
 * zero interpolated content. Always ≤200 chars after the defense-in-depth
 * scrub above. Stored in `game_vector_sync.error`.
 */
export function sanitizeErrorForStorage(error: unknown): string {
  const label = classify(error);
  return scrub(label).slice(0, MAX_ERROR_CHARS);
}

function classify(error: unknown): string {
  if (error instanceof Errors.PineconeAuthorizationError) {
    return "pinecone: unauthorized";
  }
  if (error instanceof Errors.PineconeNotFoundError) {
    return "pinecone: not found";
  }
  if (error instanceof Errors.PineconeBadRequestError) {
    return "pinecone: bad request";
  }
  if (error instanceof Errors.PineconeConflictError) {
    return "pinecone: conflict";
  }
  if (error instanceof Errors.PineconeUnprocessableEntityError) {
    return "pinecone: unprocessable request";
  }
  if (error instanceof Errors.PineconeInternalServerError) {
    return "pinecone: internal server error";
  }
  if (error instanceof Errors.PineconeUnavailableError) {
    return "pinecone: service unavailable";
  }
  if (error instanceof Errors.PineconeTimeoutError) {
    return "pinecone: timeout";
  }
  if (error instanceof Errors.PineconeMaxRetriesExceededError) {
    return "pinecone: max retries exceeded";
  }
  if (error instanceof Errors.PineconeMethodNotAllowedError) {
    return "pinecone: method not allowed";
  }
  if (error instanceof Errors.PineconeNotImplementedError) {
    return "pinecone: not available on this plan";
  }
  if (error instanceof Errors.PineconeIndexInitializationFailedError) {
    return "pinecone: index initialization failed";
  }
  if (error instanceof Errors.PineconeIndexTerminatedError) {
    return "pinecone: index terminated";
  }
  if (error instanceof Errors.PineconeUnmappedHttpError) {
    return "pinecone: unmapped http error";
  }
  if (
    error instanceof Errors.PineconeConnectionError ||
    error instanceof Errors.PineconeRequestError
  ) {
    return "pinecone: connection error";
  }
  if (error instanceof Errors.PineconeConfigurationError) {
    return "pinecone: configuration error";
  }
  if (error instanceof Errors.PineconeArgumentError) {
    return "pinecone: invalid arguments";
  }
  if (error instanceof Errors.BasePineconeError) {
    return "pinecone: unclassified error";
  }
  // A typical Supabase/PostgREST error shape — the `code` field is a short,
  // fixed-format Postgres error code (e.g. "23505"), not sensitive.
  if (hasStringProperty(error, "code")) {
    return `database error (code ${error.code})`;
  }
  return "unclassified sync error";
}
