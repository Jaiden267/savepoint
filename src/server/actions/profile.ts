"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/require-user";
import { profileFormSchema, avatarFileSchema } from "@/lib/validation/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import type { ActionState } from "@/lib/action-state";

function friendlyProfileError(message: string): string {
  const lower = message.toLowerCase();
  if (
    lower.includes("duplicate") ||
    lower.includes("already exists") ||
    lower.includes("unique")
  ) {
    return "That username is already taken.";
  }
  return "Something went wrong saving your profile. Please try again.";
}

function parseProfileForm(formData: FormData) {
  return profileFormSchema.safeParse({
    username: formData.get("username"),
    displayName: formData.get("displayName"),
    bio: formData.get("bio"),
  });
}

/** First-time profile completion — sets onboarding_completed_at. */
export async function completeOnboardingAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const parsed = parseProfileForm(formData);
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      username: parsed.data.username,
      display_name: parsed.data.displayName,
      bio: parsed.data.bio,
      onboarding_completed_at: new Date().toISOString(),
    })
    .eq("id", user.id);

  if (error) {
    return { status: "error", message: friendlyProfileError(error.message) };
  }

  redirect(`/users/${parsed.data.username}`);
}

/** Later edits from /settings/profile — same fields, no onboarding stamp. */
export async function updateProfileAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const parsed = parseProfileForm(formData);
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      username: parsed.data.username,
      display_name: parsed.data.displayName,
      bio: parsed.data.bio,
    })
    .eq("id", user.id);

  if (error) {
    return { status: "error", message: friendlyProfileError(error.message) };
  }

  revalidatePath(`/users/${parsed.data.username}`);
  revalidatePath("/settings/profile");
  return { status: "success", message: "Profile updated." };
}

function avatarExtensionFromMime(mime: string): string {
  switch (mime) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    default:
      return "bin";
  }
}

/**
 * Deletes every existing object under the user's avatar folder, regardless
 * of extension. Scoped to the caller's own session (not the admin client),
 * so `avatars` storage RLS policies enforce that a user can only ever touch
 * objects under their own `<uid>/` prefix.
 */
async function clearExistingAvatarObjects(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<{ error: string | null }> {
  const { data: existing, error: listError } = await supabase.storage
    .from("avatars")
    .list(userId);
  if (listError) {
    return { error: listError.message };
  }
  if (!existing || existing.length === 0) {
    return { error: null };
  }

  const { error: removeError } = await supabase.storage
    .from("avatars")
    .remove(existing.map((object) => `${userId}/${object.name}`));
  return { error: removeError?.message ?? null };
}

export async function uploadAvatarAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const rate = checkRateLimit(`avatar-upload:${user.id}`, {
    limit: 10,
    windowSeconds: 10 * 60,
  });
  if (!rate.allowed) {
    return {
      status: "error",
      message: "Too many uploads. Please wait a bit and try again.",
    };
  }

  const parsed = avatarFileSchema.safeParse(formData.get("avatar"));
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "That image can't be used.",
    };
  }

  // Remove any existing avatar first, regardless of its extension, so
  // replacing with a different image type never leaves an orphaned old
  // file behind (upsert alone only overwrites an exact same-path match).
  await clearExistingAvatarObjects(supabase, user.id);

  const path = `${user.id}/avatar.${avatarExtensionFromMime(parsed.data.type)}`;
  const { error: uploadError } = await supabase.storage
    .from("avatars")
    .upload(path, parsed.data, { contentType: parsed.data.type, upsert: true });
  if (uploadError) {
    return {
      status: "error",
      message: "Couldn't upload that image. Please try again.",
    };
  }

  const { error: updateError } = await supabase
    .from("profiles")
    .update({ avatar_path: path })
    .eq("id", user.id);
  if (updateError) {
    return {
      status: "error",
      message:
        "Image uploaded, but saving your profile failed. Please try again.",
    };
  }

  revalidatePath("/settings/profile");
  return { status: "success", message: "Avatar updated." };
}

// Both parameters are structurally required by useActionState's action
// signature (see AvatarUploader's "Remove" form) even though this action
// needs neither — there's no form data for a removal.
/* eslint-disable @typescript-eslint/no-unused-vars */
export async function removeAvatarAction(
  _prevState: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  /* eslint-enable @typescript-eslint/no-unused-vars */
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const { error: storageError } = await clearExistingAvatarObjects(
    supabase,
    user.id,
  );
  if (storageError) {
    return {
      status: "error",
      message: "Couldn't remove your avatar. Please try again.",
    };
  }

  const { error } = await supabase
    .from("profiles")
    .update({ avatar_path: null })
    .eq("id", user.id);
  if (error) {
    return {
      status: "error",
      message: "Couldn't remove your avatar. Please try again.",
    };
  }

  revalidatePath("/settings/profile");
  return { status: "success", message: "Avatar removed." };
}
