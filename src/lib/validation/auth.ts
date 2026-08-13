import { z } from "zod";

/**
 * Shared client+server validation for auth/profile forms. Every constraint
 * here must match its corresponding database CHECK constraint exactly (see
 * supabase/migrations/20260811120500_create_profiles.sql and
 * 20260812090000_add_onboarding_completed_to_profiles.sql) — this is the
 * application-level mirror of those constraints, not a separate source of
 * truth.
 */

// username: matches profiles_username_format exactly
// (`^[a-zA-Z0-9_]{3,30}$`). Case-insensitive uniqueness is a citext column,
// not something this regex needs to handle.
export const usernameSchema = z
  .string()
  .trim()
  .regex(
    /^[a-zA-Z0-9_]{3,30}$/,
    "Usernames are 3-30 characters: letters, numbers, and underscores only.",
  );

// Supabase Auth's own minimum is configurable (dashboard default: 6) — this
// project uses a stricter 8, and the Auth dashboard's "Minimum password
// length" should be set to match (see docs/AUTH.md). 72 is bcrypt's
// practical limit, used by Supabase Auth under the hood.
export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters.")
  .max(72, "Password must be at most 72 characters.");

export const emailSchema = z.email("Enter a valid email address.");

function emptyStringToNull(val: unknown) {
  return typeof val === "string" && val.trim() === "" ? null : val;
}

// display_name / bio: nullable text columns. Forms submit "" for an empty
// field (not absent), so both "" and null normalize to null here.
export const displayNameSchema = z.preprocess(
  emptyStringToNull,
  z
    .string()
    .trim()
    .max(80, "Display name must be 80 characters or fewer.")
    .nullable(),
);

export const bioSchema = z.preprocess(
  emptyStringToNull,
  z.string().trim().max(500, "Bio must be 500 characters or fewer.").nullable(),
);

export const signUpSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });
export type SignUpInput = z.infer<typeof signUpSchema>;

export const signInSchema = z.object({
  email: emailSchema,
  // Deliberately not re-validated against passwordSchema's length rules —
  // an existing account's password may predate a policy change. Supabase
  // Auth itself is the source of truth for whether it's actually correct.
  password: z.string().min(1, "Password is required."),
});
export type SignInInput = z.infer<typeof signInSchema>;

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resendConfirmationSchema = z.object({
  email: emailSchema,
});
export type ResendConfirmationInput = z.infer<typeof resendConfirmationSchema>;

export const resetPasswordSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

// Shared by both /onboarding (first completion) and /settings/profile
// (later edits) — same fields, same rules.
export const profileFormSchema = z.object({
  username: usernameSchema,
  displayName: displayNameSchema,
  bio: bioSchema,
});
export type ProfileFormInput = z.infer<typeof profileFormSchema>;

// Mirrors the avatars storage bucket's own limits exactly (see
// supabase/migrations/20260811131000_storage_avatars_bucket.sql:
// file_size_limit = 5242880, allowed_mime_types = png/jpeg/webp). Enforced
// here for immediate client-side feedback AND re-checked server-side before
// every upload — never trust the client-side check alone.
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
export const AVATAR_ALLOWED_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

export const avatarFileSchema = z
  .instanceof(File)
  .refine((file) => file.size > 0, "Choose an image to upload.")
  .refine(
    (file) => file.size <= AVATAR_MAX_BYTES,
    "Image must be 5MB or smaller.",
  )
  .refine(
    (file) =>
      (AVATAR_ALLOWED_MIME_TYPES as readonly string[]).includes(file.type),
    "Image must be PNG, JPEG, or WebP.",
  );
