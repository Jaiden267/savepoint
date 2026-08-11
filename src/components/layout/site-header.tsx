import Link from "next/link";
import { LinkButton } from "@/components/common/link-button";
import { SearchCommandDialog } from "@/components/search/search-command-dialog";
import { createClient } from "@/lib/supabase/server";
import { signOutAction } from "@/server/actions/auth";
import { SubmitButton } from "@/components/common/submit-button";

export async function SiteHeader() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let username: string | null = null;
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("username")
      .eq("id", user.id)
      .maybeSingle();
    username = profile?.username ?? null;
  }

  return (
    <header className="border-border/60 bg-background/80 supports-[backdrop-filter]:bg-background/60 sticky top-0 z-40 border-b backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link
          href="/"
          className="text-foreground text-base font-semibold tracking-tight"
        >
          Savepoint
        </Link>
        <nav className="flex items-center gap-2" aria-label="Primary">
          <LinkButton variant="ghost" size="sm" href="/discover">
            Discover
          </LinkButton>
          <SearchCommandDialog />
          {user && username ? (
            <>
              <LinkButton variant="ghost" size="sm" href="/library">
                Library
              </LinkButton>
              <LinkButton variant="ghost" size="sm" href="/diary">
                Diary
              </LinkButton>
              <LinkButton variant="ghost" size="sm" href={`/users/${username}`}>
                Profile
              </LinkButton>
              <LinkButton variant="ghost" size="sm" href="/settings/profile">
                Settings
              </LinkButton>
              <form action={signOutAction}>
                <SubmitButton
                  variant="secondary"
                  size="sm"
                  pendingText="Signing out…"
                >
                  Sign out
                </SubmitButton>
              </form>
            </>
          ) : (
            <>
              <LinkButton variant="ghost" size="sm" href="/login">
                Sign in
              </LinkButton>
              <LinkButton size="sm" href="/signup">
                Sign up
              </LinkButton>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
