// Reports only SET / MISSING for each contract variable. It NEVER prints,
// logs, or otherwise exposes any value. Run with: npm run check-env
// (Node 24 runs this TypeScript file directly via type stripping.)

try {
  // Load .env.local when present so this works outside the app runtime.
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local — fall back to the ambient environment.
}

const required = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
  "IGDB_CLIENT_ID",
  "IGDB_CLIENT_SECRET",
  "PINECONE_API_KEY",
] as const;

const optional = [
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_PRIVACY_CONTACT_EMAIL",
  "PINECONE_INDEX_NAME",
  "ADMIN_USER_IDS",
  "CRON_SECRET",
] as const;

function getState(name: string): "SET" | "MISSING" {
  const value = process.env[name];
  return typeof value === "string" && value.length > 0 ? "SET" : "MISSING";
}

let missingRequired = 0;

console.log("Required service variables:");
for (const name of required) {
  const state = getState(name);
  if (state === "MISSING") missingRequired++;
  console.log(`  ${name}: ${state}`);
}

console.log("\nOptional variables:");
for (const name of optional) {
  console.log(`  ${name}: ${getState(name)}`);
}

if (missingRequired > 0) {
  console.error(`\n${missingRequired} required variable(s) MISSING.`);
  process.exit(1);
}

console.log("\nAll required variables are SET.");
