import "server-only";
import { createClient } from "@/lib/supabase/server";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Public URL for a profile's avatar, or null if none is set. Hoisted out of
 * game-social.ts/reviews.ts (where it was duplicated verbatim) once Prompt 5
 * added more call sites (activity feed, discovery, follow lists) that need
 * the same thing.
 */
export function avatarUrl(
  supabase: SupabaseClient,
  avatarPath: string | null,
): string | null {
  if (!avatarPath) return null;
  return supabase.storage.from("avatars").getPublicUrl(avatarPath).data
    .publicUrl;
}
