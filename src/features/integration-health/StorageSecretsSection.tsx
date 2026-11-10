// The media storage secrets on Integration health (phase 6b). Names and whether each is set,
// never a value. Approving an application that has files and deleting a location that has
// photos need both; the pages say so in plain words when one is missing.
import { describeVaultSecret, type VaultSecretStatus } from "./model";

export function StorageSecretsSection({ secrets }: { secrets: VaultSecretStatus[] | undefined }) {
  if (!secrets || secrets.length === 0) return null;
  const missing = secrets.filter((s) => s.present === false).length;
  const unknown = secrets.filter((s) => s.present === null).length;
  const summary =
    missing > 0
      ? `${missing} of ${secrets.length} storage signing secrets ${missing === 1 ? "is" : "are"} missing.`
      : unknown > 0
        ? "The storage signing secrets could not be checked right now."
        : "Both storage signing secrets are set.";
  return (
    <section aria-labelledby="ih-storage-secrets" className="space-y-2">
      <h2 id="ih-storage-secrets" className="text-base font-semibold">Media storage secrets</h2>
      <p className="text-sm text-muted-foreground" data-testid="storage-secrets-summary">
        {summary} Uploading and deleting photos and videos does not need them.
      </p>
      <ul className="space-y-1 text-sm">
        {secrets.map((s) => (
          <li key={s.name} className="rounded border border-input p-2" data-testid={`storage-secret-${s.name}`} data-present={String(s.present)}>
            <code>{s.name}</code>: {describeVaultSecret(s)}
          </li>
        ))}
      </ul>
    </section>
  );
}
