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
});

const parsed = clientSchema.safeParse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
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
