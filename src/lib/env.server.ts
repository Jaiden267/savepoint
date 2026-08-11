import "server-only";
import { z } from "zod";
import { clientEnv } from "@/lib/env";

/**
 * Server-only environment. Guarded by `server-only` so any accidental import
 * from a Client Component fails the build instead of leaking secrets.
 *
 * Only variable NAMES are ever surfaced on validation failure — never values,
 * and values are never logged anywhere.
 */
const serverSchema = z.object({
  SUPABASE_SECRET_KEY: z.string().min(1),
  IGDB_CLIENT_ID: z.string().min(1),
  IGDB_CLIENT_SECRET: z.string().min(1),
  PINECONE_API_KEY: z.string().min(1),
  PINECONE_INDEX_NAME: z.string().min(1).default("savepoint-games"),
  // Optional: comma-separated Supabase user IDs granted admin tooling access.
  ADMIN_USER_IDS: z.string().optional().default(""),
  // Optional: added later to guard the cron refresh endpoint.
  CRON_SECRET: z.string().min(1).optional(),
});

const parsed = serverSchema.safeParse(process.env);

if (!parsed.success) {
  const names = parsed.error.issues
    .map((issue) => issue.path.join("."))
    .join(", ");
  throw new Error(
    `Invalid or missing server environment variable(s): ${names}.`,
  );
}

export const serverEnv = parsed.data;

/** Parsed admin user IDs, empty when ADMIN_USER_IDS is unset. */
export const adminUserIds = serverEnv.ADMIN_USER_IDS.split(",")
  .map((id) => id.trim())
  .filter(Boolean);

// Re-exported for convenience so server modules have a single env import.
export { clientEnv };
