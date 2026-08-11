"use client";

import { useOptimistic, useTransition } from "react";
import { UserPlus, UserCheck } from "lucide-react";
import { toggleFollowAction } from "@/server/actions/follows";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface FollowButtonProps {
  targetUserId: string;
  targetUsername: string;
  initialFollowing: boolean;
  className?: string;
}

/** Template: review-card.tsx's like button — useOptimistic + useTransition, rollback on error. */
export function FollowButton({
  targetUserId,
  targetUsername,
  initialFollowing,
  className,
}: FollowButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [optimisticFollowing, setOptimisticFollowing] =
    useOptimistic(initialFollowing);

  function handleToggle() {
    const nextFollowing = !optimisticFollowing;
    startTransition(async () => {
      setOptimisticFollowing(nextFollowing);
      const result = await toggleFollowAction(
        targetUserId,
        nextFollowing,
        targetUsername,
      );
      if (result.status === "error") {
        setOptimisticFollowing(initialFollowing);
      }
    });
  }

  return (
    <Button
      type="button"
      variant={optimisticFollowing ? "secondary" : "default"}
      disabled={isPending}
      aria-pressed={optimisticFollowing}
      onClick={handleToggle}
      className={cn(className)}
    >
      {optimisticFollowing ? (
        <>
          <UserCheck aria-hidden="true" />
          Following
        </>
      ) : (
        <>
          <UserPlus aria-hidden="true" />
          Follow
        </>
      )}
    </Button>
  );
}
