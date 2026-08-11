import { UserX } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { LinkButton } from "@/components/common/link-button";

export default function UserNotFound() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-20">
      <EmptyState
        icon={UserX}
        title="User not found"
        description="This profile doesn't exist or may have been removed."
        action={
          <LinkButton href="/discover/community">
            Find people to follow
          </LinkButton>
        }
      />
    </main>
  );
}
