import type { IndexModel } from "@pinecone-database/pinecone";
import { EMBED_MODEL, TEXT_FIELD } from "./constants.ts";

/**
 * Pure compatibility check against an already-described index — shared by
 * the app runtime (client.ts) and the plain-Node scripts (bootstrap/
 * backfill/smoke-test) so the comparison logic never drifts between them.
 */
export function isIndexCompatible(indexModel: IndexModel): boolean {
  const embed = indexModel.embed;
  if (!embed || embed.model !== EMBED_MODEL) return false;
  const fieldMap = embed.fieldMap as Record<string, unknown> | undefined;
  return fieldMap?.text === TEXT_FIELD;
}

/** Human-readable detail for why an existing index failed the compatibility check — never used to justify deleting/recreating it. */
export function describeIncompatibility(indexModel: IndexModel): string {
  const embed = indexModel.embed;
  if (!embed) {
    return `Index "${indexModel.name}" has no integrated embedding configured (expected model "${EMBED_MODEL}").`;
  }
  if (embed.model !== EMBED_MODEL) {
    return `Index "${indexModel.name}" uses embedding model "${embed.model}", expected "${EMBED_MODEL}".`;
  }
  const fieldMap = embed.fieldMap as Record<string, unknown> | undefined;
  return `Index "${indexModel.name}" has fieldMap.text = ${JSON.stringify(fieldMap?.text)}, expected "${TEXT_FIELD}".`;
}
