import "server-only";
import { redirect } from "next/navigation";
import type { createClient } from "@/lib/supabase/server";

type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Defensive re-check for Server Actions behind pages the proxy route policy
 * already gates (e.g. /settings/profile, /onboarding). A Server Action must
 * never trust that it was only ever invoked from the "correct" UI path.
 */
export async function requireUser(supabase: ServerSupabaseClient) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return user;
}
