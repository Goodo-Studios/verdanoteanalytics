/**
 * Tag editors and Save to Vault are staff controls (audit plan item 3.3).
 *
 * Clients use the Creatives page. The inline tag cells and the tag editor in the creative detail
 * window had no role check, so clients saw editors whose saves the server then refused. A builder
 * previewing the client view must see what a client sees. The editors now show only to staff who
 * are not in Client Preview; everyone else sees the tag as plain text.
 */
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  auth: { isBuilder: false, isEmployee: false, isClient: true },
  preview: { isClientPreview: false, isEmployeePreview: false },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => h.auth }));
vi.mock("@/hooks/useClientPreviewMode", () => ({ useClientPreview: () => h.preview }));

import { InlineTagSelect, InlineTagText } from "@/components/InlineTagSelect";
import { useCanEditTags } from "@/hooks/useCanEditTags";

function as(role: "builder" | "employee" | "client", clientPreview = false) {
  h.auth = { isBuilder: role === "builder", isEmployee: role === "employee", isClient: role === "client" };
  h.preview = { isClientPreview: clientPreview, isEmployeePreview: false };
}

function cells() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <InlineTagSelect adId="ad1" field="person" currentValue="Founder" />
      <InlineTagText adId="ad1" field="hook" currentValue="Before and after" />
    </QueryClientProvider>,
  );
}

describe("inline tag cells", () => {
  it.each([
    ["builder", false],
    ["employee", false],
  ] as const)("%s gets the editors", (role, preview) => {
    as(role, preview);
    cells();
    expect(screen.getByRole("combobox")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Hook: Before and after \(edit\)/ })).toBeTruthy();
  });

  it.each([
    ["client", false],
    ["builder", true],
  ] as const)("%s (client preview %s) sees plain text and no editor", (role, preview) => {
    as(role, preview);
    cells();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Founder")).toBeTruthy();
    expect(screen.getByText("Before and after")).toBeTruthy();
  });
});

describe("useCanEditTags", () => {
  function Probe() {
    return <span>{String(useCanEditTags())}</span>;
  }
  it.each([
    ["builder", false, "true"],
    ["employee", false, "true"],
    ["client", false, "false"],
    ["builder", true, "false"],
  ] as const)("%s, client preview %s → %s", (role, preview, expected) => {
    as(role, preview);
    render(<Probe />);
    expect(screen.getByText(expected)).toBeTruthy();
  });
});

describe("creative detail window", () => {
  const modal = readFileSync(join(process.cwd(), "src/components/CreativeDetailModal.tsx"), "utf8");
  it("uses the shared check for canEdit, the tag editor and Save to Vault", () => {
    expect(modal).toMatch(/const canEdit = useCanEditTags\(\)/);
    expect(modal).toMatch(/\{canEdit && <CreativeTagEditor/);
    expect(modal).not.toMatch(/\{\(isBuilder \|\| isEmployee\) && \(/);
  });
});
