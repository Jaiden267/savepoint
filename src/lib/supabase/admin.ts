import "server-only";
import { createClient } from "@supabase/supabase-js";
import { clientEnv } from "@/lib/env";
import { serverEnv } from "@/lib/env.server";
import type { Database } from "@/types/database";

/**
 * ADMIN Supabase client — uses SUPABASE_SECRET_KEY and therefore BYPASSES Row
 * Level Security.
 *
 * Use ONLY in explicit server-only administrative modules (e.g. IGDB game-sync,
 * cron refresh, moderation tooling). NEVER use this for normal user CRUD —
 * user actions must run through the user's session + RLS (see server.ts /
 * client.ts). Keep its usage narrow and auditable.
 */
export function createAdminClient() {
  return createClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    serverEnv.SUPABASE_SECRET_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );
}
