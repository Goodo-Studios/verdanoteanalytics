/**
 * Ad Name Generator: the name format and the screen behaviour, checked against the old
 * app's own tests (repos/private/goodo-ad-name-generator/src/lib/adName.test.ts and
 * src/components/AdNameGenerator.test.tsx). The Supabase client is mocked: peek_ad_code
 * and claim_ad_code are the counter, ad_accounts and angle_clusters the client list.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const db = vi.hoisted(() => ({
  rpc: vi.fn(),
  accounts: [] as Array<{ id: string; name: string }>,
  clusters: [] as Array<{ id: string; account_id: string; label: string | null }>,
  queries: [] as Array<{ table: string; calls: Array<[string, unknown[]]> }>,
}));

vi.mock("@/integrations/supabase/client", () => {
  // A thenable query builder that records its calls and resolves to the table's rows.
  const from = (table: string) => {
    const rec = { table, calls: [] as Array<[string, unknown[]]> };
    db.queries.push(rec);
    const builder: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order", "is", "not"]) {
      builder[m] = (...args: unknown[]) => {
        rec.calls.push([m, args]);
        return builder;
      };
    }
    builder.then = (resolve: (v: unknown) => void) =>
      resolve({ data: table === "ad_accounts" ? db.accounts : db.clusters, error: null });
    return builder;
  };
  return { supabase: { rpc: db.rpc, from } };
});

import AdNameGeneratorPage from "@/features/ad-name-generator/AdNameGeneratorPage";
import {
  buildAdName,
  buildClientList,
  emptyFields,
  formatCode,
  isComplete,
  sanitizeSegment,
  toCode,
  validate,
  type AdNameFields,
} from "@/features/ad-name-generator/adName";

const filled = (overrides: Partial<AdNameFields> = {}): AdNameFields => ({
  accountId: "act_test",
  adType: "Video",
  personOnCamera: "Customer",
  productName: "Greens",
  hook: "Tired by 3pm?",
  themeOfAd: "ChronicFatigue",
  creativeType: "UGCNative",
  uniqueCode: "200001",
  ...overrides,
});

// ---------------------------------------------------------------- name format

describe("name format (same as the old generator)", () => {
  it("formats the code with GS and six digits", () => {
    expect(formatCode("42")).toBe("GS000042");
    expect(formatCode("200001")).toBe("GS200001");
    expect(formatCode("GS 200-001")).toBe("GS200001");
    expect(formatCode("123456789")).toBe("GS123456");
    expect(formatCode("")).toBe("");
    expect(formatCode("abc")).toBe("");
  });

  it("collapses word breaks into capitals and keeps tokens that already have capitals", () => {
    expect(sanitizeSegment("  night repair serum!  ")).toBe("NightRepairSerum");
    expect(sanitizeSegment("Us vs. them")).toBe("UsVsThem");
    expect(sanitizeSegment("UGC native")).toBe("UGCNative");
    expect(sanitizeSegment("iPhone case")).toBe("iPhoneCase");
    expect(sanitizeSegment("Crème brûlée")).toBe("CremeBrulee");
    expect(sanitizeSegment("Winter_Dryness")).toBe("WinterDryness");
  });

  it("assembles the seven positions in convention order", () => {
    expect(buildAdName(filled())).toBe("GS200001_Video_Customer_UGCNative_Greens_TiredBy3pm_ChronicFatigue");
    expect(buildAdName(filled()).split("_")).toEqual(["GS200001", "Video", "Customer", "UGCNative", "Greens", "TiredBy3pm", "ChronicFatigue"]);
  });

  it("keeps a typed hook to one segment whatever its punctuation", () => {
    const name = buildAdName(filled({ hook: "Wait_what? You're still doing this?!" }));
    expect(name.split("_")).toHaveLength(7);
    expect(name.split("_")[5]).toBe("WaitWhatYouReStillDoingThis");
  });

  it("omits empty segments, returns empty for an untouched form, and leaves the account out", () => {
    const name = buildAdName(filled({ productName: "" }));
    expect(name).not.toContain("__");
    expect(name.split("_")).toHaveLength(6);
    expect(buildAdName(emptyFields())).toBe("");
    expect(buildAdName(filled())).not.toContain("act_");
  });

  it("requires every field and rejects text that sanitizes to nothing", () => {
    expect(validate(filled())).toEqual({});
    expect(isComplete(filled())).toBe(true);
    expect(Object.keys(validate(emptyFields())).sort()).toEqual(
      ["accountId", "adType", "creativeType", "hook", "personOnCamera", "productName", "themeOfAd", "uniqueCode"].sort(),
    );
    expect(validate(filled({ hook: "   " })).hook).toBeDefined();
    expect(validate(filled({ hook: "???" })).hook).toBe("Use at least one letter or number");
    expect(validate(filled({ themeOfAd: "🔥🔥" })).themeOfAd).toBeDefined();
    expect(isComplete(filled({ productName: "---" }))).toBe(false);
  });

  it("turns the counter value into six digits and refuses unusable values", () => {
    expect(toCode(200001)).toBe("200001");
    expect(toCode(42)).toBe("000042");
    for (const bad of [null, undefined, 0, -5, "x", Number.NaN]) expect(() => toCode(bad)).toThrow(/unusable/);
  });

  it("builds the client list like the old taxonomy mirror: sorted, themes sorted, E2E themes left out", () => {
    const list = buildClientList(
      [
        { id: "act_b", name: "Bravo" },
        { id: "act_a", name: "Alpha" },
      ],
      [
        { id: "c1", account_id: "act_a", label: "Zest" },
        { id: "c2", account_id: "act_a", label: "Calm" },
        { id: "c3", account_id: "act_a", label: "E2E Theme 1784906810376 (renamed)" },
        { id: "c4", account_id: "act_a", label: null },
      ],
    );
    expect(list.map((a) => a.name)).toEqual(["Alpha", "Bravo"]);
    expect(list[0].themes.map((t) => t.label)).toEqual(["Calm", "Zest"]);
    expect(list[1].themes).toEqual([]);
  });
});

// ---------------------------------------------------------------- screen

const writeText = vi.fn<(text: string) => Promise<void>>();
let peekValue: number;
let claimResult: { data: number | null; error: { message: string } | null };

function counter(name: string) {
  if (name === "peek_ad_code") return Promise.resolve({ data: peekValue, error: null });
  if (name === "claim_ad_code") return Promise.resolve(claimResult);
  throw new Error(`unexpected rpc ${name}`);
}
const claims = () => db.rpc.mock.calls.filter(([n]) => n === "claim_ad_code").length;
const peeks = () => db.rpc.mock.calls.filter(([n]) => n === "peek_ad_code").length;

function pick(label: RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

async function fillForm(client: "Barriere" | "Bearaby" = "Barriere") {
  pick(/^Client/, client === "Barriere" ? "act_governed" : "act_bare");
  pick(/^Theme/, "ChronicFatigue");
  pick(/^Ad Type/, "Video");
  pick(/^Creative Type/, "UGCNative");
  pick(/^Hook/, "Tired by 3pm?");
  pick(/^Person on Camera/, "Customer");
  pick(/^Product Name/, "Greens");
}

async function renderReady() {
  render(<AdNameGeneratorPage />);
  await screen.findByRole("option", { name: "Barriere" });
  await waitFor(() => expect(screen.getByTestId("generated-name").textContent).toContain("GS200001"));
}

beforeEach(() => {
  db.rpc.mockReset().mockImplementation(counter);
  db.queries = [];
  db.accounts = [
    { id: "act_governed", name: "Barriere" },
    { id: "act_bare", name: "Bearaby" },
  ];
  db.clusters = [{ id: "a1", account_id: "act_governed", label: "ChronicFatigue" }];
  peekValue = 200001;
  claimResult = { data: 200001, error: null };
  writeText.mockReset().mockResolvedValue();
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Ad Name Generator page", () => {
  it("previews the next code on load without spending it", async () => {
    await renderReady();
    expect(peeks()).toBe(1);
    expect(claims()).toBe(0);
  });

  it("reads active accounts and non-archived themes with the staff session", async () => {
    await renderReady();
    const acc = db.queries.find((q) => q.table === "ad_accounts");
    const cl = db.queries.find((q) => q.table === "angle_clusters");
    expect(acc?.calls).toContainEqual(["eq", ["is_active", true]]);
    expect(cl?.calls).toContainEqual(["is", ["archived_at", null]]);
  });

  it("builds the full name and spends one code on copy", async () => {
    await renderReady();
    await fillForm();
    expect(screen.getByTestId("generated-name").textContent).toBe("GS200001_Video_Customer_UGCNative_Greens_TiredBy3pm_ChronicFatigue");
    fireEvent.click(screen.getByRole("button", { name: /Copy Ad Name/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("GS200001_Video_Customer_UGCNative_Greens_TiredBy3pm_ChronicFatigue"));
    expect(claims()).toBe(1);
  });

  it("has no style or body field and takes the hook as typed text", async () => {
    await renderReady();
    expect(screen.queryByLabelText(/Style of Ad/)).toBeNull();
    expect(screen.queryByLabelText(/Body/)).toBeNull();
    expect(screen.getByLabelText(/^Hook/).tagName).toBe("INPUT");
  });

  it("offers a theme dropdown when the client has themes, typed text with a warning when not", async () => {
    await renderReady();
    pick(/^Client/, "act_governed");
    expect(screen.getByLabelText(/^Theme/).tagName).toBe("SELECT");
    pick(/^Client/, "act_bare");
    expect(screen.getByLabelText(/^Theme/).tagName).toBe("INPUT");
    expect(screen.getByText(/no theme list on its board yet/i)).toBeTruthy();
  });

  it("clears the theme when the client changes", async () => {
    await renderReady();
    pick(/^Client/, "act_governed");
    pick(/^Theme/, "ChronicFatigue");
    pick(/^Client/, "act_bare");
    expect((screen.getByLabelText(/^Theme/) as HTMLInputElement).value).toBe("");
  });

  it("offers the four style values as the creative type", async () => {
    await renderReady();
    const options = [...(screen.getByLabelText(/^Creative Type/) as HTMLSelectElement).options].map((o) => o.value);
    expect(options.filter(Boolean)).toEqual(["UGCNative", "StudioClean", "TextForward", "Lifestyle"]);
  });

  it("copies the claimed code, not the previewed one, when someone else copied first", async () => {
    claimResult = { data: 200007, error: null };
    await renderReady();
    await fillForm();
    fireEvent.click(screen.getByRole("button", { name: /Copy Ad Name/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining("GS200007")));
    expect(writeText).not.toHaveBeenCalledWith(expect.stringContaining("GS200001"));
  });

  it("copies nothing when the counter refuses or cannot be reached (no random fallback)", async () => {
    claimResult = { data: null, error: { message: "only staff can claim an ad code" } };
    await renderReady();
    await fillForm();
    fireEvent.click(screen.getByRole("button", { name: /Copy Ad Name/ }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Nothing was copied: only staff can claim an ad code/);
    expect(writeText).not.toHaveBeenCalled();
  });

  it("shows an error and no code when peeking is refused", async () => {
    db.rpc.mockImplementation((name: string) =>
      name === "peek_ad_code" ? Promise.resolve({ data: null, error: { message: "only staff can read the ad code counter" } }) : counter(name),
    );
    render(<AdNameGeneratorPage />);
    expect((await screen.findByRole("alert")).textContent).toMatch(/Could not reach the code counter: only staff/);
    expect(screen.getByTestId("generated-name").textContent).not.toMatch(/GS\d/);
  });

  it("keeps the claimed name on screen when the browser blocks the clipboard", async () => {
    writeText.mockRejectedValue(new Error("NotAllowedError"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await renderReady();
    await fillForm();
    fireEvent.click(screen.getByRole("button", { name: /Copy Ad Name/ }));
    expect(await screen.findByText(/copy it by hand/i)).toBeTruthy();
    expect(screen.getByTestId("generated-name").textContent).toBe("GS200001_Video_Customer_UGCNative_Greens_TiredBy3pm_ChronicFatigue");
    expect((screen.getByRole("button", { name: /Copied/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(claims()).toBe(1);
  });

  it("will not spend a second code for the copied name, and picks up the next code on edit", async () => {
    await renderReady();
    await fillForm();
    fireEvent.click(screen.getByRole("button", { name: /Copy Ad Name/ }));
    await screen.findByRole("status");
    expect((screen.getByRole("button", { name: /Copied/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(claims()).toBe(1);
    peekValue = 200002;
    pick(/^Hook/, "Another hook");
    await waitFor(() => expect(screen.getByTestId("generated-name").textContent).toMatch(/^GS200002_/));
    expect(peeks()).toBe(2);
  });

  it("keeps client and product across Next Ad", async () => {
    await renderReady();
    await fillForm();
    fireEvent.click(screen.getByRole("button", { name: /Next Ad/ }));
    expect((screen.getByLabelText(/^Client/) as HTMLSelectElement).value).toBe("act_governed");
    expect((screen.getByLabelText(/^Product Name/) as HTMLInputElement).value).toBe("Greens");
    expect((screen.getByLabelText(/^Hook/) as HTMLInputElement).value).toBe("");
  });

  it("blocks copying until every field is filled", async () => {
    await renderReady();
    expect((screen.getByRole("button", { name: /Copy Ad Name/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(claims()).toBe(0);
  });
});
