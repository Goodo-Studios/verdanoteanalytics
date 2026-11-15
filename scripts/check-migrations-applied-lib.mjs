// Compares the migration files in supabase/migrations with the versions recorded in a database's
// supabase_migrations.schema_migrations table. Production migrations are applied by hand
// (`supabase db push`), so a merge to main can leave files that production never received.
//
// Pure functions only; scripts/check-migrations-applied.mjs does the file and network work.

// The version of a migration file is the digits before the first underscore, the same rule the
// Supabase CLI uses to fill schema_migrations.version.
export function migrationVersion(fileName) {
  const match = /^(\d+)_.*\.sql$/.exec(fileName);
  return match ? match[1] : null;
}

// Lines of an ignore file: one version per line, anything after # is a comment.
export function parseIgnoreList(text) {
  return new Set(
    String(text ?? "")
      .split("\n")
      .map((line) => line.replace(/#.*$/, "").trim())
      .filter(Boolean),
  );
}

export function findPendingMigrations(fileNames, ledgerVersions, ignored = new Set()) {
  const applied = new Set(ledgerVersions.map(String));
  const files = fileNames
    .map((name) => ({ name, version: migrationVersion(name) }))
    .filter((f) => f.version !== null);
  const pending = files
    .filter((f) => !applied.has(f.version) && !ignored.has(f.version))
    .sort((a, b) => a.name.localeCompare(b.name));
  // Ledger rows with no file are reported for information. They do not fail the check.
  const fileVersions = new Set(files.map((f) => f.version));
  const ledgerOnly = [...applied].filter((v) => !fileVersions.has(v)).sort();
  return { pending, ledgerOnly };
}

export function formatReport({ pending, ledgerOnly }, totalFiles) {
  const lines = [];
  if (pending.length === 0) {
    lines.push(`All ${totalFiles} migration files are recorded in the production ledger.`);
  } else {
    lines.push(`${pending.length} of ${totalFiles} migration files are NOT recorded in the production ledger:`);
    for (const f of pending) lines.push(`  ${f.name}`);
    lines.push("Apply them with `supabase db push` against production, then re-run this job.");
  }
  if (ledgerOnly.length > 0) {
    lines.push(`${ledgerOnly.length} ledger version(s) have no file in supabase/migrations (not a failure): ${ledgerOnly.join(", ")}`);
  }
  return lines.join("\n");
}
