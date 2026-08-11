import { ListX } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { LinkButton } from "@/components/common/link-button";

export default function ListNotFound() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-20">
      <EmptyState
        icon={ListX}
        title="List not found"
        description="This list doesn't exist, is private, or may have been removed."
        action={
          <LinkButton href="/discover/community">
            Browse popular lists
          </LinkButton>
        }
      />
    </main>
  );
}
