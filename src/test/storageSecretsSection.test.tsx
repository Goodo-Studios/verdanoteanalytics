/**
 * Integration health shows whether the two storage signing secrets are set (phase 6b): names and
 * "Set" or "Missing" only. The values never reach the page.
 */
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StorageSecretsSection } from "@/features/integration-health/StorageSecretsSection";
import { describeVaultSecret, type VaultSecretStatus } from "@/features/integration-health/model";

const NEEDED = "approving an application that has files, and deleting a location that has photos";
const secret = (name: string, present: boolean | null): VaultSecretStatus => ({ name, present, needed_for: NEEDED });

describe("Media storage secrets on Integration health", () => {
  it("lists both names as Set when they are present", () => {
    render(<StorageSecretsSection secrets={[secret("storage_signing_project_url", true), secret("storage_signing_service_role_key", true)]} />);
    expect(screen.getByTestId("storage-secrets-summary").textContent).toMatch(/Both storage signing secrets are set/);
    expect(within(screen.getByTestId("storage-secret-storage_signing_project_url")).getByText("Set", { exact: false })).toBeTruthy();
    expect(screen.getByTestId("storage-secret-storage_signing_service_role_key").getAttribute("data-present")).toBe("true");
  });

  it("says which are missing and what stops working, and that uploading photos does not need them", () => {
    render(<StorageSecretsSection secrets={[secret("storage_signing_project_url", false), secret("storage_signing_service_role_key", true)]} />);
    expect(screen.getByTestId("storage-secrets-summary").textContent).toMatch(/1 of 2 storage signing secrets is missing/);
    expect(screen.getByTestId("storage-secrets-summary").textContent).toMatch(/Uploading and deleting photos and videos does not need them/);
    const row = screen.getByTestId("storage-secret-storage_signing_project_url");
    expect(row.textContent).toMatch(/Missing/);
    expect(row.textContent).toMatch(/approving an application that has files/);
    expect(row.getAttribute("data-present")).toBe("false");
  });

  it("says when the check could not be made, rather than calling the secret missing", () => {
    render(<StorageSecretsSection secrets={[secret("storage_signing_project_url", null), secret("storage_signing_service_role_key", null)]} />);
    expect(screen.getByTestId("storage-secret-storage_signing_project_url").textContent).toMatch(/Could not be checked right now/);
    expect(screen.getByTestId("storage-secrets-summary").textContent).toMatch(/could not be checked right now/);
    expect(screen.getByTestId("storage-secrets-summary").textContent).not.toMatch(/missing|are set/);
  });

  it("renders nothing when the server sent no secret list", () => {
    const { container } = render(<StorageSecretsSection secrets={undefined} />);
    expect(container.firstChild).toBeNull();
    expect(describeVaultSecret(secret("x", true))).toBe("Set");
  });
});
