import { z } from "zod";
import { uuidSchema } from "@/lib/validation/common";

// Validated as the very first thing toggleFollowAction does, before any
// Supabase call — same discipline as toggleReviewLikeSchema, since this is
// invoked directly with plain arguments from a client transition, not
// parsed FormData.
export const toggleFollowSchema = z.object({
  targetUserId: uuidSchema,
  nextFollowing: z.boolean(),
});
export type ToggleFollowInput = z.infer<typeof toggleFollowSchema>;
