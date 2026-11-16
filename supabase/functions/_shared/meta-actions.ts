// Pick one Meta action type by a fixed priority (audit plan item 6.1, part 7).
//
// Meta reports the same purchases under several overlapping action types. Taking the
// first match in Meta's list (the old code) let purchases and revenue switch definition
// from day to day, and adding them together counted the same purchase up to three times.
// Every parser now asks for the first type in this priority list that is present:
//   1. omni_purchase: all channels, de-duplicated (what Ads Manager shows as Purchases)
//   2. purchase
//   3. offsite_conversion.fb_pixel_purchase: pixel only, for accounts that report nothing else

export const PURCHASE_ACTION_TYPES = [
  "omni_purchase",
  "purchase",
  "offsite_conversion.fb_pixel_purchase",
] as const;

export const ADD_TO_CART_ACTION_TYPES = [
  "omni_add_to_cart",
  "add_to_cart",
  "offsite_conversion.fb_pixel_add_to_cart",
] as const;

export interface MetaAction {
  action_type?: string;
  value?: string | number | null;
}

/** The raw value of the highest-priority type present, or undefined when none is. */
export function pickActionValue(
  actions: MetaAction[] | null | undefined,
  priority: readonly string[],
): string | number | undefined {
  if (!Array.isArray(actions)) return undefined;
  for (const type of priority) {
    const hit = actions.find((a) => a?.action_type === type);
    if (hit) return hit.value ?? "0";
  }
  return undefined;
}
