import { z } from "zod";

/**
 * Client-safe environment (the only variables allowed to reach the browser).
 *
 * These are referenced as static `process.env.NEXT_PUBLIC_*` members so Next.js
 * can inline them at build time. This module must never import server-only code
 * so it is safe to use from both Server and Client Components.
 *
 * On failure we report only the variable NAMES that are missing/invalid — never
 * their values.
 */
const clientSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  // Optional. Public contact address for privacy requests, shown on
  // /privacy. Left unset until a real, monitored mailbox exists — never
  // defaulted to a guessed or unmonitored address. Blank string (the
  // .env.example placeholder shape) is treated the same as unset.
  NEXT_PUBLIC_PRIVACY_CONTACT_EMAIL: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value : undefined)),
});

const parsed = clientSchema.safeParse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_PRIVACY_CONTACT_EMAIL:
    process.env.NEXT_PUBLIC_PRIVACY_CONTACT_EMAIL,
});

if (!parsed.success) {
  const names = parsed.error.issues
    .map((issue) => issue.path.join("."))
    .join(", ");
  throw new Error(
    `Invalid or missing client environment variable(s): ${names}. ` +
      `Check your .env.local against .env.example.`,
  );
}

export const clientEnv = parsed.data;
