import { SearchX } from "lucide-react";
import { LinkButton } from "@/components/common/link-button";
import { EmptyState } from "@/components/common/empty-state";

export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-24">
      <EmptyState
        icon={SearchX}
        title="Page not found"
        description="The page you're looking for doesn't exist or has moved."
        action={<LinkButton href="/">Back home</LinkButton>}
      />
    </main>
  );
}
