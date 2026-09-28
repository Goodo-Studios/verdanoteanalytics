import { fileURLToPath } from "node:url";

export const REQUIRED_E2E_VARIABLES = [
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "PLAYWRIGHT_TEST_EMAIL",
  "PLAYWRIGHT_TEST_PASSWORD",
  "PLAYWRIGHT_CLIENT_EMAIL",
  "PLAYWRIGHT_CLIENT_PASSWORD",
];

export function missingE2eVariables(env) {
  return REQUIRED_E2E_VARIABLES.filter((name) => !env[name]?.trim());
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const missing = missingE2eVariables(process.env);
  if (missing.length > 0) {
    console.error(`Missing required E2E environment variables: ${missing.join(", ")}`);
    process.exitCode = 1;
  }
}
