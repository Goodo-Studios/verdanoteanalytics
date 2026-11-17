import { describe, expect, it } from "vitest";
import { isCreatorPickerPath, pickerClients } from "@/lib/clientPickerOptions";

const CLIENTS = [
  { slug: "a", name: "A", active: true, does_creators: true },
  { slug: "b", name: "B", active: true, does_creators: false },
  { slug: "c", name: "C", active: false, does_creators: true },
  { slug: "d", name: "D", active: true },
];
const slugs = (p: string, sel = "") => pickerClients(CLIENTS, sel, p).map((c) => c.slug);

describe("pickerClients", () => {
  it("recognises the creator pages, with or without a role prefix", () => {
    expect(isCreatorPickerPath("/talent/pipeline")).toBe(true);
    expect(isCreatorPickerPath("/builder/talent/approval-boards")).toBe(true);
    expect(isCreatorPickerPath("/talent/creators")).toBe(false);
    expect(isCreatorPickerPath("/production/casting")).toBe(false);
  });
  it("offers active clients that run creators on Creator pipeline and Approval boards", () => {
    expect(slugs("/talent/pipeline")).toEqual(["a", "d"]);
    expect(slugs("/employee/talent/approval-boards")).toEqual(["a", "d"]);
  });
  it("offers every active client on other pages such as Casting", () => {
    expect(slugs("/production/casting")).toEqual(["a", "b", "d"]);
  });
  it("keeps a selected inactive or non-creator client selectable", () => {
    expect(slugs("/talent/pipeline", "c")).toEqual(["a", "c", "d"]);
    expect(slugs("/talent/pipeline", "b")).toEqual(["a", "b", "d"]);
    expect(slugs("/production/casting", "c")).toEqual(["a", "b", "c", "d"]);
  });
});
